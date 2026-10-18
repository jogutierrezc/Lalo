-- =============================================================================
-- 0024_lux_settings.sql
--
-- Ajustes de Lux AI por streamer: personalidad, longitud y idioma de las
-- respuestas, uso de la memoria y tamaño del personaje en el overlay.
--
-- Cada streamer lee y cambia solo su fila (RLS). El administrador puede leerla.
-- El servidor valida los valores antes de guardarlos (server/lux/settings.ts):
-- las comprobaciones de aquí son una última red, no la validación principal.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0023.
-- Se puede volver a ejecutar.
-- =============================================================================

create table if not exists public.lux_settings (
  profile_id     uuid primary key references public.profiles (id) on delete cascade,
  personality    text not null default '' check (char_length(personality) <= 600),
  reply_max      integer not null default 200 check (reply_max between 60 and 500),
  language       text not null default 'es' check (language in ('es', 'en', 'pt')),
  memory_enabled boolean not null default true,
  obs_size       integer not null default 40 check (obs_size between 10 and 100),
  updated_at     timestamptz not null default now()
);

alter table public.lux_settings enable row level security;

drop policy if exists "lux_settings_read" on public.lux_settings;
create policy "lux_settings_read" on public.lux_settings
  for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "lux_settings_write" on public.lux_settings;
create policy "lux_settings_write" on public.lux_settings
  for insert to authenticated
  with check (profile_id = (select auth.uid()));

drop policy if exists "lux_settings_update" on public.lux_settings;
create policy "lux_settings_update" on public.lux_settings
  for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));
