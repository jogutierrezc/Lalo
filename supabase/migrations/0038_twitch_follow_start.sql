-- =============================================================================
-- 0038_twitch_follow_start.sql
--
-- Seguidores nuevos (channel.follow v2) e inicio del directo (stream.online) por
-- EventSub, para que Mi AI los salude. Amplía la 0012/0013:
--
--   1. twitch_events admite los tipos «follow» y «stream_online». Sirven solo
--      para no procesar dos veces el mismo aviso (el id del mensaje de Twitch es
--      único) y se borran solos a los quince minutos como el resto.
--   2. ingest_twitch_event acepta esos tipos. Con ellos devuelve 'ok:<id del
--      perfil>' en lugar de 'ok': el servidor necesita saber de qué streamer es el
--      aviso para dejar el saludo en su cola (lux_outbox, 0037). Con los demás
--      tipos no cambia nada. El dueño del canal se busca igual que antes: por
--      profiles.twitch_user_id, solo cuentas activas.
--   3. widget_events no entrega esos dos tipos a la capa de OBS: no tienen
--      efecto visual propio (las alertas de seguidor salen de otro camino) y la
--      capa no los conoce.
--
-- No guarda nada nuevo de los espectadores: el nombre del seguidor viaja en el
-- payload, que se borra a los quince minutos.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0037.
-- Se puede volver a ejecutar.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tipos nuevos en la tabla de eventos
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
  add constraint twitch_events_kind_check
  check (kind in ('bits', 'powerup', 'points', 'kofi', 'follow', 'stream_online'));

-- ---------------------------------------------------------------------------
-- 2. Entrada desde el servidor (solo clave de servicio)
-- ---------------------------------------------------------------------------

-- Devuelve 'ok', 'duplicate' (mensaje ya guardado) o 'unknown_channel' (ningún
-- streamer activo tiene ese canal de Twitch). Con «follow» y «stream_online»,
-- en lugar de 'ok' devuelve 'ok:' seguido del id del perfil.
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
     or p_kind not in ('bits', 'powerup', 'points', 'follow', 'stream_online') then
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

  if p_kind in ('follow', 'stream_online') then
    return 'ok:' || v_profile::text;
  end if;
  return 'ok';
end;
$$;

revoke all on function public.ingest_twitch_event(text, text, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.ingest_twitch_event(text, text, text, jsonb, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3. La capa de OBS no recibe los tipos nuevos
-- ---------------------------------------------------------------------------

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
        and e.kind not in ('follow', 'stream_online')
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
