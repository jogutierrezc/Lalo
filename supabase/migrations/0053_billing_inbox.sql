-- =============================================================================
-- 0053 · Bandeja de pagos y facturación (rediseño Tally Studio)
--
--   1. billing_inbox_resolutions: ítems de la bandeja de pagos que un administrador marcó como
--      resueltos (item_key, resolved_by, resolved_at, note). RLS activada y SIN políticas: solo la
--      clave de servicio (el servidor) la toca, igual que billing_sales y billing_refunds.
--   2. billing_inbox_resolve(): marca un ítem como resuelto y deja bitácora en admin_audit_log.
--      NO usa log_admin_action porque esa función toma el actor de auth.uid(), que es null cuando
--      llama el servidor con la clave de servicio; aquí el actor llega como parámetro.
--      Solo la ejecuta service_role.
--   3. Índices para las consultas nuevas: historial por fecha, resumen mensual, reembolsos y
--      reversos recientes, avisos por suscripción y tipo, avisos reclamados sin terminar.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0052.
-- Se puede volver a ejecutar.
-- =============================================================================

create table if not exists public.billing_inbox_resolutions (
  item_key     text primary key check (char_length(item_key) between 1 and 160),
  resolved_by  uuid references public.profiles (id) on delete set null,
  resolved_at  timestamptz not null default now(),
  note         text not null default '' check (char_length(note) <= 240)
);

alter table public.billing_inbox_resolutions enable row level security;
revoke all on public.billing_inbox_resolutions from anon, authenticated;
-- Sin políticas: solo el servidor (clave de servicio, que ignora RLS).

create or replace function public.billing_inbox_resolve(
  p_item_key text,
  p_actor    uuid,
  p_note     text
)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_key text := left(coalesce(trim(p_item_key), ''), 160);
begin
  if v_key = '' then
    raise exception 'invalid_item_key';
  end if;

  insert into public.billing_inbox_resolutions (item_key, resolved_by, note)
  values (v_key, p_actor, left(coalesce(trim(p_note), ''), 240))
  on conflict (item_key) do nothing;

  -- Ya estaba resuelto: no se duplica ni la fila ni la bitácora
  if not found then
    return 'duplicate';
  end if;

  insert into public.admin_audit_log (actor_id, target_id, action, detail)
  values (p_actor, null, 'billing_inbox_resolve', left('Bandeja de pagos: ítem resuelto ' || v_key, 240));

  return 'resolved';
end;
$$;

revoke execute on function public.billing_inbox_resolve(text, uuid, text) from public, anon, authenticated;
grant execute on function public.billing_inbox_resolve(text, uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- Índices
-- -----------------------------------------------------------------------------

create index if not exists billing_sales_created on public.billing_sales (created_at desc);
create index if not exists billing_sales_reversed on public.billing_sales (reversed_at desc) where reversed_at is not null;
create index if not exists billing_refunds_created on public.billing_refunds (created_at desc);
create index if not exists billing_events_subscription_type on public.billing_events (subscription_id, type, claimed_at desc);
create index if not exists billing_events_claimed on public.billing_events (claimed_at desc);
create index if not exists billing_subscriptions_status_paid_until on public.billing_subscriptions (status, paid_until);
