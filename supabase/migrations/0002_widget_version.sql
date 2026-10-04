-- ============================================================================
-- 0002_widget_version.sql
--
-- Fecha del último cambio de configuración de un streamer, consultable con su
-- llave de widget. El widget de OBS la pregunta cada medio minuto y solo vuelve
-- a descargar el paquete completo (widget_bundle) cuando cambia: así la
-- consulta periódica casi no gasta salida de datos.
--
-- SIN PROBAR contra un proyecto real, igual que 0001.
-- ============================================================================

create or replace function public.widget_version(p_key text)
returns timestamptz
language sql stable security definer set search_path = ''
as $$
  select max(c.updated_at)
  from public.configs c
  join public.profiles p on p.id = c.profile_id
  where p.widget_key = p_key
    and p.status = 'active';
$$;

revoke all on function public.widget_version(text) from public;
grant execute on function public.widget_version(text) to anon, authenticated;
