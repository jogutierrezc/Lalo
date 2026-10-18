-- =============================================================================
-- 0034_lux_character_model.sql
--
-- Subida del modelo 3D desde el panel (Mi AI, ficha del personaje) y aviso de
-- licencia de Riot Games. Amplía lux_characters de la 0033.
--
--   1. model_origin: de quién es el modelo GLB. 'riot' = modelo de Riot Games
--      (obliga a mostrar el aviso de licencia en la ficha, en el panel del
--      streamer y en el pie del overlay); 'propio' = de quien lo subió.
--   2. model_file_name, model_file_bytes, model_uploaded_at: datos del archivo
--      actual que muestra la ficha (nombre, tamaño y fecha de subida).
--   3. model_pending_key: clave que el servidor dio para una subida que aún no
--      se ha confirmado. Solo se acepta confirmar esa clave.
--   4. model_stale_keys: archivos viejos de R2 cuyo borrado falló. Se reintentan
--      en la siguiente subida o al quitar el modelo.
--
-- El Warwick actual (avatar 'glb:warwick') es de Riot: se marca como 'riot'.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0033.
-- Se puede volver a ejecutar.
-- =============================================================================

alter table public.lux_characters
  add column if not exists model_origin text,
  add column if not exists model_file_name text,
  add column if not exists model_file_bytes bigint,
  add column if not exists model_uploaded_at timestamptz,
  add column if not exists model_pending_key text,
  add column if not exists model_stale_keys text[] not null default '{}';

alter table public.lux_characters drop constraint if exists lux_characters_model_origin_check;
alter table public.lux_characters
  add constraint lux_characters_model_origin_check
  check (model_origin is null or model_origin in ('riot', 'propio'));

alter table public.lux_characters drop constraint if exists lux_characters_model_pending_key_check;
alter table public.lux_characters
  add constraint lux_characters_model_pending_key_check
  check (model_pending_key is null or model_pending_key ~ '^lux-models/[0-9a-f]{32}\.glb$');

-- Marca el modelo de Riot ya subido (Warwick). Solo rellena lo que falta.
update public.lux_characters
   set model_origin = 'riot'
 where avatar = 'glb:warwick' and model_origin is null;
