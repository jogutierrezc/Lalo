-- ============================================================================
-- 0017_tournament_cloud.sql
--
-- Torneos, segunda entrega: inscripción pública por enlace y estado de la llave
-- en la nube.
--
-- SIN PROBAR: escrita leyendo 0001, 0012, 0013 y 0016; no se ha ejecutado contra
-- una base real. Conviene aplicarla primero en un proyecto de pruebas. Necesita
-- 0001 (profiles, is_active_user, is_admin). No depende de que 0016 esté
-- aplicada: aquí no se toca la lista de módulos de `configs`. Usa normalize() y
-- los escapes \uXXXX de las expresiones regulares: PostgreSQL 13 o posterior y
-- base en UTF-8, que es lo que da Supabase.
--
-- Qué añade:
--   1. tournaments: un torneo por streamer, con su `slug` (la dirección
--      #torneo/<slug>) y lo PÚBLICO que la página de inscripción enseña: nombre,
--      juego, tamaño de equipo, plazas, inscripción abierta o cerrada, logo,
--      patrocinadores, estilo y color. La escribe su dueño (RLS como `configs`).
--      El público no la lee: va por tournament_public.
--   2. tournament_entries: las inscripciones. RLS encendido: su dueño las lee,
--      les cambia el estado o las borra. Nadie las inserta por la API: entran
--      por tournament_register.
--   3. tournament_state: el estado vivo de la llave (equipos, resultados y
--      pantalla), con una versión entera. Su dueño lee y escribe.
--   4. tournament_public(slug): lo público de un torneo, las plazas que quedan
--      y los NOMBRES de los equipos de la llave. Anónima.
--   5. tournament_register(slug, equipo, capitán, jugadores): una inscripción
--      nueva, que entra como `pending`. Anónima, con topes contra abusos.
--   6. widget_tournament_state(clave): la fuente de OBS lee el estado y su
--      versión con la clave privada de widget (misma comprobación que
--      widget_events, 0012).
--   7. widget_tournament_apply(clave, estado, versión base): la fuente de OBS
--      guarda el estado solo si nadie lo cambió antes. Es lo que permite que un
--      «!ganador» escrito en el chat llegue al panel.
--
-- Qué puede hacer cada quien:
--   - Sin sesión ni clave: leer lo público de un torneo por su slug e
--     inscribir un equipo. Nunca recibe Riot ID, jugadores, claves de widget ni
--     identificadores de perfil.
--   - Con la clave de widget: leer y aplicar el estado de la llave de su dueño.
--     No da acceso a las inscripciones.
--   - El dueño, con sesión: todo lo suyo.
--
-- Datos personales: de cada inscripción se guarda el nombre del equipo, el Riot
-- ID del capitán y los Riot ID de los demás jugadores que el capitán escriba.
-- Los ve solo el organizador. En público sale únicamente el nombre del equipo,
-- y solo cuando el organizador lo acepta y lo mete en la llave. El estado de la
-- llave guarda nombres de equipo; el panel no copia a él los Riot ID.
-- Se borran cuando el organizador quita la inscripción, borra el enlace o se
-- borra su cuenta. Además, cada inscripción nueva (en cualquier torneo) hace
-- limpieza: fuera las rechazadas de más de 30 días y todas las de más de 180.
-- No hay tarea programada: si nadie se inscribe en ningún torneo, la limpieza
-- no corre.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------------

create table if not exists public.tournaments (
  profile_id  uuid primary key references public.profiles (id) on delete cascade,
  -- En minúsculas, de 3 a 40: letras, números y guiones, sin guion en los extremos
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name        text not null check (char_length(name) between 1 and 28),
  game        text not null check (char_length(game) between 1 and 30),
  team_size   smallint not null default 5 check (team_size between 1 and 5),
  -- Plazas: el tamaño de la llave
  slots       smallint not null default 8 check (slots in (4, 8, 16)),
  signup_open boolean not null default false,
  -- Solo direcciones públicas: lo que una <img> carga sin ejecutar nada
  logo_url    text check (logo_url is null or (char_length(logo_url) <= 600 and logo_url ~ '^https://')),
  -- Lista de {name, logo}; la página pública vuelve a validar cada entrada
  sponsors    jsonb not null default '[]'::jsonb
              check (jsonb_typeof(sponsors) = 'array' and octet_length(sponsors::text) <= 4000),
  style       text not null default 'grieta' check (style in ('grieta', 'cabina', 'estadio', 'cartel')),
  -- Color propio, o null si usa el del estilo
  color       text check (color is null or color ~ '^#[0-9a-f]{6}$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.tournament_entries (
  id         bigint generated always as identity primary key,
  profile_id uuid not null references public.tournaments (profile_id) on delete cascade,
  team       text not null check (char_length(team) between 2 and 22),
  -- El nombre sin mayúsculas ni tildes: con él se detectan los repetidos
  team_key   text not null check (char_length(team_key) between 1 and 60),
  captain    text not null check (char_length(captain) between 7 and 22),
  -- Lista de Riot ID (texto) de los demás jugadores
  players    jsonb not null default '[]'::jsonb
             check (jsonb_typeof(players) = 'array' and octet_length(players::text) <= 400),
  status     text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now()
);

-- Un mismo nombre no puede estar dos veces pendiente o aceptado en un torneo
create unique index if not exists tournament_entries_team_idx
  on public.tournament_entries (profile_id, team_key) where status <> 'rejected';
create index if not exists tournament_entries_profile_idx on public.tournament_entries (profile_id, status, created_at);
create index if not exists tournament_entries_created_idx on public.tournament_entries (created_at);

create table if not exists public.tournament_state (
  profile_id    uuid primary key references public.profiles (id) on delete cascade,
  -- El estado tal como lo entiende la app (types/tournament.ts). Una llave de 16 ocupa unos 3 kB
  state         jsonb not null check (jsonb_typeof(state) = 'object' and octet_length(state::text) <= 20000),
  -- Sube de uno en uno con cada cambio: quien escribe dice sobre qué versión lo hizo
  version       integer not null default 1 check (version >= 1),
  updated_at    timestamptz not null default now(),
  -- Tope por minuto de lo que escribe la fuente de OBS (widget_tournament_apply)
  widget_window timestamptz not null default now(),
  widget_writes integer not null default 0 check (widget_writes >= 0)
);

-- ---------------------------------------------------------------------------
-- 2. Fecha del último cambio
-- ---------------------------------------------------------------------------

create or replace function public.tournament_touch()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tournaments_touch on public.tournaments;
create trigger tournaments_touch
  before insert or update on public.tournaments
  for each row execute procedure public.tournament_touch();

drop trigger if exists tournament_state_touch on public.tournament_state;
create trigger tournament_state_touch
  before insert or update on public.tournament_state
  for each row execute procedure public.tournament_touch();

-- ---------------------------------------------------------------------------
-- 3. Permisos y RLS
-- ---------------------------------------------------------------------------

alter table public.tournaments        enable row level security;
alter table public.tournament_entries enable row level security;
alter table public.tournament_state   enable row level security;

revoke all on public.tournaments, public.tournament_entries, public.tournament_state
  from public, anon, authenticated;

grant select, insert, update, delete on public.tournaments      to authenticated;
grant select, insert, update, delete on public.tournament_state to authenticated;
-- Inscripciones: el dueño las lee, les cambia SOLO el estado y las borra. No hay permiso de insertar.
grant select, delete on public.tournament_entries to authenticated;
grant update (status) on public.tournament_entries to authenticated;

-- tournaments (como configs en 0001)
drop policy if exists tournaments_select on public.tournaments;
create policy tournaments_select on public.tournaments
  for select to authenticated
  using ((profile_id = (select auth.uid()) and (select public.is_active_user()))
         or (select public.is_admin()));

drop policy if exists tournaments_insert on public.tournaments;
create policy tournaments_insert on public.tournaments
  for insert to authenticated
  with check (profile_id = (select auth.uid()) and (select public.is_active_user()));

drop policy if exists tournaments_update on public.tournaments;
create policy tournaments_update on public.tournaments
  for update to authenticated
  using (profile_id = (select auth.uid()) and (select public.is_active_user()))
  with check (profile_id = (select auth.uid()) and (select public.is_active_user()));

drop policy if exists tournaments_delete on public.tournaments;
create policy tournaments_delete on public.tournaments
  for delete to authenticated
  using (profile_id = (select auth.uid()) and (select public.is_active_user()));

-- tournament_entries: solo su dueño. Ni siquiera el administrador las lee por la API.
drop policy if exists tournament_entries_select on public.tournament_entries;
create policy tournament_entries_select on public.tournament_entries
  for select to authenticated
  using (profile_id = (select auth.uid()) and (select public.is_active_user()));

drop policy if exists tournament_entries_update on public.tournament_entries;
create policy tournament_entries_update on public.tournament_entries
  for update to authenticated
  using (profile_id = (select auth.uid()) and (select public.is_active_user()))
  with check (profile_id = (select auth.uid()) and (select public.is_active_user()));

drop policy if exists tournament_entries_delete on public.tournament_entries;
create policy tournament_entries_delete on public.tournament_entries
  for delete to authenticated
  using (profile_id = (select auth.uid()) and (select public.is_active_user()));

-- tournament_state: solo su dueño
drop policy if exists tournament_state_select on public.tournament_state;
create policy tournament_state_select on public.tournament_state
  for select to authenticated
  using (profile_id = (select auth.uid()) and (select public.is_active_user()));

drop policy if exists tournament_state_insert on public.tournament_state;
create policy tournament_state_insert on public.tournament_state
  for insert to authenticated
  with check (profile_id = (select auth.uid()) and (select public.is_active_user()));

drop policy if exists tournament_state_update on public.tournament_state;
create policy tournament_state_update on public.tournament_state
  for update to authenticated
  using (profile_id = (select auth.uid()) and (select public.is_active_user()))
  with check (profile_id = (select auth.uid()) and (select public.is_active_user()));

drop policy if exists tournament_state_delete on public.tournament_state;
create policy tournament_state_delete on public.tournament_state
  for delete to authenticated
  using (profile_id = (select auth.uid()) and (select public.is_active_user()));

-- ---------------------------------------------------------------------------
-- 4. Ayudantes de texto (solo los usan las funciones de abajo)
-- ---------------------------------------------------------------------------

-- Sin mayúsculas, sin tildes y con un solo espacio entre palabras: igual que
-- foldText en src/utils/tournamentLogic.ts.
create or replace function public.tournament_fold(p_text text)
returns text
language sql immutable set search_path = ''
as $$
  select btrim(regexp_replace(
    regexp_replace(normalize(lower(coalesce(p_text, '')), NFD), '[̀-ͯ]', '', 'g'),
    '\s+', ' ', 'g'));
$$;

-- Texto llano escrito por alguien de fuera, o null si no se admite: caracteres
-- de control (saltos de línea incluidos), < > [ ] o marcas invisibles de
-- dirección y anchura cero, que sirven para hacer pasar un nombre por otro.
-- '[][<>[:cntrl:]]' es una lista POSIX: el corchete de cierre va el primero.
create or replace function public.tournament_clean(p_text text)
returns text
language sql immutable set search_path = ''
as $$
  select case
    when p_text is null then null
    when p_text ~ '[][<>[:cntrl:]]' then null
    when p_text ~ '[​-‏‪-‮⁦-⁩﻿]' then null
    else btrim(regexp_replace(p_text, '\s+', ' ', 'g'))
  end;
$$;

-- Riot ID: nombre de 3 a 16 caracteres, almohadilla y etiqueta de 3 a 5 letras o números.
create or replace function public.tournament_riot_id_ok(p_text text)
returns boolean
language sql immutable set search_path = ''
as $$
  select p_text is not null and p_text ~ '^[^#]{3,16}#[A-Za-z0-9]{3,5}$';
$$;

-- Los nombres de los equipos que están en la llave de un streamer, como mucho
-- 16 y ya limpios. Solo el nombre: el estado no se devuelve entero a nadie sin clave.
create or replace function public.tournament_team_names(p_profile uuid)
returns text[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(n.name order by n.ord), '{}'::text[])
  from (
    select left(btrim(regexp_replace(t.item ->> 'name', '[][<>[:cntrl:]]', '', 'g')), 22) as name, t.ord
    from public.tournament_state s,
         jsonb_array_elements(
           case when jsonb_typeof(s.state -> 'teams') = 'array' then s.state -> 'teams' else '[]'::jsonb end
         ) with ordinality as t(item, ord)
    where s.profile_id = p_profile
      and jsonb_typeof(t.item -> 'name') = 'string'
      and t.ord <= 16
  ) n
  where n.name <> '';
$$;

revoke all on function public.tournament_fold(text)          from public, anon, authenticated;
revoke all on function public.tournament_clean(text)         from public, anon, authenticated;
revoke all on function public.tournament_riot_id_ok(text)    from public, anon, authenticated;
revoke all on function public.tournament_team_names(uuid)    from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Lo público de un torneo (sin sesión)
-- ---------------------------------------------------------------------------

-- null si el slug no existe o la cuenta de su dueño no está activa. Devuelve el
-- nombre visible del canal que organiza (es público en Twitch), nunca su id de
-- perfil. De los equipos, solo el nombre.
create or replace function public.tournament_public(p_slug text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_t     public.tournaments%rowtype;
  v_org   text;
  v_names text[];
begin
  if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' then
    return null;
  end if;

  select t.* into v_t
  from public.tournaments t
  join public.profiles p on p.id = t.profile_id
  where t.slug = p_slug and p.status = 'active';
  if not found then
    return null;
  end if;

  select left(btrim(regexp_replace(coalesce(p.display_name, p.twitch_login, ''), '[][<>[:cntrl:]]', '', 'g')), 40)
    into v_org
  from public.profiles p
  where p.id = v_t.profile_id;

  v_names := public.tournament_team_names(v_t.profile_id);

  return jsonb_build_object(
    'name', v_t.name,
    'game', v_t.game,
    'organizer', coalesce(v_org, ''),
    'teamSize', v_t.team_size,
    'slots', v_t.slots,
    'open', v_t.signup_open,
    'logo', v_t.logo_url,
    'sponsors', v_t.sponsors,
    'style', v_t.style,
    'color', v_t.color,
    'teams', to_jsonb(v_names),
    'left', greatest(v_t.slots - cardinality(v_names), 0));
end;
$$;

revoke all on function public.tournament_public(text) from public;
grant execute on function public.tournament_public(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Inscripción (sin sesión)
-- ---------------------------------------------------------------------------

-- Devuelve {"code": ...}:
--   ok         inscripción guardada como «pending»
--   not_found  el slug no existe o la cuenta de su dueño no está activa
--   closed     la inscripción está cerrada
--   full       la llave ya tiene todos sus equipos
--   invalid    algún dato no vale (longitud, formato o caracteres)
--   duplicate  ya hay un equipo con ese nombre, en la llave o entre las solicitudes
--   busy       demasiadas solicitudes: 40 pendientes en el torneo o 6 en el último minuto
-- Nunca lanza un error por lo que escriba quien llama. La fila del torneo se
-- bloquea mientras dura la llamada: dos inscripciones a la vez no se saltan los topes.
create or replace function public.tournament_register(
  p_slug    text,
  p_team    text,
  p_captain text,
  p_players jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_t       public.tournaments%rowtype;
  v_names   text[];
  v_team    text;
  v_key     text;
  v_captain text;
  v_players text[] := '{}';
  v_keys    text[];
  v_item    jsonb;
  v_player  text;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' then
    return jsonb_build_object('code', 'not_found');
  end if;

  select t.* into v_t
  from public.tournaments t
  join public.profiles p on p.id = t.profile_id
  where t.slug = p_slug and p.status = 'active'
  for update of t;
  if not found then
    return jsonb_build_object('code', 'not_found');
  end if;

  if not v_t.signup_open then
    return jsonb_build_object('code', 'closed');
  end if;

  v_names := public.tournament_team_names(v_t.profile_id);
  if cardinality(v_names) >= v_t.slots then
    return jsonb_build_object('code', 'full');
  end if;

  -- Lo que llega de fuera se valida aquí, además de en el navegador
  v_team := public.tournament_clean(p_team);
  v_captain := public.tournament_clean(p_captain);
  if v_team is null or char_length(v_team) not between 2 and 22
     or v_captain is null or not public.tournament_riot_id_ok(v_captain) then
    return jsonb_build_object('code', 'invalid');
  end if;
  v_key := public.tournament_fold(v_team);
  if v_key = '' then
    return jsonb_build_object('code', 'invalid');
  end if;

  if p_players is null or jsonb_typeof(p_players) <> 'array'
     or jsonb_array_length(p_players) > v_t.team_size - 1 then
    return jsonb_build_object('code', 'invalid');
  end if;
  v_keys := array[public.tournament_fold(v_captain)];
  for v_item in select value from jsonb_array_elements(p_players) loop
    if jsonb_typeof(v_item) <> 'string' then
      return jsonb_build_object('code', 'invalid');
    end if;
    v_player := public.tournament_clean(v_item #>> '{}');
    if v_player is null or not public.tournament_riot_id_ok(v_player)
       or public.tournament_fold(v_player) = any (v_keys) then
      -- Un Riot ID mal escrito o la misma persona dos veces
      return jsonb_build_object('code', 'invalid');
    end if;
    v_keys := v_keys || public.tournament_fold(v_player);
    v_players := v_players || v_player;
  end loop;

  -- Limpieza: las rechazadas de más de 30 días y todo lo que tenga más de 180
  delete from public.tournament_entries e
  where e.created_at < now() - interval '180 days'
     or (e.status = 'rejected' and e.created_at < now() - interval '30 days');

  if exists (select 1 from unnest(v_names) as n(name) where public.tournament_fold(n.name) = v_key)
     or exists (select 1 from public.tournament_entries e
                where e.profile_id = v_t.profile_id and e.team_key = v_key and e.status <> 'rejected') then
    return jsonb_build_object('code', 'duplicate');
  end if;

  -- Topes contra abusos, por torneo
  if (select count(*) from public.tournament_entries e
      where e.profile_id = v_t.profile_id and e.status = 'pending') >= 40
     or (select count(*) from public.tournament_entries e
         where e.profile_id = v_t.profile_id and e.created_at > now() - interval '1 minute') >= 6 then
    return jsonb_build_object('code', 'busy');
  end if;

  begin
    insert into public.tournament_entries (profile_id, team, team_key, captain, players)
    values (v_t.profile_id, v_team, v_key, v_captain, to_jsonb(v_players));
  exception when unique_violation then
    return jsonb_build_object('code', 'duplicate');
  end;

  return jsonb_build_object('code', 'ok');
end;
$$;

revoke all on function public.tournament_register(text, text, text, jsonb) from public;
grant execute on function public.tournament_register(text, text, text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Estado de la llave desde la capa de OBS (clave privada de widget, sin sesión)
-- ---------------------------------------------------------------------------

-- null si la clave no existe o la cuenta no está activa. Sin estado guardado,
-- {"version": 0, "state": null}. p_have es la versión que la fuente ya tiene:
-- si es la vigente, se devuelve solo la versión, para no gastar salida de datos
-- en cada consulta.
create or replace function public.widget_tournament_state(p_key text, p_have integer default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_profile uuid;
  v_row     public.tournament_state%rowtype;
begin
  if p_key is null or char_length(p_key) < 32 then
    return null;
  end if;

  select p.id into v_profile
  from public.profiles p
  where p.widget_key = p_key and p.status = 'active';
  if not found then
    return null;
  end if;

  select s.* into v_row from public.tournament_state s where s.profile_id = v_profile;
  if not found then
    return jsonb_build_object('version', 0, 'state', null);
  end if;
  if p_have is not null and p_have = v_row.version then
    return jsonb_build_object('version', v_row.version);
  end if;
  return jsonb_build_object('version', v_row.version, 'state', v_row.state);
end;
$$;

revoke all on function public.widget_tournament_state(text, integer) from public;
grant execute on function public.widget_tournament_state(text, integer) to anon, authenticated;

-- Guarda el estado solo si p_base_version es la versión vigente (0: aún no hay
-- ninguno). Devuelve:
--   {"ok": true,  "version": n}                                   guardado
--   {"ok": false, "code": "conflict", "version": n, "state": …}   otro escribió antes: la fuente adopta ese estado
--   {"ok": false, "code": "busy"}                                 más de 60 cambios en un minuto
--   {"ok": false, "code": "invalid"}                              el estado no es un objeto o pesa demasiado
--   null                                                          la clave no vale
create or replace function public.widget_tournament_apply(p_key text, p_state jsonb, p_base_version integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_profile uuid;
  v_row     public.tournament_state%rowtype;
  v_fresh   boolean;
begin
  if p_key is null or char_length(p_key) < 32 then
    return null;
  end if;

  select p.id into v_profile
  from public.profiles p
  where p.widget_key = p_key and p.status = 'active';
  if not found then
    return null;
  end if;

  if p_state is null or jsonb_typeof(p_state) <> 'object' or octet_length(p_state::text) > 20000
     or p_base_version is null or p_base_version < 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  select s.* into v_row from public.tournament_state s where s.profile_id = v_profile for update;

  if not found then
    if p_base_version <> 0 then
      return jsonb_build_object('ok', false, 'code', 'conflict', 'version', 0, 'state', null);
    end if;
    insert into public.tournament_state (profile_id, state, version, widget_window, widget_writes)
    values (v_profile, p_state, 1, now(), 1)
    on conflict (profile_id) do nothing;
    if found then
      return jsonb_build_object('ok', true, 'version', 1);
    end if;
    -- Otro la creó en este mismo instante
    select s.* into v_row from public.tournament_state s where s.profile_id = v_profile;
    return jsonb_build_object('ok', false, 'code', 'conflict', 'version', v_row.version, 'state', v_row.state);
  end if;

  if v_row.version <> p_base_version then
    return jsonb_build_object('ok', false, 'code', 'conflict', 'version', v_row.version, 'state', v_row.state);
  end if;

  v_fresh := v_row.widget_window < now() - interval '1 minute';
  if not v_fresh and v_row.widget_writes >= 60 then
    return jsonb_build_object('ok', false, 'code', 'busy');
  end if;

  update public.tournament_state s
  set state         = p_state,
      version       = s.version + 1,
      widget_window = case when v_fresh then now() else s.widget_window end,
      widget_writes = case when v_fresh then 1 else s.widget_writes + 1 end
  where s.profile_id = v_profile;

  return jsonb_build_object('ok', true, 'version', v_row.version + 1);
end;
$$;

revoke all on function public.widget_tournament_apply(text, jsonb, integer) from public;
grant execute on function public.widget_tournament_apply(text, jsonb, integer) to anon, authenticated;
