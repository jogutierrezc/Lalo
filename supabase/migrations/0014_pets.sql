-- ============================================================================
-- 0014_pets.sql
--
-- Mascotas: el personaje que reacciona con voz a canjes, bits y al chat.
--
-- SIN PROBAR: escrita leyendo 0001 y 0013; no se ha ejecutado contra una base
-- real. Conviene aplicarla primero en un proyecto de pruebas. Necesita que 0013
-- (integraciones) ya esté aplicada.
--
-- Qué añade:
--   1. El módulo «pets» en la configuración sincronizada.
--
-- Datos personales: ninguno nuevo. Los ajustes de la mascota (personaje, frases,
-- posición) viajan como los de cualquier otro módulo. La clave de la IA del
-- streamer no se guarda en la configuración.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Módulo «pets» en la configuración sincronizada (igual que 0013)
-- ---------------------------------------------------------------------------

do $$
declare
  v_name text;
begin
  for v_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.configs'::regclass
      and con.contype = 'c'
      and con.conname <> 'configs_data_size'
      and pg_get_constraintdef(con.oid) ilike '%module%'
  loop
    execute format('alter table public.configs drop constraint %I', v_name);
  end loop;
end
$$;

alter table public.configs
  add constraint configs_module_check check (module in
    ('tts', 'alerts', 'goals', 'roulette', 'polls', 'rewards', 'bot', 'marathon', 'focus', 'raid', 'chat', 'studio',
     'powerups', 'music', 'kofi', 'pets'));
