-- =============================================================================
-- 0054_done_ai.sql
--
-- Done AI convive con Lux en las MISMAS tablas. Esta migración solo AÑADE COLUMNAS e índices: no crea tablas,
-- no toca RLS ni políticas, no borra nada. Ejecutar después de 0001 a 0053. Se puede volver a ejecutar.
--
-- Compartido con Lux tal cual (sin cambios): lux_memories, lux_viewer_turns, lux_replies, lux_usage_monthly,
-- lux_characters, lux_models y la cuota de modelos.
--
-- Separado con un discriminador `agent` ('lux' | 'done'): lux_speech (la cola de frases que lee cada overlay)
-- y lux_outbox (la cola de «decir en el chat»). El código de Lux filtra agent = 'lux'.
--
--   lux_settings.done_settings  jsonb  ajustes de Done del creador (los valida validateDoneSettings en el servidor)
--   profiles.done_enabled       bool   interruptor del administrador por cuenta (por defecto, activado)
--   lux_speech.agent/viewer/kind       quién habla, a quién responde y de qué tipo es (chat, event, spontaneous, say)
--   lux_outbox.agent                   a quién pertenece el mensaje de la cola
--
-- SIN PROBAR contra un proyecto real. APLICAR ANTES de desplegar el código: Lux filtra por lux_speech.agent y
-- lux_outbox.agent, y sin estas columnas esas consultas fallan.
-- =============================================================================

alter table public.lux_settings
  add column if not exists done_settings jsonb not null default '{}'::jsonb;

alter table public.profiles
  add column if not exists done_enabled boolean not null default true;

alter table public.lux_speech
  add column if not exists agent text not null default 'lux' check (agent in ('lux', 'done'));
alter table public.lux_speech
  add column if not exists viewer text;
alter table public.lux_speech
  add column if not exists kind text check (kind is null or kind in ('chat', 'event', 'spontaneous', 'say'));

alter table public.lux_outbox
  add column if not exists agent text not null default 'lux' check (agent in ('lux', 'done'));

create index if not exists lux_speech_agent_idx on public.lux_speech (profile_id, agent, id desc);
create index if not exists lux_outbox_agent_idx on public.lux_outbox (profile_id, agent, status, id);
