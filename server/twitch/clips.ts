/**
 * server/twitch/clips.ts
 *
 * GET /api/twitch/clip: busca un corto de Twitch para el saludo de raid. La usan
 * la función de Vercel (api/twitch/clip.ts) y el servidor local (server/index.ts).
 *
 *   ?login=<canal>&days=<n>   el corto más visto del canal en los últimos n días
 *                             (si no hay ninguno, el más visto de siempre)
 *   ?id=<id del corto>        ese corto concreto
 *   ?check=1                  solo dice si el servidor está configurado
 *
 * Respuestas (siempre JSON con `status`):
 *   200 ok              { clip, broadcaster }
 *   200 no_clips        { broadcaster }           el canal existe y no tiene cortos
 *   400 bad_request     { error }
 *   404 not_found       { error }                 no existe el canal o el corto
 *   429 busy            { error }
 *   502 twitch_error    { error }
 *   503 not_configured  { error, missing }        faltan variables en el servidor
 *
 * Twitch (comprobado en dev.twitch.tv el 2026-10-03):
 *   - Token de aplicación: POST https://id.twitch.tv/oauth2/token con client_id,
 *     client_secret y grant_type=client_credentials; responde access_token y expires_in.
 *   - GET https://api.twitch.tv/helix/users?login=   (id, login, display_name)
 *   - GET https://api.twitch.tv/helix/clips?broadcaster_id= | ?id=, con started_at,
 *     ended_at y first. La lista llega ordenada por visitas, de más a menos.
 *   - GET https://api.twitch.tv/helix/games?id=      (name)
 *
 * El secreto solo se lee aquí, en el servidor. La ruta no pide sesión porque la
 * llama la fuente de OBS, que no la tiene: por eso valida la entrada, guarda las
 * respuestas un rato y limita las consultas a Twitch por minuto.
 *
 * SIN PROBAR contra la API real de Twitch.
 */

export type Env = Record<string, string | undefined>;

export interface ClipResult {
  status: number;
  body: Record<string, unknown>;
}

export type ClipQuery =
  | { ok: true; mode: 'check' }
  | { ok: true; mode: 'login'; login: string; days: number }
  | { ok: true; mode: 'id'; id: string }
  | { ok: false; error: string };

const LOGIN = /^[a-z0-9_]{1,25}$/;
const CLIP_ID = /^[A-Za-z0-9_-]{4,120}$/;
export const DEFAULT_DAYS = 30;
export const MAX_DAYS = 365;

const first = (value: unknown): string | undefined => {
  const item = Array.isArray(value) ? value[0] : value;
  return typeof item === 'string' ? item : undefined;
};

/** Valida la consulta. Solo pasan un usuario de Twitch o un id de corto con su forma exacta. */
export function validateClipQuery(query: Record<string, unknown>): ClipQuery {
  if (first(query.check) !== undefined) return { ok: true, mode: 'check' };
  const login = first(query.login);
  const id = first(query.id);
  if (login !== undefined && id !== undefined) return { ok: false, error: 'Indica un canal o un corto, no los dos.' };
  if (id !== undefined) {
    return CLIP_ID.test(id) ? { ok: true, mode: 'id', id } : { ok: false, error: 'Ese identificador de corto no es válido.' };
  }
  if (login !== undefined) {
    const clean = login.trim().toLowerCase();
    if (!LOGIN.test(clean)) {
      return { ok: false, error: 'El canal solo puede llevar letras, números y guion bajo, hasta 25 caracteres.' };
    }
    const rawDays = first(query.days);
    let days = DEFAULT_DAYS;
    if (rawDays !== undefined) {
      if (!/^\d{1,3}$/.test(rawDays)) return { ok: false, error: 'Los días deben ser un número entre 1 y 365.' };
      days = Number(rawDays);
      if (days < 1 || days > MAX_DAYS) return { ok: false, error: 'Los días deben ser un número entre 1 y 365.' };
    }
    return { ok: true, mode: 'login', login: clean, days };
  }
  return { ok: false, error: 'Falta el canal o el corto.' };
}

/** Client ID y secreto del servidor, y los nombres de lo que falte. */
export function readTwitchConfig(env: Env): { clientId: string; clientSecret: string; missing: string[] } {
  // El Client ID es público y ya existe para el inicio de sesión con el prefijo VITE_
  const clientId = (env.TWITCH_CLIENT_ID ?? env.VITE_TWITCH_CLIENT_ID ?? '').trim();
  const clientSecret = (env.TWITCH_CLIENT_SECRET ?? '').trim();
  const missing: string[] = [];
  if (!clientId) missing.push('VITE_TWITCH_CLIENT_ID');
  if (!clientSecret) missing.push('TWITCH_CLIENT_SECRET');
  return { clientId, clientSecret, missing };
}

// ---------- Memoria del proceso ----------

type Fetch = typeof fetch;

interface Deps {
  fetch: Fetch;
  now: () => number;
}

let token: { value: string; clientId: string; expiresAt: number } | null = null;
const cache = new Map<string, { until: number; result: ClipResult }>();
let calls: number[] = [];

const CACHE_OK_MS = 5 * 60 * 1000;
const CACHE_EMPTY_MS = 60 * 1000;
const CACHE_MAX = 200;
/** Búsquedas nuevas en Twitch por minuto y por proceso. Las guardadas no cuentan. */
export const LOOKUPS_PER_MINUTE = 40;
const TWITCH_TIMEOUT_MS = 6000;

/** Para las pruebas: olvida el token, las respuestas guardadas y el contador. */
export function resetClipState(): void {
  token = null;
  cache.clear();
  calls = [];
}

class TwitchError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number
  ) {
    super(message);
  }
}

/** Token de aplicación, guardado en memoria hasta poco antes de caducar. Lo usa también server/twitch/subscriptions.ts. */
export async function appToken(clientId: string, clientSecret: string, deps: Deps, force = false): Promise<string> {
  const now = deps.now();
  if (!force && token && token.clientId === clientId && token.expiresAt > now + 60_000) return token.value;

  const res = await deps.fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }).toString(),
    signal: AbortSignal.timeout(TWITCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new TwitchError(
      res.status === 400 || res.status === 401 || res.status === 403
        ? 'Twitch rechazó el Client ID o el Client Secret del servidor.'
        : `Twitch respondió con el código ${res.status} al pedir el permiso.`,
      res.status
    );
  }
  const data = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
  if (typeof data.access_token !== 'string' || !data.access_token) {
    throw new TwitchError('Twitch no devolvió un permiso válido.', 502);
  }
  const seconds = typeof data.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : 3600;
  token = { value: data.access_token, clientId, expiresAt: now + seconds * 1000 };
  return token.value;
}

async function helix(
  path: string,
  params: Record<string, string>,
  config: { clientId: string; clientSecret: string },
  deps: Deps
): Promise<Record<string, unknown>[]> {
  const url = `https://api.twitch.tv/helix/${path}?${new URLSearchParams(params).toString()}`;
  const call = async (bearer: string) =>
    deps.fetch(url, {
      headers: { Authorization: `Bearer ${bearer}`, 'Client-Id': config.clientId },
      signal: AbortSignal.timeout(TWITCH_TIMEOUT_MS),
    });

  let res = await call(await appToken(config.clientId, config.clientSecret, deps));
  // Un permiso caducado o revocado antes de tiempo: se pide otro una sola vez
  if (res.status === 401) res = await call(await appToken(config.clientId, config.clientSecret, deps, true));
  if (!res.ok) throw new TwitchError(`Twitch respondió con el código ${res.status}.`, res.status);
  const body = (await res.json()) as { data?: unknown };
  return Array.isArray(body.data) ? (body.data as Record<string, unknown>[]) : [];
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

async function gameName(gameId: string, config: { clientId: string; clientSecret: string }, deps: Deps): Promise<string | null> {
  if (!/^\d{1,12}$/.test(gameId)) return null;
  try {
    const games = await helix('games', { id: gameId }, config, deps);
    return str(games[0]?.name) || null;
  } catch {
    // El juego es un adorno: si falla, el corto se entrega sin él
    return null;
  }
}

async function toClip(raw: Record<string, unknown>, config: { clientId: string; clientSecret: string }, deps: Deps) {
  return {
    id: str(raw.id),
    title: str(raw.title),
    duration: typeof raw.duration === 'number' ? raw.duration : Number(raw.duration) || 0,
    creator: str(raw.creator_name),
    thumbnail: str(raw.thumbnail_url),
    views: typeof raw.view_count === 'number' ? raw.view_count : 0,
    broadcaster: str(raw.broadcaster_name),
    game: await gameName(str(raw.game_id), config, deps),
  };
}

const fail = (status: number, code: string, error: string, extra: Record<string, unknown> = {}): ClipResult => ({
  status,
  body: { status: code, error, ...extra },
});

async function lookup(query: Exclude<ClipQuery, { ok: false } | { mode: 'check' }>, config: { clientId: string; clientSecret: string }, deps: Deps): Promise<ClipResult> {
  if (query.mode === 'id') {
    const clips = await helix('clips', { id: query.id }, config, deps);
    if (!clips.length) return fail(404, 'not_found', 'Ese corto no existe o ya no está disponible.');
    const clip = await toClip(clips[0], config, deps);
    return { status: 200, body: { status: 'ok', clip, broadcaster: clip.broadcaster } };
  }

  const users = await helix('users', { login: query.login }, config, deps);
  const user = users[0];
  if (!user || !str(user.id)) return fail(404, 'not_found', `No existe el canal «${query.login}» en Twitch.`);
  const broadcaster = str(user.display_name) || query.login;

  // Primero los últimos días; si no hay nada, el más visto de siempre
  const end = new Date(deps.now());
  const start = new Date(end.getTime() - query.days * 24 * 60 * 60 * 1000);
  let clips = await helix(
    'clips',
    { broadcaster_id: str(user.id), started_at: start.toISOString(), ended_at: end.toISOString(), first: '5' },
    config,
    deps
  );
  if (!clips.length) clips = await helix('clips', { broadcaster_id: str(user.id), first: '5' }, config, deps);
  if (!clips.length) return { status: 200, body: { status: 'no_clips', broadcaster } };

  // Twitch ya los ordena por visitas; se vuelve a ordenar por si la página llega revuelta
  const best = [...clips].sort((a, b) => (Number(b.view_count) || 0) - (Number(a.view_count) || 0))[0];
  return { status: 200, body: { status: 'ok', clip: await toClip(best, config, deps), broadcaster } };
}

/** Atiende una consulta ya separada en sus parámetros. */
export async function handleClipRequest(
  rawQuery: Record<string, unknown>,
  env: Env = process.env,
  deps: Deps = { fetch, now: Date.now }
): Promise<ClipResult> {
  const query = validateClipQuery(rawQuery);
  if (!query.ok) return fail(400, 'bad_request', query.error);

  const config = readTwitchConfig(env);
  if (config.missing.length > 0) {
    return fail(503, 'not_configured', 'Al servidor le falta la configuración de Twitch para buscar cortos.', {
      missing: config.missing,
    });
  }
  if (query.mode === 'check') return { status: 200, body: { status: 'ok', configured: true } };

  const now = deps.now();
  const key = query.mode === 'id' ? `id:${query.id}` : `login:${query.login}:${query.days}`;
  const cached = cache.get(key);
  if (cached && cached.until > now) return cached.result;

  calls = calls.filter((at) => now - at < 60_000);
  if (calls.length >= LOOKUPS_PER_MINUTE) {
    return fail(429, 'busy', 'Demasiadas búsquedas de cortos seguidas. Prueba en un minuto.');
  }
  calls.push(now);

  try {
    const result = await lookup(query, config, deps);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, { until: now + (result.body.status === 'ok' ? CACHE_OK_MS : CACHE_EMPTY_MS), result });
    return result;
  } catch (err) {
    if (err instanceof TwitchError) {
      console.error(`[Lalo cortos] Twitch: ${err.message}`);
      return fail(502, 'twitch_error', err.message);
    }
    console.error('[Lalo cortos] Error inesperado:', err instanceof Error ? err.message : 'desconocido');
    return fail(502, 'twitch_error', 'No se pudo consultar a Twitch.');
  }
}

interface NodeLikeRequest {
  method?: string;
  url?: string;
  query?: Record<string, unknown>;
}
interface NodeLikeResponse {
  setHeader(name: string, value: string): unknown;
  status(code: number): { json(body: unknown): unknown };
}

/** Adaptador para Vercel y para Express: los dos entregan (req, res) con esta forma. */
export async function clipNodeHandler(req: NodeLikeRequest, res: NodeLikeResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
    res.status(405).json({ status: 'method', error: 'Esta ruta solo admite GET.' });
    return;
  }
  let query: Record<string, unknown> = req.query ?? {};
  if (!req.query && req.url) {
    query = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams.entries());
  }
  const result = await handleClipRequest(query);
  res.status(result.status).json(result.body);
}
