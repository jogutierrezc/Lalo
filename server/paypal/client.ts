/**
 * server/paypal/client.ts
 *
 * Cliente mínimo de la API REST de PayPal con fetch nativo (sin dependencias).
 * Token OAuth2 (client_credentials) con caché en memoria hasta poco antes de caducar.
 *
 * Nunca se registran secretos ni cuerpos de respuesta: los errores solo llevan el
 * código HTTP y el nombre del error de PayPal.
 */

import type { Env } from '../integrations/store.js';

export type PaypalEnv = 'sandbox' | 'live';
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface PaypalConfig {
  env: PaypalEnv;
  clientId: string;
  clientSecret: string;
  webhookId: string;
}

export function paypalEnvOf(env: Env): PaypalEnv {
  return (env.PAYPAL_ENV ?? '').trim().toLowerCase() === 'live' ? 'live' : 'sandbox';
}

/** Variables PAYPAL_* que faltan. */
export function paypalMissing(env: Env): string[] {
  return ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID'].filter((name) => !(env[name] ?? '').trim());
}

export function readPaypalConfig(env: Env): PaypalConfig | null {
  if (paypalMissing(env).length > 0) return null;
  return {
    env: paypalEnvOf(env),
    clientId: (env.PAYPAL_CLIENT_ID ?? '').trim(),
    clientSecret: (env.PAYPAL_CLIENT_SECRET ?? '').trim(),
    webhookId: (env.PAYPAL_WEBHOOK_ID ?? '').trim(),
  };
}

export const paypalBase = (mode: PaypalEnv): string => (mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');

/** Fallo de la API de PayPal. `name` es el código de PayPal (p. ej. RESOURCE_NOT_FOUND), nunca datos del usuario. */
export class PaypalError extends Error {
  constructor(
    public readonly status: number,
    public readonly name: string
  ) {
    super(`PayPal ${status} ${name}`);
  }
}

const tokens = new Map<string, { token: string; expiresAt: number }>();

/** Borra el token en memoria (para las pruebas). */
export function resetPaypalToken(): void {
  tokens.clear();
}

async function accessToken(config: PaypalConfig, fetchFn: FetchLike, now: number): Promise<string> {
  const key = `${config.env}:${config.clientId}`;
  const cached = tokens.get(key);
  if (cached && cached.expiresAt > now) return cached.token;
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  const response = await fetchFn(`${paypalBase(config.env)}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: 'grant_type=client_credentials',
  });
  const data = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !data.access_token) throw new PaypalError(response.status, String(data.error ?? 'AUTH_FAILED'));
  // Se renueva un minuto antes de que caduque
  const ttl = Math.max(60, Number(data.expires_in) || 300) - 60;
  tokens.set(key, { token: data.access_token, expiresAt: now + ttl * 1000 });
  return data.access_token;
}

export interface PaypalClient {
  request<T = Record<string, unknown>>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T>;
}

export function createPaypalClient(config: PaypalConfig, fetchFn: FetchLike, now: () => number = Date.now): PaypalClient {
  return {
    async request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
      const token = await accessToken(config, fetchFn, now());
      const response = await fetchFn(`${paypalBase(config.env)}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          // PayPal devuelve el recurso completo en las altas
          ...(method === 'POST' ? { Prefer: 'return=representation' } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.status === 401) tokens.delete(`${config.env}:${config.clientId}`);
      const text = await response.text();
      let data: Record<string, unknown> = {};
      if (text) {
        try {
          data = JSON.parse(text) as Record<string, unknown>;
        } catch {
          data = {};
        }
      }
      if (!response.ok) throw new PaypalError(response.status, String(data.name ?? 'PAYPAL_ERROR'));
      return data as T;
    },
  };
}
