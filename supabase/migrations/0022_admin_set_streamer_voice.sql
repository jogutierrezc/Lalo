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
