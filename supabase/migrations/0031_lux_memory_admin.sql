-- =============================================================================
-- 0031_lux_memory_admin.sql
--
-- Memoria de Lux escrita por el administrador (ficha de cada streamer):
--
--   1. lux_memories.source admite también 'admin': los recuerdos que el
--      administrador escribe o sube desde el portal. No caducan (expires_at
--      siempre null) y solo el administrador los edita o borra.
--   2. La restricción se busca en el catálogo y se quita, sea cual sea su
--      nombre (la de 0030 se llama lux_memories_source_check), y se vuelve a
--      crear con los tres valores.
--
-- Permisos: no hay política nueva. El navegador no escribe en lux_memories
-- (0030 quitó el borrado para el dueño); todo cambio pasa por el servidor con
-- la clave de servicio, que comprueba que quien llama es administrador.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0030.
-- Se puede volver a ejecutar.
-- =============================================================================

do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.lux_memories'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%source%'
  loop
    execute format('alter table public.lux_memories drop constraint %I', c.conname);
  end loop;
end
$$;

alter table public.lux_memories
  add constraint lux_memories_source_check
  check (source in ('manual', 'chat', 'admin'));
