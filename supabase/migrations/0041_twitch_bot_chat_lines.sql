-- =============================================================================
-- 0041_twitch_bot_chat_lines.sql
--
-- Búfer rodante de las últimas líneas del chat de cada streamer, para el bot de
-- Twitch en la nube. El script de Python las guardaba en la memoria del proceso
-- (lux_lines y spont_lines) para dos cosas: resumir el chat en recuerdos de Mi AI
-- (aprender del chat) y hacer un comentario espontáneo. En Vercel cada aviso puede
-- caer en una instancia distinta y nada vive en memoria, así que se guardan aquí:
--
--   twitch_bot_chat_lines: una fila por línea. Solo texto del espectador (hasta 300
--                     caracteres) y su nombre de usuario; el servidor no guarda los
--                     comandos (los que empiezan por el prefijo o por «!»). Las líneas
--                     de cuentas de bots conocidos (LUX_IGNORE del script) se guardan con
--                     spont = false: solo entran en el resumen, como en el script.
--   spont_used:       el comentario espontáneo ya contó esa línea (la ventana empieza
--                     de cero tras cada comentario, como spont_lines.clear()).
--   push_twitch_bot_chat_line: inserta la línea y, en la misma llamada, deja como mucho
--                     p_max filas por streamer (las más nuevas) y borra todo lo que
--                     tenga más de 24 horas. Así la tabla nunca crece sin tope y no
--                     hace falta ninguna tarea programada.
--
-- Privacidad: el servidor borra las líneas en cuanto las resume (solo las ya leídas; las que
-- llegan mientras tanto se quedan), al desconectar el bot, al apagarlo y al apagar el
-- aprendizaje y los comentarios. El tope de 24 horas es la red de seguridad, y
-- purge_twitch_bot_data (al final) la aplica a todos los streamers a la vez; hay que
-- programarla con pg_cron (ver supabase/BOT-NUBE.md). Si se borra un perfil, sus líneas se borran con él.
--
-- RLS sin políticas: solo el servidor con la clave de servicio toca la tabla, y solo la
-- clave de servicio ejecuta la función (mismo patrón que 0039 y 0040).
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0039. Se puede volver a ejecutar.
-- =============================================================================

create table if not exists public.twitch_bot_chat_lines (
  id          bigint generated always as identity primary key,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  viewer      text not null check (char_length(viewer) between 1 and 40),
  line        text not null check (char_length(line) between 1 and 300),
  spont       boolean not null default true,
  spont_used  boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists twitch_bot_chat_lines_profile_idx on public.twitch_bot_chat_lines (profile_id, id desc);

alter table public.twitch_bot_chat_lines enable row level security;

create or replace function public.push_twitch_bot_chat_line(
  p_profile_id  uuid,
  p_viewer      text,
  p_line        text,
  p_spont       boolean default true,
  p_max         integer default 200
) returns void
language plpgsql
set search_path = public
as $$
declare
  v_max    integer := least(greatest(coalesce(p_max, 200), 1), 500);
  v_cutoff bigint;
begin
  insert into public.twitch_bot_chat_lines (profile_id, viewer, line, spont)
    values (p_profile_id, left(p_viewer, 40), left(p_line, 300), coalesce(p_spont, true));

  -- Tope por streamer: se queda con las `v_max` más nuevas
  select id into v_cutoff
    from public.twitch_bot_chat_lines
    where profile_id = p_profile_id
    order by id desc
    offset v_max - 1 limit 1;
  if v_cutoff is not null then
    delete from public.twitch_bot_chat_lines where profile_id = p_profile_id and id < v_cutoff;
  end if;

  -- Nada se guarda más de un día
  delete from public.twitch_bot_chat_lines
    where profile_id = p_profile_id and created_at < now() - interval '24 hours';
end;
$$;

revoke all on function public.push_twitch_bot_chat_line(uuid, text, text, boolean, integer) from public, anon, authenticated;
grant execute on function public.push_twitch_bot_chat_line(uuid, text, text, boolean, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Purga de lo caducado (todas las tablas del bot)
-- ---------------------------------------------------------------------------
--
-- Quita los cooldowns y candados ya vencidos (twitch_bot_cooldowns), los envíos de más de
-- 60 s (twitch_bot_sends; el limitador solo mira los últimos 30 s) y las líneas del chat de
-- más de 24 horas (twitch_bot_chat_lines). Devuelve cuántas filas quitó de cada tabla. Se
-- puede ejecutar a menudo sin riesgo. Programarla con pg_cron: ver supabase/BOT-NUBE.md.

create or replace function public.purge_twitch_bot_data()
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_cooldowns integer;
  v_sends     integer;
  v_lines     integer;
begin
  delete from public.twitch_bot_cooldowns where available_at < now() - interval '1 minute';
  get diagnostics v_cooldowns = row_count;

  delete from public.twitch_bot_sends where sent_at < clock_timestamp() - interval '60 seconds';
  get diagnostics v_sends = row_count;

  delete from public.twitch_bot_chat_lines where created_at < now() - interval '24 hours';
  get diagnostics v_lines = row_count;

  return jsonb_build_object('cooldowns', v_cooldowns, 'sends', v_sends, 'lines', v_lines);
end;
$$;

revoke all on function public.purge_twitch_bot_data() from public, anon, authenticated;
grant execute on function public.purge_twitch_bot_data() to service_role;
