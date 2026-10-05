-- ============================================================================
-- 0016_tournament.sql
--
-- Torneos: la llave de eliminación directa y sus pantallas para OBS.
--
-- SIN PROBAR: escrita leyendo 0014 y 0015; no se ha ejecutado contra una base
-- real. Conviene aplicarla primero en un proyecto de pruebas. No depende de que
-- 0014 o 0015 estén aplicadas, porque aquí se vuelve a escribir la lista
-- completa de módulos.
--
-- Qué añade:
--   1. El módulo «tournament» en la configuración sincronizada. Nada más: ni
--      tablas, ni funciones, ni políticas.
--
-- Qué se guarda en esa fila: los ajustes del torneo (nombre, estilo, logo,
-- patrocinadores, narrador, nombres de los comandos) y, dentro de ellos, una
-- copia del estado de la llave (nombres de los equipos, resultados y pantalla
-- en curso), para que llegue a OBS en otro equipo. La lee quien tenga la clave
-- del widget, igual que el resto de `configs`.
--
-- Datos personales: los nombres de equipo que escribe el streamer. La
-- inscripción pública y el estado del torneo en su propia tabla llegan en una
-- migración posterior.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Módulo «tournament» en la configuración sincronizada (igual que 0015)
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
     'powerups', 'music', 'kofi', 'pets', 'game', 'tournament'));
