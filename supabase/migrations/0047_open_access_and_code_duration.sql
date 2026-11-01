-- =============================================================================
-- 0047_open_access_and_code_duration.sql
--
-- Acceso sin invitación (interruptor) y códigos con duración.
--
--   1. app_settings 'invites_required' ('true' por defecto = como hasta ahora).
--        invites_required()               lectura pública (anon y authenticated) del booleano.
--        admin_set_invites_required(bool) lo cambia el administrador (queda en la bitácora).
--        handle_new_user()                con el interruptor en 'false', un usuario NUEVO con
--                                         identidad de Twitch nace 'active' con el plan por defecto.
--        claim_open_access()              lo mismo para quien YA tenía un perfil 'pending'
--                                         (creado cuando las invitaciones eran obligatorias).
--      Se sigue exigiendo Twitch: el alta por correo (el administrador) sigue 'pending' y
--      promote_admin_by_email lo activa, como en 0003.
--
--   2. invite_codes.plan_months (null, o de 1 a 36): duración del plan que da el código.
--        redeem_invite() ya no exige que el perfil esté 'pending': también lo puede canjear
--        un perfil 'active' (cuando las invitaciones están desactivadas, todos lo son) para
--        MEJORAR su plan. Si el código trae plan_months, profiles.plan_expires_at queda en
--        (la mayor entre hoy y el plan_expires_at vigente de ESE mismo plan) + plan_months meses
--        de calendario con fin de mes. billing_expire_due() (0046) ya devuelve al plan por
--        defecto cuando plan_expires_at vence: no hace falta tocarla.
--        Resultados nuevos de redeem_invite: 'has_paid_plan', 'has_plan', 'already_redeemed'.
--
--   3. check_invite() devuelve también plan_months; admin_create_invite() acepta p_plan_months.
--
-- Se cambian las firmas de check_invite (tipo de retorno) y admin_create_invite (parámetro
-- nuevo): se eliminan las versiones anteriores y se vuelven a conceder los permisos.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0046. Se puede volver a ejecutar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Interruptor de invitaciones
-- -----------------------------------------------------------------------------

insert into public.app_settings (key, value)
values ('invites_required', 'true')
on conflict (key) do nothing;

-- Lectura pública: solo el booleano, nada más de app_settings. Ante un valor ausente o
-- raro se asume 'true' (lo seguro: pedir invitación).
create or replace function public.invites_required()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select s.value from public.app_settings s where s.key = 'invites_required'), 'true') <> 'false';
$$;

create or replace function public.admin_set_invites_required(p_required boolean)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_old boolean;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  if p_required is null then
    raise exception 'invalid_value';
  end if;

  v_old := public.invites_required();

  insert into public.app_settings (key, value, updated_at)
  values ('invites_required', case when p_required then 'true' else 'false' end, now())
  on conflict (key)
  do update set value = excluded.value, updated_at = excluded.updated_at;

  if v_old is distinct from p_required then
    perform public.log_admin_action(
      null,
      'invites_required',
      case when p_required
        then 'Se volvió a exigir invitación para entrar'
        else 'Se abrió la entrada sin invitación (con Twitch)'
      end
    );
  end if;

  return p_required;
end;
$$;

-- Perfil al registrarse. Igual que en 0003; lo único nuevo es el estado inicial del camino
-- de Twitch: 'active' con el plan por defecto si las invitaciones no son obligatorias Y hay
-- un id de Twitch válido. Sin id de Twitch (o con el alta por correo) sigue 'pending'.
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

-- Para quien ya tenía un perfil 'pending' cuando se abrió la entrada (o si el disparador no
-- llegó a activarlo). Devuelve: ok | invites_required | not_pending | no_twitch.
create or replace function public.claim_open_access()
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_status text;
  v_twitch text;
  v_plan   text;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if public.invites_required() then
    return 'invites_required';
  end if;

  select p.status, p.twitch_user_id into v_status, v_twitch
  from public.profiles p where p.id = v_uid for update;
  if v_status is distinct from 'pending' then
    return 'not_pending';
  end if;
  if v_twitch is null then
    return 'no_twitch';
  end if;

  select pl.id into v_plan from public.plans pl where pl.is_default limit 1;
  if v_plan is null then
    return 'invites_required';
  end if;

  update public.profiles set status = 'active', plan_id = v_plan where id = v_uid;
  return 'ok';
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Duración del plan por código
-- -----------------------------------------------------------------------------

alter table public.invite_codes add column if not exists plan_months int;

alter table public.invite_codes drop constraint if exists invite_codes_plan_months_check;
alter table public.invite_codes add constraint invite_codes_plan_months_check
  check (plan_months is null or plan_months between 1 and 36);

-- Canjea un código. Devuelve 'ok' o el motivo:
--   not_found | revoked | expired | used_up   el código no sirve
--   not_pending      el perfil está suspendido (o no es 'pending'/'active')
--   no_twitch        la cuenta no entró con Twitch
--   has_paid_plan    tiene una suscripción de PayPal con acceso vigente: no se pisa el plan pagado
--   has_plan         tiene un plan fijo (sin vencimiento) distinto del plan por defecto: no se degrada
--   already_redeemed ya canjeó este mismo código
-- Un rechazo NO gasta el código.
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

  -- Convivencia con el cobro: el plan pagado manda.
  if exists (
    select 1 from public.billing_subscriptions s
    where s.profile_id = v_uid
      and s.status in ('active', 'grace')
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

  -- Un perfil activo con plan fijo (asignado por el administrador o por un código sin
  -- duración) no se degrada ni se convierte en temporal. Los pendientes no tienen plan.
  if v_status = 'active' then
    select pl.id into v_default from public.plans pl where pl.is_default limit 1;
    if v_plan is not null and v_exp is null and v_plan is distinct from v_default then
      return 'has_plan';
    end if;
  end if;

  if v_code.plan_months is not null then
    -- Suma desde hoy, o desde el vencimiento vigente si es del MISMO plan. El interval de
    -- meses de Postgres respeta el fin de mes (31 ene + 1 mes = 28/29 feb).
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

-- -----------------------------------------------------------------------------
-- 3. check_invite y admin_create_invite con plan_months
-- -----------------------------------------------------------------------------

drop function if exists public.check_invite(text);

create or replace function public.check_invite(p_code text)
returns table (status text, plan_name text, plan_months int)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_code public.invite_codes%rowtype;
begin
  select * into v_code from public.invite_codes c where c.code = upper(trim(p_code));

  if not found then
    return query select 'not_found'::text, null::text, null::int;
  elsif v_code.revoked_at is not null then
    return query select 'revoked'::text, null::text, null::int;
  elsif v_code.expires_at is not null and v_code.expires_at <= now() then
    return query select 'expired'::text, null::text, null::int;
  elsif v_code.used_count >= v_code.max_uses then
    return query select 'used_up'::text, null::text, null::int;
  else
    return query select 'valid'::text,
                        (select pl.name from public.plans pl where pl.id = v_code.plan_id),
                        v_code.plan_months;
  end if;
end;
$$;

drop function if exists public.admin_create_invite(text, int, timestamptz, text);

create or replace function public.admin_create_invite(
  p_plan        text default null,
  p_max_uses    int default 1,
  p_expires_at  timestamptz default null,
  p_note        text default null,
  p_plan_months int default null
)
returns public.invite_codes
language plpgsql security definer set search_path = ''
as $$
declare
  v_plan text := p_plan;
  v_row  public.invite_codes;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  if p_plan_months is not null and p_plan_months not between 1 and 36 then
    raise exception 'invalid_plan_months';
  end if;
  if v_plan is null then
    select pl.id into v_plan from public.plans pl where pl.is_default limit 1;
  end if;
  if v_plan is null or not exists (select 1 from public.plans pl where pl.id = v_plan) then
    raise exception 'plan_not_found';
  end if;

  insert into public.invite_codes (code, plan_id, max_uses, expires_at, note, created_by, plan_months)
  values (
    'LALO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
    v_plan, greatest(coalesce(p_max_uses, 1), 1), p_expires_at, p_note, (select auth.uid()), p_plan_months
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Permisos de ejecución (mismo patrón que 0001 y 0019)
-- -----------------------------------------------------------------------------

revoke execute on function
  public.invites_required(),
  public.admin_set_invites_required(boolean),
  public.claim_open_access(),
  public.redeem_invite(text),
  public.check_invite(text),
  public.admin_create_invite(text, int, timestamptz, text, int)
from public, anon, authenticated;

-- El flujo de entrada necesita leer el interruptor y validar un código sin sesión.
grant execute on function
  public.invites_required(),
  public.check_invite(text)
to anon, authenticated;

grant execute on function
  public.admin_set_invites_required(boolean),
  public.claim_open_access(),
  public.redeem_invite(text),
  public.admin_create_invite(text, int, timestamptz, text, int)
to authenticated;
