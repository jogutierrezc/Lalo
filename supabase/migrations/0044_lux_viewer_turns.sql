-- =============================================================================
-- 0044_lux_viewer_turns.sql
--
-- Hilo por espectador. Hasta ahora Lux recibía solo el mensaje nuevo, sin los
-- turnos anteriores, así que un «¿y por qué?» no tenía contexto. Esta migración:
--
--   1. Crea public.lux_viewer_turns: los últimos mensajes y respuestas de cada
--      espectador. Son efímeros: el servidor conserva como máximo 6 turnos por
--      espectador y descarta los de más de 10 minutos (LUX_THREAD_TURNS y
--      LUX_THREAD_TTL_MS en server/lux/thread.ts).
--   2. Activa RLS sin ninguna política, igual que lux_memories tras la 0030: solo
--      el servidor (clave de servicio) lee y escribe. El navegador no ve el hilo.
--   3. Añade lux_settings.thread_enabled: el interruptor «Recordar la
--      conversación». Activado por defecto.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0043.
-- Se puede volver a ejecutar.
-- =============================================================================

create table if not exists public.lux_viewer_turns (
  id          bigint generated always as identity primary key,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  viewer      text not null,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null check (char_length(content) <= 1000),
  created_at  timestamptz not null default now()
);

create index if not exists lux_viewer_turns_thread_idx
  on public.lux_viewer_turns (profile_id, viewer, created_at desc);

alter table public.lux_viewer_turns enable row level security;

-- Sin políticas: ni lectura ni escritura desde el navegador. Solo la clave de servicio.
drop policy if exists "lux_viewer_turns_read" on public.lux_viewer_turns;
drop policy if exists "lux_viewer_turns_write" on public.lux_viewer_turns;

alter table public.lux_settings
  add column if not exists thread_enabled boolean not null default true;
