/**
 * tests/paypalLogic.test.ts
 *
 * Reglas puras del cobro: meses de calendario, suma desde fecha futura o vencida,
 * transición de cada evento de PayPal, acceso y ahorro.
 */

import { describe, expect, it } from 'vitest';
import { addMonths, applyTransition, hasAccess, paidUntilAfterPayment, savingPercent, transitionFor, type SubState } from '../server/paypal/logic';

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
    expect(transitionFor('PAYMENT.SALE.COMPLETED', { billing_agreement_id: 'I-1', state: 'completed' })).toEqual({ kind: 'payment', subscriptionId: 'I-1' });
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
