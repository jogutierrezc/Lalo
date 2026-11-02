-- =============================================================================
-- 0051_qg_fixes.sql
--
-- Correcciones de la revisión de calidad (quality gate) del cobro con PayPal.
--
--   1. Una sola suscripción «viva» por perfil: índice único parcial en billing_subscriptions (profile_id) donde
--      status in ('pending', 'active', 'grace', 'suspended'). Cierra la carrera de dos «subscribe» a la vez.
--      ANTES de crearlo se limpian los duplicados que ya existan (ver el caso documentado abajo).
--   2. billing_refunds: un reembolso por refund_id. billing_reverse_sale() suma lo reembolsado SOLO si el refund_id es
--      nuevo, así que el mismo reembolso parcial reenviado (otro event.id) no se acumula hasta parecer total.
--      El reembolso total exige además moneda USD en la venta. La firma cambia (p_refund_id): se retira la anterior.
--   3. billing_code_access(): accesos por código del panel de administración, con NOT EXISTS (quien paga queda fuera)
--      ANTES de limitar. Antes se limitaba y luego se filtraba: 200 suscriptores de pago tapaban todo lo demás.
--   4. Backfill de billing_sales para los pagos anteriores a 0050 (sale_id 'legacy-<id de la suscripción>').
--
-- Las funciones billing_* son security definer con search_path = '' y SOLO las ejecuta service_role.
-- billing_refunds tiene RLS activada y ninguna política: solo la clave de servicio la toca.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0050. Se puede volver a ejecutar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Una suscripción viva por perfil
-- -----------------------------------------------------------------------------

-- Caso documentado: si un perfil ya tiene varias suscripciones vivas, se conserva UNA y las demás pending
-- pasan a 'cancelled'. Se conserva primero la que no es pending y, entre iguales, la más reciente.
-- Las pending canceladas aquí pueden seguir existiendo en PayPal sin aprobar; un pago que aún llegara por una
-- cancelled se acredita igual (el webhook no depende de ese estado).
with live as (
  select s.id,
         s.status,
         row_number() over (
           partition by s.profile_id
           order by (s.status = 'pending') asc, s.created_at desc, s.id desc
         ) as rn
  from public.billing_subscriptions s
  where s.status in ('pending', 'active', 'grace', 'suspended')
)
update public.billing_subscriptions b
   set status = 'cancelled', updated_at = now()
  from live l
 where b.id = l.id
   and l.rn > 1
   and l.status = 'pending';

-- Si aún quedan dos vivas que NO son pending (p. ej. dos activas), no se decide a ciegas: se detiene la migración
-- para que una persona revise y cancele una de las dos (en PayPal y aquí) antes de volver a ejecutarla.
do $$
begin
  if exists (
    select 1
    from public.billing_subscriptions s
    where s.status in ('pending', 'active', 'grace', 'suspended')
    group by s.profile_id
    having count(*) > 1
  ) then
    raise exception '0051: hay perfiles con más de una suscripción viva que no son pending; revisa y cancela una antes de aplicar esta migración';
  end if;
end;
$$;

create unique index if not exists billing_subscriptions_one_live
  on public.billing_subscriptions (profile_id)
  where status in ('pending', 'active', 'grace', 'suspended');

-- -----------------------------------------------------------------------------
-- 2. Reembolsos idempotentes
-- -----------------------------------------------------------------------------

create table if not exists public.billing_refunds (
  refund_id   text primary key,
  sale_id     text not null references public.billing_sales (sale_id) on delete cascade,
  amount      numeric not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists billing_refunds_sale on public.billing_refunds (sale_id);

alter table public.billing_refunds enable row level security;
revoke all on public.billing_refunds from anon, authenticated;
-- Sin políticas: solo el servidor (clave de servicio, que ignora RLS).

-- La firma de 0050 (4 argumentos) se retira: si quedara, un servidor viejo podría seguir acumulando sin refund_id.
drop function if exists public.billing_reverse_sale(text, numeric, boolean, timestamptz);

-- Devuelve: applied | partial (reembolso parcial: solo se registra) | duplicate (ya se había quitado ese periodo)
--           | unknown_sale (la venta no está registrada: el servidor decide si reintentar o descartar).
-- p_refund_id: resource.id del REFUNDED. En un reverso/contracargo el servidor manda el id de la venta (no suma).
-- Reembolso total (lo reembolsado acumulado alcanza el importe Y la venta es en USD) o reverso/contracargo:
--   resta months_credited de paid_until, nunca por debajo de ahora, y actualiza profiles.plan_expires_at si el perfil
--   tenía justo ese vencimiento. En un reverso la suscripción pasa a 'suspended' (salvo cancelled/expired, o si el
--   evento es más viejo que el último aplicado: entonces ni se suspende ni se mueve last_event_time).
-- Un reembolso sin importe conocido o en otra moneda no se toma por total.
create or replace function public.billing_reverse_sale(
  p_sale_id     text,
  p_refund_id   text,
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
  v_rows     int;
begin
  if p_refund_id is null or length(trim(p_refund_id)) = 0 or length(p_refund_id) > 100 then
    raise exception 'invalid_refund';
  end if;

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
    -- Solo un refund_id nuevo suma: el mismo reembolso reenviado con otro event.id no se acumula
    insert into public.billing_refunds (refund_id, sale_id, amount)
    values (p_refund_id, v_sale.sale_id, greatest(coalesce(p_amount, 0), 0))
    on conflict (refund_id) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then
      v_refunded := v_refunded + greatest(coalesce(p_amount, 0), 0);
      update public.billing_sales set refunded_amount = v_refunded where sale_id = v_sale.sale_id;
    end if;
  end if;

  v_full := coalesce(p_reversal, false)
            or (upper(coalesce(v_sale.currency, '')) = 'USD'
                and v_sale.amount is not null and v_sale.amount > 0 and v_refunded >= v_sale.amount);
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

revoke all on function public.billing_reverse_sale(text, text, numeric, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.billing_reverse_sale(text, text, numeric, boolean, timestamptz) to service_role;

-- -----------------------------------------------------------------------------
-- 3. Accesos por código (panel de administración)
-- -----------------------------------------------------------------------------

-- Perfiles con plan por código vigente: plan_expires_at futuro y sin suscripción de pago con acceso
-- (alineado con isCodeAccess de server/paypal/logic.ts). La exclusión va en la consulta, antes del tope.
create or replace function public.billing_code_access(
  p_now    timestamptz,
  p_limit  int default 200
)
returns table (
  profile_id       uuid,
  twitch_login     text,
  display_name     text,
  plan_id          text,
  plan_name        text,
  plan_expires_at  timestamptz,
  invite_code      text
)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.twitch_login, p.display_name, p.plan_id, pl.name, p.plan_expires_at, ic.code
  from public.profiles p
  left join public.plans pl on pl.id = p.plan_id
  left join public.invite_codes ic on ic.id = p.invite_code_id
  where p.plan_expires_at > p_now
    and not exists (
      select 1 from public.billing_subscriptions s
      where s.profile_id = p.id
        and s.status in ('active', 'grace', 'cancelled', 'suspended')
        and s.paid_until > p_now
    )
  order by p.plan_expires_at asc, p.id asc
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
$$;

revoke all on function public.billing_code_access(timestamptz, int) from public, anon, authenticated;
grant execute on function public.billing_code_access(timestamptz, int) to service_role;

-- -----------------------------------------------------------------------------
-- 4. Backfill de ventas anteriores a 0050
-- -----------------------------------------------------------------------------

-- Los pagos acreditados antes de 0050 no tienen fila en billing_sales. Se crea una venta sintética por suscripción
-- con pago (months_credited = months) para que un reverso localizado por la suscripción pueda restar un periodo.
-- Ojo: el sale_id real de PayPal de esos pagos no se conoce, así que un aviso con el id real seguirá sin
-- encontrarse; el servidor lo da por hecho pasadas 72 h en vez de reintentar para siempre. Importe y moneda quedan
-- sin conocer (null): un reembolso nunca se toma por total sobre estas filas.
insert into public.billing_sales (sale_id, subscription_id, months_credited)
select 'legacy-' || s.id::text, s.id, s.months
from public.billing_subscriptions s
where s.last_payment_at is not null
  and not exists (select 1 from public.billing_sales x where x.subscription_id = s.id)
on conflict (sale_id) do nothing;
