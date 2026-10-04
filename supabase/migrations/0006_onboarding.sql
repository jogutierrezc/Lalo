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
