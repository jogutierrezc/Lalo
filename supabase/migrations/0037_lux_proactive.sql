-- =============================================================================
-- 0037_lux_proactive.sql
--
-- Mi AI habla sin que se lo pidan y con el nombre que elige el creador. Amplía la
-- 0024 (lux_settings) y añade la cola de mensajes que el panel deja para el bot.
--
--   1. chat_name: nombre visible de la IA en el chat (0 a 30 caracteres). Vacío
--      = se usa la palabra de activación (chat_word, 0036).
--   2. Comentarios espontáneos: spontaneous_enabled (encendido por defecto),
--      spontaneous_every_min (10, 15, 30 o 60) y spontaneous_min_messages
--      (3, 5 o 10 mensajes de espectadores desde el último comentario).
--   3. Reacciones a eventos: event_follow, event_sub, event_raid y event_start
--      (todas encendidas por defecto).
--   4. lux_outbox: cola de mensajes por streamer. El panel escribe (por el
--      servidor); el bot los recoge con su clave de OBS y confirma el envío.
--      Estados: pending (en cola), claimed (el bot lo recogió), sent (el bot
--      confirmó que lo publicó) y failed (el bot no pudo publicarlo).
--      RLS activado y sin políticas: solo lo tocan las funciones del servidor con
--      la clave de servicio (mismo patrón que lux_speech, 0027).
--
-- La validación real está en server/lux/settings.ts; estas restricciones son la
-- última red. Cambiar la palabra o el nombre obliga a volver a copiar el script del
-- bot (src/components/bot/pythonScript.ts, versión 6).
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0036.
-- Se puede volver a ejecutar.
-- =============================================================================

alter table public.lux_settings add column if not exists chat_name text not null default '';
alter table public.lux_settings add column if not exists spontaneous_enabled boolean not null default true;
alter table public.lux_settings add column if not exists spontaneous_every_min integer not null default 15;
alter table public.lux_settings add column if not exists spontaneous_min_messages integer not null default 10;
alter table public.lux_settings add column if not exists event_follow boolean not null default true;
alter table public.lux_settings add column if not exists event_sub boolean not null default true;
alter table public.lux_settings add column if not exists event_raid boolean not null default true;
alter table public.lux_settings add column if not exists event_start boolean not null default true;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lux_settings_chat_name_check') then
    alter table public.lux_settings add constraint lux_settings_chat_name_check
      check (char_length(chat_name) <= 30);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lux_settings_spontaneous_every_check') then
    alter table public.lux_settings add constraint lux_settings_spontaneous_every_check
      check (spontaneous_every_min in (10, 15, 30, 60));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lux_settings_spontaneous_min_check') then
    alter table public.lux_settings add constraint lux_settings_spontaneous_min_check
      check (spontaneous_min_messages in (3, 5, 10));
  end if;
end $$;

create table if not exists public.lux_outbox (
  id          bigserial primary key,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  text        text not null check (char_length(text) between 1 and 500),
  speak       boolean not null default false,
  emotion     text not null default 'normal',
  mode        text not null default 'literal' check (mode in ('literal', 'ai')),
  status      text not null default 'pending' check (status in ('pending', 'claimed', 'sent', 'failed')),
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  sent_at     timestamptz
);

create index if not exists lux_outbox_profile_idx on public.lux_outbox (profile_id, status, id);

alter table public.lux_outbox enable row level security;
