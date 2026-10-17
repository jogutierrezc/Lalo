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
