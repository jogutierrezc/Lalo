-- =============================================================================
-- 0019_admin_usage_and_audit.sql
--
-- Analítica de uso para el administrador, pulso de conexión de OBS, cuota
-- diaria de ElevenLabs por cuenta y bitácora de auditoría administrativa.
--
--   1. profiles.last_widget_at: cuándo consultó OBS por última vez la llave del
--      streamer (se actualiza como máximo una vez cada 10 minutos para no
--      gastar escrituras en el plan gratuito).
--   2. profiles.elevenlabs_daily_chars: tope diario de caracteres en ElevenLabs
--      por streamer (por defecto 15 000 caracteres/día; 0 = sin tope diario).
--      Cuando un streamer supera su tope diario, el servidor (/api/tts) pasa
--      automáticamente a Fish Audio durante el resto del día sin dejar mudo OBS.
--   3. tts_usage_daily: contador compacto por día, streamer y motor ('fish' o
--      'elevenlabs'). Una fila por streamer activo al día; limpia sola lo de
--      hace más de 90 días.
--   4. admin_audit_log: registro de acciones del administrador (cambios de plan,
--      suspensiones, activación y tope de ElevenLabs, códigos de recuperación).
--   5. admin_usage_report(): resumen completo de adopción de módulos (configs),
--      integraciones conectadas, torneos, pulso de OBS, consumo de TTS y
--      bitácora de auditoría. Comprueba la existencia de tablas opcionales con
--      to_regclass para funcionar aunque falte alguna migración intermedia.
--
-- Ejecutar después de 0001 a 0018. Se puede volver a ejecutar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columnas en profiles: pulso de OBS y tope diario de ElevenLabs
-- -----------------------------------------------------------------------------

alter table public.profiles
  add column if not exists last_widget_at timestamptz,
  add column if not exists elevenlabs_daily_chars integer not null default 15000
    check (elevenlabs_daily_chars >= 0);

-- -----------------------------------------------------------------------------
-- 2. Contadores diarios de síntesis de voz (TTS)
-- -----------------------------------------------------------------------------

create table if not exists public.tts_usage_daily (
  day         date not null default (now() at time zone 'utc')::date,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  provider    text not null check (provider in ('fish', 'elevenlabs')),
  requests    integer not null default 0 check (requests >= 0),
  chars       integer not null default 0 check (chars >= 0),
  updated_at  timestamptz not null default now(),
  primary key (day, profile_id, provider)
);

create index if not exists tts_usage_daily_profile_idx
  on public.tts_usage_daily (profile_id, day desc);

alter table public.tts_usage_daily enable row level security;
revoke all on public.tts_usage_daily from public, anon, authenticated;
grant select on public.tts_usage_daily to authenticated;
grant all on public.tts_usage_daily to service_role;

drop policy if exists tts_usage_daily_select on public.tts_usage_daily;
create policy tts_usage_daily_select on public.tts_usage_daily
  for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_admin()));

-- -----------------------------------------------------------------------------
-- 3. Bitácora de auditoría del administrador
-- -----------------------------------------------------------------------------

create table if not exists public.admin_audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles (id) on delete set null,
  target_id   uuid references public.profiles (id) on delete set null,
  action      text not null check (char_length(action) between 1 and 60),
  detail      text not null check (char_length(detail) between 1 and 240),
  created_at  timestamptz not null default now()
);

create index if not exists admin_audit_log_created_idx
  on public.admin_audit_log (created_at desc);

alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from public, anon, authenticated;
grant select on public.admin_audit_log to authenticated;

drop policy if exists admin_audit_log_admin_select on public.admin_audit_log;
create policy admin_audit_log_admin_select on public.admin_audit_log
  for select to authenticated
  using ((select public.is_admin()));

-- Helper interno para anotar en la bitácora y recortar entradas antiguas (> 250)
create or replace function public.log_admin_action(
  p_target uuid,
  p_action text,
  p_detail text
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.admin_audit_log (actor_id, target_id, action, detail)
  values (
    (select auth.uid()),
    p_target,
    left(coalesce(trim(p_action), 'admin'), 60),
    left(coalesce(trim(p_detail), 'Acción administrativa'), 240)
  );

  delete from public.admin_audit_log
   where id in (
     select a.id
       from public.admin_audit_log a
      order by a.created_at desc, a.id desc
     offset 250
   );
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Pulso de OBS en widget_version y widget_bundle (máx. 1 escritura / 10 min)
-- -----------------------------------------------------------------------------

create or replace function public.widget_version(p_key text)
returns timestamptz
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_last_seen  timestamptz;
  v_updated_at timestamptz;
begin
  if p_key is null or char_length(p_key) < 32 then
    return null;
  end if;

  select p.id, p.last_widget_at
    into v_profile_id, v_last_seen
    from public.profiles p
   where p.widget_key = p_key
     and p.status = 'active';

  if not found then
    return null;
  end if;

  if v_last_seen is null or v_last_seen < now() - interval '10 minutes' then
    update public.profiles
       set last_widget_at = now()
     where id = v_profile_id;
  end if;

  select max(c.updated_at)
    into v_updated_at
    from public.configs c
   where c.profile_id = v_profile_id;

  return v_updated_at;
end;
$$;

create or replace function public.widget_bundle(p_key text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
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

  if v_profile.last_widget_at is null or v_profile.last_widget_at < now() - interval '10 minutes' then
    update public.profiles
       set last_widget_at = now()
     where id = v_profile.id;
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
                'id', m.id, 'path', m.path, 'name', m.name, 'kind', m.kind, 'mime', m.mime,
                'provider', m.provider, 'object_key', m.object_key)
              order by m.created_at)
         from public.media_files m where m.profile_id = v_profile.id),
      '[]'::jsonb)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Control de cuota y registro de uso de TTS (solo clave de servicio)
-- -----------------------------------------------------------------------------

create or replace function public.check_and_record_tts_usage(
  p_profile_id uuid default null,
  p_widget_key text default null,
  p_provider   text default 'fish',
  p_chars      integer default 0
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_profile    public.profiles%rowtype;
  v_today      date := (now() at time zone 'utc')::date;
  v_chars      integer := greatest(coalesce(p_chars, 0), 0);
  v_used_today integer := 0;
  v_limit      integer := 0;
begin
  if p_provider not in ('fish', 'elevenlabs') then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_provider');
  end if;

  if p_profile_id is not null then
    select * into v_profile from public.profiles p where p.id = p_profile_id;
  elsif p_widget_key is not null and char_length(p_widget_key) between 16 and 128 then
    select * into v_profile from public.profiles p where p.widget_key = p_widget_key;
  else
    return jsonb_build_object('allowed', false, 'reason', 'unknown_profile');
  end if;

  if not found or v_profile.status <> 'active' then
    return jsonb_build_object('allowed', false, 'reason', 'unknown_profile');
  end if;

  if p_provider = 'elevenlabs' then
    if v_profile.role <> 'admin' and not coalesce(v_profile.elevenlabs_enabled, false) then
      return jsonb_build_object(
        'allowed', false,
        'reason', 'not_enabled',
        'profile_id', v_profile.id
      );
    end if;

    v_limit := coalesce(v_profile.elevenlabs_daily_chars, 15000);
    select coalesce(u.chars, 0)
      into v_used_today
      from public.tts_usage_daily u
     where u.day = v_today
       and u.profile_id = v_profile.id
       and u.provider = 'elevenlabs';

    if v_profile.role <> 'admin' and v_limit > 0 and (v_used_today + v_chars) > v_limit then
      return jsonb_build_object(
        'allowed', false,
        'reason', 'quota_exceeded',
        'profile_id', v_profile.id,
        'chars_used', v_used_today,
        'chars_limit', v_limit
      );
    end if;
  end if;

  if v_chars > 0 then
    insert into public.tts_usage_daily (day, profile_id, provider, requests, chars, updated_at)
    values (v_today, v_profile.id, p_provider, 1, v_chars, now())
    on conflict (day, profile_id, provider) do update
       set requests   = public.tts_usage_daily.requests + 1,
           chars      = public.tts_usage_daily.chars + excluded.chars,
           updated_at = now()
    returning chars into v_used_today;

    -- Limpieza oportunista de contadores de hace más de 90 días
    delete from public.tts_usage_daily where day < v_today - 90;
  end if;

  return jsonb_build_object(
    'allowed', true,
    'reason', 'ok',
    'profile_id', v_profile.id,
    'chars_used', v_used_today,
    'chars_limit', v_limit
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Funciones administrativas con registro en bitácora
-- -----------------------------------------------------------------------------

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
  v_old  public.profiles;
  v_row  public.profiles;
  v_who  text;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  if p_profile = (select auth.uid()) then
    raise exception 'cannot_modify_self';
  end if;

  select * into v_old from public.profiles p where p.id = p_profile;
  if not found then
    raise exception 'profile_not_found';
  end if;

  update public.profiles
     set status  = coalesce(p_status, status),
         plan_id = coalesce(p_plan, plan_id),
         role    = coalesce(p_role, role)
   where id = p_profile
  returning * into v_row;

  v_who := coalesce(v_row.display_name, v_row.twitch_login, 'Cuenta');
  if p_status is not null and p_status is distinct from v_old.status then
    perform public.log_admin_action(
      p_profile,
      'profile_status',
      case p_status
        when 'suspended' then 'Se suspendió la cuenta de ' || v_who
        when 'active' then 'Se reactivó la cuenta de ' || v_who
        else 'Estado de ' || v_who || ': ' || p_status
      end
    );
  end if;
  if p_plan is not null and p_plan is distinct from v_old.plan_id then
    perform public.log_admin_action(
      p_profile,
      'profile_plan',
      'Se cambió el plan de ' || v_who || ' a ' || p_plan
    );
  end if;

  return v_row;
end;
$$;

create or replace function public.admin_set_elevenlabs(p_profile uuid, p_enabled boolean)
returns public.profiles
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.profiles;
  v_who text;
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

  v_who := coalesce(v_row.display_name, v_row.twitch_login, 'Cuenta');
  perform public.log_admin_action(
    p_profile,
    'elevenlabs_toggle',
    case when v_row.elevenlabs_enabled
      then 'Se activó ElevenLabs para ' || v_who
      else 'Se desactivó ElevenLabs para ' || v_who
    end
  );

  return v_row;
end;
$$;

create or replace function public.admin_set_elevenlabs_limit(p_profile uuid, p_daily_chars integer)
returns public.profiles
language plpgsql security definer set search_path = ''
as $$
declare
  v_row   public.profiles;
  v_who   text;
  v_limit integer := greatest(coalesce(p_daily_chars, 0), 0);
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;

  update public.profiles
     set elevenlabs_daily_chars = v_limit
   where id = p_profile
  returning * into v_row;

  if not found then
    raise exception 'profile_not_found';
  end if;

  v_who := coalesce(v_row.display_name, v_row.twitch_login, 'Cuenta');
  perform public.log_admin_action(
    p_profile,
    'elevenlabs_limit',
    case when v_limit = 0
      then 'Se dejó sin tope diario de ElevenLabs a ' || v_who
      else 'Tope diario de ElevenLabs para ' || v_who || ': ' || v_limit || ' caracteres'
    end
  );

  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Informe completo de uso y adopción para la consola (admin_usage_report)
-- -----------------------------------------------------------------------------

create or replace function public.admin_usage_report()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_today          date := (now() at time zone 'utc')::date;
  v_modules        jsonb := '[]'::jsonb;
  v_profiles       jsonb := '[]'::jsonb;
  v_audit          jsonb := '[]'::jsonb;
  v_integrations   jsonb := '{}'::jsonb;
  v_tournaments    jsonb := '{}'::jsonb;
  v_totals         jsonb;
  v_active_tourns  bigint := 0;
  v_total_entries  bigint := 0;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;

  -- 1. Adopción por módulo en public.configs (solo streamers activos)
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'module', m.module,
        'streamers', m.streamers,
        'last_updated_at', m.last_updated_at
      )
      order by m.streamers desc, m.module asc
    ),
    '[]'::jsonb
  )
    into v_modules
    from (
      select c.module,
             count(distinct c.profile_id) as streamers,
             max(c.updated_at) as last_updated_at
        from public.configs c
        join public.profiles p on p.id = c.profile_id
       where p.status = 'active' and p.role <> 'admin'
       group by c.module
    ) m;

  -- 2. Integraciones por perfil (si la migración 0013 está aplicada)
  if to_regclass('public.integration_accounts') is not null then
    execute $q$
      select coalesce(
        jsonb_object_agg(profile_id::text, providers),
        '{}'::jsonb
      )
      from (
        select ia.profile_id,
               jsonb_agg(ia.provider order by ia.provider) as providers
          from public.integration_accounts ia
         where ia.status = 'connected'
         group by ia.profile_id
      ) s
    $q$ into v_integrations;
  end if;

  -- 3. Torneos por perfil (si la migración 0017 está aplicada)
  if to_regclass('public.tournaments') is not null and to_regclass('public.tournament_entries') is not null then
    execute $q$
      select coalesce(
        jsonb_object_agg(
          t.profile_id::text,
          jsonb_build_object(
            'slug', t.slug,
            'name', t.name,
            'signup_open', t.signup_open,
            'entries_count', coalesce(e.cnt, 0)
          )
        ),
        '{}'::jsonb
      )
      from public.tournaments t
      left join (
        select profile_id, count(*) as cnt
          from public.tournament_entries
         where status <> 'rejected'
         group by profile_id
      ) e on e.profile_id = t.profile_id
    $q$ into v_tournaments;

    execute 'select count(*) from public.tournaments where signup_open = true' into v_active_tourns;
    execute 'select count(*) from public.tournament_entries where status <> ''rejected''' into v_total_entries;
  end if;

  -- 4. Detalle de uso por streamer
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'profile_id', p.id,
        'last_widget_at', p.last_widget_at,
        'configs_updated_at', cfg.last_updated_at,
        'modules', coalesce(cfg.modules, '[]'::jsonb),
        'integrations', coalesce(v_integrations -> (p.id::text), '[]'::jsonb),
        'tournament', v_tournaments -> (p.id::text),
        'elevenlabs_daily_chars', coalesce(p.elevenlabs_daily_chars, 15000),
        'tts_today', jsonb_build_object(
          'fish_requests', coalesce(td.fish_req, 0),
          'fish_chars', coalesce(td.fish_chars, 0),
          'eleven_requests', coalesce(td.eleven_req, 0),
          'eleven_chars', coalesce(td.eleven_chars, 0)
        ),
        'tts_7d', jsonb_build_object(
          'fish_requests', coalesce(w7.fish_req, 0),
          'fish_chars', coalesce(w7.fish_chars, 0),
          'eleven_requests', coalesce(w7.eleven_req, 0),
          'eleven_chars', coalesce(w7.eleven_chars, 0)
        )
      )
      order by p.created_at asc
    ),
    '[]'::jsonb
  )
    into v_profiles
    from public.profiles p
    left join lateral (
      select jsonb_agg(c.module order by c.module) as modules,
             max(c.updated_at) as last_updated_at
        from public.configs c
       where c.profile_id = p.id
    ) cfg on true
    left join lateral (
      select sum(case when u.provider = 'fish' then u.requests else 0 end)::int as fish_req,
             sum(case when u.provider = 'fish' then u.chars else 0 end)::int as fish_chars,
             sum(case when u.provider = 'elevenlabs' then u.requests else 0 end)::int as eleven_req,
             sum(case when u.provider = 'elevenlabs' then u.chars else 0 end)::int as eleven_chars
        from public.tts_usage_daily u
       where u.profile_id = p.id and u.day = v_today
    ) td on true
    left join lateral (
      select sum(case when u.provider = 'fish' then u.requests else 0 end)::int as fish_req,
             sum(case when u.provider = 'fish' then u.chars else 0 end)::int as fish_chars,
             sum(case when u.provider = 'elevenlabs' then u.requests else 0 end)::int as eleven_req,
             sum(case when u.provider = 'elevenlabs' then u.chars else 0 end)::int as eleven_chars
        from public.tts_usage_daily u
       where u.profile_id = p.id and u.day >= v_today - 6
    ) w7 on true
   where p.role <> 'admin';

  -- 5. Totales globales de uso
  select jsonb_build_object(
    'obs_active_24h', (
      select count(*) from public.profiles p
       where p.status = 'active' and p.role <> 'admin'
         and p.last_widget_at >= now() - interval '24 hours'
    ),
    'obs_active_7d', (
      select count(*) from public.profiles p
       where p.status = 'active' and p.role <> 'admin'
         and p.last_widget_at >= now() - interval '7 days'
    ),
    'panel_active_7d', (
      select count(*) from public.profiles p
       where p.status = 'active' and p.role <> 'admin'
         and p.last_seen_at >= now() - interval '7 days'
    ),
    'configured_streamers', (
      select count(distinct c.profile_id)
        from public.configs c
        join public.profiles p on p.id = c.profile_id
       where p.status = 'active' and p.role <> 'admin'
    ),
    'tts_7d_requests', (
      select coalesce(sum(u.requests), 0) from public.tts_usage_daily u where u.day >= v_today - 6
    ),
    'tts_7d_chars', (
      select coalesce(sum(u.chars), 0) from public.tts_usage_daily u where u.day >= v_today - 6
    ),
    'eleven_7d_requests', (
      select coalesce(sum(u.requests), 0) from public.tts_usage_daily u
       where u.day >= v_today - 6 and u.provider = 'elevenlabs'
    ),
    'eleven_7d_chars', (
      select coalesce(sum(u.chars), 0) from public.tts_usage_daily u
       where u.day >= v_today - 6 and u.provider = 'elevenlabs'
    ),
    'eleven_today_chars', (
      select coalesce(sum(u.chars), 0) from public.tts_usage_daily u
       where u.day = v_today and u.provider = 'elevenlabs'
    ),
    'active_tournaments', v_active_tourns,
    'total_tournament_entries', v_total_entries
  ) into v_totals;

  -- 6. Últimas acciones en la bitácora del administrador
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'action', a.action,
        'detail', a.detail,
        'created_at', a.created_at
      )
      order by a.created_at desc, a.id desc
    ),
    '[]'::jsonb
  )
    into v_audit
    from (
      select id, action, detail, created_at
        from public.admin_audit_log
       order by created_at desc, id desc
       limit 40
    ) a;

  return jsonb_build_object(
    'modules', v_modules,
    'profiles', v_profiles,
    'totals', v_totals,
    'audit_log', v_audit
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Permisos de ejecución
-- -----------------------------------------------------------------------------

revoke execute on function
  public.log_admin_action(uuid, text, text),
  public.check_and_record_tts_usage(uuid, text, text, integer),
  public.admin_set_elevenlabs_limit(uuid, integer),
  public.admin_usage_report()
from public, anon, authenticated;

grant execute on function
  public.admin_set_elevenlabs_limit(uuid, integer),
  public.admin_usage_report()
to authenticated;

grant execute on function
  public.check_and_record_tts_usage(uuid, text, text, integer)
to service_role;

grant execute on function
  public.widget_version(text),
  public.widget_bundle(text)
to anon, authenticated;
