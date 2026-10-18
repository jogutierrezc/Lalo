-- =============================================================================
-- 0027_lux_speech.sql
--
-- Lo que Lux tiene que decir en el overlay de OBS. El servidor escribe una fila
-- cada vez que Lux responde (por !lux en el chat o desde el panel); el overlay de
-- OBS lo lee con su clave de OBS (mismo patrón que el widget). Sin políticas de
-- RLS: solo lo tocan las funciones del servidor con la clave de servicio.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0026.
-- Se puede volver a ejecutar.
-- =============================================================================

create table if not exists public.lux_speech (
  id           bigserial primary key,
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  text         text not null check (char_length(text) between 1 and 500),
  emotion      text not null default 'normal',
  gesture      text not null default 'idle',
  voice_reference_id text,
  voice_engine text check (voice_engine is null or voice_engine in ('fish', 'elevenlabs')),
  created_at   timestamptz not null default now()
);

create index if not exists lux_speech_profile_idx on public.lux_speech (profile_id, id desc);

alter table public.lux_speech enable row level security;
