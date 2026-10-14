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
