-- =============================================================================
-- 0029_lux_delay.sql
--
-- Las respuestas de Lux a un comando del chat esperan 30 segundos: la frase
-- lleva la hora a partir de la que puede sonar en el overlay (play_after).
-- Las frases del panel no tienen retraso (play_after es null).
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0028.
-- Se puede volver a ejecutar.
-- =============================================================================

alter table public.lux_speech
  add column if not exists play_after timestamptz;
