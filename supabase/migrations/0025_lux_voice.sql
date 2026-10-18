-- =============================================================================
-- 0025_lux_voice.sql
--
-- La voz de Lux AI por streamer: el reference_id de una voz del catálogo y su
-- motor (Fish Audio o ElevenLabs). Las dos columnas van a la vez o ninguna: si
-- no hay voz elegida, Lux usa la voz por defecto del catálogo.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0024.
-- Se puede volver a ejecutar.
-- =============================================================================

alter table public.lux_settings
  add column if not exists voice_reference_id text,
  add column if not exists voice_engine text;

alter table public.lux_settings
  drop constraint if exists lux_settings_voice_engine_check;

alter table public.lux_settings
  add constraint lux_settings_voice_engine_check
    check (voice_engine is null or voice_engine in ('fish', 'elevenlabs'));

alter table public.lux_settings
  drop constraint if exists lux_settings_voice_pair_check;

alter table public.lux_settings
  add constraint lux_settings_voice_pair_check
    check ((voice_reference_id is null) = (voice_engine is null));
