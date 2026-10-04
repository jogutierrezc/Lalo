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
