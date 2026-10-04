/**
 * server/twitch/subscriptions.ts
 *
 * /api/twitch/subscriptions: el streamer enciende, consulta o apaga el canal de
 * eventos de Twitch de SU canal. La usan la función de Vercel
 * (api/twitch/subscriptions.ts) y el servidor local (server/index.ts).
 *
 *   GET                         estado de las suscripciones de su canal
 *   POST { action: 'create' }   crea las que falten (y repone las caídas)
 *   POST { action: 'delete' }   las quita todas
 *
 * Quién llama se sabe por su sesión de Supabase (cabecera Authorization), igual
 * que en server/storage/handlers.ts. El canal sale de su perfil
 * (profiles.twitch_user_id): nunca se acepta un id de canal enviado en la
 * petición, así nadie puede tocar las suscripciones de otro.
 *
 * Twitch (comprobado en dev.twitch.tv el 2026-10-04):
 *   - Con webhooks, crear, listar y borrar suscripciones exige un token de
 *     APLICACIÓN; con uno de usuario falla. Si el tipo pide permiso del usuario,
 *     el streamer tiene que haberlo concedido antes a esta aplicación (Client ID).
 *     https://dev.twitch.tv/docs/api/reference/#create-eventsub-subscription
 *     https://dev.twitch.tv/docs/eventsub/manage-subscriptions/
 *   - Las suscripciones que piden permiso del usuario no tienen coste.
 *   - GET helix/eventsub/subscriptions?user_id= devuelve las de ese canal.
 *
 * No se guarda ningún token de usuario en el servidor: no hace falta.
 *
 * SIN PROBAR contra Twitch ni contra Supabase reales.
 */

import { fail, bodyOf, identify, isResult, type ApiRequest, type ApiResult } from '../storage/handlers.js';
import { appToken, readTwitchConfig, type Env } from './clips.js';
import { EVENT_TYPES, validSecret } from './eventsub.js';

export interface WantedSubscription {
  type: string;
  version: string;
  /** Permiso que el streamer debe haber dado a la aplicación. */
  scope: string;
}

/** Lo que Lalo pide a Twitch para cada canal. */
export const WANTED: readonly WantedSubscription[] = [
  { type: EVENT_TYPES.bits, version: '1', scope: 'bits:read' },
  { type: EVENT_TYPES.powerup, version: '1', scope: 'bits:read' },
  { type: EVENT_TYPES.points, version: '1', scope: 'channel:read:redemptions' },
];

/** Estados en los que una suscripción funciona o está a punto de hacerlo. */
const ALIVE = ['enabled', 'webhook_callback_verification_pending'];

export interface SubscriptionRow {
  type: string;
  /** Estado de Twitch, o `missing` si no existe. */
  status: string;
  createdAt: string | null;
}

export type CreateOutcome = 'created' | 'already' | 'no_permission' | 'error';

interface Config {
  clientId: string;
  clientSecret: string;
  secret: string;
  callback: string;
}

/** Dirección pública a la que Twitch enviará los avisos. Nunca sale de la petición: sería falsificable. */
export function callbackUrl(env: Env): string {
  const explicit = (env.TWITCH_EVENTSUB_CALLBACK ?? '').trim();
  const host = (env.VERCEL_PROJECT_PRODUCTION_URL ?? '').trim();
  const url = explicit || (host ? `https://${host}/api/twitch/eventsub` : '');
  // Twitch exige https en el puerto 443
  return /^https:\/\/[a-z0-9.-]+(:443)?\/[\w\-./]*$/i.test(url) ? url : '';
}

export function readEventsConfig(env: Env): { config: Config | null; missing: string[] } {
  const twitch = readTwitchConfig(env);
  const secret = (env.TWITCH_EVENTSUB_SECRET ?? '').trim();
  const callback = callbackUrl(env);
  const missing = [...twitch.missing];
  if (!validSecret(secret)) missing.push('TWITCH_EVENTSUB_SECRET');
  if (!callback) missing.push('TWITCH_EVENTSUB_CALLBACK');
  if (missing.length > 0) return { config: null, missing };
  return { config: { clientId: twitch.clientId, clientSecret: twitch.clientSecret, secret, callback }, missing };
}

type Fetch = typeof fetch;
interface Deps {
  fetch: Fetch;
  now: () => number;
}

const TIMEOUT_MS = 8000;

async function helix(method: 'GET' | 'POST' | 'DELETE', query: Record<string, string>, body: unknown, config: Config, deps: Deps): Promise<Response> {
  const search = new URLSearchParams(query).toString();
  const url = `https://api.twitch.tv/helix/eventsub/subscriptions${search ? `?${search}` : ''}`;
  const call = async (bearer: string) =>
    deps.fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Client-Id': config.clientId,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  let res = await call(await appToken(config.clientId, config.clientSecret, deps));
  // Un token caducado o revocado antes de tiempo: se pide otro una sola vez
  if (res.status === 401) res = await call(await appToken(config.clientId, config.clientSecret, deps, true));
  return res;
}

interface TwitchSubscription {
  id: string;
  type: string;
  status: string;
  createdAt: string | null;
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** De la lista de Twitch, las suscripciones de Lalo para ese canal y esta dirección. */
export function ownSubscriptions(data: unknown, twitchUserId: string, callback: string): TwitchSubscription[] {
  if (!Array.isArray(data)) return [];
  const types = WANTED.map((item) => item.type);
  return data.filter(isObject).flatMap((item) => {
    const condition = isObject(item.condition) ? item.condition : {};
    const transport = isObject(item.transport) ? item.transport : {};
    if (!types.includes(str(item.type))) return [];
    if (condition.broadcaster_user_id !== twitchUserId) return [];
    if (transport.method !== 'webhook' || transport.callback !== callback) return [];
    return [{ id: str(item.id), type: str(item.type), status: str(item.status), createdAt: str(item.created_at) || null }];
  });
}

/** Una fila por tipo que Lalo quiere: la suscripción viva si la hay, si no la más reciente, o `missing`. */
export function summarize(found: readonly TwitchSubscription[]): SubscriptionRow[] {
  return WANTED.map(({ type }) => {
    const mine = found.filter((item) => item.type === type);
    const best = mine.find((item) => item.status === 'enabled') ?? mine.find((item) => ALIVE.includes(item.status)) ?? mine[mine.length - 1];
    return best ? { type, status: best.status, createdAt: best.createdAt } : { type, status: 'missing', createdAt: null };
  });
}

async function listOwn(twitchUserId: string, config: Config, deps: Deps): Promise<TwitchSubscription[]> {
  const found: TwitchSubscription[] = [];
  let after = '';
  // Un canal tiene tres suscripciones; el tope de páginas solo evita un bucle
  for (let page = 0; page < 5; page += 1) {
    const res = await helix('GET', after ? { user_id: twitchUserId, after } : { user_id: twitchUserId }, undefined, config, deps);
    if (!res.ok) throw new Error(`Twitch respondió con el código ${res.status} al listar las suscripciones.`);
    const body = (await res.json()) as { data?: unknown; pagination?: { cursor?: unknown } };
    found.push(...ownSubscriptions(body.data, twitchUserId, config.callback));
    after = str(body.pagination?.cursor);
    if (!after) break;
  }
  return found;
}

async function createOne(wanted: WantedSubscription, twitchUserId: string, config: Config, deps: Deps): Promise<{ outcome: CreateOutcome; detail: string }> {
  const res = await helix(
    'POST',
    {},
    {
      type: wanted.type,
      version: wanted.version,
      condition: { broadcaster_user_id: twitchUserId },
      transport: { method: 'webhook', callback: config.callback, secret: config.secret },
    },
    config,
    deps
  );
  if (res.status === 202 || res.ok) return { outcome: 'created', detail: '' };
  if (res.status === 409) return { outcome: 'already', detail: '' };
  if (res.status === 403) return { outcome: 'no_permission', detail: `Falta el permiso ${wanted.scope}.` };
  return { outcome: 'error', detail: `Twitch respondió con el código ${res.status}.` };
}

// Tope de peticiones por cuenta y minuto, para no gastar el cupo de la aplicación en Twitch
const calls = new Map<string, number[]>();
export const CALLS_PER_MINUTE = 12;
function tooMany(callerId: string, now: number): boolean {
  const recent = (calls.get(callerId) ?? []).filter((at) => now - at < 60_000);
  if (recent.length >= CALLS_PER_MINUTE) {
    calls.set(callerId, recent);
    return true;
  }
  recent.push(now);
  calls.set(callerId, recent);
  if (calls.size > 500) calls.delete(calls.keys().next().value as string);
  return false;
}

/** Para las pruebas. */
export function resetSubscriptionState(): void {
  calls.clear();
}

export async function handleSubscriptions(req: ApiRequest, env: Env = process.env, deps: Deps = { fetch, now: Date.now }): Promise<ApiResult> {
  const method = req.method.toUpperCase();
  if (method !== 'GET' && method !== 'POST') return fail(405, 'method', 'Esta ruta solo admite GET y POST.');

  try {
    const ctx = await identify(req, env);
    if (isResult(ctx)) return ctx;
    if (ctx.caller.status !== 'active') return fail(403, 'not_active', 'Tu cuenta no está activa.');

    const { config, missing } = readEventsConfig(env);
    if (!config) {
      return fail(503, 'not_configured', 'Al servidor le falta configuración para recibir eventos de Twitch.', { missing });
    }

    // El canal sale del perfil de quien llama, nunca de la petición
    const profile = await ctx.db.from('profiles').select('twitch_user_id').eq('id', ctx.caller.id).maybeSingle();
    if (profile.error) return fail(502, 'profile_read', 'No se pudo leer tu perfil.');
    const twitchUserId = str(profile.data?.twitch_user_id);
    if (!/^\d{1,20}$/.test(twitchUserId)) return fail(409, 'no_twitch', 'Esta cuenta no está conectada a un canal de Twitch.');

    if (tooMany(ctx.caller.id, deps.now())) return fail(429, 'busy', 'Demasiadas consultas seguidas. Prueba en un minuto.');

    if (method === 'GET') {
      return { status: 200, body: { subscriptions: summarize(await listOwn(twitchUserId, config, deps)) } };
    }

    const action = bodyOf(req).action;
    if (action !== 'create' && action !== 'delete') return fail(400, 'bad_request', 'Falta qué hacer: crear o quitar.');

    const existing = await listOwn(twitchUserId, config, deps);
    const results: { type: string; outcome: CreateOutcome | 'deleted'; detail: string }[] = [];

    if (action === 'delete') {
      for (const item of existing) {
        const res = await helix('DELETE', { id: item.id }, undefined, config, deps);
        results.push({
          type: item.type,
          outcome: res.ok || res.status === 404 ? 'deleted' : 'error',
          detail: res.ok || res.status === 404 ? '' : `Twitch respondió con el código ${res.status}.`,
        });
      }
    } else {
      for (const wanted of WANTED) {
        const mine = existing.filter((item) => item.type === wanted.type);
        if (mine.some((item) => ALIVE.includes(item.status))) {
          results.push({ type: wanted.type, outcome: 'already', detail: '' });
          continue;
        }
        // Las caídas (permiso revocado, demasiados fallos...) se quitan antes de volver a crear
        for (const dead of mine) await helix('DELETE', { id: dead.id }, undefined, config, deps);
        results.push({ type: wanted.type, ...(await createOne(wanted, twitchUserId, config, deps)) });
      }
    }

    return { status: 200, body: { results, subscriptions: summarize(await listOwn(twitchUserId, config, deps)) } };
  } catch (err) {
    console.error('[Lalo eventos] suscripciones:', err instanceof Error ? err.message : 'error desconocido');
    return fail(502, 'twitch_error', 'No se pudo hablar con Twitch. Prueba de nuevo en un momento.');
  }
}

interface NodeLikeRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}
interface NodeLikeResponse {
  setHeader(name: string, value: string): unknown;
  status(code: number): { json(body: unknown): unknown };
}

/** Adaptador para Vercel y para Express: los dos entregan (req, res) con esta forma. */
export async function subscriptionsNodeHandler(req: NodeLikeRequest, res: NodeLikeResponse): Promise<void> {
  const result = await handleSubscriptions({ method: req.method ?? 'GET', headers: req.headers, body: req.body });
  res.setHeader('Cache-Control', 'no-store');
  res.status(result.status).json(result.body);
}
