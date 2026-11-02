/**
 * tests/paypalReports.test.ts
 *
 * Rutas payments, admin-inbox, admin-inbox-resolve y admin-billing-summary con bases simuladas:
 * autenticación (el creador solo ve lo suyo, admin-* exige administrador), forma de las respuestas,
 * resolver idempotente y AUSENCIA de datos sensibles (ids de PayPal, payload) hacia el creador.
 */

import { describe, expect, it } from 'vitest';
import { defaultDeps, type Deps, type IntegrationRequest } from '../server/integrations/http';
import { handlePaypal } from '../server/paypal/handlers';
import type { PaypalDb, SubscriptionRow } from '../server/paypal/db';
import type { EventRecord, InboxSubRecord, ReportsDb, SaleRecord } from '../server/paypal/reportsDb';

const ME = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-2222-3333-4444-555555555555';
const ADMIN = 'aaaaaaaa-2222-3333-4444-555555555555';
const NOW = Date.parse('2026-11-10T12:00:00Z');
const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service' };
const iso = (days: number, minutes = 0) => new Date(NOW + days * 86400000 + minutes * 60000).toISOString();

const mySub: SubscriptionRow = {
  id: 'sub-me',
  profile_id: ME,
  plan_id: 'pro',
  months: 3,
  price_usd: 27,
  paypal_subscription_id: 'I-SECRETO-ME',
  status: 'active',
  started_at: iso(-60),
  paid_until: iso(30),
  last_payment_at: iso(-60),
};
const otherSub: SubscriptionRow = { ...mySub, id: 'sub-other', profile_id: OTHER, paypal_subscription_id: 'I-SECRETO-OTHER' };

const sale = (over: Partial<SaleRecord>): SaleRecord => ({
  sale_id: 'SALE-SECRETA-1',
  created_at: iso(-30),
  amount: 27,
  currency: 'USD',
  refunded_amount: 0,
  reversed_at: null,
  months: 3,
  plan_id: 'pro',
  plan_name: 'Pro',
  profile_id: ME,
  twitch_login: 'canal_me',
  display_name: 'Canal Me',
  paypal_subscription_id: 'I-SECRETO-ME',
  ...over,
});

function setup(opts: { sales?: SaleRecord[]; events?: EventRecord[]; subs?: InboxSubRecord[]; resolved?: string[] } = {}) {
  const sales = opts.sales ?? [sale({}), sale({ sale_id: 'SALE-SECRETA-2', created_at: iso(-90), refunded_amount: 10 }), sale({ sale_id: 'SALE-AJENA', profile_id: OTHER, display_name: 'Ajeno', paypal_subscription_id: 'I-SECRETO-OTHER' })];
  const events: EventRecord[] = opts.events ?? [
    { paypal_event_id: 'WH-EVENTO-SECRETO', type: 'PAYMENT.FAILED', subscription_id: 'I-SECRETO-ME', status: 'done', claimed_at: iso(-3), processed_at: iso(-3) },
    { paypal_event_id: 'WH-AJENO', type: 'PAYMENT.FAILED', subscription_id: 'I-SECRETO-OTHER', status: 'done', claimed_at: iso(-3), processed_at: iso(-3) },
  ];
  const resolved = new Set<string>(opts.resolved ?? []);
  const resolveCalls: { key: string; actorId: string; note: string }[] = [];
  const reports: ReportsDb = {
    salesForProfile: async (profileId, limit) => sales.filter((s) => s.profile_id === profileId).slice(0, limit),
    salesSince: async (since) => sales.filter((s) => s.created_at >= since),
    eventsFor: async (ids, type, limit) => events.filter((e) => e.type === type && e.subscription_id && ids.includes(e.subscription_id)).slice(0, limit),
    eventsSince: async (since) => events.filter((e) => e.claimed_at >= since),
    inboxSubscriptions: async () => opts.subs ?? [],
    payingSubscriptions: async () => (opts.subs ?? []).filter((s) => s.status === 'active' || s.status === 'grace'),
    refundsSince: async () => [],
    resolvedKeys: async () => new Set(resolved),
    resolve: async (input) => {
      resolveCalls.push(input);
      if (resolved.has(input.key)) return 'duplicate';
      resolved.add(input.key);
      return 'resolved';
    },
  };
  const db = {
    plans: async () => [{ id: 'pro', name: 'Pro', is_default: false }],
    profileSubscriptions: async (profileId: string) => [mySub, otherSub].filter((s) => s.profile_id === profileId),
    codeAccess: async () => [{ profile_id: 'p9', twitch_login: 'regalado', display_name: null, plan_id: 'pro', plan_name: 'Pro', expires_at: iso(3), invite_code: null }],
  } as unknown as PaypalDb;
  let caller: { id: string; role: string; status: string } = { id: ME, role: 'streamer', status: 'active' };
  const deps: Deps = { ...defaultDeps, now: () => NOW, auth: async () => caller };
  const call = (action: Parameters<typeof handlePaypal>[0], method: string, body?: unknown, query: Record<string, string> = {}) =>
    handlePaypal(action, { method, headers: {}, query, body } as IntegrationRequest, ENV, deps, db, reports);
  return { call, resolveCalls, asAdmin: () => void (caller = { id: ADMIN, role: 'admin', status: 'active' }) };
}

const dbSub = (over: Partial<InboxSubRecord>): InboxSubRecord => ({
  id: 'sub-1',
  paypal_subscription_id: 'I-1',
  status: 'active',
  months: 3,
  price_usd: 27,
  plan_id: 'pro',
  plan_name: 'Pro',
  twitch_login: 'canal_uno',
  display_name: 'Canal Uno',
  paid_until: iso(40),
  started_at: iso(-60),
  updated_at: iso(-1),
  ...over,
});

describe('payments (creador)', () => {
  it('solo devuelve lo suyo: ventas, fallido y próximo cobro, ordenado por fecha desc', async () => {
    const t = setup();
    const res = await t.call('payments', 'GET');
    expect(res.status).toBe(200);
    const body = res.body as { payments: { id: string; receipt: string | null; status: string; amount: number; concept: string; refundedAmount: number; date: string }[]; nextCharge: Record<string, unknown> };
    expect(body.payments.map((p) => p.status)).toEqual(['failed', 'paid', 'refunded']);
    expect(body.payments[1]).toMatchObject({ concept: 'Plan Pro · 3 meses', amount: 27, refundedAmount: 0 });
    expect(body.payments[1].receipt).toMatch(/^R-2026-[0-9A-F]{8}$/);
    expect(body.payments[2].refundedAmount).toBe(10);
    expect(body.payments[0]).toMatchObject({ receipt: null, amount: 27 });
    expect([...body.payments].map((p) => p.date)).toEqual([...body.payments].map((p) => p.date).sort().reverse());
    expect(body.nextCharge).toEqual({ date: mySub.paid_until, amount: 27, currency: 'USD', concept: 'Plan Pro · 3 meses' });
  });

  it('no expone ids de PayPal, ids de venta o de aviso, ni datos de otros creadores', async () => {
    const text = JSON.stringify((await setup().call('payments', 'GET')).body);
    for (const secret of ['SECRETO', 'SALE-', 'WH-', 'I-S', 'Ajeno', 'payload', 'paypal']) expect(text).not.toContain(secret);
  });

  it('un creador sin pagos recibe una lista vacía y sin próximo cobro', async () => {
    const t = setup({ sales: [], events: [] });
    const asOther = handlePaypal('payments', { method: 'GET', headers: {}, query: {}, body: undefined } as IntegrationRequest, ENV, { ...defaultDeps, now: () => NOW, auth: async () => ({ id: 'nuevo', role: 'streamer', status: 'active' }) } as Deps, { plans: async () => [], profileSubscriptions: async () => [] } as unknown as PaypalDb, {
      salesForProfile: async () => [],
      eventsFor: async () => [],
    } as unknown as ReportsDb);
    expect((await asOther).body).toEqual({ payments: [], nextCharge: null });
    expect(t).toBeTruthy();
  });

  it('solo GET', async () => {
    expect((await setup().call('payments', 'POST')).status).toBe(405);
  });

  it('sin sesión devuelve el fallo de autenticación', async () => {
    const res = await handlePaypal('payments', { method: 'GET', headers: {}, query: {}, body: undefined } as IntegrationRequest, ENV, { ...defaultDeps, auth: async () => ({ status: 401, body: { error: 'x' } }) } as unknown as Deps, {} as PaypalDb, {} as ReportsDb);
    expect(res.status).toBe(401);
  });
});

describe('rutas de administrador', () => {
  it.each([
    ['admin-inbox', 'GET'],
    ['admin-inbox-resolve', 'POST'],
    ['admin-billing-summary', 'GET'],
  ] as const)('%s exige administrador', async (action, method) => {
    const res = await setup().call(action, method, { key: 'fail:x:1' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('not_admin');
  });

  it('el método equivocado da 405', async () => {
    const t = setup();
    t.asAdmin();
    expect((await t.call('admin-inbox', 'POST')).status).toBe(405);
    expect((await t.call('admin-inbox-resolve', 'GET')).status).toBe(405);
    expect((await t.call('admin-billing-summary', 'POST')).status).toBe(405);
  });
});

describe('admin-inbox', () => {
  const subs = [dbSub({ id: 'g', paypal_subscription_id: 'I-G', status: 'grace', paid_until: iso(2), display_name: 'Canal Gracia' })];

  it('devuelve ítems por urgencia con historial (tipo + fecha), contadores y el id de PayPal solo para el admin', async () => {
    const t = setup({
      subs,
      events: [
        { paypal_event_id: 'EV-1', type: 'PAYMENT.FAILED', subscription_id: 'I-G', status: 'done', claimed_at: iso(-1), processed_at: iso(-1) },
        { paypal_event_id: 'EV-STUCK', type: 'PAYMENT.SALE.COMPLETED', subscription_id: null, status: 'processing', claimed_at: iso(0, -40), processed_at: null },
      ],
    });
    t.asAdmin();
    const res = await t.call('admin-inbox', 'GET');
    expect(res.status).toBe(200);
    const body = res.body as { items: Record<string, unknown>[]; counts: Record<string, number> };
    expect(body.items.map((i) => i.kind)).toEqual(['fail', 'sys', 'soon']);
    expect(body.counts).toMatchObject({ fail: 1, sys: 1, soon: 1, pending: 0, refund: 0, total: 3 });
    expect(body.items[0]).toMatchObject({ creator: 'Canal Gracia', plan: 'Pro · 3 meses', amount: 27, daysLeft: 2, paypalId: 'I-G', history: [{ type: 'PAYMENT.FAILED', at: iso(-1) }] });
    expect(body.items[2]).toMatchObject({ creator: 'regalado', paypalId: null });
    // Nada de payload ni de datos del pagador
    expect(JSON.stringify(body)).not.toMatch(/payload|payer|email/i);
  });

  it('un ítem resuelto deja de salir', async () => {
    const first = setup({ subs });
    first.asAdmin();
    const key = ((await first.call('admin-inbox', 'GET')).body.items as { key: string }[])[0].key;
    const t = setup({ subs, resolved: [key] });
    t.asAdmin();
    const items = (await t.call('admin-inbox', 'GET')).body.items as { key: string }[];
    expect(items.map((i) => i.key)).not.toContain(key);
  });
});

describe('admin-inbox-resolve', () => {
  const subs = [dbSub({ id: 'g', paypal_subscription_id: 'I-G', status: 'grace', paid_until: iso(2) })];

  it('resuelve un ítem de la bandeja con el administrador como actor y devuelve la bandeja que queda', async () => {
    const t = setup({ subs });
    t.asAdmin();
    const key = ((await t.call('admin-inbox', 'GET')).body.items as { key: string }[])[0].key;
    const res = await t.call('admin-inbox-resolve', 'POST', { key, note: '  Contactado por correo  ' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, key, result: 'resolved' });
    expect((res.body.items as { key: string }[]).map((i) => i.key)).not.toContain(key);
    expect(t.resolveCalls).toEqual([{ key, actorId: ADMIN, note: 'Contactado por correo' }]);
  });

  it('es idempotente: repetir una resolución ya hecha responde 200 sin duplicar efectos', async () => {
    const t = setup({ subs, resolved: ['fail:g:1'] });
    t.asAdmin();
    const res = await t.call('admin-inbox-resolve', 'POST', { key: 'fail:g:1' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('duplicate');
  });

  it('rechaza claves mal formadas (400) y claves que no están en la bandeja (404)', async () => {
    const t = setup({ subs });
    t.asAdmin();
    expect((await t.call('admin-inbox-resolve', 'POST', {})).status).toBe(400);
    expect((await t.call('admin-inbox-resolve', 'POST', { key: "fail:x';drop table" })).status).toBe(400);
    expect((await t.call('admin-inbox-resolve', 'POST', { key: 'a'.repeat(200) })).status).toBe(400);
    expect((await t.call('admin-inbox-resolve', 'POST', { key: 'fail:inexistente:1' })).status).toBe(404);
    expect(t.resolveCalls).toEqual([]);
  });
});

describe('admin-billing-summary', () => {
  it('devuelve ingresos de 6 meses, variación, renovaciones, fallidos, desglose y recibos', async () => {
    const t = setup({
      sales: [
        sale({ sale_id: 'A', created_at: iso(-1), amount: 30 }),
        sale({ sale_id: 'B', created_at: iso(-35), amount: 20 }),
        sale({ sale_id: 'C', created_at: iso(-2), amount: 10, refunded_amount: 10 }),
      ],
      subs: [dbSub({ id: '1', paid_until: iso(10) }), dbSub({ id: '2', status: 'grace', paid_until: iso(2) })],
    });
    t.asAdmin();
    const res = await t.call('admin-billing-summary', 'GET', undefined, { receipts: '2' });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown> & { months: { month: string }[]; receipts: Record<string, unknown>[] };
    expect(body.currency).toBe('USD');
    expect(body.months).toHaveLength(6);
    expect(body.months[5].month).toBe('2026-11');
    expect(body).toMatchObject({ currentRevenue: 30, previousRevenue: 20, variationPct: 50, activeSubscriptions: 1, renewals30: { count: 1, amount: 27 }, failed: { count: 1, pctOfActive: 50 } });
    expect(body.breakdown).toEqual([{ planId: 'pro', planName: 'Pro', months: 3, count: 2, amount: 54 }]);
    expect(body.receipts).toHaveLength(2);
    expect(body.receipts[0]).toMatchObject({ creator: 'Canal Me', concept: 'Plan Pro · 3 meses', amount: 30, status: 'paid' });
    expect(JSON.stringify(body)).not.toMatch(/SECRETA|I-SECRETO/);
  });

  it('acota ?receipts a 50 y cae a 20 si no es válido', async () => {
    const many = Array.from({ length: 60 }, (_, i) => sale({ sale_id: `S${i}`, created_at: iso(-1, -i) }));
    const t = setup({ sales: many });
    t.asAdmin();
    expect(((await t.call('admin-billing-summary', 'GET', undefined, { receipts: '999' })).body.receipts as unknown[]).length).toBe(50);
    expect(((await t.call('admin-billing-summary', 'GET', undefined, { receipts: 'abc' })).body.receipts as unknown[]).length).toBe(20);
  });
});
