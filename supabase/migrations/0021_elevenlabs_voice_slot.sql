-- =============================================================================
-- 0021_elevenlabs_voice_slot.sql
--
-- Cada voz de ElevenLabs queda marcada con la clave (slot 1 o 2) en la que se
-- creó o importó. El catálogo solo muestra a los streamers las voces del slot
-- que el administrador tiene activo: una voz de la clave 1 no aparece cuando la
-- activa es la 2, y al revés. Así no se intenta usar una voz con una clave que
-- no la tiene.
--
--   1. voices.eleven_slot: 1 o 2. Solo se rellena en voces de ElevenLabs.
--   2. Las voces que ya existían se marcan con el slot 1: antes de la 0020 solo
--      había una clave, la que ahora es la 1.
--   3. Política voices_select: las voces de ElevenLabs se ven solo si su slot
--      coincide con el activo (eleven_active_slot, migración 0020).
--
-- Para crear voces nuevas en la clave 2: cambiar el slot activo a 2 en el panel
-- y clonar o importar como siempre.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0020.
-- Se puede volver a ejecutar.
-- =============================================================================

alter table public.voices
  add column if not exists eleven_slot smallint
  check (eleven_slot in (1, 2));

update public.voices
   set eleven_slot = 1
 where provider = 'elevenlabs' and eleven_slot is null;

grant select (eleven_slot) on public.voices to authenticated;

drop policy if exists voices_select on public.voices;
create policy voices_select on public.voices
  for select to authenticated
  using (
    provider = 'fish'
    or (
      (select public.eleven_enabled())
      and eleven_slot = (select public.eleven_active_slot())
    )
  );
