/** Lógica de presentación de la bandeja de pagos y la facturación: filtros, selección y gráfica a escala. */

import { describe, expect, it } from 'vitest';
import type { InboxItem, MonthRevenue } from '../src/lib/adminBillingLogic';
import { INBOX_FILTERS, buildChart, chartLabel, daysText, eventLabel, filterInbox, inboxTone, niceMax, nextSelection, pickSelection, variationText } from '../src/lib/adminBillingView';

const item = (key: string, kind: InboxItem['kind']): InboxItem => ({
  key,
  kind,
  creator: key,
  plan: 'Pro · 1 mes',
  amount: 12,
  currency: 'USD',
  date: '2026-11-01T10:00:00Z',
  daysLeft: null,
  note: '',
  history: [],
  paypalId: null,
});
const items = [item('a', 'fail'), item('b', 'soon'), item('c', 'fail'), item('d', 'refund'), item('e', 'sys')];

describe('filtros de la bandeja', () => {
  it('ofrecen Todo, Cobros fallidos, Por vencer, Reembolsos y Sistema', () => {
    expect(INBOX_FILTERS.slice(0, 5).map((f) => f.label)).toEqual(['Todo', 'Cobros fallidos', 'Por vencer', 'Reembolsos', 'Sistema']);
  });
  it('filtran por tipo y «Todo» no quita nada', () => {
    expect(filterInbox(items, 'all')).toHaveLength(5);
    expect(filterInbox(items, 'fail').map((i) => i.key)).toEqual(['a', 'c']);
    expect(filterInbox(items, 'pending')).toEqual([]);
  });
});

describe('selección', () => {
  it('conserva la pedida si sigue visible; si no, la primera; vacía: null', () => {
    expect(pickSelection(items, 'c')).toBe('c');
    expect(pickSelection(items, 'zzz')).toBe('a');
    expect(pickSelection(items, null)).toBe('a');
    expect(pickSelection([], 'a')).toBeNull();
  });
  it('al resolver pasa al siguiente, o al anterior si era el último', () => {
    expect(nextSelection(items, 'a')).toBe('b');
    expect(nextSelection(items, 'e')).toBe('d');
    expect(nextSelection([item('x', 'fail')], 'x')).toBeNull();
  });
});

describe('textos', () => {
  it('tono: dinero en riesgo = bad', () => {
    expect(inboxTone('fail')).toBe('bad');
    expect(inboxTone('refund')).toBe('bad');
    expect(inboxTone('soon')).toBe('warn');
    expect(inboxTone('sys')).toBe('neutral');
  });
  it('días y eventos', () => {
    expect(daysText(null)).toBeNull();
    expect(daysText(0)).toBe('Vence hoy');
    expect(daysText(1)).toBe('1 día');
    expect(daysText(5)).toBe('5 días');
    expect(daysText(-2)).toBe('Vencido hace 2 días');
    expect(eventLabel('PAYMENT.SALE.REFUNDED')).toBe('Reembolso aplicado');
    expect(eventLabel('ALGO.NUEVO')).toBe('ALGO.NUEVO');
  });
  it('variación con signo y coma decimal', () => {
    expect(variationText(null)).toBeNull();
    expect(variationText(12.4)).toBe('+12,4 %');
    expect(variationText(-3)).toBe('−3,0 %');
  });
});

describe('gráfica de ingresos', () => {
  const months: MonthRevenue[] = [
    { month: '2026-06', revenue: 420, sales: 10 },
    { month: '2026-07', revenue: 455, sales: 11 },
    { month: '2026-08', revenue: 0, sales: 0 },
    { month: '2026-09', revenue: 498, sales: 12 },
    { month: '2026-10', revenue: 560, sales: 13 },
    { month: '2026-11', revenue: 612, sales: 14 },
  ];
  it('la escala es redonda y cubre el valor máximo', () => {
    expect(niceMax(612)).toBe(1000);
    expect(niceMax(180)).toBe(200);
    expect(niceMax(0)).toBe(10);
  });
  it('las barras son proporcionales a su valor y la actual es la última', () => {
    const g = buildChart(months);
    expect(g.bars).toHaveLength(6);
    expect(g.bars[5].current).toBe(true);
    expect(g.bars.filter((b) => b.current)).toHaveLength(1);
    const plot = g.baseline - g.ticks[g.ticks.length - 1].y;
    expect(g.bars[5].height).toBeCloseTo((612 / g.max) * plot, 5);
    expect(g.bars[2].height).toBe(0);
    expect(g.ticks[0].value).toBe(0);
    expect(g.ticks[4].value).toBe(g.max);
    expect(g.bars[0].label).toBe('jun');
  });
  it('la descripción accesible lleva los valores reales', () => {
    expect(chartLabel({ months })).toContain('nov $ 612.00');
  });
});
