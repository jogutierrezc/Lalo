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
