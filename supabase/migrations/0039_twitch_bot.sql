-- =============================================================================
-- 0039_twitch_bot.sql
--
-- Datos del bot de chat de Twitch en la nube. Hasta ahora los comandos de cada
-- streamer vivían solo en el navegador y servían para generar un script de
-- Python (src/components/bot/pythonScript.ts). Para que el servidor conteste en
-- el chat necesita leerlos por canal:
--
--   1. twitch_bot_settings: una fila por streamer. Encendido, prefijo, mensaje de
--      bienvenida y quién escribe en el chat (sender_mode): 'global' es la
--      cuenta del bot de la plataforma; 'streamer' queda reservado para cuando
--      cada uno use su propia cuenta (hoy no lo usa nadie).
--   2. twitch_bot_commands: los comandos personalizados. El nombre va en
--      minúsculas, sin prefijo ni espacios, y no se repite dentro de un streamer.
--      El permiso es all, sub, mod o broadcaster, como CommandPermission.
--   3. twitch_bot_cooldowns: la hora a partir de la que algo puede volver a
--      pasar para un (canal, nombre, clave). Se toma con take_twitch_bot_cooldown,
--      que decide en una sola sentencia para que dos avisos a la vez no pasen los
--      dos. Sirve para varias cosas, todas con la misma función:
--        - cooldown de un espectador: viewer = su usuario en minúsculas, key = el
--          comando (p. ej. 'cmd:redes', 'lux');
--        - deduplicación de un aviso: viewer = 'dedupe', key = 'm:' + Message-Id;
--        - candado entre instancias y límite de tasa por streamer: viewer = '_',
--          key = 'digest', 'spont', 'api_status', 'api_connect'.
--      Solo guarda ese nombre, la clave y la hora; lo caducado se puede borrar sin
--      perder nada (ver purge_twitch_bot_data, en 0041).
--
-- (Una tabla twitch_bot_state con la hora del último comentario espontáneo se
-- planteó y se quitó: esa hora ya vive en los ajustes de Mi AI (lux_spontaneous).)
--
-- RLS: cada streamer LEE solo sus ajustes y sus comandos (y el administrador, todos).
-- No hay políticas de escritura para authenticated: escribe el servidor con la
-- clave de servicio (que se salta RLS), tras comprobar la sesión y validar los datos
-- (server/twitch/botHandlers.ts). Así nadie se salta esas validaciones ni el tope de
-- comandos hablando directo con PostgREST. La tabla de cooldowns lleva RLS y ninguna
-- política: solo el servidor la toca (mismo patrón que lux_outbox, 0037). La función
-- de cooldown solo la puede ejecutar la clave de servicio.
--
-- Las reglas de nombres reales están en cleanCommandName (pythonScript.ts) y en
-- server/twitch/botDb.ts; estas restricciones son la última red.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0038.
-- Se puede volver a ejecutar.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Ajustes del bot
-- ---------------------------------------------------------------------------

create table if not exists public.twitch_bot_settings (
  profile_id      uuid primary key references public.profiles (id) on delete cascade,
  enabled         boolean not null default false,
  prefix          text not null default '!' check (char_length(prefix) between 1 and 5 and prefix !~ '\s'),
  welcome_message text not null default '' check (char_length(welcome_message) <= 500),
  sender_mode     text not null default 'global' check (sender_mode in ('global', 'streamer')),
  updated_at      timestamptz not null default now()
);

alter table public.twitch_bot_settings enable row level security;

drop policy if exists "twitch_bot_settings_read" on public.twitch_bot_settings;
create policy "twitch_bot_settings_read" on public.twitch_bot_settings
  for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_admin()));

-- Sin políticas de escritura para authenticated. Si una versión anterior las creó, se quitan
drop policy if exists "twitch_bot_settings_write" on public.twitch_bot_settings;
drop policy if exists "twitch_bot_settings_update" on public.twitch_bot_settings;

-- ---------------------------------------------------------------------------
-- 2. Comandos personalizados
-- ---------------------------------------------------------------------------

create table if not exists public.twitch_bot_commands (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 50 and name = lower(name) and name !~ '\s' and name !~ '^!'),
  response    text not null check (char_length(response) between 1 and 500),
  permission  text not null default 'all' check (permission in ('all', 'sub', 'mod', 'broadcaster')),
  enabled     boolean not null default true,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (profile_id, name)
);

create index if not exists twitch_bot_commands_profile_idx on public.twitch_bot_commands (profile_id, position);

alter table public.twitch_bot_commands enable row level security;

drop policy if exists "twitch_bot_commands_read" on public.twitch_bot_commands;
create policy "twitch_bot_commands_read" on public.twitch_bot_commands
  for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_admin()));

-- Sin políticas de escritura para authenticated. Si una versión anterior las creó, se quitan
drop policy if exists "twitch_bot_commands_insert" on public.twitch_bot_commands;
drop policy if exists "twitch_bot_commands_update" on public.twitch_bot_commands;
drop policy if exists "twitch_bot_commands_delete" on public.twitch_bot_commands;

-- ---------------------------------------------------------------------------
-- 3. Cooldowns, deduplicación, candados y límites de tasa por (streamer, nombre, clave)
-- ---------------------------------------------------------------------------

create table if not exists public.twitch_bot_cooldowns (
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  viewer        text not null check (char_length(viewer) between 1 and 40), -- usuario en minúsculas, 'dedupe' o '_'
  key           text not null check (char_length(key) between 1 and 60),
  available_at  timestamptz not null,
  primary key (profile_id, viewer, key)
);

create index if not exists twitch_bot_cooldowns_available_idx on public.twitch_bot_cooldowns (available_at);

alter table public.twitch_bot_cooldowns enable row level security;

-- Toma el cooldown de forma atómica. Devuelve 0 si el espectador puede usar la
-- clave (y deja anotada la próxima hora libre) o los segundos que le faltan,
-- redondeados hacia arriba, sin tocar nada si aún no puede.
create or replace function public.take_twitch_bot_cooldown(
  p_profile_id uuid,
  p_viewer     text,
  p_key        text,
  p_seconds    integer
) returns integer
language plpgsql
set search_path = public
as $$
declare
  v_taken integer;
  v_wait  integer;
begin
  insert into public.twitch_bot_cooldowns as c (profile_id, viewer, key, available_at)
  values (p_profile_id, lower(p_viewer), p_key, now() + make_interval(secs => greatest(p_seconds, 0)))
  on conflict (profile_id, viewer, key) do update
    set available_at = excluded.available_at
    where c.available_at <= now()
  returning 1 into v_taken;

  if v_taken is not null then
    return 0;
  end if;

  select greatest(1, ceil(extract(epoch from (available_at - now())))::integer)
    into v_wait
    from public.twitch_bot_cooldowns
    where profile_id = p_profile_id and viewer = lower(p_viewer) and key = p_key;

  return coalesce(v_wait, 1);
end;
$$;

revoke all on function public.take_twitch_bot_cooldown(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.take_twitch_bot_cooldown(uuid, text, text, integer) to service_role;
