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
