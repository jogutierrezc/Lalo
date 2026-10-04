-- =============================================================================
-- 0009_voices.sql
--
-- El catálogo de voces pasa del código a la base de datos, para que el
-- administrador pueda crear, ocultar y eliminar voces desde la consola.
--
--   1. voices: una fila por voz, con el id del modelo en Fish Audio, si los
--      streamers la ven, cuál es la voz por defecto (solo una), de dónde salió
--      y el permiso con el que se creó.
--   2. voices_removed: registro de las voces eliminadas. Sirve para saber que
--      un id guardado por un streamer era del catálogo y ya no existe.
--   3. Las cinco voces que estaban escritas en src/types/settings.ts, cargadas
--      como iniciales con sus mismos ids. Chispa es la voz por defecto.
--   4. RLS: quien ha iniciado sesión lee las voces visibles (sin los datos del
--      permiso). El administrador lee todo con admin_voices() y cambia la
--      visibilidad y la voz por defecto con RPCs, como en profiles (0001).
--      Crear y eliminar tocan Fish Audio: los hace el servidor de Lalo
--      (api/voices/*) con la clave de servicio.
--
-- SIN PROBAR contra un proyecto real, igual que las anteriores. Ejecutar
-- después de 0001 a 0008. Se puede volver a ejecutar. Los puntos dudosos están
-- marcados con "REVISAR".
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tablas
-- -----------------------------------------------------------------------------

create table if not exists public.voices (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(trim(name)) between 1 and 18),
  description  text not null default '' check (char_length(description) <= 70),
  -- Id del modelo en Fish Audio. Es lo que guarda cada streamer en su
  -- configuración (configs, módulo 'tts', clave referenceId).
  reference_id text not null unique check (char_length(reference_id) between 8 and 64),
  visible      boolean not null default false,
  is_default   boolean not null default false,
  origin       text not null default 'initial' check (origin in ('initial', 'recorded', 'uploaded')),
  -- De quién es la voz: 'own' (del administrador que la creó), 'other' (de otra
  -- persona, con su permiso) o 'unknown' (las iniciales, anteriores al registro).
  voice_owner  text not null default 'unknown' check (voice_owner in ('own', 'other', 'unknown')),
  -- Quién dio el permiso, cuando la voz es de otra persona.
  permission_by text check (permission_by is null or char_length(permission_by) <= 60),
  -- Cuándo marcó el administrador la casilla de confirmación.
  permission_confirmed_at timestamptz,
  created_by   uuid,  -- sin FK a propósito: la voz sobrevive si se borra al admin
  created_at   timestamptz not null default now(),
  -- La voz por defecto siempre es visible.
  constraint voices_default_is_visible check (not is_default or visible),
  -- Una voz de otra persona siempre dice quién dio el permiso.
  constraint voices_other_has_permission check (voice_owner <> 'other' or char_length(trim(coalesce(permission_by, ''))) >= 2),
  -- Una voz creada desde la consola siempre lleva la confirmación.
  constraint voices_created_is_confirmed check (origin = 'initial' or permission_confirmed_at is not null)
);

-- Solo una voz puede ser la voz por defecto.
create unique index if not exists voices_single_default
  on public.voices (is_default) where is_default;

-- Nombre único sin distinguir mayúsculas.
create unique index if not exists voices_name_unique
  on public.voices (lower(trim(name)));

create table if not exists public.voices_removed (
  reference_id text primary key,
  name         text not null,
  origin       text,
  -- false: el modelo se dejó en Fish Audio (no era de esta clave o ya no existía).
  fish_deleted boolean not null default false,
  removed_by   uuid,
  removed_at   timestamptz not null default now()
);

-- La voz por defecto no se puede borrar, tampoco con la clave de servicio.
create or replace function public.voices_guard_delete()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if old.is_default then
    raise exception 'default_voice_cannot_be_deleted';
  end if;
  return old;
end;
$$;

drop trigger if exists voices_guard_delete on public.voices;
create trigger voices_guard_delete
  before delete on public.voices
  for each row execute procedure public.voices_guard_delete();

-- -----------------------------------------------------------------------------
-- 2. Las cinco voces iniciales
-- -----------------------------------------------------------------------------
-- Solo se cargan la primera vez: si ya hay voces, o si el administrador ya
-- eliminó alguna, volver a ejecutar la migración no las resucita.
-- Las fechas van escalonadas para que el orden sea el de siempre.
insert into public.voices (name, description, reference_id, visible, is_default, origin, voice_owner, created_at)
select s.name, s.description, s.reference_id, true, s.is_default, 'initial', 'unknown',
       now() - interval '1 hour' + make_interval(secs => s.pos)
from (values
  (1, 'Chispa', 'Aguda y traviesa.',             '5669f8e58ecb476a982bc2b67ac6b538', true),
  (2, 'Seda',   'Suave y cercana.',              '31dbd39039854d379d1d692a6a97451d', false),
  (3, 'Atlas',  'Formal y serena, de asistente.', '59fb1f7a5e69481387cc280b9d2b3ad8', false),
  (4, 'Vera',   'Firme y pausada.',              '37f9f4eec7624089a49b188d47588f2c', false),
  (5, 'Brisa',  'Joven y alegre.',               '654e33e85be3406d90b9723712a035a9', false)
) as s (pos, name, description, reference_id, is_default)
where not exists (select 1 from public.voices)
  and not exists (select 1 from public.voices_removed);

-- -----------------------------------------------------------------------------
-- 3. Row Level Security
-- -----------------------------------------------------------------------------

alter table public.voices         enable row level security;
alter table public.voices_removed enable row level security;

revoke all on public.voices, public.voices_removed from anon, authenticated;
grant all on public.voices, public.voices_removed to service_role;

-- Quien ha iniciado sesión lee solo estas columnas: los datos del permiso
-- (nombre de una tercera persona) quedan para el administrador.
-- REVISAR: con permisos por columna, un "select *" desde la app falla; la app
-- pide siempre estas columnas por su nombre (src/lib/voicesCloud.ts).
grant select (id, name, description, reference_id, visible, is_default, origin, created_at)
  on public.voices to authenticated;

drop policy if exists voices_select on public.voices;
create policy voices_select on public.voices
  for select to authenticated
  using (visible or (select public.is_admin()));

-- voices_removed no tiene políticas: por la API no lo lee nadie. Lo consultan
-- voice_state y el servidor.

-- -----------------------------------------------------------------------------
-- 4. RPCs
-- -----------------------------------------------------------------------------

-- ¿Qué pasa con el id de voz que un streamer tiene guardado?
--   'visible': está en el catálogo y se puede elegir.
--   'retired': era del catálogo, pero está oculta o se eliminó. La app usa la
--              voz por defecto en su lugar.
--   'unknown': nunca fue del catálogo (un id propio del streamer).
create or replace function public.voice_state(p_reference_id text)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_visible boolean;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;

  select v.visible into v_visible from public.voices v where v.reference_id = trim(p_reference_id);
  if found then
    return case when v_visible then 'visible' else 'retired' end;
  end if;
  if exists (select 1 from public.voices_removed r where r.reference_id = trim(p_reference_id)) then
    return 'retired';
  end if;
  return 'unknown';
end;
$$;

-- Catálogo completo para la consola, con cuántos streamers tienen guardada
-- cada voz. La cuenta sale de la configuración sincronizada (configs, módulo
-- 'tts'); quien nunca ha guardado ajustes usa la voz por defecto y no aparece.
create or replace function public.admin_voices()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(v) || jsonb_build_object('streamers', coalesce(u.streamers, 0))
                     order by v.created_at)
    from public.voices v
    left join (
      select c.data ->> 'referenceId' as reference_id, count(*) as streamers
      from public.configs c
      join public.profiles p on p.id = c.profile_id
      where c.module = 'tts' and p.role = 'streamer'
      group by 1
    ) u on u.reference_id = v.reference_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_set_voice_visible(p_voice uuid, p_visible boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_default boolean;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;

  select v.is_default into v_default from public.voices v where v.id = p_voice for update;
  if not found then
    raise exception 'voice_not_found';
  end if;
  if v_default and not coalesce(p_visible, false) then
    raise exception 'default_voice_cannot_be_hidden';
  end if;

  update public.voices set visible = coalesce(p_visible, false) where id = p_voice;
end;
$$;

-- Cambia la voz por defecto. La nueva queda visible. Las dos escrituras van en
-- la misma transacción, así nunca hay dos voces por defecto ni ninguna.
create or replace function public.admin_set_default_voice(p_voice uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  if not exists (select 1 from public.voices v where v.id = p_voice) then
    raise exception 'voice_not_found';
  end if;

  update public.voices set is_default = false where is_default and id <> p_voice;
  update public.voices set is_default = true, visible = true where id = p_voice;
end;
$$;

-- Quita una voz del catálogo y deja constancia. Solo la llama el servidor de
-- Lalo, después de borrar (o intentar borrar) el modelo en Fish Audio.
-- Devuelve 'ok' | 'not_found' | 'is_default'.
create or replace function public.remove_voice(p_voice uuid, p_removed_by uuid, p_fish_deleted boolean)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.voices%rowtype;
begin
  select * into v_row from public.voices v where v.id = p_voice for update;
  if not found then
    return 'not_found';
  end if;
  if v_row.is_default then
    return 'is_default';
  end if;

  insert into public.voices_removed (reference_id, name, origin, fish_deleted, removed_by)
  values (v_row.reference_id, v_row.name, v_row.origin, coalesce(p_fish_deleted, false), p_removed_by)
  on conflict (reference_id) do update
    set name = excluded.name, origin = excluded.origin, fish_deleted = excluded.fish_deleted,
        removed_by = excluded.removed_by, removed_at = now();

  delete from public.voices where id = p_voice;
  return 'ok';
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Permisos de ejecución
-- -----------------------------------------------------------------------------

revoke execute on function
  public.voice_state(text),
  public.admin_voices(),
  public.admin_set_voice_visible(uuid, boolean),
  public.admin_set_default_voice(uuid),
  public.remove_voice(uuid, uuid, boolean)
from public, anon, authenticated;

grant execute on function
  public.voice_state(text),
  public.admin_voices(),
  public.admin_set_voice_visible(uuid, boolean),
  public.admin_set_default_voice(uuid)
to authenticated;

-- Solo el servidor de Lalo, con la clave de servicio.
grant execute on function
  public.remove_voice(uuid, uuid, boolean)
to service_role;

-- -----------------------------------------------------------------------------
-- QUÉ QUEDA SIN CUBRIR
--
--   * La base de datos no sabe si el modelo existe de verdad en Fish Audio. Si
--     alguien lo borra desde la web de Fish Audio, la voz sigue en el catálogo
--     y, al usarla, el servidor de voz responde con la voz base.
--   * La configuración guardada de cada streamer no se toca al ocultar o
--     eliminar una voz. Es la app la que, al abrir el panel, ve que su voz ya
--     no está (voice_state) y pasa a la voz por defecto.
--   * La capa de OBS no consulta este catálogo: usa el id que lleva en su
--     configuración sincronizada.
--   * Las voces iniciales no tienen registro de permiso (voice_owner 'unknown'):
--     son anteriores a esta tabla.
-- -----------------------------------------------------------------------------
