-- =============================================================================
-- 0050_billing_hardening.sql
--
-- Endurecimiento del cobro con PayPal tras la revisión de seguridad.
--
--   1. billing_events: status ('processing' | 'done') y claimed_at. El servidor reserva el aviso como
--      'processing', lo aplica y lo marca 'done'. Un 'processing' de más de 5 min se retoma (corte a mitad).
--      Las filas anteriores a esta migración quedan 'done' (antes solo existían las reservadas y aplicadas).
--   2. billing_subscriptions.last_event_time: último evento de PayPal aplicado; los más viejos no cambian el estado.
--   3. billing_sales: una fila por venta (PAYMENT.SALE.COMPLETED), clave sale_id. Evita acreditar dos veces el mismo
--      pago aunque llegue con otro event.id, y permite restar el periodo si hay reembolso o reverso.
--   4. billing_apply_payment(): acredita una venta (venta + paid_until + perfil) en UNA transacción.
--   5. billing_reverse_sale(): reembolso (total o parcial) y reverso/contracargo de una venta.
--   6. redeem_invite (0047): has_paid_plan cubre también cancelled y suspended con periodo pagado vigente.
--   7. redeem_recovery_code (0049): mueve las suscripciones de PayPal del perfil antiguo al nuevo.
--   8. handle_new_user (0047): solo el proveedor exactamente 'twitch' cuenta como Twitch.
--
-- Las funciones de cobro (4 y 5) son security definer con search_path = '' y SOLO las ejecuta service_role.
-- Las tablas nuevas tienen RLS activada y ninguna política: solo la clave de servicio las toca.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0049. Se puede volver a ejecutar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Idempotencia de avisos
-- -----------------------------------------------------------------------------

alter table public.billing_events add column if not exists status text not null default 'done';
alter table public.billing_events add column if not exists claimed_at timestamptz not null default now();

alter table public.billing_events drop constraint if exists billing_events_status_check;
alter table public.billing_events add constraint billing_events_status_check
  check (status in ('processing', 'done'));

-- -----------------------------------------------------------------------------
-- 2. Orden de eventos
-- -----------------------------------------------------------------------------

alter table public.billing_subscriptions add column if not exists last_event_time timestamptz;

-- -----------------------------------------------------------------------------
-- 3. Ventas
-- -----------------------------------------------------------------------------

create table if not exists public.billing_sales (
  sale_id          text primary key,
  subscription_id  uuid not null references public.billing_subscriptions (id) on delete cascade,
  months_credited  int  not null check (months_credited > 0),
  amount           numeric,
  currency         text,
  refunded_amount  numeric not null default 0,
  reversed_at      timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists billing_sales_subscription on public.billing_sales (subscription_id);

alter table public.billing_sales enable row level security;
revoke all on public.billing_sales from anon, authenticated;
-- Sin políticas: solo el servidor (clave de servicio, que ignora RLS).

-- -----------------------------------------------------------------------------
-- 4. Acreditar una venta (atómico)
-- -----------------------------------------------------------------------------

-- Devuelve: applied | duplicate (la venta ya estaba) | unknown_subscription.
-- Réplica de paidUntilAfterPayment / statusAfterPayment de server/paypal/logic.ts:
--   - suma el periodo de la suscripción desde paid_until si es futuro, o desde ahora;
--   - estado 'active' (una 'cancelled' sigue cancelada; un pago más viejo que el último evento no reabre una
--     suscripción que no sea 'pending');
--   - el perfil recibe el plan y el vencimiento.
create or replace function public.billing_apply_payment(
  p_sale_id                 text,
  p_paypal_subscription_id  text,
  p_amount                  numeric default null,
  p_currency                text default null,
  p_event_time              timestamptz default null
)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_sub    public.billing_subscriptions%rowtype;
  v_base   timestamptz;
  v_new    timestamptz;
  v_rows   int;
  v_status text;
  v_stale  boolean;
begin
  if p_sale_id is null or length(trim(p_sale_id)) = 0 or length(p_sale_id) > 100 then
    raise exception 'invalid_sale';
  end if;

  select * into v_sub from public.billing_subscriptions s
  where s.paypal_subscription_id = p_paypal_subscription_id
  for update;
  if not found then
    return 'unknown_subscription';
  end if;

  insert into public.billing_sales (sale_id, subscription_id, months_credited, amount, currency)
  values (p_sale_id, v_sub.id, v_sub.months, p_amount, p_currency)
  on conflict (sale_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return 'duplicate';
  end if;

  v_base := greatest(now(), coalesce(v_sub.paid_until, now()));
  v_new  := ((v_base at time zone 'UTC') + make_interval(months => v_sub.months)) at time zone 'UTC';

  v_stale := p_event_time is not null and v_sub.last_event_time is not null and p_event_time < v_sub.last_event_time;
  v_status := case
    when v_sub.status = 'cancelled' then 'cancelled'
    when v_sub.status <> 'pending' and v_stale then v_sub.status
    else 'active'
  end;

  update public.billing_subscriptions
     set paid_until      = v_new,
         last_payment_at = now(),
         status          = v_status,
         last_event_time = case
                             when p_event_time is null then last_event_time
                             else greatest(coalesce(last_event_time, p_event_time), p_event_time)
                           end,
         updated_at      = now()
   where id = v_sub.id;

  update public.profiles
     set plan_id = v_sub.plan_id, plan_expires_at = v_new
   where id = v_sub.profile_id;

  return 'applied';
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Reembolso o reverso de una venta
-- -----------------------------------------------------------------------------

-- Devuelve: applied | partial (reembolso parcial: solo se registra) | duplicate (ya se había quitado ese periodo)
--           | unknown_sale (la venta no está registrada: el servidor responde 503 y PayPal reintenta).
-- Reembolso total (lo reembolsado acumulado alcanza el importe) o reverso/contracargo:
--   resta months_credited de paid_until, nunca por debajo de ahora, y actualiza profiles.plan_expires_at si el perfil
--   tenía justo ese vencimiento. En un reverso la suscripción pasa a 'suspended' (salvo cancelled/expired, o si el
--   evento es más viejo que el último aplicado). Si ya no queda acceso, billing_expire_due() devuelve el perfil al plan
--   por defecto.
-- Un reembolso sin importe conocido no se toma por total.
create or replace function public.billing_reverse_sale(
  p_sale_id     text,
  p_amount      numeric default null,
  p_reversal    boolean default false,
  p_event_time  timestamptz default null
)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_sale     public.billing_sales%rowtype;
  v_sub      public.billing_subscriptions%rowtype;
  v_refunded numeric;
  v_full     boolean;
  v_old      timestamptz;
  v_new      timestamptz;
  v_status   text;
  v_stale    boolean;
begin
  select * into v_sale from public.billing_sales x where x.sale_id = p_sale_id for update;
  if not found then
    return 'unknown_sale';
  end if;

  select * into v_sub from public.billing_subscriptions s where s.id = v_sale.subscription_id for update;
  if not found then
    return 'unknown_sale';
  end if;

  v_refunded := v_sale.refunded_amount;
  if not coalesce(p_reversal, false) then
    v_refunded := v_refunded + coalesce(p_amount, 0);
    update public.billing_sales set refunded_amount = v_refunded where sale_id = v_sale.sale_id;
  end if;

  v_full := coalesce(p_reversal, false)
            or (v_sale.amount is not null and v_sale.amount > 0 and v_refunded >= v_sale.amount);
  if not v_full then
    return 'partial';
  end if;
  if v_sale.reversed_at is not null then
    return 'duplicate';
  end if;

  v_old := v_sub.paid_until;
  if v_old is null then
    v_new := now();
  else
    v_new := greatest(now(), ((v_old at time zone 'UTC') - make_interval(months => v_sale.months_credited)) at time zone 'UTC');
  end if;

  update public.billing_sales set reversed_at = now() where sale_id = v_sale.sale_id;

  v_stale := p_event_time is not null and v_sub.last_event_time is not null and p_event_time < v_sub.last_event_time;
  v_status := v_sub.status;
  if coalesce(p_reversal, false) and not v_stale and v_sub.status not in ('cancelled', 'expired') then
    v_status := 'suspended';
  end if;

  update public.billing_subscriptions
     set paid_until      = v_new,
         status          = v_status,
         last_event_time = case
                             when coalesce(p_reversal, false) and not v_stale and p_event_time is not null
                               then greatest(coalesce(last_event_time, p_event_time), p_event_time)
                             else last_event_time
                           end,
         updated_at      = now()
   where id = v_sub.id;

  if v_old is not null then
    update public.profiles
       set plan_expires_at = v_new
     where id = v_sub.profile_id
       and plan_expires_at is not distinct from v_old;
  end if;

  if v_new <= now() then
    perform public.billing_expire_due();
  end if;

  return 'applied';
end;
$$;

-- Solo el servidor (clave de servicio).
revoke all on function public.billing_apply_payment(text, text, numeric, text, timestamptz) from public, anon, authenticated;
revoke all on function public.billing_reverse_sale(text, numeric, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.billing_apply_payment(text, text, numeric, text, timestamptz) to service_role;
grant execute on function public.billing_reverse_sale(text, numeric, boolean, timestamptz) to service_role;

-- -----------------------------------------------------------------------------
-- 6. redeem_invite: el plan pagado manda también si la suscripción está cancelada o suspendida
--    pero el periodo ya pagado sigue vigente. Resto idéntico a 0047.
-- -----------------------------------------------------------------------------

create or replace function public.redeem_invite(p_code text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_status  text;
  v_twitch  text;
  v_plan    text;
  v_exp     timestamptz;
  v_default text;
  v_code    public.invite_codes%rowtype;
  v_base    timestamptz;
  v_new_exp timestamptz;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select p.status, p.twitch_user_id, p.plan_id, p.plan_expires_at
    into v_status, v_twitch, v_plan, v_exp
  from public.profiles p where p.id = v_uid for update;
  if v_status is null or v_status not in ('pending', 'active') then
    return 'not_pending';
  end if;
  if v_twitch is null then
    return 'no_twitch';
  end if;

  -- El bloqueo de fila hace atómico el incremento de used_count.
  select * into v_code from public.invite_codes c
  where c.code = upper(trim(p_code)) for update;

  if not found then
    return 'not_found';
  elsif v_code.revoked_at is not null then
    return 'revoked';
  elsif v_code.expires_at is not null and v_code.expires_at <= now() then
    return 'expired';
  elsif v_code.used_count >= v_code.max_uses then
    return 'used_up';
  end if;

  -- Convivencia con el cobro: el plan pagado manda (alineado con paysNow de server/paypal/logic.ts).
  if exists (
    select 1 from public.billing_subscriptions s
    where s.profile_id = v_uid
      and s.status in ('active', 'grace', 'cancelled', 'suspended')
      and s.paid_until is not null
      and s.paid_until > now()
  ) then
    return 'has_paid_plan';
  end if;

  if exists (
    select 1 from public.invite_redemptions r
    where r.invite_code_id = v_code.id and r.profile_id = v_uid
  ) then
    return 'already_redeemed';
  end if;

  if v_status = 'active' then
    select pl.id into v_default from public.plans pl where pl.is_default limit 1;
    if v_plan is not null and v_exp is null and v_plan is distinct from v_default then
      return 'has_plan';
    end if;
  end if;

  if v_code.plan_months is not null then
    v_base := greatest(
      now(),
      case when v_plan is not distinct from v_code.plan_id and v_exp is not null then v_exp else now() end
    );
    v_new_exp := ((v_base at time zone 'UTC') + make_interval(months => v_code.plan_months)) at time zone 'UTC';
  else
    v_new_exp := null;
  end if;

  update public.invite_codes set used_count = used_count + 1 where id = v_code.id;

  insert into public.invite_redemptions (invite_code_id, profile_id)
  values (v_code.id, v_uid)
  on conflict do nothing;

  update public.profiles
     set status          = 'active',
         plan_id         = v_code.plan_id,
         invite_code_id  = v_code.id,
         plan_expires_at = v_new_exp
   where id = v_uid;

  return 'ok';
end;
$$;

revoke execute on function public.redeem_invite(text) from public, anon, authenticated;
grant execute on function public.redeem_invite(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. redeem_recovery_code: las suscripciones de PayPal siguen a la cuenta recuperada
--    Resto idéntico a 0049 (código de un solo uso, caduca, misma cuenta, perfil antiguo suspendido,
--    rol sin transferir, plan_expires_at heredado).
-- -----------------------------------------------------------------------------

create or replace function public.redeem_recovery_code(p_code text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_me     public.profiles%rowtype;
  v_rec    public.recovery_codes%rowtype;
  v_old    public.profiles%rowtype;
  v_fresh  boolean;
  v_tmp    text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_rec from public.recovery_codes r
  where r.code_hash = encode(sha256(convert_to(upper(trim(p_code)), 'UTF8')), 'hex')
  for update;

  if not found then
    return 'not_found';
  elsif v_rec.used_at is not null then
    return 'used';
  elsif v_rec.expires_at <= now() then
    return 'expired';
  elsif v_rec.profile_id = v_uid then
    return 'same_profile';
  end if;

  select * into v_me from public.profiles p where p.id = v_uid for update;
  if not found then
    return 'not_pending';
  end if;

  if v_me.status = 'pending' then
    v_fresh := true;
  else
    v_fresh :=
      v_me.status = 'active'
      and v_me.role = 'streamer'
      and not public.invites_required()
      and v_me.invite_code_id is null
      and v_me.onboarded_at is null
      and v_me.plan_expires_at is null
      and v_me.plan_id is not distinct from (select pl.id from public.plans pl where pl.is_default limit 1)
      and not exists (select 1 from public.media_files m where m.profile_id = v_uid)
      and not exists (select 1 from public.billing_subscriptions s where s.profile_id = v_uid);
  end if;
  if not v_fresh then
    return 'not_pending';
  end if;

  select * into v_old from public.profiles p where p.id = v_rec.profile_id for update;

  -- El perfil nuevo no debería tener datos; se limpia por si acaso.
  delete from public.configs where profile_id = v_uid;
  delete from public.media_files where profile_id = v_uid;

  update public.configs set profile_id = v_uid where profile_id = v_old.id;
  update public.media_files set profile_id = v_uid where profile_id = v_old.id;

  -- Las suscripciones de PayPal (y con ellas sus ventas, que cuelgan de la suscripción) pasan a la cuenta nueva:
  -- los avisos de PayPal leen billing_subscriptions.profile_id para dar el plan al perfil correcto.
  update public.billing_subscriptions set profile_id = v_uid, updated_at = now() where profile_id = v_old.id;

  -- Libera los valores unique del perfil antiguo antes de dárselos al nuevo.
  update public.profiles
     set widget_key   = v_tmp,
         media_folder = 'retired-' || v_old.id::text,
         status       = 'suspended'
   where id = v_old.id;

  update public.profiles
     set widget_key      = v_old.widget_key,
         media_folder    = v_old.media_folder,
         plan_id         = v_old.plan_id,
         plan_expires_at = v_old.plan_expires_at,
         invite_code_id  = v_old.invite_code_id,
         status          = 'active'
   where id = v_uid;

  update public.recovery_codes set used_at = now() where id = v_rec.id;

  return 'ok';
end;
$$;

revoke execute on function public.redeem_recovery_code(text) from public, anon, authenticated;
grant execute on function public.redeem_recovery_code(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. handle_new_user: solo el proveedor exactamente 'twitch' cuenta como Twitch
--    Igual que 0047; cambia que otros proveedores (google, etc.) ya no guardan su 'sub' como id de Twitch
--    ni nacen 'active' por la entrada abierta.
-- -----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_meta      jsonb   := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_provider  text    := coalesce(new.raw_app_meta_data ->> 'provider', '');
  v_twitch_id text    := coalesce(v_meta ->> 'provider_id', v_meta ->> 'sub');
  v_by_email  boolean;
  v_status    text    := 'pending';
  v_plan      text    := null;
begin
  v_by_email := v_provider = 'email'
                or (v_provider = '' and (v_twitch_id is null or v_twitch_id = new.id::text));

  if v_by_email then
    insert into public.profiles (id, display_name, media_folder)
    values (new.id, nullif(split_part(coalesce(new.email, ''), '@', 1), ''), new.id::text)
    on conflict (id) do nothing;
    return new;
  end if;

  -- Solo Twitch aporta un id de Twitch: el 'sub' de otro proveedor no lo es.
  if v_provider <> 'twitch' then
    v_twitch_id := null;
  end if;

  if v_twitch_id = new.id::text then
    v_twitch_id := null;
  end if;

  if v_twitch_id is not null
     and exists (select 1 from public.profiles p where p.twitch_user_id = v_twitch_id) then
    v_twitch_id := null;
  end if;

  -- Entrada abierta: solo con identidad de Twitch y si hay plan por defecto.
  if v_twitch_id is not null and not public.invites_required() then
    select pl.id into v_plan from public.plans pl where pl.is_default limit 1;
    if v_plan is not null then
      v_status := 'active';
    end if;
  end if;

  insert into public.profiles (id, twitch_user_id, twitch_login, display_name, avatar_url, media_folder, status, plan_id)
  values (
    new.id,
    v_twitch_id,
    coalesce(v_meta ->> 'name', v_meta ->> 'full_name'),
    coalesce(v_meta ->> 'nickname', v_meta ->> 'slug', v_meta ->> 'name'),
    coalesce(v_meta ->> 'avatar_url', v_meta ->> 'picture'),
    new.id::text,
    v_status,
    case when v_status = 'active' then v_plan else null end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
