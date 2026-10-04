-- ============================================================================
-- 0012_twitch_events.sql
--
-- Canal de eventos de Twitch hasta OBS y módulo «powerups».
--
-- SIN PROBAR: escrita leyendo 0001, 0002, 0007 y 0010; no se ha ejecutado contra
-- una base real. Conviene aplicarla primero en un proyecto de pruebas.
--
-- Cómo viaja un evento:
--   1. Twitch avisa a /api/twitch/eventsub (bits, Power-ups, canjes de puntos).
--   2. El servidor comprueba la firma y llama a ingest_twitch_event con la clave
--      de servicio. La función busca al streamer dueño de ese canal, guarda el
--      evento una sola vez (el id del mensaje de Twitch es único) y, si son
--      Bits, los suma a sus metas de bits.
--   3. La capa de OBS, que no inicia sesión, pregunta cada pocos segundos por
--      los eventos nuevos con widget_events y su clave privada de widget. Solo
--      recibe los de su streamer.
--
-- Por qué una tabla con consulta periódica y no Realtime: la capa de OBS ya lee
-- todo con su clave privada a través de funciones; así no hay ningún canal al
-- que alguien pueda unirse adivinando un nombre, un evento no se pierde si la
-- fuente se desconecta unos segundos y no se gastan conexiones simultáneas del
-- plan gratuito (una por fuente de navegador). La consulta es mínima y la capa
-- solo la hace cuando el streamer tiene encendido el canal de eventos.
--
-- Datos personales: de cada evento se guarda el nombre visible y el usuario del
-- espectador, el texto que escribió y las cantidades. Ningún id de espectador.
-- Los eventos se borran solos a los quince minutos.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Módulo «powerups» en la configuración sincronizada (igual que 0007 y 0010)
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
     'powerups'));

-- ---------------------------------------------------------------------------
-- 2. Tabla de eventos (vida corta)
-- ---------------------------------------------------------------------------

create table if not exists public.twitch_events (
  id         bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  -- Id del mensaje de Twitch (o 'test-...' en las pruebas del panel): evita guardar dos veces el mismo
  message_id text not null unique check (char_length(message_id) between 1 and 200),
  kind       text not null check (kind in ('bits', 'powerup', 'points')),
  payload    jsonb not null check (octet_length(payload::text) <= 4000),
  is_test    boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists twitch_events_profile_idx on public.twitch_events (profile_id, id);
create index if not exists twitch_events_created_idx on public.twitch_events (created_at);

-- Nadie lee ni escribe la tabla por la API: solo las funciones de abajo.
alter table public.twitch_events enable row level security;
revoke all on public.twitch_events from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Entrada desde el servidor (solo clave de servicio)
-- ---------------------------------------------------------------------------

-- Devuelve 'ok', 'duplicate' (mensaje ya guardado) o 'unknown_channel' (ningún
-- streamer activo tiene ese canal de Twitch).
create or replace function public.ingest_twitch_event(
  p_message_id     text,
  p_twitch_user_id text,
  p_kind           text,
  p_payload        jsonb,
  p_bits           integer default 0
)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_profile uuid;
  v_event   bigint;
  v_goals   jsonb;
begin
  if p_message_id is null or p_twitch_user_id is null or p_payload is null
     or p_kind not in ('bits', 'powerup', 'points') then
    raise exception 'bad_event';
  end if;

  select p.id into v_profile
  from public.profiles p
  where p.twitch_user_id = p_twitch_user_id and p.status = 'active';
  if not found then
    return 'unknown_channel';
  end if;

  -- Limpieza: lo que tiene más de quince minutos ya no le sirve a nadie
  delete from public.twitch_events e where e.created_at < now() - interval '15 minutes';

  insert into public.twitch_events (profile_id, message_id, kind, payload)
  values (v_profile, p_message_id, p_kind, p_payload)
  on conflict (message_id) do nothing
  returning id into v_event;
  if v_event is null then
    return 'duplicate';
  end if;

  -- Bits a las metas: cada meta de tipo bits, encendida y sin el interruptor
  -- «contar los Bits de Twitch» apagado (countBits = false), suma la cantidad.
  -- Se hace aquí, una sola vez por mensaje, para que no dependa de qué fuentes
  -- de OBS estén abiertas.
  if p_kind = 'bits' and coalesce(p_bits, 0) > 0 then
    update public.configs c
    set data = jsonb_set(c.data, '{goals}', (
      select coalesce(jsonb_agg(
        case
          when g ->> 'type' = 'bits'
               and g -> 'enabled' is distinct from 'false'::jsonb
               and g -> 'countBits' is distinct from 'false'::jsonb
          then jsonb_set(g, '{current}', to_jsonb(
                 (case when jsonb_typeof(g -> 'current') = 'number' then (g ->> 'current')::numeric else 0 end)
                 + p_bits))
          else g
        end
        order by ord), '[]'::jsonb)
      from jsonb_array_elements(c.data -> 'goals') with ordinality as t(g, ord)
    ))
    where c.profile_id = v_profile
      and c.module = 'goals'
      and jsonb_typeof(c.data -> 'goals') = 'array';

    -- El evento lleva el total nuevo de cada meta: la capa de OBS pone ese
    -- número, no suma por su cuenta, así que no puede contar dos veces
    select jsonb_agg(jsonb_build_object('id', g ->> 'id', 'current', g -> 'current'))
      into v_goals
    from public.configs c, jsonb_array_elements(c.data -> 'goals') as g
    where c.profile_id = v_profile
      and c.module = 'goals'
      and jsonb_typeof(c.data -> 'goals') = 'array'
      and g ->> 'type' = 'bits'
      and g -> 'enabled' is distinct from 'false'::jsonb
      and g -> 'countBits' is distinct from 'false'::jsonb;

    if v_goals is not null then
      update public.twitch_events e
      set payload = e.payload || jsonb_build_object('goals', v_goals)
      where e.id = v_event;
    end if;
  end if;

  return 'ok';
end;
$$;

revoke all on function public.ingest_twitch_event(text, text, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.ingest_twitch_event(text, text, text, jsonb, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Lectura desde la capa de OBS (clave privada de widget, sin sesión)
-- ---------------------------------------------------------------------------

-- p_after es el último id que la capa ya tiene. La primera vez se pasa null y
-- solo se devuelve desde dónde empezar: una fuente recién abierta no repite
-- eventos anteriores. Devuelve null si la clave no existe o la cuenta no está activa.
create or replace function public.widget_events(p_key text, p_after bigint default null)
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

  if p_after is null then
    return jsonb_build_object(
      'cursor', coalesce((select max(e.id) from public.twitch_events e where e.profile_id = v_profile), 0),
      'events', '[]'::jsonb);
  end if;

  return (
    with fresh as (
      select e.id, e.kind, e.payload, e.is_test, e.created_at
      from public.twitch_events e
      where e.profile_id = v_profile
        and e.id > p_after
        -- Lo que tiene más de dos minutos llega tarde para salir en pantalla
        and e.created_at > now() - interval '2 minutes'
      order by e.id
      limit 20
    )
    select jsonb_build_object(
      'cursor', coalesce((select max(f.id) from fresh f), p_after),
      'events', coalesce(
        (select jsonb_agg(jsonb_build_object(
                  'id', f.id, 'kind', f.kind, 'payload', f.payload, 'test', f.is_test, 'at', f.created_at)
                order by f.id)
           from fresh f),
        '[]'::jsonb))
  );
end;
$$;

revoke all on function public.widget_events(text, bigint) from public;
grant execute on function public.widget_events(text, bigint) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Pruebas desde el panel (sesión del streamer)
-- ---------------------------------------------------------------------------

-- Guarda un evento de prueba para las capas de OBS de quien llama. Recorre el
-- mismo camino de entrega que uno real, pero nunca suma a las metas.
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
  if p_kind not in ('bits', 'powerup', 'points') or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'bad_event';
  end if;
  -- Como mucho veinte pruebas por minuto y cuenta
  if (select count(*) from public.twitch_events e
      where e.profile_id = v_profile and e.is_test and e.created_at > now() - interval '1 minute') >= 20 then
    raise exception 'too_many_tests';
  end if;

  delete from public.twitch_events e where e.created_at < now() - interval '15 minutes';

  insert into public.twitch_events (profile_id, message_id, kind, payload, is_test)
  values (v_profile, 'test-' || gen_random_uuid()::text, p_kind, (p_payload - 'goals') || '{"test": true}'::jsonb, true)
  returning id into v_event;
  return v_event;
end;
$$;

revoke all on function public.push_test_twitch_event(text, jsonb) from public, anon;
grant execute on function public.push_test_twitch_event(text, jsonb) to authenticated;
