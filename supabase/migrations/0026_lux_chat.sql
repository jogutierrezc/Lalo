-- =============================================================================
-- 0026_lux_chat.sql
--
-- Lux en el chat de Twitch: el interruptor del streamer para que Lux responda
-- a !lux en el chat (!luxon / !luxoff lo cambian desde el chat).
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0025.
-- Se puede volver a ejecutar.
-- =============================================================================

alter table public.lux_settings
  add column if not exists chat_enabled boolean not null default true;
