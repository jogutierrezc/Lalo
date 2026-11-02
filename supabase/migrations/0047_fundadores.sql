-- =============================================================================
-- 0047_fundadores.sql
--
-- Creadores fundadores de Tally Studio (antes Lalo Stream Suite) y su bienvenida.
--
--   profiles.founder_number          número de Creador Fundador (1, 2, 3...). Null = no es fundador.
--   profiles.welcome_seen_at         cuándo vio la bienvenida de la app. Null = aún no la ha visto.
--   profiles.founder_gift_claimed_at cuándo activó el regalo del plan Creadores Iniciales.
--   founder_settings                 una sola fila: plan y meses del regalo (los edita el administrador).
--   plans 'creadores-iniciales'      el plan del regalo, creado con los límites del plan por defecto.
--
--   mark_welcome_seen()              la llama el propio streamer al cerrar la bienvenida.
--   founder_gift_config()            plan y meses del regalo, para enseñarlos en la bienvenida.
--   claim_founder_gift()             el fundador activa su regalo: plan temporal de N meses.
--   admin_set_founder_gift()         el administrador cambia el plan y los meses del regalo.
--
-- El regalo reutiliza el plan temporal de 0046: pone profiles.plan_id y
-- profiles.plan_expires_at, y billing_expire_due() devuelve a la cuenta al plan
-- por defecto cuando vence. No toca billing_subscriptions ni PayPal.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0046.
-- Se puede volver a ejecutar: no renumera fundadores ya numerados.
--
-- Mientras no se aplique, la app sigue funcionando: sin las columnas nadie es
-- fundador, la bienvenida de cuenta nueva se recuerda solo en el navegador y el
-- botón del regalo queda en «Pendiente de activar por el administrador».
--
-- ---- REVISAR ANTES DE APLICAR ------------------------------------------------
--  1. CORTE (v_corte, más abajo): son fundadoras las cuentas de streamer creadas
--     ANTES de esa fecha y que ya no están «pendientes» de código. Ajusta la fecha
--     al día del despliegue. Las cuentas nuevas posteriores no son fundadoras.
--  2. Numeración: por orden de created_at (empates por id). Se hace una sola vez,
--     cuando ningún perfil tiene número todavía.
--  3. El plan 'creadores-iniciales' nace con los MISMOS límites de almacenamiento
--     que el plan por defecto. Si debe tener más, edítalo en Límites. Qué voces o
--     TTS incluye NO lo decide este plan (hoy las voces dependen de la cuenta, p. ej.
--     profiles.elevenlabs_enabled): confirma si el regalo debe activarlo también.
--  4. Quien ya tiene un plan distinto del por defecto, o un plan de pago vigente,
--     NO recibe el regalo (claim_founder_gift devuelve 'has_plan' y no lo marca
--     como reclamado, así que podrá pedirlo si vuelve al plan por defecto).
--  5. welcome_seen_at queda null en TODAS las cuentas existentes a propósito: es
--     lo que hace que cada fundador vea la bienvenida una vez tras el despliegue.
-- -----------------------------------------------------------------------------
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columnas
-- -----------------------------------------------------------------------------

alter table public.profiles add column if not exists founder_number          int;
alter table public.profiles add column if not exists welcome_seen_at         timestamptz;
alter table public.profiles add column if not exists founder_gift_claimed_at timestamptz;

create unique index if not exists profiles_founder_number_key
  on public.profiles (founder_number) where founder_number is not null;

-- -----------------------------------------------------------------------------
-- 2. Plan y ajuste del regalo
-- -----------------------------------------------------------------------------

-- El plan del regalo: mismos límites que el plan por defecto. No se pisa si ya existe.
insert into public.plans (id, name, storage_limit_bytes, max_file_bytes, max_files, is_default)
select 'creadores-iniciales', 'Creadores Iniciales',
       d.storage_limit_bytes, d.max_file_bytes, d.max_files, false
  from public.plans d
 where d.is_default
on conflict (id) do nothing;

create table if not exists public.founder_settings (
  id          boolean primary key default true check (id),   -- una sola fila
  gift_plan   text not null default 'creadores-iniciales' references public.plans (id),
  gift_months int  not null default 1 check (gift_months between 1 and 12),
  updated_at  timestamptz not null default now()
);

insert into public.founder_settings (id) values (true) on conflict (id) do nothing;

alter table public.founder_settings enable row level security;
revoke all on public.founder_settings from anon;
revoke insert, update, delete on public.founder_settings from authenticated;

-- Cualquier cuenta con sesión lee el ajuste; solo el administrador lo cambia (por RPC).
drop policy if exists founder_settings_select on public.founder_settings;
create policy founder_settings_select on public.founder_settings
  for select to authenticated using (true);

-- -----------------------------------------------------------------------------
-- 3. Marcar a los fundadores actuales (una sola vez)
-- -----------------------------------------------------------------------------

do $$
declare
  -- CORTE: cuentas creadas antes de esta fecha son fundadoras. REVISAR antes de aplicar.
  v_corte timestamptz := timestamptz '2026-11-30 00:00:00+00';
begin
  if not exists (select 1 from public.profiles p where p.founder_number is not null) then
    update public.profiles p
       set founder_number = n.num
      from (
        select id, (row_number() over (order by created_at, id))::int as num
          from public.profiles
         where role = 'streamer'
           and status <> 'pending'
           and created_at < v_corte
      ) n
     where p.id = n.id;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Funciones
-- -----------------------------------------------------------------------------

-- El streamer marca que ya vio la bienvenida. Solo su perfil; no pisa la fecha.
create or replace function public.mark_welcome_seen()
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_at  timestamptz;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  update public.profiles
     set welcome_seen_at = coalesce(welcome_seen_at, now())
   where id = v_uid
  returning welcome_seen_at into v_at;
  return v_at;
end;
$$;

revoke execute on function public.mark_welcome_seen() from public, anon, authenticated;
grant execute on function public.mark_welcome_seen() to authenticated;

-- Plan y meses del regalo, con el nombre del plan, para enseñarlos en la bienvenida.
create or replace function public.founder_gift_config()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_row public.founder_settings%rowtype;
  v_name text;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_row from public.founder_settings where id;
  select name into v_name from public.plans where id = v_row.gift_plan;
  return jsonb_build_object(
    'plan_id', v_row.gift_plan,
    'plan_name', coalesce(v_name, v_row.gift_plan),
    'months', v_row.gift_months
  );
end;
$$;

revoke execute on function public.founder_gift_config() from public, anon, authenticated;
grant execute on function public.founder_gift_config() to authenticated;

-- El fundador activa su regalo. Idempotente y una sola vez por cuenta.
-- Devuelve: 'ok' | 'already_claimed' | 'not_founder' | 'has_plan' | 'not_active'
create or replace function public.claim_founder_gift()
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_p       public.profiles%rowtype;
  v_set     public.founder_settings%rowtype;
  v_default text;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_p from public.profiles where id = v_uid for update;
  if not found or v_p.status <> 'active' then
    return 'not_active';
  end if;
  if v_p.founder_number is null then
    return 'not_founder';
  end if;
  if v_p.founder_gift_claimed_at is not null then
    return 'already_claimed';
  end if;

  select pl.id into v_default from public.plans pl where pl.is_default limit 1;

  -- No se pisa un plan de pago vigente ni un plan asignado distinto del por defecto
  if (v_p.plan_expires_at is not null and v_p.plan_expires_at > now())
     or (v_p.plan_id is not null and v_p.plan_id is distinct from v_default) then
    return 'has_plan';
  end if;

  select * into v_set from public.founder_settings where id;

  update public.profiles
     set plan_id = v_set.gift_plan,
         plan_expires_at = now() + make_interval(months => v_set.gift_months),
         founder_gift_claimed_at = now()
   where id = v_uid;

  return 'ok';
end;
$$;

revoke execute on function public.claim_founder_gift() from public, anon, authenticated;
grant execute on function public.claim_founder_gift() to authenticated;

-- El administrador cambia el plan y los meses del regalo.
create or replace function public.admin_set_founder_gift(p_plan text, p_months int)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  if p_months is null or p_months < 1 or p_months > 12 then
    raise exception 'invalid_months';
  end if;
  if not exists (select 1 from public.plans where id = p_plan) then
    raise exception 'unknown_plan';
  end if;
  update public.founder_settings
     set gift_plan = p_plan, gift_months = p_months, updated_at = now()
   where id;
  return jsonb_build_object('plan_id', p_plan, 'months', p_months);
end;
$$;

revoke execute on function public.admin_set_founder_gift(text, int) from public, anon, authenticated;
grant execute on function public.admin_set_founder_gift(text, int) to authenticated;
