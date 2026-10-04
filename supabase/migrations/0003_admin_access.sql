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
