-- =============================================================================
-- 0043_lux_languages.sql
--
-- Idiomas de Mi AI. Amplía la 0024 (lux_settings.language, que solo admitía
-- es, en y pt) con francés (fr), italiano (it) y «auto»: Lux contesta en el
-- idioma de quien escribe, así un mismo canal puede hablar varios idiomas.
-- La validación real está en server/lux/settings.ts (LUX_LANGUAGES); esta
-- restricción es la última red.
--
-- Los canales que ya tenían es, en o pt no cambian.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0042.
-- Se puede volver a ejecutar.
-- =============================================================================

alter table public.lux_settings drop constraint if exists lux_settings_language_check;
alter table public.lux_settings add constraint lux_settings_language_check
  check (language in ('auto', 'es', 'en', 'fr', 'pt', 'it'));
