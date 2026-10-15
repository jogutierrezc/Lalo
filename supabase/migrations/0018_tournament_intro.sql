-- ============================================================================
-- 0018_tournament_intro.sql
--
-- Torneos, tercera entrega: la presentación de la página de inscripción.
-- Antes del formulario, Axo explica el torneo en seis pasos; el streamer puede
-- apagarla y añadir sus reglas propias.
--
-- SIN PROBAR: escrita leyendo 0017; no se ha ejecutado contra una base real.
-- Conviene aplicarla primero en un proyecto de pruebas. Necesita 0017 (la tabla
-- `tournaments`, tournament_team_names y tournament_public). Se puede ejecutar
-- más de una vez: no cambia nada la segunda. Usa los escapes \uXXXX de las
-- expresiones regulares: PostgreSQL 13 o posterior y base en UTF-8, que es lo
-- que da Supabase.
--
-- Qué añade:
--   1. tournaments.intro_on: si la página enseña la presentación antes del
--      formulario. De serie, sí. Los torneos que ya existen quedan con ella
--      encendida.
--   2. tournaments.rules: las reglas propias del torneo, una lista de textos.
--      La base las valida: como mucho 6, de 1 a 110 caracteres cada una, sin
--      caracteres de control, sin < > y sin marcas invisibles de dirección o
--      anchura cero. Los mismos topes están en src/types/tournament.ts
--      (TOURNAMENT_LIMITS.rules y .rule), que limpia el texto antes de enviarlo.
--   3. tournament_public devuelve además `intro` y `rules`. Todo lo que ya
--      devolvía sigue igual, y sus permisos también.
--
-- Qué puede hacer cada quien: lo mismo que en 0017. Las dos columnas las
-- escribe el dueño del torneo con su sesión (la RLS de `tournaments` no cambia)
-- y son públicas: las lee cualquiera por tournament_public, como el nombre.
--
-- Datos personales: ninguno nuevo. Las reglas las escribe el streamer y se
-- publican tal cual; no deben llevar datos de nadie.
--
-- Mientras esta migración no esté aplicada, la app sigue funcionando: la página
-- pública enseña la presentación sin reglas propias y el panel guarda el resto
-- de lo público sin estas dos columnas (lib/tournamentSignupApi.ts).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columnas
-- ---------------------------------------------------------------------------

alter table public.tournaments
  add column if not exists intro_on boolean not null default true;

alter table public.tournaments
  add column if not exists rules jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- 2. Validación de las reglas propias
-- ---------------------------------------------------------------------------

-- true si es una lista de como mucho 6 textos de 1 a 110 caracteres, sin
-- caracteres de control (C0 y C1), sin < > y sin marcas invisibles de dirección
-- o anchura cero. El CASE evita medir como lista algo que no lo es.
create or replace function public.tournament_rules_ok(p_rules jsonb)
returns boolean
language sql immutable set search_path = ''
as $$
  select case
    when p_rules is null or jsonb_typeof(p_rules) <> 'array' then false
    when jsonb_array_length(p_rules) > 6 then false
    else not exists (
      select 1
      from jsonb_array_elements(p_rules) as r(item)
      where jsonb_typeof(r.item) <> 'string'
         or char_length(r.item #>> '{}') not between 1 and 110
         or (r.item #>> '{}') ~ '[<>\u0001-\u001f\u007f-\u009f]'
         or (r.item #>> '{}') ~ '[​-‏‪-‮⁦-⁩﻿]'
    )
  end;
$$;

-- La restricción la comprueba la base con los permisos de quien escribe la
-- fila: el dueño del torneo (authenticated) necesita poder ejecutarla.
revoke all on function public.tournament_rules_ok(jsonb) from public, anon;
grant execute on function public.tournament_rules_ok(jsonb) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tournaments_rules_check' and conrelid = 'public.tournaments'::regclass
  ) then
    alter table public.tournaments
      add constraint tournaments_rules_check check (public.tournament_rules_ok(rules));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Lo público de un torneo (sin sesión), ahora con la presentación
-- ---------------------------------------------------------------------------

-- Igual que en 0017, más `intro` y `rules`. null si el slug no existe o la
-- cuenta de su dueño no está activa. De los equipos, solo el nombre.
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
    'left', greatest(v_t.slots - cardinality(v_names), 0),
    'intro', v_t.intro_on,
    'rules', v_t.rules);
end;
$$;

revoke all on function public.tournament_public(text) from public;
grant execute on function public.tournament_public(text) to anon, authenticated;
