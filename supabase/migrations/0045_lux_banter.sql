-- =============================================================================
-- 0045_lux_banter.sql
--
-- Modo pique. lux_settings.banter decide cómo responde Lux cuando alguien lo
-- provoca (intención «insulto»):
--
--   off    Responder con calma (el comportamiento de siempre). Por defecto.
--   pique  Picar al estilo League of Legends: burla de jugador con humor, sin
--          líneas rojas (origen, género, orientación, físico, salud, familia,
--          palabrotas fuertes, amenazas). Es opt-in del streamer.
--
-- La validación real está en server/lux/settings.ts (LUX_BANTER_MODES) y el filtro
-- de seguridad en server/lux/outputFilter.ts; esta restricción es la última red.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0044.
-- Se puede volver a ejecutar.
-- =============================================================================

alter table public.lux_settings
  add column if not exists banter text not null default 'off';

alter table public.lux_settings drop constraint if exists lux_settings_banter_check;
alter table public.lux_settings add constraint lux_settings_banter_check
  check (banter in ('off', 'pique'));
