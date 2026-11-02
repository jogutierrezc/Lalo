/**
 * tests/paymentsLogic.test.ts
 *
 * Lógica pura del historial de pagos (src/lib/paymentsLogic.ts) y lectura del cliente (paymentsApi.ts).
 */

import { describe, expect, it } from 'vitest';
import { formatMoney, groupPaymentsByMonth, netAmount, paymentConcept, paymentStatusLabel, receiptNumber, saleStatus, shortHash } from '../src/lib/paymentsLogic';
import { parsePayments, type PaymentRow } from '../src/lib/paymentsApi';

const row = (over: Partial<PaymentRow>): PaymentRow => ({ id: 'x', receipt: 'R', date: '2026-11-01T00:00:00Z', concept: 'c', amount: 10, currency: 'USD', status: 'paid', refundedAmount: 0, ...over });

describe('recibo', () => {
  it('es estable, lleva el año UTC de la venta y no contiene el id de la venta', () => {
    const a = receiptNumber('SALE-123ABC', '2026-12-31T23:30:00Z');
    expect(a).toBe(receiptNumber('SALE-123ABC', '2026-12-31T23:30:00Z'));
    expect(a).toMatch(/^R-2026-[0-9A-F]{8}$/);
    expect(a).not.toContain('SALE-123ABC');
    expect(receiptNumber('SALE-OTHER', '2026-12-31T23:30:00Z')).not.toBe(a);
  });
  it('shortHash siempre da 8 caracteres hexadecimales', () => {
    expect(shortHash('')).toMatch(/^[0-9A-F]{8}$/);
    expect(shortHash('legacy-0000')).toMatch(/^[0-9A-F]{8}$/);
  });
});

describe('estado y concepto', () => {
  it('un reverso manda sobre un reembolso, y este sobre pagado', () => {
    expect(saleStatus({ reversedAt: '2026-11-02', refundedAmount: 5 })).toBe('reversed');
    expect(saleStatus({ reversedAt: null, refundedAmount: 5 })).toBe('refunded');
    expect(saleStatus({ reversedAt: null, refundedAmount: 0 })).toBe('paid');
  });
  it('concepto en singular y plural', () => {
    expect(paymentConcept('Pro', 3)).toBe('Plan Pro · 3 meses');
    expect(paymentConcept('Pro', 1)).toBe('Plan Pro · 1 mes');
  });
  it('etiquetas en español y formato de importe', () => {
    expect(paymentStatusLabel('refunded')).toBe('Reembolsado');
    expect(formatMoney(27, 'USD')).toBe('USD 27.00');
    expect(formatMoney(null, 'USD')).toBe('—');
  });
  it('importe neto: pagado menos reembolsado; 0 si se revirtió o falló', () => {
    expect(netAmount(row({ amount: 27, refundedAmount: 10, status: 'refunded' }))).toBe(17);
    expect(netAmount(row({ status: 'reversed' }))).toBe(0);
    expect(netAmount(row({ status: 'failed' }))).toBe(0);
  });
});

describe('agrupación', () => {
  it('por mes UTC, el más reciente primero, conservando el orden dentro del mes', () => {
    const groups = groupPaymentsByMonth([row({ id: 'a', date: '2026-11-05T00:00:00Z' }), row({ id: 'b', date: '2026-11-01T00:00:00Z' }), row({ id: 'c', date: '2026-09-30T00:00:00Z' })]);
    expect(groups.map((g) => g.month)).toEqual(['2026-11', '2026-09']);
    expect(groups[0].rows.map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('parsePayments', () => {
  it('descarta filas sin id o fecha, normaliza estados desconocidos y el próximo cobro', () => {
    const out = parsePayments({
      payments: [{ id: 'R-1', date: '2026-11-01T00:00:00Z', status: 'raro', amount: 5 }, { date: 'x' }, null],
      nextCharge: { date: '2026-12-01T00:00:00Z', amount: 9, concept: 'Plan Pro · 1 mes' },
    });
    expect(out.payments).toHaveLength(1);
    expect(out.payments[0]).toMatchObject({ status: 'pending', currency: 'USD', receipt: null, refundedAmount: 0 });
    expect(out.nextCharge).toEqual({ date: '2026-12-01T00:00:00Z', amount: 9, currency: 'USD', concept: 'Plan Pro · 1 mes' });
    expect(parsePayments({}).nextCharge).toBeNull();
  });
});
