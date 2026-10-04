-- ============================================================================
-- 0013_integrations.sql
--
-- Integraciones: Spotify («Ahora suena») y Ko-fi.
--
-- SIN PROBAR: escrita leyendo 0001, 0007, 0010 y 0012; no se ha ejecutado contra
-- una base real. Conviene aplicarla primero en un proyecto de pruebas. Necesita
-- que 0012 (canal de eventos) ya esté aplicada.
--
-- Qué añade:
--   1. Los módulos «music» y «kofi» en la configuración sincronizada.
--   2. integration_accounts: lo que el servidor guarda de cada streamer para
--      una integración. Es la primera tabla con permisos de cuentas ajenas, así
--      que solo la toca la clave de servicio: tiene RLS encendido y ninguna
--      política. El navegador no puede leerla ni escribirla.
--        - Spotify: el permiso de renovación, cifrado por el servidor
--          (AES-256-GCM con INTEGRATIONS_ENC_KEY), y el nombre visible de la cuenta.
--        - Ko-fi: la clave de verificación cifrada, la dirección personal del
--          webhook (su huella para buscarla y, cifrada, la dirección para
--          enseñársela a su dueño), lo recaudado de la meta y los últimos apoyos.
--   3. El canal de eventos de 0012 admite el origen «kofi».
--   4. ingest_kofi_event: guarda un aviso de Ko-fi una sola vez, suma a la meta
--      y apunta el apoyo en la lista corta. Solo clave de servicio.
--   5. widget_kofi_state: la capa de OBS lee lo recaudado y los últimos apoyos
--      con su clave privada de widget.
--   6. push_test_twitch_event admite pruebas de tipo «kofi» desde el panel.
--
-- Datos personales: de cada aviso de Ko-fi se guarda el nombre visible (o
-- «Alguien» si el apoyo es privado), el mensaje (vacío si es privado), la
-- cantidad, la moneda y el nivel. Nunca el correo ni la dirección de envío. Los
-- eventos se borran solos a los quince minutos (0012). En la lista corta quedan
-- el nombre, la cantidad y el tipo de los cinco últimos apoyos, sin mensaje.
-- Al desconectar se borra la fila entera.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Módulos «music» y «kofi» en la configuración sincronizada (igual que 0012)
-- ---------------------------------------------------------------------------

do $$
declare
  v_name text;
begin
  for v_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.configs'::regclass
      and con.contype = 'c'
      and con.conname <> 'configs_data_size'
      and pg_get_constraintdef(con.oid) ilike '%module%'
  loop
    execute format('alter table public.configs drop constraint %I', v_name);
  end loop;
end
$$;

alter table public.configs
  add constraint configs_module_check check (module in
    ('tts', 'alerts', 'goals', 'roulette', 'polls', 'rewards', 'bot', 'marathon', 'focus', 'raid', 'chat', 'studio',
     'powerups', 'music', 'kofi'));

-- ---------------------------------------------------------------------------
-- 2. Cuentas conectadas (solo clave de servicio)
-- ---------------------------------------------------------------------------

create table if not exists public.integration_accounts (
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  provider      text not null check (provider in ('spotify', 'kofi')),
  -- Cifrado por el servidor: permiso de renovación de Spotify o clave de verificación de Ko-fi
  secret_enc    text check (secret_enc is null or char_length(secret_enc) <= 4000),
  -- Ko-fi: huella SHA-256 de la dirección personal del webhook, y la dirección cifrada
  hook_hash     text unique check (hook_hash is null or char_length(hook_hash) = 64),
  hook_enc      text check (hook_enc is null or char_length(hook_enc) <= 400),
  -- Spotify: nombre visible de la cuenta, para «Conectado como»
  account_name  text check (account_name is null or char_length(account_name) <= 80),
  status        text not null default 'connected' check (status in ('connected', 'expired')),
  connected_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Ko-fi: cuándo llegó el último aviso válido, y el último problema (clave que no coincide)
  last_event_at timestamptz,
  last_error    text check (last_error is null or char_length(last_error) <= 40),
  last_error_at timestamptz,
  -- Ko-fi: lo recaudado para la meta (en la moneda de la meta) y los últimos apoyos
  goal_raised   numeric(12, 2) not null default 0 check (goal_raised >= 0),
  recent        jsonb not null default '[]'::jsonb check (octet_length(recent::text) <= 2000),
  primary key (profile_id, provider)
);

-- Nadie lee ni escribe la tabla por la API: solo el servidor con la clave de servicio.
alter table public.integration_accounts enable row level security;
revoke all on public.integration_accounts from public, anon, authenticated;
grant select, insert, update, delete on public.integration_accounts to service_role;

-- ---------------------------------------------------------------------------
-- 3. El canal de eventos admite el origen «kofi»
-- ---------------------------------------------------------------------------

do $$
declare
  v_name text;
begin
  for v_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.twitch_events'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%kind%'
  loop
    execute format('alter table public.twitch_events drop constraint %I', v_name);
  end loop;
end
$$;

alter table public.twitch_events
  add constraint twitch_events_kind_check check (kind in ('bits', 'powerup', 'points', 'kofi'));

-- ---------------------------------------------------------------------------
-- 4. Entrada de avisos de Ko-fi (solo clave de servicio)
-- ---------------------------------------------------------------------------

-- El servidor ya comprobó la clave de verificación y redujo el aviso a lo mínimo.
-- p_goal_add es lo que suma a la meta (0 si el tipo no suma o la moneda es otra).
-- p_recent es la entrada para «últimos apoyos»; un objeto vacío no se apunta.
-- Devuelve 'ok' o 'duplicate' (Ko-fi reintenta con el mismo message_id).
create or replace function public.ingest_kofi_event(
  p_profile    uuid,
  p_message_id text,
  p_payload    jsonb,
  p_goal_add   numeric default 0,
  p_recent     jsonb default null
)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_event  bigint;
  v_raised numeric;
begin
  if p_profile is null or p_message_id is null or p_payload is null
     or char_length(p_message_id) not between 1 and 100
     or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'bad_event';
  end if;

  if not exists (select 1 from public.profiles p where p.id = p_profile and p.status = 'active') then
    return 'ok';
  end if;

  delete from public.twitch_events e where e.created_at < now() - interval '15 minutes';

  -- El id lleva el perfil delante: dos streamers no pueden pisarse un aviso
  insert into public.twitch_events (profile_id, message_id, kind, payload)
  values (p_profile, 'kofi-' || p_profile::text || '-' || p_message_id, 'kofi', p_payload - 'raised')
  on conflict (message_id) do nothing
  returning id into v_event;
  if v_event is null then
    return 'duplicate';
  end if;

  update public.integration_accounts a
  set last_event_at = now(),
      last_error    = null,
      last_error_at = null,
      updated_at    = now(),
      goal_raised   = a.goal_raised + greatest(coalesce(p_goal_add, 0), 0),
      recent        = case
        when p_recent is null or jsonb_typeof(p_recent) <> 'object' or not (p_recent ? 'name') then a.recent
        else (
          select coalesce(jsonb_agg(t.item order by t.ord), '[]'::jsonb)
          from jsonb_array_elements(jsonb_build_array(p_recent) || a.recent) with ordinality as t(item, ord)
          where t.ord <= 5
        )
      end
  where a.profile_id = p_profile and a.provider = 'kofi'
  returning a.goal_raised into v_raised;

  -- El evento lleva el total nuevo: la capa de OBS pone ese número, no suma por
  -- su cuenta, así que no puede contar dos veces
  if v_raised is not null then
    update public.twitch_events e
    set payload = e.payload || jsonb_build_object('raised', v_raised)
    where e.id = v_event;
  end if;

  return 'ok';
end;
$$;

revoke all on function public.ingest_kofi_event(uuid, text, jsonb, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_kofi_event(uuid, text, jsonb, numeric, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Lectura desde la capa de OBS (clave privada de widget, sin sesión)
-- ---------------------------------------------------------------------------

-- Lo recaudado y los últimos apoyos. null si la clave no existe, la cuenta no
-- está activa o no tiene Ko-fi conectado. No devuelve ninguna clave ni dirección.
create or replace function public.widget_kofi_state(p_key text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_profile uuid;
begin
  if p_key is null or char_length(p_key) < 32 then
    return null;
  end if;

  select p.id into v_profile
  from public.profiles p
  where p.widget_key = p_key and p.status = 'active';
  if not found then
    return null;
  end if;

  return (
    select jsonb_build_object('raised', a.goal_raised, 'recent', a.recent)
    from public.integration_accounts a
    where a.profile_id = v_profile and a.provider = 'kofi'
  );
end;
$$;

revoke all on function public.widget_kofi_state(text) from public;
grant execute on function public.widget_kofi_state(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Pruebas desde el panel: se admite el tipo «kofi»
-- ---------------------------------------------------------------------------

-- La misma función de 0012 con un tipo más. Las pruebas nunca suman a las metas.
create or replace function public.push_test_twitch_event(p_kind text, p_payload jsonb)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_profile uuid := (select auth.uid());
  v_event   bigint;
begin
  if v_profile is null or not public.is_active_user() then
    raise exception 'not_active';
  end if;
  if p_kind not in ('bits', 'powerup', 'points', 'kofi') or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'bad_event';
  end if;
  -- Como mucho veinte pruebas por minuto y cuenta
  if (select count(*) from public.twitch_events e
      where e.profile_id = v_profile and e.is_test and e.created_at > now() - interval '1 minute') >= 20 then
    raise exception 'too_many_tests';
  end if;

  delete from public.twitch_events e where e.created_at < now() - interval '15 minutes';

  insert into public.twitch_events (profile_id, message_id, kind, payload, is_test)
  values (v_profile, 'test-' || gen_random_uuid()::text, p_kind, (p_payload - 'goals' - 'raised') || '{"test": true}'::jsonb, true)
  returning id into v_event;
  return v_event;
end;
$$;

revoke all on function public.push_test_twitch_event(text, jsonb) from public, anon;
grant execute on function public.push_test_twitch_event(text, jsonb) to authenticated;
