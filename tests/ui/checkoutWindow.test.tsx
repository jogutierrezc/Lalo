// @vitest-environment jsdom
/** CheckoutWindow: flujo con botones del SDK y flujo de redirección, errores y desmontaje. */

import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, cleanup, click, flush, mount } from './dom';
import type { BillingCatalog } from '../../src/lib/billingTypes';

const net = vi.hoisted(() => ({ billingSubscribe: vi.fn(), loadPaypalSdk: vi.fn() }));
vi.mock('../../src/lib/billingApi', () => ({ billingSubscribe: net.billingSubscribe }));
vi.mock('../../src/lib/paypalSdk', () => ({ loadPaypalSdk: net.loadPaypalSdk }));

import { CheckoutWindow, PENDING_SUB_KEY } from '../../src/components/billing/CheckoutWindow';

const CLIENT = 'AaaaaaaaBbbbbbbb';
const catalog = (clientId = CLIENT): BillingCatalog => ({
  enabled: true,
  env: 'sandbox',
  clientId,
  plans: [{ id: 'pro', name: 'Pro', prices: { '1': 5, '3': 12, '6': null, '12': null } }],
});

interface Config {
  createSubscription: () => Promise<string>;
  onApprove: (d: { subscriptionID?: string | null }) => void | Promise<void>;
  onCancel?: () => void;
  onError?: (e: unknown) => void;
}
let config: Config | null = null;
let closed = 0;
const sdk = { Buttons: (c: Config) => ((config = c), { render: async () => {}, close: () => void closed++ }) };

const alertText = () => document.body.querySelector('[role="alert"]')?.textContent ?? '';
const statusText = () => Array.from(document.body.querySelectorAll('[role="status"]')).map((e) => e.textContent).join('|');

beforeEach(() => {
  net.billingSubscribe.mockReset();
  net.loadPaypalSdk.mockReset();
  config = null;
  closed = 0;
  sessionStorage.clear();
  (window as unknown as { paypal?: unknown }).paypal = sdk;
  window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
});
afterEach(async () => {
  await cleanup();
  delete (window as unknown as { paypal?: unknown }).paypal;
  vi.unstubAllGlobals();
});

describe('CheckoutWindow, flujo con botones (sdk)', () => {
  const open = async (onApproved = vi.fn()) => {
    net.loadPaypalSdk.mockResolvedValue(sdk);
    await mount(<CheckoutWindow catalog={catalog()} status={null} track={null} onClose={() => {}} onApproved={onApproved} />);
    await flush();
    expect(config).not.toBeNull();
    return onApproved;
  };

  it('carga el SDK con el cliente del catálogo y crea los botones', async () => {
    await open();
    expect(net.loadPaypalSdk).toHaveBeenCalledWith(CLIENT);
    expect(document.body.textContent).not.toContain('Suscribirme con PayPal');
  });

  it('createSubscription pide el flujo sdk, guarda la suscripción pendiente y devuelve su id', async () => {
    await open();
    net.billingSubscribe.mockResolvedValue({ ok: true, data: { subscriptionId: 'I-1', approveUrl: '' } });
    await expect(config!.createSubscription()).resolves.toBe('I-1');
    expect(net.billingSubscribe).toHaveBeenCalledWith('pro', 3, 'sdk');
    expect(JSON.parse(sessionStorage.getItem(PENDING_SUB_KEY)!)).toMatchObject({ subscriptionId: 'I-1', planName: 'Pro', months: 3 });
  });

  it('onApprove con subscriptionID avisa a quien abrió la ventana', async () => {
    const onApproved = await open();
    await act(async () => {
      await config!.onApprove({ subscriptionID: 'I-1' });
    });
    expect(onApproved).toHaveBeenCalledWith('I-1', { planName: 'Pro', months: 3 });
  });

  it('onApprove sin subscriptionID no confirma nada y pide no repetir el pago', async () => {
    const onApproved = await open();
    await act(async () => {
      await config!.onApprove({ subscriptionID: null });
    });
    expect(onApproved).not.toHaveBeenCalled();
    expect(alertText()).toMatch(/no devolvió la suscripción/);
    expect(alertText()).toMatch(/No repitas el pago/);
  });

  it('onCancel enseña un aviso con «puedes intentarlo de nuevo» y no es un error', async () => {
    await open();
    await act(async () => config!.onCancel?.());
    expect(statusText()).toMatch(/puedes intentarlo de nuevo/);
    expect(alertText()).toBe('');
  });

  it('un error de PayPal (onError) se explica y no cobra', async () => {
    await open();
    await act(async () => config!.onError?.(new Error('card_declined')));
    expect(alertText()).toBe('PayPal no pudo completar el pago: card_declined');
    await act(async () => config!.onError?.('cadena'));
    expect(alertText()).toMatch(/No se cobró nada/);
  });

  it('si createSubscription falla en el servidor, muestra ese mensaje tal cual y no «error de PayPal»', async () => {
    await open();
    net.billingSubscribe.mockResolvedValue({ ok: false, code: 'server', message: 'No pudimos crear la suscripción. Inténtalo de nuevo.', missing: [] });
    // El SDK real llama a onError con lo que rechazó createSubscription
    await act(async () => {
      await config!.createSubscription().catch((err) => config!.onError?.(err));
    });
    expect(alertText()).toBe('No pudimos crear la suscripción. Inténtalo de nuevo.');
    expect(alertText()).not.toMatch(/PayPal no pudo/);
  });

  it('un 409 already_subscribed se muestra con el mensaje claro del servidor, sin sonar a fallo de PayPal', async () => {
    await open();
    const message = 'Ya tienes una suscripción activa. Cancélala antes de contratar otra.';
    net.billingSubscribe.mockResolvedValue({ ok: false, code: 'already_subscribed', message, missing: [] });
    await act(async () => {
      await config!.createSubscription().catch((err) => config!.onError?.(err));
    });
    expect(alertText()).toBe(message);
    expect(alertText()).not.toMatch(/PayPal no pudo/);
  });

  it('al desmontar cierra los botones y los avisos tardíos no hacen nada', async () => {
    net.loadPaypalSdk.mockResolvedValue(sdk);
    const view = await mount(<CheckoutWindow catalog={catalog()} status={null} track={null} onClose={() => {}} />);
    await flush();
    const late = config!;
    await view.unmount();
    expect(closed).toBeGreaterThanOrEqual(1);
    expect(() => late.onCancel?.()).not.toThrow();
    expect(() => late.onError?.(new Error('tarde'))).not.toThrow();
    expect(document.body.textContent).toBe('');
  });

  it('si el SDK no carga, queda el botón de redirección con aviso', async () => {
    net.loadPaypalSdk.mockRejectedValue(new Error('x'));
    await mount(<CheckoutWindow catalog={catalog()} status={null} track={null} onClose={() => {}} />);
    await flush();
    expect(byText(document.body, 'button', /Suscribirme con PayPal/)).not.toBeNull();
    expect(statusText()).toMatch(/No pudimos cargar los botones/);
  });
});

describe('CheckoutWindow, flujo de redirección', () => {
  const assign = vi.fn();
  beforeEach(() => {
    assign.mockReset();
    vi.stubGlobal('location', { ...window.location, assign });
  });
  const openNoSdk = () => mount(<CheckoutWindow catalog={catalog('')} status={null} track={null} onClose={() => {}} />);

  it('sin cliente de PayPal va directo al botón de redirección, sin cargar el SDK', async () => {
    await openNoSdk();
    expect(net.loadPaypalSdk).not.toHaveBeenCalled();
    expect(byText(document.body, 'button', /Suscribirme con PayPal/)).not.toBeNull();
    expect(statusText()).not.toMatch(/No pudimos cargar/);
  });

  it('pide la suscripción, guarda la pendiente y navega a PayPal', async () => {
    net.billingSubscribe.mockResolvedValue({ ok: true, data: { subscriptionId: 'I-9', approveUrl: 'https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-1' } });
    await openNoSdk();
    await click(byText(document.body, 'button', /Suscribirme con PayPal/));
    await flush();
    expect(net.billingSubscribe).toHaveBeenCalledWith('pro', 3);
    expect(assign).toHaveBeenCalledWith('https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-1');
    expect(JSON.parse(sessionStorage.getItem(PENDING_SUB_KEY)!)).toMatchObject({ subscriptionId: 'I-9' });
  });

  it('una dirección de aprobación no segura no se abre', async () => {
    net.billingSubscribe.mockResolvedValue({ ok: true, data: { subscriptionId: 'I-9', approveUrl: 'https://evil.example/paypal' } });
    await openNoSdk();
    await click(byText(document.body, 'button', /Suscribirme con PayPal/));
    await flush();
    expect(assign).not.toHaveBeenCalled();
    expect(alertText()).toMatch(/no es segura/);
  });

  it('un fallo del servidor (409 ya suscrito) se muestra con su mensaje y se puede reintentar', async () => {
    const message = 'Ya tienes una suscripción activa. Cancélala antes de contratar otra.';
    net.billingSubscribe.mockResolvedValue({ ok: false, code: 'already_subscribed', message, missing: [] });
    await openNoSdk();
    await click(byText(document.body, 'button', /Suscribirme con PayPal/));
    await flush();
    expect(alertText()).toBe(message);
    expect(assign).not.toHaveBeenCalled();
    expect(byText(document.body, 'button', /Suscribirme con PayPal/)?.hasAttribute('disabled')).toBe(false);
  });
});
