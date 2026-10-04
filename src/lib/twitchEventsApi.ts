/**
 * src/lib/twitchEventsApi.ts
 *
 * Llamadas del navegador para el canal de eventos de Twitch:
 *
 * - Con el token de Twitch de la sesión (solo existe un rato después de entrar
 *   con Twitch; Supabase no lo conserva): qué permisos tiene y la lista de
 *   Power-ups personalizados del canal. El token no sale del navegador salvo
 *   hacia Twitch, y no se guarda en ningún sitio.
 * - Con la sesión de Supabase: encender, consultar y apagar las suscripciones
 *   (/api/twitch/subscriptions) y enviar eventos de prueba.
 * - Con la clave privada de widget: leer los eventos nuevos desde la capa de OBS.
 *
 * Twitch (comprobado en dev.twitch.tv el 2026-10-04):
 *   - GET https://id.twitch.tv/oauth2/validate con «Authorization: OAuth <token>»
 *     devuelve client_id, user_id, login y scopes; 401 si el token ya no vale.
 *   - GET https://api.twitch.tv/helix/bits/custom_power_ups?broadcaster_id=
 *     pide un token de USUARIO con bits:read y que el id sea el del propio token.
 *     403 si el canal no es afiliado ni partner.
 *
 * SIN PROBAR contra Twitch ni contra Supabase reales.
 */

import { supabase } from './supabase';
import type { CachedPowerup } from '../types/powerups';
import { parseCustomPowerups } from '../utils/twitchEvents';

const TIMEOUT_MS = 8000;

export interface TokenInfo {
  clientId: string;
  userId: string;
  login: string;
  scopes: string[];
}

/** Qué permisos tiene el token de Twitch de la sesión. null si ya no vale o no se pudo preguntar. */
export async function validateTwitchToken(token: string): Promise<TokenInfo | null> {
  try {
    const res = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `OAuth ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { client_id?: unknown; user_id?: unknown; login?: unknown; scopes?: unknown };
    if (typeof body.client_id !== 'string' || typeof body.user_id !== 'string') return null;
    return {
      clientId: body.client_id,
      userId: body.user_id,
      login: typeof body.login === 'string' ? body.login : '',
      scopes: Array.isArray(body.scopes) ? body.scopes.filter((item): item is string => typeof item === 'string') : [],
    };
  } catch {
    return null;
  }
}

export type PowerupListResult =
  | { ok: true; list: CachedPowerup[] }
  | { ok: false; reason: 'expired' | 'not_monetized' | 'error'; detail: string };

/** Lista de Power-ups personalizados del canal dueño del token. */
export async function fetchCustomPowerups(token: string, info: Pick<TokenInfo, 'clientId' | 'userId'>): Promise<PowerupListResult> {
  try {
    const res = await fetch(`https://api.twitch.tv/helix/bits/custom_power_ups?broadcaster_id=${encodeURIComponent(info.userId)}`, {
      headers: { Authorization: `Bearer ${token}`, 'Client-Id': info.clientId },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) return { ok: false, reason: 'expired', detail: 'Twitch ya no acepta la conexión de esta sesión.' };
    if (res.status === 403) {
      return { ok: false, reason: 'not_monetized', detail: 'Twitch dice que este canal no es afiliado ni partner: no tiene Power-ups.' };
    }
    if (!res.ok) return { ok: false, reason: 'error', detail: `Twitch respondió con el código ${res.status}.` };
    const body = (await res.json()) as { data?: unknown };
    return { ok: true, list: parseCustomPowerups(body.data) };
  } catch {
    return { ok: false, reason: 'error', detail: 'No se pudo llegar a Twitch.' };
  }
}

// ---------- Suscripciones (servidor de Lalo) ----------

export interface SubscriptionRow {
  type: string;
  status: string;
  createdAt: string | null;
}

export type SubscriptionsResult =
  | { ok: true; subscriptions: SubscriptionRow[]; results: { type: string; outcome: string; detail: string }[] }
  | { ok: false; code: string; message: string; missing: string[] };

/** GET consulta; `create` enciende lo que falte; `delete` lo apaga todo. Siempre sobre el canal de quien ha entrado. */
export async function callSubscriptions(action?: 'create' | 'delete'): Promise<SubscriptionsResult> {
  const fallo = (code: string, message: string, missing: string[] = []): SubscriptionsResult => ({ ok: false, code, message, missing });
  if (!supabase) return fallo('no_cloud', 'La nube no está configurada en este despliegue.');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return fallo('no_session', 'Hay que iniciar sesión.');
  try {
    const res = await fetch('/api/twitch/subscriptions', {
      method: action ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(action ? { 'Content-Type': 'application/json' } : {}) },
      body: action ? JSON.stringify({ action }) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !body) {
      return fallo(
        typeof body?.code === 'string' ? body.code : 'server',
        typeof body?.error === 'string' ? body.error : 'El servidor de Lalo no respondió. En local hace falta arrancarlo con «npm run dev:all».',
        Array.isArray(body?.missing) ? body.missing.filter((item): item is string => typeof item === 'string') : []
      );
    }
    return {
      ok: true,
      subscriptions: Array.isArray(body.subscriptions) ? (body.subscriptions as SubscriptionRow[]) : [],
      results: Array.isArray(body.results) ? (body.results as { type: string; outcome: string; detail: string }[]) : [],
    };
  } catch {
    return fallo('server', 'El servidor de Lalo no respondió. En local hace falta arrancarlo con «npm run dev:all».');
  }
}

// ---------- Eventos ----------

/** Guarda un evento de prueba para las capas de OBS de quien ha entrado. Devuelve null si se guardó, o el motivo. */
export async function pushTestEvent(kind: 'bits' | 'powerup' | 'points', payload: Record<string, unknown>): Promise<string | null> {
  if (!supabase) return 'La nube no está configurada.';
  const { error } = await supabase.rpc('push_test_twitch_event', { p_kind: kind, p_payload: payload });
  if (!error) return null;
  if (error.message.includes('too_many_tests')) return 'Demasiadas pruebas seguidas. Espera un minuto.';
  if (error.message.includes('not_active')) return 'Tu cuenta no está activa.';
  return 'No se pudo enviar la prueba. Puede faltar la migración 0012 en Supabase.';
}

export interface WidgetEventRow {
  id: number;
  kind: string;
  payload: unknown;
  test: boolean;
}

/** Eventos posteriores a `after` para la capa de OBS. null si la clave no vale o falló la consulta. */
export async function pollWidgetEvents(key: string, after: number | null): Promise<{ cursor: number; events: WidgetEventRow[] } | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('widget_events', { p_key: key, p_after: after });
  if (error || !data || typeof data !== 'object') return null;
  const body = data as { cursor?: unknown; events?: unknown };
  const cursor = typeof body.cursor === 'number' && Number.isFinite(body.cursor) ? body.cursor : after ?? 0;
  const events = (Array.isArray(body.events) ? body.events : [])
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .filter((item) => typeof item.id === 'number' && typeof item.kind === 'string')
    .map((item) => ({ id: item.id as number, kind: item.kind as string, payload: item.payload, test: item.test === true }));
  return { cursor, events };
}
