-- ============================================================================
-- 0015_riot.sql
--
-- Riot Games: «Alertas de juego» de League of Legends.
--
-- SIN PROBAR: escrita leyendo 0001, 0013 y 0014; no se ha ejecutado contra una
-- base real. Conviene aplicarla primero en un proyecto de pruebas. Necesita que
-- 0013 (integraciones) ya esté aplicada; 0014 (mascotas) puede estarlo o no,
-- porque aquí se vuelve a escribir la lista completa de módulos.
--
-- Qué añade:
--   1. Los módulos «pets» y «game» en la configuración sincronizada.
--   2. El proveedor «riot» en integration_accounts.
--   3. La columna `meta` de integration_accounts: para Riot guarda el servidor
--      (la1, euw1…), el Riot ID (nombre y etiqueta) y el PUUID de la cuenta.
--
-- La tabla integration_accounts sigue sin políticas: solo la toca el servidor
-- con la clave de servicio. El navegador no puede leerla ni escribirla.
--
-- Datos personales: el Riot ID que escribe el streamer, su servidor y el PUUID
-- (el identificador que Riot da a esa cuenta para la clave de Lalo). No se
-- guarda ninguna contraseña ni permiso de Riot: no hay inicio de sesión. Tampoco
-- se guardan partidas ni rangos: se leen de Riot cuando la capa los pide y viven
-- unos segundos en la memoria del servidor. Al desvincular se borra la fila.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Módulos «pets» y «game» en la configuración sincronizada (igual que 0014)
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
     'powerups', 'music', 'kofi', 'pets', 'game'));

-- ---------------------------------------------------------------------------
-- 2. Proveedor «riot» en las cuentas conectadas
-- ---------------------------------------------------------------------------

-- En 0013 el check de `provider` se escribió en la propia columna, así que su
-- nombre lo eligió Postgres: se busca por lo que comprueba, no por cómo se llama.
do $$
declare
  v_name text;
begin
  for v_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.integration_accounts'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%provider%'
  loop
    execute format('alter table public.integration_accounts drop constraint %I', v_name);
  end loop;
end
$$;

alter table public.integration_accounts
  add constraint integration_accounts_provider_check check (provider in ('spotify', 'kofi', 'riot'));

-- ---------------------------------------------------------------------------
-- 3. Datos de la cuenta que no son secretos
-- ---------------------------------------------------------------------------

-- Riot: { "platform": "la1", "puuid": "...", "gameName": "...", "tagLine": "..." }
alter table public.integration_accounts
  add column if not exists meta jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint con
    where con.conrelid = 'public.integration_accounts'::regclass
      and con.conname = 'integration_accounts_meta_size'
  ) then
    alter table public.integration_accounts
      add constraint integration_accounts_meta_size check (meta is null or octet_length(meta::text) <= 2000);
  end if;
end
$$;
