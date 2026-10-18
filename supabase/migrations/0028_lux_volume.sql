-- =============================================================================
-- 0028_lux_volume.sql
--
-- Volumen de la voz de Lux en el overlay de OBS (0 a 100, por defecto 100).
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0027.
-- Se puede volver a ejecutar.
-- =============================================================================

alter table public.lux_settings
  add column if not exists voice_volume integer not null default 100
    check (voice_volume between 0 and 100);
