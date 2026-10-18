-- =============================================================================
-- 0033_lux_character_owner.sql
--
-- Mascota 2: personaje de Mi AI con modelo GLB propio, de uso privado de una
-- cuenta (la de jagc). Amplía lux_characters de la 0032.
--
--   1. lux_characters.avatar admite 'glb:<id>' además de 'lux' (el id es un
--      modelo que existe en el servidor: LUX_MODEL_AVATAR_IDS).
--   2. lux_characters.owner_profile_id: cuenta dueña. Null = visible para todas
--      las cuentas. Un avatar GLB exige dueño. Si se borra la cuenta, su
--      personaje se borra con ella (on delete cascade): nunca queda público.
--   3. lux_characters.model_key: clave del archivo del modelo en el bucket
--      privado de R2 (R2_MODELS_BUCKET). Solo la lee el servidor; nunca sale.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0032.
-- Se puede volver a ejecutar.
-- =============================================================================

alter table public.lux_characters drop constraint if exists lux_characters_avatar_check;
alter table public.lux_characters
  add constraint lux_characters_avatar_check
  check (avatar = 'lux' or avatar ~ '^glb:[a-z0-9][a-z0-9-]{0,39}$');

alter table public.lux_characters
  add column if not exists owner_profile_id uuid references public.profiles (id) on delete cascade,
  add column if not exists model_key text;

alter table public.lux_characters drop constraint if exists lux_characters_model_key_check;
alter table public.lux_characters
  add constraint lux_characters_model_key_check
  check (model_key is null or model_key ~ '^lux-models/[0-9a-f]{32}\.glb$');

alter table public.lux_characters drop constraint if exists lux_characters_glb_owner_check;
alter table public.lux_characters
  add constraint lux_characters_glb_owner_check
  check (avatar = 'lux' or owner_profile_id is not null);

create index if not exists lux_characters_owner_idx on public.lux_characters (owner_profile_id);
