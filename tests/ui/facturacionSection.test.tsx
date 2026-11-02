// @vitest-environment jsdom
/** Facturación: KPIs, gráfica a escala, desglose, recibos y los estados vacío, error y pendiente de conexión. */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, cleanup, click, flush, mount } from './dom';

const net = vi.hoisted(() => ({ summary: vi.fn() }));
vi.mock('../../src/lib/adminBillingApi', () => ({
  fetchAdminInbox: vi.fn(),
  resolveInboxItem: vi.fn(),
  fetchAdminBillingSummary: net.summary,
}));

import { FacturacionSection } from '../../src/pages/admin/FacturacionSection';
import { useAdminBillingSummary } from '../../src/pages/admin/useAdminBilling';
import type { BillingSummary } from '../../src/lib/adminBillingLogic';

const summary: BillingSummary = {
  currency: 'USD',
  months: [
    { month: '2026-06', revenue: 420, sales: 10 },
    { month: '2026-07', revenue: 455, sales: 11 },
    { month: '2026-08', revenue: 510, sales: 12 },
    { month: '2026-09', revenue: 498, sales: 12 },
    { month: '2026-10', revenue: 560, sales: 13 },
    { month: '2026-11', revenue: 612, sales: 14 },
  ],
  currentRevenue: 612,
  previousRevenue: 560,
  variationPct: 9.3,
  activeSubscriptions: 47,
  renewals30: { count: 18, amount: 540 },
  failed: { count: 4, pctOfActive: 8.5 },
  breakdown: [
    { planId: 'pro', planName: 'Pro', months: 1, count: 12, amount: 144 },
    { planId: 'pro', planName: 'Pro', months: 3, count: 21, amount: 630 },
  ],
  receipts: [
    { receipt: 'R-2041', date: '2026-11-01T10:00:00Z', creator: 'Nico_Plays', concept: 'Plan Pro · 3 meses', amount: 30, currency: 'USD', status: 'paid', refundedAmount: 0 },
    { receipt: 'R-2040', date: '2026-10-28T10:00:00Z', creator: 'Vale_TV', concept: 'Plan Pro · 1 mes', amount: 12, currency: 'USD', status: 'refunded', refundedAmount: 12 },
  ],
};

const Harness: React.FC = () => <FacturacionSection summary={useAdminBillingSummary()} />;

describe('FacturacionSection', () => {
  beforeEach(() => {
    net.summary.mockReset();
    window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
  });
  afterEach(cleanup);

  it('pinta las cuatro cifras con datos simulados', async () => {
    net.summary.mockResolvedValue({ ok: true, data: summary });
    const { host } = await mount(<Harness />);
    await flush();
    const kpis = host.querySelector('.atl-kpis')!.textContent!;
    expect(kpis).toContain('$ 612.00');
    expect(kpis).toContain('+9,3 % vs. mes anterior');
    expect(kpis).toContain('47');
    expect(kpis).toContain('18');
    expect(kpis).toContain('$ 540.00 previstos');
    expect(kpis).toContain('8,5 % de las activas');
  });

  it('la gráfica tiene seis barras con ejes y valores reales, y el mes actual destacado', async () => {
    net.summary.mockResolvedValue({ ok: true, data: summary });
    const { host } = await mount(<Harness />);
    await flush();
    const svg = host.querySelector('svg.atl-chart')!;
    expect(svg.getAttribute('aria-label')).toContain('nov $ 612.00');
    expect(svg.querySelectorAll('.atl-bar')).toHaveLength(6);
    expect(svg.querySelectorAll('.atl-bar[data-current]')).toHaveLength(1);
    expect(svg.querySelectorAll('line')).toHaveLength(5);
    const labels = Array.from(svg.querySelectorAll('text')).map((t) => t.textContent);
    expect(labels).toEqual(expect.arrayContaining(['jun', 'nov', '612', '560', '1000', '0']));
    // Escala: la barra de 612 mide más que la de 420 en la proporción real
    const heights = Array.from(svg.querySelectorAll('.atl-bar rect')).map((r) => Number(r.getAttribute('height')));
    expect(heights[5] / heights[0]).toBeCloseTo(612 / 420, 2);
  });

  it('muestra el desglose por plan y la tabla de recibos, sin botón Exportar', async () => {
    net.summary.mockResolvedValue({ ok: true, data: summary });
    const { host } = await mount(<Harness />);
    await flush();
    expect(host.textContent).toContain('Pro · 3 meses');
    expect(host.textContent).toContain('21 · $ 630.00');
    const rows = host.querySelectorAll('.atl-table tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('R-2041');
    expect(rows[0].textContent).toContain('Nico_Plays');
    expect(rows[0].textContent).toContain('USD 30.00');
    expect(rows[0].textContent).toContain('Pagado');
    expect(rows[1].textContent).toContain('Reembolsado');
    expect(byText(host, 'button', 'Exportar')).toBeNull();
  });

  it('vacío: «Aún no hay cobros»', async () => {
    net.summary.mockResolvedValue({
      ok: true,
      data: { ...summary, months: summary.months.map((m) => ({ ...m, revenue: 0, sales: 0 })), currentRevenue: 0, previousRevenue: 0, variationPct: null, activeSubscriptions: 0, receipts: [], breakdown: [] },
    });
    const { host } = await mount(<Harness />);
    await flush();
    expect(host.textContent).toContain('Aún no hay cobros');
    expect(host.querySelector('.atl-kpis')).toBeNull();
  });

  it('error con «Reintentar»', async () => {
    net.summary.mockResolvedValueOnce({ ok: false, code: 'server', message: 'Sin respuesta.', missing: [] });
    net.summary.mockResolvedValueOnce({ ok: true, data: summary });
    const { host } = await mount(<Harness />);
    await flush();
    expect(host.querySelector('[data-estado="error"]')!.textContent).toContain('Sin respuesta.');
    await click(byText(host, 'button', 'Reintentar'));
    await flush();
    expect(host.querySelector('.atl-kpis')).not.toBeNull();
  });

  it('migration_missing: pendiente de conexión', async () => {
    net.summary.mockResolvedValue({ ok: false, code: 'migration_missing', message: 'Falta.', missing: [] });
    const { host } = await mount(<Harness />);
    await flush();
    expect(host.querySelector('[data-estado="pendiente"]')!.textContent).toContain('0053');
    expect(host.querySelector('[data-estado="error"]')).toBeNull();
  });

  it('cargando', async () => {
    net.summary.mockReturnValue(new Promise(() => {}));
    const { host } = await mount(<Harness />);
    expect(host.querySelector('[data-estado="cargando"]')!.textContent).toContain('Leyendo la facturación');
  });
});
