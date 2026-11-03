-- =============================================================================
-- 0001_lalo_baseline.sql  (GENERADO: no editar a mano)
--
-- Une, en orden, las 54 migraciones de supabase/migrations/ (0001_lalo_init.sql a 0054_done_ai.sql).
-- Para proyectos Supabase NUEVOS. Regenerar: node scripts/build-supabase-baseline.mjs
-- El historial detallado sigue en supabase/migrations/ (los tests leen esos archivos).
-- =============================================================================

-- >>>>>>>>>> 0001_lalo_init.sql >>>>>>>>>>
-- =============================================================================
-- 0001_lalo_init.sql
--
-- Base de datos inicial de Lalo Stream Suite en Supabase: planes, perfiles,
-- códigos de invitación y de recuperación, configuración por módulo, biblioteca
-- de medios, cuotas, RLS, RPCs y el bucket "media".
--
-- AVISO: este SQL NO se ha ejecutado contra un proyecto real. Los puntos
-- dudosos están marcados con "REVISAR". Ejecutar primero en un proyecto de
-- pruebas. Se puede volver a ejecutar (if not exists / or replace / drop if
-- exists), pero no migra cambios de columnas de una versión anterior.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tablas
-- -----------------------------------------------------------------------------

create table if not exists public.plans (
  id                  text primary key,
  name                text not null,
  storage_limit_bytes bigint not null check (storage_limit_bytes >= 0),
  max_file_bytes      bigint not null check (max_file_bytes >= 0),
  max_files           int    not null check (max_files >= 0),
  is_default          boolean not null default false
);

-- Solo un plan puede ser el predeterminado.
create unique index if not exists plans_single_default
  on public.plans (is_default) where is_default;

-- VALORES PROVISIONALES: el administrador debe ajustarlos a la capacidad real
-- del proyecto (tabla public.plans). No se sobrescriben si ya existen.
insert into public.plans (id, name, storage_limit_bytes, max_file_bytes, max_files, is_default)
values
  ('basico', 'Básico',  40 * 1024 * 1024,  5 * 1024 * 1024, 30, true),   -- PROVISIONAL
  ('plus',   'Plus',   120 * 1024 * 1024, 15 * 1024 * 1024, 80, false)   -- PROVISIONAL
on conflict (id) do nothing;

create table if not exists public.invite_codes (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  plan_id    text not null references public.plans (id),
  max_uses   int  not null default 1 check (max_uses >= 1),
  used_count int  not null default 0 check (used_count >= 0),
  expires_at timestamptz,
  revoked_at timestamptz,
  note       text,
  created_by uuid,  -- sin FK a propósito: el código sobrevive si se borra al admin
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  twitch_user_id text unique,
  twitch_login   text,
  display_name   text,
  avatar_url     text,
  role           text not null default 'streamer' check (role in ('streamer', 'admin')),
  status         text not null default 'pending'  check (status in ('pending', 'active', 'suspended')),
  plan_id        text references public.plans (id),
  -- Llave privada de solo lectura para el widget de OBS (64 caracteres hex).
  widget_key     text not null unique
                 default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  -- Carpeta del bucket "media". Por defecto es el id del usuario; solo cambia
  -- al recuperar una cuenta (el perfil nuevo hereda la carpeta del anterior,
  -- porque los archivos de Storage no se pueden mover con SQL).
  media_folder   text not null unique,
  invite_code_id uuid references public.invite_codes (id) on delete set null,
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz
);

create table if not exists public.invite_redemptions (
  invite_code_id uuid not null references public.invite_codes (id) on delete cascade,
  profile_id     uuid not null references public.profiles (id) on delete cascade,
  redeemed_at    timestamptz not null default now(),
  primary key (invite_code_id, profile_id)
);

create table if not exists public.recovery_codes (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  code_hash  text not null unique,   -- sha256 en hex; el código en claro no se guarda
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.configs (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  module     text not null check (module in
               ('tts', 'alerts', 'goals', 'roulette', 'polls', 'rewards', 'bot', 'marathon', 'focus', 'raid')),
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (profile_id, module),
  -- Guarda de tamaño: 200 kB por módulo (medido sobre el texto del jsonb).
  constraint configs_data_size check (octet_length(data::text) <= 200000)
);

create table if not exists public.media_files (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  path       text not null unique,   -- nombre del objeto en el bucket "media": <carpeta>/<archivo>
  name       text not null check (char_length(name) between 1 and 200),
  kind       text not null check (kind in ('image', 'video', 'audio')),
  mime       text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  created_at timestamptz not null default now()
);

create index if not exists media_files_profile_idx on public.media_files (profile_id);
create index if not exists recovery_codes_profile_idx on public.recovery_codes (profile_id);

-- -----------------------------------------------------------------------------
-- 2. Funciones auxiliares (SECURITY DEFINER para no recursar en RLS)
-- -----------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin' and p.status = 'active'
  );
$$;

create or replace function public.is_active_user()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'active'
  );
$$;

-- ¿El objeto "p_name" está dentro de la carpeta del usuario activo que llama?
create or replace function public.media_path_allowed(p_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select position('/' in p_name) > 1 and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.status = 'active'
      and p.media_folder = split_part(p_name, '/', 1)
  );
$$;

-- Uso real por perfil, medido en storage.objects (no en media_files, que lo
-- escribe el cliente). Sin argumento: el propio usuario. Un admin puede pedir
-- cualquier perfil o todos (p_profile null + p_all true).
-- REVISAR: se asume que storage.objects.metadata->>'size' contiene el tamaño en
-- bytes. Es el comportamiento conocido de Supabase Storage, pero la
-- documentación oficial no detalla las claves de "metadata".
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
    -- Un streamer solo puede ver su propio uso.
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
    select sum(coalesce((o.metadata ->> 'size')::bigint, 0)) as bytes_used,
           count(*) as file_count
    from storage.objects o
    where o.bucket_id = 'media'
      and split_part(o.name, '/', 1) = p.media_folder
  ) u on true
  where (p_all or p.id = p_profile)
  order by p.created_at;
end;
$$;

-- Cuota previa a la subida: ¿le queda sitio al usuario que llama?
-- Solo puede comprobar "ya está lleno" (bytes y número de archivos): en el
-- momento del INSERT en storage.objects todavía no se conoce el tamaño del
-- archivo que se está subiendo.
create or replace function public.media_quota_ok()
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_folder text;
  v_limit  bigint;
  v_max    int;
  v_bytes  bigint;
  v_count  bigint;
begin
  select p.media_folder, coalesce(pl.storage_limit_bytes, 0), coalesce(pl.max_files, 0)
    into v_folder, v_limit, v_max
  from public.profiles p
  left join public.plans pl on pl.id = p.plan_id
  where p.id = (select auth.uid()) and p.status = 'active';

  if v_folder is null then
    return false;
  end if;

  select coalesce(sum(coalesce((o.metadata ->> 'size')::bigint, 0)), 0), count(*)
    into v_bytes, v_count
  from storage.objects o
  where o.bucket_id = 'media' and split_part(o.name, '/', 1) = v_folder;

  return v_bytes < v_limit and v_count < v_max;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Disparadores
-- -----------------------------------------------------------------------------

-- Crea el perfil en estado 'pending' al registrarse un usuario.
-- Claves de raw_user_meta_data para Twitch, según el código del proveedor en
-- supabase/auth (internal/api/provider/twitch.go): provider_id / sub = id de
-- Twitch, name = login, nickname = nombre visible, avatar_url / picture = avatar.
-- REVISAR tras el primer inicio de sesión real:
--   select raw_user_meta_data from auth.users;
-- Si este disparador falla, el registro del usuario falla (aviso de la
-- documentación de Supabase); por eso no lanza errores propios.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_meta      jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_twitch_id text  := coalesce(v_meta ->> 'provider_id', v_meta ->> 'sub');
begin
  -- Si ese id de Twitch ya pertenece a otro perfil, se deja en null para no
  -- bloquear el registro por la restricción unique.
  if v_twitch_id is not null
     and exists (select 1 from public.profiles p where p.twitch_user_id = v_twitch_id) then
    v_twitch_id := null;
  end if;

  insert into public.profiles (id, twitch_user_id, twitch_login, display_name, avatar_url, media_folder)
  values (
    new.id,
    v_twitch_id,
    coalesce(v_meta ->> 'name', v_meta ->> 'full_name'),
    coalesce(v_meta ->> 'nickname', v_meta ->> 'slug', v_meta ->> 'name'),
    coalesce(v_meta ->> 'avatar_url', v_meta ->> 'picture'),
    new.id::text
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Usuarios que ya existieran antes de esta migración: perfil pendiente mínimo
-- (touch_profile completa después los datos de Twitch).
insert into public.profiles (id, media_folder)
select u.id, u.id::text from auth.users u
on conflict (id) do nothing;

create or replace function public.configs_touch()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists configs_touch on public.configs;
create trigger configs_touch
  before insert or update on public.configs
  for each row execute procedure public.configs_touch();

-- Valida cada fila de media_files contra el objeto real de Storage y el plan.
-- El tamaño y el MIME se toman de storage.objects, no de lo que diga el cliente.
-- REVISAR: claves 'size' y 'mimetype' de storage.objects.metadata (ver arriba).
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

  -- Límite por archivo del plan. Si se supera, el objeto ya está en Storage:
  -- el cliente debe borrarlo (sigue contando en el uso hasta entonces).
  if new.size_bytes > v_max_file then
    raise exception 'media_file_too_large';
  end if;

  return new;
end;
$$;

drop trigger if exists media_files_guard on public.media_files;
create trigger media_files_guard
  before insert on public.media_files
  for each row execute procedure public.media_files_guard();

-- -----------------------------------------------------------------------------
-- 4. Row Level Security
--
-- Resumen: un streamer solo ve y escribe lo suyo y solo si está 'active'.
-- Los admins leen todo. Nadie (ni un admin) puede escribir directamente en
-- profiles: rol, estado y plan solo cambian por las RPC de abajo, y
-- admin_set_profile rechaza que alguien se modifique a sí mismo.
-- -----------------------------------------------------------------------------

alter table public.plans              enable row level security;
alter table public.profiles           enable row level security;
alter table public.invite_codes       enable row level security;
alter table public.invite_redemptions enable row level security;
alter table public.recovery_codes     enable row level security;
alter table public.configs            enable row level security;
alter table public.media_files        enable row level security;

-- Sin acceso anónimo directo a las tablas: anon solo usa check_invite y widget_bundle.
revoke all on public.plans, public.profiles, public.invite_codes, public.invite_redemptions,
              public.recovery_codes, public.configs, public.media_files
  from anon;

-- profiles: solo lectura por API; las escrituras van por RPC.
revoke insert, update, delete on public.profiles from authenticated;
-- media_files: solo se puede renombrar (columna name).
revoke update on public.media_files from authenticated;
grant update (name) on public.media_files to authenticated;
-- recovery_codes e invite_redemptions: solo lectura por API.
revoke insert, update, delete on public.recovery_codes, public.invite_redemptions from authenticated;

-- plans
drop policy if exists plans_select on public.plans;
create policy plans_select on public.plans
  for select to authenticated using (true);

drop policy if exists plans_admin_write on public.plans;
create policy plans_admin_write on public.plans
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- profiles (el propio perfil se puede leer aunque esté pendiente o suspendido,
-- para que la interfaz sepa en qué estado está)
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

-- invite_codes
drop policy if exists invite_codes_admin on public.invite_codes;
create policy invite_codes_admin on public.invite_codes
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- invite_redemptions
drop policy if exists invite_redemptions_select on public.invite_redemptions;
create policy invite_redemptions_select on public.invite_redemptions
  for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_admin()));

-- recovery_codes
drop policy if exists recovery_codes_admin_select on public.recovery_codes;
create policy recovery_codes_admin_select on public.recovery_codes
  for select to authenticated
  using ((select public.is_admin()));

-- configs
drop policy if exists configs_select on public.configs;
create policy configs_select on public.configs
  for select to authenticated
  using ((profile_id = (select auth.uid()) and (select public.is_active_user()))
         or (select public.is_admin()));

drop policy if exists configs_insert on public.configs;
create policy configs_insert on public.configs
  for insert to authenticated
  with check (profile_id = (select auth.uid()) and (select public.is_active_user()));

drop policy if exists configs_update on public.configs;
create policy configs_update on public.configs
  for update to authenticated
  using (profile_id = (select auth.uid()) and (select public.is_active_user()))
  with check (profile_id = (select auth.uid()) and (select public.is_active_user()));

drop policy if exists configs_delete on public.configs;
create policy configs_delete on public.configs
  for delete to authenticated
  using (profile_id = (select auth.uid()) and (select public.is_active_user()));

-- media_files
drop policy if exists media_files_select on public.media_files;
create policy media_files_select on public.media_files
  for select to authenticated
  using ((profile_id = (select auth.uid()) and (select public.is_active_user()))
         or (select public.is_admin()));

drop policy if exists media_files_insert on public.media_files;
create policy media_files_insert on public.media_files
  for insert to authenticated
  with check (profile_id = (select auth.uid()) and (select public.is_active_user()));

drop policy if exists media_files_update on public.media_files;
create policy media_files_update on public.media_files
  for update to authenticated
  using (profile_id = (select auth.uid()) and (select public.is_active_user()))
  with check (profile_id = (select auth.uid()) and (select public.is_active_user()));

drop policy if exists media_files_delete on public.media_files;
create policy media_files_delete on public.media_files
  for delete to authenticated
  using ((profile_id = (select auth.uid()) and (select public.is_active_user()))
         or (select public.is_admin()));

-- -----------------------------------------------------------------------------
-- 5. RPCs
-- -----------------------------------------------------------------------------

-- Estado de un código de invitación. Devuelve solo estado y nombre del plan.
-- Nota: no hay límite de intentos a nivel de base de datos; la defensa es la
-- longitud del código (12 caracteres hex aleatorios).
create or replace function public.check_invite(p_code text)
returns table (status text, plan_name text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_code public.invite_codes%rowtype;
begin
  select * into v_code from public.invite_codes c where c.code = upper(trim(p_code));

  if not found then
    return query select 'not_found'::text, null::text;
  elsif v_code.revoked_at is not null then
    return query select 'revoked'::text, null::text;
  elsif v_code.expires_at is not null and v_code.expires_at <= now() then
    return query select 'expired'::text, null::text;
  elsif v_code.used_count >= v_code.max_uses then
    return query select 'used_up'::text, null::text;
  else
    return query select 'valid'::text, (select pl.name from public.plans pl where pl.id = v_code.plan_id);
  end if;
end;
$$;

-- Canjea un código: activa el perfil pendiente del usuario que llama.
-- Devuelve 'ok' o el motivo: not_found | revoked | expired | used_up | not_pending.
create or replace function public.redeem_invite(p_code text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_status text;
  v_code   public.invite_codes%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select p.status into v_status from public.profiles p where p.id = v_uid for update;
  if v_status is distinct from 'pending' then
    return 'not_pending';
  end if;

  -- El bloqueo de fila hace atómico el incremento de used_count.
  select * into v_code from public.invite_codes c
  where c.code = upper(trim(p_code)) for update;

  if not found then
    return 'not_found';
  elsif v_code.revoked_at is not null then
    return 'revoked';
  elsif v_code.expires_at is not null and v_code.expires_at <= now() then
    return 'expired';
  elsif v_code.used_count >= v_code.max_uses then
    return 'used_up';
  end if;

  update public.invite_codes set used_count = used_count + 1 where id = v_code.id;

  insert into public.invite_redemptions (invite_code_id, profile_id)
  values (v_code.id, v_uid)
  on conflict do nothing;

  update public.profiles
     set status = 'active', plan_id = v_code.plan_id, invite_code_id = v_code.id
   where id = v_uid;

  return 'ok';
end;
$$;

-- Genera una llave de widget nueva (invalida las URL de OBS anteriores).
create or replace function public.rotate_widget_key()
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_key text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  update public.profiles set widget_key = v_key
   where id = (select auth.uid()) and status = 'active';
  if not found then
    raise exception 'not_active';
  end if;
  return v_key;
end;
$$;

-- Actualiza last_seen_at y refresca los datos de Twitch del propio perfil.
create or replace function public.touch_profile()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_meta jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  select coalesce(u.raw_user_meta_data, '{}'::jsonb) into v_meta from auth.users u where u.id = v_uid;

  update public.profiles p
     set last_seen_at = now(),
         twitch_login = coalesce(v_meta ->> 'name', v_meta ->> 'full_name', p.twitch_login),
         display_name = coalesce(v_meta ->> 'nickname', v_meta ->> 'slug', p.display_name),
         avatar_url   = coalesce(v_meta ->> 'avatar_url', v_meta ->> 'picture', p.avatar_url)
   where p.id = v_uid;
end;
$$;

-- Todo lo que necesita el widget de OBS, a partir de la llave privada.
-- Devuelve null si la llave no existe o el perfil no está activo.
-- IMPORTANTE: cualquiera con la llave lee TODOS los módulos de configs. No
-- guardar ahí tokens ni secretos (por ejemplo credenciales del bot).
-- "media[].path" es relativo al bucket; URL pública:
--   <SUPABASE_URL>/storage/v1/object/public/media/<path>
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
                'id', m.id, 'path', m.path, 'name', m.name, 'kind', m.kind, 'mime', m.mime)
              order by m.created_at)
         from public.media_files m where m.profile_id = v_profile.id),
      '[]'::jsonb)
  );
end;
$$;

-- Panel de administración: uso por perfil y totales del proyecto.
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
    -- Bytes y archivos reales del bucket, incluidos huérfanos sin perfil.
    'storage_bytes',     (select coalesce(sum(coalesce((o.metadata ->> 'size')::bigint, 0)), 0)
                            from storage.objects o where o.bucket_id = 'media'),
    'storage_files',     (select count(*) from storage.objects o where o.bucket_id = 'media'),
    -- Suma de lo prometido por los planes de los perfiles activos.
    'storage_committed_bytes', (select coalesce(sum(pl.storage_limit_bytes), 0)
                                  from public.profiles p join public.plans pl on pl.id = p.plan_id
                                 where p.status = 'active'),
    'database_bytes',    pg_database_size(current_database()),
    'open_invites',      (select count(*) from public.invite_codes c
                           where c.revoked_at is null
                             and (c.expires_at is null or c.expires_at > now())
                             and c.used_count < c.max_uses)
  ) into v_totals;

  return jsonb_build_object('profiles', v_profiles, 'totals', v_totals);
end;
$$;

create or replace function public.admin_create_invite(
  p_plan       text default null,
  p_max_uses   int default 1,
  p_expires_at timestamptz default null,
  p_note       text default null
)
returns public.invite_codes
language plpgsql security definer set search_path = ''
as $$
declare
  v_plan text := p_plan;
  v_row  public.invite_codes;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  if v_plan is null then
    select pl.id into v_plan from public.plans pl where pl.is_default limit 1;
  end if;
  if v_plan is null or not exists (select 1 from public.plans pl where pl.id = v_plan) then
    raise exception 'plan_not_found';
  end if;

  insert into public.invite_codes (code, plan_id, max_uses, expires_at, note, created_by)
  values (
    'LALO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
    v_plan, greatest(coalesce(p_max_uses, 1), 1), p_expires_at, p_note, (select auth.uid())
  )
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.admin_revoke_invite(p_invite uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  update public.invite_codes set revoked_at = now()
   where id = p_invite and revoked_at is null;
end;
$$;

-- Cambia estado, plan o rol de OTRO perfil. Los parámetros null no se tocan.
create or replace function public.admin_set_profile(
  p_profile uuid,
  p_status  text default null,
  p_plan    text default null,
  p_role    text default null
)
returns public.profiles
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.profiles;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  if p_profile = (select auth.uid()) then
    raise exception 'cannot_modify_self';
  end if;

  update public.profiles
     set status  = coalesce(p_status, status),
         plan_id = coalesce(p_plan, plan_id),
         role    = coalesce(p_role, role)
   where id = p_profile
  returning * into v_row;

  if not found then
    raise exception 'profile_not_found';
  end if;
  return v_row;
end;
$$;

-- Código de recuperación de un solo uso. Se devuelve en claro UNA vez; en la
-- tabla solo queda su sha256. Anula los códigos anteriores sin usar del perfil.
create or replace function public.admin_create_recovery_code(p_profile uuid, p_ttl_hours int default 48)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_code text := 'REC-' || upper(replace(gen_random_uuid()::text, '-', ''));
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_profile) then
    raise exception 'profile_not_found';
  end if;

  delete from public.recovery_codes where profile_id = p_profile and used_at is null;

  insert into public.recovery_codes (profile_id, code_hash, expires_at, created_by)
  values (
    p_profile,
    encode(sha256(convert_to(v_code, 'UTF8')), 'hex'),
    now() + make_interval(hours => greatest(coalesce(p_ttl_hours, 48), 1)),
    (select auth.uid())
  );

  return v_code;
end;
$$;

-- Mueve los datos del perfil antiguo al usuario que llama (nuevo login de Twitch).
-- El que llama debe estar 'pending' (recién registrado). Hereda configs,
-- media_files, plan, llave de widget (las URL de OBS siguen funcionando) y la
-- carpeta de medios (los archivos de Storage no se mueven). El perfil antiguo
-- queda 'suspended'. El rol NO se transfiere: un admin recuperado vuelve a ser
-- streamer y debe promoverse por SQL.
-- REVISAR: sin probar. Verificar en un proyecto de pruebas antes de usarlo.
-- Devuelve 'ok' o el motivo: not_found | expired | used | not_pending | same_profile.
create or replace function public.redeem_recovery_code(p_code text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_status text;
  v_rec    public.recovery_codes%rowtype;
  v_old    public.profiles%rowtype;
  v_tmp    text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_rec from public.recovery_codes r
  where r.code_hash = encode(sha256(convert_to(upper(trim(p_code)), 'UTF8')), 'hex')
  for update;

  if not found then
    return 'not_found';
  elsif v_rec.used_at is not null then
    return 'used';
  elsif v_rec.expires_at <= now() then
    return 'expired';
  elsif v_rec.profile_id = v_uid then
    return 'same_profile';
  end if;

  select p.status into v_status from public.profiles p where p.id = v_uid for update;
  if v_status is distinct from 'pending' then
    return 'not_pending';
  end if;

  select * into v_old from public.profiles p where p.id = v_rec.profile_id for update;

  -- El perfil nuevo está pendiente y no debería tener datos; se limpia por si acaso.
  delete from public.configs where profile_id = v_uid;
  delete from public.media_files where profile_id = v_uid;

  update public.configs set profile_id = v_uid where profile_id = v_old.id;
  update public.media_files set profile_id = v_uid where profile_id = v_old.id;

  -- Libera los valores unique del perfil antiguo antes de dárselos al nuevo.
  update public.profiles
     set widget_key   = v_tmp,
         media_folder = 'retired-' || v_old.id::text,
         status       = 'suspended'
   where id = v_old.id;

  update public.profiles
     set widget_key     = v_old.widget_key,
         media_folder   = v_old.media_folder,
         plan_id        = v_old.plan_id,
         invite_code_id = v_old.invite_code_id,
         status         = 'active'
   where id = v_uid;

  update public.recovery_codes set used_at = now() where id = v_rec.id;

  return 'ok';
end;
$$;

-- Permisos de ejecución. Supabase concede EXECUTE por defecto a anon y
-- authenticated sobre las funciones de "public"; aquí se retira y se concede
-- solo lo necesario.
revoke execute on function
  public.is_admin(),
  public.is_active_user(),
  public.media_path_allowed(text),
  public.media_quota_ok(),
  public.profile_usage(uuid, boolean),
  public.check_invite(text),
  public.redeem_invite(text),
  public.rotate_widget_key(),
  public.touch_profile(),
  public.widget_bundle(text),
  public.admin_overview(),
  public.admin_create_invite(text, int, timestamptz, text),
  public.admin_revoke_invite(uuid),
  public.admin_set_profile(uuid, text, text, text),
  public.admin_create_recovery_code(uuid, int),
  public.redeem_recovery_code(text)
from public, anon, authenticated;

grant execute on function
  public.check_invite(text),
  public.widget_bundle(text)
to anon, authenticated;

grant execute on function
  public.is_admin(),
  public.is_active_user(),
  public.media_path_allowed(text),
  public.media_quota_ok(),
  public.profile_usage(uuid, boolean),
  public.redeem_invite(text),
  public.rotate_widget_key(),
  public.touch_profile(),
  public.admin_overview(),
  public.admin_create_invite(text, int, timestamptz, text),
  public.admin_revoke_invite(uuid),
  public.admin_set_profile(uuid, text, text, text),
  public.admin_create_recovery_code(uuid, int),
  public.redeem_recovery_code(text)
to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Storage: bucket "media"
-- -----------------------------------------------------------------------------

-- Bucket público (lectura por URL sin sesión, que es lo que necesita OBS).
-- file_size_limit en bytes: tope duro por archivo para TODOS los planes; debe
-- ser >= al max_file_bytes del plan más grande y <= al límite global del
-- proyecto (Storage → Settings). 15 MB es PROVISIONAL.
-- REVISAR: la documentación crea buckets por SQL solo con (id, name, public);
-- las columnas file_size_limit (bigint) y allowed_mime_types (text[]) figuran
-- en el esquema documentado, pero este insert con ellas no está probado. Si
-- falla, crear el bucket desde el panel con los mismos valores.
--
-- RIESGO SVG: un SVG puede contener <script>. Al ser un bucket público, abrir
-- la URL directa de un SVG subido lo ejecuta en el origen de Supabase (no en
-- el de la app). La app debe mostrar los SVG subidos SOLO con <img>, nunca
-- incrustados con innerHTML/<object>/<iframe>. Si no se necesitan, quitar
-- 'image/svg+xml' de la lista.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media', 'media', true, 15 * 1024 * 1024,
  array['image/png', 'image/gif', 'image/webp', 'image/svg+xml',
        'video/webm', 'video/mp4',
        'audio/mpeg', 'audio/wav', 'audio/ogg']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Políticas sobre storage.objects. La descarga por URL pública no pasa por
-- RLS; SELECT hace falta para listar y para subir con upsert.
drop policy if exists lalo_media_select on storage.objects;
create policy lalo_media_select on storage.objects
  for select to authenticated
  using (bucket_id = 'media'
         and ((select public.is_admin()) or public.media_path_allowed(name)));

-- Subida: solo en la carpeta propia, perfil activo y con cuota disponible.
drop policy if exists lalo_media_insert on storage.objects;
create policy lalo_media_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media'
              and public.media_path_allowed(name)
              and (select public.media_quota_ok()));

drop policy if exists lalo_media_update on storage.objects;
create policy lalo_media_update on storage.objects
  for update to authenticated
  using (bucket_id = 'media' and public.media_path_allowed(name))
  with check (bucket_id = 'media' and public.media_path_allowed(name));

drop policy if exists lalo_media_delete on storage.objects;
create policy lalo_media_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'media'
         and ((select public.is_admin()) or public.media_path_allowed(name)));

-- -----------------------------------------------------------------------------
-- QUÉ SE APLICA EN EL SERVIDOR Y QUÉ NO (cuotas)
--
-- Sí, en el servidor:
--   * Tipos MIME permitidos y tope duro por archivo: bucket (Storage API).
--   * Carpeta propia y perfil activo: políticas de storage.objects.
--   * "Cuenta llena": no se admite una subida nueva si el uso real ya alcanzó
--     storage_limit_bytes o max_files del plan (media_quota_ok).
--   * Tamaño de cada módulo de configs (200 kB) y lista cerrada de módulos.
--   * max_file_bytes del plan: solo al registrar el archivo en media_files
--     (media_files_guard). El objeto ya subido NO se borra solo.
--
-- No, o solo en parte:
--   * La última subida puede pasarse del límite total: Postgres no conoce el
--     tamaño al autorizar el INSERT. Exceso máximo = tope del bucket por subida.
--   * Subidas simultáneas pueden pasar la comprobación a la vez.
--   * Una actualización (upsert) que reemplace un archivo por otro mayor no se
--     vuelve a medir contra la cuota.
--   * Un archivo mayor que max_file_bytes pero menor que el tope del bucket
--     queda en Storage si el cliente no lo borra (cuenta en el uso y lo ve el
--     admin como diferencia entre storage.objects y media_files).
--   * Al borrar un usuario, sus objetos de Storage no se borran (SQL no puede
--     borrar archivos); hay que hacerlo con la API o desde el panel.
--   * Ancho de banda (egress) del bucket público: sin límite por cuenta.
-- -----------------------------------------------------------------------------

-- >>>>>>>>>> 0002_widget_version.sql >>>>>>>>>>
-- ============================================================================
-- 0002_widget_version.sql
--
-- Fecha del último cambio de configuración de un streamer, consultable con su
-- llave de widget. El widget de OBS la pregunta cada medio minuto y solo vuelve
-- a descargar el paquete completo (widget_bundle) cuando cambia: así la
-- consulta periódica casi no gasta salida de datos.
--
-- SIN PROBAR contra un proyecto real, igual que 0001.
-- ============================================================================

create or replace function public.widget_version(p_key text)
returns timestamptz
language sql stable security definer set search_path = ''
as $$
  select max(c.updated_at)
  from public.configs c
  join public.profiles p on p.id = c.profile_id
  where p.widget_key = p_key
    and p.status = 'active';
$$;

revoke all on function public.widget_version(text) from public;
grant execute on function public.widget_version(text) to anon, authenticated;

-- >>>>>>>>>> 0003_admin_access.sql >>>>>>>>>>
-- =============================================================================
-- 0003_admin_access.sql
--
-- Acceso del administrador con correo y clave (sin Twitch).
--
--   1. handle_new_user: un usuario creado con correo y clave recibe su perfil
--      con los campos de Twitch en null. En 0001 el id de Twitch se leía de
--      raw_user_meta_data ->> 'sub', y en un alta por correo esa clave puede
--      traer el propio id del usuario: quedaba guardado como si fuera de Twitch.
--   2. promote_admin_by_email: convierte en administrador a un usuario por su
--      correo. Solo se puede llamar desde el SQL Editor del panel.
--
-- SIN PROBAR contra un proyecto real, igual que 0001 y 0002. Ejecutar después
-- de esas dos. Se puede volver a ejecutar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Perfil al registrarse: distingue Twitch de correo y clave
-- -----------------------------------------------------------------------------
-- REVISAR: se asume que raw_app_meta_data ->> 'provider' ya vale 'email' o
-- 'twitch' en el momento del INSERT en auth.users. Por si no fuera así, también
-- se descarta un "id de Twitch" que sea igual al id del propio usuario. Si las
-- dos comprobaciones fallan, el comportamiento es el de 0001.
-- Como en 0001, no lanza errores propios: si este disparador falla, falla el
-- alta del usuario.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_meta      jsonb   := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_provider  text    := coalesce(new.raw_app_meta_data ->> 'provider', '');
  v_twitch_id text    := coalesce(v_meta ->> 'provider_id', v_meta ->> 'sub');
  v_by_email  boolean;
begin
  v_by_email := v_provider = 'email'
                or (v_provider = '' and (v_twitch_id is null or v_twitch_id = new.id::text));

  if v_by_email then
    -- Correo y clave (el administrador): sin datos de Twitch. El nombre visible
    -- es la parte del correo anterior a la arroba.
    insert into public.profiles (id, display_name, media_folder)
    values (new.id, nullif(split_part(coalesce(new.email, ''), '@', 1), ''), new.id::text)
    on conflict (id) do nothing;
    return new;
  end if;

  if v_twitch_id = new.id::text then
    v_twitch_id := null;
  end if;

  -- Si ese id de Twitch ya pertenece a otro perfil, se deja en null para no
  -- bloquear el registro por la restricción unique.
  if v_twitch_id is not null
     and exists (select 1 from public.profiles p where p.twitch_user_id = v_twitch_id) then
    v_twitch_id := null;
  end if;

  insert into public.profiles (id, twitch_user_id, twitch_login, display_name, avatar_url, media_folder)
  values (
    new.id,
    v_twitch_id,
    coalesce(v_meta ->> 'name', v_meta ->> 'full_name'),
    coalesce(v_meta ->> 'nickname', v_meta ->> 'slug', v_meta ->> 'name'),
    coalesce(v_meta ->> 'avatar_url', v_meta ->> 'picture'),
    new.id::text
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- El disparador on_auth_user_created de 0001 sigue apuntando a esta función.

-- Perfiles creados con la versión de 0001 que guardaron su propio id como si
-- fuera el de Twitch.
update public.profiles set twitch_user_id = null where twitch_user_id = id::text;

-- -----------------------------------------------------------------------------
-- 2. Nombrar al primer administrador por su correo
-- -----------------------------------------------------------------------------
-- Uso, desde el SQL Editor del panel de Supabase:
--
--   select public.promote_admin_by_email('tu@correo.com');
--
-- Deja el perfil con rol 'admin' y estado 'active'. Si el usuario no tiene
-- plan, le pone el predeterminado (o el indicado en p_plan). Si el usuario
-- existe pero no tiene perfil, lo crea.
--
-- Seguridad:
--   * NO es security definer: se ejecuta con los permisos de quien la llama.
--     El SQL Editor entra como "postgres", que puede leer auth.users y escribir
--     en profiles. anon y authenticated no pueden hacer ninguna de las dos cosas.
--   * No se concede EXECUTE a anon, authenticated ni service_role.
--   * Además rechaza cualquier llamada que llegue con una sesión de la API.
-- REVISAR: se asume que el rol del SQL Editor puede leer auth.users. Si diera
-- "permission denied", usar el UPDATE manual que está en supabase/README.md.
create or replace function public.promote_admin_by_email(p_email text, p_plan text default null)
returns text
language plpgsql set search_path = ''
as $$
declare
  v_id   uuid;
  v_plan text;
begin
  if (select auth.uid()) is not null then
    raise exception 'solo_desde_sql_editor';
  end if;

  select u.id into v_id
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  order by u.created_at
  limit 1;

  if v_id is null then
    raise exception 'No hay ningún usuario con el correo %. Créalo antes en Authentication > Users.', p_email;
  end if;

  if p_plan is not null and not exists (select 1 from public.plans pl where pl.id = p_plan) then
    raise exception 'No existe el plan %.', p_plan;
  end if;

  select pl.id into v_plan from public.plans pl where pl.is_default limit 1;

  insert into public.profiles (id, display_name, media_folder)
  values (v_id, nullif(split_part(trim(p_email), '@', 1), ''), v_id::text)
  on conflict (id) do nothing;

  update public.profiles
     set role    = 'admin',
         status  = 'active',
         plan_id = coalesce(p_plan, plan_id, v_plan)
   where id = v_id;

  return 'Listo: ' || lower(trim(p_email)) || ' es administrador y su cuenta está activa.';
end;
$$;

revoke all on function public.promote_admin_by_email(text, text) from public, anon, authenticated, service_role;

-- >>>>>>>>>> 0004_invite_requires_twitch.sql >>>>>>>>>>
-- ============================================================================
-- 0004_invite_requires_twitch.sql
--
-- Un código de afiliado solo activa cuentas que entraron con Twitch.
--
-- Con el acceso por correo abierto para el administrador (0003), cualquiera
-- podría crear un usuario de correo con la clave pública y, si tuviera un
-- código válido, activar una cuenta sin canal de Twitch. Esta versión de
-- redeem_invite lo rechaza con 'no_twitch' y no gasta el código.
--
-- SIN PROBAR contra un proyecto real, igual que las anteriores.
-- ============================================================================

create or replace function public.redeem_invite(p_code text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_status text;
  v_twitch text;
  v_code   public.invite_codes%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select p.status, p.twitch_user_id into v_status, v_twitch
  from public.profiles p where p.id = v_uid for update;
  if v_status is distinct from 'pending' then
    return 'not_pending';
  end if;
  if v_twitch is null then
    return 'no_twitch';
  end if;

  -- El bloqueo de fila hace atómico el incremento de used_count.
  select * into v_code from public.invite_codes c
  where c.code = upper(trim(p_code)) for update;

  if not found then
    return 'not_found';
  elsif v_code.revoked_at is not null then
    return 'revoked';
  elsif v_code.expires_at is not null and v_code.expires_at <= now() then
    return 'expired';
  elsif v_code.used_count >= v_code.max_uses then
    return 'used_up';
  end if;

  update public.invite_codes set used_count = used_count + 1 where id = v_code.id;

  insert into public.invite_redemptions (invite_code_id, profile_id)
  values (v_code.id, v_uid)
  on conflict do nothing;

  update public.profiles
     set status = 'active', plan_id = v_code.plan_id, invite_code_id = v_code.id
   where id = v_uid;

  return 'ok';
end;
$$;

-- >>>>>>>>>> 0005_r2_storage.sql >>>>>>>>>>
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

-- >>>>>>>>>> 0006_onboarding.sql >>>>>>>>>>
-- =============================================================================
-- 0006_onboarding.sql
--
-- Bienvenida de streamers: se guarda en la cuenta cuándo la terminó cada uno,
-- para no volver a enseñársela en otro navegador.
--
--   1. profiles.onboarded_at: fecha en que el streamer terminó la bienvenida
--      (null = todavía no).
--   2. Las cuentas que ya estaban activas antes de esta migración se dan por
--      terminadas: ya usan el panel y no deben ver la bienvenida.
--   3. complete_onboarding(): la llama el propio streamer; solo toca su perfil.
--
-- SIN PROBAR contra un proyecto real, igual que las anteriores. Ejecutar
-- después de 0001 a 0005. Se puede volver a ejecutar.
--
-- Mientras no se aplique, la app sigue funcionando: trata la columna o la
-- función ausentes como "bienvenida sin terminar" y lo recuerda solo en el
-- navegador del streamer.
-- =============================================================================

alter table public.profiles
  add column if not exists onboarded_at timestamptz;

-- Cuentas activas anteriores a la bienvenida. Solo se hace la primera vez (cuando
-- ningún perfil tiene fecha todavía), para que al volver a ejecutar el archivo
-- no se den por terminadas las cuentas nuevas que están a medias.
-- REVISAR: si se prefiere que las cuentas ya activas también vean la
-- bienvenida, quitar esta sentencia antes de ejecutar.
do $$
begin
  if not exists (select 1 from public.profiles p where p.onboarded_at is not null) then
    update public.profiles
       set onboarded_at = coalesce(last_seen_at, created_at)
     where status = 'active' and onboarded_at is null;
  end if;
end;
$$;

-- Marca como terminada la bienvenida del usuario que llama. Solo su propio
-- perfil, solo si está activo, y sin pisar la fecha si ya la tenía.
-- Devuelve la fecha guardada.
-- (Las escrituras directas en profiles están retiradas en 0001: por eso va por RPC.)
create or replace function public.complete_onboarding()
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_at  timestamptz;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  update public.profiles
     set onboarded_at = coalesce(onboarded_at, now())
   where id = v_uid and status = 'active'
  returning onboarded_at into v_at;

  if not found then
    raise exception 'not_active';
  end if;
  return v_at;
end;
$$;

revoke execute on function public.complete_onboarding() from public, anon, authenticated;
grant execute on function public.complete_onboarding() to authenticated;

-- REVISAR: redeem_recovery_code (0001) no copia onboarded_at del perfil antiguo
-- al nuevo. Quien recupera su cuenta con otro canal de Twitch vuelve a ver la
-- bienvenida, y así el canal nuevo queda puesto en todos los módulos.

-- >>>>>>>>>> 0007_chat_module.sql >>>>>>>>>>
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

-- >>>>>>>>>> 0008_terms_acceptance.sql >>>>>>>>>>
-- =============================================================================
-- 0008_terms_acceptance.sql
--
-- Aceptación de los términos y políticas: se guarda en la nube qué versión de
-- cada documento aceptó cada cuenta y cuándo.
--
--   1. terms_acceptances: una fila por cuenta, documento y versión aceptada. Es
--      un historial: las filas no se cambian ni se borran por la API.
--   2. accept_terms(p_versions): la llama la propia cuenta; solo escribe filas
--      de quien llama. Recibe un objeto { "documento": "versión", ... }.
--   3. RLS: cada cuenta lee solo sus filas; un administrador las lee todas.
--
-- Los identificadores de documento son los de src/legal/tipos.ts (DOC_IDS). La
-- función no los valida contra una lista cerrada para no tener que tocar la
-- base de datos cada vez que se añade un documento: solo acota forma y tamaño.
--
-- SIN PROBAR contra un proyecto real, igual que las anteriores. Ejecutar
-- después de 0001 a 0007. Se puede volver a ejecutar.
--
-- Mientras no se aplique, la app sigue funcionando: si la tabla o la función no
-- existen, lo dice en pantalla y recuerda la aceptación solo en el navegador de
-- esa cuenta. Cuando la migración se aplique, la app volverá a pedir la
-- aceptación una vez para dejarla registrada aquí.
-- =============================================================================

create table if not exists public.terms_acceptances (
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  document    text not null check (document ~ '^[a-z][a-z0-9-]{1,39}$'),
  version     text not null check (version ~ '^[0-9]+(\.[0-9]+){0,3}$'),
  accepted_at timestamptz not null default now(),
  primary key (profile_id, document, version)
);

create index if not exists terms_acceptances_profile_idx on public.terms_acceptances (profile_id);

alter table public.terms_acceptances enable row level security;

-- Solo lectura por API: las escrituras van por accept_terms.
revoke all on public.terms_acceptances from anon;
revoke insert, update, delete on public.terms_acceptances from authenticated;
grant select on public.terms_acceptances to authenticated;

drop policy if exists terms_acceptances_select on public.terms_acceptances;
create policy terms_acceptances_select on public.terms_acceptances
  for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_admin()));

-- Registra que el usuario que llama aceptó esas versiones. Solo su propio
-- perfil. Si ya había aceptado esa versión de ese documento, se conserva la
-- fecha original. Devuelve la fecha de esta llamada.
-- No exige que la cuenta esté activa: el paso de aceptación va después del
-- código de invitación, pero no debe fallar si el orden cambia.
create or replace function public.accept_terms(p_versions jsonb)
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_now timestamptz := now();
  v_doc text;
  v_ver text;
  v_n   int := 0;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_versions is null or jsonb_typeof(p_versions) <> 'object' then
    raise exception 'invalid_versions';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception 'profile_not_found';
  end if;

  for v_doc, v_ver in select key, value from jsonb_each_text(p_versions)
  loop
    v_n := v_n + 1;
    if v_n > 20 then
      raise exception 'too_many_documents';
    end if;
    -- Los CHECK de la tabla rechazan un documento o una versión mal formados.
    insert into public.terms_acceptances (profile_id, document, version, accepted_at)
    values (v_uid, v_doc, v_ver, v_now)
    on conflict (profile_id, document, version) do nothing;
  end loop;

  if v_n = 0 then
    raise exception 'invalid_versions';
  end if;
  return v_now;
end;
$$;

revoke execute on function public.accept_terms(jsonb) from public, anon, authenticated;
grant execute on function public.accept_terms(jsonb) to authenticated;

-- REVISAR: redeem_recovery_code (0001) no copia estas filas del perfil antiguo
-- al nuevo. Quien recupera su cuenta con otro canal de Twitch vuelve a aceptar,
-- y las filas del perfil antiguo quedan como historial de ese perfil.
-- REVISAR: al borrar un usuario se borran sus filas (on delete cascade). Si los
-- abogados piden conservar la prueba de aceptación después de cerrar la cuenta,
-- hay que cambiar esa regla.

-- >>>>>>>>>> 0009_voices.sql >>>>>>>>>>
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

-- >>>>>>>>>> 0010_studio_module.sql >>>>>>>>>>
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

-- >>>>>>>>>> 0012_twitch_events.sql >>>>>>>>>>
-- ============================================================================
-- 0012_twitch_events.sql
--
-- Canal de eventos de Twitch hasta OBS y módulo «powerups».
--
-- SIN PROBAR: escrita leyendo 0001, 0002, 0007 y 0010; no se ha ejecutado contra
-- una base real. Conviene aplicarla primero en un proyecto de pruebas.
--
-- Cómo viaja un evento:
--   1. Twitch avisa a /api/twitch/eventsub (bits, Power-ups, canjes de puntos).
--   2. El servidor comprueba la firma y llama a ingest_twitch_event con la clave
--      de servicio. La función busca al streamer dueño de ese canal, guarda el
--      evento una sola vez (el id del mensaje de Twitch es único) y, si son
--      Bits, los suma a sus metas de bits.
--   3. La capa de OBS, que no inicia sesión, pregunta cada pocos segundos por
--      los eventos nuevos con widget_events y su clave privada de widget. Solo
--      recibe los de su streamer.
--
-- Por qué una tabla con consulta periódica y no Realtime: la capa de OBS ya lee
-- todo con su clave privada a través de funciones; así no hay ningún canal al
-- que alguien pueda unirse adivinando un nombre, un evento no se pierde si la
-- fuente se desconecta unos segundos y no se gastan conexiones simultáneas del
-- plan gratuito (una por fuente de navegador). La consulta es mínima y la capa
-- solo la hace cuando el streamer tiene encendido el canal de eventos.
--
-- Datos personales: de cada evento se guarda el nombre visible y el usuario del
-- espectador, el texto que escribió y las cantidades. Ningún id de espectador.
-- Los eventos se borran solos a los quince minutos.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Módulo «powerups» en la configuración sincronizada (igual que 0007 y 0010)
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
     'powerups'));

-- ---------------------------------------------------------------------------
-- 2. Tabla de eventos (vida corta)
-- ---------------------------------------------------------------------------

create table if not exists public.twitch_events (
  id         bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  -- Id del mensaje de Twitch (o 'test-...' en las pruebas del panel): evita guardar dos veces el mismo
  message_id text not null unique check (char_length(message_id) between 1 and 200),
  kind       text not null check (kind in ('bits', 'powerup', 'points')),
  payload    jsonb not null check (octet_length(payload::text) <= 4000),
  is_test    boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists twitch_events_profile_idx on public.twitch_events (profile_id, id);
create index if not exists twitch_events_created_idx on public.twitch_events (created_at);

-- Nadie lee ni escribe la tabla por la API: solo las funciones de abajo.
alter table public.twitch_events enable row level security;
revoke all on public.twitch_events from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Entrada desde el servidor (solo clave de servicio)
-- ---------------------------------------------------------------------------

-- Devuelve 'ok', 'duplicate' (mensaje ya guardado) o 'unknown_channel' (ningún
-- streamer activo tiene ese canal de Twitch).
create or replace function public.ingest_twitch_event(
  p_message_id     text,
  p_twitch_user_id text,
  p_kind           text,
  p_payload        jsonb,
  p_bits           integer default 0
)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_profile uuid;
  v_event   bigint;
  v_goals   jsonb;
begin
  if p_message_id is null or p_twitch_user_id is null or p_payload is null
     or p_kind not in ('bits', 'powerup', 'points') then
    raise exception 'bad_event';
  end if;

  select p.id into v_profile
  from public.profiles p
  where p.twitch_user_id = p_twitch_user_id and p.status = 'active';
  if not found then
    return 'unknown_channel';
  end if;

  -- Limpieza: lo que tiene más de quince minutos ya no le sirve a nadie
  delete from public.twitch_events e where e.created_at < now() - interval '15 minutes';

  insert into public.twitch_events (profile_id, message_id, kind, payload)
  values (v_profile, p_message_id, p_kind, p_payload)
  on conflict (message_id) do nothing
  returning id into v_event;
  if v_event is null then
    return 'duplicate';
  end if;

  -- Bits a las metas: cada meta de tipo bits, encendida y sin el interruptor
  -- «contar los Bits de Twitch» apagado (countBits = false), suma la cantidad.
  -- Se hace aquí, una sola vez por mensaje, para que no dependa de qué fuentes
  -- de OBS estén abiertas.
  if p_kind = 'bits' and coalesce(p_bits, 0) > 0 then
    update public.configs c
    set data = jsonb_set(c.data, '{goals}', (
      select coalesce(jsonb_agg(
        case
          when g ->> 'type' = 'bits'
               and g -> 'enabled' is distinct from 'false'::jsonb
               and g -> 'countBits' is distinct from 'false'::jsonb
          then jsonb_set(g, '{current}', to_jsonb(
                 (case when jsonb_typeof(g -> 'current') = 'number' then (g ->> 'current')::numeric else 0 end)
                 + p_bits))
          else g
        end
        order by ord), '[]'::jsonb)
      from jsonb_array_elements(c.data -> 'goals') with ordinality as t(g, ord)
    ))
    where c.profile_id = v_profile
      and c.module = 'goals'
      and jsonb_typeof(c.data -> 'goals') = 'array';

    -- El evento lleva el total nuevo de cada meta: la capa de OBS pone ese
    -- número, no suma por su cuenta, así que no puede contar dos veces
    select jsonb_agg(jsonb_build_object('id', g ->> 'id', 'current', g -> 'current'))
      into v_goals
    from public.configs c, jsonb_array_elements(c.data -> 'goals') as g
    where c.profile_id = v_profile
      and c.module = 'goals'
      and jsonb_typeof(c.data -> 'goals') = 'array'
      and g ->> 'type' = 'bits'
      and g -> 'enabled' is distinct from 'false'::jsonb
      and g -> 'countBits' is distinct from 'false'::jsonb;

    if v_goals is not null then
      update public.twitch_events e
      set payload = e.payload || jsonb_build_object('goals', v_goals)
      where e.id = v_event;
    end if;
  end if;

  return 'ok';
end;
$$;

revoke all on function public.ingest_twitch_event(text, text, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.ingest_twitch_event(text, text, text, jsonb, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Lectura desde la capa de OBS (clave privada de widget, sin sesión)
-- ---------------------------------------------------------------------------

-- p_after es el último id que la capa ya tiene. La primera vez se pasa null y
-- solo se devuelve desde dónde empezar: una fuente recién abierta no repite
-- eventos anteriores. Devuelve null si la clave no existe o la cuenta no está activa.
create or replace function public.widget_events(p_key text, p_after bigint default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_profile uuid;
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

  if p_after is null then
    return jsonb_build_object(
      'cursor', coalesce((select max(e.id) from public.twitch_events e where e.profile_id = v_profile), 0),
      'events', '[]'::jsonb);
  end if;

  return (
    with fresh as (
      select e.id, e.kind, e.payload, e.is_test, e.created_at
      from public.twitch_events e
      where e.profile_id = v_profile
        and e.id > p_after
        -- Lo que tiene más de dos minutos llega tarde para salir en pantalla
        and e.created_at > now() - interval '2 minutes'
      order by e.id
      limit 20
    )
    select jsonb_build_object(
      'cursor', coalesce((select max(f.id) from fresh f), p_after),
      'events', coalesce(
        (select jsonb_agg(jsonb_build_object(
                  'id', f.id, 'kind', f.kind, 'payload', f.payload, 'test', f.is_test, 'at', f.created_at)
                order by f.id)
           from fresh f),
        '[]'::jsonb))
  );
end;
$$;

revoke all on function public.widget_events(text, bigint) from public;
grant execute on function public.widget_events(text, bigint) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Pruebas desde el panel (sesión del streamer)
-- ---------------------------------------------------------------------------

-- Guarda un evento de prueba para las capas de OBS de quien llama. Recorre el
-- mismo camino de entrega que uno real, pero nunca suma a las metas.
create or replace function public.push_test_twitch_event(p_kind text, p_payload jsonb)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_profile uuid := (select auth.uid());
  v_event   bigint;
begin
  if v_profile is null or not public.is_active_user() then
    raise exception 'not_active';
  end if;
  if p_kind not in ('bits', 'powerup', 'points') or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'bad_event';
  end if;
  -- Como mucho veinte pruebas por minuto y cuenta
  if (select count(*) from public.twitch_events e
      where e.profile_id = v_profile and e.is_test and e.created_at > now() - interval '1 minute') >= 20 then
    raise exception 'too_many_tests';
  end if;

  delete from public.twitch_events e where e.created_at < now() - interval '15 minutes';

  insert into public.twitch_events (profile_id, message_id, kind, payload, is_test)
  values (v_profile, 'test-' || gen_random_uuid()::text, p_kind, (p_payload - 'goals') || '{"test": true}'::jsonb, true)
  returning id into v_event;
  return v_event;
end;
$$;

revoke all on function public.push_test_twitch_event(text, jsonb) from public, anon;
grant execute on function public.push_test_twitch_event(text, jsonb) to authenticated;

-- >>>>>>>>>> 0013_integrations.sql >>>>>>>>>>
-- ============================================================================
-- 0013_integrations.sql
--
-- Integraciones: Spotify («Ahora suena») y Ko-fi.
--
-- SIN PROBAR: escrita leyendo 0001, 0007, 0010 y 0012; no se ha ejecutado contra
-- una base real. Conviene aplicarla primero en un proyecto de pruebas. Necesita
-- que 0012 (canal de eventos) ya esté aplicada.
--
-- Qué añade:
--   1. Los módulos «music» y «kofi» en la configuración sincronizada.
--   2. integration_accounts: lo que el servidor guarda de cada streamer para
--      una integración. Es la primera tabla con permisos de cuentas ajenas, así
--      que solo la toca la clave de servicio: tiene RLS encendido y ninguna
--      política. El navegador no puede leerla ni escribirla.
--        - Spotify: el permiso de renovación, cifrado por el servidor
--          (AES-256-GCM con INTEGRATIONS_ENC_KEY), y el nombre visible de la cuenta.
--        - Ko-fi: la clave de verificación cifrada, la dirección personal del
--          webhook (su huella para buscarla y, cifrada, la dirección para
--          enseñársela a su dueño), lo recaudado de la meta y los últimos apoyos.
--   3. El canal de eventos de 0012 admite el origen «kofi».
--   4. ingest_kofi_event: guarda un aviso de Ko-fi una sola vez, suma a la meta
--      y apunta el apoyo en la lista corta. Solo clave de servicio.
--   5. widget_kofi_state: la capa de OBS lee lo recaudado y los últimos apoyos
--      con su clave privada de widget.
--   6. push_test_twitch_event admite pruebas de tipo «kofi» desde el panel.
--
-- Datos personales: de cada aviso de Ko-fi se guarda el nombre visible (o
-- «Alguien» si el apoyo es privado), el mensaje (vacío si es privado), la
-- cantidad, la moneda y el nivel. Nunca el correo ni la dirección de envío. Los
-- eventos se borran solos a los quince minutos (0012). En la lista corta quedan
-- el nombre, la cantidad y el tipo de los cinco últimos apoyos, sin mensaje.
-- Al desconectar se borra la fila entera.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Módulos «music» y «kofi» en la configuración sincronizada (igual que 0012)
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
     'powerups', 'music', 'kofi'));

-- ---------------------------------------------------------------------------
-- 2. Cuentas conectadas (solo clave de servicio)
-- ---------------------------------------------------------------------------

create table if not exists public.integration_accounts (
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  provider      text not null check (provider in ('spotify', 'kofi')),
  -- Cifrado por el servidor: permiso de renovación de Spotify o clave de verificación de Ko-fi
  secret_enc    text check (secret_enc is null or char_length(secret_enc) <= 4000),
  -- Ko-fi: huella SHA-256 de la dirección personal del webhook, y la dirección cifrada
  hook_hash     text unique check (hook_hash is null or char_length(hook_hash) = 64),
  hook_enc      text check (hook_enc is null or char_length(hook_enc) <= 400),
  -- Spotify: nombre visible de la cuenta, para «Conectado como»
  account_name  text check (account_name is null or char_length(account_name) <= 80),
  status        text not null default 'connected' check (status in ('connected', 'expired')),
  connected_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Ko-fi: cuándo llegó el último aviso válido, y el último problema (clave que no coincide)
  last_event_at timestamptz,
  last_error    text check (last_error is null or char_length(last_error) <= 40),
  last_error_at timestamptz,
  -- Ko-fi: lo recaudado para la meta (en la moneda de la meta) y los últimos apoyos
  goal_raised   numeric(12, 2) not null default 0 check (goal_raised >= 0),
  recent        jsonb not null default '[]'::jsonb check (octet_length(recent::text) <= 2000),
  primary key (profile_id, provider)
);

-- Nadie lee ni escribe la tabla por la API: solo el servidor con la clave de servicio.
alter table public.integration_accounts enable row level security;
revoke all on public.integration_accounts from public, anon, authenticated;
grant select, insert, update, delete on public.integration_accounts to service_role;

-- ---------------------------------------------------------------------------
-- 3. El canal de eventos admite el origen «kofi»
-- ---------------------------------------------------------------------------

do $$
declare
  v_name text;
begin
  for v_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.twitch_events'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%kind%'
  loop
    execute format('alter table public.twitch_events drop constraint %I', v_name);
  end loop;
end
$$;

alter table public.twitch_events
  add constraint twitch_events_kind_check check (kind in ('bits', 'powerup', 'points', 'kofi'));

-- ---------------------------------------------------------------------------
-- 4. Entrada de avisos de Ko-fi (solo clave de servicio)
-- ---------------------------------------------------------------------------

-- El servidor ya comprobó la clave de verificación y redujo el aviso a lo mínimo.
-- p_goal_add es lo que suma a la meta (0 si el tipo no suma o la moneda es otra).
-- p_recent es la entrada para «últimos apoyos»; un objeto vacío no se apunta.
-- Devuelve 'ok' o 'duplicate' (Ko-fi reintenta con el mismo message_id).
create or replace function public.ingest_kofi_event(
  p_profile    uuid,
  p_message_id text,
  p_payload    jsonb,
  p_goal_add   numeric default 0,
  p_recent     jsonb default null
)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_event  bigint;
  v_raised numeric;
begin
  if p_profile is null or p_message_id is null or p_payload is null
     or char_length(p_message_id) not between 1 and 100
     or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'bad_event';
  end if;

  if not exists (select 1 from public.profiles p where p.id = p_profile and p.status = 'active') then
    return 'ok';
  end if;

  delete from public.twitch_events e where e.created_at < now() - interval '15 minutes';

  -- El id lleva el perfil delante: dos streamers no pueden pisarse un aviso
  insert into public.twitch_events (profile_id, message_id, kind, payload)
  values (p_profile, 'kofi-' || p_profile::text || '-' || p_message_id, 'kofi', p_payload - 'raised')
  on conflict (message_id) do nothing
  returning id into v_event;
  if v_event is null then
    return 'duplicate';
  end if;

  update public.integration_accounts a
  set last_event_at = now(),
      last_error    = null,
      last_error_at = null,
      updated_at    = now(),
      goal_raised   = a.goal_raised + greatest(coalesce(p_goal_add, 0), 0),
      recent        = case
        when p_recent is null or jsonb_typeof(p_recent) <> 'object' or not (p_recent ? 'name') then a.recent
        else (
          select coalesce(jsonb_agg(t.item order by t.ord), '[]'::jsonb)
          from jsonb_array_elements(jsonb_build_array(p_recent) || a.recent) with ordinality as t(item, ord)
          where t.ord <= 5
        )
      end
  where a.profile_id = p_profile and a.provider = 'kofi'
  returning a.goal_raised into v_raised;

  -- El evento lleva el total nuevo: la capa de OBS pone ese número, no suma por
  -- su cuenta, así que no puede contar dos veces
  if v_raised is not null then
    update public.twitch_events e
    set payload = e.payload || jsonb_build_object('raised', v_raised)
    where e.id = v_event;
  end if;

  return 'ok';
end;
$$;

revoke all on function public.ingest_kofi_event(uuid, text, jsonb, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_kofi_event(uuid, text, jsonb, numeric, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Lectura desde la capa de OBS (clave privada de widget, sin sesión)
-- ---------------------------------------------------------------------------

-- Lo recaudado y los últimos apoyos. null si la clave no existe, la cuenta no
-- está activa o no tiene Ko-fi conectado. No devuelve ninguna clave ni dirección.
create or replace function public.widget_kofi_state(p_key text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_profile uuid;
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

  return (
    select jsonb_build_object('raised', a.goal_raised, 'recent', a.recent)
    from public.integration_accounts a
    where a.profile_id = v_profile and a.provider = 'kofi'
  );
end;
$$;

revoke all on function public.widget_kofi_state(text) from public;
grant execute on function public.widget_kofi_state(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Pruebas desde el panel: se admite el tipo «kofi»
-- ---------------------------------------------------------------------------

-- La misma función de 0012 con un tipo más. Las pruebas nunca suman a las metas.
create or replace function public.push_test_twitch_event(p_kind text, p_payload jsonb)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_profile uuid := (select auth.uid());
  v_event   bigint;
begin
  if v_profile is null or not public.is_active_user() then
    raise exception 'not_active';
  end if;
  if p_kind not in ('bits', 'powerup', 'points', 'kofi') or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'bad_event';
  end if;
  -- Como mucho veinte pruebas por minuto y cuenta
  if (select count(*) from public.twitch_events e
      where e.profile_id = v_profile and e.is_test and e.created_at > now() - interval '1 minute') >= 20 then
    raise exception 'too_many_tests';
  end if;

  delete from public.twitch_events e where e.created_at < now() - interval '15 minutes';

  insert into public.twitch_events (profile_id, message_id, kind, payload, is_test)
  values (v_profile, 'test-' || gen_random_uuid()::text, p_kind, (p_payload - 'goals' - 'raised') || '{"test": true}'::jsonb, true)
  returning id into v_event;
  return v_event;
end;
$$;

revoke all on function public.push_test_twitch_event(text, jsonb) from public, anon;
grant execute on function public.push_test_twitch_event(text, jsonb) to authenticated;

-- >>>>>>>>>> 0014_pets.sql >>>>>>>>>>
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

-- >>>>>>>>>> 0015_riot.sql >>>>>>>>>>
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

-- >>>>>>>>>> 0016_tournament.sql >>>>>>>>>>
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

-- >>>>>>>>>> 0017_tournament_cloud.sql >>>>>>>>>>
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

-- >>>>>>>>>> 0018_elevenlabs.sql >>>>>>>>>>
-- =============================================================================
-- 0018_elevenlabs.sql
--
-- ElevenLabs como segundo motor de voz, junto a Fish Audio. Los dos conviven:
-- ElevenLabs solo lo usa quien el administrador activa.
--
--   1. profiles.elevenlabs_enabled: el interruptor por streamer. Solo cambia por
--      admin_set_elevenlabs (administrador). El streamer lo lee en su propio perfil.
--   2. profiles.elevenlabs_invite_seen_at: cuándo cerró el aviso de invitación.
--   3. voices.provider: 'fish' (las de siempre) o 'elevenlabs'. reference_id guarda
--      el voice_id de ElevenLabs en ese caso.
--   4. Un streamer solo ve en el catálogo las voces de ElevenLabs si lo tiene activo.
--
-- El servidor (api/tts) vuelve a comprobar elevenlabs_enabled con la clave de
-- servicio antes de gastar créditos: lo que diga el navegador no cuenta.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0017.
-- Se puede volver a ejecutar.
-- =============================================================================

alter table public.profiles
  add column if not exists elevenlabs_enabled boolean not null default false,
  add column if not exists elevenlabs_invite_seen_at timestamptz;

alter table public.voices
  add column if not exists provider text not null default 'fish'
  check (provider in ('fish', 'elevenlabs'));

-- ¿Puede el usuario actual usar ElevenLabs? (el administrador siempre)
create or replace function public.eleven_enabled()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select p.role = 'admin' or p.elevenlabs_enabled
       from public.profiles p
      where p.id = (select auth.uid()) and p.status = 'active'),
    false);
$$;

-- Catálogo: las voces de ElevenLabs solo las ven quienes lo tienen activo.
grant select (provider) on public.voices to authenticated;

drop policy if exists voices_select on public.voices;
create policy voices_select on public.voices
  for select to authenticated
  using (
    (select public.is_admin())
    or (visible and (provider = 'fish' or (select public.eleven_enabled())))
  );

-- El administrador activa o desactiva ElevenLabs en otra cuenta.
-- Al activarlo se borra la marca de «aviso visto» para que el streamer vea la invitación.
create or replace function public.admin_set_elevenlabs(p_profile uuid, p_enabled boolean)
returns public.profiles
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.profiles;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  if p_profile = (select auth.uid()) then
    raise exception 'cannot_modify_self';
  end if;

  update public.profiles
     set elevenlabs_enabled = coalesce(p_enabled, false),
         elevenlabs_invite_seen_at = case
           when coalesce(p_enabled, false) and not elevenlabs_enabled then null
           else elevenlabs_invite_seen_at
         end
   where id = p_profile
  returning * into v_row;

  if not found then
    raise exception 'profile_not_found';
  end if;
  return v_row;
end;
$$;

-- El streamer cierra el aviso de invitación.
create or replace function public.dismiss_elevenlabs_invite()
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  update public.profiles
     set elevenlabs_invite_seen_at = now()
   where id = (select auth.uid()) and elevenlabs_enabled;
end;
$$;

-- Solo el servidor (clave de servicio): ¿esta clave de capa o este usuario puede usar ElevenLabs?
create or replace function public.eleven_allowed_for_widget(p_key text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
     where p.widget_key = p_key and p.status = 'active'
       and (p.elevenlabs_enabled or p.role = 'admin'));
$$;

revoke execute on function
  public.eleven_enabled(),
  public.admin_set_elevenlabs(uuid, boolean),
  public.dismiss_elevenlabs_invite(),
  public.eleven_allowed_for_widget(text)
from public, anon, authenticated;

grant execute on function
  public.eleven_enabled(),
  public.admin_set_elevenlabs(uuid, boolean),
  public.dismiss_elevenlabs_invite()
to authenticated;

grant execute on function public.eleven_allowed_for_widget(text) to service_role;

-- admin_voices() devuelve to_jsonb(v), así que ya incluye provider.

-- >>>>>>>>>> 0018_tournament_intro.sql >>>>>>>>>>
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

-- >>>>>>>>>> 0019_admin_usage_and_audit.sql >>>>>>>>>>
-- =============================================================================
-- 0019_admin_usage_and_audit.sql
--
-- Analítica de uso para el administrador, pulso de conexión de OBS, cuota
-- diaria de ElevenLabs por cuenta y bitácora de auditoría administrativa.
--
--   1. profiles.last_widget_at: cuándo consultó OBS por última vez la llave del
--      streamer (se actualiza como máximo una vez cada 10 minutos para no
--      gastar escrituras en el plan gratuito).
--   2. profiles.elevenlabs_daily_chars: tope diario de caracteres en ElevenLabs
--      por streamer (por defecto 15 000 caracteres/día; 0 = sin tope diario).
--      Cuando un streamer supera su tope diario, el servidor (/api/tts) pasa
--      automáticamente a Fish Audio durante el resto del día sin dejar mudo OBS.
--   3. tts_usage_daily: contador compacto por día, streamer y motor ('fish' o
--      'elevenlabs'). Una fila por streamer activo al día; limpia sola lo de
--      hace más de 90 días.
--   4. admin_audit_log: registro de acciones del administrador (cambios de plan,
--      suspensiones, activación y tope de ElevenLabs, códigos de recuperación).
--   5. admin_usage_report(): resumen completo de adopción de módulos (configs),
--      integraciones conectadas, torneos, pulso de OBS, consumo de TTS y
--      bitácora de auditoría. Comprueba la existencia de tablas opcionales con
--      to_regclass para funcionar aunque falte alguna migración intermedia.
--
-- Ejecutar después de 0001 a 0018. Se puede volver a ejecutar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columnas en profiles: pulso de OBS y tope diario de ElevenLabs
-- -----------------------------------------------------------------------------

alter table public.profiles
  add column if not exists last_widget_at timestamptz,
  add column if not exists elevenlabs_daily_chars integer not null default 15000
    check (elevenlabs_daily_chars >= 0);

-- -----------------------------------------------------------------------------
-- 2. Contadores diarios de síntesis de voz (TTS)
-- -----------------------------------------------------------------------------

create table if not exists public.tts_usage_daily (
  day         date not null default (now() at time zone 'utc')::date,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  provider    text not null check (provider in ('fish', 'elevenlabs')),
  requests    integer not null default 0 check (requests >= 0),
  chars       integer not null default 0 check (chars >= 0),
  updated_at  timestamptz not null default now(),
  primary key (day, profile_id, provider)
);

create index if not exists tts_usage_daily_profile_idx
  on public.tts_usage_daily (profile_id, day desc);

alter table public.tts_usage_daily enable row level security;
revoke all on public.tts_usage_daily from public, anon, authenticated;
grant select on public.tts_usage_daily to authenticated;
grant all on public.tts_usage_daily to service_role;

drop policy if exists tts_usage_daily_select on public.tts_usage_daily;
create policy tts_usage_daily_select on public.tts_usage_daily
  for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_admin()));

-- -----------------------------------------------------------------------------
-- 3. Bitácora de auditoría del administrador
-- -----------------------------------------------------------------------------

create table if not exists public.admin_audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles (id) on delete set null,
  target_id   uuid references public.profiles (id) on delete set null,
  action      text not null check (char_length(action) between 1 and 60),
  detail      text not null check (char_length(detail) between 1 and 240),
  created_at  timestamptz not null default now()
);

create index if not exists admin_audit_log_created_idx
  on public.admin_audit_log (created_at desc);

alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from public, anon, authenticated;
grant select on public.admin_audit_log to authenticated;

drop policy if exists admin_audit_log_admin_select on public.admin_audit_log;
create policy admin_audit_log_admin_select on public.admin_audit_log
  for select to authenticated
  using ((select public.is_admin()));

-- Helper interno para anotar en la bitácora y recortar entradas antiguas (> 250)
create or replace function public.log_admin_action(
  p_target uuid,
  p_action text,
  p_detail text
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.admin_audit_log (actor_id, target_id, action, detail)
  values (
    (select auth.uid()),
    p_target,
    left(coalesce(trim(p_action), 'admin'), 60),
    left(coalesce(trim(p_detail), 'Acción administrativa'), 240)
  );

  delete from public.admin_audit_log
   where id in (
     select a.id
       from public.admin_audit_log a
      order by a.created_at desc, a.id desc
     offset 250
   );
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Pulso de OBS en widget_version y widget_bundle (máx. 1 escritura / 10 min)
-- -----------------------------------------------------------------------------

create or replace function public.widget_version(p_key text)
returns timestamptz
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_last_seen  timestamptz;
  v_updated_at timestamptz;
begin
  if p_key is null or char_length(p_key) < 32 then
    return null;
  end if;

  select p.id, p.last_widget_at
    into v_profile_id, v_last_seen
    from public.profiles p
   where p.widget_key = p_key
     and p.status = 'active';

  if not found then
    return null;
  end if;

  if v_last_seen is null or v_last_seen < now() - interval '10 minutes' then
    update public.profiles
       set last_widget_at = now()
     where id = v_profile_id;
  end if;

  select max(c.updated_at)
    into v_updated_at
    from public.configs c
   where c.profile_id = v_profile_id;

  return v_updated_at;
end;
$$;

create or replace function public.widget_bundle(p_key text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
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

  if v_profile.last_widget_at is null or v_profile.last_widget_at < now() - interval '10 minutes' then
    update public.profiles
       set last_widget_at = now()
     where id = v_profile.id;
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
-- 5. Control de cuota y registro de uso de TTS (solo clave de servicio)
-- -----------------------------------------------------------------------------

create or replace function public.check_and_record_tts_usage(
  p_profile_id uuid default null,
  p_widget_key text default null,
  p_provider   text default 'fish',
  p_chars      integer default 0
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_profile    public.profiles%rowtype;
  v_today      date := (now() at time zone 'utc')::date;
  v_chars      integer := greatest(coalesce(p_chars, 0), 0);
  v_used_today integer := 0;
  v_limit      integer := 0;
begin
  if p_provider not in ('fish', 'elevenlabs') then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_provider');
  end if;

  if p_profile_id is not null then
    select * into v_profile from public.profiles p where p.id = p_profile_id;
  elsif p_widget_key is not null and char_length(p_widget_key) between 16 and 128 then
    select * into v_profile from public.profiles p where p.widget_key = p_widget_key;
  else
    return jsonb_build_object('allowed', false, 'reason', 'unknown_profile');
  end if;

  if not found or v_profile.status <> 'active' then
    return jsonb_build_object('allowed', false, 'reason', 'unknown_profile');
  end if;

  if p_provider = 'elevenlabs' then
    if v_profile.role <> 'admin' and not coalesce(v_profile.elevenlabs_enabled, false) then
      return jsonb_build_object(
        'allowed', false,
        'reason', 'not_enabled',
        'profile_id', v_profile.id
      );
    end if;

    v_limit := coalesce(v_profile.elevenlabs_daily_chars, 15000);
    select coalesce(u.chars, 0)
      into v_used_today
      from public.tts_usage_daily u
     where u.day = v_today
       and u.profile_id = v_profile.id
       and u.provider = 'elevenlabs';

    if v_profile.role <> 'admin' and v_limit > 0 and (v_used_today + v_chars) > v_limit then
      return jsonb_build_object(
        'allowed', false,
        'reason', 'quota_exceeded',
        'profile_id', v_profile.id,
        'chars_used', v_used_today,
        'chars_limit', v_limit
      );
    end if;
  end if;

  if v_chars > 0 then
    insert into public.tts_usage_daily (day, profile_id, provider, requests, chars, updated_at)
    values (v_today, v_profile.id, p_provider, 1, v_chars, now())
    on conflict (day, profile_id, provider) do update
       set requests   = public.tts_usage_daily.requests + 1,
           chars      = public.tts_usage_daily.chars + excluded.chars,
           updated_at = now()
    returning chars into v_used_today;

    -- Limpieza oportunista de contadores de hace más de 90 días
    delete from public.tts_usage_daily where day < v_today - 90;
  end if;

  return jsonb_build_object(
    'allowed', true,
    'reason', 'ok',
    'profile_id', v_profile.id,
    'chars_used', v_used_today,
    'chars_limit', v_limit
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Funciones administrativas con registro en bitácora
-- -----------------------------------------------------------------------------

create or replace function public.admin_set_profile(
  p_profile uuid,
  p_status  text default null,
  p_plan    text default null,
  p_role    text default null
)
returns public.profiles
language plpgsql security definer set search_path = ''
as $$
declare
  v_old  public.profiles;
  v_row  public.profiles;
  v_who  text;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  if p_profile = (select auth.uid()) then
    raise exception 'cannot_modify_self';
  end if;

  select * into v_old from public.profiles p where p.id = p_profile;
  if not found then
    raise exception 'profile_not_found';
  end if;

  update public.profiles
     set status  = coalesce(p_status, status),
         plan_id = coalesce(p_plan, plan_id),
         role    = coalesce(p_role, role)
   where id = p_profile
  returning * into v_row;

  v_who := coalesce(v_row.display_name, v_row.twitch_login, 'Cuenta');
  if p_status is not null and p_status is distinct from v_old.status then
    perform public.log_admin_action(
      p_profile,
      'profile_status',
      case p_status
        when 'suspended' then 'Se suspendió la cuenta de ' || v_who
        when 'active' then 'Se reactivó la cuenta de ' || v_who
        else 'Estado de ' || v_who || ': ' || p_status
      end
    );
  end if;
  if p_plan is not null and p_plan is distinct from v_old.plan_id then
    perform public.log_admin_action(
      p_profile,
      'profile_plan',
      'Se cambió el plan de ' || v_who || ' a ' || p_plan
    );
  end if;

  return v_row;
end;
$$;

create or replace function public.admin_set_elevenlabs(p_profile uuid, p_enabled boolean)
returns public.profiles
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.profiles;
  v_who text;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  if p_profile = (select auth.uid()) then
    raise exception 'cannot_modify_self';
  end if;

  update public.profiles
     set elevenlabs_enabled = coalesce(p_enabled, false),
         elevenlabs_invite_seen_at = case
           when coalesce(p_enabled, false) and not elevenlabs_enabled then null
           else elevenlabs_invite_seen_at
         end
   where id = p_profile
  returning * into v_row;

  if not found then
    raise exception 'profile_not_found';
  end if;

  v_who := coalesce(v_row.display_name, v_row.twitch_login, 'Cuenta');
  perform public.log_admin_action(
    p_profile,
    'elevenlabs_toggle',
    case when v_row.elevenlabs_enabled
      then 'Se activó ElevenLabs para ' || v_who
      else 'Se desactivó ElevenLabs para ' || v_who
    end
  );

  return v_row;
end;
$$;

create or replace function public.admin_set_elevenlabs_limit(p_profile uuid, p_daily_chars integer)
returns public.profiles
language plpgsql security definer set search_path = ''
as $$
declare
  v_row   public.profiles;
  v_who   text;
  v_limit integer := greatest(coalesce(p_daily_chars, 0), 0);
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;

  update public.profiles
     set elevenlabs_daily_chars = v_limit
   where id = p_profile
  returning * into v_row;

  if not found then
    raise exception 'profile_not_found';
  end if;

  v_who := coalesce(v_row.display_name, v_row.twitch_login, 'Cuenta');
  perform public.log_admin_action(
    p_profile,
    'elevenlabs_limit',
    case when v_limit = 0
      then 'Se dejó sin tope diario de ElevenLabs a ' || v_who
      else 'Tope diario de ElevenLabs para ' || v_who || ': ' || v_limit || ' caracteres'
    end
  );

  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Informe completo de uso y adopción para la consola (admin_usage_report)
-- -----------------------------------------------------------------------------

create or replace function public.admin_usage_report()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_today          date := (now() at time zone 'utc')::date;
  v_modules        jsonb := '[]'::jsonb;
  v_profiles       jsonb := '[]'::jsonb;
  v_audit          jsonb := '[]'::jsonb;
  v_integrations   jsonb := '{}'::jsonb;
  v_tournaments    jsonb := '{}'::jsonb;
  v_totals         jsonb;
  v_active_tourns  bigint := 0;
  v_total_entries  bigint := 0;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;

  -- 1. Adopción por módulo en public.configs (solo streamers activos)
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'module', m.module,
        'streamers', m.streamers,
        'last_updated_at', m.last_updated_at
      )
      order by m.streamers desc, m.module asc
    ),
    '[]'::jsonb
  )
    into v_modules
    from (
      select c.module,
             count(distinct c.profile_id) as streamers,
             max(c.updated_at) as last_updated_at
        from public.configs c
        join public.profiles p on p.id = c.profile_id
       where p.status = 'active' and p.role <> 'admin'
       group by c.module
    ) m;

  -- 2. Integraciones por perfil (si la migración 0013 está aplicada)
  if to_regclass('public.integration_accounts') is not null then
    execute $q$
      select coalesce(
        jsonb_object_agg(profile_id::text, providers),
        '{}'::jsonb
      )
      from (
        select ia.profile_id,
               jsonb_agg(ia.provider order by ia.provider) as providers
          from public.integration_accounts ia
         where ia.status = 'connected'
         group by ia.profile_id
      ) s
    $q$ into v_integrations;
  end if;

  -- 3. Torneos por perfil (si la migración 0017 está aplicada)
  if to_regclass('public.tournaments') is not null and to_regclass('public.tournament_entries') is not null then
    execute $q$
      select coalesce(
        jsonb_object_agg(
          t.profile_id::text,
          jsonb_build_object(
            'slug', t.slug,
            'name', t.name,
            'signup_open', t.signup_open,
            'entries_count', coalesce(e.cnt, 0)
          )
        ),
        '{}'::jsonb
      )
      from public.tournaments t
      left join (
        select profile_id, count(*) as cnt
          from public.tournament_entries
         where status <> 'rejected'
         group by profile_id
      ) e on e.profile_id = t.profile_id
    $q$ into v_tournaments;

    execute 'select count(*) from public.tournaments where signup_open = true' into v_active_tourns;
    execute 'select count(*) from public.tournament_entries where status <> ''rejected''' into v_total_entries;
  end if;

  -- 4. Detalle de uso por streamer
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'profile_id', p.id,
        'last_widget_at', p.last_widget_at,
        'configs_updated_at', cfg.last_updated_at,
        'modules', coalesce(cfg.modules, '[]'::jsonb),
        'integrations', coalesce(v_integrations -> (p.id::text), '[]'::jsonb),
        'tournament', v_tournaments -> (p.id::text),
        'elevenlabs_daily_chars', coalesce(p.elevenlabs_daily_chars, 15000),
        'tts_today', jsonb_build_object(
          'fish_requests', coalesce(td.fish_req, 0),
          'fish_chars', coalesce(td.fish_chars, 0),
          'eleven_requests', coalesce(td.eleven_req, 0),
          'eleven_chars', coalesce(td.eleven_chars, 0)
        ),
        'tts_7d', jsonb_build_object(
          'fish_requests', coalesce(w7.fish_req, 0),
          'fish_chars', coalesce(w7.fish_chars, 0),
          'eleven_requests', coalesce(w7.eleven_req, 0),
          'eleven_chars', coalesce(w7.eleven_chars, 0)
        )
      )
      order by p.created_at asc
    ),
    '[]'::jsonb
  )
    into v_profiles
    from public.profiles p
    left join lateral (
      select jsonb_agg(c.module order by c.module) as modules,
             max(c.updated_at) as last_updated_at
        from public.configs c
       where c.profile_id = p.id
    ) cfg on true
    left join lateral (
      select sum(case when u.provider = 'fish' then u.requests else 0 end)::int as fish_req,
             sum(case when u.provider = 'fish' then u.chars else 0 end)::int as fish_chars,
             sum(case when u.provider = 'elevenlabs' then u.requests else 0 end)::int as eleven_req,
             sum(case when u.provider = 'elevenlabs' then u.chars else 0 end)::int as eleven_chars
        from public.tts_usage_daily u
       where u.profile_id = p.id and u.day = v_today
    ) td on true
    left join lateral (
      select sum(case when u.provider = 'fish' then u.requests else 0 end)::int as fish_req,
             sum(case when u.provider = 'fish' then u.chars else 0 end)::int as fish_chars,
             sum(case when u.provider = 'elevenlabs' then u.requests else 0 end)::int as eleven_req,
             sum(case when u.provider = 'elevenlabs' then u.chars else 0 end)::int as eleven_chars
        from public.tts_usage_daily u
       where u.profile_id = p.id and u.day >= v_today - 6
    ) w7 on true
   where p.role <> 'admin';

  -- 5. Totales globales de uso
  select jsonb_build_object(
    'obs_active_24h', (
      select count(*) from public.profiles p
       where p.status = 'active' and p.role <> 'admin'
         and p.last_widget_at >= now() - interval '24 hours'
    ),
    'obs_active_7d', (
      select count(*) from public.profiles p
       where p.status = 'active' and p.role <> 'admin'
         and p.last_widget_at >= now() - interval '7 days'
    ),
    'panel_active_7d', (
      select count(*) from public.profiles p
       where p.status = 'active' and p.role <> 'admin'
         and p.last_seen_at >= now() - interval '7 days'
    ),
    'configured_streamers', (
      select count(distinct c.profile_id)
        from public.configs c
        join public.profiles p on p.id = c.profile_id
       where p.status = 'active' and p.role <> 'admin'
    ),
    'tts_7d_requests', (
      select coalesce(sum(u.requests), 0) from public.tts_usage_daily u where u.day >= v_today - 6
    ),
    'tts_7d_chars', (
      select coalesce(sum(u.chars), 0) from public.tts_usage_daily u where u.day >= v_today - 6
    ),
    'eleven_7d_requests', (
      select coalesce(sum(u.requests), 0) from public.tts_usage_daily u
       where u.day >= v_today - 6 and u.provider = 'elevenlabs'
    ),
    'eleven_7d_chars', (
      select coalesce(sum(u.chars), 0) from public.tts_usage_daily u
       where u.day >= v_today - 6 and u.provider = 'elevenlabs'
    ),
    'eleven_today_chars', (
      select coalesce(sum(u.chars), 0) from public.tts_usage_daily u
       where u.day = v_today and u.provider = 'elevenlabs'
    ),
    'active_tournaments', v_active_tourns,
    'total_tournament_entries', v_total_entries
  ) into v_totals;

  -- 6. Últimas acciones en la bitácora del administrador
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'action', a.action,
        'detail', a.detail,
        'created_at', a.created_at
      )
      order by a.created_at desc, a.id desc
    ),
    '[]'::jsonb
  )
    into v_audit
    from (
      select id, action, detail, created_at
        from public.admin_audit_log
       order by created_at desc, id desc
       limit 40
    ) a;

  return jsonb_build_object(
    'modules', v_modules,
    'profiles', v_profiles,
    'totals', v_totals,
    'audit_log', v_audit
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Permisos de ejecución
-- -----------------------------------------------------------------------------

revoke execute on function
  public.log_admin_action(uuid, text, text),
  public.check_and_record_tts_usage(uuid, text, text, integer),
  public.admin_set_elevenlabs_limit(uuid, integer),
  public.admin_usage_report()
from public, anon, authenticated;

grant execute on function
  public.admin_set_elevenlabs_limit(uuid, integer),
  public.admin_usage_report()
to authenticated;

grant execute on function
  public.check_and_record_tts_usage(uuid, text, text, integer)
to service_role;

grant execute on function
  public.widget_version(text),
  public.widget_bundle(text)
to anon, authenticated;

-- >>>>>>>>>> 0020_elevenlabs_key_slot.sql >>>>>>>>>>
-- =============================================================================
-- 0020_elevenlabs_key_slot.sql
--
-- Dos claves de ElevenLabs en el servidor (ELEVENLABS_API_KEY y
-- ELEVENLABS_API_KEY_2) y un selector en el panel del administrador que decide
-- cuál se usa para todo (síntesis, importar, clonar y borrar voces).
--
--   1. app_settings: clave/valor para configuración global de la aplicación.
--      Sin políticas de RLS: solo la escriben las funciones security definer
--      de esta migración y el servidor con la clave de servicio.
--   2. elevenlabs_active_key: ajuste con el slot activo ('1' o '2').
--   3. eleven_active_slot(): lo lee el panel del administrador.
--   4. admin_set_eleven_active_slot(1|2): lo cambia el administrador.
--
-- Las voces de ElevenLabs pertenecen a una cuenta: si se cambia de clave, las
-- voces clonadas con la otra dejan de encontrarse. Importarlas de nuevo con la
-- clave activa las devuelve al catálogo.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0019.
-- Se puede volver a ejecutar.
-- =============================================================================

create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

-- Slot de ElevenLabs activo: 1 o 2 (por defecto 1 si nunca se tocó).
create or replace function public.eleven_active_slot()
returns int
language sql stable security definer set search_path = ''
as $$
  select case
    when (select s.value::int from public.app_settings s where s.key = 'elevenlabs_active_key') = 2
      then 2
    else 1
  end;
$$;

-- El administrador elige qué clave de ElevenLabs se usa en el servidor.
create or replace function public.admin_set_eleven_active_slot(p_slot int)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_slot int;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  if p_slot not in (1, 2) then
    raise exception 'invalid_slot';
  end if;

  v_slot := p_slot;
  insert into public.app_settings (key, value, updated_at)
  values ('elevenlabs_active_key', v_slot::text, now())
  on conflict (key)
  do update set value = excluded.value, updated_at = excluded.updated_at;

  return v_slot;
end;
$$;

revoke execute on function
  public.eleven_active_slot(),
  public.admin_set_eleven_active_slot(int)
from public, anon, authenticated;

grant execute on function
  public.eleven_active_slot(),
  public.admin_set_eleven_active_slot(int)
to authenticated;

-- >>>>>>>>>> 0021_elevenlabs_voice_slot.sql >>>>>>>>>>
-- =============================================================================
-- 0021_elevenlabs_voice_slot.sql
--
-- Cada voz de ElevenLabs queda marcada con la clave (slot 1 o 2) en la que se
-- creó o importó. El catálogo solo muestra a los streamers las voces del slot
-- que el administrador tiene activo: una voz de la clave 1 no aparece cuando la
-- activa es la 2, y al revés. Así no se intenta usar una voz con una clave que
-- no la tiene.
--
--   1. voices.eleven_slot: 1 o 2. Solo se rellena en voces de ElevenLabs.
--   2. Las voces que ya existían se marcan con el slot 1: antes de la 0020 solo
--      había una clave, la que ahora es la 1.
--   3. Política voices_select: las voces de ElevenLabs se ven solo si su slot
--      coincide con el activo (eleven_active_slot, migración 0020).
--
-- Para crear voces nuevas en la clave 2: cambiar el slot activo a 2 en el panel
-- y clonar o importar como siempre.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0020.
-- Se puede volver a ejecutar.
-- =============================================================================

alter table public.voices
  add column if not exists eleven_slot smallint
  check (eleven_slot in (1, 2));

update public.voices
   set eleven_slot = 1
 where provider = 'elevenlabs' and eleven_slot is null;

grant select (eleven_slot) on public.voices to authenticated;

drop policy if exists voices_select on public.voices;
create policy voices_select on public.voices
  for select to authenticated
  using (
    provider = 'fish'
    or (
      (select public.eleven_enabled())
      and eleven_slot = (select public.eleven_active_slot())
    )
  );

-- >>>>>>>>>> 0022_admin_set_streamer_voice.sql >>>>>>>>>>
-- =============================================================================
-- 0022_admin_set_streamer_voice.sql
--
-- El administrador cambia la voz de TTS de un streamer desde el panel. El
-- cambio se escribe en su configuración sincronizada (public.configs, módulo
-- 'tts'): el widget de OBS lo recibe solo, porque widget_version sale de la
-- fecha de esa fila y se actualiza en cada cambio.
--
--   1. admin_set_streamer_voice(p_profile, p_reference_id, p_engine):
--      - solo administrador, y no sobre la propia cuenta;
--      - la voz tiene que existir en el catálogo, estar visible y ser del motor
--        indicado;
--      - una voz de ElevenLabs solo se asigna si el streamer tiene ElevenLabs
--        activado y la voz pertenece al slot de clave activo (0020 y 0021);
--      - se combina con la configuración existente: solo cambian referenceId y
--        engine, el resto de la configuración de TTS queda igual;
--      - anota la acción en la bitácora de auditoría.
--
-- Nota: el panel del streamer, al guardar su configuración de TTS, envía el
-- módulo completo. Si tiene el panel abierto en ese momento, puede volver a
-- poner su voz anterior. Al abrir el panel, la nube manda y recibe la nueva.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0021.
-- Se puede volver a ejecutar.
-- =============================================================================

create or replace function public.admin_set_streamer_voice(
  p_profile      uuid,
  p_reference_id text,
  p_engine       text
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_voice   public.voices;
  v_who     text;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  if p_profile = (select auth.uid()) then
    raise exception 'cannot_modify_self';
  end if;
  if p_engine not in ('fish', 'elevenlabs') then
    raise exception 'invalid_engine';
  end if;

  select * into v_profile from public.profiles p where p.id = p_profile;
  if not found then
    raise exception 'profile_not_found';
  end if;

  select * into v_voice
    from public.voices v
   where v.reference_id = p_reference_id
     and v.provider = p_engine;
  if not found then
    raise exception 'voice_not_found';
  end if;
  if not v_voice.visible then
    raise exception 'voice_not_visible';
  end if;

  if p_engine = 'elevenlabs' then
    if v_profile.role <> 'admin' and not coalesce(v_profile.elevenlabs_enabled, false) then
      raise exception 'streamer_without_elevenlabs';
    end if;
    if v_voice.eleven_slot is distinct from (select public.eleven_active_slot()) then
      raise exception 'voice_other_key';
    end if;
  end if;

  insert into public.configs (profile_id, module, data, updated_at)
  values (
    p_profile,
    'tts',
    jsonb_build_object('referenceId', p_reference_id, 'engine', p_engine),
    now()
  )
  on conflict (profile_id, module)
  do update set data = public.configs.data || excluded.data,
                updated_at = now();

  v_who := coalesce(v_profile.display_name, v_profile.twitch_login, 'Cuenta');
  perform public.log_admin_action(
    p_profile,
    'streamer_voice',
    'Se cambió la voz de ' || v_who || ' a ' || v_voice.name
  );
end;
$$;

revoke all on function public.admin_set_streamer_voice(uuid, text, text) from public, anon;
grant execute on function public.admin_set_streamer_voice(uuid, text, text) to authenticated;

-- >>>>>>>>>> 0023_lux_module.sql >>>>>>>>>>
-- =============================================================================
-- 0023_lux_module.sql
--
-- Módulo de Lux (personaje con IA) sobre la API de NVIDIA (build.nvidia.com).
--
--   1. profiles.lux_enabled: interruptor por streamer. Solo lo cambia el
--      administrador con admin_set_lux (abajo). El servidor lo vuelve a
--      comprobar con la clave de servicio antes de llamar a NVIDIA.
--   2. admin_set_lux(p_profile, p_enabled): el administrador activa o desactiva
--      Lux para una cuenta. Deja rastro en la bitácora (0019).
--   3. lux_memories: lo que Lux recuerda de cada streamer (datos, estilo,
--      espectadores, sucesos). Solo el dueño (y el administrador) la leen y
--      pueden borrar sus filas. Las escrituras las hace el servidor.
--   4. lux_replies: registro de las respuestas generadas, para no repetirlas y
--      para revisarlas. Mismas reglas de lectura que lux_memories.
--
-- La clave de NVIDIA NO va aquí en claro: el servidor la cifra (AES-256-GCM,
-- INTEGRATIONS_ENC_KEY) y la guarda en app_settings con la clave
-- 'nvidia_api_key_enc' (migración 0020, sin políticas de RLS).
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0022.
-- Se puede volver a ejecutar.
-- =============================================================================

alter table public.profiles
  add column if not exists lux_enabled boolean not null default false;

create or replace function public.admin_set_lux(p_profile uuid, p_enabled boolean)
returns public.profiles
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.profiles;
  v_who text;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  if p_profile = (select auth.uid()) then
    raise exception 'cannot_modify_self';
  end if;

  update public.profiles
     set lux_enabled = coalesce(p_enabled, false)
   where id = p_profile
  returning * into v_row;

  if not found then
    raise exception 'profile_not_found';
  end if;

  v_who := coalesce(v_row.display_name, v_row.twitch_login, 'Cuenta');
  perform public.log_admin_action(
    p_profile,
    'lux_toggle',
    case when v_row.lux_enabled
      then 'Se activó Lux para ' || v_who
      else 'Se desactivó Lux para ' || v_who
    end
  );

  return v_row;
end;
$$;

revoke execute on function public.admin_set_lux(uuid, boolean) from public, anon;
grant execute on function public.admin_set_lux(uuid, boolean) to authenticated;

create table if not exists public.lux_memories (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('fact', 'style', 'viewer', 'event')),
  subject     text,
  content     text not null check (char_length(content) between 1 and 500),
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists lux_memories_profile_idx
  on public.lux_memories (profile_id, created_at desc);

create table if not exists public.lux_replies (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  viewer      text,
  prompt      text not null check (char_length(prompt) <= 500),
  reply       text not null check (char_length(reply) <= 500),
  model       text not null,
  created_at  timestamptz not null default now()
);

create index if not exists lux_replies_profile_idx
  on public.lux_replies (profile_id, created_at desc);

alter table public.lux_memories enable row level security;
alter table public.lux_replies enable row level security;

drop policy if exists "lux_memories_read" on public.lux_memories;
create policy "lux_memories_read" on public.lux_memories
  for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "lux_memories_forget" on public.lux_memories;
create policy "lux_memories_forget" on public.lux_memories
  for delete to authenticated
  using (profile_id = (select auth.uid()));

drop policy if exists "lux_replies_read" on public.lux_replies;
create policy "lux_replies_read" on public.lux_replies
  for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_admin()));

-- >>>>>>>>>> 0024_lux_settings.sql >>>>>>>>>>
-- =============================================================================
-- 0024_lux_settings.sql
--
-- Ajustes de Lux AI por streamer: personalidad, longitud y idioma de las
-- respuestas, uso de la memoria y tamaño del personaje en el overlay.
--
-- Cada streamer lee y cambia solo su fila (RLS). El administrador puede leerla.
-- El servidor valida los valores antes de guardarlos (server/lux/settings.ts):
-- las comprobaciones de aquí son una última red, no la validación principal.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0023.
-- Se puede volver a ejecutar.
-- =============================================================================

create table if not exists public.lux_settings (
  profile_id     uuid primary key references public.profiles (id) on delete cascade,
  personality    text not null default '' check (char_length(personality) <= 600),
  reply_max      integer not null default 200 check (reply_max between 60 and 500),
  language       text not null default 'es' check (language in ('es', 'en', 'pt')),
  memory_enabled boolean not null default true,
  obs_size       integer not null default 40 check (obs_size between 10 and 100),
  updated_at     timestamptz not null default now()
);

alter table public.lux_settings enable row level security;

drop policy if exists "lux_settings_read" on public.lux_settings;
create policy "lux_settings_read" on public.lux_settings
  for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "lux_settings_write" on public.lux_settings;
create policy "lux_settings_write" on public.lux_settings
  for insert to authenticated
  with check (profile_id = (select auth.uid()));

drop policy if exists "lux_settings_update" on public.lux_settings;
create policy "lux_settings_update" on public.lux_settings
  for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

-- >>>>>>>>>> 0025_lux_voice.sql >>>>>>>>>>
-- =============================================================================
-- 0025_lux_voice.sql
--
-- La voz de Lux AI por streamer: el reference_id de una voz del catálogo y su
-- motor (Fish Audio o ElevenLabs). Las dos columnas van a la vez o ninguna: si
-- no hay voz elegida, Lux usa la voz por defecto del catálogo.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0024.
-- Se puede volver a ejecutar.
-- =============================================================================

alter table public.lux_settings
  add column if not exists voice_reference_id text,
  add column if not exists voice_engine text;

alter table public.lux_settings
  drop constraint if exists lux_settings_voice_engine_check;

alter table public.lux_settings
  add constraint lux_settings_voice_engine_check
    check (voice_engine is null or voice_engine in ('fish', 'elevenlabs'));

alter table public.lux_settings
  drop constraint if exists lux_settings_voice_pair_check;

alter table public.lux_settings
  add constraint lux_settings_voice_pair_check
    check ((voice_reference_id is null) = (voice_engine is null));

-- >>>>>>>>>> 0026_lux_chat.sql >>>>>>>>>>
-- =============================================================================
-- 0026_lux_chat.sql
--
-- Lux en el chat de Twitch: el interruptor del streamer para que Lux responda
-- a !lux en el chat (!luxon / !luxoff lo cambian desde el chat).
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0025.
-- Se puede volver a ejecutar.
-- =============================================================================

alter table public.lux_settings
  add column if not exists chat_enabled boolean not null default true;

-- >>>>>>>>>> 0027_lux_speech.sql >>>>>>>>>>
-- =============================================================================
-- 0027_lux_speech.sql
--
-- Lo que Lux tiene que decir en el overlay de OBS. El servidor escribe una fila
-- cada vez que Lux responde (por !lux en el chat o desde el panel); el overlay de
-- OBS lo lee con su clave de OBS (mismo patrón que el widget). Sin políticas de
-- RLS: solo lo tocan las funciones del servidor con la clave de servicio.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0026.
-- Se puede volver a ejecutar.
-- =============================================================================

create table if not exists public.lux_speech (
  id           bigserial primary key,
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  text         text not null check (char_length(text) between 1 and 500),
  emotion      text not null default 'normal',
  gesture      text not null default 'idle',
  voice_reference_id text,
  voice_engine text check (voice_engine is null or voice_engine in ('fish', 'elevenlabs')),
  created_at   timestamptz not null default now()
);

create index if not exists lux_speech_profile_idx on public.lux_speech (profile_id, id desc);

alter table public.lux_speech enable row level security;

-- >>>>>>>>>> 0028_lux_volume.sql >>>>>>>>>>
-- =============================================================================
-- 0028_lux_volume.sql
--
-- Volumen de la voz de Lux en el overlay de OBS (0 a 100, por defecto 100).
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0027.
-- Se puede volver a ejecutar.
-- =============================================================================

alter table public.lux_settings
  add column if not exists voice_volume integer not null default 100
    check (voice_volume between 0 and 100);

-- >>>>>>>>>> 0029_lux_delay.sql >>>>>>>>>>
-- =============================================================================
-- 0029_lux_delay.sql
--
-- Las respuestas de Lux a un comando del chat esperan 30 segundos: la frase
-- lleva la hora a partir de la que puede sonar en el overlay (play_after).
-- Las frases del panel no tienen retraso (play_after es null).
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0028.
-- Se puede volver a ejecutar.
-- =============================================================================

alter table public.lux_speech
  add column if not exists play_after timestamptz;

-- >>>>>>>>>> 0030_lux_memory.sql >>>>>>>>>>
-- =============================================================================
-- 0030_lux_memory.sql
--
-- Memoria de Lux (pestaña Memoria y aprendizaje del chat):
--
--   1. lux_settings.chat_learning: «Lux aprende del chat». Apagado por defecto.
--      Apagarlo no borra los recuerdos existentes.
--   2. lux_memories.source: 'manual' (dato o estilo, escritos a mano) o 'chat'
--      (espectador o suceso, aprendidos del resumen del chat).
--   3. lux_memories.expires_at: los recuerdos del chat sin fijar caducan a los
--      30 días. Los manuales no caducan (expires_at null).
--   4. Se retira la política de borrado para el dueño: a partir de ahora solo el
--      servidor (clave de servicio) escribe en lux_memories. El navegador ya no
--      puede borrar ni escribir directamente.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0029.
-- Se puede volver a ejecutar.
-- =============================================================================

alter table public.lux_settings
  add column if not exists chat_learning boolean not null default false;

alter table public.lux_memories
  add column if not exists source text not null default 'manual'
    check (source in ('manual', 'chat'));

alter table public.lux_memories
  add column if not exists expires_at timestamptz;

create index if not exists lux_memories_expiry_idx
  on public.lux_memories (expires_at)
  where expires_at is not null;

drop policy if exists "lux_memories_forget" on public.lux_memories;

-- >>>>>>>>>> 0031_lux_memory_admin.sql >>>>>>>>>>
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

-- >>>>>>>>>> 0032_lux_characters.sql >>>>>>>>>>
-- =============================================================================
-- 0032_lux_characters.sql
--
-- Personajes de Mi AI (antes «Lux AI»). Solo el administrador crea, edita y
-- borra personajes, y asigna uno a cada streamer desde su ficha.
--
--   1. lux_characters: catálogo de personajes. Avatar (de momento solo 'lux'),
--      color del pelo y del acento, gestos que usa en el overlay y modelo
--      propio (null = el modelo por defecto del proveedor). Hay un único
--      personaje por defecto («Lux»), que no se puede borrar.
--   2. profiles.lux_character_id: el personaje activo del streamer. Null =
--      el personaje por defecto. Un personaje activo por streamer.
--   3. lux_memories.character_id: cada recuerdo pertenece a un personaje. Los
--      existentes pasan al personaje que el streamer tenía en el momento de
--      esta migración (el por defecto, porque todavía no había otros).
--   4. plans.lux_monthly_credits: tope mensual de créditos de Mi AI por plan.
--      Un modelo con coste mayor que 0 consume créditos; si la cuenta supera el
--      tope, el personaje vuelve al modelo por defecto. Por defecto 0: los
--      modelos de pago no se usan hasta que el administrador ponga un tope.
--   5. lux_usage_monthly y lux_add_usage(): consumo de créditos por cuenta y
--      mes. Solo el servidor (clave de servicio) lo lee y lo escribe.
--
-- El navegador no toca ninguna de estas tablas: todo pasa por /api/lux/*.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0031.
-- Se puede volver a ejecutar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Catálogo de personajes
-- -----------------------------------------------------------------------------

create table if not exists public.lux_characters (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 40),
  avatar      text not null default 'lux' check (avatar in ('lux')),
  color       text not null default '#f59e0b' check (color ~* '^#[0-9a-f]{6}$'),
  gestures    text[] not null default array['wave', 'spin', 'dance', 'jump', 'sing', 'bow', 'ult', 'pride', 'nod', 'shrug', 'arms_up'],
  model       text check (model is null or char_length(model) <= 120),
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Un único personaje por defecto.
create unique index if not exists lux_characters_single_default
  on public.lux_characters (is_default) where is_default;

alter table public.lux_characters enable row level security;
revoke all on public.lux_characters from public, anon, authenticated;
grant all on public.lux_characters to service_role;

-- Personaje por defecto: «Lux». Solo si todavía no hay ninguno por defecto.
insert into public.lux_characters (name, is_default)
select 'Lux', true
 where not exists (select 1 from public.lux_characters where is_default);

-- -----------------------------------------------------------------------------
-- 2. Personaje activo por streamer
-- -----------------------------------------------------------------------------

alter table public.profiles
  add column if not exists lux_character_id uuid references public.lux_characters (id) on delete set null;

update public.profiles
   set lux_character_id = (select c.id from public.lux_characters c where c.is_default)
 where lux_character_id is null;

-- -----------------------------------------------------------------------------
-- 3. Recuerdos por personaje
-- -----------------------------------------------------------------------------

alter table public.lux_memories
  add column if not exists character_id uuid references public.lux_characters (id) on delete cascade;

update public.lux_memories m
   set character_id = p.lux_character_id
  from public.profiles p
 where p.id = m.profile_id
   and m.character_id is null
   and p.lux_character_id is not null;

alter table public.lux_memories alter column character_id set not null;

create index if not exists lux_memories_character_idx
  on public.lux_memories (profile_id, character_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 4. Tope mensual de créditos por plan
-- -----------------------------------------------------------------------------

alter table public.plans
  add column if not exists lux_monthly_credits integer not null default 0 check (lux_monthly_credits >= 0);

-- -----------------------------------------------------------------------------
-- 5. Consumo mensual por cuenta (solo servidor)
-- -----------------------------------------------------------------------------

create table if not exists public.lux_usage_monthly (
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  month       text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  credits     integer not null default 0 check (credits >= 0),
  updated_at  timestamptz not null default now(),
  primary key (profile_id, month)
);

alter table public.lux_usage_monthly enable row level security;
revoke all on public.lux_usage_monthly from public, anon, authenticated;
grant all on public.lux_usage_monthly to service_role;

-- Suma créditos de forma atómica (dos respuestas a la vez no se pisan).
create or replace function public.lux_add_usage(p_profile uuid, p_month text, p_credits integer)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.lux_usage_monthly (profile_id, month, credits, updated_at)
  values (p_profile, p_month, greatest(coalesce(p_credits, 0), 0), now())
  on conflict (profile_id, month) do update
     set credits    = public.lux_usage_monthly.credits + excluded.credits,
         updated_at = now();
$$;

revoke execute on function public.lux_add_usage(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.lux_add_usage(uuid, text, integer) to service_role;

-- >>>>>>>>>> 0033_lux_character_owner.sql >>>>>>>>>>
-- =============================================================================
-- 0033_lux_character_owner.sql
--
-- Mascota 2: personaje de Mi AI con modelo GLB propio, de uso privado de una
-- cuenta (la de jagc). Amplía lux_characters de la 0032.
--
--   1. lux_characters.avatar admite 'glb:<id>' además de 'lux' (el id es un
--      modelo que existe en el servidor: LUX_MODEL_AVATAR_IDS).
--   2. lux_characters.owner_profile_id: cuenta dueña. Null = visible para todas
--      las cuentas. Un avatar GLB exige dueño. Si se borra la cuenta, su
--      personaje se borra con ella (on delete cascade): nunca queda público.
--   3. lux_characters.model_key: clave del archivo del modelo en el bucket
--      privado de R2 (R2_MODELS_BUCKET). Solo la lee el servidor; nunca sale.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0032.
-- Se puede volver a ejecutar.
-- =============================================================================

alter table public.lux_characters drop constraint if exists lux_characters_avatar_check;
alter table public.lux_characters
  add constraint lux_characters_avatar_check
  check (avatar = 'lux' or avatar ~ '^glb:[a-z0-9][a-z0-9-]{0,39}$');

alter table public.lux_characters
  add column if not exists owner_profile_id uuid references public.profiles (id) on delete cascade,
  add column if not exists model_key text;

alter table public.lux_characters drop constraint if exists lux_characters_model_key_check;
alter table public.lux_characters
  add constraint lux_characters_model_key_check
  check (model_key is null or model_key ~ '^lux-models/[0-9a-f]{32}\.glb$');

alter table public.lux_characters drop constraint if exists lux_characters_glb_owner_check;
alter table public.lux_characters
  add constraint lux_characters_glb_owner_check
  check (avatar = 'lux' or owner_profile_id is not null);

create index if not exists lux_characters_owner_idx on public.lux_characters (owner_profile_id);

-- >>>>>>>>>> 0034_lux_character_model.sql >>>>>>>>>>
-- =============================================================================
-- 0034_lux_character_model.sql
--
-- Subida del modelo 3D desde el panel (Mi AI, ficha del personaje) y aviso de
-- licencia de Riot Games. Amplía lux_characters de la 0033.
--
--   1. model_origin: de quién es el modelo GLB. 'riot' = modelo de Riot Games
--      (obliga a mostrar el aviso de licencia en la ficha, en el panel del
--      streamer y en el pie del overlay); 'propio' = de quien lo subió.
--   2. model_file_name, model_file_bytes, model_uploaded_at: datos del archivo
--      actual que muestra la ficha (nombre, tamaño y fecha de subida).
--   3. model_pending_key: clave que el servidor dio para una subida que aún no
--      se ha confirmado. Solo se acepta confirmar esa clave.
--   4. model_stale_keys: archivos viejos de R2 cuyo borrado falló. Se reintentan
--      en la siguiente subida o al quitar el modelo.
--
-- El Warwick actual (avatar 'glb:warwick') es de Riot: se marca como 'riot'.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0033.
-- Se puede volver a ejecutar.
-- =============================================================================

alter table public.lux_characters
  add column if not exists model_origin text,
  add column if not exists model_file_name text,
  add column if not exists model_file_bytes bigint,
  add column if not exists model_uploaded_at timestamptz,
  add column if not exists model_pending_key text,
  add column if not exists model_stale_keys text[] not null default '{}';

alter table public.lux_characters drop constraint if exists lux_characters_model_origin_check;
alter table public.lux_characters
  add constraint lux_characters_model_origin_check
  check (model_origin is null or model_origin in ('riot', 'propio'));

alter table public.lux_characters drop constraint if exists lux_characters_model_pending_key_check;
alter table public.lux_characters
  add constraint lux_characters_model_pending_key_check
  check (model_pending_key is null or model_pending_key ~ '^lux-models/[0-9a-f]{32}\.glb$');

-- Marca el modelo de Riot ya subido (Warwick). Solo rellena lo que falta.
update public.lux_characters
   set model_origin = 'riot'
 where avatar = 'glb:warwick' and model_origin is null;

-- >>>>>>>>>> 0035_lux_model_library.sql >>>>>>>>>>
-- =============================================================================
-- 0035_lux_model_library.sql
--
-- Biblioteca de modelos 3D de Mi AI y modelos de los creadores. Amplía las
-- 0032, 0033 y 0034.
--
--   1. lux_models: modelos que sube un creador con su propia cuenta. Son
--      privados de su dueño hasta que el administrador los revisa y confirma
--      su licencia (review_status 'privado' -> 'pendiente' -> 'aprobado').
--      Los modelos de Riot Games NO se copian aquí: la biblioteca los lee de
--      lux_characters (model_origin = 'riot'), así no hay dos copias de la misma clave.
--   2. profiles.lux_model_id: modelo que el creador eligió para su personaje
--      (de la biblioteca o suyo). Sin clave foránea: puede apuntar a un modelo
--      de Riot (que vive en lux_characters); el servidor valida la elección
--      en cada lectura y, si ya no es visible, la ignora.
--   3. plans.lux_max_models: nº máximo de modelos propios por creador según
--      plan. Null = 0 (sin modelos propios). Se siembra con 2 en Básico y 10
--      en Plus solo si está vacío: si el administrador lo cambia en Límites,
--      una nueva ejecución no lo pisa.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0034.
-- Se puede volver a ejecutar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Modelos de los creadores
-- -----------------------------------------------------------------------------

create table if not exists public.lux_models (
  id                 uuid primary key default gen_random_uuid(),
  owner_profile_id   uuid not null references public.profiles (id) on delete cascade,
  name               text not null check (char_length(name) between 1 and 80),
  file_name          text,
  file_bytes         bigint check (file_bytes is null or file_bytes >= 0),
  -- Archivo ya confirmado en R2 (null mientras no se haya subido o tras quitarlo).
  model_key          text check (model_key is null or model_key ~ '^lux-models/[0-9a-f]{32}\.glb$'),
  -- Clave dada para una subida que aún no se ha confirmado.
  pending_key        text check (pending_key is null or pending_key ~ '^lux-models/[0-9a-f]{32}\.glb$'),
  -- Archivos cuyo borrado en R2 falló. Se reintentan en la siguiente operación del dueño.
  stale_keys         text[] not null default '{}',
  review_status      text not null default 'privado' check (review_status in ('privado', 'pendiente', 'aprobado')),
  -- El administrador confirma la licencia antes de publicar.
  license_confirmed  boolean not null default false,
  uploaded_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint lux_models_approved_check check (review_status <> 'aprobado' or (license_confirmed and model_key is not null)),
  constraint lux_models_file_check check (model_key is not null or review_status = 'privado')
);

create unique index if not exists lux_models_model_key_idx on public.lux_models (model_key) where model_key is not null;
create index if not exists lux_models_owner_idx on public.lux_models (owner_profile_id);

alter table public.lux_models enable row level security;
revoke all on public.lux_models from public, anon, authenticated;
grant all on public.lux_models to service_role;

-- -----------------------------------------------------------------------------
-- 2. Modelo elegido por el creador
-- -----------------------------------------------------------------------------

alter table public.profiles
  add column if not exists lux_model_id uuid;

-- -----------------------------------------------------------------------------
-- 3. Cuota de modelos propios por plan
-- -----------------------------------------------------------------------------

alter table public.plans
  add column if not exists lux_max_models integer check (lux_max_models is null or lux_max_models >= 0);

-- Valores propuestos (diseño aprobado, S5). Solo si el plan todavía no tiene valor.
update public.plans set lux_max_models = 2 where id = 'basico' and lux_max_models is null;
update public.plans set lux_max_models = 10 where id = 'plus' and lux_max_models is null;

-- >>>>>>>>>> 0036_lux_chat_word.sql >>>>>>>>>>
-- =============================================================================
-- 0036_lux_chat_word.sql
--
-- Comando de activación de Mi AI en el chat: la palabra con la que el público
-- habla con el personaje (por defecto «lux», así que nadie se rompe) y el
-- interruptor del alias !lux. Amplía la 0024 (lux_settings).
--
--   1. chat_word: la palabra, en minúsculas, de 2 a 20 letras o números (ASCII).
--      Sin espacios ni símbolos. No puede ser un comando reservado del bot
--      (s, luxon, luxoff). La validación real está en server/lux/chatCommands.ts;
--      esta restricción es la última red.
--   2. chat_alias: si !lux sigue funcionando cuando la palabra es otra.
--      Encendido por defecto. Con la palabra «lux» no tiene efecto.
--
-- El bot lee estos valores al generarse (src/components/bot/pythonScript.ts):
-- cambiarlos obliga a volver a copiar el script del bot.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0035.
-- Se puede volver a ejecutar.
-- =============================================================================

alter table public.lux_settings add column if not exists chat_word text not null default 'lux';
alter table public.lux_settings add column if not exists chat_alias boolean not null default true;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lux_settings_chat_word_check') then
    alter table public.lux_settings add constraint lux_settings_chat_word_check
      check (chat_word ~ '^[a-z0-9]{2,20}$' and chat_word not in ('s', 'luxon', 'luxoff'));
  end if;
end $$;

-- >>>>>>>>>> 0037_lux_proactive.sql >>>>>>>>>>
-- =============================================================================
-- 0037_lux_proactive.sql
--
-- Mi AI habla sin que se lo pidan y con el nombre que elige el creador. Amplía la
-- 0024 (lux_settings) y añade la cola de mensajes que el panel deja para el bot.
--
--   1. chat_name: nombre visible de la IA en el chat (0 a 30 caracteres). Vacío
--      = se usa la palabra de activación (chat_word, 0036).
--   2. Comentarios espontáneos: spontaneous_enabled (encendido por defecto),
--      spontaneous_every_min (10, 15, 30 o 60) y spontaneous_min_messages
--      (3, 5 o 10 mensajes de espectadores desde el último comentario).
--   3. Reacciones a eventos: event_follow, event_sub, event_raid y event_start
--      (todas encendidas por defecto).
--   4. lux_outbox: cola de mensajes por streamer. El panel escribe (por el
--      servidor); el bot los recoge con su clave de OBS y confirma el envío.
--      Estados: pending (en cola), claimed (el bot lo recogió), sent (el bot
--      confirmó que lo publicó) y failed (el bot no pudo publicarlo).
--      RLS activado y sin políticas: solo lo tocan las funciones del servidor con
--      la clave de servicio (mismo patrón que lux_speech, 0027).
--
-- La validación real está en server/lux/settings.ts; estas restricciones son la
-- última red. Cambiar la palabra o el nombre obliga a volver a copiar el script del
-- bot (src/components/bot/pythonScript.ts, versión 6).
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0036.
-- Se puede volver a ejecutar.
-- =============================================================================

alter table public.lux_settings add column if not exists chat_name text not null default '';
alter table public.lux_settings add column if not exists spontaneous_enabled boolean not null default true;
alter table public.lux_settings add column if not exists spontaneous_every_min integer not null default 15;
alter table public.lux_settings add column if not exists spontaneous_min_messages integer not null default 10;
alter table public.lux_settings add column if not exists event_follow boolean not null default true;
alter table public.lux_settings add column if not exists event_sub boolean not null default true;
alter table public.lux_settings add column if not exists event_raid boolean not null default true;
alter table public.lux_settings add column if not exists event_start boolean not null default true;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lux_settings_chat_name_check') then
    alter table public.lux_settings add constraint lux_settings_chat_name_check
      check (char_length(chat_name) <= 30);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lux_settings_spontaneous_every_check') then
    alter table public.lux_settings add constraint lux_settings_spontaneous_every_check
      check (spontaneous_every_min in (10, 15, 30, 60));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lux_settings_spontaneous_min_check') then
    alter table public.lux_settings add constraint lux_settings_spontaneous_min_check
      check (spontaneous_min_messages in (3, 5, 10));
  end if;
end $$;

create table if not exists public.lux_outbox (
  id          bigserial primary key,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  text        text not null check (char_length(text) between 1 and 500),
  speak       boolean not null default false,
  emotion     text not null default 'normal',
  mode        text not null default 'literal' check (mode in ('literal', 'ai')),
  status      text not null default 'pending' check (status in ('pending', 'claimed', 'sent', 'failed')),
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  sent_at     timestamptz
);

create index if not exists lux_outbox_profile_idx on public.lux_outbox (profile_id, status, id);

alter table public.lux_outbox enable row level security;

-- >>>>>>>>>> 0038_twitch_follow_start.sql >>>>>>>>>>
-- =============================================================================
-- 0038_twitch_follow_start.sql
--
-- Seguidores nuevos (channel.follow v2) e inicio del directo (stream.online) por
-- EventSub, para que Mi AI los salude. Amplía la 0012/0013:
--
--   1. twitch_events admite los tipos «follow» y «stream_online». Sirven solo
--      para no procesar dos veces el mismo aviso (el id del mensaje de Twitch es
--      único) y se borran solos a los quince minutos como el resto.
--   2. ingest_twitch_event acepta esos tipos. Con ellos devuelve 'ok:<id del
--      perfil>' en lugar de 'ok': el servidor necesita saber de qué streamer es el
--      aviso para dejar el saludo en su cola (lux_outbox, 0037). Con los demás
--      tipos no cambia nada. El dueño del canal se busca igual que antes: por
--      profiles.twitch_user_id, solo cuentas activas.
--   3. widget_events no entrega esos dos tipos a la capa de OBS: no tienen
--      efecto visual propio (las alertas de seguidor salen de otro camino) y la
--      capa no los conoce.
--
-- No guarda nada nuevo de los espectadores: el nombre del seguidor viaja en el
-- payload, que se borra a los quince minutos.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0037.
-- Se puede volver a ejecutar.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tipos nuevos en la tabla de eventos
-- ---------------------------------------------------------------------------

do $$
declare
  v_name text;
begin
  for v_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.twitch_events'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%kind%'
  loop
    execute format('alter table public.twitch_events drop constraint %I', v_name);
  end loop;
end
$$;

alter table public.twitch_events
  add constraint twitch_events_kind_check
  check (kind in ('bits', 'powerup', 'points', 'kofi', 'follow', 'stream_online'));

-- ---------------------------------------------------------------------------
-- 2. Entrada desde el servidor (solo clave de servicio)
-- ---------------------------------------------------------------------------

-- Devuelve 'ok', 'duplicate' (mensaje ya guardado) o 'unknown_channel' (ningún
-- streamer activo tiene ese canal de Twitch). Con «follow» y «stream_online»,
-- en lugar de 'ok' devuelve 'ok:' seguido del id del perfil.
create or replace function public.ingest_twitch_event(
  p_message_id     text,
  p_twitch_user_id text,
  p_kind           text,
  p_payload        jsonb,
  p_bits           integer default 0
)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_profile uuid;
  v_event   bigint;
  v_goals   jsonb;
begin
  if p_message_id is null or p_twitch_user_id is null or p_payload is null
     or p_kind not in ('bits', 'powerup', 'points', 'follow', 'stream_online') then
    raise exception 'bad_event';
  end if;

  select p.id into v_profile
  from public.profiles p
  where p.twitch_user_id = p_twitch_user_id and p.status = 'active';
  if not found then
    return 'unknown_channel';
  end if;

  -- Limpieza: lo que tiene más de quince minutos ya no le sirve a nadie
  delete from public.twitch_events e where e.created_at < now() - interval '15 minutes';

  insert into public.twitch_events (profile_id, message_id, kind, payload)
  values (v_profile, p_message_id, p_kind, p_payload)
  on conflict (message_id) do nothing
  returning id into v_event;
  if v_event is null then
    return 'duplicate';
  end if;

  -- Bits a las metas: cada meta de tipo bits, encendida y sin el interruptor
  -- «contar los Bits de Twitch» apagado (countBits = false), suma la cantidad.
  -- Se hace aquí, una sola vez por mensaje, para que no dependa de qué fuentes
  -- de OBS estén abiertas.
  if p_kind = 'bits' and coalesce(p_bits, 0) > 0 then
    update public.configs c
    set data = jsonb_set(c.data, '{goals}', (
      select coalesce(jsonb_agg(
        case
          when g ->> 'type' = 'bits'
               and g -> 'enabled' is distinct from 'false'::jsonb
               and g -> 'countBits' is distinct from 'false'::jsonb
          then jsonb_set(g, '{current}', to_jsonb(
                 (case when jsonb_typeof(g -> 'current') = 'number' then (g ->> 'current')::numeric else 0 end)
                 + p_bits))
          else g
        end
        order by ord), '[]'::jsonb)
      from jsonb_array_elements(c.data -> 'goals') with ordinality as t(g, ord)
    ))
    where c.profile_id = v_profile
      and c.module = 'goals'
      and jsonb_typeof(c.data -> 'goals') = 'array';

    -- El evento lleva el total nuevo de cada meta: la capa de OBS pone ese
    -- número, no suma por su cuenta, así que no puede contar dos veces
    select jsonb_agg(jsonb_build_object('id', g ->> 'id', 'current', g -> 'current'))
      into v_goals
    from public.configs c, jsonb_array_elements(c.data -> 'goals') as g
    where c.profile_id = v_profile
      and c.module = 'goals'
      and jsonb_typeof(c.data -> 'goals') = 'array'
      and g ->> 'type' = 'bits'
      and g -> 'enabled' is distinct from 'false'::jsonb
      and g -> 'countBits' is distinct from 'false'::jsonb;

    if v_goals is not null then
      update public.twitch_events e
      set payload = e.payload || jsonb_build_object('goals', v_goals)
      where e.id = v_event;
    end if;
  end if;

  if p_kind in ('follow', 'stream_online') then
    return 'ok:' || v_profile::text;
  end if;
  return 'ok';
end;
$$;

revoke all on function public.ingest_twitch_event(text, text, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.ingest_twitch_event(text, text, text, jsonb, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3. La capa de OBS no recibe los tipos nuevos
-- ---------------------------------------------------------------------------

create or replace function public.widget_events(p_key text, p_after bigint default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_profile uuid;
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

  if p_after is null then
    return jsonb_build_object(
      'cursor', coalesce((select max(e.id) from public.twitch_events e where e.profile_id = v_profile), 0),
      'events', '[]'::jsonb);
  end if;

  return (
    with fresh as (
      select e.id, e.kind, e.payload, e.is_test, e.created_at
      from public.twitch_events e
      where e.profile_id = v_profile
        and e.id > p_after
        and e.kind not in ('follow', 'stream_online')
        -- Lo que tiene más de dos minutos llega tarde para salir en pantalla
        and e.created_at > now() - interval '2 minutes'
      order by e.id
      limit 20
    )
    select jsonb_build_object(
      'cursor', coalesce((select max(f.id) from fresh f), p_after),
      'events', coalesce(
        (select jsonb_agg(jsonb_build_object(
                  'id', f.id, 'kind', f.kind, 'payload', f.payload, 'test', f.is_test, 'at', f.created_at)
                order by f.id)
           from fresh f),
        '[]'::jsonb))
  );
end;
$$;

revoke all on function public.widget_events(text, bigint) from public;
grant execute on function public.widget_events(text, bigint) to anon, authenticated;

-- >>>>>>>>>> 0039_twitch_bot.sql >>>>>>>>>>
-- =============================================================================
-- 0039_twitch_bot.sql
--
-- Datos del bot de chat de Twitch en la nube. Hasta ahora los comandos de cada
-- streamer vivían solo en el navegador y servían para generar un script de
-- Python (src/components/bot/pythonScript.ts). Para que el servidor conteste en
-- el chat necesita leerlos por canal:
--
--   1. twitch_bot_settings: una fila por streamer. Encendido, prefijo, mensaje de
--      bienvenida y quién escribe en el chat (sender_mode): 'global' es la
--      cuenta del bot de la plataforma; 'streamer' queda reservado para cuando
--      cada uno use su propia cuenta (hoy no lo usa nadie).
--   2. twitch_bot_commands: los comandos personalizados. El nombre va en
--      minúsculas, sin prefijo ni espacios, y no se repite dentro de un streamer.
--      El permiso es all, sub, mod o broadcaster, como CommandPermission.
--   3. twitch_bot_cooldowns: la hora a partir de la que algo puede volver a
--      pasar para un (canal, nombre, clave). Se toma con take_twitch_bot_cooldown,
--      que decide en una sola sentencia para que dos avisos a la vez no pasen los
--      dos. Sirve para varias cosas, todas con la misma función:
--        - cooldown de un espectador: viewer = su usuario en minúsculas, key = el
--          comando (p. ej. 'cmd:redes', 'lux');
--        - deduplicación de un aviso: viewer = 'dedupe', key = 'm:' + Message-Id;
--        - candado entre instancias y límite de tasa por streamer: viewer = '_',
--          key = 'digest', 'spont', 'api_status', 'api_connect'.
--      Solo guarda ese nombre, la clave y la hora; lo caducado se puede borrar sin
--      perder nada (ver purge_twitch_bot_data, en 0041).
--
-- (Una tabla twitch_bot_state con la hora del último comentario espontáneo se
-- planteó y se quitó: esa hora ya vive en los ajustes de Mi AI (lux_spontaneous).)
--
-- RLS: cada streamer LEE solo sus ajustes y sus comandos (y el administrador, todos).
-- No hay políticas de escritura para authenticated: escribe el servidor con la
-- clave de servicio (que se salta RLS), tras comprobar la sesión y validar los datos
-- (server/twitch/botHandlers.ts). Así nadie se salta esas validaciones ni el tope de
-- comandos hablando directo con PostgREST. La tabla de cooldowns lleva RLS y ninguna
-- política: solo el servidor la toca (mismo patrón que lux_outbox, 0037). La función
-- de cooldown solo la puede ejecutar la clave de servicio.
--
-- Las reglas de nombres reales están en cleanCommandName (pythonScript.ts) y en
-- server/twitch/botDb.ts; estas restricciones son la última red.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0038.
-- Se puede volver a ejecutar.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Ajustes del bot
-- ---------------------------------------------------------------------------

create table if not exists public.twitch_bot_settings (
  profile_id      uuid primary key references public.profiles (id) on delete cascade,
  enabled         boolean not null default false,
  prefix          text not null default '!' check (char_length(prefix) between 1 and 5 and prefix !~ '\s'),
  welcome_message text not null default '' check (char_length(welcome_message) <= 500),
  sender_mode     text not null default 'global' check (sender_mode in ('global', 'streamer')),
  updated_at      timestamptz not null default now()
);

alter table public.twitch_bot_settings enable row level security;

drop policy if exists "twitch_bot_settings_read" on public.twitch_bot_settings;
create policy "twitch_bot_settings_read" on public.twitch_bot_settings
  for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_admin()));

-- Sin políticas de escritura para authenticated. Si una versión anterior las creó, se quitan
drop policy if exists "twitch_bot_settings_write" on public.twitch_bot_settings;
drop policy if exists "twitch_bot_settings_update" on public.twitch_bot_settings;

-- ---------------------------------------------------------------------------
-- 2. Comandos personalizados
-- ---------------------------------------------------------------------------

create table if not exists public.twitch_bot_commands (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 50 and name = lower(name) and name !~ '\s' and name !~ '^!'),
  response    text not null check (char_length(response) between 1 and 500),
  permission  text not null default 'all' check (permission in ('all', 'sub', 'mod', 'broadcaster')),
  enabled     boolean not null default true,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (profile_id, name)
);

create index if not exists twitch_bot_commands_profile_idx on public.twitch_bot_commands (profile_id, position);

alter table public.twitch_bot_commands enable row level security;

drop policy if exists "twitch_bot_commands_read" on public.twitch_bot_commands;
create policy "twitch_bot_commands_read" on public.twitch_bot_commands
  for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_admin()));

-- Sin políticas de escritura para authenticated. Si una versión anterior las creó, se quitan
drop policy if exists "twitch_bot_commands_insert" on public.twitch_bot_commands;
drop policy if exists "twitch_bot_commands_update" on public.twitch_bot_commands;
drop policy if exists "twitch_bot_commands_delete" on public.twitch_bot_commands;

-- ---------------------------------------------------------------------------
-- 3. Cooldowns, deduplicación, candados y límites de tasa por (streamer, nombre, clave)
-- ---------------------------------------------------------------------------

create table if not exists public.twitch_bot_cooldowns (
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  viewer        text not null check (char_length(viewer) between 1 and 40), -- usuario en minúsculas, 'dedupe' o '_'
  key           text not null check (char_length(key) between 1 and 60),
  available_at  timestamptz not null,
  primary key (profile_id, viewer, key)
);

create index if not exists twitch_bot_cooldowns_available_idx on public.twitch_bot_cooldowns (available_at);

alter table public.twitch_bot_cooldowns enable row level security;

-- Toma el cooldown de forma atómica. Devuelve 0 si el espectador puede usar la
-- clave (y deja anotada la próxima hora libre) o los segundos que le faltan,
-- redondeados hacia arriba, sin tocar nada si aún no puede.
create or replace function public.take_twitch_bot_cooldown(
  p_profile_id uuid,
  p_viewer     text,
  p_key        text,
  p_seconds    integer
) returns integer
language plpgsql
set search_path = public
as $$
declare
  v_taken integer;
  v_wait  integer;
begin
  insert into public.twitch_bot_cooldowns as c (profile_id, viewer, key, available_at)
  values (p_profile_id, lower(p_viewer), p_key, now() + make_interval(secs => greatest(p_seconds, 0)))
  on conflict (profile_id, viewer, key) do update
    set available_at = excluded.available_at
    where c.available_at <= now()
  returning 1 into v_taken;

  if v_taken is not null then
    return 0;
  end if;

  select greatest(1, ceil(extract(epoch from (available_at - now())))::integer)
    into v_wait
    from public.twitch_bot_cooldowns
    where profile_id = p_profile_id and viewer = lower(p_viewer) and key = p_key;

  return coalesce(v_wait, 1);
end;
$$;

revoke all on function public.take_twitch_bot_cooldown(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.take_twitch_bot_cooldown(uuid, text, text, integer) to service_role;

-- >>>>>>>>>> 0040_twitch_bot_limiter.sql >>>>>>>>>>
-- =============================================================================
-- 0040_twitch_bot_limiter.sql
--
-- Limitador de envíos del bot de chat de Twitch que sobrevive entre peticiones.
-- En Vercel cada aviso de EventSub puede caer en una instancia distinta, así que
-- el limitador en memoria de chatSend.ts no basta. Twitch deja al bot 20 mensajes
-- cada 30 s en total y 1 por segundo en cada canal; si se pasa, lo ignora durante
-- una hora. Además, un solo canal (o un espectador que lo satura) no debe poder gastar
-- el cupo de todos los demás: cada canal tiene su propio tope dentro de la ventana de 30 s.
-- Por eso se cuenta aquí:
--
--   twitch_bot_sends: una fila por mensaje enviado (cuenta del bot, canal, hora).
--                     Solo guarda ids de Twitch y la hora; nada del contenido.
--   take_twitch_bot_send(bot, canal, tope, tope_canal): decide y anota en una sola transacción.
--                     Un candado asesor por cuenta del bot hace que dos avisos a
--                     la vez no se lleven el mismo hueco. Devuelve jsonb:
--                       {"ok": true}
--                       {"ok": false, "waitMs": <ms>, "scope": "channel" | "account"}
--                     "channel" cubre el 1/s y el tope por canal en 30 s (p_channel_max, 6 por defecto).
--                     y, cuando no deja enviar, NO anota nada. Usa la hora de la
--                     base de datos (clock_timestamp), no la del servidor web.
--                     Borra de paso las filas de más de 60 s de esa cuenta.
--
-- RLS sin políticas: solo el servidor con la clave de servicio toca la tabla, y
-- solo la clave de servicio ejecuta la función (mismo patrón que 0039).
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0039. Se puede volver a ejecutar.
-- =============================================================================

create table if not exists public.twitch_bot_sends (
  id          bigint generated always as identity primary key,
  bot_id      text not null check (char_length(bot_id) between 1 and 20),
  channel_id  text not null check (char_length(channel_id) between 1 and 20),
  sent_at     timestamptz not null default clock_timestamp()
);

create index if not exists twitch_bot_sends_bot_idx on public.twitch_bot_sends (bot_id, sent_at desc);
create index if not exists twitch_bot_sends_channel_idx on public.twitch_bot_sends (bot_id, channel_id, sent_at desc);

alter table public.twitch_bot_sends enable row level security;

-- Por si una versión anterior de 3 argumentos llegó a crearse: dos sobrecargas harían ambigua la llamada
drop function if exists public.take_twitch_bot_send(text, text, integer);

create or replace function public.take_twitch_bot_send(
  p_bot_id      text,
  p_channel_id  text,
  p_account_max integer default 20,
  p_channel_max integer default 6
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_now          timestamptz := clock_timestamp();
  v_max          integer := greatest(coalesce(p_account_max, 20), 1);
  v_cmax         integer := greatest(coalesce(p_channel_max, 6), 1);
  v_ccount       integer;
  v_cnth         timestamptz;
  v_last_channel timestamptz;
  v_count        integer;
  v_nth          timestamptz;
  v_channel_wait integer := 0;
  v_account_wait integer := 0;
begin
  -- Un solo envío a la vez por cuenta de bot: el candado se suelta al acabar la transacción
  perform pg_advisory_xact_lock(hashtextextended('twitch_bot_send:' || p_bot_id, 0));

  delete from public.twitch_bot_sends
    where bot_id = p_bot_id and sent_at < v_now - interval '60 seconds';

  select max(sent_at) into v_last_channel
    from public.twitch_bot_sends
    where bot_id = p_bot_id and channel_id = p_channel_id;
  if v_last_channel is not null and v_last_channel > v_now - interval '1 second' then
    v_channel_wait := ceil(extract(epoch from (v_last_channel + interval '1 second' - v_now)) * 1000)::integer;
  end if;

  -- Tope por canal en la ventana de 30 s: ningún canal se lleva todo el cupo de la cuenta
  select count(*) into v_ccount
    from public.twitch_bot_sends
    where bot_id = p_bot_id and channel_id = p_channel_id and sent_at > v_now - interval '30 seconds';
  if v_ccount >= v_cmax then
    select sent_at into v_cnth
      from public.twitch_bot_sends
      where bot_id = p_bot_id and channel_id = p_channel_id and sent_at > v_now - interval '30 seconds'
      order by sent_at desc
      offset v_cmax - 1 limit 1;
    v_channel_wait := greatest(v_channel_wait, ceil(extract(epoch from (v_cnth + interval '30 seconds' - v_now)) * 1000)::integer);
  end if;

  select count(*) into v_count
    from public.twitch_bot_sends
    where bot_id = p_bot_id and sent_at > v_now - interval '30 seconds';
  if v_count >= v_max then
    -- El mensaje número `v_max` contando desde el más reciente es el que, al salir de la ventana, abre hueco
    select sent_at into v_nth
      from public.twitch_bot_sends
      where bot_id = p_bot_id and sent_at > v_now - interval '30 seconds'
      order by sent_at desc
      offset v_max - 1 limit 1;
    v_account_wait := ceil(extract(epoch from (v_nth + interval '30 seconds' - v_now)) * 1000)::integer;
  end if;

  if v_channel_wait > 0 or v_account_wait > 0 then
    if v_account_wait > v_channel_wait then
      return jsonb_build_object('ok', false, 'waitMs', v_account_wait, 'scope', 'account');
    end if;
    return jsonb_build_object('ok', false, 'waitMs', v_channel_wait, 'scope', 'channel');
  end if;

  insert into public.twitch_bot_sends (bot_id, channel_id, sent_at) values (p_bot_id, p_channel_id, v_now);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.take_twitch_bot_send(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.take_twitch_bot_send(text, text, integer, integer) to service_role;

-- >>>>>>>>>> 0041_twitch_bot_chat_lines.sql >>>>>>>>>>
-- =============================================================================
-- 0041_twitch_bot_chat_lines.sql
--
-- Búfer rodante de las últimas líneas del chat de cada streamer, para el bot de
-- Twitch en la nube. El script de Python las guardaba en la memoria del proceso
-- (lux_lines y spont_lines) para dos cosas: resumir el chat en recuerdos de Mi AI
-- (aprender del chat) y hacer un comentario espontáneo. En Vercel cada aviso puede
-- caer en una instancia distinta y nada vive en memoria, así que se guardan aquí:
--
--   twitch_bot_chat_lines: una fila por línea. Solo texto del espectador (hasta 300
--                     caracteres) y su nombre de usuario; el servidor no guarda los
--                     comandos (los que empiezan por el prefijo o por «!»). Las líneas
--                     de cuentas de bots conocidos (LUX_IGNORE del script) se guardan con
--                     spont = false: solo entran en el resumen, como en el script.
--   spont_used:       el comentario espontáneo ya contó esa línea (la ventana empieza
--                     de cero tras cada comentario, como spont_lines.clear()).
--   push_twitch_bot_chat_line: inserta la línea y, en la misma llamada, deja como mucho
--                     p_max filas por streamer (las más nuevas) y borra todo lo que
--                     tenga más de 24 horas. Así la tabla nunca crece sin tope y no
--                     hace falta ninguna tarea programada.
--
-- Privacidad: el servidor borra las líneas en cuanto las resume (solo las ya leídas; las que
-- llegan mientras tanto se quedan), al desconectar el bot, al apagarlo y al apagar el
-- aprendizaje y los comentarios. El tope de 24 horas es la red de seguridad, y
-- purge_twitch_bot_data (al final) la aplica a todos los streamers a la vez; hay que
-- programarla con pg_cron (ver supabase/BOT-NUBE.md). Si se borra un perfil, sus líneas se borran con él.
--
-- RLS sin políticas: solo el servidor con la clave de servicio toca la tabla, y solo la
-- clave de servicio ejecuta la función (mismo patrón que 0039 y 0040).
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0039. Se puede volver a ejecutar.
-- =============================================================================

create table if not exists public.twitch_bot_chat_lines (
  id          bigint generated always as identity primary key,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  viewer      text not null check (char_length(viewer) between 1 and 40),
  line        text not null check (char_length(line) between 1 and 300),
  spont       boolean not null default true,
  spont_used  boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists twitch_bot_chat_lines_profile_idx on public.twitch_bot_chat_lines (profile_id, id desc);

alter table public.twitch_bot_chat_lines enable row level security;

create or replace function public.push_twitch_bot_chat_line(
  p_profile_id  uuid,
  p_viewer      text,
  p_line        text,
  p_spont       boolean default true,
  p_max         integer default 200
) returns void
language plpgsql
set search_path = public
as $$
declare
  v_max    integer := least(greatest(coalesce(p_max, 200), 1), 500);
  v_cutoff bigint;
begin
  insert into public.twitch_bot_chat_lines (profile_id, viewer, line, spont)
    values (p_profile_id, left(p_viewer, 40), left(p_line, 300), coalesce(p_spont, true));

  -- Tope por streamer: se queda con las `v_max` más nuevas
  select id into v_cutoff
    from public.twitch_bot_chat_lines
    where profile_id = p_profile_id
    order by id desc
    offset v_max - 1 limit 1;
  if v_cutoff is not null then
    delete from public.twitch_bot_chat_lines where profile_id = p_profile_id and id < v_cutoff;
  end if;

  -- Nada se guarda más de un día
  delete from public.twitch_bot_chat_lines
    where profile_id = p_profile_id and created_at < now() - interval '24 hours';
end;
$$;

revoke all on function public.push_twitch_bot_chat_line(uuid, text, text, boolean, integer) from public, anon, authenticated;
grant execute on function public.push_twitch_bot_chat_line(uuid, text, text, boolean, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Purga de lo caducado (todas las tablas del bot)
-- ---------------------------------------------------------------------------
--
-- Quita los cooldowns y candados ya vencidos (twitch_bot_cooldowns), los envíos de más de
-- 60 s (twitch_bot_sends; el limitador solo mira los últimos 30 s) y las líneas del chat de
-- más de 24 horas (twitch_bot_chat_lines). Devuelve cuántas filas quitó de cada tabla. Se
-- puede ejecutar a menudo sin riesgo. Programarla con pg_cron: ver supabase/BOT-NUBE.md.

create or replace function public.purge_twitch_bot_data()
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_cooldowns integer;
  v_sends     integer;
  v_lines     integer;
begin
  delete from public.twitch_bot_cooldowns where available_at < now() - interval '1 minute';
  get diagnostics v_cooldowns = row_count;

  delete from public.twitch_bot_sends where sent_at < clock_timestamp() - interval '60 seconds';
  get diagnostics v_sends = row_count;

  delete from public.twitch_bot_chat_lines where created_at < now() - interval '24 hours';
  get diagnostics v_lines = row_count;

  return jsonb_build_object('cooldowns', v_cooldowns, 'sends', v_sends, 'lines', v_lines);
end;
$$;

revoke all on function public.purge_twitch_bot_data() from public, anon, authenticated;
grant execute on function public.purge_twitch_bot_data() to service_role;

-- >>>>>>>>>> 0042_twitch_bot_sender_streamer.sql >>>>>>>>>>
-- =============================================================================
-- 0042_twitch_bot_sender_streamer.sql
--
-- Modo de envío «streamer» del bot de chat en la nube: el bot escribe con la propia
-- cuenta de cada streamer en vez de la cuenta global Lalo.
--
-- La columna sender_mode (0039) ya admite 'global' y 'streamer' en su check, así que no
-- hace falta tocar el constraint. Esta migración solo cambia el valor POR DEFECTO de las
-- filas NUEVAS a 'streamer'. Las filas que ya existen no se tocan: nadie cambia de cuenta
-- de envío sin pedirlo. (El servidor ya manda sender_mode al crear una fila, así que la
-- aplicación funciona igual sin esta migración; solo deja la base coherente.)
--
-- El limitador de envíos (0040) ya cuenta por sender_id (bot_id): en modo streamer cada
-- streamer tiene su propio cupo. No hay cambios allí.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0039. Se puede volver a ejecutar.
-- =============================================================================

alter table public.twitch_bot_settings
  alter column sender_mode set default 'streamer';

-- >>>>>>>>>> 0043_lux_languages.sql >>>>>>>>>>
-- =============================================================================
-- 0043_lux_languages.sql
--
-- Idiomas de Mi AI. Amplía la 0024 (lux_settings.language, que solo admitía
-- es, en y pt) con francés (fr), italiano (it) y «auto»: Lux contesta en el
-- idioma de quien escribe, así un mismo canal puede hablar varios idiomas.
-- La validación real está en server/lux/settings.ts (LUX_LANGUAGES); esta
-- restricción es la última red.
--
-- Los canales que ya tenían es, en o pt no cambian.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0042.
-- Se puede volver a ejecutar.
-- =============================================================================

alter table public.lux_settings drop constraint if exists lux_settings_language_check;
alter table public.lux_settings add constraint lux_settings_language_check
  check (language in ('auto', 'es', 'en', 'fr', 'pt', 'it'));

-- >>>>>>>>>> 0044_lux_viewer_turns.sql >>>>>>>>>>
-- =============================================================================
-- 0044_lux_viewer_turns.sql
--
-- Hilo por espectador. Hasta ahora Lux recibía solo el mensaje nuevo, sin los
-- turnos anteriores, así que un «¿y por qué?» no tenía contexto. Esta migración:
--
--   1. Crea public.lux_viewer_turns: los últimos mensajes y respuestas de cada
--      espectador. Son efímeros: el servidor conserva como máximo 6 turnos por
--      espectador y descarta los de más de 10 minutos (LUX_THREAD_TURNS y
--      LUX_THREAD_TTL_MS en server/lux/thread.ts).
--   2. Activa RLS sin ninguna política, igual que lux_memories tras la 0030: solo
--      el servidor (clave de servicio) lee y escribe. El navegador no ve el hilo.
--   3. Añade lux_settings.thread_enabled: el interruptor «Recordar la
--      conversación». Activado por defecto.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0043.
-- Se puede volver a ejecutar.
-- =============================================================================

create table if not exists public.lux_viewer_turns (
  id          bigint generated always as identity primary key,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  viewer      text not null,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null check (char_length(content) <= 1000),
  created_at  timestamptz not null default now()
);

create index if not exists lux_viewer_turns_thread_idx
  on public.lux_viewer_turns (profile_id, viewer, created_at desc);

alter table public.lux_viewer_turns enable row level security;

-- Sin políticas: ni lectura ni escritura desde el navegador. Solo la clave de servicio.
drop policy if exists "lux_viewer_turns_read" on public.lux_viewer_turns;
drop policy if exists "lux_viewer_turns_write" on public.lux_viewer_turns;

alter table public.lux_settings
  add column if not exists thread_enabled boolean not null default true;

-- >>>>>>>>>> 0045_lux_banter.sql >>>>>>>>>>
-- =============================================================================
-- 0045_lux_banter.sql
--
-- Modo pique. lux_settings.banter decide cómo responde Lux cuando alguien lo
-- provoca (intención «insulto»):
--
--   off    Responder con calma (el comportamiento de siempre). Por defecto.
--   pique  Picar al estilo League of Legends: burla de jugador con humor, sin
--          líneas rojas (origen, género, orientación, físico, salud, familia,
--          palabrotas fuertes, amenazas). Es opt-in del streamer.
--
-- La validación real está en server/lux/settings.ts (LUX_BANTER_MODES) y el filtro
-- de seguridad en server/lux/outputFilter.ts; esta restricción es la última red.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0044.
-- Se puede volver a ejecutar.
-- =============================================================================

alter table public.lux_settings
  add column if not exists banter text not null default 'off';

alter table public.lux_settings drop constraint if exists lux_settings_banter_check;
alter table public.lux_settings add constraint lux_settings_banter_check
  check (banter in ('off', 'pique'));

-- >>>>>>>>>> 0046_paypal_billing.sql >>>>>>>>>>
-- =============================================================================
-- 0046_paypal_billing.sql
--
-- Cobro de planes con suscripciones recurrentes de PayPal.
--
--   billing_prices         precio por plan y periodo (1, 3, 6 o 12 meses) y el id del
--                          Billing Plan creado en PayPal. Cambiar un precio ya sincronizado
--                          archiva la fila y crea otra (PayPal no permite editar el precio).
--   billing_subscriptions  una fila por suscripción del streamer. Solo la escribe el servidor.
--   billing_events         ids de los avisos (webhooks) ya procesados: idempotencia.
--   profiles.plan_expires_at  hasta cuándo vale el plan de pago. Null = plan sin caducidad
--                          (el de siempre: invitación o asignado por el administrador).
--   billing_expire_due()   devuelve al plan por defecto a quien venció sin renovar.
--
-- El plan SOLO se activa por un pago confirmado (webhook PAYMENT.SALE.COMPLETED),
-- nunca por lo que diga el navegador.
--
-- Cómo programar billing_expire_due() (elige una; ver supabase/BOT-NUBE.md, sección PayPal):
--   a) Vercel Cron: vercel.json ya llama a /api/paypal/expire una vez al día.
--   b) Supabase Cron (pg_cron), si la extensión está activa:
--        select cron.schedule('billing-expire-due', '5 4 * * *', $$select public.billing_expire_due()$$);
--   Además el servidor la llama al leer el estado (acción status), así que un streamer
--   nunca ve acceso caducado aunque el cron falle.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0045.
-- Se puede volver a ejecutar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tablas
-- -----------------------------------------------------------------------------

create table if not exists public.billing_prices (
  id             uuid primary key default gen_random_uuid(),
  plan_id        text not null references public.plans (id) on delete cascade,
  months         int  not null check (months in (1, 3, 6, 12)),
  price_usd      numeric(10, 2) not null check (price_usd > 0),
  active         boolean not null default true,
  paypal_plan_id text,
  archived       boolean not null default false,
  created_at     timestamptz not null default now()
);

-- Un solo precio vigente por plan y periodo; las filas archivadas quedan de historial.
create unique index if not exists billing_prices_plan_months_live
  on public.billing_prices (plan_id, months) where not archived;

create table if not exists public.billing_subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  profile_id             uuid not null references public.profiles (id) on delete cascade,
  plan_id                text not null references public.plans (id),
  months                 int  not null check (months in (1, 3, 6, 12)),
  price_usd              numeric not null,
  paypal_subscription_id text not null unique,
  status                 text not null default 'pending'
                         check (status in ('pending', 'active', 'grace', 'cancelled', 'suspended', 'expired')),
  started_at             timestamptz not null default now(),
  paid_until             timestamptz,
  last_payment_at        timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists billing_subscriptions_profile
  on public.billing_subscriptions (profile_id, created_at desc);

create table if not exists public.billing_events (
  paypal_event_id  text primary key,
  type             text not null,
  subscription_id  text,
  payload          jsonb not null default '{}'::jsonb,
  processed_at     timestamptz not null default now()
);

alter table public.profiles add column if not exists plan_expires_at timestamptz;

-- -----------------------------------------------------------------------------
-- 2. RLS: lectura limitada; escrituras solo con la clave de servicio (que ignora RLS)
-- -----------------------------------------------------------------------------

alter table public.billing_prices        enable row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.billing_events        enable row level security;

revoke all on public.billing_prices, public.billing_subscriptions, public.billing_events from anon;
revoke insert, update, delete on public.billing_prices, public.billing_subscriptions from authenticated;
revoke all on public.billing_events from authenticated;

-- Cualquier usuario con sesión ve los precios vigentes (activos, no archivados).
drop policy if exists billing_prices_select on public.billing_prices;
create policy billing_prices_select on public.billing_prices
  for select to authenticated
  using (active and not archived);

-- El streamer solo ve sus propias suscripciones.
drop policy if exists billing_subscriptions_select on public.billing_subscriptions;
create policy billing_subscriptions_select on public.billing_subscriptions
  for select to authenticated
  using (profile_id = (select auth.uid()));

-- billing_events: sin políticas, solo el servidor.

-- -----------------------------------------------------------------------------
-- 3. Vencimientos
-- -----------------------------------------------------------------------------

-- Devuelve al plan por defecto a los perfiles cuyo plan de pago venció, y marca como
-- 'expired' las suscripciones cuyo periodo pagado terminó. Solo toca perfiles con
-- plan_expires_at: un plan asignado a mano (sin fecha) no se toca nunca.
-- Devuelve cuántos perfiles volvieron al plan por defecto.
create or replace function public.billing_expire_due()
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_default text;
  v_count   int := 0;
begin
  select pl.id into v_default from public.plans pl where pl.is_default limit 1;

  update public.billing_subscriptions s
     set status = 'expired', updated_at = now()
   where s.status in ('active', 'grace', 'cancelled', 'suspended')
     and s.paid_until is not null
     and s.paid_until <= now();

  if v_default is not null then
    update public.profiles p
       set plan_id = v_default, plan_expires_at = null
     where p.plan_expires_at is not null
       and p.plan_expires_at <= now();
    get diagnostics v_count = row_count;
  end if;

  return v_count;
end;
$$;

-- Solo el servidor (clave de servicio) y el cron la ejecutan.
revoke all on function public.billing_expire_due() from public, anon, authenticated;
grant execute on function public.billing_expire_due() to service_role;

-- >>>>>>>>>> 0047_open_access_and_code_duration.sql >>>>>>>>>>
-- =============================================================================
-- 0047_open_access_and_code_duration.sql
--
-- Acceso sin invitación (interruptor) y códigos con duración.
--
--   1. app_settings 'invites_required' ('true' por defecto = como hasta ahora).
--        invites_required()               lectura pública (anon y authenticated) del booleano.
--        admin_set_invites_required(bool) lo cambia el administrador (queda en la bitácora).
--        handle_new_user()                con el interruptor en 'false', un usuario NUEVO con
--                                         identidad de Twitch nace 'active' con el plan por defecto.
--        claim_open_access()              lo mismo para quien YA tenía un perfil 'pending'
--                                         (creado cuando las invitaciones eran obligatorias).
--      Se sigue exigiendo Twitch: el alta por correo (el administrador) sigue 'pending' y
--      promote_admin_by_email lo activa, como en 0003.
--
--   2. invite_codes.plan_months (null, o de 1 a 36): duración del plan que da el código.
--        redeem_invite() ya no exige que el perfil esté 'pending': también lo puede canjear
--        un perfil 'active' (cuando las invitaciones están desactivadas, todos lo son) para
--        MEJORAR su plan. Si el código trae plan_months, profiles.plan_expires_at queda en
--        (la mayor entre hoy y el plan_expires_at vigente de ESE mismo plan) + plan_months meses
--        de calendario con fin de mes. billing_expire_due() (0046) ya devuelve al plan por
--        defecto cuando plan_expires_at vence: no hace falta tocarla.
--        Resultados nuevos de redeem_invite: 'has_paid_plan', 'has_plan', 'already_redeemed'.
--
--   3. check_invite() devuelve también plan_months; admin_create_invite() acepta p_plan_months.
--
-- Se cambian las firmas de check_invite (tipo de retorno) y admin_create_invite (parámetro
-- nuevo): se eliminan las versiones anteriores y se vuelven a conceder los permisos.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0046. Se puede volver a ejecutar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Interruptor de invitaciones
-- -----------------------------------------------------------------------------

insert into public.app_settings (key, value)
values ('invites_required', 'true')
on conflict (key) do nothing;

-- Lectura pública: solo el booleano, nada más de app_settings. Ante un valor ausente o
-- raro se asume 'true' (lo seguro: pedir invitación).
create or replace function public.invites_required()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select s.value from public.app_settings s where s.key = 'invites_required'), 'true') <> 'false';
$$;

create or replace function public.admin_set_invites_required(p_required boolean)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_old boolean;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  if p_required is null then
    raise exception 'invalid_value';
  end if;

  v_old := public.invites_required();

  insert into public.app_settings (key, value, updated_at)
  values ('invites_required', case when p_required then 'true' else 'false' end, now())
  on conflict (key)
  do update set value = excluded.value, updated_at = excluded.updated_at;

  if v_old is distinct from p_required then
    perform public.log_admin_action(
      null,
      'invites_required',
      case when p_required
        then 'Se volvió a exigir invitación para entrar'
        else 'Se abrió la entrada sin invitación (con Twitch)'
      end
    );
  end if;

  return p_required;
end;
$$;

-- Perfil al registrarse. Igual que en 0003; lo único nuevo es el estado inicial del camino
-- de Twitch: 'active' con el plan por defecto si las invitaciones no son obligatorias Y hay
-- un id de Twitch válido. Sin id de Twitch (o con el alta por correo) sigue 'pending'.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_meta      jsonb   := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_provider  text    := coalesce(new.raw_app_meta_data ->> 'provider', '');
  v_twitch_id text    := coalesce(v_meta ->> 'provider_id', v_meta ->> 'sub');
  v_by_email  boolean;
  v_status    text    := 'pending';
  v_plan      text    := null;
begin
  v_by_email := v_provider = 'email'
                or (v_provider = '' and (v_twitch_id is null or v_twitch_id = new.id::text));

  if v_by_email then
    insert into public.profiles (id, display_name, media_folder)
    values (new.id, nullif(split_part(coalesce(new.email, ''), '@', 1), ''), new.id::text)
    on conflict (id) do nothing;
    return new;
  end if;

  if v_twitch_id = new.id::text then
    v_twitch_id := null;
  end if;

  if v_twitch_id is not null
     and exists (select 1 from public.profiles p where p.twitch_user_id = v_twitch_id) then
    v_twitch_id := null;
  end if;

  -- Entrada abierta: solo con identidad de Twitch y si hay plan por defecto.
  if v_twitch_id is not null and not public.invites_required() then
    select pl.id into v_plan from public.plans pl where pl.is_default limit 1;
    if v_plan is not null then
      v_status := 'active';
    end if;
  end if;

  insert into public.profiles (id, twitch_user_id, twitch_login, display_name, avatar_url, media_folder, status, plan_id)
  values (
    new.id,
    v_twitch_id,
    coalesce(v_meta ->> 'name', v_meta ->> 'full_name'),
    coalesce(v_meta ->> 'nickname', v_meta ->> 'slug', v_meta ->> 'name'),
    coalesce(v_meta ->> 'avatar_url', v_meta ->> 'picture'),
    new.id::text,
    v_status,
    case when v_status = 'active' then v_plan else null end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Para quien ya tenía un perfil 'pending' cuando se abrió la entrada (o si el disparador no
-- llegó a activarlo). Devuelve: ok | invites_required | not_pending | no_twitch.
create or replace function public.claim_open_access()
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_status text;
  v_twitch text;
  v_plan   text;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if public.invites_required() then
    return 'invites_required';
  end if;

  select p.status, p.twitch_user_id into v_status, v_twitch
  from public.profiles p where p.id = v_uid for update;
  if v_status is distinct from 'pending' then
    return 'not_pending';
  end if;
  if v_twitch is null then
    return 'no_twitch';
  end if;

  select pl.id into v_plan from public.plans pl where pl.is_default limit 1;
  if v_plan is null then
    return 'invites_required';
  end if;

  update public.profiles set status = 'active', plan_id = v_plan where id = v_uid;
  return 'ok';
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Duración del plan por código
-- -----------------------------------------------------------------------------

alter table public.invite_codes add column if not exists plan_months int;

alter table public.invite_codes drop constraint if exists invite_codes_plan_months_check;
alter table public.invite_codes add constraint invite_codes_plan_months_check
  check (plan_months is null or plan_months between 1 and 36);

-- Canjea un código. Devuelve 'ok' o el motivo:
--   not_found | revoked | expired | used_up   el código no sirve
--   not_pending      el perfil está suspendido (o no es 'pending'/'active')
--   no_twitch        la cuenta no entró con Twitch
--   has_paid_plan    tiene una suscripción de PayPal con acceso vigente: no se pisa el plan pagado
--   has_plan         tiene un plan fijo (sin vencimiento) distinto del plan por defecto: no se degrada
--   already_redeemed ya canjeó este mismo código
-- Un rechazo NO gasta el código.
create or replace function public.redeem_invite(p_code text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_status  text;
  v_twitch  text;
  v_plan    text;
  v_exp     timestamptz;
  v_default text;
  v_code    public.invite_codes%rowtype;
  v_base    timestamptz;
  v_new_exp timestamptz;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select p.status, p.twitch_user_id, p.plan_id, p.plan_expires_at
    into v_status, v_twitch, v_plan, v_exp
  from public.profiles p where p.id = v_uid for update;
  if v_status is null or v_status not in ('pending', 'active') then
    return 'not_pending';
  end if;
  if v_twitch is null then
    return 'no_twitch';
  end if;

  -- El bloqueo de fila hace atómico el incremento de used_count.
  select * into v_code from public.invite_codes c
  where c.code = upper(trim(p_code)) for update;

  if not found then
    return 'not_found';
  elsif v_code.revoked_at is not null then
    return 'revoked';
  elsif v_code.expires_at is not null and v_code.expires_at <= now() then
    return 'expired';
  elsif v_code.used_count >= v_code.max_uses then
    return 'used_up';
  end if;

  -- Convivencia con el cobro: el plan pagado manda.
  if exists (
    select 1 from public.billing_subscriptions s
    where s.profile_id = v_uid
      and s.status in ('active', 'grace')
      and s.paid_until is not null
      and s.paid_until > now()
  ) then
    return 'has_paid_plan';
  end if;

  if exists (
    select 1 from public.invite_redemptions r
    where r.invite_code_id = v_code.id and r.profile_id = v_uid
  ) then
    return 'already_redeemed';
  end if;

  -- Un perfil activo con plan fijo (asignado por el administrador o por un código sin
  -- duración) no se degrada ni se convierte en temporal. Los pendientes no tienen plan.
  if v_status = 'active' then
    select pl.id into v_default from public.plans pl where pl.is_default limit 1;
    if v_plan is not null and v_exp is null and v_plan is distinct from v_default then
      return 'has_plan';
    end if;
  end if;

  if v_code.plan_months is not null then
    -- Suma desde hoy, o desde el vencimiento vigente si es del MISMO plan. El interval de
    -- meses de Postgres respeta el fin de mes (31 ene + 1 mes = 28/29 feb).
    v_base := greatest(
      now(),
      case when v_plan is not distinct from v_code.plan_id and v_exp is not null then v_exp else now() end
    );
    v_new_exp := ((v_base at time zone 'UTC') + make_interval(months => v_code.plan_months)) at time zone 'UTC';
  else
    v_new_exp := null;
  end if;

  update public.invite_codes set used_count = used_count + 1 where id = v_code.id;

  insert into public.invite_redemptions (invite_code_id, profile_id)
  values (v_code.id, v_uid)
  on conflict do nothing;

  update public.profiles
     set status          = 'active',
         plan_id         = v_code.plan_id,
         invite_code_id  = v_code.id,
         plan_expires_at = v_new_exp
   where id = v_uid;

  return 'ok';
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. check_invite y admin_create_invite con plan_months
-- -----------------------------------------------------------------------------

drop function if exists public.check_invite(text);

create or replace function public.check_invite(p_code text)
returns table (status text, plan_name text, plan_months int)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_code public.invite_codes%rowtype;
begin
  select * into v_code from public.invite_codes c where c.code = upper(trim(p_code));

  if not found then
    return query select 'not_found'::text, null::text, null::int;
  elsif v_code.revoked_at is not null then
    return query select 'revoked'::text, null::text, null::int;
  elsif v_code.expires_at is not null and v_code.expires_at <= now() then
    return query select 'expired'::text, null::text, null::int;
  elsif v_code.used_count >= v_code.max_uses then
    return query select 'used_up'::text, null::text, null::int;
  else
    return query select 'valid'::text,
                        (select pl.name from public.plans pl where pl.id = v_code.plan_id),
                        v_code.plan_months;
  end if;
end;
$$;

drop function if exists public.admin_create_invite(text, int, timestamptz, text);

create or replace function public.admin_create_invite(
  p_plan        text default null,
  p_max_uses    int default 1,
  p_expires_at  timestamptz default null,
  p_note        text default null,
  p_plan_months int default null
)
returns public.invite_codes
language plpgsql security definer set search_path = ''
as $$
declare
  v_plan text := p_plan;
  v_row  public.invite_codes;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  if p_plan_months is not null and p_plan_months not between 1 and 36 then
    raise exception 'invalid_plan_months';
  end if;
  if v_plan is null then
    select pl.id into v_plan from public.plans pl where pl.is_default limit 1;
  end if;
  if v_plan is null or not exists (select 1 from public.plans pl where pl.id = v_plan) then
    raise exception 'plan_not_found';
  end if;

  insert into public.invite_codes (code, plan_id, max_uses, expires_at, note, created_by, plan_months)
  values (
    'LALO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
    v_plan, greatest(coalesce(p_max_uses, 1), 1), p_expires_at, p_note, (select auth.uid()), p_plan_months
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Permisos de ejecución (mismo patrón que 0001 y 0019)
-- -----------------------------------------------------------------------------

revoke execute on function
  public.invites_required(),
  public.admin_set_invites_required(boolean),
  public.claim_open_access(),
  public.redeem_invite(text),
  public.check_invite(text),
  public.admin_create_invite(text, int, timestamptz, text, int)
from public, anon, authenticated;

-- El flujo de entrada necesita leer el interruptor y validar un código sin sesión.
grant execute on function
  public.invites_required(),
  public.check_invite(text)
to anon, authenticated;

grant execute on function
  public.admin_set_invites_required(boolean),
  public.claim_open_access(),
  public.redeem_invite(text),
  public.admin_create_invite(text, int, timestamptz, text, int)
to authenticated;

-- >>>>>>>>>> 0048_plan_management.sql >>>>>>>>>>
-- =============================================================================
-- 0048_plan_management.sql
--
-- El administrador crea y archiva planes.
--
--   plans.archived                 bool, por defecto false. Un plan archivado no sale en el
--                                  catálogo de pago ni en el selector de códigos nuevos; quienes
--                                  ya lo tienen lo conservan. NO se ofrece borrar planes.
--   admin_create_plan(...)         crea un plan que NO es el predeterminado (auditado).
--   admin_archive_plan(id, bool)   archiva o desarchiva (auditado). El plan por defecto no se archiva.
--   admin_create_invite(...)       ahora rechaza un plan archivado ('plan_archived').
--
-- Los planes nuevos aparecen solos en admin-prices (server/paypal) para ponerles precio.
-- La edición de límites sigue siendo plans_admin_write (RLS de 0001) vía updatePlan.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0047. Se puede volver a ejecutar.
-- =============================================================================

alter table public.plans add column if not exists archived boolean not null default false;

-- Evita que el plan por defecto quede archivado aunque se cambie el predeterminado a mano.
create or replace function public.plans_default_not_archived()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.is_default and new.archived then
    raise exception 'cannot_archive_default';
  end if;
  return new;
end;
$$;

drop trigger if exists plans_default_not_archived on public.plans;
create trigger plans_default_not_archived
  before insert or update on public.plans
  for each row execute procedure public.plans_default_not_archived();

create or replace function public.admin_create_plan(
  p_id                  text,
  p_name                text,
  p_storage_limit_bytes bigint,
  p_max_file_bytes      bigint,
  p_max_files           int,
  p_lux_monthly_credits int default 0,
  p_lux_max_models      int default null
)
returns public.plans
language plpgsql security definer set search_path = ''
as $$
declare
  v_id   text := lower(trim(coalesce(p_id, '')));
  v_name text := trim(coalesce(p_name, ''));
  v_row  public.plans;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  if v_id !~ '^[a-z0-9][a-z0-9-]{0,39}$' then
    raise exception 'invalid_plan_id';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    raise exception 'invalid_plan_name';
  end if;
  if p_storage_limit_bytes is null or p_storage_limit_bytes < 0
     or p_max_file_bytes is null or p_max_file_bytes < 0
     or p_max_files is null or p_max_files < 0
     or coalesce(p_lux_monthly_credits, 0) < 0
     or (p_lux_max_models is not null and p_lux_max_models < 0) then
    raise exception 'invalid_plan_limits';
  end if;
  if exists (select 1 from public.plans pl where pl.id = v_id) then
    raise exception 'plan_exists';
  end if;

  insert into public.plans
    (id, name, storage_limit_bytes, max_file_bytes, max_files, is_default, archived, lux_monthly_credits, lux_max_models)
  values
    (v_id, v_name, p_storage_limit_bytes, p_max_file_bytes, p_max_files, false, false,
     coalesce(p_lux_monthly_credits, 0), p_lux_max_models)
  returning * into v_row;

  perform public.log_admin_action(null, 'plan_create', 'Se creó el plan ' || v_name || ' (' || v_id || ')');
  return v_row;
end;
$$;

create or replace function public.admin_archive_plan(p_id text, p_archived boolean)
returns public.plans
language plpgsql security definer set search_path = ''
as $$
declare
  v_old public.plans;
  v_row public.plans;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  if p_archived is null then
    raise exception 'invalid_value';
  end if;

  select * into v_old from public.plans pl where pl.id = p_id for update;
  if not found then
    raise exception 'plan_not_found';
  end if;
  if p_archived and v_old.is_default then
    raise exception 'cannot_archive_default';
  end if;

  update public.plans set archived = p_archived where id = p_id returning * into v_row;

  if v_old.archived is distinct from p_archived then
    perform public.log_admin_action(
      null,
      'plan_archive',
      case when p_archived then 'Se archivó el plan ' else 'Se reactivó el plan ' end || v_row.name
    );
  end if;
  return v_row;
end;
$$;

-- Igual que en 0047, con una comprobación más: no se crean códigos de un plan archivado.
create or replace function public.admin_create_invite(
  p_plan        text default null,
  p_max_uses    int default 1,
  p_expires_at  timestamptz default null,
  p_note        text default null,
  p_plan_months int default null
)
returns public.invite_codes
language plpgsql security definer set search_path = ''
as $$
declare
  v_plan text := p_plan;
  v_row  public.invite_codes;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  if p_plan_months is not null and p_plan_months not between 1 and 36 then
    raise exception 'invalid_plan_months';
  end if;
  if v_plan is null then
    select pl.id into v_plan from public.plans pl where pl.is_default limit 1;
  end if;
  if v_plan is null or not exists (select 1 from public.plans pl where pl.id = v_plan) then
    raise exception 'plan_not_found';
  end if;
  if exists (select 1 from public.plans pl where pl.id = v_plan and pl.archived) then
    raise exception 'plan_archived';
  end if;

  insert into public.invite_codes (code, plan_id, max_uses, expires_at, note, created_by, plan_months)
  values (
    'LALO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
    v_plan, greatest(coalesce(p_max_uses, 1), 1), p_expires_at, p_note, (select auth.uid()), p_plan_months
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function
  public.admin_create_plan(text, text, bigint, bigint, int, int, int),
  public.admin_archive_plan(text, boolean),
  public.admin_create_invite(text, int, timestamptz, text, int)
from public, anon, authenticated;

grant execute on function
  public.admin_create_plan(text, text, bigint, bigint, int, int, int),
  public.admin_archive_plan(text, boolean),
  public.admin_create_invite(text, int, timestamptz, text, int)
to authenticated;

-- >>>>>>>>>> 0049_recovery_open_access.sql >>>>>>>>>>
-- =============================================================================
-- 0049_recovery_open_access.sql
--
-- Recuperación de cuenta con la entrada abierta (0047).
--
-- redeem_recovery_code (0001) exige que quien canjea esté 'pending'. Con las invitaciones
-- desactivadas, un perfil nuevo pasa a 'active' en cuanto vuelve de Twitch (claim_open_access),
-- así que el código de recuperación fallaba con 'not_pending'.
--
-- Cambio: además de 'pending', se admite un perfil 'active' que sea realmente nuevo:
--   - streamer (no admin), sin código de invitación canjeado (invite_code_id nulo),
--   - sin terminar la bienvenida (onboarded_at nulo),
--   - en el plan por defecto y sin vencimiento,
--   - sin archivos subidos y sin ninguna suscripción de pago,
--   - y solo mientras la entrada está abierta (invites_required() = false).
-- Un perfil con uso real sigue recibiendo 'not_pending'. Se mantienen todas las demás
-- garantías: el código es de un solo uso, caduca, no vale para la misma cuenta, el perfil
-- antiguo queda suspendido y el rol no se transfiere.
--
-- Además el perfil nuevo hereda plan_expires_at del antiguo (antes no existía): sin eso, un
-- plan temporal por código pasaría a ser permanente al recuperar la cuenta.
--
-- NO se mueven las suscripciones de PayPal (billing_subscriptions) del perfil antiguo: quien
-- recupera una cuenta con suscripción de pago debe avisar al administrador. Pendiente aparte.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0048. Se puede volver a ejecutar.
-- =============================================================================

create or replace function public.redeem_recovery_code(p_code text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_me     public.profiles%rowtype;
  v_rec    public.recovery_codes%rowtype;
  v_old    public.profiles%rowtype;
  v_fresh  boolean;
  v_tmp    text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_rec from public.recovery_codes r
  where r.code_hash = encode(sha256(convert_to(upper(trim(p_code)), 'UTF8')), 'hex')
  for update;

  if not found then
    return 'not_found';
  elsif v_rec.used_at is not null then
    return 'used';
  elsif v_rec.expires_at <= now() then
    return 'expired';
  elsif v_rec.profile_id = v_uid then
    return 'same_profile';
  end if;

  select * into v_me from public.profiles p where p.id = v_uid for update;
  if not found then
    return 'not_pending';
  end if;

  if v_me.status = 'pending' then
    v_fresh := true;
  else
    v_fresh :=
      v_me.status = 'active'
      and v_me.role = 'streamer'
      and not public.invites_required()
      and v_me.invite_code_id is null
      and v_me.onboarded_at is null
      and v_me.plan_expires_at is null
      and v_me.plan_id is not distinct from (select pl.id from public.plans pl where pl.is_default limit 1)
      and not exists (select 1 from public.media_files m where m.profile_id = v_uid)
      and not exists (select 1 from public.billing_subscriptions s where s.profile_id = v_uid);
  end if;
  if not v_fresh then
    return 'not_pending';
  end if;

  select * into v_old from public.profiles p where p.id = v_rec.profile_id for update;

  -- El perfil nuevo no debería tener datos; se limpia por si acaso.
  delete from public.configs where profile_id = v_uid;
  delete from public.media_files where profile_id = v_uid;

  update public.configs set profile_id = v_uid where profile_id = v_old.id;
  update public.media_files set profile_id = v_uid where profile_id = v_old.id;

  -- Libera los valores unique del perfil antiguo antes de dárselos al nuevo.
  update public.profiles
     set widget_key   = v_tmp,
         media_folder = 'retired-' || v_old.id::text,
         status       = 'suspended'
   where id = v_old.id;

  update public.profiles
     set widget_key      = v_old.widget_key,
         media_folder    = v_old.media_folder,
         plan_id         = v_old.plan_id,
         plan_expires_at = v_old.plan_expires_at,
         invite_code_id  = v_old.invite_code_id,
         status          = 'active'
   where id = v_uid;

  update public.recovery_codes set used_at = now() where id = v_rec.id;

  return 'ok';
end;
$$;

revoke execute on function public.redeem_recovery_code(text) from public, anon, authenticated;
grant execute on function public.redeem_recovery_code(text) to authenticated;

-- >>>>>>>>>> 0050_billing_hardening.sql >>>>>>>>>>
-- =============================================================================
-- 0050_billing_hardening.sql
--
-- Endurecimiento del cobro con PayPal tras la revisión de seguridad.
--
--   1. billing_events: status ('processing' | 'done') y claimed_at. El servidor reserva el aviso como
--      'processing', lo aplica y lo marca 'done'. Un 'processing' de más de 5 min se retoma (corte a mitad).
--      Las filas anteriores a esta migración quedan 'done' (antes solo existían las reservadas y aplicadas).
--   2. billing_subscriptions.last_event_time: último evento de PayPal aplicado; los más viejos no cambian el estado.
--   3. billing_sales: una fila por venta (PAYMENT.SALE.COMPLETED), clave sale_id. Evita acreditar dos veces el mismo
--      pago aunque llegue con otro event.id, y permite restar el periodo si hay reembolso o reverso.
--   4. billing_apply_payment(): acredita una venta (venta + paid_until + perfil) en UNA transacción.
--   5. billing_reverse_sale(): reembolso (total o parcial) y reverso/contracargo de una venta.
--   6. redeem_invite (0047): has_paid_plan cubre también cancelled y suspended con periodo pagado vigente.
--   7. redeem_recovery_code (0049): mueve las suscripciones de PayPal del perfil antiguo al nuevo.
--   8. handle_new_user (0047): solo el proveedor exactamente 'twitch' cuenta como Twitch.
--
-- Las funciones de cobro (4 y 5) son security definer con search_path = '' y SOLO las ejecuta service_role.
-- Las tablas nuevas tienen RLS activada y ninguna política: solo la clave de servicio las toca.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0049. Se puede volver a ejecutar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Idempotencia de avisos
-- -----------------------------------------------------------------------------

alter table public.billing_events add column if not exists status text not null default 'done';
alter table public.billing_events add column if not exists claimed_at timestamptz not null default now();

alter table public.billing_events drop constraint if exists billing_events_status_check;
alter table public.billing_events add constraint billing_events_status_check
  check (status in ('processing', 'done'));

-- -----------------------------------------------------------------------------
-- 2. Orden de eventos
-- -----------------------------------------------------------------------------

alter table public.billing_subscriptions add column if not exists last_event_time timestamptz;

-- -----------------------------------------------------------------------------
-- 3. Ventas
-- -----------------------------------------------------------------------------

create table if not exists public.billing_sales (
  sale_id          text primary key,
  subscription_id  uuid not null references public.billing_subscriptions (id) on delete cascade,
  months_credited  int  not null check (months_credited > 0),
  amount           numeric,
  currency         text,
  refunded_amount  numeric not null default 0,
  reversed_at      timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists billing_sales_subscription on public.billing_sales (subscription_id);

alter table public.billing_sales enable row level security;
revoke all on public.billing_sales from anon, authenticated;
-- Sin políticas: solo el servidor (clave de servicio, que ignora RLS).

-- -----------------------------------------------------------------------------
-- 4. Acreditar una venta (atómico)
-- -----------------------------------------------------------------------------

-- Devuelve: applied | duplicate (la venta ya estaba) | unknown_subscription.
-- Réplica de paidUntilAfterPayment / statusAfterPayment de server/paypal/logic.ts:
--   - suma el periodo de la suscripción desde paid_until si es futuro, o desde ahora;
--   - estado 'active' (una 'cancelled' sigue cancelada; un pago más viejo que el último evento no reabre una
--     suscripción que no sea 'pending');
--   - el perfil recibe el plan y el vencimiento.
create or replace function public.billing_apply_payment(
  p_sale_id                 text,
  p_paypal_subscription_id  text,
  p_amount                  numeric default null,
  p_currency                text default null,
  p_event_time              timestamptz default null
)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_sub    public.billing_subscriptions%rowtype;
  v_base   timestamptz;
  v_new    timestamptz;
  v_rows   int;
  v_status text;
  v_stale  boolean;
begin
  if p_sale_id is null or length(trim(p_sale_id)) = 0 or length(p_sale_id) > 100 then
    raise exception 'invalid_sale';
  end if;

  select * into v_sub from public.billing_subscriptions s
  where s.paypal_subscription_id = p_paypal_subscription_id
  for update;
  if not found then
    return 'unknown_subscription';
  end if;

  insert into public.billing_sales (sale_id, subscription_id, months_credited, amount, currency)
  values (p_sale_id, v_sub.id, v_sub.months, p_amount, p_currency)
  on conflict (sale_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return 'duplicate';
  end if;

  v_base := greatest(now(), coalesce(v_sub.paid_until, now()));
  v_new  := ((v_base at time zone 'UTC') + make_interval(months => v_sub.months)) at time zone 'UTC';

  v_stale := p_event_time is not null and v_sub.last_event_time is not null and p_event_time < v_sub.last_event_time;
  v_status := case
    when v_sub.status = 'cancelled' then 'cancelled'
    when v_sub.status <> 'pending' and v_stale then v_sub.status
    else 'active'
  end;

  update public.billing_subscriptions
     set paid_until      = v_new,
         last_payment_at = now(),
         status          = v_status,
         last_event_time = case
                             when p_event_time is null then last_event_time
                             else greatest(coalesce(last_event_time, p_event_time), p_event_time)
                           end,
         updated_at      = now()
   where id = v_sub.id;

  update public.profiles
     set plan_id = v_sub.plan_id, plan_expires_at = v_new
   where id = v_sub.profile_id;

  return 'applied';
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Reembolso o reverso de una venta
-- -----------------------------------------------------------------------------

-- Devuelve: applied | partial (reembolso parcial: solo se registra) | duplicate (ya se había quitado ese periodo)
--           | unknown_sale (la venta no está registrada: el servidor responde 503 y PayPal reintenta).
-- Reembolso total (lo reembolsado acumulado alcanza el importe) o reverso/contracargo:
--   resta months_credited de paid_until, nunca por debajo de ahora, y actualiza profiles.plan_expires_at si el perfil
--   tenía justo ese vencimiento. En un reverso la suscripción pasa a 'suspended' (salvo cancelled/expired, o si el
--   evento es más viejo que el último aplicado). Si ya no queda acceso, billing_expire_due() devuelve el perfil al plan
--   por defecto.
-- Un reembolso sin importe conocido no se toma por total.
create or replace function public.billing_reverse_sale(
  p_sale_id     text,
  p_amount      numeric default null,
  p_reversal    boolean default false,
  p_event_time  timestamptz default null
)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_sale     public.billing_sales%rowtype;
  v_sub      public.billing_subscriptions%rowtype;
  v_refunded numeric;
  v_full     boolean;
  v_old      timestamptz;
  v_new      timestamptz;
  v_status   text;
  v_stale    boolean;
begin
  select * into v_sale from public.billing_sales x where x.sale_id = p_sale_id for update;
  if not found then
    return 'unknown_sale';
  end if;

  select * into v_sub from public.billing_subscriptions s where s.id = v_sale.subscription_id for update;
  if not found then
    return 'unknown_sale';
  end if;

  v_refunded := v_sale.refunded_amount;
  if not coalesce(p_reversal, false) then
    v_refunded := v_refunded + coalesce(p_amount, 0);
    update public.billing_sales set refunded_amount = v_refunded where sale_id = v_sale.sale_id;
  end if;

  v_full := coalesce(p_reversal, false)
            or (v_sale.amount is not null and v_sale.amount > 0 and v_refunded >= v_sale.amount);
  if not v_full then
    return 'partial';
  end if;
  if v_sale.reversed_at is not null then
    return 'duplicate';
  end if;

  v_old := v_sub.paid_until;
  if v_old is null then
    v_new := now();
  else
    v_new := greatest(now(), ((v_old at time zone 'UTC') - make_interval(months => v_sale.months_credited)) at time zone 'UTC');
  end if;

  update public.billing_sales set reversed_at = now() where sale_id = v_sale.sale_id;

  v_stale := p_event_time is not null and v_sub.last_event_time is not null and p_event_time < v_sub.last_event_time;
  v_status := v_sub.status;
  if coalesce(p_reversal, false) and not v_stale and v_sub.status not in ('cancelled', 'expired') then
    v_status := 'suspended';
  end if;

  update public.billing_subscriptions
     set paid_until      = v_new,
         status          = v_status,
         last_event_time = case
                             when coalesce(p_reversal, false) and not v_stale and p_event_time is not null
                               then greatest(coalesce(last_event_time, p_event_time), p_event_time)
                             else last_event_time
                           end,
         updated_at      = now()
   where id = v_sub.id;

  if v_old is not null then
    update public.profiles
       set plan_expires_at = v_new
     where id = v_sub.profile_id
       and plan_expires_at is not distinct from v_old;
  end if;

  if v_new <= now() then
    perform public.billing_expire_due();
  end if;

  return 'applied';
end;
$$;

-- Solo el servidor (clave de servicio).
revoke all on function public.billing_apply_payment(text, text, numeric, text, timestamptz) from public, anon, authenticated;
revoke all on function public.billing_reverse_sale(text, numeric, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.billing_apply_payment(text, text, numeric, text, timestamptz) to service_role;
grant execute on function public.billing_reverse_sale(text, numeric, boolean, timestamptz) to service_role;

-- -----------------------------------------------------------------------------
-- 6. redeem_invite: el plan pagado manda también si la suscripción está cancelada o suspendida
--    pero el periodo ya pagado sigue vigente. Resto idéntico a 0047.
-- -----------------------------------------------------------------------------

create or replace function public.redeem_invite(p_code text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_status  text;
  v_twitch  text;
  v_plan    text;
  v_exp     timestamptz;
  v_default text;
  v_code    public.invite_codes%rowtype;
  v_base    timestamptz;
  v_new_exp timestamptz;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select p.status, p.twitch_user_id, p.plan_id, p.plan_expires_at
    into v_status, v_twitch, v_plan, v_exp
  from public.profiles p where p.id = v_uid for update;
  if v_status is null or v_status not in ('pending', 'active') then
    return 'not_pending';
  end if;
  if v_twitch is null then
    return 'no_twitch';
  end if;

  -- El bloqueo de fila hace atómico el incremento de used_count.
  select * into v_code from public.invite_codes c
  where c.code = upper(trim(p_code)) for update;

  if not found then
    return 'not_found';
  elsif v_code.revoked_at is not null then
    return 'revoked';
  elsif v_code.expires_at is not null and v_code.expires_at <= now() then
    return 'expired';
  elsif v_code.used_count >= v_code.max_uses then
    return 'used_up';
  end if;

  -- Convivencia con el cobro: el plan pagado manda (alineado con paysNow de server/paypal/logic.ts).
  if exists (
    select 1 from public.billing_subscriptions s
    where s.profile_id = v_uid
      and s.status in ('active', 'grace', 'cancelled', 'suspended')
      and s.paid_until is not null
      and s.paid_until > now()
  ) then
    return 'has_paid_plan';
  end if;

  if exists (
    select 1 from public.invite_redemptions r
    where r.invite_code_id = v_code.id and r.profile_id = v_uid
  ) then
    return 'already_redeemed';
  end if;

  if v_status = 'active' then
    select pl.id into v_default from public.plans pl where pl.is_default limit 1;
    if v_plan is not null and v_exp is null and v_plan is distinct from v_default then
      return 'has_plan';
    end if;
  end if;

  if v_code.plan_months is not null then
    v_base := greatest(
      now(),
      case when v_plan is not distinct from v_code.plan_id and v_exp is not null then v_exp else now() end
    );
    v_new_exp := ((v_base at time zone 'UTC') + make_interval(months => v_code.plan_months)) at time zone 'UTC';
  else
    v_new_exp := null;
  end if;

  update public.invite_codes set used_count = used_count + 1 where id = v_code.id;

  insert into public.invite_redemptions (invite_code_id, profile_id)
  values (v_code.id, v_uid)
  on conflict do nothing;

  update public.profiles
     set status          = 'active',
         plan_id         = v_code.plan_id,
         invite_code_id  = v_code.id,
         plan_expires_at = v_new_exp
   where id = v_uid;

  return 'ok';
end;
$$;

revoke execute on function public.redeem_invite(text) from public, anon, authenticated;
grant execute on function public.redeem_invite(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. redeem_recovery_code: las suscripciones de PayPal siguen a la cuenta recuperada
--    Resto idéntico a 0049 (código de un solo uso, caduca, misma cuenta, perfil antiguo suspendido,
--    rol sin transferir, plan_expires_at heredado).
-- -----------------------------------------------------------------------------

create or replace function public.redeem_recovery_code(p_code text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_me     public.profiles%rowtype;
  v_rec    public.recovery_codes%rowtype;
  v_old    public.profiles%rowtype;
  v_fresh  boolean;
  v_tmp    text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_rec from public.recovery_codes r
  where r.code_hash = encode(sha256(convert_to(upper(trim(p_code)), 'UTF8')), 'hex')
  for update;

  if not found then
    return 'not_found';
  elsif v_rec.used_at is not null then
    return 'used';
  elsif v_rec.expires_at <= now() then
    return 'expired';
  elsif v_rec.profile_id = v_uid then
    return 'same_profile';
  end if;

  select * into v_me from public.profiles p where p.id = v_uid for update;
  if not found then
    return 'not_pending';
  end if;

  if v_me.status = 'pending' then
    v_fresh := true;
  else
    v_fresh :=
      v_me.status = 'active'
      and v_me.role = 'streamer'
      and not public.invites_required()
      and v_me.invite_code_id is null
      and v_me.onboarded_at is null
      and v_me.plan_expires_at is null
      and v_me.plan_id is not distinct from (select pl.id from public.plans pl where pl.is_default limit 1)
      and not exists (select 1 from public.media_files m where m.profile_id = v_uid)
      and not exists (select 1 from public.billing_subscriptions s where s.profile_id = v_uid);
  end if;
  if not v_fresh then
    return 'not_pending';
  end if;

  select * into v_old from public.profiles p where p.id = v_rec.profile_id for update;

  -- El perfil nuevo no debería tener datos; se limpia por si acaso.
  delete from public.configs where profile_id = v_uid;
  delete from public.media_files where profile_id = v_uid;

  update public.configs set profile_id = v_uid where profile_id = v_old.id;
  update public.media_files set profile_id = v_uid where profile_id = v_old.id;

  -- Las suscripciones de PayPal (y con ellas sus ventas, que cuelgan de la suscripción) pasan a la cuenta nueva:
  -- los avisos de PayPal leen billing_subscriptions.profile_id para dar el plan al perfil correcto.
  update public.billing_subscriptions set profile_id = v_uid, updated_at = now() where profile_id = v_old.id;

  -- Libera los valores unique del perfil antiguo antes de dárselos al nuevo.
  update public.profiles
     set widget_key   = v_tmp,
         media_folder = 'retired-' || v_old.id::text,
         status       = 'suspended'
   where id = v_old.id;

  update public.profiles
     set widget_key      = v_old.widget_key,
         media_folder    = v_old.media_folder,
         plan_id         = v_old.plan_id,
         plan_expires_at = v_old.plan_expires_at,
         invite_code_id  = v_old.invite_code_id,
         status          = 'active'
   where id = v_uid;

  update public.recovery_codes set used_at = now() where id = v_rec.id;

  return 'ok';
end;
$$;

revoke execute on function public.redeem_recovery_code(text) from public, anon, authenticated;
grant execute on function public.redeem_recovery_code(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. handle_new_user: solo el proveedor exactamente 'twitch' cuenta como Twitch
--    Igual que 0047; cambia que otros proveedores (google, etc.) ya no guardan su 'sub' como id de Twitch
--    ni nacen 'active' por la entrada abierta.
-- -----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_meta      jsonb   := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_provider  text    := coalesce(new.raw_app_meta_data ->> 'provider', '');
  v_twitch_id text    := coalesce(v_meta ->> 'provider_id', v_meta ->> 'sub');
  v_by_email  boolean;
  v_status    text    := 'pending';
  v_plan      text    := null;
begin
  v_by_email := v_provider = 'email'
                or (v_provider = '' and (v_twitch_id is null or v_twitch_id = new.id::text));

  if v_by_email then
    insert into public.profiles (id, display_name, media_folder)
    values (new.id, nullif(split_part(coalesce(new.email, ''), '@', 1), ''), new.id::text)
    on conflict (id) do nothing;
    return new;
  end if;

  -- Solo Twitch aporta un id de Twitch: el 'sub' de otro proveedor no lo es.
  if v_provider <> 'twitch' then
    v_twitch_id := null;
  end if;

  if v_twitch_id = new.id::text then
    v_twitch_id := null;
  end if;

  if v_twitch_id is not null
     and exists (select 1 from public.profiles p where p.twitch_user_id = v_twitch_id) then
    v_twitch_id := null;
  end if;

  -- Entrada abierta: solo con identidad de Twitch y si hay plan por defecto.
  if v_twitch_id is not null and not public.invites_required() then
    select pl.id into v_plan from public.plans pl where pl.is_default limit 1;
    if v_plan is not null then
      v_status := 'active';
    end if;
  end if;

  insert into public.profiles (id, twitch_user_id, twitch_login, display_name, avatar_url, media_folder, status, plan_id)
  values (
    new.id,
    v_twitch_id,
    coalesce(v_meta ->> 'name', v_meta ->> 'full_name'),
    coalesce(v_meta ->> 'nickname', v_meta ->> 'slug', v_meta ->> 'name'),
    coalesce(v_meta ->> 'avatar_url', v_meta ->> 'picture'),
    new.id::text,
    v_status,
    case when v_status = 'active' then v_plan else null end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- >>>>>>>>>> 0051_qg_fixes.sql >>>>>>>>>>
-- =============================================================================
-- 0051_qg_fixes.sql
--
-- Correcciones de la revisión de calidad (quality gate) del cobro con PayPal.
--
--   1. Una sola suscripción «viva» por perfil: índice único parcial en billing_subscriptions (profile_id) donde
--      status in ('pending', 'active', 'grace', 'suspended'). Cierra la carrera de dos «subscribe» a la vez.
--      ANTES de crearlo se limpian los duplicados que ya existan (ver el caso documentado abajo).
--   2. billing_refunds: un reembolso por refund_id. billing_reverse_sale() suma lo reembolsado SOLO si el refund_id es
--      nuevo, así que el mismo reembolso parcial reenviado (otro event.id) no se acumula hasta parecer total.
--      El reembolso total exige además moneda USD en la venta. La firma cambia (p_refund_id): se retira la anterior.
--   3. billing_code_access(): accesos por código del panel de administración, con NOT EXISTS (quien paga queda fuera)
--      ANTES de limitar. Antes se limitaba y luego se filtraba: 200 suscriptores de pago tapaban todo lo demás.
--   4. Backfill de billing_sales para los pagos anteriores a 0050 (sale_id 'legacy-<id de la suscripción>').
--
-- Las funciones billing_* son security definer con search_path = '' y SOLO las ejecuta service_role.
-- billing_refunds tiene RLS activada y ninguna política: solo la clave de servicio la toca.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0050. Se puede volver a ejecutar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Una suscripción viva por perfil
-- -----------------------------------------------------------------------------

-- Caso documentado: si un perfil ya tiene varias suscripciones vivas, se conserva UNA y las demás pending
-- pasan a 'cancelled'. Se conserva primero la que no es pending y, entre iguales, la más reciente.
-- Las pending canceladas aquí pueden seguir existiendo en PayPal sin aprobar; un pago que aún llegara por una
-- cancelled se acredita igual (el webhook no depende de ese estado).
with live as (
  select s.id,
         s.status,
         row_number() over (
           partition by s.profile_id
           order by (s.status = 'pending') asc, s.created_at desc, s.id desc
         ) as rn
  from public.billing_subscriptions s
  where s.status in ('pending', 'active', 'grace', 'suspended')
)
update public.billing_subscriptions b
   set status = 'cancelled', updated_at = now()
  from live l
 where b.id = l.id
   and l.rn > 1
   and l.status = 'pending';

-- Si aún quedan dos vivas que NO son pending (p. ej. dos activas), no se decide a ciegas: se detiene la migración
-- para que una persona revise y cancele una de las dos (en PayPal y aquí) antes de volver a ejecutarla.
do $$
begin
  if exists (
    select 1
    from public.billing_subscriptions s
    where s.status in ('pending', 'active', 'grace', 'suspended')
    group by s.profile_id
    having count(*) > 1
  ) then
    raise exception '0051: hay perfiles con más de una suscripción viva que no son pending; revisa y cancela una antes de aplicar esta migración';
  end if;
end;
$$;

create unique index if not exists billing_subscriptions_one_live
  on public.billing_subscriptions (profile_id)
  where status in ('pending', 'active', 'grace', 'suspended');

-- -----------------------------------------------------------------------------
-- 2. Reembolsos idempotentes
-- -----------------------------------------------------------------------------

create table if not exists public.billing_refunds (
  refund_id   text primary key,
  sale_id     text not null references public.billing_sales (sale_id) on delete cascade,
  amount      numeric not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists billing_refunds_sale on public.billing_refunds (sale_id);

alter table public.billing_refunds enable row level security;
revoke all on public.billing_refunds from anon, authenticated;
-- Sin políticas: solo el servidor (clave de servicio, que ignora RLS).

-- La firma de 0050 (4 argumentos) se retira: si quedara, un servidor viejo podría seguir acumulando sin refund_id.
drop function if exists public.billing_reverse_sale(text, numeric, boolean, timestamptz);

-- Devuelve: applied | partial (reembolso parcial: solo se registra) | duplicate (ya se había quitado ese periodo)
--           | unknown_sale (la venta no está registrada: el servidor decide si reintentar o descartar).
-- p_refund_id: resource.id del REFUNDED. En un reverso/contracargo el servidor manda el id de la venta (no suma).
-- Reembolso total (lo reembolsado acumulado alcanza el importe Y la venta es en USD) o reverso/contracargo:
--   resta months_credited de paid_until, nunca por debajo de ahora, y actualiza profiles.plan_expires_at si el perfil
--   tenía justo ese vencimiento. En un reverso la suscripción pasa a 'suspended' (salvo cancelled/expired, o si el
--   evento es más viejo que el último aplicado: entonces ni se suspende ni se mueve last_event_time).
-- Un reembolso sin importe conocido o en otra moneda no se toma por total.
create or replace function public.billing_reverse_sale(
  p_sale_id     text,
  p_refund_id   text,
  p_amount      numeric default null,
  p_reversal    boolean default false,
  p_event_time  timestamptz default null
)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_sale     public.billing_sales%rowtype;
  v_sub      public.billing_subscriptions%rowtype;
  v_refunded numeric;
  v_full     boolean;
  v_old      timestamptz;
  v_new      timestamptz;
  v_status   text;
  v_stale    boolean;
  v_rows     int;
begin
  if p_refund_id is null or length(trim(p_refund_id)) = 0 or length(p_refund_id) > 100 then
    raise exception 'invalid_refund';
  end if;

  select * into v_sale from public.billing_sales x where x.sale_id = p_sale_id for update;
  if not found then
    return 'unknown_sale';
  end if;

  select * into v_sub from public.billing_subscriptions s where s.id = v_sale.subscription_id for update;
  if not found then
    return 'unknown_sale';
  end if;

  v_refunded := v_sale.refunded_amount;
  if not coalesce(p_reversal, false) then
    -- Solo un refund_id nuevo suma: el mismo reembolso reenviado con otro event.id no se acumula
    insert into public.billing_refunds (refund_id, sale_id, amount)
    values (p_refund_id, v_sale.sale_id, greatest(coalesce(p_amount, 0), 0))
    on conflict (refund_id) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then
      v_refunded := v_refunded + greatest(coalesce(p_amount, 0), 0);
      update public.billing_sales set refunded_amount = v_refunded where sale_id = v_sale.sale_id;
    end if;
  end if;

  v_full := coalesce(p_reversal, false)
            or (upper(coalesce(v_sale.currency, '')) = 'USD'
                and v_sale.amount is not null and v_sale.amount > 0 and v_refunded >= v_sale.amount);
  if not v_full then
    return 'partial';
  end if;
  if v_sale.reversed_at is not null then
    return 'duplicate';
  end if;

  v_old := v_sub.paid_until;
  if v_old is null then
    v_new := now();
  else
    v_new := greatest(now(), ((v_old at time zone 'UTC') - make_interval(months => v_sale.months_credited)) at time zone 'UTC');
  end if;

  update public.billing_sales set reversed_at = now() where sale_id = v_sale.sale_id;

  v_stale := p_event_time is not null and v_sub.last_event_time is not null and p_event_time < v_sub.last_event_time;
  v_status := v_sub.status;
  if coalesce(p_reversal, false) and not v_stale and v_sub.status not in ('cancelled', 'expired') then
    v_status := 'suspended';
  end if;

  update public.billing_subscriptions
     set paid_until      = v_new,
         status          = v_status,
         last_event_time = case
                             when coalesce(p_reversal, false) and not v_stale and p_event_time is not null
                               then greatest(coalesce(last_event_time, p_event_time), p_event_time)
                             else last_event_time
                           end,
         updated_at      = now()
   where id = v_sub.id;

  if v_old is not null then
    update public.profiles
       set plan_expires_at = v_new
     where id = v_sub.profile_id
       and plan_expires_at is not distinct from v_old;
  end if;

  if v_new <= now() then
    perform public.billing_expire_due();
  end if;

  return 'applied';
end;
$$;

revoke all on function public.billing_reverse_sale(text, text, numeric, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.billing_reverse_sale(text, text, numeric, boolean, timestamptz) to service_role;

-- -----------------------------------------------------------------------------
-- 3. Accesos por código (panel de administración)
-- -----------------------------------------------------------------------------

-- Perfiles con plan por código vigente: plan_expires_at futuro y sin suscripción de pago con acceso
-- (alineado con isCodeAccess de server/paypal/logic.ts). La exclusión va en la consulta, antes del tope.
create or replace function public.billing_code_access(
  p_now    timestamptz,
  p_limit  int default 200
)
returns table (
  profile_id       uuid,
  twitch_login     text,
  display_name     text,
  plan_id          text,
  plan_name        text,
  plan_expires_at  timestamptz,
  invite_code      text
)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.twitch_login, p.display_name, p.plan_id, pl.name, p.plan_expires_at, ic.code
  from public.profiles p
  left join public.plans pl on pl.id = p.plan_id
  left join public.invite_codes ic on ic.id = p.invite_code_id
  where p.plan_expires_at > p_now
    and not exists (
      select 1 from public.billing_subscriptions s
      where s.profile_id = p.id
        and s.status in ('active', 'grace', 'cancelled', 'suspended')
        and s.paid_until > p_now
    )
  order by p.plan_expires_at asc, p.id asc
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
$$;

revoke all on function public.billing_code_access(timestamptz, int) from public, anon, authenticated;
grant execute on function public.billing_code_access(timestamptz, int) to service_role;

-- -----------------------------------------------------------------------------
-- 4. Backfill de ventas anteriores a 0050
-- -----------------------------------------------------------------------------

-- Los pagos acreditados antes de 0050 no tienen fila en billing_sales. Se crea una venta sintética por suscripción
-- con pago (months_credited = months) para que un reverso localizado por la suscripción pueda restar un periodo.
-- Ojo: el sale_id real de PayPal de esos pagos no se conoce, así que un aviso con el id real seguirá sin
-- encontrarse; el servidor lo da por hecho pasadas 72 h en vez de reintentar para siempre. Importe y moneda quedan
-- sin conocer (null): un reembolso nunca se toma por total sobre estas filas.
insert into public.billing_sales (sale_id, subscription_id, months_credited)
select 'legacy-' || s.id::text, s.id, s.months
from public.billing_subscriptions s
where s.last_payment_at is not null
  and not exists (select 1 from public.billing_sales x where x.subscription_id = s.id)
on conflict (sale_id) do nothing;

-- >>>>>>>>>> 0052_fundadores.sql >>>>>>>>>>
-- =============================================================================
-- 0052_fundadores.sql
--
-- Creadores fundadores de Tally Studio (antes Lalo Stream Suite) y su bienvenida.
--
--   profiles.founder_number          número de Creador Fundador (1, 2, 3...). Null = no es fundador.
--   profiles.welcome_seen_at         cuándo vio la bienvenida de la app. Null = aún no la ha visto.
--   profiles.founder_gift_claimed_at cuándo activó el regalo del plan Creadores Iniciales.
--   founder_settings                 una sola fila: plan y meses del regalo (los edita el administrador).
--   plans 'creadores-iniciales'      el plan del regalo, creado con los límites del plan por defecto.
--
--   mark_welcome_seen()              la llama el propio streamer al cerrar la bienvenida.
--   founder_gift_config()            plan y meses del regalo, para enseñarlos en la bienvenida.
--   claim_founder_gift()             el fundador activa su regalo: plan temporal de N meses.
--   admin_set_founder_gift()         el administrador cambia el plan y los meses del regalo.
--
-- El regalo reutiliza el mecanismo de plan temporal vigente (el mismo que usan los
-- códigos con duración de 0047_open_access_and_code_duration, plan_months de 1 a 36):
-- pone profiles.plan_id y profiles.plan_expires_at (hoy + N meses de calendario,
-- en UTC, como redeem_invite), y billing_expire_due() (0046) devuelve la cuenta al
-- plan por defecto cuando vence. No toca billing_subscriptions ni PayPal, y no pisa
-- un plan de pago vigente (misma regla que redeem_invite de 0050: has_paid_plan).
-- billing_code_access (0051) lista estas cuentas como «plan por código vigente».
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0051.
-- Se puede volver a ejecutar: no renumera fundadores ya numerados.
--
-- Mientras no se aplique, la app sigue funcionando: sin las columnas nadie es
-- fundador, la bienvenida de cuenta nueva se recuerda solo en el navegador y el
-- botón del regalo queda en «Pendiente de activar por el administrador».
--
-- ---- REVISAR ANTES DE APLICAR ------------------------------------------------
--  1. CORTE (v_corte, más abajo): son fundadoras las cuentas de streamer creadas
--     ANTES de esa fecha y que ya no están «pendientes» de código. Ajusta la fecha
--     al día del despliegue. Las cuentas nuevas posteriores no son fundadoras.
--  2. Numeración: por orden de created_at (empates por id). Se hace una sola vez,
--     cuando ningún perfil tiene número todavía.
--  3. El plan 'creadores-iniciales' nace con los MISMOS límites de almacenamiento
--     que el plan por defecto. Si debe tener más, edítalo en Límites. Qué voces o
--     TTS incluye NO lo decide este plan (hoy las voces dependen de la cuenta, p. ej.
--     profiles.elevenlabs_enabled): confirma si el regalo debe activarlo también.
--  4. Quien ya tiene un plan fijo distinto del por defecto, un plan temporal vigente
--     (de un código) o una suscripción de PayPal con acceso vigente, NO recibe el
--     regalo (claim_founder_gift devuelve 'has_plan' y no lo marca
--     como reclamado, así que podrá pedirlo si vuelve al plan por defecto).
--  5. welcome_seen_at queda null en TODAS las cuentas existentes a propósito: es
--     lo que hace que cada fundador vea la bienvenida una vez tras el despliegue.
-- -----------------------------------------------------------------------------
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columnas
-- -----------------------------------------------------------------------------

alter table public.profiles add column if not exists founder_number          int;
alter table public.profiles add column if not exists welcome_seen_at         timestamptz;
alter table public.profiles add column if not exists founder_gift_claimed_at timestamptz;

create unique index if not exists profiles_founder_number_key
  on public.profiles (founder_number) where founder_number is not null;

-- -----------------------------------------------------------------------------
-- 2. Plan y ajuste del regalo
-- -----------------------------------------------------------------------------

-- El plan del regalo: mismos límites que el plan por defecto. No se pisa si ya existe.
insert into public.plans (id, name, storage_limit_bytes, max_file_bytes, max_files, is_default)
select 'creadores-iniciales', 'Creadores Iniciales',
       d.storage_limit_bytes, d.max_file_bytes, d.max_files, false
  from public.plans d
 where d.is_default
on conflict (id) do nothing;

create table if not exists public.founder_settings (
  id          boolean primary key default true check (id),   -- una sola fila
  gift_plan   text not null default 'creadores-iniciales' references public.plans (id),
  gift_months int  not null default 1 check (gift_months between 1 and 36),
  updated_at  timestamptz not null default now()
);

insert into public.founder_settings (id) values (true) on conflict (id) do nothing;

alter table public.founder_settings enable row level security;
revoke all on public.founder_settings from anon;
revoke insert, update, delete on public.founder_settings from authenticated;

-- Cualquier cuenta con sesión lee el ajuste; solo el administrador lo cambia (por RPC).
drop policy if exists founder_settings_select on public.founder_settings;
create policy founder_settings_select on public.founder_settings
  for select to authenticated using (true);

-- -----------------------------------------------------------------------------
-- 3. Marcar a los fundadores actuales (una sola vez)
-- -----------------------------------------------------------------------------

do $$
declare
  -- ================================================================
  -- CORTE PROVISIONAL: 2026-11-30. Es una fecha PROVISIONAL puesta por
  -- el agente, NO una decisión del producto. Las cuentas de streamer creadas
  -- ANTES de esta fecha serán fundadoras. REVISAR Y AJUSTAR al día real del
  -- despliegue antes de aplicar esta migración.
  -- ================================================================
  v_corte timestamptz := timestamptz '2026-11-30 00:00:00+00';
begin
  if not exists (select 1 from public.profiles p where p.founder_number is not null) then
    update public.profiles p
       set founder_number = n.num
      from (
        select id, (row_number() over (order by created_at, id))::int as num
          from public.profiles
         where role = 'streamer'
           and status <> 'pending'
           and created_at < v_corte
      ) n
     where p.id = n.id;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Funciones
-- -----------------------------------------------------------------------------

-- El streamer marca que ya vio la bienvenida. Solo su perfil; no pisa la fecha.
create or replace function public.mark_welcome_seen()
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_at  timestamptz;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  update public.profiles
     set welcome_seen_at = coalesce(welcome_seen_at, now())
   where id = v_uid
  returning welcome_seen_at into v_at;
  return v_at;
end;
$$;

revoke execute on function public.mark_welcome_seen() from public, anon, authenticated;
grant execute on function public.mark_welcome_seen() to authenticated;

-- Plan y meses del regalo, con el nombre del plan, para enseñarlos en la bienvenida.
create or replace function public.founder_gift_config()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_row public.founder_settings%rowtype;
  v_name text;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_row from public.founder_settings where id;
  select name into v_name from public.plans where id = v_row.gift_plan;
  return jsonb_build_object(
    'plan_id', v_row.gift_plan,
    'plan_name', coalesce(v_name, v_row.gift_plan),
    'months', v_row.gift_months
  );
end;
$$;

revoke execute on function public.founder_gift_config() from public, anon, authenticated;
grant execute on function public.founder_gift_config() to authenticated;

-- El fundador activa su regalo. Idempotente y una sola vez por cuenta.
-- Devuelve: 'ok' | 'already_claimed' | 'not_founder' | 'has_plan' | 'not_active'
create or replace function public.claim_founder_gift()
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_p       public.profiles%rowtype;
  v_set     public.founder_settings%rowtype;
  v_default text;
  v_months  int;
  v_new_exp timestamptz;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_p from public.profiles where id = v_uid for update;
  if not found or v_p.status <> 'active' then
    return 'not_active';
  end if;
  if v_p.founder_number is null then
    return 'not_founder';
  end if;
  if v_p.founder_gift_claimed_at is not null then
    return 'already_claimed';
  end if;

  select pl.id into v_default from public.plans pl where pl.is_default limit 1;

  -- Convivencia con el cobro: el plan pagado manda (misma condición que redeem_invite, 0050).
  if exists (
    select 1 from public.billing_subscriptions s
    where s.profile_id = v_uid
      and s.status in ('active', 'grace', 'cancelled', 'suspended')
      and s.paid_until is not null
      and s.paid_until > now()
  ) then
    return 'has_plan';
  end if;

  -- Tampoco se pisa un plan temporal vigente (de un código) ni un plan fijo distinto del por defecto.
  if (v_p.plan_expires_at is not null and v_p.plan_expires_at > now())
     or (v_p.plan_id is not null and v_p.plan_id is distinct from v_default) then
    return 'has_plan';
  end if;

  select * into v_set from public.founder_settings where id;
  v_months := v_set.gift_months;

  -- Vencimiento: hoy + N meses de calendario en UTC (fin de mes respetado), como redeem_invite.
  -- billing_expire_due() devuelve a la cuenta al plan por defecto cuando llegue esa fecha.
  v_new_exp := ((now() at time zone 'UTC') + make_interval(months => v_months)) at time zone 'UTC';

  update public.profiles
     set plan_id = v_set.gift_plan,
         plan_expires_at = v_new_exp,
         founder_gift_claimed_at = now()
   where id = v_uid;

  return 'ok';
end;
$$;

revoke execute on function public.claim_founder_gift() from public, anon, authenticated;
grant execute on function public.claim_founder_gift() to authenticated;

-- El administrador cambia el plan y los meses del regalo.
create or replace function public.admin_set_founder_gift(p_plan text, p_months int)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  if p_months is null or p_months < 1 or p_months > 36 then
    raise exception 'invalid_months';
  end if;
  if not exists (select 1 from public.plans where id = p_plan) then
    raise exception 'unknown_plan';
  end if;
  if exists (select 1 from public.plans where id = p_plan and archived) then
    raise exception 'plan_archived';
  end if;
  update public.founder_settings
     set gift_plan = p_plan, gift_months = p_months, updated_at = now()
   where id;
  perform public.log_admin_action(
    null,
    'founder_gift',
    'Regalo de fundador: plan ' || p_plan || ' durante ' || p_months || ' meses'
  );
  return jsonb_build_object('plan_id', p_plan, 'months', p_months);
end;
$$;

revoke execute on function public.admin_set_founder_gift(text, int) from public, anon, authenticated;
grant execute on function public.admin_set_founder_gift(text, int) to authenticated;

-- >>>>>>>>>> 0053_billing_inbox.sql >>>>>>>>>>
-- =============================================================================
-- 0053 · Bandeja de pagos y facturación (rediseño Tally Studio)
--
--   1. billing_inbox_resolutions: ítems de la bandeja de pagos que un administrador marcó como
--      resueltos (item_key, resolved_by, resolved_at, note). RLS activada y SIN políticas: solo la
--      clave de servicio (el servidor) la toca, igual que billing_sales y billing_refunds.
--   2. billing_inbox_resolve(): marca un ítem como resuelto y deja bitácora en admin_audit_log.
--      NO usa log_admin_action porque esa función toma el actor de auth.uid(), que es null cuando
--      llama el servidor con la clave de servicio; aquí el actor llega como parámetro.
--      Solo la ejecuta service_role.
--   3. Índices para las consultas nuevas: historial por fecha, resumen mensual, reembolsos y
--      reversos recientes, avisos por suscripción y tipo, avisos reclamados sin terminar.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0052.
-- Se puede volver a ejecutar.
-- =============================================================================

create table if not exists public.billing_inbox_resolutions (
  item_key     text primary key check (char_length(item_key) between 1 and 160),
  resolved_by  uuid references public.profiles (id) on delete set null,
  resolved_at  timestamptz not null default now(),
  note         text not null default '' check (char_length(note) <= 240)
);

alter table public.billing_inbox_resolutions enable row level security;
revoke all on public.billing_inbox_resolutions from anon, authenticated;
-- Sin políticas: solo el servidor (clave de servicio, que ignora RLS).

create or replace function public.billing_inbox_resolve(
  p_item_key text,
  p_actor    uuid,
  p_note     text
)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_key text := left(coalesce(trim(p_item_key), ''), 160);
begin
  if v_key = '' then
    raise exception 'invalid_item_key';
  end if;

  insert into public.billing_inbox_resolutions (item_key, resolved_by, note)
  values (v_key, p_actor, left(coalesce(trim(p_note), ''), 240))
  on conflict (item_key) do nothing;

  -- Ya estaba resuelto: no se duplica ni la fila ni la bitácora
  if not found then
    return 'duplicate';
  end if;

  insert into public.admin_audit_log (actor_id, target_id, action, detail)
  values (p_actor, null, 'billing_inbox_resolve', left('Bandeja de pagos: ítem resuelto ' || v_key, 240));

  return 'resolved';
end;
$$;

revoke execute on function public.billing_inbox_resolve(text, uuid, text) from public, anon, authenticated;
grant execute on function public.billing_inbox_resolve(text, uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- Índices
-- -----------------------------------------------------------------------------

create index if not exists billing_sales_created on public.billing_sales (created_at desc);
create index if not exists billing_sales_reversed on public.billing_sales (reversed_at desc) where reversed_at is not null;
create index if not exists billing_refunds_created on public.billing_refunds (created_at desc);
create index if not exists billing_events_subscription_type on public.billing_events (subscription_id, type, claimed_at desc);
create index if not exists billing_events_claimed on public.billing_events (claimed_at desc);
create index if not exists billing_subscriptions_status_paid_until on public.billing_subscriptions (status, paid_until);

-- >>>>>>>>>> 0054_done_ai.sql >>>>>>>>>>
-- =============================================================================
-- 0054_done_ai.sql
--
-- Done AI convive con Lux en las MISMAS tablas. Esta migración solo AÑADE COLUMNAS e índices: no crea tablas,
-- no toca RLS ni políticas, no borra nada. Ejecutar después de 0001 a 0053. Se puede volver a ejecutar.
--
-- Compartido con Lux tal cual (sin cambios): lux_memories, lux_viewer_turns, lux_replies, lux_usage_monthly,
-- lux_characters, lux_models y la cuota de modelos.
--
-- Separado con un discriminador `agent` ('lux' | 'done'): lux_speech (la cola de frases que lee cada overlay)
-- y lux_outbox (la cola de «decir en el chat»). El código de Lux filtra agent = 'lux'.
--
--   lux_settings.done_settings  jsonb  ajustes de Done del creador (los valida validateDoneSettings en el servidor)
--   profiles.done_enabled       bool   interruptor del administrador por cuenta (por defecto, activado)
--   lux_speech.agent/viewer/kind       quién habla, a quién responde y de qué tipo es (chat, event, spontaneous, say)
--   lux_outbox.agent                   a quién pertenece el mensaje de la cola
--
-- SIN PROBAR contra un proyecto real. APLICAR ANTES de desplegar el código: Lux filtra por lux_speech.agent y
-- lux_outbox.agent, y sin estas columnas esas consultas fallan.
-- =============================================================================

alter table public.lux_settings
  add column if not exists done_settings jsonb not null default '{}'::jsonb;

alter table public.profiles
  add column if not exists done_enabled boolean not null default true;

alter table public.lux_speech
  add column if not exists agent text not null default 'lux' check (agent in ('lux', 'done'));
alter table public.lux_speech
  add column if not exists viewer text;
alter table public.lux_speech
  add column if not exists kind text check (kind is null or kind in ('chat', 'event', 'spontaneous', 'say'));

alter table public.lux_outbox
  add column if not exists agent text not null default 'lux' check (agent in ('lux', 'done'));

create index if not exists lux_speech_agent_idx on public.lux_speech (profile_id, agent, id desc);
create index if not exists lux_outbox_agent_idx on public.lux_outbox (profile_id, agent, status, id);
