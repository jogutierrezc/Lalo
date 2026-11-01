/**
 * tests/paypalLogic.test.ts
 *
 * Reglas puras del cobro: meses de calendario, suma desde fecha futura o vencida,
 * transición de cada evento de PayPal, acceso y ahorro.
 */

import { describe, expect, it } from 'vitest';
import {
  addMonths,
  applyTransition,
  hasAccess,
  isFullRefund,
  isStaleEvent,
  paidUntilAfterPayment,
  paidUntilAfterReversal,
  pendingVerdict,
  redeemRefusal,
  savingPercent,
  statusAfterPayment,
  subscribeBlock,
  transitionFor,
  type SubState,
} from '../server/paypal/logic';

const d = (iso: string) => new Date(iso);
const iso = (date: Date) => date.toISOString().slice(0, 10);

describe('addMonths', () => {
  it('31 de enero + 1 mes cae a fin de febrero', () => {
    expect(iso(addMonths(d('2027-01-31T10:00:00Z'), 1))).toBe('2027-02-28');
  });
  it('año bisiesto: 29 de febrero y 31 de enero', () => {
    expect(iso(addMonths(d('2028-01-31T10:00:00Z'), 1))).toBe('2028-02-29');
    expect(iso(addMonths(d('2028-02-29T10:00:00Z'), 12))).toBe('2029-02-28');
  });
  it('cruza de año y conserva la hora', () => {
    expect(addMonths(d('2026-11-15T08:30:00Z'), 3).toISOString()).toBe('2027-02-15T08:30:00.000Z');
  });
  it('no modifica la fecha original', () => {
    const base = d('2026-05-31T00:00:00Z');
    addMonths(base, 1);
    expect(iso(base)).toBe('2026-05-31');
  });
});

describe('paidUntilAfterPayment', () => {
  const now = d('2026-11-01T12:00:00Z');
  it('sin fecha previa suma desde ahora', () => {
    expect(iso(paidUntilAfterPayment(null, 3, now))).toBe('2027-02-01');
  });
  it('si aún hay plan, suma desde el vencimiento: pagar antes no pierde días', () => {
    expect(iso(paidUntilAfterPayment(d('2026-12-10T00:00:00Z'), 3, now))).toBe('2027-03-10');
  });
  it('si ya venció, suma desde ahora', () => {
    expect(iso(paidUntilAfterPayment(d('2026-09-01T00:00:00Z'), 1, now))).toBe('2026-12-01');
  });
});

describe('transitionFor', () => {
  it('pago completado usa billing_agreement_id', () => {
    expect(transitionFor('PAYMENT.SALE.COMPLETED', { billing_agreement_id: 'I-1', state: 'completed' })).toEqual({ kind: 'payment', subscriptionId: 'I-1', saleId: '', amount: null, currency: null });
  });
  it('un pago no completado o sin suscripción se ignora', () => {
    expect(transitionFor('PAYMENT.SALE.COMPLETED', { billing_agreement_id: 'I-1', state: 'pending' }).kind).toBe('ignore');
    expect(transitionFor('PAYMENT.SALE.COMPLETED', { state: 'completed' }).kind).toBe('ignore');
  });
  it('eventos de suscripción usan resource.id', () => {
    const cases: [string, string][] = [
      ['BILLING.SUBSCRIPTION.ACTIVATED', 'activated'],
      ['BILLING.SUBSCRIPTION.PAYMENT.FAILED', 'failed'],
      ['BILLING.SUBSCRIPTION.CANCELLED', 'cancelled'],
      ['BILLING.SUBSCRIPTION.SUSPENDED', 'suspended'],
      ['BILLING.SUBSCRIPTION.EXPIRED', 'expired'],
    ];
    for (const [type, kind] of cases) expect(transitionFor(type, { id: 'I-2' })).toEqual({ kind, subscriptionId: 'I-2' });
  });
  it('eventos desconocidos o recursos raros se ignoran', () => {
    expect(transitionFor('CATALOG.PRODUCT.CREATED', { id: 'x' }).kind).toBe('ignore');
    expect(transitionFor('BILLING.SUBSCRIPTION.CANCELLED', null).kind).toBe('ignore');
  });
});

describe('applyTransition', () => {
  const now = d('2026-11-01T12:00:00Z');
  const pending: SubState = { status: 'pending', months: 3, paidUntil: null, lastPaymentAt: null };
  const active: SubState = { status: 'active', months: 3, paidUntil: d('2027-02-01T12:00:00Z'), lastPaymentAt: now };
  const t = (kind: string) => ({ kind, subscriptionId: 'I-1' }) as Parameters<typeof applyTransition>[1];

  it('ACTIVATED no da plan ni acceso', () => {
    const out = applyTransition(pending, t('activated'), now);
    expect(out.status).toBe('pending');
    expect(out.grantPlan).toBe(false);
    expect(hasAccess(out, now)).toBe(false);
  });
  it('ACTIVATED tras un pago que llegó antes no degrada el estado', () => {
    expect(applyTransition(active, t('activated'), now).status).toBe('active');
  });
  it('el pago activa, suma el periodo y da el plan', () => {
    const out = applyTransition(pending, t('payment'), now);
    expect(out.status).toBe('active');
    expect(out.grantPlan).toBe(true);
    expect(iso(out.paidUntil as Date)).toBe('2027-02-01');
    expect(hasAccess(out, now)).toBe(true);
  });
  it('un segundo pago suma desde el vencimiento', () => {
    expect(iso(applyTransition(active, t('payment'), now).paidUntil as Date)).toBe('2027-05-01');
  });
  it('cobro fallido: grace y conserva acceso hasta paid_until', () => {
    const out = applyTransition(active, t('failed'), now);
    expect(out.status).toBe('grace');
    expect(hasAccess(out, now)).toBe(true);
  });
  it('cancelada y suspendida conservan acceso hasta paid_until, y no después', () => {
    for (const kind of ['cancelled', 'suspended']) {
      const out = applyTransition(active, t(kind), now);
      expect(out.status).toBe(kind);
      expect(hasAccess(out, now)).toBe(true);
      expect(hasAccess(out, d('2027-02-02T00:00:00Z'))).toBe(false);
    }
  });
  it('cancelada antes de pagar no abre nada', () => {
    expect(hasAccess(applyTransition(pending, t('cancelled'), now), now)).toBe(false);
  });
  it('expirada', () => {
    expect(applyTransition(active, t('expired'), now).status).toBe('expired');
  });
});

describe('savingPercent', () => {
  it('calcula el ahorro frente al mes suelto', () => {
    expect(savingPercent(10, 27, 3)).toBe(10);
    expect(savingPercent(10, 100, 12)).toBe(17);
  });
  it('0 sin base, a 1 mes o si no ahorra', () => {
    expect(savingPercent(null, 27, 3)).toBe(0);
    expect(savingPercent(10, 10, 1)).toBe(0);
    expect(savingPercent(10, 35, 3)).toBe(0);
  });
});

describe('transitionFor: ventas, reembolsos y reversos', () => {
  it('el pago lleva el id de la venta, el importe y la moneda', () => {
    expect(transitionFor('PAYMENT.SALE.COMPLETED', { id: 'S-1', billing_agreement_id: 'I-1', state: 'completed', amount: { total: '27.00', currency: 'USD' } })).toEqual({
      kind: 'payment',
      subscriptionId: 'I-1',
      saleId: 'S-1',
      amount: 27,
      currency: 'USD',
    });
  });
  it('DENIED es un cobro fallido de la suscripción', () => {
    expect(transitionFor('PAYMENT.SALE.DENIED', { id: 'S-1', billing_agreement_id: 'I-1', state: 'denied' })).toEqual({ kind: 'failed', subscriptionId: 'I-1' });
    expect(transitionFor('PAYMENT.SALE.DENIED', { id: 'S-1' }).kind).toBe('ignore');
  });
  it('REFUNDED usa sale_id y el importe reembolsado; sin sale_id se ignora', () => {
    expect(transitionFor('PAYMENT.SALE.REFUNDED', { id: 'R-1', sale_id: 'S-1', amount: { total: '5.00', currency: 'USD' } })).toEqual({ kind: 'refund', saleId: 'S-1', refundId: 'R-1', subscriptionId: null, amount: 5, currency: 'USD' });
    expect(transitionFor('PAYMENT.SALE.REFUNDED', { id: 'R-1' }).kind).toBe('ignore');
  });
  it('REVERSED usa sale_id, o id a falta de él', () => {
    expect(transitionFor('PAYMENT.SALE.REVERSED', { id: 'V-1', sale_id: 'S-1', billing_agreement_id: 'I-1' })).toEqual({ kind: 'reversal', saleId: 'S-1', subscriptionId: 'I-1' });
    expect(transitionFor('PAYMENT.SALE.REVERSED', { id: 'S-2' })).toEqual({ kind: 'reversal', saleId: 'S-2', subscriptionId: null });
    expect(transitionFor('PAYMENT.SALE.REVERSED', {}).kind).toBe('ignore');
  });
});

describe('applyTransition: activated sobre suspendida, reverso', () => {
  const now = d('2026-11-01T12:00:00Z');
  const paid: SubState = { status: 'suspended', months: 3, paidUntil: d('2027-02-01T12:00:00Z'), lastPaymentAt: now };
  const t = (kind: string) => ({ kind, subscriptionId: 'I-1' }) as Parameters<typeof applyTransition>[1];
  it('ACTIVATED sobre una suspendida con pago la vuelve active; sin pago, pending', () => {
    expect(applyTransition(paid, t('activated'), now).status).toBe('active');
    expect(applyTransition({ ...paid, paidUntil: null }, t('activated'), now).status).toBe('pending');
  });
  it('el reverso suspende, salvo cancelada o expirada', () => {
    const rev = { kind: 'reversal', subscriptionId: 'I-1', saleId: 'S' } as Parameters<typeof applyTransition>[1];
    expect(applyTransition({ ...paid, status: 'active' }, rev, now).status).toBe('suspended');
    expect(applyTransition({ ...paid, status: 'cancelled' }, rev, now).status).toBe('cancelled');
    expect(applyTransition({ ...paid, status: 'expired' }, rev, now).status).toBe('expired');
  });
});

describe('paidUntilAfterReversal / isFullRefund', () => {
  const now = d('2026-11-01T12:00:00Z');
  it('resta el periodo acreditado', () => {
    expect(iso(paidUntilAfterReversal(d('2027-05-01T12:00:00Z'), 3, now))).toBe('2027-02-01');
  });
  it('nunca queda por debajo de ahora, ni sin vencimiento previo', () => {
    expect(paidUntilAfterReversal(d('2026-12-01T12:00:00Z'), 3, now).getTime()).toBe(now.getTime());
    expect(paidUntilAfterReversal(null, 3, now).getTime()).toBe(now.getTime());
  });
  it('reembolso total solo si lo acumulado alcanza el importe conocido', () => {
    expect(isFullRefund(27, 27)).toBe(true);
    expect(isFullRefund(27, 5)).toBe(false);
    expect(isFullRefund(null, 100)).toBe(false);
  });
  it('#10: exige moneda coincidente (USD); otra moneda o sin moneda nunca es total', () => {
    expect(isFullRefund(27, 27, 'USD')).toBe(true);
    expect(isFullRefund(27, 27, 'usd')).toBe(true);
    expect(isFullRefund(27, 27, 'EUR')).toBe(false);
    expect(isFullRefund(27, 27, null)).toBe(false);
  });
  it('#14: reverso a fin de mes: 2027-03-31 menos 1 mes cae al 28 de febrero', () => {
    expect(iso(paidUntilAfterReversal(d('2027-03-31T12:00:00Z'), 1, d('2026-11-01T12:00:00Z')))).toBe('2027-02-28');
    expect(iso(paidUntilAfterReversal(d('2028-03-31T12:00:00Z'), 1, d('2026-11-01T12:00:00Z')))).toBe('2028-02-29');
  });
});

describe('isStaleEvent / statusAfterPayment', () => {
  const t1 = d('2026-11-01T10:00:00Z');
  const t2 = d('2026-11-01T11:00:00Z');
  it('solo es viejo si es estrictamente anterior al último', () => {
    expect(isStaleEvent(t1, t2)).toBe(true);
    expect(isStaleEvent(t2, t2)).toBe(false);
    expect(isStaleEvent(t1, null)).toBe(false);
  });
  it('un pago activa; uno viejo no reabre una suspendida; una cancelada sigue cancelada; pending siempre se activa', () => {
    expect(statusAfterPayment('pending', t2, t1)).toBe('active');
    expect(statusAfterPayment('suspended', t2, t1)).toBe('suspended');
    expect(statusAfterPayment('suspended', t1, t2)).toBe('active');
    expect(statusAfterPayment('cancelled', null, t2)).toBe('cancelled');
  });
});

describe('subscribeBlock', () => {
  const now = d('2026-11-01T12:00:00Z');
  const sub = (status: SubState['status'], extra: { startedAt?: Date; paidUntil?: Date | null } = {}) => ({ status, startedAt: d('2026-11-01T11:30:00Z'), paidUntil: null, ...extra });
  it('bloquea active, grace, suspended, cancelled pagada y pending reciente', () => {
    expect(subscribeBlock([sub('active', { paidUntil: d('2027-01-01T00:00:00Z') })], now)).toBe('active');
    expect(subscribeBlock([sub('grace')], now)).toBe('active');
    expect(subscribeBlock([sub('suspended')], now)).toBe('suspended');
    expect(subscribeBlock([sub('cancelled', { paidUntil: d('2027-01-01T00:00:00Z') })], now)).toBe('paid');
  });
  it('no bloquea cancelled vencida ni expired', () => {
    expect(subscribeBlock([sub('cancelled', { paidUntil: d('2026-01-01T00:00:00Z') }), sub('expired')], now)).toBeNull();
  });
  it('mira todas las filas, no solo una', () => {
    expect(subscribeBlock([sub('expired'), sub('pending', { startedAt: d('2026-10-01T00:00:00Z') }), sub('active')], now)).toBe('active');
  });
  it('#2: una pending ya no bloquea por antigüedad (ni a 1 h exacta): lo decide el estado real en PayPal', () => {
    expect(subscribeBlock([sub('pending', { startedAt: d('2026-11-01T11:30:00Z') })], now)).toBeNull();
    expect(subscribeBlock([sub('pending', { startedAt: d('2026-11-01T11:00:00Z') })], now)).toBeNull();
    expect(subscribeBlock([sub('pending', { startedAt: d('2026-10-01T00:00:00Z') })], now)).toBeNull();
  });
});

describe('redeemRefusal: paysNow cubre cancelled y suspended pagadas (B6)', () => {
  const now = d('2026-11-01T12:00:00Z');
  const base = { profileStatus: 'active', hasTwitch: true, planId: 'basico', planExpiresAt: null, defaultPlanId: 'basico', alreadyRedeemed: false, now };
  it.each(['cancelled', 'suspended'] as const)('%s con periodo vigente -> has_paid_plan; vencida -> nada', (status) => {
    expect(redeemRefusal({ ...base, subscriptions: [{ status, paidUntil: d('2027-01-01T00:00:00Z') }] })).toBe('has_paid_plan');
    expect(redeemRefusal({ ...base, subscriptions: [{ status, paidUntil: d('2026-01-01T00:00:00Z') }] })).toBeNull();
  });
});

describe('pendingVerdict (#2)', () => {
  it('solo APPROVAL_PENDING es un intento abandonado que se puede cancelar', () => {
    expect(pendingVerdict('APPROVAL_PENDING')).toBe('abandoned');
  });
  it('CANCELLED y EXPIRED no cobran: se limpian sin cancelar nada', () => {
    expect(pendingVerdict('CANCELLED')).toBe('gone');
    expect(pendingVerdict('EXPIRED')).toBe('gone');
  });
  it('APPROVED, ACTIVE, SUSPENDED y cualquier estado desconocido o vacío son vivos (nunca se cancelan)', () => {
    for (const status of ['APPROVED', 'ACTIVE', 'SUSPENDED', 'NUEVO_ESTADO', '', undefined, null]) expect(pendingVerdict(status as string)).toBe('live');
  });
});

describe('bordes de calendario y acceso (#14)', () => {
  it('addMonths con 0 no cambia la fecha y con negativos retrocede respetando fin de mes', () => {
    expect(addMonths(d('2026-11-30T10:00:00Z'), 0).toISOString()).toBe('2026-11-30T10:00:00.000Z');
    expect(iso(addMonths(d('2027-03-31T10:00:00Z'), -1))).toBe('2027-02-28');
    expect(iso(addMonths(d('2026-01-31T10:00:00Z'), -2))).toBe('2025-11-30');
    expect(iso(addMonths(d('2026-02-15T10:00:00Z'), -12))).toBe('2025-02-15');
  });
  it('29 de febrero bisiesto: +12 cae al 28; +48 vuelve al 29; -12 cae al 28', () => {
    expect(iso(addMonths(d('2028-02-29T10:00:00Z'), 12))).toBe('2029-02-28');
    expect(iso(addMonths(d('2028-02-29T10:00:00Z'), 48))).toBe('2032-02-29');
    expect(iso(addMonths(d('2028-02-29T10:00:00Z'), -12))).toBe('2027-02-28');
  });
  it('paidUntil exactamente ahora: sin acceso (estricto); un ms después, con acceso', () => {
    const now = d('2026-11-01T12:00:00Z');
    expect(hasAccess({ status: 'active', paidUntil: now }, now)).toBe(false);
    expect(hasAccess({ status: 'active', paidUntil: new Date(now.getTime() + 1) }, now)).toBe(true);
  });
  it('un pago con paidUntil === ahora suma desde ahora, no desde el vencimiento', () => {
    const now = d('2026-11-01T12:00:00Z');
    expect(iso(paidUntilAfterPayment(now, 1, now))).toBe('2026-12-01');
  });
});

describe('transitionFor: importes y monedas (#10)', () => {
  const sale = (amount: unknown) => transitionFor('PAYMENT.SALE.COMPLETED', { id: 'S', billing_agreement_id: 'I-1', state: 'completed', amount });
  const refund = (amount: unknown) => transitionFor('PAYMENT.SALE.REFUNDED', { id: 'R-1', sale_id: 'S', amount });
  it('la moneda se normaliza a mayúsculas', () => {
    expect(sale({ total: '27.00', currency: 'usd' })).toMatchObject({ kind: 'payment', amount: 27, currency: 'USD' });
  });
  it('una venta con importe raro conserva el pago (la suscripción manda) pero sin importe', () => {
    for (const total of ['abc', '-1', '', undefined]) expect(sale({ total, currency: 'USD' })).toMatchObject({ kind: 'payment', amount: null });
    expect(sale(null)).toMatchObject({ kind: 'payment', amount: null, currency: null });
  });
  it('un reembolso con importe no numérico, vacío, negativo o ausente se ignora con motivo', () => {
    for (const amount of [{ total: 'abc', currency: 'USD' }, { total: '-5', currency: 'USD' }, { total: '', currency: 'USD' }, { total: 'NaN', currency: 'USD' }, { total: '1e999', currency: 'USD' }, {}, null, undefined]) {
      expect(refund(amount)).toEqual({ kind: 'ignore', subscriptionId: null, reason: 'bad_refund_amount' });
    }
  });
  it('un reembolso válido lleva importe, moneda y refundId (vacío si el aviso no trae id)', () => {
    expect(refund({ total: '5.50', currency: 'eur' })).toEqual({ kind: 'refund', saleId: 'S', refundId: 'R-1', subscriptionId: null, amount: 5.5, currency: 'EUR' });
    expect(transitionFor('PAYMENT.SALE.REFUNDED', { sale_id: 'S', amount: { total: '1', currency: 'USD' } })).toMatchObject({ refundId: '' });
  });
});
