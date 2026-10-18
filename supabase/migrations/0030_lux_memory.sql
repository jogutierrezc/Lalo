-- =============================================================================
-- 0030_lux_memory.sql
--
-- Memoria de Lux (pestaña Memoria y aprendizaje del chat):
--
--   1. lux_settings.chat_learning: «Lux aprende del chat». Apagado por defecto.
--      Apagarlo no borra los recuerdos existentes.
--   2. lux_memories.source: 'manual' (dato o estilo, escritos a mano) o 'chat'
--      (espectador o suceso, aprendidos del resumen del chat).
--   3. lux_memories.expires_at: los recuerdos del chat sin fijar caducan a los
--      30 días. Los manuales no caducan (expires_at null).
--   4. Se retira la política de borrado para el dueño: a partir de ahora solo el
--      servidor (clave de servicio) escribe en lux_memories. El navegador ya no
--      puede borrar ni escribir directamente.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0029.
-- Se puede volver a ejecutar.
-- =============================================================================

alter table public.lux_settings
  add column if not exists chat_learning boolean not null default false;

alter table public.lux_memories
  add column if not exists source text not null default 'manual'
    check (source in ('manual', 'chat'));

alter table public.lux_memories
  add column if not exists expires_at timestamptz;

create index if not exists lux_memories_expiry_idx
  on public.lux_memories (expires_at)
  where expires_at is not null;

drop policy if exists "lux_memories_forget" on public.lux_memories;
