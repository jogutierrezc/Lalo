/** Lectores tolerantes de billingApi: nunca lanzan con JSON incompleto y hasAccess solo es true estricto. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const net = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../src/lib/integrationsApi', () => ({ call: net.call }));

import {
  adminSubscriptions,
  billingStatus,
  billingSubscribe,
  parseAdminPrices,
  parseAdminSubscriptions,
  parseCatalog,
  parseStatus,
} from '../../src/lib/billingApi';

describe('parseCatalog', () => {
  it('vacío: sin planes, sandbox, deshabilitado', () => {
    expect(parseCatalog({})).toEqual({ enabled: false, env: 'sandbox', clientId: '', plans: [] });
  });
  it('descarta planes sin id, rellena nombre y precios no válidos a null', () => {
    const c = parseCatalog({
      enabled: true,
      env: 'live',
      clientId: 'abc',
      plans: [null, 'x', { name: 'sin id' }, { id: 'pro', prices: { '1': 5, '3': -1, '6': 'x', '12': NaN } }],
    });
    expect(c.enabled).toBe(true);
    expect(c.env).toBe('live');
    expect(c.plans).toEqual([{ id: 'pro', name: 'pro', prices: { '1': 5, '3': null, '6': null, '12': null } }]);
  });
  it('enabled solo con true estricto y env raro cae a sandbox', () => {
    expect(parseCatalog({ enabled: 'true', env: 'prod' })).toMatchObject({ enabled: false, env: 'sandbox' });
    expect(parseCatalog({ enabled: 1 }).enabled).toBe(false);
  });
  it('plans que no es lista no rompe', () => {
    expect(parseCatalog({ plans: 'no' }).plans).toEqual([]);
  });
});

describe('parseStatus y hasAccess', () => {
  it('hasAccess true solo con true', () => expect(parseStatus({ hasAccess: true }).hasAccess).toBe(true));
  it.each(['true', 1, 'yes', {}, [], null, undefined, 0])('hasAccess %j no cuenta', (v) => {
    expect(parseStatus({ hasAccess: v }).hasAccess).toBe(false);
  });
  it('sin suscripción', () => {
    expect(parseStatus({})).toEqual({ subscription: null, hasAccess: false });
    expect(parseStatus({ subscription: 'x' }).subscription).toBeNull();
  });
  it('estado desconocido cae a expired, meses por defecto 1, fechas vacías a null', () => {
    const s = parseStatus({ subscription: { status: 'rara', planId: 'pro', paidUntil: '', months: 'x' } }).subscription!;
    expect(s).toMatchObject({ status: 'expired', planId: 'pro', planName: 'pro', months: 1, paidUntil: null, lastPaymentAt: null, startedAt: null });
  });
  it('conserva un estado y fechas válidos', () => {
    const s = parseStatus({ subscription: { status: 'active', planId: 'p', planName: 'Pro', months: 6, paidUntil: '2026-01-01T00:00:00Z' } }).subscription!;
    expect(s).toMatchObject({ status: 'active', planName: 'Pro', months: 6, paidUntil: '2026-01-01T00:00:00Z' });
  });
});

describe('parseAdminPrices', () => {
  it('vacío', () => expect(parseAdminPrices({})).toEqual({ synced: false, plans: [] }));
  it('completa las cuatro celdas aunque falten y respeta flags estrictos', () => {
    const r = parseAdminPrices({
      synced: 'yes',
      plans: [{ id: 'pro', archived: 'true', prices: { '1': { priceUsd: 4, active: true, paypalPlanId: 'P-1' }, '3': { priceUsd: 0, active: 1 } } }, { name: 'x' }],
    });
    expect(r.synced).toBe(false);
    expect(r.plans).toHaveLength(1);
    const p = r.plans[0];
    expect(p.archived).toBe(false);
    expect(p.prices['1']).toEqual({ priceUsd: 4, active: true, paypalPlanId: 'P-1' });
    expect(p.prices['3']).toEqual({ priceUsd: null, active: false, paypalPlanId: null });
    expect(p.prices['12']).toEqual({ priceUsd: null, active: false, paypalPlanId: null });
  });
});

describe('parseAdminSubscriptions', () => {
  it('vacío', () => {
    expect(parseAdminSubscriptions({})).toEqual({
      subscriptions: [],
      totals: { active: 0, grace: 0, cancelled: 0, suspended: 0, expired: 0, pending: 0 },
      codeAccess: [],
      nextBefore: null,
    });
  });
  it('filtra filas sin id y accesos sin perfil o sin vencimiento; totales no numéricos a 0', () => {
    const r = parseAdminSubscriptions({
      subscriptions: [{ id: 's1', status: 'zzz', priceUsd: 'x' }, { status: 'active' }, null],
      totals: { active: 3, grace: 'x', pending: NaN },
      codeAccess: [{ profileId: 'p1', expiresAt: '2026-02-01' }, { profileId: 'p2' }, { expiresAt: '2026-02-01' }],
      nextBefore: '2026-01-01',
    });
    expect(r.subscriptions).toHaveLength(1);
    expect(r.subscriptions[0]).toMatchObject({ id: 's1', status: 'expired', priceUsd: 0, months: 1 });
    expect(r.totals).toMatchObject({ active: 3, grace: 0, pending: 0 });
    expect(r.codeAccess.map((c) => c.profileId)).toEqual(['p1']);
    expect(r.nextBefore).toBe('2026-01-01');
  });
});

describe('llamadas', () => {
  beforeEach(() => {
    net.call.mockReset();
  });

  it('un cuerpo ilegible se vuelve bad_response, no una excepción', async () => {
    net.call.mockResolvedValue({ ok: true, data: null });
    expect(await billingStatus()).toMatchObject({ ok: false, code: 'bad_response' });
  });
  it('propaga el error del servidor tal cual', async () => {
    net.call.mockResolvedValue({ ok: false, code: 'already_subscribed', message: 'Ya tienes una suscripción activa.', missing: [] });
    expect(await billingStatus()).toMatchObject({ ok: false, code: 'already_subscribed' });
  });
  it('billingSubscribe: flujo sdk solo necesita subscriptionId; redirect exige approveUrl', async () => {
    net.call.mockResolvedValue({ ok: true, data: { subscriptionId: 'I-1' } });
    expect(await billingSubscribe('pro', 1, 'sdk')).toMatchObject({ ok: true, data: { subscriptionId: 'I-1' } });
    expect(await billingSubscribe('pro', 1)).toMatchObject({ ok: false, code: 'bad_response' });
    net.call.mockResolvedValue({ ok: true, data: { approveUrl: 'https://x' } });
    expect(await billingSubscribe('pro', 1, 'sdk')).toMatchObject({ ok: false, code: 'bad_response' });
  });
  it('adminSubscriptions codifica el cursor', async () => {
    net.call.mockResolvedValue({ ok: true, data: {} });
    await adminSubscriptions('2026-01-01T00:00:00+00:00');
    expect(net.call.mock.calls[0][0]).toBe('/api/paypal/admin-subscriptions?before=2026-01-01T00%3A00%3A00%2B00%3A00');
    await adminSubscriptions();
    expect(net.call.mock.calls[1][0]).toBe('/api/paypal/admin-subscriptions');
  });
});
