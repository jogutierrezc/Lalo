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
