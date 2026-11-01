/**
 * src/lib/paypalSdk.ts
 *
 * Carga única del SDK de JavaScript de PayPal (botones de suscripción). El
 * script se pide una sola vez por identificador de cliente; si falla o tarda
 * demasiado, la promesa se rechaza y el siguiente intento vuelve a pedirlo.
 * La dirección se construye en src/lib/invitesLogic.ts (buildPaypalSdkUrl).
 */

import { buildPaypalSdkUrl } from './invitesLogic';

export interface PaypalButtonsInstance {
  render: (container: HTMLElement) => Promise<void>;
  close: () => Promise<void> | void;
  isEligible?: () => boolean;
}

export interface PaypalButtonsConfig {
  style?: Record<string, unknown>;
  createSubscription: () => Promise<string>;
  onApprove: (data: { subscriptionID?: string | null }) => void | Promise<void>;
  onCancel?: () => void;
  onError?: (err: unknown) => void;
}

export interface PaypalNamespace {
  Buttons: (config: PaypalButtonsConfig) => PaypalButtonsInstance;
}

declare global {
  interface Window {
    paypal?: PaypalNamespace;
  }
}

export const SDK_TIMEOUT_MS = 15000;
const SCRIPT_ATTR = 'data-lalo-paypal-sdk';

let pending: { url: string; promise: Promise<PaypalNamespace> } | null = null;

export function loadPaypalSdk(clientId: string | null | undefined, timeoutMs = SDK_TIMEOUT_MS): Promise<PaypalNamespace> {
  const url = buildPaypalSdkUrl(clientId);
  if (!url) return Promise.reject(new Error('Falta el identificador de cliente de PayPal.'));
  if (typeof document === 'undefined') return Promise.reject(new Error('Sin navegador.'));
  if (window.paypal?.Buttons && pending?.url === url) return Promise.resolve(window.paypal);
  if (pending?.url === url) return pending.promise;

  const promise = new Promise<PaypalNamespace>((resolve, reject) => {
    // Un script anterior con otro cliente (o a medias) se retira antes de pedir este
    document.querySelectorAll(`script[${SCRIPT_ATTR}]`).forEach((node) => node.remove());
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.setAttribute(SCRIPT_ATTR, '1');
    const fail = (message: string) => {
      window.clearTimeout(timer);
      script.remove();
      if (pending?.url === url) pending = null;
      reject(new Error(message));
    };
    const timer = window.setTimeout(() => fail('PayPal tardó demasiado en cargar.'), timeoutMs);
    script.onload = () => {
      window.clearTimeout(timer);
      if (window.paypal?.Buttons) resolve(window.paypal);
      else fail('PayPal cargó sin los botones.');
    };
    script.onerror = () => fail('No se pudo cargar PayPal.');
    document.head.appendChild(script);
  });
  pending = { url, promise };
  return promise;
}

