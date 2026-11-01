-- =============================================================================
-- 0046_paypal_billing.sql
--
-- Cobro de planes con suscripciones recurrentes de PayPal.
--
--   billing_prices         precio por plan y periodo (1, 3, 6 o 12 meses) y el id del
--                          Billing Plan creado en PayPal. Cambiar un precio ya sincronizado
--                          archiva la fila y crea otra (PayPal no permite editar el precio).
--   billing_subscriptions  una fila por suscripción del streamer. Solo la escribe el servidor.
--   billing_events         ids de los avisos (webhooks) ya procesados: idempotencia.
--   profiles.plan_expires_at  hasta cuándo vale el plan de pago. Null = plan sin caducidad
--                          (el de siempre: invitación o asignado por el administrador).
--   billing_expire_due()   devuelve al plan por defecto a quien venció sin renovar.
--
-- El plan SOLO se activa por un pago confirmado (webhook PAYMENT.SALE.COMPLETED),
-- nunca por lo que diga el navegador.
--
-- Cómo programar billing_expire_due() (elige una; ver supabase/BOT-NUBE.md, sección PayPal):
--   a) Vercel Cron: vercel.json ya llama a /api/paypal/expire una vez al día.
--   b) Supabase Cron (pg_cron), si la extensión está activa:
--        select cron.schedule('billing-expire-due', '5 4 * * *', $$select public.billing_expire_due()$$);
--   Además el servidor la llama al leer el estado (acción status), así que un streamer
--   nunca ve acceso caducado aunque el cron falle.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0045.
-- Se puede volver a ejecutar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tablas
-- -----------------------------------------------------------------------------

create table if not exists public.billing_prices (
  id             uuid primary key default gen_random_uuid(),
  plan_id        text not null references public.plans (id) on delete cascade,
  months         int  not null check (months in (1, 3, 6, 12)),
  price_usd      numeric(10, 2) not null check (price_usd > 0),
  active         boolean not null default true,
  paypal_plan_id text,
  archived       boolean not null default false,
  created_at     timestamptz not null default now()
);

-- Un solo precio vigente por plan y periodo; las filas archivadas quedan de historial.
create unique index if not exists billing_prices_plan_months_live
  on public.billing_prices (plan_id, months) where not archived;

create table if not exists public.billing_subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  profile_id             uuid not null references public.profiles (id) on delete cascade,
  plan_id                text not null references public.plans (id),
  months                 int  not null check (months in (1, 3, 6, 12)),
  price_usd              numeric not null,
  paypal_subscription_id text not null unique,
  status                 text not null default 'pending'
                         check (status in ('pending', 'active', 'grace', 'cancelled', 'suspended', 'expired')),
  started_at             timestamptz not null default now(),
  paid_until             timestamptz,
  last_payment_at        timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists billing_subscriptions_profile
  on public.billing_subscriptions (profile_id, created_at desc);

create table if not exists public.billing_events (
  paypal_event_id  text primary key,
  type             text not null,
  subscription_id  text,
  payload          jsonb not null default '{}'::jsonb,
  processed_at     timestamptz not null default now()
);

alter table public.profiles add column if not exists plan_expires_at timestamptz;

-- -----------------------------------------------------------------------------
-- 2. RLS: lectura limitada; escrituras solo con la clave de servicio (que ignora RLS)
-- -----------------------------------------------------------------------------

alter table public.billing_prices        enable row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.billing_events        enable row level security;

revoke all on public.billing_prices, public.billing_subscriptions, public.billing_events from anon;
revoke insert, update, delete on public.billing_prices, public.billing_subscriptions from authenticated;
revoke all on public.billing_events from authenticated;

-- Cualquier usuario con sesión ve los precios vigentes (activos, no archivados).
drop policy if exists billing_prices_select on public.billing_prices;
create policy billing_prices_select on public.billing_prices
  for select to authenticated
  using (active and not archived);

-- El streamer solo ve sus propias suscripciones.
drop policy if exists billing_subscriptions_select on public.billing_subscriptions;
create policy billing_subscriptions_select on public.billing_subscriptions
  for select to authenticated
  using (profile_id = (select auth.uid()));

-- billing_events: sin políticas, solo el servidor.

-- -----------------------------------------------------------------------------
-- 3. Vencimientos
-- -----------------------------------------------------------------------------

-- Devuelve al plan por defecto a los perfiles cuyo plan de pago venció, y marca como
-- 'expired' las suscripciones cuyo periodo pagado terminó. Solo toca perfiles con
-- plan_expires_at: un plan asignado a mano (sin fecha) no se toca nunca.
-- Devuelve cuántos perfiles volvieron al plan por defecto.
create or replace function public.billing_expire_due()
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_default text;
  v_count   int := 0;
begin
  select pl.id into v_default from public.plans pl where pl.is_default limit 1;

  update public.billing_subscriptions s
     set status = 'expired', updated_at = now()
   where s.status in ('active', 'grace', 'cancelled', 'suspended')
     and s.paid_until is not null
     and s.paid_until <= now();

  if v_default is not null then
    update public.profiles p
       set plan_id = v_default, plan_expires_at = null
     where p.plan_expires_at is not null
       and p.plan_expires_at <= now();
    get diagnostics v_count = row_count;
  end if;

  return v_count;
end;
$$;

-- Solo el servidor (clave de servicio) y el cron la ejecutan.
revoke all on function public.billing_expire_due() from public, anon, authenticated;
grant execute on function public.billing_expire_due() to service_role;
