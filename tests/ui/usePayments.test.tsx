// @vitest-environment jsdom
/** usePayments + PaymentHistory: estados cargando / listo / vacío / error / pendiente de conexión, y copiar recibo. */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, click, flush, mount } from './dom';

const fetchPayments = vi.fn();
vi.mock('../../src/lib/paymentsApi', () => ({ fetchPayments: () => fetchPayments() }));

import { PaymentHistory } from '../../src/components/billing/PaymentHistory';
import { usePayments } from '../../src/lib/usePayments';
import type { PaymentRow } from '../../src/lib/paymentsApi';

const row = (over: Partial<PaymentRow>): PaymentRow => ({
  id: 'a',
  receipt: 'R-2026-AAAA1111',
  date: '2026-10-01T12:00:00Z',
  concept: 'Plan Pro · 3 meses',
  amount: 27,
  currency: 'USD',
  status: 'paid',
  refundedAmount: 0,
  ...over,
});

const Probe: React.FC = () => {
  const p = usePayments();
  return (
    <div>
      <i data-state>{p.state}</i>
      <i data-next>{p.nextCharge ? `${p.nextCharge.amount}` : 'sin'}</i>
      <PaymentHistory rows={p.rows} state={p.state} error={p.error} onRetry={p.reload} />
    </div>
  );
};
const text = (host: HTMLElement, sel: string) => host.querySelector(sel)?.textContent;

beforeEach(() => fetchPayments.mockReset());
afterEach(cleanup);

describe('usePayments', () => {
  it('muestra cargando y luego la lista con el próximo cobro', async () => {
    let resolve: (v: unknown) => void = () => {};
    fetchPayments.mockReturnValue(new Promise((r) => (resolve = r)));
    const { host } = await mount(<Probe />);
    expect(text(host, '[data-state]')).toBe('cargando');
    expect(host.textContent).toContain('Cargando tus pagos');
    resolve({
      ok: true,
      data: {
        payments: [row({}), row({ id: 'b', receipt: null, status: 'failed', amount: null }), row({ id: 'c', status: 'reversed' }), row({ id: 'd', status: 'refunded', refundedAmount: 10 }), row({ id: 'e', receipt: null, status: 'pending' })],
        nextCharge: { date: '2026-11-30T00:00:00Z', amount: 27, currency: 'USD', concept: 'Plan Pro · 3 meses' },
      },
    });
    await flush();
    expect(text(host, '[data-state]')).toBe('listo');
    expect(text(host, '[data-next]')).toBe('27');
    for (const label of ['Pagado', 'Reembolsado', 'Revertido', 'Falló el cobro', 'Pendiente']) expect(host.textContent).toContain(label);
    expect(host.textContent).toContain('USD 27.00');
    expect(host.querySelectorAll('button[aria-label^="Copiar nº de recibo"]').length).toBe(3);
  });

  it('vacío', async () => {
    fetchPayments.mockResolvedValue({ ok: true, data: { payments: [], nextCharge: null } });
    const { host } = await mount(<Probe />);
    await flush();
    expect(text(host, '[data-state]')).toBe('vacio');
    expect(host.textContent).toContain('Todavía no hay pagos registrados.');
  });

  it('pendiente de conexión cuando falta la migración o la ruta', async () => {
    for (const code of ['migration_missing', 'not_found']) {
      fetchPayments.mockResolvedValue({ ok: false, code, message: 'x', missing: [] });
      const { host, unmount } = await mount(<Probe />);
      await flush();
      expect(text(host, '[data-state]')).toBe('pendiente-de-conexion');
      expect(host.textContent).toContain('aún no está conectado');
      await unmount();
    }
  });

  it('error con borde discontinuo y reintento', async () => {
    fetchPayments.mockResolvedValueOnce({ ok: false, code: 'no_server', message: 'No hay servidor.', missing: [] });
    fetchPayments.mockResolvedValueOnce({ ok: true, data: { payments: [row({})], nextCharge: null } });
    const { host } = await mount(<Probe />);
    await flush();
    expect(text(host, '[data-state]')).toBe('error');
    expect(host.querySelector('.tally-note-bad')?.textContent).toBe('No hay servidor.');
    await click(Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Reintentar') ?? null);
    await flush();
    expect(text(host, '[data-state]')).toBe('listo');
  });
});

describe('PaymentHistory', () => {
  it('copia el número de recibo', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { host } = await mount(<PaymentHistory rows={[row({})]} />);
    await click(host.querySelector('button[aria-label^="Copiar nº de recibo"]'));
    await flush();
    expect(writeText).toHaveBeenCalledWith('R-2026-AAAA1111');
    expect(host.textContent).toContain('Copiado');
  });
});
