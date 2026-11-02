// @vitest-environment jsdom
/** Carga del SDK de PayPal: caché por URL, reintento tras fallo, timeout, onerror y casos límite. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ID_A = 'AaaaaaaaBbbbbbbb';
const ID_B = 'CcccccccDdddddddd';

async function fresh() {
  vi.resetModules();
  return import('../../src/lib/paypalSdk');
}
const scripts = () => Array.from(document.head.querySelectorAll<HTMLScriptElement>('script[data-lalo-paypal-sdk]'));
const fakeSdk = () => ({ Buttons: () => ({ render: async () => {}, close: () => {} }) });
const setSdk = () => {
  (window as unknown as { paypal: unknown }).paypal = fakeSdk();
};

describe('loadPaypalSdk', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    delete (window as unknown as { paypal?: unknown }).paypal;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rechaza sin identificador de cliente válido y sin tocar el documento', async () => {
    const { loadPaypalSdk } = await fresh();
    await expect(loadPaypalSdk('')).rejects.toThrow(/identificador de cliente/);
    await expect(loadPaypalSdk('a b')).rejects.toThrow();
    expect(scripts()).toHaveLength(0);
  });

  it('pide el script una sola vez por URL y reparte la misma promesa', async () => {
    const { loadPaypalSdk } = await fresh();
    const p1 = loadPaypalSdk(ID_A);
    const p2 = loadPaypalSdk(ID_A);
    expect(p2).toBe(p1);
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0].src).toContain(`client-id=${ID_A}`);
    setSdk();
    scripts()[0].onload?.(new Event('load'));
    await expect(p1).resolves.toBeDefined();
    // Ya cargado: devuelve el espacio de nombres sin pedir otro script
    await expect(loadPaypalSdk(ID_A)).resolves.toBe(window.paypal);
    expect(scripts()).toHaveLength(1);
  });

  it('otro cliente retira el script anterior y pide el suyo', async () => {
    const { loadPaypalSdk } = await fresh();
    loadPaypalSdk(ID_A).catch(() => {});
    loadPaypalSdk(ID_B).catch(() => {});
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0].src).toContain(`client-id=${ID_B}`);
  });

  it('onerror rechaza, retira el script y el siguiente intento vuelve a pedirlo', async () => {
    const { loadPaypalSdk } = await fresh();
    const p1 = loadPaypalSdk(ID_A);
    scripts()[0].onerror?.(new Event('error'));
    await expect(p1).rejects.toThrow('No se pudo cargar PayPal.');
    expect(scripts()).toHaveLength(0);
    const p2 = loadPaypalSdk(ID_A);
    expect(p2).not.toBe(p1);
    expect(scripts()).toHaveLength(1);
    setSdk();
    scripts()[0].onload?.(new Event('load'));
    await expect(p2).resolves.toBeDefined();
  });

  it('si el script carga pero no trae Buttons, rechaza y permite reintentar', async () => {
    const { loadPaypalSdk } = await fresh();
    const p1 = loadPaypalSdk(ID_A);
    scripts()[0].onload?.(new Event('load'));
    await expect(p1).rejects.toThrow('PayPal cargó sin los botones.');
    expect(scripts()).toHaveLength(0);
    loadPaypalSdk(ID_A).catch(() => {});
    expect(scripts()).toHaveLength(1);
  });

  it('tarda más de SDK_TIMEOUT_MS: rechaza por tiempo y limpia', async () => {
    vi.useFakeTimers();
    const { loadPaypalSdk, SDK_TIMEOUT_MS } = await fresh();
    const caught = loadPaypalSdk(ID_A).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(SDK_TIMEOUT_MS - 1);
    expect(scripts()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(((await caught) as Error).message).toBe('PayPal tardó demasiado en cargar.');
    expect(scripts()).toHaveLength(0);
    loadPaypalSdk(ID_A).catch(() => {});
    expect(scripts()).toHaveLength(1);
  });

  it('una carga a tiempo cancela el temporizador', async () => {
    vi.useFakeTimers();
    const { loadPaypalSdk, SDK_TIMEOUT_MS } = await fresh();
    const p = loadPaypalSdk(ID_A);
    setSdk();
    scripts()[0].onload?.(new Event('load'));
    await expect(p).resolves.toBeDefined();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(SDK_TIMEOUT_MS + 10);
    expect(scripts()).toHaveLength(1);
  });

  it('sin document (SSR) rechaza sin lanzar', async () => {
    const { loadPaypalSdk } = await fresh();
    vi.stubGlobal('document', undefined);
    try {
      await expect(loadPaypalSdk(ID_A)).rejects.toThrow('Sin navegador.');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
