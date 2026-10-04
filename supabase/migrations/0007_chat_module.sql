-- 0007_chat_module.sql
-- Añade el módulo «chat» (capa Chat en vivo) a los módulos de configuración.
--
-- SIN PROBAR: escrita leyendo 0001, no se ha ejecutado contra una base real.
--
-- En 0001 la lista de módulos se impone con un CHECK sin nombre sobre la columna
-- configs.module. Postgres lo llama configs_module_check; por si en alguna base
-- tiene otro nombre, se busca cualquier CHECK de la tabla que mire esa columna
-- (sin tocar configs_data_size) y se sustituye por uno con nombre y con 'chat'.
-- widget_bundle y las políticas de configs no filtran por módulo: no cambian.

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
    ('tts', 'alerts', 'goals', 'roulette', 'polls', 'rewards', 'bot', 'marathon', 'focus', 'raid', 'chat'));
