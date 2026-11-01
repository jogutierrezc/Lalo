/**
 * tests/paypalWebhook.test.ts
 *
 * Webhook y acciones de cobro con PayPal, con fetch y base de datos simulados:
 * firma inválida -> 400, idempotencia, el plan no se abre sin pago, acceso hasta
 * paid_until tras cancelar, y las acciones de catálogo, suscripción y precios.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultDeps, type Deps, type IntegrationRequest } from '../server/integrations/http';
import { handlePaypal, isPaypalCertUrl } from '../server/paypal/handlers';
import { resetPaypalToken } from '../server/paypal/client';
import { isFullRefund, paidUntilAfterPayment, paidUntilAfterReversal, statusAfterPayment } from '../server/paypal/logic';
import { DuplicateSubscriptionError, type PaypalDb, type PlanRow, type PriceRow, type SubscriptionRow } from '../server/paypal/db';

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
  const plans: PlanRow[] = [ // archived opcional
    { id: 'basico', name: 'Básico', is_default: true },
    { id: 'plus', name: 'Plus', is_default: false },
  ];
  const state = {
    prices: [] as PriceRow[],
    subs: [] as SubscriptionRow[],
    events: new Map<string, { status: 'processing' | 'done'; claimedAt: number }>(),
    sales: new Map<string, { subId: string; months: number; amount: number | null; currency: string | null; refunded: number; reversed: boolean }>(),
    refunds: new Map<string, { saleId: string; amount: number }>(),
    plansArchived: new Set<string>(),
    settings: new Map<string, string>(),
    profiles: new Map<string, { plan_id: string; plan_expires_at: string | null }>([[PROFILE, { plan_id: 'basico', plan_expires_at: null }]]),
    now: NOW,
    seq: 0,
  };
  const db: PaypalDb = {
    plans: async () => plans.map((p) => ({ ...p, archived: state.plansArchived.has(p.id) })),
    prices: async () => state.prices.filter((p) => !p.archived).map((p) => ({ ...p })),
    insertPrice: async (row) => {
      state.prices.push({ id: `pr${++state.seq}`, paypal_plan_id: null, archived: false, ...row });
    },
    updatePrice: async (id, patch) => {
      Object.assign(state.prices.find((p) => p.id === id) as PriceRow, patch);
    },
    setting: async (key) => state.settings.get(key) ?? null,
    putSetting: async (key, value) => void state.settings.set(key, value),
    // Réplica del índice único parcial de 0051: un solo pending/active/grace/suspended por perfil
    insertSubscription: async (row) => {
      const live = ['pending', 'active', 'grace', 'suspended'];
      if (live.includes(row.status) && state.subs.some((x) => x.profile_id === row.profile_id && live.includes(x.status))) throw new DuplicateSubscriptionError();
      state.subs.push({ id: `s${++state.seq}`, paid_until: null, last_payment_at: null, ...row });
    },
    subscriptionByPaypalId: async (id) => state.subs.find((s) => s.paypal_subscription_id === id) ?? null,
    profileSubscriptions: async (profileId) => state.subs.filter((s) => s.profile_id === profileId).reverse(),
    currentSubscription: async (profileId) => {
      const mine = state.subs.filter((s) => s.profile_id === profileId).reverse();
      return mine.find((s) => s.status !== 'pending') ?? mine[0] ?? null;
    },
    updateSubscription: async (id, patch) => {
      Object.assign(state.subs.find((s) => s.paypal_subscription_id === id) as SubscriptionRow, patch);
    },
    // Réplica de billing_apply_payment() (0050)
    applyPayment: async (input) => {
      if (!input.saleId.trim() || input.saleId.length > 100) throw new Error('invalid_sale');
      const sub = state.subs.find((x) => x.paypal_subscription_id === input.paypalSubscriptionId);
      if (!sub) return 'unknown_subscription';
      if (state.sales.has(input.saleId)) return 'duplicate';
      state.sales.set(input.saleId, { subId: sub.id, months: sub.months, amount: input.amount, currency: input.currency, refunded: 0, reversed: false });
      const now = new Date(state.now);
      const at = new Date(input.eventTime);
      const last = sub.last_event_time ? new Date(sub.last_event_time) : null;
      const until = paidUntilAfterPayment(sub.paid_until ? new Date(sub.paid_until) : null, sub.months, now);
      sub.status = statusAfterPayment(sub.status, last, at);
      sub.paid_until = until.toISOString();
      sub.last_payment_at = now.toISOString();
      if (!last || at > last) sub.last_event_time = at.toISOString();
      state.profiles.set(sub.profile_id, { plan_id: sub.plan_id, plan_expires_at: sub.paid_until });
      return 'applied';
    },
    // Réplica de billing_reverse_sale() (0051): refund_id idempotente; un reverso viejo no suspende ni mueve last_event_time
    reverseSale: async (input) => {
      const sale = state.sales.get(input.saleId);
      if (!sale) return 'unknown_sale';
      const sub = state.subs.find((x) => x.id === sale.subId) as SubscriptionRow;
      if (!input.reversal) {
        if (!input.refundId) throw new Error('invalid_refund');
        if (!state.refunds.has(input.refundId)) {
          state.refunds.set(input.refundId, { saleId: input.saleId, amount: Math.max(input.amount ?? 0, 0) });
          sale.refunded += Math.max(input.amount ?? 0, 0);
        }
      }
      if (!input.reversal && !isFullRefund(sale.amount, sale.refunded, sale.currency)) return 'partial';
      if (sale.reversed) return 'duplicate';
      sale.reversed = true;
      const old = sub.paid_until;
      const next = paidUntilAfterReversal(old ? new Date(old) : null, sale.months, new Date(state.now)).toISOString();
      sub.paid_until = next;
      const at = new Date(input.eventTime);
      const last = sub.last_event_time ? new Date(sub.last_event_time) : null;
      const stale = last !== null && at.getTime() < last.getTime();
      if (input.reversal && !stale && sub.status !== 'cancelled' && sub.status !== 'expired') {
        sub.status = 'suspended';
        if (!last || at > last) sub.last_event_time = at.toISOString();
      }
      const prof = state.profiles.get(sub.profile_id);
      if (prof && prof.plan_expires_at === old) prof.plan_expires_at = next;
      if (Date.parse(next) <= state.now) await db.expireDue();
      return 'applied';
    },
    subscriptionBySale: async (saleId) => {
      const sale = state.sales.get(saleId);
      return sale ? (state.subs.find((x) => x.id === sale.subId) ?? null) : null;
    },
    claimEvent: async (event, now) => {
      const cur = state.events.get(event.id);
      if (!cur) {
        state.events.set(event.id, { status: 'processing', claimedAt: now.getTime() });
        return 'claimed';
      }
      if (cur.status === 'done') return 'done';
      if (now.getTime() - cur.claimedAt < 5 * 60 * 1000) return 'busy';
      cur.claimedAt = now.getTime();
      return 'claimed';
    },
    completeEvent: async (id) => void (state.events.get(id) && (state.events.get(id)!.status = 'done')),
    releaseEvent: async (id) => void (state.events.get(id)?.status === 'processing' && state.events.delete(id)),
    // Réplica de la consulta: order by updated_at desc, id desc; cursor compuesto (updated_at, id)
    adminSubscriptions: async (limit, before) =>
      state.subs
        .map((x, i) => ({ x, updatedAt: (x as SubscriptionRow & { updated_at?: string }).updated_at ?? new Date(NOW + i * 1000).toISOString() }))
        .filter(({ x, updatedAt }) => !before || updatedAt < before.updatedAt || (before.id !== null && updatedAt === before.updatedAt && x.id < before.id))
        .sort((a, b) => (a.updatedAt === b.updatedAt ? (a.x.id < b.x.id ? 1 : -1) : a.updatedAt < b.updatedAt ? 1 : -1))
        .slice(0, limit)
        .map(({ x, updatedAt }) => ({
          id: x.id,
          profile_id: x.profile_id,
          twitch_login: 'streamer',
          display_name: 'Streamer',
          plan_id: x.plan_id,
          plan_name: null,
          months: x.months,
          status: x.status,
          started_at: x.started_at,
          paid_until: x.paid_until,
          last_payment_at: x.last_payment_at,
          price_usd: x.price_usd,
          updated_at: updatedAt,
        })),
    subscriptionTotals: async () => {
      const t = { active: 0, grace: 0, cancelled: 0, suspended: 0, expired: 0, pending: 0 };
      state.subs.forEach((x) => (t[x.status] += 1));
      return t;
    },
    // Réplica de billing_code_access(): excluye a quien paga ANTES de limitar
    codeAccess: async (nowIso, limit) =>
      [...state.profiles.entries()]
        .filter(([id, p]) => p.plan_expires_at && p.plan_expires_at > nowIso && !state.subs.some((x) => x.profile_id === id && ['active', 'grace', 'cancelled', 'suspended'].includes(x.status) && x.paid_until && x.paid_until > nowIso))
        .sort((a, b) => String(a[1].plan_expires_at).localeCompare(String(b[1].plan_expires_at)))
        .slice(0, limit)
        .map(([id, p]) => ({ profile_id: id, twitch_login: 'streamer', display_name: null, plan_id: p.plan_id, plan_name: null, expires_at: p.plan_expires_at as string, invite_code: 'LALO-ABC' })),
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
  /** Estado remoto por id de suscripción (si falta, remoteStatus). */
  remoteStatusById: Record<string, string>;
  /** Ids cuya consulta GET falla con 500 o responde 404. */
  getFail: Set<string>;
  getNotFound: Set<string>;
  /** Ids de suscripción cuya cancelación en PayPal falla con 500. */
  cancelFail: Set<string>;
}

function setup() {
  resetPaypalToken();
  const { db, state } = memoryDb();
  const sim: PayPalSim = { verification: 'SUCCESS', verifyStatus: 200, calls: [], remoteStatus: 'ACTIVE', remoteStatusById: {}, getFail: new Set(), getNotFound: new Set(), cancelFail: new Set() };
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
    if (/\/v1\/billing\/subscriptions\/[^/]+$/.test(url) && method === 'GET') {
      const id = decodeURIComponent(url.split('/').pop() as string);
      if (sim.getFail.has(id)) return json(500, { name: 'INTERNAL_SERVICE_ERROR' });
      if (sim.getNotFound.has(id)) return json(404, { name: 'RESOURCE_NOT_FOUND' });
      return json(200, { status: sim.remoteStatusById[id] ?? sim.remoteStatus });
    }
    if (url.endsWith('/cancel')) return [...sim.cancelFail].some((id) => url.includes(`/${id}/cancel`)) ? json(500, { name: 'INTERNAL_SERVICE_ERROR' }) : new Response(null, { status: 204 });
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
const saleEvent = (id: string, subId = 'I-1', state = 'completed', saleId = `SALE-${id}`, total = '27.00') => ({
  id,
  event_type: 'PAYMENT.SALE.COMPLETED',
  resource: { id: saleId, billing_agreement_id: subId, state, amount: { total, currency: 'USD' } },
});

type Ctx = ReturnType<typeof setup>;
const seedSubRow = (i: number): Partial<SubscriptionRow> => ({
  id: `x${i}`,
  profile_id: PROFILE,
  plan_id: 'plus',
  months: 3,
  price_usd: 25,
  paypal_subscription_id: `I-X${i}`,
  status: 'active',
  started_at: new Date(NOW).toISOString(),
  paid_until: null,
  last_payment_at: null,
});
const handlePaypalWithQuery = (ctx: Ctx, query: Record<string, string>) =>
  handlePaypal('admin-subscriptions', { method: 'GET', headers: {}, query, body: undefined } as IntegrationRequest, ENV, { ...defaultDeps, now: () => ctx.state.now, auth: async () => ({ id: OTHER, role: 'admin', status: 'active' }) } as Deps, ctx.db);
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
    expect(ctx.state.events.get('E1')?.status).toBe('done');
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
    ctx.db.applyPayment = async () => {
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
    expect(ctx.state.subs[0].status).toBe('pending');
  });

  it('no registra el cuerpo completo del aviso', async () => {
    const claims: unknown[] = [];
    const original = ctx.db.claimEvent;
    ctx.db.claimEvent = async (event, now) => (claims.push(event.payload), original(event, now));
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
    expect((body as { clientId?: string }).clientId).toBe('cid');
    expect(body.plans).toEqual([{ id: 'plus', name: 'Plus', prices: { '1': 10, '3': 27, '6': null, '12': null } }]);
  });

  it('catalog con enabled=false si faltan variables PAYPAL_*', async () => {
    const res = await ctx.call('catalog', 'GET', undefined, {}, { ...ENV, PAYPAL_CLIENT_SECRET: '' });
    expect(res.body).toEqual({ enabled: false, env: 'sandbox', clientId: '', plans: [] });
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

  it('catalog y subscribe ignoran un plan archivado', async () => {
    ctx.state.plansArchived.add('plus');
    const body = (await ctx.call('catalog', 'GET')).body as { plans: unknown[] };
    expect(body.plans).toEqual([]);
    expect((await ctx.call('subscribe', 'POST', { planId: 'plus', months: 3 })).status).toBe(404);
  });

  it("subscribe con flow 'sdk' devuelve solo subscriptionId, sin exigir origen, y no da el plan", async () => {
    const res = await ctx.call('subscribe', 'POST', { planId: 'plus', months: 3, flow: 'sdk' }, {}, { ...ENV, PUBLIC_BASE_URL: '' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ subscriptionId: 'I-NEW' });
    expect(ctx.state.subs[0]).toMatchObject({ status: 'pending', paypal_subscription_id: 'I-NEW' });
    expect(ctx.state.profiles.get(PROFILE)?.plan_id).toBe('basico');
  });

  it("subscribe con flow 'redirect' sin origen sigue fallando, y un flow raro se rechaza", async () => {
    expect((await ctx.call('subscribe', 'POST', { planId: 'plus', months: 3 }, {}, { ...ENV, PUBLIC_BASE_URL: '' })).status).toBe(400);
    expect((await ctx.call('subscribe', 'POST', { planId: 'plus', months: 3, flow: 'otro' })).status).toBe(400);
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

  it('admin-subscriptions: solo admin, GET, con totales, codeAccess y paginación', async () => {
    expect((await ctx.call('admin-subscriptions', 'GET')).status).toBe(403);
    ctx.asAdmin();
    expect((await ctx.call('admin-subscriptions', 'POST')).status).toBe(405);
    for (let i = 0; i < 3; i++) ctx.state.subs.push({ ...(seedSubRow(i) as SubscriptionRow) });
    ctx.state.profiles.set('p-code', { plan_id: 'plus', plan_expires_at: '2027-01-01T00:00:00.000Z' });
    const body = (await ctx.call('admin-subscriptions', 'GET')).body as any;
    expect(body.subscriptions).toHaveLength(3);
    expect(body.subscriptions[0]).toMatchObject({ profileId: PROFILE, planName: 'plus', status: 'active', priceUsd: 25 });
    expect(body.totals).toEqual({ active: 3, grace: 0, cancelled: 0, suspended: 0, expired: 0, pending: 0 });
    expect(body.codeAccess).toEqual([expect.objectContaining({ profileId: 'p-code', inviteCode: 'LALO-ABC', expiresAt: '2027-01-01T00:00:00.000Z' })]);
    expect((await ctx.call('admin-subscriptions', 'GET', undefined, {}, ENV)).status).toBe(200);
  });

  it('admin-subscriptions rechaza un cursor before que no es fecha', async () => {
    ctx.asAdmin();
    const res = await handlePaypalWithQuery(ctx, { before: 'no-es-fecha' });
    expect(res.status).toBe(400);
  });

  it('admin-prices lista planes nuevos y marca los archivados', async () => {
    ctx.asAdmin();
    ctx.state.plansArchived.add('plus');
    const body = (await ctx.call('admin-prices', 'GET')).body as { plans: { id: string; archived: boolean }[] };
    expect(body.plans.map((p) => [p.id, p.archived])).toEqual([['basico', false], ['plus', true]]);
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

// ---------------------------------------------------------------------------
// Endurecimiento (0050)
// ---------------------------------------------------------------------------

const withTime = (event: Record<string, unknown>, time: string) => ({ ...event, create_time: time });
const refundEvent = (id: string, saleId: string, total: string, refundId = `REF-${id}`, currency = 'USD') => ({ id, event_type: 'PAYMENT.SALE.REFUNDED', resource: { id: refundId, sale_id: saleId, state: 'completed', amount: { total, currency } } });
const reversedEvent = (id: string, saleId: string) => ({ id, event_type: 'PAYMENT.SALE.REVERSED', resource: { id: `REV-${id}`, sale_id: saleId, state: 'completed' } });
const accessOf = async (ctx: Ctx) => ((await ctx.call('status', 'GET')).body as { hasAccess: boolean }).hasAccess;

describe('webhook: entrada anónima (B3)', () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = setup();
    seedSub(ctx);
  });
  const verifyCalls = () => ctx.sim.calls.filter((c) => c.url.includes('verify-webhook')).length;

  it('rechaza una cert-url que no sea de PayPal sin llamar a PayPal', async () => {
    for (const url of ['http://api.paypal.com/cert', 'https://evil.example/cert', 'https://api.paypal.com.evil.example/cert', 'https://user:pw@api.paypal.com/cert', 'https://api.paypal.com:8443/cert', 'no-es-url']) {
      const res = await ctx.call('webhook', 'POST', saleEvent('E1'), { ...SIG_HEADERS, 'paypal-cert-url': url });
      expect(res.status).toBe(400);
    }
    expect(verifyCalls()).toBe(0);
  });

  it('acepta las cert-url de api y api-m, sandbox o live', async () => {
    for (const [i, url] of ['https://api.paypal.com/v1/notifications/certs/C', 'https://api.sandbox.paypal.com/c', 'https://api-m.paypal.com/c', 'https://api-m.sandbox.paypal.com/c'].entries()) {
      expect((await ctx.call('webhook', 'POST', saleEvent(`OK${i}`, 'I-1', 'completed', `S${i}`), { ...SIG_HEADERS, 'paypal-cert-url': url })).status).toBe(200);
    }
  });

  it('rechaza un cuerpo enorme (413) antes de llamar a PayPal', async () => {
    const big = { ...saleEvent('E1'), padding: 'x'.repeat(70 * 1024) };
    expect((await hook(ctx, big)).status).toBe(413);
    expect((await ctx.call('webhook', 'POST', JSON.stringify(big), SIG_HEADERS)).status).toBe(413);
    expect((await ctx.call('webhook', 'POST', saleEvent('E2'), { ...SIG_HEADERS, 'content-length': '999999' })).status).toBe(413);
    expect(verifyCalls()).toBe(0);
  });
});

describe('webhook: idempotencia en dos fases (M3) y ventas (B1)', () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = setup();
    seedSub(ctx);
  });

  it('la misma venta con otro event.id no suma de nuevo', async () => {
    await hook(ctx, saleEvent('E1', 'I-1', 'completed', 'SALE-A'));
    const first = ctx.state.subs[0].paid_until;
    const again = await hook(ctx, saleEvent('E2', 'I-1', 'completed', 'SALE-A'));
    expect(again.status).toBe(200);
    expect(ctx.state.subs[0].paid_until).toBe(first);
    expect(ctx.state.events.get('E2')?.status).toBe('done');
    // Otra venta distinta sí suma
    await hook(ctx, saleEvent('E3', 'I-1', 'completed', 'SALE-B'));
    expect(ctx.state.subs[0].paid_until?.slice(0, 10)).toBe('2027-05-01');
  });

  it('un evento en processing reciente responde 409 sin aplicar; viejo (>5 min) se retoma', async () => {
    ctx.state.events.set('E1', { status: 'processing', claimedAt: NOW - 60_000 });
    const busy = await hook(ctx, saleEvent('E1'));
    expect(busy.status).toBe(409);
    expect(ctx.state.subs[0].paid_until).toBeNull();

    ctx.state.events.set('E1', { status: 'processing', claimedAt: NOW - 6 * 60_000 });
    const retaken = await hook(ctx, saleEvent('E1'));
    expect(retaken.status).toBe(200);
    expect(ctx.state.subs[0].status).toBe('active');
    expect(ctx.state.events.get('E1')?.status).toBe('done');
  });

  it('un corte tras acreditar la venta, antes de marcar done, no duplica al reintentar', async () => {
    const complete = ctx.db.completeEvent;
    ctx.db.completeEvent = async () => {
      throw new Error('corte');
    };
    expect((await hook(ctx, saleEvent('E1', 'I-1', 'completed', 'SALE-A'))).status).toBe(502);
    expect(ctx.state.events.has('E1')).toBe(false);
    const first = ctx.state.subs[0].paid_until;
    ctx.db.completeEvent = complete;
    expect((await hook(ctx, saleEvent('E1', 'I-1', 'completed', 'SALE-A'))).status).toBe(200);
    expect(ctx.state.subs[0].paid_until).toBe(first);
  });

  it('suscripción desconocida: 503, no se marca done y el evento queda libre para reintentar', async () => {
    const res = await hook(ctx, saleEvent('E1', 'I-NO-EXISTE'));
    expect(res.status).toBe(503);
    expect(ctx.state.events.has('E1')).toBe(false);
    // Cuando la fila aparece, el reintento se aplica
    seedSub(ctx, { id: 'late', paypal_subscription_id: 'I-NO-EXISTE' });
    expect((await hook(ctx, saleEvent('E1', 'I-NO-EXISTE'))).status).toBe(200);
    expect(ctx.state.subs[1].status).toBe('active');
    // También para eventos de suscripción
    expect((await hook(ctx, subEvent('E2', 'BILLING.SUBSCRIPTION.CANCELLED', 'I-OTRA'))).status).toBe(503);
  });
});

describe('webhook: eventos fuera de orden (B2)', () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = setup();
    seedSub(ctx);
  });

  it('un evento más viejo que el último aplicado no cambia el estado', async () => {
    await hook(ctx, withTime(subEvent('E1', 'BILLING.SUBSCRIPTION.CANCELLED'), '2026-11-01T12:10:00Z'));
    expect(ctx.state.subs[0].status).toBe('cancelled');
    const res = await hook(ctx, withTime(subEvent('E2', 'BILLING.SUBSCRIPTION.SUSPENDED'), '2026-11-01T12:05:00Z'));
    expect(res.status).toBe(200);
    expect(ctx.state.subs[0].status).toBe('cancelled');
    expect(ctx.state.events.get('E2')?.status).toBe('done');
  });

  it('un cobro fallido anterior al pago ya aplicado no lo degrada a grace, pero el pago siempre se acredita', async () => {
    await hook(ctx, withTime(saleEvent('E1'), '2026-11-01T12:00:00Z'));
    await hook(ctx, withTime(subEvent('E2', 'BILLING.SUBSCRIPTION.PAYMENT.FAILED'), '2026-11-01T11:59:00Z'));
    expect(ctx.state.subs[0].status).toBe('active');
    // Un pago con tiempo viejo llega tarde: se suma igual
    await hook(ctx, withTime(saleEvent('E3'), '2026-10-01T00:00:00Z'));
    expect(ctx.state.subs[0].paid_until?.slice(0, 10)).toBe('2027-05-01');
  });

  it('ACTIVATED más nuevo sobre una suspendida la vuelve active; uno más viejo no', async () => {
    await hook(ctx, withTime(saleEvent('E1'), '2026-11-01T12:00:00Z'));
    await hook(ctx, withTime(subEvent('E2', 'BILLING.SUBSCRIPTION.SUSPENDED'), '2026-11-02T00:00:00Z'));
    expect(ctx.state.subs[0].status).toBe('suspended');
    await hook(ctx, withTime(subEvent('E3', 'BILLING.SUBSCRIPTION.ACTIVATED'), '2026-11-01T23:00:00Z'));
    expect(ctx.state.subs[0].status).toBe('suspended');
    await hook(ctx, withTime(subEvent('E4', 'BILLING.SUBSCRIPTION.ACTIVATED'), '2026-11-03T00:00:00Z'));
    expect(ctx.state.subs[0].status).toBe('active');
  });

  it('ACTIVATED sobre una suspendida sin ningún pago no abre acceso', async () => {
    seedSub(ctx, { id: 'sp', paypal_subscription_id: 'I-SP', status: 'suspended' });
    await hook(ctx, subEvent('E1', 'BILLING.SUBSCRIPTION.ACTIVATED', 'I-SP'));
    expect(ctx.state.subs[1].status).toBe('pending');
  });
});

describe('webhook: reembolsos, reversos y denegados (M2)', () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = setup();
    seedSub(ctx);
  });

  it('reembolso total resta el periodo de esa venta y conserva el de otras', async () => {
    await hook(ctx, saleEvent('E1', 'I-1', 'completed', 'SALE-A'));
    await hook(ctx, saleEvent('E2', 'I-1', 'completed', 'SALE-B'));
    expect(ctx.state.subs[0].paid_until?.slice(0, 10)).toBe('2027-05-01');
    const res = await hook(ctx, refundEvent('E3', 'SALE-A', '27.00'));
    expect(res.status).toBe(200);
    expect(ctx.state.subs[0].paid_until?.slice(0, 10)).toBe('2027-02-01');
    expect(ctx.state.profiles.get(PROFILE)).toEqual({ plan_id: 'plus', plan_expires_at: ctx.state.subs[0].paid_until });
    expect(await accessOf(ctx)).toBe(true);
    // El mismo reembolso con otro id de evento no resta dos veces
    await hook(ctx, refundEvent('E4', 'SALE-A', '27.00'));
    expect(ctx.state.subs[0].paid_until?.slice(0, 10)).toBe('2027-02-01');
  });

  it('reembolso total del único pago deja sin acceso y devuelve el perfil al plan por defecto', async () => {
    await hook(ctx, saleEvent('E1', 'I-1', 'completed', 'SALE-A'));
    await hook(ctx, refundEvent('E2', 'SALE-A', '27.00'));
    expect(await accessOf(ctx)).toBe(false);
    expect(ctx.state.subs[0].status).toBe('expired');
    expect(ctx.state.profiles.get(PROFILE)).toEqual({ plan_id: 'basico', plan_expires_at: null });
  });

  it('reembolsos parciales solo se registran; acumulados hasta el total sí restan', async () => {
    await hook(ctx, saleEvent('E1', 'I-1', 'completed', 'SALE-A'));
    const before = ctx.state.subs[0].paid_until;
    await hook(ctx, refundEvent('E2', 'SALE-A', '5.00'));
    expect(ctx.state.subs[0].paid_until).toBe(before);
    expect(ctx.state.subs[0].status).toBe('active');
    expect(await accessOf(ctx)).toBe(true);
    await hook(ctx, refundEvent('E3', 'SALE-A', '22.00'));
    expect(await accessOf(ctx)).toBe(false);
  });

  it('reverso/contracargo: resta el periodo y marca la suscripción suspendida', async () => {
    await hook(ctx, saleEvent('E1', 'I-1', 'completed', 'SALE-A'));
    await hook(ctx, saleEvent('E2', 'I-1', 'completed', 'SALE-B'));
    await hook(ctx, reversedEvent('E3', 'SALE-B'));
    expect(ctx.state.subs[0].status).toBe('suspended');
    expect(ctx.state.subs[0].paid_until?.slice(0, 10)).toBe('2027-02-01');
    expect(await accessOf(ctx)).toBe(true);
  });

  it('reverso del único pago: sin acceso', async () => {
    await hook(ctx, saleEvent('E1', 'I-1', 'completed', 'SALE-A'));
    await hook(ctx, reversedEvent('E2', 'SALE-A'));
    expect(await accessOf(ctx)).toBe(false);
    expect(ctx.state.profiles.get(PROFILE)?.plan_id).toBe('basico');
  });

  it('el periodo nunca queda por debajo de ahora', async () => {
    await hook(ctx, saleEvent('E1', 'I-1', 'completed', 'SALE-A'));
    ctx.state.now = Date.parse('2026-12-15T00:00:00Z');
    await hook(ctx, reversedEvent('E2', 'SALE-A'));
    expect(Date.parse(ctx.state.subs[0].paid_until as string)).toBeGreaterThanOrEqual(ctx.state.now);
  });

  it('reembolso de una venta desconocida: 503 y el evento queda libre para reintentar', async () => {
    const res = await hook(ctx, refundEvent('E1', 'SALE-NO', '27.00'));
    expect(res.status).toBe(503);
    expect(ctx.state.events.has('E1')).toBe(false);
  });

  it('PAYMENT.SALE.DENIED se trata como un cobro fallido (grace)', async () => {
    await hook(ctx, saleEvent('E1'));
    const res = await hook(ctx, { id: 'E2', event_type: 'PAYMENT.SALE.DENIED', resource: { id: 'SALE-D', billing_agreement_id: 'I-1', state: 'denied' } });
    expect(res.status).toBe(200);
    expect(ctx.state.subs[0].status).toBe('grace');
    expect(await accessOf(ctx)).toBe(true);
  });
});

describe('subscribe: guardas (M1, B4)', () => {
  let ctx: Ctx;
  const created = () => ctx.sim.calls.filter((c) => c.url.endsWith('/v1/billing/subscriptions') && c.method === 'POST').length;
  const cancelCalls = () => ctx.sim.calls.filter((c) => c.url.endsWith('/cancel')).map((c) => c.url.split('/').slice(-2)[0]);
  const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();
  beforeEach(() => {
    ctx = setup();
    ctx.state.settings.set('paypal_synced_env', 'sandbox');
    ctx.state.prices.push({ id: 'b', plan_id: 'plus', months: 3, price_usd: 27, active: true, paypal_plan_id: 'P-3', archived: false });
  });
  const subscribe = () => ctx.call('subscribe', 'POST', { planId: 'plus', months: 3, flow: 'sdk' });

  it('entorno sin sincronizar o distinto -> 404 sin crear nada en PayPal', async () => {
    ctx.state.settings.set('paypal_synced_env', 'live');
    expect((await subscribe()).status).toBe(404);
    ctx.state.settings.delete('paypal_synced_env');
    expect((await subscribe()).status).toBe(404);
    expect(created()).toBe(0);
  });

  it.each([
    ['active', { status: 'active', paid_until: '2027-02-01T12:00:00.000Z' }],
    ['grace', { status: 'grace', paid_until: '2027-02-01T12:00:00.000Z' }],
    ['suspended con acceso', { status: 'suspended', paid_until: '2027-02-01T12:00:00.000Z' }],
    ['suspended sin acceso', { status: 'suspended', paid_until: '2026-01-01T00:00:00.000Z' }],
    ['cancelled aún pagada', { status: 'cancelled', paid_until: '2027-02-01T12:00:00.000Z' }],
    ['pending reciente', { status: 'pending', started_at: hoursAgo(0.5) }],
  ] as [string, Partial<SubscriptionRow>][])('rechaza con 409 si hay una suscripción %s', async (_name, patch) => {
    // La viva NO es la «actual»: hay otra más reciente ya vencida
    seedSub(ctx, { id: 'old', paypal_subscription_id: 'I-OLD', ...patch });
    seedSub(ctx, { id: 'new', paypal_subscription_id: 'I-NEWER', status: 'expired', paid_until: '2026-01-01T00:00:00.000Z' });
    const res = await subscribe();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('already_subscribed');
    expect(created()).toBe(0);
  });

  it('permite suscribirse con solo cancelled vencida o expired', async () => {
    seedSub(ctx, { id: 'a', paypal_subscription_id: 'I-A', status: 'cancelled', paid_until: '2026-01-01T00:00:00.000Z' });
    seedSub(ctx, { id: 'b', paypal_subscription_id: 'I-B', status: 'expired' });
    expect((await subscribe()).status).toBe(200);
    expect(created()).toBe(1);
  });

  // ---- #2 / #23 / #25: una pending se decide con el estado REAL en PayPal, sea cual sea su antigüedad ----
  const remoteGets = () => ctx.sim.calls.filter((c) => c.method === 'GET' && /\/v1\/billing\/subscriptions\/[^/]+$/.test(c.url)).map((c) => c.url.split('/').pop());

  it('pending reciente con el popup cancelado (APPROVAL_PENDING): se marca cancelled, se cancela en PayPal y se permite la nueva', async () => {
    seedSub(ctx, { id: 'p1', paypal_subscription_id: 'I-P1', status: 'pending', started_at: hoursAgo(0.1) });
    ctx.sim.remoteStatus = 'APPROVAL_PENDING';
    const res = await subscribe();
    expect(res.status).toBe(200);
    expect(ctx.state.subs[0].status).toBe('cancelled');
    expect(cancelCalls()).toEqual(['I-P1']);
    expect(ctx.state.subs[ctx.state.subs.length - 1]).toMatchObject({ paypal_subscription_id: 'I-NEW', status: 'pending' });
  });

  it('pending a exactamente 1 h: se consulta igual que cualquier otra', async () => {
    seedSub(ctx, { id: 'p1', paypal_subscription_id: 'I-P1', status: 'pending', started_at: hoursAgo(1) });
    ctx.sim.remoteStatus = 'APPROVAL_PENDING';
    expect((await subscribe()).status).toBe(200);
    expect(remoteGets()).toContain('I-P1');
    expect(ctx.state.subs[0].status).toBe('cancelled');
  });

  it.each(['APPROVED', 'ACTIVE'])('pending en PayPal %s (ya aprobada/pagada): 409 y NUNCA se cancela en PayPal, ni siquiera si es antigua', async (remote) => {
    seedSub(ctx, { id: 'p1', paypal_subscription_id: 'I-P1', status: 'pending', started_at: hoursAgo(30) });
    ctx.sim.remoteStatus = remote;
    const res = await subscribe();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('already_subscribed');
    expect(cancelCalls()).toEqual([]);
    expect(created()).toBe(0);
    expect(ctx.state.subs[0].status).toBe('pending');
  });

  it('un estado remoto desconocido o SUSPENDED se trata como vivo (conservador)', async () => {
    seedSub(ctx, { id: 'p1', paypal_subscription_id: 'I-P1', status: 'pending', started_at: hoursAgo(5) });
    for (const remote of ['SUSPENDED', 'ALGO_NUEVO', '']) {
      ctx.sim.remoteStatus = remote;
      expect((await subscribe()).status).toBe(409);
    }
    expect(cancelCalls()).toEqual([]);
    expect(created()).toBe(0);
  });

  it('si la consulta a PayPal falla: bloquea con 503 claro, sin crear ni cancelar nada', async () => {
    seedSub(ctx, { id: 'p1', paypal_subscription_id: 'I-P1', status: 'pending', started_at: hoursAgo(5) });
    ctx.sim.getFail.add('I-P1');
    const res = await subscribe();
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('pending_check_failed');
    expect(created()).toBe(0);
    expect(cancelCalls()).toEqual([]);
    expect(ctx.state.subs[0].status).toBe('pending');
  });

  it('una pending que PayPal ya no conoce (404) o está CANCELLED/EXPIRED no cobra: se marca cancelled y se permite la nueva', async () => {
    seedSub(ctx, { id: 'p1', paypal_subscription_id: 'I-P1', status: 'pending', started_at: hoursAgo(5) });
    ctx.sim.getNotFound.add('I-P1');
    expect((await subscribe()).status).toBe(200);
    expect(ctx.state.subs[0].status).toBe('cancelled');
    expect(cancelCalls()).toEqual([]);
    // El perfil ya tiene la nueva pending: se limpia y se prueba CANCELLED remoto
    ctx.state.subs.pop();
    seedSub(ctx, { id: 'p2', paypal_subscription_id: 'I-P2', status: 'pending', started_at: hoursAgo(5) });
    ctx.sim.remoteStatusById['I-P2'] = 'CANCELLED';
    expect((await subscribe()).status).toBe(200);
    expect(ctx.state.subs.find((s) => s.id === 'p2')?.status).toBe('cancelled');
    expect(cancelCalls()).toEqual([]);
  });

  it('limpieza de varias pending antiguas: cancela solo las abandonadas; si una está aprobada, nada se cancela y se bloquea', async () => {
    seedSub(ctx, { id: 'p1', paypal_subscription_id: 'I-P1', status: 'pending', started_at: hoursAgo(2) });
    seedSub(ctx, { id: 'p2', paypal_subscription_id: 'I-P2', status: 'pending', started_at: hoursAgo(30) });
    ctx.sim.remoteStatusById['I-P1'] = 'APPROVAL_PENDING';
    ctx.sim.remoteStatusById['I-P2'] = 'ACTIVE';
    const res = await subscribe();
    expect(res.status).toBe(409);
    expect(cancelCalls()).toEqual([]);
    expect(ctx.state.subs.map((s) => s.status)).toEqual(['pending', 'pending']);

    ctx.sim.remoteStatusById['I-P2'] = 'APPROVAL_PENDING';
    expect((await subscribe()).status).toBe(200);
    expect(cancelCalls().sort()).toEqual(['I-P1', 'I-P2']);
    expect(ctx.state.subs.filter((s) => s.paypal_subscription_id.startsWith('I-P')).map((s) => s.status)).toEqual(['cancelled', 'cancelled']);
    expect(ctx.state.subs[ctx.state.subs.length - 1]).toMatchObject({ paypal_subscription_id: 'I-NEW', status: 'pending' });
  });

  it('si falla cancelar en PayPal una pending abandonada, el alta sigue y la fila local queda cancelled', async () => {
    seedSub(ctx, { id: 'p1', paypal_subscription_id: 'I-P1', status: 'pending', started_at: hoursAgo(2) });
    ctx.sim.remoteStatus = 'APPROVAL_PENDING';
    ctx.sim.cancelFail.add('I-P1');
    const res = await subscribe();
    expect(res.status).toBe(200);
    expect(ctx.state.subs[0].status).toBe('cancelled');
    expect(created()).toBe(1);
  });

  it('concurrencia (#25): si el índice único salta al insertar (23505), 409 already_subscribed y se cancela la suscripción recién creada en PayPal', async () => {
    ctx.db.insertSubscription = async () => {
      throw new DuplicateSubscriptionError();
    };
    const res = await subscribe();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('already_subscribed');
    expect(cancelCalls()).toEqual(['I-NEW']);
  });

  it('el memoryDb replica el índice único parcial: dos vivas del mismo perfil no caben, una cancelled sí', async () => {
    const row = { profile_id: PROFILE, plan_id: 'plus', months: 3, price_usd: 27, paypal_subscription_id: 'I-A', status: 'pending' as const, started_at: new Date(NOW).toISOString() };
    await ctx.db.insertSubscription(row);
    await expect(ctx.db.insertSubscription({ ...row, paypal_subscription_id: 'I-B' })).rejects.toBeInstanceOf(DuplicateSubscriptionError);
    ctx.state.subs[0].status = 'cancelled';
    await expect(ctx.db.insertSubscription({ ...row, paypal_subscription_id: 'I-B' })).resolves.toBeUndefined();
  });
});

describe('cancel: todas las filas no terminales (M1)', () => {
  let ctx: Ctx;
  const cancelCalls = () => ctx.sim.calls.filter((c) => c.url.endsWith('/cancel')).map((c) => c.url.split('/').slice(-2)[0]);
  beforeEach(() => {
    ctx = setup();
  });

  it('cancela active, suspended y pending; deja intactas las terminales', async () => {
    seedSub(ctx, { id: '1', paypal_subscription_id: 'I-1', status: 'active', paid_until: '2027-02-01T12:00:00.000Z' });
    seedSub(ctx, { id: '2', paypal_subscription_id: 'I-2', status: 'suspended', paid_until: '2027-01-01T12:00:00.000Z' });
    seedSub(ctx, { id: '3', paypal_subscription_id: 'I-3', status: 'pending' });
    seedSub(ctx, { id: '4', paypal_subscription_id: 'I-4', status: 'expired' });
    seedSub(ctx, { id: '5', paypal_subscription_id: 'I-5', status: 'cancelled' });
    const res = await ctx.call('cancel', 'POST');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ cancelled: 3, failed: 0 });
    expect(cancelCalls().sort()).toEqual(['I-1', 'I-2', 'I-3']);
    expect(ctx.state.subs.map((s) => s.status)).toEqual(['cancelled', 'cancelled', 'cancelled', 'expired', 'cancelled']);
  });

  it('informa de las que fallaron y cancela el resto; si fallan todas, error', async () => {
    seedSub(ctx, { id: '1', paypal_subscription_id: 'I-1', status: 'active', paid_until: '2027-02-01T12:00:00.000Z' });
    seedSub(ctx, { id: '2', paypal_subscription_id: 'I-2', status: 'pending' });
    ctx.sim.cancelFail.add('I-2');
    const res = await ctx.call('cancel', 'POST');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ cancelled: 1, failed: 1 });
    expect(ctx.state.subs.map((s) => s.status)).toEqual(['cancelled', 'pending']);
    ctx.sim.cancelFail.add('I-1');
    ctx.state.subs[0].status = 'active';
    expect((await ctx.call('cancel', 'POST')).status).toBe(502);
  });

  it('sin filas no terminales -> 409', async () => {
    seedSub(ctx, { status: 'expired' });
    expect((await ctx.call('cancel', 'POST')).status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Revisión del gate (0051)
// ---------------------------------------------------------------------------

type AdminCursorLike = { updatedAt: string; id: string | null };
const logText = () => (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c.join(' ')).join('\n');

describe('reembolso parcial idempotente por refund_id (#3)', () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = setup();
    seedSub(ctx);
  });

  it('el mismo reembolso parcial reenviado con otro event.id NO se acumula hasta parecer total', async () => {
    await hook(ctx, saleEvent('E1', 'I-1', 'completed', 'SALE-A'));
    await hook(ctx, refundEvent('E2', 'SALE-A', '15.00', 'REF-1'));
    await hook(ctx, refundEvent('E3', 'SALE-A', '15.00', 'REF-1'));
    expect(ctx.state.sales.get('SALE-A')?.refunded).toBe(15);
    expect(await accessOf(ctx)).toBe(true);
    expect(ctx.state.subs[0].status).toBe('active');
  });

  it('dos reembolsos parciales distintos sí se acumulan hasta el total', async () => {
    await hook(ctx, saleEvent('E1', 'I-1', 'completed', 'SALE-A'));
    await hook(ctx, refundEvent('E2', 'SALE-A', '15.00', 'REF-1'));
    await hook(ctx, refundEvent('E3', 'SALE-A', '12.00', 'REF-2'));
    expect(await accessOf(ctx)).toBe(false);
  });

  it('el handler manda resource.id del REFUNDED como refundId; en el reverso manda un id no vacío', async () => {
    const calls: { refundId: string; reversal: boolean }[] = [];
    const original = ctx.db.reverseSale;
    ctx.db.reverseSale = async (input) => (calls.push({ refundId: input.refundId, reversal: input.reversal }), original(input));
    await hook(ctx, saleEvent('E1', 'I-1', 'completed', 'SALE-A'));
    await hook(ctx, refundEvent('E2', 'SALE-A', '5.00', 'REF-9'));
    await hook(ctx, reversedEvent('E3', 'SALE-A'));
    expect(calls[0]).toEqual({ refundId: 'REF-9', reversal: false });
    expect(calls[1]).toMatchObject({ reversal: true });
    expect(calls[1].refundId).toBeTruthy();
  });

  it('un reembolso sin resource.id usa un id derivado del evento (event-<id>)', async () => {
    await hook(ctx, saleEvent('E1', 'I-1', 'completed', 'SALE-A'));
    const noId = { id: 'E2', event_type: 'PAYMENT.SALE.REFUNDED', resource: { sale_id: 'SALE-A', amount: { total: '5.00', currency: 'USD' } } };
    expect((await hook(ctx, noId)).status).toBe(200);
    expect([...ctx.state.refunds.keys()]).toEqual(['event-E2']);
  });
});

describe('reembolsos de ventas no registradas (#4)', () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = setup();
    seedSub(ctx);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('reciente: 503 y reintento; con más de 72 h se da por hecho (done) y se registra un aviso sin datos sensibles', async () => {
    const fresh = await hook(ctx, withTime(refundEvent('E1', 'SALE-LEGACY', '27.00'), '2026-10-31T12:00:00Z'));
    expect(fresh.status).toBe(503);
    expect(ctx.state.events.has('E1')).toBe(false);

    const old = await hook(ctx, withTime(refundEvent('E2', 'SALE-LEGACY', '27.00'), '2026-10-28T11:00:00Z'));
    expect(old.status).toBe(200);
    expect(ctx.state.events.get('E2')?.status).toBe('done');
    expect(logText()).toMatch(/72 h/);
    expect(logText()).not.toContain('SALE-LEGACY');
  });

  it('un reverso de una venta desconocida de más de 72 h también se descarta', async () => {
    const res = await hook(ctx, withTime(reversedEvent('E1', 'SALE-LEGACY'), '2026-10-01T00:00:00Z'));
    expect(res.status).toBe(200);
    expect(ctx.state.events.get('E1')?.status).toBe('done');
  });
});

describe('admin-subscriptions: cursor compuesto (#5)', () => {
  let ctx: Ctx;
  const get = (query: Record<string, string> = {}) => handlePaypalWithQuery(ctx, query);
  beforeEach(() => {
    ctx = setup();
  });
  const tied = (n: number) => {
    // 3 marcas de updated_at repetidas entre las filas, con precisión de microsegundos
    const stamps = ['2026-10-01T10:00:00.123456+00:00', '2026-10-01T10:00:00.123789+00:00', '2026-10-02T10:00:00.000000+00:00'];
    for (let i = 0; i < n; i++) ctx.state.subs.push({ ...(seedSubRow(i) as SubscriptionRow), id: `id-${String(i).padStart(4, '0')}`, updated_at: stamps[i % 3] } as SubscriptionRow);
  };

  it('recorre 450 filas con empates de updated_at sin perder ni repetir ninguna', async () => {
    tied(450);
    const seen: string[] = [];
    let before: string | undefined;
    for (let page = 0; page < 5; page++) {
      const body = (await get(before ? { before } : {})).body as { subscriptions: { id: string }[]; nextBefore: string | null };
      seen.push(...body.subscriptions.map((s) => s.id));
      if (!body.nextBefore) break;
      expect(body.nextBefore).toMatch(/\|id-\d{4}$/);
      before = body.nextBefore;
    }
    expect(seen).toHaveLength(450);
    expect(new Set(seen).size).toBe(450);
  });

  it('nextBefore conserva el updated_at sin truncar a milisegundos', async () => {
    tied(201);
    const body = (await get()).body as { nextBefore: string };
    expect(body.nextBefore.split('|')[0]).toMatch(/\.\d{6}\+00:00$/);
  });

  it('el cursor llega a la base de datos tal cual (updated_at e id)', async () => {
    const seen: (AdminCursorLike | null)[] = [];
    const original = ctx.db.adminSubscriptions;
    ctx.db.adminSubscriptions = async (limit, before) => (seen.push(before), original(limit, before));
    await get({ before: '2026-10-01T10:00:00.123456+00:00|id-0007' });
    expect(seen[0]).toEqual({ updatedAt: '2026-10-01T10:00:00.123456+00:00', id: 'id-0007' });
  });

  it('compatibilidad: un ISO simple sigue valiendo (sin id)', async () => {
    const seen: (AdminCursorLike | null)[] = [];
    const original = ctx.db.adminSubscriptions;
    ctx.db.adminSubscriptions = async (limit, before) => (seen.push(before), original(limit, before));
    expect((await get({ before: '2026-10-01T10:00:00Z' })).status).toBe(200);
    expect(seen[0]).toMatchObject({ id: null });
    expect(seen[0]?.updatedAt).toContain('2026-10-01T10:00:00');
  });

  it.each(['no-es-fecha', 'x|y', '2026-10-01T10:00:00Z|', '|id-1', '2026-10-01T10:00:00Z|a,b', '2026-10-01T10:00:00Z|id)(or', '2026-10-01T10:00:00Z|id|otro'])('cursor inválido %j -> 400 bad_before', async (before) => {
    const res = await get({ before });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('bad_before');
  });
});

describe('codeAccess con muchos suscriptores de pago (#6)', () => {
  it('con más de 200 suscriptores de pago que vencen antes, los accesos por código siguen apareciendo', async () => {
    const ctx = setup();
    ctx.asAdmin();
    for (let i = 0; i < 250; i++) {
      const id = `paid-${i}`;
      ctx.state.profiles.set(id, { plan_id: 'plus', plan_expires_at: `2026-12-${String(1 + (i % 20)).padStart(2, '0')}T00:00:00.000Z` });
      ctx.state.subs.push({ ...(seedSubRow(i) as SubscriptionRow), id: `s-${i}`, profile_id: id, paypal_subscription_id: `I-PAID${i}`, status: 'active', paid_until: '2027-06-01T00:00:00.000Z' });
    }
    ctx.state.profiles.set('code-1', { plan_id: 'plus', plan_expires_at: '2027-03-01T00:00:00.000Z' });
    ctx.state.profiles.set('code-2', { plan_id: 'plus', plan_expires_at: '2027-04-01T00:00:00.000Z' });
    const body = (await ctx.call('admin-subscriptions', 'GET')).body as { codeAccess: { profileId: string }[] };
    expect(body.codeAccess.map((c) => c.profileId)).toEqual(['code-1', 'code-2']);
  });
});

describe('reverso/contracargo cancela en PayPal (#7)', () => {
  let ctx: Ctx;
  const cancelCalls = () => ctx.sim.calls.filter((c) => c.url.endsWith('/cancel')).map((c) => c.url.split('/').slice(-2)[0]);
  beforeEach(() => {
    ctx = setup();
    seedSub(ctx);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('tras aplicar un reverso, además de suspended local, cancela la suscripción en PayPal', async () => {
    await hook(ctx, saleEvent('E0', 'I-1', 'completed', 'SALE-B'));
    await hook(ctx, saleEvent('E1', 'I-1', 'completed', 'SALE-A'));
    await hook(ctx, reversedEvent('E2', 'SALE-A'));
    expect(ctx.state.subs[0].status).toBe('suspended');
    expect(cancelCalls()).toEqual(['I-1']);
  });

  it('un fallo al cancelar en PayPal se registra sin datos sensibles y no tumba el aviso', async () => {
    await hook(ctx, saleEvent('E0', 'I-1', 'completed', 'SALE-B'));
    await hook(ctx, saleEvent('E1', 'I-1', 'completed', 'SALE-A'));
    ctx.sim.cancelFail.add('I-1');
    const res = await hook(ctx, reversedEvent('E2', 'SALE-A'));
    expect(res.status).toBe(200);
    expect(ctx.state.events.get('E2')?.status).toBe('done');
    expect(ctx.state.subs[0].status).toBe('suspended');
    expect(logText()).toMatch(/reverso/);
    expect(logText()).not.toContain('secreto-de-prueba');
  });

  it('un reembolso total NO cancela la suscripción', async () => {
    await hook(ctx, saleEvent('E1', 'I-1', 'completed', 'SALE-A'));
    await hook(ctx, refundEvent('E2', 'SALE-A', '27.00'));
    expect(cancelCalls()).toEqual([]);
  });
});

describe('moneda e importes (#10)', () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = setup();
    seedSub(ctx);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());
  const eur = (id: string, saleId: string) => ({ id, event_type: 'PAYMENT.SALE.COMPLETED', resource: { id: saleId, billing_agreement_id: 'I-1', state: 'completed', amount: { total: '25.00', currency: 'EUR' } } });

  it('una venta en otra moneda acredita el periodo igual, avisa en el log y no guarda un importe comparable', async () => {
    const res = await hook(ctx, eur('E1', 'SALE-EUR'));
    expect(res.status).toBe(200);
    expect(ctx.state.subs[0].status).toBe('active');
    expect(ctx.state.subs[0].paid_until?.slice(0, 10)).toBe('2027-02-01');
    expect(ctx.state.sales.get('SALE-EUR')?.amount).toBeNull();
    expect(logText()).toMatch(/moneda/);
  });

  it('una venta sin importe también acredita, con aviso', async () => {
    const res = await hook(ctx, { id: 'E1', event_type: 'PAYMENT.SALE.COMPLETED', resource: { id: 'SALE-X', billing_agreement_id: 'I-1', state: 'completed' } });
    expect(res.status).toBe(200);
    expect(ctx.state.subs[0].status).toBe('active');
    expect(logText()).toMatch(/importe/);
  });

  it('un reembolso de una venta en EUR nunca se toma por total, aunque la cifra coincida', async () => {
    await hook(ctx, eur('E1', 'SALE-EUR'));
    await hook(ctx, refundEvent('E2', 'SALE-EUR', '25.00', 'REF-1', 'EUR'));
    expect(await accessOf(ctx)).toBe(true);
    expect(ctx.state.sales.get('SALE-EUR')?.reversed).toBe(false);
  });

  it('un reembolso en EUR de una venta en USD no cuenta para el total', async () => {
    await hook(ctx, saleEvent('E1', 'I-1', 'completed', 'SALE-A'));
    await hook(ctx, refundEvent('E2', 'SALE-A', '27.00', 'REF-1', 'EUR'));
    expect(ctx.state.sales.get('SALE-A')?.refunded).toBe(0);
    expect(await accessOf(ctx)).toBe(true);
  });

  it.each(['abc', '-5.00', '', 'NaN', '1e999'])('importe de reembolso %j no es un reembolso (se ignora y se registra)', async (total) => {
    await hook(ctx, saleEvent('E1', 'I-1', 'completed', 'SALE-A'));
    const res = await hook(ctx, refundEvent('E2', 'SALE-A', total, 'REF-1'));
    expect(res.status).toBe(200);
    expect(ctx.state.refunds.size).toBe(0);
    expect(ctx.state.sales.get('SALE-A')?.refunded).toBe(0);
    expect(await accessOf(ctx)).toBe(true);
    expect(logText()).toMatch(/importe/);
  });

  it('un reembolso sin amount tampoco cuenta', async () => {
    await hook(ctx, saleEvent('E1', 'I-1', 'completed', 'SALE-A'));
    const res = await hook(ctx, { id: 'E2', event_type: 'PAYMENT.SALE.REFUNDED', resource: { id: 'REF-1', sale_id: 'SALE-A' } });
    expect(res.status).toBe(200);
    expect(ctx.state.refunds.size).toBe(0);
  });
});

describe('fidelidad del memoryDb con 0050/0051 (#12)', () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = setup();
    seedSub(ctx);
  });

  it('un reverso más viejo que el último evento NO suspende ni mueve last_event_time (pero sí resta el periodo)', async () => {
    await hook(ctx, withTime(saleEvent('E1', 'I-1', 'completed', 'SALE-A'), '2026-11-01T12:00:00Z'));
    await hook(ctx, withTime(saleEvent('E2', 'I-1', 'completed', 'SALE-B'), '2026-11-01T12:30:00Z'));
    const last = ctx.state.subs[0].last_event_time;
    await hook(ctx, withTime(reversedEvent('E3', 'SALE-A'), '2026-11-01T12:10:00Z'));
    expect(ctx.state.subs[0].status).toBe('active');
    expect(ctx.state.subs[0].last_event_time).toBe(last);
    expect(ctx.state.subs[0].paid_until?.slice(0, 10)).toBe('2027-02-01');
  });

  it('un reverso más nuevo sí suspende y mueve last_event_time', async () => {
    await hook(ctx, withTime(saleEvent('E1', 'I-1', 'completed', 'SALE-A'), '2026-11-01T12:00:00Z'));
    await hook(ctx, withTime(saleEvent('E0', 'I-1', 'completed', 'SALE-B'), '2026-11-01T12:00:00Z'));
    await hook(ctx, withTime(reversedEvent('E2', 'SALE-A'), '2026-11-01T13:00:00Z'));
    expect(ctx.state.subs[0].status).toBe('suspended');
    expect(ctx.state.subs[0].last_event_time).toBe('2026-11-01T13:00:00.000Z');
  });

  it('invalid_sale: un id de venta vacío o de más de 100 caracteres lanza en applyPayment', async () => {
    const base = { paypalSubscriptionId: 'I-1', amount: 1, currency: 'USD', eventTime: '2026-11-01T12:00:00.000Z' };
    await expect(ctx.db.applyPayment({ ...base, saleId: '' })).rejects.toThrow('invalid_sale');
    await expect(ctx.db.applyPayment({ ...base, saleId: '   ' })).rejects.toThrow('invalid_sale');
    await expect(ctx.db.applyPayment({ ...base, saleId: 'x'.repeat(101) })).rejects.toThrow('invalid_sale');
    await expect(ctx.db.applyPayment({ ...base, saleId: 'x'.repeat(100) })).resolves.toBe('applied');
  });

  it('un event.id de 100 caracteres sin id de venta no rompe el crédito: la clave derivada cabe en 100', async () => {
    const longId = 'E'.repeat(100);
    const ev = { id: longId, event_type: 'PAYMENT.SALE.COMPLETED', resource: { billing_agreement_id: 'I-1', state: 'completed', amount: { total: '27.00', currency: 'USD' } } };
    expect((await hook(ctx, ev)).status).toBe(200);
    expect(ctx.state.subs[0].status).toBe('active');
  });
});

describe('bordes (#14)', () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = setup();
    seedSub(ctx);
  });

  it('pago sin resource.id: la venta se registra como event-<id> y reenviar el mismo evento no duplica', async () => {
    const ev = { id: 'E7', event_type: 'PAYMENT.SALE.COMPLETED', resource: { billing_agreement_id: 'I-1', state: 'completed', amount: { total: '27.00', currency: 'USD' } } };
    await hook(ctx, ev);
    expect([...ctx.state.sales.keys()]).toEqual(['event-E7']);
    await hook(ctx, ev);
    expect(ctx.state.subs[0].paid_until?.slice(0, 10)).toBe('2027-02-01');
  });

  it('plan archivado con suscripción activa que renueva: el pago se acredita igual', async () => {
    await hook(ctx, saleEvent('E1'));
    ctx.state.plansArchived.add('plus');
    await hook(ctx, saleEvent('E2'));
    expect(ctx.state.subs[0].status).toBe('active');
    expect(ctx.state.subs[0].paid_until?.slice(0, 10)).toBe('2027-05-01');
    expect(ctx.state.profiles.get(PROFILE)?.plan_id).toBe('plus');
  });

  it('paidUntil === ahora: sin acceso', async () => {
    ctx.state.subs[0].status = 'active';
    ctx.state.subs[0].paid_until = new Date(NOW).toISOString();
    expect(await accessOf(ctx)).toBe(false);
  });
});

describe('isPaypalCertUrl (#14)', () => {
  it.each([
    ['https://api.paypal.com/v1/notifications/certs/C', true],
    ['https://API.PayPal.com/cert', true],
    ['https://api-m.sandbox.paypal.com/c?x=1#frag', true],
    ['https://api.paypal.com./cert', false],
    ['https://api.paypal.com@evil.example/cert', false],
    ['https://evil.example@api.paypal.com/cert', false],
    ['https://evil.example#@api.paypal.com/cert', false],
    ['https://evil.example/@api.paypal.com', false],
    ['https://api.paypal.com:443/cert', true],
    ['https://api.paypal.com:8443/cert', false],
    ['http://api.paypal.com/cert', false],
    ['https://www.paypal.com/cert', false],
    ['', false],
  ])('%s -> %s', (url, expected) => {
    expect(isPaypalCertUrl(url)).toBe(expected);
  });
});

describe('MigrationMissingError (#20)', () => {
  it('el mensaje no señala solo la 0046: nombra el rango de cobro 0046 a 0051', async () => {
    const ctx = setup();
    const { MigrationMissingError } = await import('../server/integrations/store');
    ctx.db.currentSubscription = async () => {
      throw new MigrationMissingError();
    };
    const res = await ctx.call('status', 'GET');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('migration_missing');
    expect(JSON.stringify(res.body)).toMatch(/0046 a 0051/);
  });
});
