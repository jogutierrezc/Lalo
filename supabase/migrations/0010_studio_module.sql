-- 0010_studio_module.sql
-- Añade el módulo «studio» (escenas de Studio, el editor de capas) a los
-- módulos de configuración.
--
-- SIN PROBAR: escrita leyendo 0001 y 0007, no se ha ejecutado contra una base real.
--
-- Igual que en 0007: se busca cualquier CHECK de la tabla configs que mire la
-- columna module (sin tocar configs_data_size) y se sustituye por uno con
-- nombre que incluye 'studio'. widget_bundle y las políticas de configs no
-- filtran por módulo: no cambian.

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
    ('tts', 'alerts', 'goals', 'roulette', 'polls', 'rewards', 'bot', 'marathon', 'focus', 'raid', 'chat', 'studio'));
