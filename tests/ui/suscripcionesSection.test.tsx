// @vitest-environment jsdom
/** SuscripcionesSection: filtros, cargar más, contador «Todas» y accesibilidad de la tabla. */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, cleanup, click, flush, mount } from './dom';
import type { AdminSubscription, AdminSubscriptions } from '../../src/lib/billingTypes';

const net = vi.hoisted(() => ({ adminSubscriptions: vi.fn() }));
vi.mock('../../src/lib/billingApi', () => ({ adminSubscriptions: net.adminSubscriptions }));

import { SuscripcionesSection } from '../../src/pages/admin/SuscripcionesSection';

const sub = (id: string, status: AdminSubscription['status'], name = `Streamer ${id}`): AdminSubscription => ({
  id,
  profileId: `p-${id}`,
  twitchLogin: name.toLowerCase().replace(/ /g, ''),
  displayName: name,
  planId: 'pro',
  planName: 'Pro',
  months: 1,
  status,
  startedAt: '2026-01-01T00:00:00Z',
  paidUntil: '2026-03-01T00:00:00Z',
  lastPaymentAt: '2026-02-01T00:00:00Z',
  priceUsd: 5,
});
const totals = (o: Partial<AdminSubscriptions['totals']> = {}) => ({ active: 0, grace: 0, cancelled: 0, suspended: 0, expired: 0, pending: 0, ...o });
const page = (p: Partial<AdminSubscriptions>): AdminSubscriptions => ({ subscriptions: [], totals: totals(), codeAccess: [], nextBefore: null, ...p });
const code = { profileId: 'c1', twitchLogin: 'cod', displayName: 'Con Código', planId: 'pro', planName: 'Pro', expiresAt: '2026-06-01T00:00:00Z', inviteCode: 'LALO-1' };

const rowsOf = (host: HTMLElement) => host.querySelectorAll('tbody tr');
const filterBtn = (host: HTMLElement, label: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('.adm-tot button')).find((b) => b.querySelector('span')?.textContent === label)!;
const countOf = (btn: HTMLElement) => btn.querySelector('b')?.textContent;

describe('SuscripcionesSection', () => {
  beforeEach(() => {
    net.adminSubscriptions.mockReset();
  });
  afterEach(cleanup);

  it('estado vacío si no hay nadie', async () => {
    net.adminSubscriptions.mockResolvedValue({ ok: true, data: page({}) });
    const { host } = await mount(<SuscripcionesSection />);
    await flush();
    expect(host.textContent).toContain('Todavía nadie se ha suscrito');
    expect(host.querySelector('table')).toBeNull();
  });

  it('error al leer: alerta y Reintentar vuelve a pedir', async () => {
    net.adminSubscriptions.mockResolvedValueOnce({ ok: false, code: 'x', message: 'Falló la lectura', missing: [] }).mockResolvedValueOnce({ ok: true, data: page({ subscriptions: [sub('1', 'active')], totals: totals({ active: 1 }) }) });
    const { host } = await mount(<SuscripcionesSection />);
    await flush();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Falló la lectura');
    await click(byText(host, 'button', 'Reintentar'));
    await flush();
    expect(rowsOf(host)).toHaveLength(1);
  });

  it('los filtros muestran solo las filas de ese estado, con «Por código» incluido', async () => {
    net.adminSubscriptions.mockResolvedValue({
      ok: true,
      data: page({ subscriptions: [sub('1', 'active'), sub('2', 'grace'), sub('3', 'active')], totals: totals({ active: 2, grace: 1 }), codeAccess: [code] }),
    });
    const { host } = await mount(<SuscripcionesSection />);
    await flush();
    expect(rowsOf(host)).toHaveLength(4);
    await click(filterBtn(host, 'Activas'));
    expect(rowsOf(host)).toHaveLength(2);
    expect(filterBtn(host, 'Activas').getAttribute('aria-pressed')).toBe('true');
    await click(filterBtn(host, 'Por código'));
    expect(rowsOf(host)).toHaveLength(1);
    expect(host.textContent).toContain('Con Código');
    await click(filterBtn(host, 'Canceladas'));
    expect(host.textContent).toContain('Nadie en este estado todavía.');
  });

  it('«Todas» coincide con las filas realmente mostradas cuando todo está cargado', async () => {
    net.adminSubscriptions.mockResolvedValue({
      ok: true,
      data: page({ subscriptions: [sub('1', 'active'), sub('2', 'cancelled'), sub('3', 'expired')], totals: totals({ active: 1, cancelled: 1, expired: 1 }), codeAccess: [code] }),
    });
    const { host } = await mount(<SuscripcionesSection />);
    await flush();
    expect(countOf(filterBtn(host, 'Todas'))).toBe(String(rowsOf(host).length));
    expect(rowsOf(host)).toHaveLength(4);
  });

  it('«Cargar más» pide con el cursor, suma sin duplicar y desaparece al terminar', async () => {
    net.adminSubscriptions
      .mockResolvedValueOnce({ ok: true, data: page({ subscriptions: [sub('1', 'active'), sub('2', 'active')], totals: totals({ active: 3 }), nextBefore: 'cur-1' }) })
      .mockResolvedValueOnce({ ok: true, data: page({ subscriptions: [sub('2', 'active'), sub('3', 'active')], totals: totals({ active: 3 }), nextBefore: null }) });
    const { host } = await mount(<SuscripcionesSection />);
    await flush();
    expect(rowsOf(host)).toHaveLength(2);
    expect(countOf(filterBtn(host, 'Todas'))).toBe('3');
    await click(byText(host, 'button', 'Cargar más'));
    await flush();
    expect(net.adminSubscriptions).toHaveBeenLastCalledWith('cur-1');
    expect(rowsOf(host)).toHaveLength(3);
    expect(byText(host, 'button', 'Cargar más')).toBeNull();
  });

  it('si «Cargar más» falla, avisa y conserva las filas', async () => {
    net.adminSubscriptions
      .mockResolvedValueOnce({ ok: true, data: page({ subscriptions: [sub('1', 'active')], totals: totals({ active: 2 }), nextBefore: 'c' }) })
      .mockResolvedValueOnce({ ok: false, code: 'x', message: 'Sin conexión', missing: [] });
    const { host } = await mount(<SuscripcionesSection />);
    await flush();
    await click(byText(host, 'button', 'Cargar más'));
    await flush();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Sin conexión');
    expect(rowsOf(host)).toHaveLength(1);
    expect(byText(host, 'button', 'Cargar más')).not.toBeNull();
  });

  it('accesibilidad: th con scope col, tabla con nombre y contenedor con scroll enfocable', async () => {
    net.adminSubscriptions.mockResolvedValue({ ok: true, data: page({ subscriptions: [sub('1', 'active')], totals: totals({ active: 1 }) }) });
    const { host } = await mount(<SuscripcionesSection />);
    await flush();
    const ths = Array.from(host.querySelectorAll('thead th'));
    expect(ths.length).toBe(6);
    expect(ths.every((th) => th.getAttribute('scope') === 'col')).toBe(true);
    expect(host.querySelector('table')?.getAttribute('aria-label')).toBeTruthy();
    const wrap = host.querySelector('.adm-sub-table');
    expect(wrap?.getAttribute('tabindex')).toBe('0');
    expect(wrap?.getAttribute('role')).toBe('region');
    expect(wrap?.getAttribute('aria-label')).toBeTruthy();
  });
});
