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
