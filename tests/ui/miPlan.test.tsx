// @vitest-environment jsdom
/** MiPlan: confirmación y sondeo al volver de PayPal, cancelación con confirmación y «Tengo un código». */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { advance, byText, cleanup, click, flush, mount, submit, type } from './dom';
import type { BillingStatus } from '../../src/lib/billingTypes';

const h = vi.hoisted(() => ({
  catalog: vi.fn(),
  status: vi.fn(),
  confirm: vi.fn(),
  cancel: vi.fn(),
  refresh: vi.fn(),
  redeem: vi.fn(),
  fetchOwnPlan: vi.fn(),
  profile: null as Record<string, unknown> | null,
}));

vi.mock('../../src/lib/billingApi', () => ({
  billingCatalog: h.catalog,
  billingStatus: h.status,
  billingConfirm: h.confirm,
  billingCancel: h.cancel,
}));
vi.mock('../../src/hooks/useCloudSession', () => ({
  useCloudSession: () => ({ refresh: h.refresh, profile: h.profile, redeem: h.redeem }),
}));
vi.mock('../../src/lib/cloud', () => ({ fetchOwnPlan: h.fetchOwnPlan }));
// La ventana de pago se prueba aparte: aquí solo importa lo que MiPlan le pasa
vi.mock('../../src/components/billing/CheckoutWindow', () => ({
  PENDING_SUB_KEY: 'lalo.paypal.subscription',
  CheckoutWindow: ({ track, onClose }: { track: { phase: string; status: BillingStatus | null; error: string | null } | null; onClose: () => void }) => (
    <div data-testid="ventana" data-phase={track?.phase ?? 'eleccion'}>
      {track?.error && <span data-testid="track-error">{track.error}</span>}
      <button type="button" onClick={onClose}>
        cerrar ventana
      </button>
    </div>
  ),
}));

import { MiPlan } from '../../src/components/billing/MiPlan';

const FUTURE = '2099-01-01T00:00:00Z';
const none: BillingStatus = { subscription: null, hasAccess: false };
const pendingSt: BillingStatus = { subscription: { status: 'pending', planId: 'pro', planName: 'Pro', months: 1, paidUntil: null, lastPaymentAt: null, startedAt: '2026-01-01T00:00:00Z' }, hasAccess: false };
const active: BillingStatus = { subscription: { status: 'active', planId: 'pro', planName: 'Pro', months: 1, paidUntil: FUTURE, lastPaymentAt: '2026-01-01T00:00:00Z', startedAt: '2026-01-01T00:00:00Z' }, hasAccess: true };
const ok = <T,>(data: T) => ({ ok: true as const, data });
const catalogOk = ok({ enabled: true, env: 'sandbox' as const, clientId: 'AaaaaaaaBbbbbbb', plans: [{ id: 'pro', name: 'Pro', prices: { '1': 5, '3': null, '6': null, '12': null } }] });
const phase = () => document.body.querySelector('[data-testid="ventana"]')?.getAttribute('data-phase') ?? null;

beforeEach(() => {
  for (const fn of [h.catalog, h.status, h.confirm, h.cancel, h.refresh, h.redeem, h.fetchOwnPlan]) fn.mockReset();
  h.profile = null;
  h.catalog.mockResolvedValue(catalogOk);
  h.status.mockResolvedValue(ok(none));
  h.fetchOwnPlan.mockResolvedValue(null);
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});
afterEach(async () => {
  await cleanup();
  vi.useRealTimers();
});

describe('MiPlan, regreso de PayPal', () => {
  it('?paypal=ok con suscripción: confirma, y si ya hay acceso termina sin sondear', async () => {
    window.history.replaceState(null, '', '/?paypal=ok&subscription_id=I-1');
    h.confirm.mockResolvedValue(ok(active));
    await mount(<MiPlan />);
    await flush();
    expect(h.confirm).toHaveBeenCalledWith('I-1');
    expect(phase()).toBe('done');
    expect(h.refresh).toHaveBeenCalled();
    expect(window.location.search).toBe('');
    expect(sessionStorage.getItem('lalo.paypal.subscription')).toBeNull();
  });

  it('toma el id de la suscripción guardada si PayPal no lo trae en la dirección', async () => {
    sessionStorage.setItem('lalo.paypal.subscription', JSON.stringify({ subscriptionId: 'I-7', planName: 'Pro', months: 3 }));
    window.history.replaceState(null, '', '/?paypal=ok');
    h.confirm.mockResolvedValue(ok(active));
    await mount(<MiPlan />);
    await flush();
    expect(h.confirm).toHaveBeenCalledWith('I-7');
  });

  it('sondea cada 3 s hasta 60 s y luego queda en «timeout» sin dar el plan por activo', async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, '', '/?paypal=ok&subscription_id=I-1');
    h.confirm.mockResolvedValue(ok(pendingSt));
    h.status.mockResolvedValue(ok(pendingSt));
    await mount(<MiPlan />);
    await flush();
    expect(phase()).toBe('waiting');
    const base = h.status.mock.calls.length; // la lectura inicial de la página
    await advance(2999, vi);
    expect(h.status.mock.calls.length).toBe(base);
    await advance(2, vi);
    expect(h.status.mock.calls.length).toBe(base + 1);
    await advance(57000, vi);
    await flush();
    expect(phase()).toBe('timeout');
    expect(h.status.mock.calls.length - base).toBe(20);
    // Ya no sigue preguntando
    await advance(30000, vi);
    expect(h.status.mock.calls.length - base).toBe(20);
    expect(document.body.textContent).not.toContain('Tu plan ya está activo');
  });

  it('si en mitad del sondeo llega hasAccess true, termina y refresca', async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, '', '/?paypal=ok&subscription_id=I-1');
    h.confirm.mockResolvedValue(ok(pendingSt));
    h.status.mockResolvedValue(ok(pendingSt));
    await mount(<MiPlan />);
    await flush();
    h.status.mockResolvedValue(ok(active));
    await advance(3100, vi);
    await flush();
    expect(phase()).toBe('done');
    expect(h.refresh).toHaveBeenCalled();
  });

  it('sondeo sin respuesta del servidor termina en «error» con el motivo', async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, '', '/?paypal=ok&subscription_id=I-1');
    h.confirm.mockResolvedValue({ ok: false, code: 'x', message: 'sin servidor', missing: [] });
    h.status.mockResolvedValue({ ok: false, code: 'x', message: 'sin servidor', missing: [] });
    await mount(<MiPlan />);
    await flush();
    await advance(61000, vi);
    await flush();
    expect(phase()).toBe('error');
    expect(document.body.querySelector('[data-testid="track-error"]')?.textContent).toBe('sin servidor');
  });

  it('salir de la página corta el sondeo', async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, '', '/?paypal=ok&subscription_id=I-1');
    h.confirm.mockResolvedValue(ok(pendingSt));
    h.status.mockResolvedValue(ok(pendingSt));
    const view = await mount(<MiPlan />);
    await flush();
    await view.unmount();
    const calls = h.status.mock.calls.length;
    await advance(20000, vi);
    expect(h.status.mock.calls.length).toBe(calls);
  });

  it('?paypal=cancel avisa, no abre la ventana ni confirma y limpia la dirección', async () => {
    sessionStorage.setItem('lalo.paypal.subscription', JSON.stringify({ subscriptionId: 'I-1', planName: 'Pro', months: 1 }));
    window.history.replaceState(null, '', '/?paypal=cancel');
    await mount(<MiPlan />);
    await flush();
    expect(document.body.textContent).toContain('Cancelaste el pago en PayPal');
    expect(phase()).toBeNull();
    expect(h.confirm).not.toHaveBeenCalled();
    expect(window.location.search).toBe('');
    expect(sessionStorage.getItem('lalo.paypal.subscription')).toBeNull();
  });
});

describe('MiPlan, cancelar la suscripción', () => {
  beforeEach(() => {
    h.status.mockResolvedValue(ok(active));
  });

  it('pide confirmación en la propia página; «Mantenerla» la descarta sin llamar al servidor', async () => {
    const { host } = await mount(<MiPlan />);
    await flush();
    await click(byText(host, 'button', 'Cancelar suscripción'));
    expect(host.querySelector('[role="group"]')?.textContent).toMatch(/no habrá más cobros/);
    await click(byText(host, 'button', 'Mantenerla'));
    expect(host.querySelector('[role="group"]')).toBeNull();
    expect(h.cancel).not.toHaveBeenCalled();
  });

  it('confirmar cancela, actualiza el estado y avisa', async () => {
    h.cancel.mockResolvedValue(ok({ ...active, hasAccess: true, subscription: { ...active.subscription!, status: 'cancelled' } }));
    const { host } = await mount(<MiPlan />);
    await flush();
    await click(byText(host, 'button', 'Cancelar suscripción'));
    await click(byText(host, 'button', 'Sí, cancelar la suscripción'));
    await flush();
    expect(h.cancel).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Suscripción cancelada. No habrá más cobros.');
    expect(host.querySelector('[role="group"]')).toBeNull();
    expect(h.refresh).toHaveBeenCalled();
  });

  it('si cancelar falla, enseña el error y deja la confirmación abierta para reintentar', async () => {
    h.cancel.mockResolvedValue({ ok: false, code: 'x', message: 'PayPal no respondió', missing: [] });
    const { host } = await mount(<MiPlan />);
    await flush();
    await click(byText(host, 'button', 'Cancelar suscripción'));
    await click(byText(host, 'button', 'Sí, cancelar la suscripción'));
    await flush();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('PayPal no respondió');
    expect(host.querySelector('[role="group"]')).not.toBeNull();
  });
});

describe('MiPlan, «Tengo un código»', () => {
  it('abre el formulario, valida vacío y enseña el problema de un canje fallido', async () => {
    h.redeem.mockResolvedValue({ kind: 'invite', result: 'expired' });
    const { host } = await mount(<MiPlan />);
    await flush();
    await click(byText(host, 'button', 'Tengo un código'));
    const form = host.querySelector('form[aria-label="Canjear un código"]');
    expect(form).not.toBeNull();
    await submit(form);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Escribe tu código para canjearlo.');
    expect(h.redeem).not.toHaveBeenCalled();
    await type(form!.querySelector('input'), 'lalo-abc');
    await submit(form);
    await flush();
    expect(h.redeem).toHaveBeenCalledWith('invite', 'LALO-ABC');
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/ha caducado/);
    expect(host.querySelector('form')).not.toBeNull();
  });

  it('un canje correcto cierra el formulario, avisa y vuelve a leer el plan', async () => {
    h.redeem.mockResolvedValue({ kind: 'invite', result: 'ok' });
    const { host } = await mount(<MiPlan />);
    await flush();
    const before = h.status.mock.calls.length;
    await click(byText(host, 'button', 'Tengo un código'));
    await type(host.querySelector('form input'), 'lalo-abc');
    await submit(host.querySelector('form'));
    await flush();
    expect(host.querySelector('form')).toBeNull();
    expect(host.textContent).toContain('Código canjeado. Tu plan ya está activo.');
    expect(h.status.mock.calls.length).toBeGreaterThan(before);
  });
});
