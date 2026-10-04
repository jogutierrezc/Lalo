-- =============================================================================
-- 0005_r2_storage.sql
--
-- Los archivos de los streamers pasan a guardarse en Cloudflare R2. Las subidas
-- ya no las hace el navegador contra Supabase Storage: las autoriza el servidor
-- de Lalo (api/media/*), que comprueba el plan, y es el servidor quien escribe
-- cada fila de media_files con la clave de servicio.
--
--   1. media_files: columnas provider y object_key.
--   2. storage_settings: capacidad total (editable por el administrador) y el
--      resultado de la última prueba del almacenamiento. No guarda secretos:
--      las claves de R2 viven solo en las variables del servidor.
--   3. Funciones para el servidor: media_usage, storage_totals y
--      register_media_object (registra un archivo comprobando los límites con
--      la cuenta bloqueada).
--   4. Funciones para la app: storage_ready y admin_set_storage_capacity.
--   5. profile_usage, admin_overview y widget_bundle pasan a contar y a listar
--      lo que hay en media_files.
--
-- SIN PROBAR contra un proyecto real, igual que las anteriores. Ejecutar
-- después de 0001 a 0004. Se puede volver a ejecutar. Los puntos dudosos están
-- marcados con "REVISAR".
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. media_files
-- -----------------------------------------------------------------------------

alter table public.media_files
  add column if not exists provider text not null default 'r2';
alter table public.media_files
  add column if not exists object_key text;

-- Las filas anteriores a esta migración (sin object_key) venían de Supabase Storage.
update public.media_files set provider = 'supabase' where object_key is null and provider = 'r2';

alter table public.media_files drop constraint if exists media_files_provider_check;
alter table public.media_files
  add constraint media_files_provider_check check (provider in ('r2', 'supabase'));
alter table public.media_files drop constraint if exists media_files_r2_has_key;
alter table public.media_files
  add constraint media_files_r2_has_key check (provider <> 'r2' or object_key is not null);

create unique index if not exists media_files_object_key_idx
  on public.media_files (object_key) where object_key is not null;

-- Valida cada fila nueva. Las de R2 solo las puede escribir el servidor de Lalo
-- (clave de servicio), que ya comprobó el tamaño y el tipo reales en R2. Las de
-- Supabase Storage siguen la validación de 0001.
-- REVISAR: se asume que auth.role() devuelve 'service_role' cuando la petición
-- llega con la clave de servicio, también dentro de register_media_object.
create or replace function public.media_files_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_folder   text;
  v_max_file bigint;
  v_meta     jsonb;
  v_found    boolean := false;
begin
  if new.provider = 'r2' then
    if coalesce((select auth.role()), '') <> 'service_role' then
      raise exception 'media_r2_only_from_server';
    end if;
    new.path := coalesce(new.path, new.object_key);
    new.kind := case
                  when new.mime like 'image/%' then 'image'
                  when new.mime like 'video/%' then 'video'
                  when new.mime like 'audio/%' then 'audio'
                  else new.kind
                end;
    return new;
  end if;

  select p.media_folder, coalesce(pl.max_file_bytes, 0)
    into v_folder, v_max_file
  from public.profiles p
  left join public.plans pl on pl.id = p.plan_id
  where p.id = new.profile_id;

  if v_folder is null or split_part(new.path, '/', 1) <> v_folder then
    raise exception 'media_path_outside_own_folder';
  end if;

  select true, o.metadata into v_found, v_meta
  from storage.objects o
  where o.bucket_id = 'media' and o.name = new.path;

  if not coalesce(v_found, false) then
    raise exception 'media_object_not_found';
  end if;

  new.size_bytes := coalesce((v_meta ->> 'size')::bigint, new.size_bytes);
  new.mime       := coalesce(v_meta ->> 'mimetype', new.mime);
  new.kind       := case
                      when new.mime like 'image/%' then 'image'
                      when new.mime like 'video/%' then 'video'
                      when new.mime like 'audio/%' then 'audio'
                      else new.kind
                    end;

  if new.size_bytes > v_max_file then
    raise exception 'media_file_too_large';
  end if;

  return new;
end;
$$;

-- Un archivo de R2 se borra por el servidor (api/media/delete), que quita
-- también el objeto. Por la API directa solo se pueden borrar las filas antiguas.
drop policy if exists media_files_delete on public.media_files;
create policy media_files_delete on public.media_files
  for delete to authenticated
  using (provider <> 'r2'
         and ((profile_id = (select auth.uid()) and (select public.is_active_user()))
              or (select public.is_admin())));

-- -----------------------------------------------------------------------------
-- 2. Ajustes del almacenamiento (una sola fila)
-- -----------------------------------------------------------------------------

create table if not exists public.storage_settings (
  id               smallint primary key default 1 check (id = 1),
  -- 10 GB: el almacenamiento gratuito de R2 según developers.cloudflare.com/r2/pricing
  capacity_bytes   bigint not null default 10737418240 check (capacity_bytes > 0),
  last_test_at     timestamptz,
  last_test_ok     boolean,
  last_test_step   text,
  last_test_detail text,
  updated_at       timestamptz not null default now()
);

insert into public.storage_settings (id) values (1) on conflict (id) do nothing;

alter table public.storage_settings enable row level security;
revoke all on public.storage_settings from anon, authenticated;
grant select on public.storage_settings to authenticated;
grant all on public.storage_settings to service_role;

-- Solo lectura y solo para administradores. Escribir: el administrador por
-- admin_set_storage_capacity y el servidor con la clave de servicio.
drop policy if exists storage_settings_admin_select on public.storage_settings;
create policy storage_settings_admin_select on public.storage_settings
  for select to authenticated
  using ((select public.is_admin()));

create or replace function public.admin_set_storage_capacity(p_bytes bigint)
returns bigint
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  if p_bytes is null or p_bytes <= 0 then
    raise exception 'capacity_must_be_positive';
  end if;

  insert into public.storage_settings (id, capacity_bytes, updated_at)
  values (1, p_bytes, now())
  on conflict (id) do update set capacity_bytes = excluded.capacity_bytes, updated_at = now();

  return p_bytes;
end;
$$;

-- ¿Pasó la última prueba del almacenamiento? Lo pregunta «Mi cuenta» para no
-- ofrecer una subida que va a fallar.
create or replace function public.storage_ready()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select s.last_test_ok from public.storage_settings s where s.id = 1), false);
$$;

-- -----------------------------------------------------------------------------
-- 3. Funciones para el servidor (solo clave de servicio)
-- -----------------------------------------------------------------------------

create or replace function public.media_usage(p_profile uuid)
returns table (bytes_used bigint, file_count bigint)
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(m.size_bytes), 0)::bigint, count(*)::bigint
  from public.media_files m
  where m.profile_id = p_profile;
$$;

create or replace function public.storage_totals()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'bytes', coalesce(sum(m.size_bytes), 0),
    'files', count(*)
  )
  from public.media_files m;
$$;

-- Registra un archivo ya subido a R2. Bloquea la fila del perfil, así dos
-- subidas a la vez no pueden pasar las dos la comprobación del límite.
-- Devuelve {"result": "ok", "file": {...}} o {"result": motivo}:
--   not_active | wrong_folder | file_too_large | too_many_files | storage_full
create or replace function public.register_media_object(
  p_profile uuid,
  p_key     text,
  p_name    text,
  p_mime    text,
  p_size    bigint
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_status text;
  v_folder text;
  v_plan   text;
  v_limit  bigint;
  v_max    bigint;
  v_files  int;
  v_bytes  bigint;
  v_count  bigint;
  v_row    public.media_files;
begin
  select p.status, p.media_folder, p.plan_id
    into v_status, v_folder, v_plan
  from public.profiles p
  where p.id = p_profile
  for update;

  if not found or v_status <> 'active' then
    return jsonb_build_object('result', 'not_active');
  end if;
  if position('/' in p_key) < 2 or split_part(p_key, '/', 1) <> v_folder then
    return jsonb_build_object('result', 'wrong_folder');
  end if;

  select coalesce(pl.storage_limit_bytes, 0), coalesce(pl.max_file_bytes, 0), coalesce(pl.max_files, 0)
    into v_limit, v_max, v_files
  from public.plans pl where pl.id = v_plan;
  v_limit := coalesce(v_limit, 0);
  v_max   := coalesce(v_max, 0);
  v_files := coalesce(v_files, 0);

  if p_size is null or p_size <= 0 or p_size > v_max then
    return jsonb_build_object('result', 'file_too_large');
  end if;

  select coalesce(sum(m.size_bytes), 0), count(*)
    into v_bytes, v_count
  from public.media_files m where m.profile_id = p_profile;

  if v_count >= v_files then
    return jsonb_build_object('result', 'too_many_files');
  end if;
  if v_bytes + p_size > v_limit then
    return jsonb_build_object('result', 'storage_full');
  end if;

  insert into public.media_files (profile_id, path, object_key, provider, name, kind, mime, size_bytes)
  values (
    p_profile, p_key, p_key, 'r2', left(coalesce(nullif(trim(p_name), ''), 'archivo'), 200),
    case
      when p_mime like 'video/%' then 'video'
      when p_mime like 'audio/%' then 'audio'
      else 'image'
    end,
    p_mime, p_size
  )
  returning * into v_row;

  return jsonb_build_object('result', 'ok', 'file', to_jsonb(v_row));
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Uso por perfil y totales: ahora salen de media_files
-- -----------------------------------------------------------------------------
-- Antes se medía en storage.objects (Supabase Storage). Con R2 la base de datos
-- no ve los objetos; media_files es de fiar porque sus filas de R2 solo las
-- escribe el servidor, con el tamaño que R2 le dio.

create or replace function public.profile_usage(p_profile uuid default null, p_all boolean default false)
returns table (
  profile_id          uuid,
  twitch_login        text,
  display_name        text,
  status              text,
  role                text,
  plan_id             text,
  bytes_used          bigint,
  file_count          bigint,
  storage_limit_bytes bigint,
  max_file_bytes      bigint,
  max_files           int
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_admin boolean := public.is_admin();
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not v_admin then
    p_all := false;
    p_profile := v_uid;
  elsif p_profile is null and not p_all then
    p_profile := v_uid;
  end if;

  return query
  select p.id, p.twitch_login, p.display_name, p.status, p.role, p.plan_id,
         coalesce(u.bytes_used, 0)::bigint,
         coalesce(u.file_count, 0)::bigint,
         coalesce(pl.storage_limit_bytes, 0)::bigint,
         coalesce(pl.max_file_bytes, 0)::bigint,
         coalesce(pl.max_files, 0)::int
  from public.profiles p
  left join public.plans pl on pl.id = p.plan_id
  left join lateral (
    select sum(m.size_bytes) as bytes_used, count(*) as file_count
    from public.media_files m
    where m.profile_id = p.id
  ) u on true
  where (p_all or p.id = p_profile)
  order by p.created_at;
end;
$$;

create or replace function public.admin_overview()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_profiles jsonb;
  v_totals   jsonb;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;

  select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) into v_profiles
  from public.profile_usage(null, true) u;

  select jsonb_build_object(
    'profiles',          (select count(*) from public.profiles),
    'active_profiles',   (select count(*) from public.profiles p where p.status = 'active'),
    'pending_profiles',  (select count(*) from public.profiles p where p.status = 'pending'),
    'storage_bytes',     (select coalesce(sum(m.size_bytes), 0) from public.media_files m),
    'storage_files',     (select count(*) from public.media_files),
    'storage_committed_bytes', (select coalesce(sum(pl.storage_limit_bytes), 0)
                                  from public.profiles p join public.plans pl on pl.id = p.plan_id
                                 where p.status = 'active'),
    'storage_capacity_bytes', (select s.capacity_bytes from public.storage_settings s where s.id = 1),
    'database_bytes',    pg_database_size(current_database()),
    'open_invites',      (select count(*) from public.invite_codes c
                           where c.revoked_at is null
                             and (c.expires_at is null or c.expires_at > now())
                             and c.used_count < c.max_uses)
  ) into v_totals;

  return jsonb_build_object('profiles', v_profiles, 'totals', v_totals);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Paquete del widget: cada archivo lleva su clave de objeto
-- -----------------------------------------------------------------------------
-- Dirección pública de un archivo de R2: <R2_PUBLIC_BASE_URL>/<object_key>.
-- La app la monta con VITE_R2_PUBLIC_BASE_URL (ver src/lib/storageApi.ts).
-- Las filas antiguas (provider 'supabase') siguen usando "path" como en 0001.

create or replace function public.widget_bundle(p_key text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
begin
  if p_key is null or char_length(p_key) < 32 then
    return null;
  end if;

  select * into v_profile from public.profiles p
  where p.widget_key = p_key and p.status = 'active';
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'twitch_login', v_profile.twitch_login,
      'display_name', v_profile.display_name,
      'avatar_url',   v_profile.avatar_url
    ),
    'configs', coalesce(
      (select jsonb_object_agg(c.module, c.data) from public.configs c where c.profile_id = v_profile.id),
      '{}'::jsonb),
    'media', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'id', m.id, 'path', m.path, 'name', m.name, 'kind', m.kind, 'mime', m.mime,
                'provider', m.provider, 'object_key', m.object_key)
              order by m.created_at)
         from public.media_files m where m.profile_id = v_profile.id),
      '[]'::jsonb)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Permisos de ejecución
-- -----------------------------------------------------------------------------

revoke execute on function
  public.admin_set_storage_capacity(bigint),
  public.storage_ready(),
  public.media_usage(uuid),
  public.storage_totals(),
  public.register_media_object(uuid, text, text, text, bigint)
from public, anon, authenticated;

grant execute on function
  public.admin_set_storage_capacity(bigint),
  public.storage_ready()
to authenticated;

-- Solo el servidor de Lalo, con la clave de servicio.
grant execute on function
  public.media_usage(uuid),
  public.storage_totals(),
  public.register_media_object(uuid, text, text, text, bigint)
to service_role;

-- -----------------------------------------------------------------------------
-- QUÉ QUEDA SIN CUBRIR
--
--   * Un archivo subido a R2 cuyo registro no llega a hacerse (el streamer
--     cierra la pestaña entre la subida y la confirmación) queda como objeto
--     suelto en el bucket: ocupa sitio en R2 y no cuenta para nadie aquí.
--   * La capacidad total (capacity_bytes) es un número que escribe el
--     administrador. La base de datos no impide prometer más de lo que hay.
--   * El bucket "media" de Supabase y sus políticas (0001) siguen existiendo,
--     pero la app ya no sube nada ahí.
--   * Al borrar un usuario se borran sus filas de media_files (cascade), no sus
--     objetos de R2.
-- -----------------------------------------------------------------------------
