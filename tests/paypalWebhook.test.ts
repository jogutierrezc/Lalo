/**
 * tests/paypalWebhook.test.ts
 *
 * Webhook y acciones de cobro con PayPal, con fetch y base de datos simulados:
 * firma inválida -> 400, idempotencia, el plan no se abre sin pago, acceso hasta
 * paid_until tras cancelar, y las acciones de catálogo, suscripción y precios.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { defaultDeps, type Deps, type IntegrationRequest } from '../server/integrations/http';
import { handlePaypal } from '../server/paypal/handlers';
import { resetPaypalToken } from '../server/paypal/client';
import type { PaypalDb, PlanRow, PriceRow, SubscriptionRow } from '../server/paypal/db';

const PROFILE = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-2222-3333-4444-555555555555';
const NOW = Date.parse('2026-11-01T12:00:00Z');

const ENV = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  PAYPAL_ENV: 'sandbox',
  PAYPAL_CLIENT_ID: 'cid',
  PAYPAL_CLIENT_SECRET: 'secreto-de-prueba',
  PAYPAL_WEBHOOK_ID: 'WH-1',
  PUBLIC_BASE_URL: 'https://lalo.test',
  CRON_SECRET: 'cron-secreto',
};

function memoryDb() {
  const plans: PlanRow[] = [
    { id: 'basico', name: 'Básico', is_default: true },
    { id: 'plus', name: 'Plus', is_default: false },
  ];
  const state = {
    prices: [] as PriceRow[],
    subs: [] as SubscriptionRow[],
    events: new Set<string>(),
    settings: new Map<string, string>(),
    profiles: new Map<string, { plan_id: string; plan_expires_at: string | null }>([[PROFILE, { plan_id: 'basico', plan_expires_at: null }]]),
    now: NOW,
    seq: 0,
  };
  const db: PaypalDb = {
    plans: async () => plans,
    prices: async () => state.prices.filter((p) => !p.archived).map((p) => ({ ...p })),
    insertPrice: async (row) => {
      state.prices.push({ id: `pr${++state.seq}`, paypal_plan_id: null, archived: false, ...row });
    },
    updatePrice: async (id, patch) => {
      Object.assign(state.prices.find((p) => p.id === id) as PriceRow, patch);
    },
    setting: async (key) => state.settings.get(key) ?? null,
    putSetting: async (key, value) => void state.settings.set(key, value),
    insertSubscription: async (row) => {
      state.subs.push({ id: `s${++state.seq}`, paid_until: null, last_payment_at: null, ...row });
    },
    subscriptionByPaypalId: async (id) => state.subs.find((s) => s.paypal_subscription_id === id) ?? null,
    currentSubscription: async (profileId) => {
      const mine = state.subs.filter((s) => s.profile_id === profileId).reverse();
      return mine.find((s) => s.status !== 'pending') ?? mine[0] ?? null;
    },
    updateSubscription: async (id, patch) => {
      Object.assign(state.subs.find((s) => s.paypal_subscription_id === id) as SubscriptionRow, patch);
    },
    grantPlan: async (profileId, planId, expiresAt) => {
      state.profiles.set(profileId, { plan_id: planId, plan_expires_at: expiresAt });
    },
    claimEvent: async (event) => {
      if (state.events.has(event.id)) return false;
      state.events.add(event.id);
      return true;
    },
    releaseEvent: async (id) => void state.events.delete(id),
    // Réplica de billing_expire_due()
    expireDue: async () => {
      let n = 0;
      state.subs.forEach((s) => {
        if (['active', 'grace', 'cancelled', 'suspended'].includes(s.status) && s.paid_until && Date.parse(s.paid_until) <= state.now) s.status = 'expired';
      });
      state.profiles.forEach((p) => {
        if (p.plan_expires_at && Date.parse(p.plan_expires_at) <= state.now) {
          p.plan_id = 'basico';
          p.plan_expires_at = null;
          n += 1;
        }
      });
      return n;
    },
  };
  return { db, state };
}

interface PayPalSim {
  verification: string;
  verifyStatus: number;
  calls: { url: string; method: string; body: unknown }[];
  remoteStatus: string;
}

function setup() {
  resetPaypalToken();
  const { db, state } = memoryDb();
  const sim: PayPalSim = { verification: 'SUCCESS', verifyStatus: 200, calls: [], remoteStatus: 'ACTIVE' };
  let created = 0;
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  const fetchMock = (async (input: string, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init?.body;
    sim.calls.push({ url, method, body });
    if (url.endsWith('/v1/oauth2/token')) return json(200, { access_token: 'tok', expires_in: 3600 });
    if (url.endsWith('/v1/notifications/verify-webhook-signature')) return sim.verifyStatus === 200 ? json(200, { verification_status: sim.verification }) : json(sim.verifyStatus, { name: 'INVALID_REQUEST' });
    if (url.endsWith('/v1/catalogs/products')) return json(201, { id: 'PROD-1' });
    if (url.endsWith('/v1/billing/plans')) return json(201, { id: `P-${++created}`, status: 'ACTIVE' });
    if (url.endsWith('/v1/billing/subscriptions') && method === 'POST')
      return json(201, { id: 'I-NEW', links: [{ rel: 'approve', href: 'https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-1' }] });
    if (/\/v1\/billing\/subscriptions\/[^/]+$/.test(url) && method === 'GET') return json(200, { status: sim.remoteStatus });
    if (url.endsWith('/cancel')) return new Response(null, { status: 204 });
    return json(404, { name: 'RESOURCE_NOT_FOUND' });
  }) as unknown as typeof fetch;

  let caller = { id: PROFILE, role: 'streamer', status: 'active' };
  const deps: Deps = { ...defaultDeps, fetch: fetchMock, now: () => state.now, auth: async () => caller };
  const call = (action: Parameters<typeof handlePaypal>[0], method: string, body?: unknown, headers: Record<string, string> = {}, env = ENV) =>
    handlePaypal(action, { method, headers, query: {}, body } as IntegrationRequest, env, deps, db);
  const asAdmin = () => void (caller = { id: OTHER, role: 'admin', status: 'active' });
  return { db, state, sim, call, asAdmin };
}

const SIG_HEADERS = {
  'paypal-transmission-id': 'tid',
  'paypal-transmission-time': '2026-11-01T12:00:00Z',
  'paypal-transmission-sig': 'sig',
  'paypal-cert-url': 'https://api.sandbox.paypal.com/cert',
  'paypal-auth-algo': 'SHA256withRSA',
};

const subEvent = (id: string, type: string, subId = 'I-1') => ({ id, event_type: type, resource: { id: subId } });
const saleEvent = (id: string, subId = 'I-1', state = 'completed') => ({ id, event_type: 'PAYMENT.SALE.COMPLETED', resource: { billing_agreement_id: subId, state } });

type Ctx = ReturnType<typeof setup>;
const seedSub = (ctx: Ctx, patch: Partial<SubscriptionRow> = {}) =>
  ctx.state.subs.push({
    id: 'seed',
    profile_id: PROFILE,
    plan_id: 'plus',
    months: 3,
    price_usd: 25,
    paypal_subscription_id: 'I-1',
    status: 'pending',
    started_at: new Date(NOW).toISOString(),
    paid_until: null,
    last_payment_at: null,
    ...patch,
  });
const hook = (ctx: Ctx, event: unknown) => ctx.call('webhook', 'POST', event, SIG_HEADERS);

describe('webhook', () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = setup();
    seedSub(ctx);
  });

  it('firma inválida -> 400 y no cambia nada', async () => {
    ctx.sim.verification = 'FAILURE';
    const res = await hook(ctx, saleEvent('E1'));
    expect(res.status).toBe(400);
    expect(ctx.state.subs[0].status).toBe('pending');
    expect(ctx.state.events.size).toBe(0);
  });

  it('sin cabeceras de firma -> 400 sin llamar a PayPal', async () => {
    const res = await ctx.call('webhook', 'POST', saleEvent('E1'), {});
    expect(res.status).toBe(400);
    expect(ctx.sim.calls.some((c) => c.url.includes('verify-webhook'))).toBe(false);
  });

  it('PayPal rechaza la verificación con 400 -> 400; un fallo 5xx -> 502 para que reintente', async () => {
    ctx.sim.verifyStatus = 400;
    expect((await hook(ctx, saleEvent('E1'))).status).toBe(400);
    ctx.sim.verifyStatus = 500;
    expect((await hook(ctx, saleEvent('E2'))).status).toBe(502);
  });

  it('verifica con webhook_id y el evento recibido', async () => {
    await hook(ctx, saleEvent('E1'));
    const verify = ctx.sim.calls.find((c) => c.url.includes('verify-webhook')) as { body: Record<string, unknown> };
    expect(verify.body.webhook_id).toBe('WH-1');
    expect((verify.body.webhook_event as { id: string }).id).toBe('E1');
    expect(verify.body.transmission_id).toBe('tid');
  });

  it('ACTIVATED no activa el plan sin pago', async () => {
    const res = await hook(ctx, subEvent('E1', 'BILLING.SUBSCRIPTION.ACTIVATED'));
    expect(res.status).toBe(200);
    expect(ctx.state.subs[0].status).toBe('pending');
    expect(ctx.state.profiles.get(PROFILE)?.plan_id).toBe('basico');
    const status = (await ctx.call('status', 'GET')).body as { hasAccess: boolean };
    expect(status.hasAccess).toBe(false);
  });

  it('el pago completado activa, da el plan y suma el periodo', async () => {
    await hook(ctx, saleEvent('E1'));
    expect(ctx.state.subs[0].status).toBe('active');
    expect(ctx.state.subs[0].paid_until?.slice(0, 10)).toBe('2027-02-01');
    expect(ctx.state.profiles.get(PROFILE)).toEqual({ plan_id: 'plus', plan_expires_at: ctx.state.subs[0].paid_until });
  });

  it('un pago que no está completed no activa nada', async () => {
    await hook(ctx, saleEvent('E1', 'I-1', 'pending'));
    expect(ctx.state.subs[0].status).toBe('pending');
    expect(ctx.state.profiles.get(PROFILE)?.plan_id).toBe('basico');
  });

  it('idempotencia: el mismo evento dos veces suma una sola vez', async () => {
    await hook(ctx, saleEvent('E1'));
    const first = ctx.state.subs[0].paid_until;
    const again = await hook(ctx, saleEvent('E1'));
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect(ctx.state.subs[0].paid_until).toBe(first);
  });

  it('un segundo pago (evento distinto) suma desde el vencimiento', async () => {
    await hook(ctx, saleEvent('E1'));
    await hook(ctx, saleEvent('E2'));
    expect(ctx.state.subs[0].paid_until?.slice(0, 10)).toBe('2027-05-01');
  });

  it('si falla al aplicar, libera el evento para el reintento', async () => {
    ctx.db.updateSubscription = async () => {
      throw new Error('caída');
    };
    const res = await hook(ctx, saleEvent('E1'));
    expect(res.status).toBe(502);
    expect(ctx.state.events.has('E1')).toBe(false);
  });

  it('cobro fallido -> grace con acceso hasta paid_until', async () => {
    await hook(ctx, saleEvent('E1'));
    await hook(ctx, subEvent('E2', 'BILLING.SUBSCRIPTION.PAYMENT.FAILED'));
    expect(ctx.state.subs[0].status).toBe('grace');
    expect(((await ctx.call('status', 'GET')).body as { hasAccess: boolean }).hasAccess).toBe(true);
  });

  it('suspendida y expirada cambian de estado', async () => {
    await hook(ctx, saleEvent('E1'));
    await hook(ctx, subEvent('E2', 'BILLING.SUBSCRIPTION.SUSPENDED'));
    expect(ctx.state.subs[0].status).toBe('suspended');
    expect(((await ctx.call('status', 'GET')).body as { hasAccess: boolean }).hasAccess).toBe(true);
    await hook(ctx, subEvent('E3', 'BILLING.SUBSCRIPTION.EXPIRED'));
    expect(ctx.state.subs[0].status).toBe('expired');
  });

  it('cancelar conserva el acceso hasta paid_until y luego el perfil vuelve al plan por defecto', async () => {
    await hook(ctx, saleEvent('E1'));
    await hook(ctx, subEvent('E2', 'BILLING.SUBSCRIPTION.CANCELLED'));
    expect(ctx.state.subs[0].status).toBe('cancelled');
    const during = (await ctx.call('status', 'GET')).body as { hasAccess: boolean; subscription: { status: string; planName: string } };
    expect(during.hasAccess).toBe(true);
    expect(during.subscription.planName).toBe('Plus');
    expect(ctx.state.profiles.get(PROFILE)?.plan_id).toBe('plus');

    ctx.state.now = Date.parse('2027-02-02T00:00:00Z');
    const after = (await ctx.call('status', 'GET')).body as { hasAccess: boolean; subscription: { status: string } };
    expect(after.hasAccess).toBe(false);
    expect(after.subscription.status).toBe('expired');
    expect(ctx.state.profiles.get(PROFILE)).toEqual({ plan_id: 'basico', plan_expires_at: null });
  });

  it('eventos ajenos o de una suscripción desconocida responden 200 sin tocar nada', async () => {
    expect((await hook(ctx, { id: 'E1', event_type: 'CATALOG.PRODUCT.CREATED', resource: { id: 'x' } })).status).toBe(200);
    expect((await hook(ctx, saleEvent('E2', 'I-DESCONOCIDA'))).status).toBe(200);
    expect(ctx.state.subs[0].status).toBe('pending');
  });

  it('no registra el cuerpo completo del aviso', async () => {
    const claims: unknown[] = [];
    const original = ctx.db.claimEvent;
    ctx.db.claimEvent = async (event) => (claims.push(event.payload), original(event));
    await hook(ctx, { ...saleEvent('E1'), resource: { billing_agreement_id: 'I-1', state: 'completed', payer_email: 'a@b.c' } });
    expect(JSON.stringify(claims)).not.toContain('a@b.c');
  });
});

describe('acciones del streamer', () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = setup();
    ctx.state.settings.set('paypal_synced_env', 'sandbox');
    ctx.state.prices.push(
      { id: 'a', plan_id: 'plus', months: 1, price_usd: 10, active: true, paypal_plan_id: 'P-1', archived: false },
      { id: 'b', plan_id: 'plus', months: 3, price_usd: 27, active: true, paypal_plan_id: 'P-3', archived: false },
      { id: 'c', plan_id: 'plus', months: 6, price_usd: 50, active: true, paypal_plan_id: null, archived: false },
      { id: 'd', plan_id: 'plus', months: 12, price_usd: 90, active: false, paypal_plan_id: 'P-12', archived: false }
    );
  });

  it('catalog solo ofrece precios activos y sincronizados', async () => {
    const body = (await ctx.call('catalog', 'GET')).body as { enabled: boolean; env: string; plans: { id: string; prices: Record<string, number | null> }[] };
    expect(body.enabled).toBe(true);
    expect(body.env).toBe('sandbox');
    expect(body.plans).toEqual([{ id: 'plus', name: 'Plus', prices: { '1': 10, '3': 27, '6': null, '12': null } }]);
  });

  it('catalog con enabled=false si faltan variables PAYPAL_*', async () => {
    const res = await ctx.call('catalog', 'GET', undefined, {}, { ...ENV, PAYPAL_CLIENT_SECRET: '' });
    expect(res.body).toEqual({ enabled: false, env: 'sandbox', plans: [] });
  });

  it('subscribe crea la suscripción pendiente y devuelve approveUrl, sin dar el plan', async () => {
    const res = await ctx.call('subscribe', 'POST', { planId: 'plus', months: 3 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ approveUrl: expect.stringContaining('paypal.com'), subscriptionId: 'I-NEW' });
    const sent = ctx.sim.calls.find((c) => c.url.endsWith('/v1/billing/subscriptions') && c.method === 'POST')?.body as Record<string, any>;
    expect(sent.plan_id).toBe('P-3');
    expect(sent.custom_id).toBe(PROFILE);
    expect(sent.application_context).toMatchObject({ user_action: 'SUBSCRIBE_NOW', return_url: 'https://lalo.test/?paypal=ok#cuenta', cancel_url: 'https://lalo.test/?paypal=cancel#cuenta' });
    expect(ctx.state.subs[0]).toMatchObject({ status: 'pending', months: 3, price_usd: 27, profile_id: PROFILE });
    expect(ctx.state.profiles.get(PROFILE)?.plan_id).toBe('basico');
  });

  it('subscribe valida plan, periodo y que el precio esté ofrecido', async () => {
    expect((await ctx.call('subscribe', 'POST', { planId: 'plus', months: 2 })).status).toBe(400);
    expect((await ctx.call('subscribe', 'POST', { planId: '../x', months: 1 })).status).toBe(400);
    expect((await ctx.call('subscribe', 'POST', { planId: 'plus', months: 6 })).status).toBe(404);
    expect((await ctx.call('subscribe', 'POST', { planId: 'plus', months: 12 })).status).toBe(404);
  });

  it('confirm consulta a PayPal pero NO activa el plan aunque PayPal diga ACTIVE', async () => {
    seedSub(ctx);
    ctx.sim.remoteStatus = 'ACTIVE';
    const res = await ctx.call('confirm', 'POST', { subscriptionId: 'I-1' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ hasAccess: false, subscription: { status: 'pending' } });
    expect(ctx.state.profiles.get(PROFILE)?.plan_id).toBe('basico');
  });

  it('confirm no deja ver suscripciones de otro usuario', async () => {
    seedSub(ctx, { profile_id: OTHER });
    expect((await ctx.call('confirm', 'POST', { subscriptionId: 'I-1' })).status).toBe(404);
  });

  it('cancel cancela en PayPal y conserva lo pagado', async () => {
    seedSub(ctx, { status: 'active', paid_until: '2027-02-01T12:00:00.000Z' });
    const res = await ctx.call('cancel', 'POST');
    expect(res.status).toBe(200);
    expect(ctx.sim.calls.some((c) => c.url.endsWith('/v1/billing/subscriptions/I-1/cancel'))).toBe(true);
    expect(res.body).toMatchObject({ hasAccess: true, subscription: { status: 'cancelled', paidUntil: '2027-02-01T12:00:00.000Z' } });
  });

  it('status sin suscripción', async () => {
    expect((await ctx.call('status', 'GET')).body).toEqual({ subscription: null, hasAccess: false });
  });
});

describe('administración', () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = setup();
  });

  it('un streamer no puede usar las acciones de admin', async () => {
    expect((await ctx.call('admin-prices', 'GET')).status).toBe(403);
    expect((await ctx.call('admin-sync', 'POST')).status).toBe(403);
  });

  it('guarda un precio y lo oculta con null', async () => {
    ctx.asAdmin();
    await ctx.call('admin-prices', 'POST', { planId: 'plus', months: 1, priceUsd: 9.999, active: true });
    expect(ctx.state.prices[0]).toMatchObject({ price_usd: 10, active: true });
    await ctx.call('admin-prices', 'POST', { planId: 'plus', months: 1, priceUsd: null, active: true });
    expect(ctx.state.prices[0].active).toBe(false);
  });

  it('rechaza precios y periodos no válidos', async () => {
    ctx.asAdmin();
    expect((await ctx.call('admin-prices', 'POST', { planId: 'plus', months: 5, priceUsd: 5, active: true })).status).toBe(400);
    expect((await ctx.call('admin-prices', 'POST', { planId: 'plus', months: 1, priceUsd: -1, active: true })).status).toBe(400);
    expect((await ctx.call('admin-prices', 'POST', { planId: 'nada', months: 1, priceUsd: 5, active: true })).status).toBe(404);
  });

  it('sincronizar crea producto una vez y un plan por precio; cambiar un precio sincronizado archiva y crea otro', async () => {
    ctx.asAdmin();
    await ctx.call('admin-prices', 'POST', { planId: 'plus', months: 1, priceUsd: 10, active: true });
    await ctx.call('admin-prices', 'POST', { planId: 'plus', months: 3, priceUsd: 27, active: true });
    const sync = await ctx.call('admin-sync', 'POST');
    expect(sync.body).toMatchObject({ synced: 2, failed: 0, productId: 'PROD-1' });
    const planCall = ctx.sim.calls.find((c) => c.url.endsWith('/v1/billing/plans'))?.body as Record<string, any>;
    expect(planCall.billing_cycles[0]).toMatchObject({ frequency: { interval_unit: 'MONTH', interval_count: 1 }, total_cycles: 0 });
    expect(planCall.billing_cycles[0].pricing_scheme.fixed_price).toEqual({ value: '10.00', currency_code: 'USD' });
    expect(planCall.payment_preferences).toMatchObject({ payment_failure_threshold: 3, auto_bill_outstanding: true });

    await ctx.call('admin-sync', 'POST');
    expect(ctx.sim.calls.filter((c) => c.url.endsWith('/v1/catalogs/products'))).toHaveLength(1);
    expect(ctx.sim.calls.filter((c) => c.url.endsWith('/v1/billing/plans'))).toHaveLength(2);

    await ctx.call('admin-prices', 'POST', { planId: 'plus', months: 1, priceUsd: 12, active: true });
    const old = ctx.state.prices.find((p) => p.price_usd === 10) as PriceRow;
    const fresh = ctx.state.prices.find((p) => p.price_usd === 12) as PriceRow;
    expect(old).toMatchObject({ archived: true, active: false, paypal_plan_id: 'P-1' });
    expect(fresh).toMatchObject({ archived: false, paypal_plan_id: null });
  });
});

describe('expire (cron)', () => {
  it('exige CRON_SECRET', async () => {
    const ctx = setup();
    expect((await ctx.call('expire', 'GET')).status).toBe(401);
    expect((await ctx.call('expire', 'GET', undefined, { authorization: 'Bearer cron-secreto' })).status).toBe(200);
  });
});
