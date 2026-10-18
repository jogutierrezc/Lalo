-- =============================================================================
-- 0023_lux_module.sql
--
-- Módulo de Lux (personaje con IA) sobre la API de NVIDIA (build.nvidia.com).
--
--   1. profiles.lux_enabled: interruptor por streamer. Solo lo cambia el
--      administrador con admin_set_lux (abajo). El servidor lo vuelve a
--      comprobar con la clave de servicio antes de llamar a NVIDIA.
--   2. admin_set_lux(p_profile, p_enabled): el administrador activa o desactiva
--      Lux para una cuenta. Deja rastro en la bitácora (0019).
--   3. lux_memories: lo que Lux recuerda de cada streamer (datos, estilo,
--      espectadores, sucesos). Solo el dueño (y el administrador) la leen y
--      pueden borrar sus filas. Las escrituras las hace el servidor.
--   4. lux_replies: registro de las respuestas generadas, para no repetirlas y
--      para revisarlas. Mismas reglas de lectura que lux_memories.
--
-- La clave de NVIDIA NO va aquí en claro: el servidor la cifra (AES-256-GCM,
-- INTEGRATIONS_ENC_KEY) y la guarda en app_settings con la clave
-- 'nvidia_api_key_enc' (migración 0020, sin políticas de RLS).
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0022.
-- Se puede volver a ejecutar.
-- =============================================================================

alter table public.profiles
  add column if not exists lux_enabled boolean not null default false;

create or replace function public.admin_set_lux(p_profile uuid, p_enabled boolean)
returns public.profiles
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.profiles;
  v_who text;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  if p_profile = (select auth.uid()) then
    raise exception 'cannot_modify_self';
  end if;

  update public.profiles
     set lux_enabled = coalesce(p_enabled, false)
   where id = p_profile
  returning * into v_row;

  if not found then
    raise exception 'profile_not_found';
  end if;

  v_who := coalesce(v_row.display_name, v_row.twitch_login, 'Cuenta');
  perform public.log_admin_action(
    p_profile,
    'lux_toggle',
    case when v_row.lux_enabled
      then 'Se activó Lux para ' || v_who
      else 'Se desactivó Lux para ' || v_who
    end
  );

  return v_row;
end;
$$;

revoke execute on function public.admin_set_lux(uuid, boolean) from public, anon;
grant execute on function public.admin_set_lux(uuid, boolean) to authenticated;

create table if not exists public.lux_memories (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('fact', 'style', 'viewer', 'event')),
  subject     text,
  content     text not null check (char_length(content) between 1 and 500),
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists lux_memories_profile_idx
  on public.lux_memories (profile_id, created_at desc);

create table if not exists public.lux_replies (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  viewer      text,
  prompt      text not null check (char_length(prompt) <= 500),
  reply       text not null check (char_length(reply) <= 500),
  model       text not null,
  created_at  timestamptz not null default now()
);

create index if not exists lux_replies_profile_idx
  on public.lux_replies (profile_id, created_at desc);

alter table public.lux_memories enable row level security;
alter table public.lux_replies enable row level security;

drop policy if exists "lux_memories_read" on public.lux_memories;
create policy "lux_memories_read" on public.lux_memories
  for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "lux_memories_forget" on public.lux_memories;
create policy "lux_memories_forget" on public.lux_memories
  for delete to authenticated
  using (profile_id = (select auth.uid()));

drop policy if exists "lux_replies_read" on public.lux_replies;
create policy "lux_replies_read" on public.lux_replies
  for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_admin()));
