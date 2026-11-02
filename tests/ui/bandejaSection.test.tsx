// @vitest-environment jsdom
/** Bandeja de pagos: filtros, selección, resolver con la API simulada y los estados vacío, error y pendiente de conexión. */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, cleanup, click, flush, mount, type as typeInto } from './dom';

const net = vi.hoisted(() => ({ inbox: vi.fn(), resolve: vi.fn(), summary: vi.fn() }));
vi.mock('../../src/lib/adminBillingApi', () => ({
  fetchAdminInbox: net.inbox,
  resolveInboxItem: net.resolve,
  fetchAdminBillingSummary: net.summary,
}));

import { BandejaSection } from '../../src/pages/admin/BandejaSection';
import { useAdminInbox } from '../../src/pages/admin/useAdminBilling';
import { inboxCounts, type InboxItem } from '../../src/lib/adminBillingLogic';

const item = (key: string, kind: InboxItem['kind'], extra: Partial<InboxItem> = {}): InboxItem => ({
  key,
  kind,
  creator: `Creador ${key}`,
  plan: 'Plan Pro · 3 meses',
  amount: 30,
  currency: 'USD',
  date: '2026-11-01T10:00:00Z',
  daysLeft: kind === 'soon' ? 3 : null,
  note: `Nota de ${key}`,
  history: [{ type: 'PAYMENT.FAILED', at: '2026-11-01T10:00:00Z' }],
  paypalId: `I-${key.toUpperCase()}`,
  ...extra,
});

const list = [item('a', 'fail'), item('b', 'soon'), item('c', 'refund', { paypalId: null, history: [] })];
const inboxOf = (items: InboxItem[]) => ({ ok: true as const, data: { items, counts: inboxCounts(items) } });

const Harness: React.FC = () => {
  const inbox = useAdminInbox();
  return <BandejaSection inbox={inbox} />;
};

const rows = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>('.atl-irow'));
const chip = (host: HTMLElement, label: string) => byText(host, '.atl-fchip', new RegExp(`^${label}`))!;

describe('BandejaSection', () => {
  beforeEach(() => {
    net.inbox.mockReset();
    net.resolve.mockReset();
    // Movimiento reducido: la salida del ítem es inmediata y la prueba no depende del reloj
    window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
  });
  afterEach(cleanup);

  it('lista los pagos con su contador por filtro y abre el primero en el detalle', async () => {
    net.inbox.mockResolvedValue(inboxOf(list));
    const { host } = await mount(<Harness />);
    await flush();
    expect(rows(host)).toHaveLength(3);
    expect(chip(host, 'Todo').textContent).toContain('3');
    expect(chip(host, 'Cobros fallidos').textContent).toContain('1');
    const detail = host.querySelector('.atl-detail')!;
    expect(detail.textContent).toContain('Creador a');
    expect(detail.textContent).toContain('I-A');
    expect(detail.textContent).toContain('USD 30.00');
    expect(detail.textContent).toContain('Cobro fallido');
  });

  it('filtra por tipo y cambia de selección al pulsar otro pago', async () => {
    net.inbox.mockResolvedValue(inboxOf(list));
    const { host } = await mount(<Harness />);
    await flush();
    await click(chip(host, 'Por vencer'));
    expect(rows(host)).toHaveLength(1);
    expect(host.querySelector('.atl-detail')!.textContent).toContain('Creador b');
    expect(host.querySelector('.atl-detail')!.textContent).toContain('3 días');
    await click(chip(host, 'Todo'));
    await click(rows(host)[2]);
    expect(rows(host)[2].getAttribute('aria-current')).toBe('true');
    expect(host.querySelector('.atl-detail')!.textContent).toContain('Creador c');
    expect(host.querySelector('.atl-detail')!.textContent).toContain('no tiene eventos de PayPal');
  });

  it('un filtro sin resultados lo dice y no pierde los demás pagos', async () => {
    net.inbox.mockResolvedValue(inboxOf(list));
    const { host } = await mount(<Harness />);
    await flush();
    await click(chip(host, 'Sistema'));
    expect(rows(host)).toHaveLength(0);
    expect(host.textContent).toContain('Nada en este filtro');
    await click(chip(host, 'Todo'));
    expect(rows(host)).toHaveLength(3);
  });

  it('«Marcar resuelto» llama a la API con la clave y la nota, quita el ítem y actualiza los contadores', async () => {
    net.inbox.mockResolvedValue(inboxOf(list));
    net.resolve.mockResolvedValue(inboxOf([list[1], list[2]]));
    const { host } = await mount(<Harness />);
    await flush();
    await typeInto(host.querySelector<HTMLInputElement>('.atl-input'), 'Pagó por otro medio');
    await click(byText(host, 'button', 'Marcar resuelto'));
    await flush();
    expect(net.resolve).toHaveBeenCalledWith('a', 'Pagó por otro medio');
    expect(rows(host)).toHaveLength(2);
    expect(chip(host, 'Todo').textContent).toContain('2');
    expect(chip(host, 'Cobros fallidos').textContent).toContain('0');
    // La selección pasa al siguiente
    expect(host.querySelector('.atl-detail')!.textContent).toContain('Creador b');
    expect(host.textContent).toContain('Resuelto: Creador a.');
  });

  it('si resolver falla, el ítem se queda y el error se ve con texto', async () => {
    net.inbox.mockResolvedValue(inboxOf(list));
    net.resolve.mockResolvedValue({ ok: false, code: 'server', message: 'No se pudo guardar.', missing: [] });
    const { host } = await mount(<Harness />);
    await flush();
    await click(byText(host, 'button', 'Marcar resuelto'));
    await flush();
    expect(rows(host)).toHaveLength(3);
    expect(host.querySelector('.atl-error')!.textContent).toContain('No se pudo guardar.');
    expect(host.querySelector('.atl-error')!.closest('[role]') ?? host.querySelector('[role="alert"]')).toBeTruthy();
  });

  it('no inventa acciones: recordatorio y extender días salen deshabilitadas con «Próximamente»', async () => {
    net.inbox.mockResolvedValue(inboxOf(list));
    const { host } = await mount(<Harness />);
    await flush();
    const soon = Array.from(host.querySelectorAll<HTMLButtonElement>('.atl-acts button')).filter((b) => b.textContent?.includes('Próximamente'));
    expect(soon).toHaveLength(2);
    expect(soon.every((b) => b.disabled)).toBe(true);
  });

  it('vacío: «Todo al día»', async () => {
    net.inbox.mockResolvedValue(inboxOf([]));
    const { host } = await mount(<Harness />);
    await flush();
    expect(host.textContent).toContain('Todo al día');
    expect(rows(host)).toHaveLength(0);
  });

  it('cargando: avisa que está leyendo', async () => {
    net.inbox.mockReturnValue(new Promise(() => {}));
    const { host } = await mount(<Harness />);
    expect(host.querySelector('[data-estado="cargando"]')?.textContent).toContain('Leyendo la bandeja de pagos');
  });

  it('error: borde discontinuo (alerta con texto) y «Reintentar» vuelve a pedir', async () => {
    net.inbox.mockResolvedValueOnce({ ok: false, code: 'server', message: 'El servidor no respondió.', missing: [] });
    net.inbox.mockResolvedValueOnce(inboxOf(list));
    const { host } = await mount(<Harness />);
    await flush();
    const alert = host.querySelector('[role="alert"][data-estado="error"]')!;
    expect(alert.textContent).toContain('El servidor no respondió.');
    await click(byText(host, 'button', 'Reintentar'));
    await flush();
    expect(net.inbox).toHaveBeenCalledTimes(2);
    expect(rows(host)).toHaveLength(3);
  });

  it('migration_missing: «pendiente de conexión» (no un error) y explica la migración 0053', async () => {
    net.inbox.mockResolvedValue({ ok: false, code: 'migration_missing', message: 'Falta la migración.', missing: [] });
    const { host } = await mount(<Harness />);
    await flush();
    const pending = host.querySelector('[data-estado="pendiente"]')!;
    expect(pending.textContent).toContain('Pendiente de conexión');
    expect(pending.textContent).toContain('0053');
    expect(host.querySelector('[data-estado="error"]')).toBeNull();
  });
});
