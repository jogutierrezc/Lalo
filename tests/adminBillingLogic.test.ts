/**
 * tests/adminBillingLogic.test.ts
 *
 * Lógica pura de la bandeja de pagos y la facturación (src/lib/adminBillingLogic.ts).
 */

import { describe, expect, it } from 'vitest';
import {
  buildBillingSummary,
  classifyInbox,
  inboxCounts,
  inboxKindLabel,
  lastMonths,
  saleNetRevenue,
  sortInbox,
  type ClassifyInput,
  type InboxItem,
  type InboxSub,
  type SummarySale,
} from '../src/lib/adminBillingLogic';
import { parseInbox, parseSummary } from '../src/lib/adminBillingApi';

const NOW = new Date('2026-11-10T12:00:00Z');
const iso = (days: number, minutes = 0) => new Date(NOW.getTime() + days * 86400000 + minutes * 60000).toISOString();

const sub = (over: Partial<InboxSub>): InboxSub => ({
  id: 's1',
  paypalId: 'I-1',
  status: 'active',
  creator: 'Canal Uno',
  planName: 'Pro',
  months: 3,
  priceUsd: 27,
  paidUntil: iso(40),
  startedAt: iso(-60),
  updatedAt: iso(-1),
  ...over,
});

const input = (over: Partial<ClassifyInput>): ClassifyInput => ({ now: NOW, subs: [], codes: [], events: [], refunds: [], resolved: new Set(), ...over });

describe('classifyInbox', () => {
  it('cobro fallido: suscripción en gracia, con días restantes, historial y último PAYMENT.FAILED', () => {
    const items = classifyInbox(
      input({
        subs: [sub({ status: 'grace', paidUntil: iso(3) })],
        events: [
          { id: 'E1', type: 'PAYMENT.FAILED', paypalSubscriptionId: 'I-1', status: 'done', claimedAt: iso(-1), processedAt: iso(-1) },
          { id: 'E0', type: 'PAYMENT.SALE.COMPLETED', paypalSubscriptionId: 'I-1', status: 'done', claimedAt: iso(-90), processedAt: iso(-90) },
          { id: 'EX', type: 'OTRO', paypalSubscriptionId: 'I-2', status: 'done', claimedAt: iso(-1), processedAt: iso(-1) },
        ],
      })
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'fail', creator: 'Canal Uno', plan: 'Pro · 3 meses', amount: 27, daysLeft: 3, paypalId: 'I-1', date: iso(-1) });
    expect(items[0].history.map((h) => h.type)).toEqual(['PAYMENT.FAILED', 'PAYMENT.SALE.COMPLETED']);
    expect(items[0].key).toMatch(/^fail:s1:\d+$/);
  });

  it('pendiente: solo entre 30 minutos y 14 días', () => {
    const kinds = (startedAt: string) => classifyInbox(input({ subs: [sub({ status: 'pending', paidUntil: null, startedAt })] })).map((i) => i.kind);
    expect(kinds(iso(0, -10))).toEqual([]);
    expect(kinds(iso(0, -45))).toEqual(['pending']);
    expect(kinds(iso(-20))).toEqual([]);
  });

  it('vence pronto: cancelada que vence en <= 7 días (no las activas con renovación) y accesos por código o regalo', () => {
    const items = classifyInbox(
      input({
        subs: [sub({ id: 'a', status: 'cancelled', paidUntil: iso(5) }), sub({ id: 'b', status: 'active', paidUntil: iso(2) }), sub({ id: 'c', status: 'cancelled', paidUntil: iso(9) })],
        codes: [
          { profileId: 'p1', creator: 'Con código', planName: 'Plus', expiresAt: iso(2), fromCode: true },
          { profileId: 'p2', creator: 'Regalo', planName: 'Plus', expiresAt: iso(30), fromCode: false },
          { profileId: 'p3', creator: 'Regalo cerca', planName: 'Plus', expiresAt: iso(6), fromCode: false },
        ],
      })
    );
    expect(items.map((i) => [i.kind, i.creator, i.daysLeft])).toEqual([
      ['soon', 'Con código', 2],
      ['soon', 'Canal Uno', 5],
      ['soon', 'Regalo cerca', 6],
    ]);
    expect(items[0].note).toMatch(/código/);
    expect(items[2].note).toMatch(/regalo/);
    expect(items[0].paypalId).toBeNull();
  });

  it('reembolso o contracargo recientes, y suspendida sin duplicar si ya hay reverso de la misma suscripción', () => {
    const items = classifyInbox(
      input({
        subs: [sub({ id: 's9', paypalId: 'I-9', status: 'suspended' }), sub({ id: 's8', paypalId: 'I-8', status: 'suspended' })],
        refunds: [
          { ref: 'REF-1', kind: 'refund', at: iso(-2), amount: 10, currency: 'USD', creator: 'Canal Dos', planName: 'Pro', months: 1, paypalSubscriptionId: 'I-7' },
          { ref: 'SALE-9', kind: 'reversal', at: iso(-1), amount: 27, currency: 'USD', creator: 'Canal Nueve', planName: 'Pro', months: 3, paypalSubscriptionId: 'I-9' },
        ],
      })
    );
    expect(items.filter((i) => i.kind === 'refund')).toHaveLength(3);
    expect(items.filter((i) => i.paypalId === 'I-9')).toHaveLength(1);
    expect(items.find((i) => i.paypalId === 'I-9')?.note).toMatch(/Contracargo/);
    expect(items.find((i) => i.paypalId === 'I-8')?.note).toMatch(/suspendida/);
  });

  it('sys: aviso reclamado hace más de 15 minutos; uno reciente o terminado no cuenta', () => {
    const items = classifyInbox(
      input({
        events: [
          { id: 'EV-OLD', type: 'PAYMENT.SALE.COMPLETED', paypalSubscriptionId: 'I-1', status: 'processing', claimedAt: iso(0, -30), processedAt: null },
          { id: 'EV-NEW', type: 'X', paypalSubscriptionId: null, status: 'processing', claimedAt: iso(0, -5), processedAt: null },
          { id: 'EV-OK', type: 'X', paypalSubscriptionId: null, status: 'done', claimedAt: iso(0, -60), processedAt: iso(0, -59) },
        ],
      })
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'sys', paypalId: 'EV-OLD' });
    expect(items[0].note).toMatch(/30 min/);
  });

  it('los resueltos no aparecen', () => {
    const all = classifyInbox(input({ subs: [sub({ status: 'grace', paidUntil: iso(3) })] }));
    expect(classifyInbox(input({ subs: [sub({ status: 'grace', paidUntil: iso(3) })], resolved: new Set([all[0].key]) }))).toEqual([]);
  });
});

describe('sortInbox e inboxCounts', () => {
  const item = (kind: InboxItem['kind'], daysLeft: number | null, date: string): InboxItem => ({ key: `${kind}:${date}`, kind, creator: 'c', plan: 'p', amount: null, currency: 'USD', date, daysLeft, note: '', history: [], paypalId: null });
  it('tipo (fail, refund, sys, soon, pending), luego menos días y luego lo más reciente', () => {
    const sorted = sortInbox([item('pending', null, '2026-11-01'), item('soon', 5, '2026-11-01'), item('soon', 2, '2026-11-01'), item('sys', null, '2026-11-01'), item('refund', null, '2026-11-02'), item('refund', null, '2026-11-05'), item('fail', 3, '2026-11-01')]);
    expect(sorted.map((i) => [i.kind, i.daysLeft, i.date])).toEqual([
      ['fail', 3, '2026-11-01'],
      ['refund', null, '2026-11-05'],
      ['refund', null, '2026-11-02'],
      ['sys', null, '2026-11-01'],
      ['soon', 2, '2026-11-01'],
      ['soon', 5, '2026-11-01'],
      ['pending', null, '2026-11-01'],
    ]);
  });
  it('cuenta por tipo y en total', () => {
    expect(inboxCounts([{ kind: 'fail' }, { kind: 'fail' }, { kind: 'sys' }])).toEqual({ fail: 2, pending: 0, soon: 0, refund: 0, sys: 1, total: 3 });
    expect(inboxKindLabel('soon')).toBe('Vence pronto');
  });
});

const sale = (over: Partial<SummarySale>): SummarySale => ({ saleId: 'S', createdAt: '2026-11-02T00:00:00Z', amount: 27, currency: 'USD', refundedAmount: 0, reversedAt: null, months: 3, planName: 'Pro', creator: 'Canal', ...over });

describe('facturación', () => {
  it('ingreso neto: resta reembolsos, 0 si se revirtió, ignora otras monedas o sin importe', () => {
    expect(saleNetRevenue(sale({ refundedAmount: 7 }))).toBe(20);
    expect(saleNetRevenue(sale({ reversedAt: '2026-11-03' }))).toBe(0);
    expect(saleNetRevenue(sale({ currency: 'EUR' }))).toBe(0);
    expect(saleNetRevenue(sale({ amount: null }))).toBe(0);
    expect(saleNetRevenue(sale({ amount: 5, refundedAmount: 9 }))).toBe(0);
  });

  it('lastMonths devuelve 6 meses terminando en el actual, cruzando el año', () => {
    expect(lastMonths(new Date('2026-02-10T00:00:00Z'), 6)).toEqual(['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02']);
  });

  it('suma por mes, variación, renovaciones en 30 días, fallidos y desglose', () => {
    const s = buildBillingSummary({
      now: NOW,
      receiptsLimit: 2,
      sales: [
        sale({ saleId: 'A', createdAt: '2026-11-02T00:00:00Z', amount: 30 }),
        sale({ saleId: 'B', createdAt: '2026-11-05T00:00:00Z', amount: 20, refundedAmount: 5 }),
        sale({ saleId: 'C', createdAt: '2026-10-05T00:00:00Z', amount: 25 }),
        sale({ saleId: 'D', createdAt: '2026-10-06T00:00:00Z', amount: 25, reversedAt: '2026-10-07T00:00:00Z' }),
        sale({ saleId: 'E', createdAt: '2025-01-01T00:00:00Z', amount: 99 }),
      ],
      subs: [
        { status: 'active', planId: 'pro', planName: 'Pro', months: 3, priceUsd: 27, paidUntil: iso(10) },
        { status: 'active', planId: 'pro', planName: 'Pro', months: 3, priceUsd: 27, paidUntil: iso(45) },
        { status: 'active', planId: 'plus', planName: 'Plus', months: 1, priceUsd: 9, paidUntil: iso(29) },
        { status: 'grace', planId: 'plus', planName: 'Plus', months: 1, priceUsd: 9, paidUntil: iso(2) },
      ],
    });
    expect(s.months).toHaveLength(6);
    expect(s.currentRevenue).toBe(45);
    expect(s.previousRevenue).toBe(25);
    expect(s.variationPct).toBe(80);
    expect(s.activeSubscriptions).toBe(3);
    expect(s.renewals30).toEqual({ count: 2, amount: 36 });
    expect(s.failed).toEqual({ count: 1, pctOfActive: 25 });
    expect(s.breakdown).toEqual([
      { planId: 'plus', planName: 'Plus', months: 1, count: 2, amount: 18 },
      { planId: 'pro', planName: 'Pro', months: 3, count: 2, amount: 54 },
    ]);
    expect(s.receipts.map((r) => r.status)).toEqual(['refunded', 'paid']);
    expect(s.receipts[0].receipt).toMatch(/^R-2026-/);
    expect(s.receipts[0].concept).toBe('Plan Pro · 3 meses');
  });

  it('variación null si el mes anterior fue 0; porcentaje de fallidos null sin suscripciones', () => {
    const s = buildBillingSummary({ now: NOW, sales: [sale({})], subs: [], receiptsLimit: 5 });
    expect(s.variationPct).toBeNull();
    expect(s.failed.pctOfActive).toBeNull();
  });
});

describe('lectura del cliente', () => {
  it('parseInbox descarta ítems con tipo desconocido y recalcula los contadores', () => {
    const out = parseInbox({ items: [{ key: 'k1', kind: 'fail', creator: 'C' }, { key: 'k2', kind: 'inventado' }, { kind: 'fail' }], counts: { total: 99 } });
    expect(out.items).toHaveLength(1);
    expect(out.counts).toMatchObject({ fail: 1, total: 1 });
  });
  it('parseSummary tolera un cuerpo vacío', () => {
    const out = parseSummary({});
    expect(out.months).toEqual([]);
    expect(out.variationPct).toBeNull();
    expect(out.receipts).toEqual([]);
  });
});
