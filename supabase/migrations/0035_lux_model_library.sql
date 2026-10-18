-- =============================================================================
-- 0035_lux_model_library.sql
--
-- Biblioteca de modelos 3D de Mi AI y modelos de los creadores. Amplía las
-- 0032, 0033 y 0034.
--
--   1. lux_models: modelos que sube un creador con su propia cuenta. Son
--      privados de su dueño hasta que el administrador los revisa y confirma
--      su licencia (review_status 'privado' -> 'pendiente' -> 'aprobado').
--      Los modelos de Riot Games NO se copian aquí: la biblioteca los lee de
--      lux_characters (model_origin = 'riot'), así no hay dos copias de la misma clave.
--   2. profiles.lux_model_id: modelo que el creador eligió para su personaje
--      (de la biblioteca o suyo). Sin clave foránea: puede apuntar a un modelo
--      de Riot (que vive en lux_characters); el servidor valida la elección
--      en cada lectura y, si ya no es visible, la ignora.
--   3. plans.lux_max_models: nº máximo de modelos propios por creador según
--      plan. Null = 0 (sin modelos propios). Se siembra con 2 en Básico y 10
--      en Plus solo si está vacío: si el administrador lo cambia en Límites,
--      una nueva ejecución no lo pisa.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0034.
-- Se puede volver a ejecutar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Modelos de los creadores
-- -----------------------------------------------------------------------------

create table if not exists public.lux_models (
  id                 uuid primary key default gen_random_uuid(),
  owner_profile_id   uuid not null references public.profiles (id) on delete cascade,
  name               text not null check (char_length(name) between 1 and 80),
  file_name          text,
  file_bytes         bigint check (file_bytes is null or file_bytes >= 0),
  -- Archivo ya confirmado en R2 (null mientras no se haya subido o tras quitarlo).
  model_key          text check (model_key is null or model_key ~ '^lux-models/[0-9a-f]{32}\.glb$'),
  -- Clave dada para una subida que aún no se ha confirmado.
  pending_key        text check (pending_key is null or pending_key ~ '^lux-models/[0-9a-f]{32}\.glb$'),
  -- Archivos cuyo borrado en R2 falló. Se reintentan en la siguiente operación del dueño.
  stale_keys         text[] not null default '{}',
  review_status      text not null default 'privado' check (review_status in ('privado', 'pendiente', 'aprobado')),
  -- El administrador confirma la licencia antes de publicar.
  license_confirmed  boolean not null default false,
  uploaded_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint lux_models_approved_check check (review_status <> 'aprobado' or (license_confirmed and model_key is not null)),
  constraint lux_models_file_check check (model_key is not null or review_status = 'privado')
);

create unique index if not exists lux_models_model_key_idx on public.lux_models (model_key) where model_key is not null;
create index if not exists lux_models_owner_idx on public.lux_models (owner_profile_id);

alter table public.lux_models enable row level security;
revoke all on public.lux_models from public, anon, authenticated;
grant all on public.lux_models to service_role;

-- -----------------------------------------------------------------------------
-- 2. Modelo elegido por el creador
-- -----------------------------------------------------------------------------

alter table public.profiles
  add column if not exists lux_model_id uuid;

-- -----------------------------------------------------------------------------
-- 3. Cuota de modelos propios por plan
-- -----------------------------------------------------------------------------

alter table public.plans
  add column if not exists lux_max_models integer check (lux_max_models is null or lux_max_models >= 0);

-- Valores propuestos (diseño aprobado, S5). Solo si el plan todavía no tiene valor.
update public.plans set lux_max_models = 2 where id = 'basico' and lux_max_models is null;
update public.plans set lux_max_models = 10 where id = 'plus' and lux_max_models is null;
