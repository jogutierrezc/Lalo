-- =============================================================================
-- 0032_lux_characters.sql
--
-- Personajes de Mi AI (antes «Lux AI»). Solo el administrador crea, edita y
-- borra personajes, y asigna uno a cada streamer desde su ficha.
--
--   1. lux_characters: catálogo de personajes. Avatar (de momento solo 'lux'),
--      color del pelo y del acento, gestos que usa en el overlay y modelo
--      propio (null = el modelo por defecto del proveedor). Hay un único
--      personaje por defecto («Lux»), que no se puede borrar.
--   2. profiles.lux_character_id: el personaje activo del streamer. Null =
--      el personaje por defecto. Un personaje activo por streamer.
--   3. lux_memories.character_id: cada recuerdo pertenece a un personaje. Los
--      existentes pasan al personaje que el streamer tenía en el momento de
--      esta migración (el por defecto, porque todavía no había otros).
--   4. plans.lux_monthly_credits: tope mensual de créditos de Mi AI por plan.
--      Un modelo con coste mayor que 0 consume créditos; si la cuenta supera el
--      tope, el personaje vuelve al modelo por defecto. Por defecto 0: los
--      modelos de pago no se usan hasta que el administrador ponga un tope.
--   5. lux_usage_monthly y lux_add_usage(): consumo de créditos por cuenta y
--      mes. Solo el servidor (clave de servicio) lo lee y lo escribe.
--
-- El navegador no toca ninguna de estas tablas: todo pasa por /api/lux/*.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0031.
-- Se puede volver a ejecutar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Catálogo de personajes
-- -----------------------------------------------------------------------------

create table if not exists public.lux_characters (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 40),
  avatar      text not null default 'lux' check (avatar in ('lux')),
  color       text not null default '#f59e0b' check (color ~* '^#[0-9a-f]{6}$'),
  gestures    text[] not null default array['wave', 'spin', 'dance', 'jump', 'sing', 'bow', 'ult', 'pride', 'nod', 'shrug', 'arms_up'],
  model       text check (model is null or char_length(model) <= 120),
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Un único personaje por defecto.
create unique index if not exists lux_characters_single_default
  on public.lux_characters (is_default) where is_default;

alter table public.lux_characters enable row level security;
revoke all on public.lux_characters from public, anon, authenticated;
grant all on public.lux_characters to service_role;

-- Personaje por defecto: «Lux». Solo si todavía no hay ninguno por defecto.
insert into public.lux_characters (name, is_default)
select 'Lux', true
 where not exists (select 1 from public.lux_characters where is_default);

-- -----------------------------------------------------------------------------
-- 2. Personaje activo por streamer
-- -----------------------------------------------------------------------------

alter table public.profiles
  add column if not exists lux_character_id uuid references public.lux_characters (id) on delete set null;

update public.profiles
   set lux_character_id = (select c.id from public.lux_characters c where c.is_default)
 where lux_character_id is null;

-- -----------------------------------------------------------------------------
-- 3. Recuerdos por personaje
-- -----------------------------------------------------------------------------

alter table public.lux_memories
  add column if not exists character_id uuid references public.lux_characters (id) on delete cascade;

update public.lux_memories m
   set character_id = p.lux_character_id
  from public.profiles p
 where p.id = m.profile_id
   and m.character_id is null
   and p.lux_character_id is not null;

alter table public.lux_memories alter column character_id set not null;

create index if not exists lux_memories_character_idx
  on public.lux_memories (profile_id, character_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 4. Tope mensual de créditos por plan
-- -----------------------------------------------------------------------------

alter table public.plans
  add column if not exists lux_monthly_credits integer not null default 0 check (lux_monthly_credits >= 0);

-- -----------------------------------------------------------------------------
-- 5. Consumo mensual por cuenta (solo servidor)
-- -----------------------------------------------------------------------------

create table if not exists public.lux_usage_monthly (
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  month       text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  credits     integer not null default 0 check (credits >= 0),
  updated_at  timestamptz not null default now(),
  primary key (profile_id, month)
);

alter table public.lux_usage_monthly enable row level security;
revoke all on public.lux_usage_monthly from public, anon, authenticated;
grant all on public.lux_usage_monthly to service_role;

-- Suma créditos de forma atómica (dos respuestas a la vez no se pisan).
create or replace function public.lux_add_usage(p_profile uuid, p_month text, p_credits integer)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.lux_usage_monthly (profile_id, month, credits, updated_at)
  values (p_profile, p_month, greatest(coalesce(p_credits, 0), 0), now())
  on conflict (profile_id, month) do update
     set credits    = public.lux_usage_monthly.credits + excluded.credits,
         updated_at = now();
$$;

revoke execute on function public.lux_add_usage(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.lux_add_usage(uuid, text, integer) to service_role;
