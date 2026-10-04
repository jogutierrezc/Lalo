/**
 * server/integrations/spotify.ts
 *
 * Lo que Lalo habla con Spotify: configuración, intercambio y renovación de
 * permisos, y la lectura de «qué suena ahora» reducida a lo que usa la capa.
 *
 * Spotify (comprobado en developer.spotify.com el 2026-10-04):
 *   - GET https://api.spotify.com/v1/me/player/currently-playing, permiso
 *     user-read-currently-playing. Campos: is_playing, progress_ms, timestamp,
 *     currently_playing_type (track, episode, ad, unknown) e item (puede ser
 *     null). additional_types=episode para los pódcast. Códigos descritos: 200,
 *     401, 403 y 429. La página no describe el 204; aquí una respuesta vacía se
 *     trata como «no suena nada».
 *   - Flujo Authorization Code: https://accounts.spotify.com/authorize y
 *     POST https://accounts.spotify.com/api/token con «Authorization: Basic
 *     base64(client_id:client_secret)» y cuerpo application/x-www-form-urlencoded.
 *   - El permiso de acceso dura una hora. El de renovación dura 6 meses y puede
 *     no venir uno nuevo en cada renovación: entonces se sigue usando el anterior.
 *     invalid_grant: caducado o revocado, hay que volver a conectar.
 *   - La dirección de vuelta debe ser https; para local solo vale
 *     http://127.0.0.1:PUERTO (localhost no).
 *
 * El permiso de renovación se guarda cifrado (crypto.ts). El de acceso vive en
 * memoria. Ninguno sale hacia el navegador ni se escribe en el registro.
 *
 * SIN PROBAR contra Spotify real.
 */

import { decryptSecret, encryptSecret, parseKey } from './crypto.js';
import type { Env, Store } from './store.js';

export const SPOTIFY_SCOPE = 'user-read-currently-playing';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const NOW_URL = 'https://api.spotify.com/v1/me/player/currently-playing?additional_types=episode';
const ME_URL = 'https://api.spotify.com/v1/me';
const TIMEOUT_MS = 8000;
/** Cuánto vale una lectura para todas las fuentes de OBS del mismo streamer. */
export const NOW_CACHE_MS = 4000;
/** Cuánto se recuerda que una cuenta no está conectada, para no preguntar a la base en cada consulta. */
export const NEGATIVE_CACHE_MS = 15000;

export interface SpotifyConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** A dónde vuelve el navegador al terminar. Sale de la configuración, nunca de la petición. */
  returnTo: string;
  key: Buffer;
}

const REDIRECT_OK = /^(https:\/\/[a-z0-9.-]+(:\d{1,5})?|http:\/\/127\.0\.0\.1:\d{1,5})\/api\/spotify\/callback$/i;
const ORIGIN_OK = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i;

/** Dirección de vuelta registrada en Spotify: la variable, o el dominio de producción de Vercel. */
export function redirectUri(env: Env): string {
  const explicit = (env.SPOTIFY_REDIRECT_URI ?? '').trim();
  const host = (env.VERCEL_PROJECT_PRODUCTION_URL ?? '').trim();
  const uri = explicit || (host ? `https://${host}/api/spotify/callback` : '');
  return REDIRECT_OK.test(uri) ? uri : '';
}

export function readSpotifyConfig(env: Env): { config: SpotifyConfig | null; missing: string[] } {
  const clientId = (env.SPOTIFY_CLIENT_ID ?? '').trim();
  const clientSecret = (env.SPOTIFY_CLIENT_SECRET ?? '').trim();
  const redirect = redirectUri(env);
  const key = parseKey(env.INTEGRATIONS_ENC_KEY);
  const missing: string[] = [];
  if (!clientId) missing.push('SPOTIFY_CLIENT_ID');
  if (!clientSecret) missing.push('SPOTIFY_CLIENT_SECRET');
  if (!redirect) missing.push('SPOTIFY_REDIRECT_URI');
  if (!key) missing.push('INTEGRATIONS_ENC_KEY');
  if (missing.length > 0 || !key) return { config: null, missing };
  const front = (env.FRONTEND_ORIGIN ?? '').trim().replace(/\/+$/, '');
  const origin = ORIGIN_OK.test(front) ? front : new URL(redirect).origin;
  return { config: { clientId, clientSecret, redirectUri: redirect, returnTo: `${origin}/#integraciones`, key }, missing };
}

// ---------- De la respuesta de Spotify a lo que usa la capa ----------

export interface NowTrack {
  /** Cambia cuando cambia la canción. */
  id: string;
  title: string;
  artists: string;
  album: string;
  /** Dirección de la portada, o null (archivo local o sin imagen). */
  art: string | null;
  durationMs: number;
  explicit: boolean;
  local: boolean;
  /** Enlace de vuelta a Spotify. */
  url: string | null;
}

export interface NowPlaying {
  kind: 'track' | 'episode' | 'ad' | 'unknown' | 'none';
  playing: boolean;
  progressMs: number;
  track: NowTrack | null;
}

export const NOTHING: NowPlaying = { kind: 'none', playing: false, progressMs: 0, track: null };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
const ms = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0);
const httpsUrl = (value: unknown): string | null =>
  typeof value === 'string' && value.length <= 400 && /^https:\/\/[a-z0-9.-]+\//i.test(value) ? value : null;

/** La imagen más pequeña que aún se ve bien en la capa (300 px o más); si no hay, la primera. */
function pickArt(images: unknown): string | null {
  if (!Array.isArray(images)) return null;
  const valid = images.filter(isObject).filter((image) => httpsUrl(image.url));
  const big = valid.filter((image) => typeof image.width === 'number' && image.width >= 300).sort((a, b) => (a.width as number) - (b.width as number));
  return httpsUrl((big[0] ?? valid[0])?.url);
}

/** Reduce la respuesta de «currently-playing» a lo que necesita la capa. Tolera cualquier forma. */
export function normalizeNowPlaying(body: unknown): NowPlaying {
  if (!isObject(body)) return NOTHING;
  const type = body.currently_playing_type;
  const kind: NowPlaying['kind'] = type === 'track' || type === 'episode' || type === 'ad' ? type : 'unknown';
  const playing = body.is_playing === true;
  const progressMs = ms(body.progress_ms);
  const item = isObject(body.item) ? body.item : null;
  if (kind === 'ad' || !item) return { kind: item ? kind : kind === 'ad' ? 'ad' : 'none', playing, progressMs, track: null };

  const title = text(item.name, 200);
  if (!title) return { kind: 'none', playing, progressMs, track: null };
  const local = item.is_local === true;
  const urls = isObject(item.external_urls) ? item.external_urls : {};
  let artists = '';
  let album = '';
  let art: string | null = null;
  if (isObject(item.show)) {
    // Pódcast: el programa hace de artista
    artists = text(item.show.name, 200);
    art = pickArt(item.images) ?? pickArt(item.show.images);
  } else {
    artists = (Array.isArray(item.artists) ? item.artists : [])
      .filter(isObject)
      .map((artist) => text(artist.name, 80))
      .filter(Boolean)
      .slice(0, 6)
      .join(', ')
      .slice(0, 200);
    const record = isObject(item.album) ? item.album : {};
    album = text(record.name, 200);
    art = local ? null : pickArt(record.images);
  }
  const id = text(item.id, 80) || text(item.uri, 120) || `${title}|${artists}`.slice(0, 200);
  return {
    kind: kind === 'unknown' ? (isObject(item.show) ? 'episode' : 'track') : kind,
    playing,
    progressMs,
    track: { id, title, artists, album, art, durationMs: ms(item.duration_ms), explicit: item.explicit === true, local, url: httpsUrl(urls.spotify) },
  };
}

/** Segundos de espera que pide Spotify en un 429. Entre 1 y 120; 5 si no lo dice. */
export function retryAfterSeconds(value: string | null | undefined): number {
  const seconds = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(120, seconds) : 5;
}

// ---------- Permisos ----------

type Fetch = typeof fetch;
export interface Tokens {
  accessToken: string;
  expiresInSec: number;
  /** Puede no venir al renovar: se conserva el anterior. */
  refreshToken: string | null;
}

async function tokenRequest(params: Record<string, string>, config: SpotifyConfig, doFetch: Fetch): Promise<Tokens | 'invalid_grant'> {
  const res = await doFetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !body) {
    if (body?.error === 'invalid_grant') return 'invalid_grant';
    // Sin el cuerpo de la respuesta: podría repetir datos de la petición
    throw new Error(`Spotify respondió con el código ${res.status} al pedir el permiso.`);
  }
  if (typeof body.access_token !== 'string' || !body.access_token) throw new Error('Spotify no devolvió un permiso de acceso.');
  return {
    accessToken: body.access_token,
    expiresInSec: typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 3600,
    refreshToken: typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : null,
  };
}

export const exchangeCode = (code: string, config: SpotifyConfig, doFetch: Fetch) =>
  tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: config.redirectUri }, config, doFetch);

export const refreshTokens = (refreshToken: string, config: SpotifyConfig, doFetch: Fetch) =>
  tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken }, config, doFetch);

/** Nombre visible de la cuenta, para «Conectado como». `forbidden`: la cuenta no está en la lista de la app. */
export async function fetchAccountName(accessToken: string, doFetch: Fetch): Promise<{ name: string } | 'forbidden' | null> {
  try {
    const res = await doFetch(ME_URL, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 403) return 'forbidden';
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { name: text(body?.display_name, 60) || text(body?.id, 60) };
  } catch {
    return null;
  }
}

// ---------- Lectura con memoria ----------

export type NowStatus = 'ok' | 'not_connected' | 'expired' | 'forbidden' | 'rate_limited' | 'error';
export interface NowResult {
  status: NowStatus;
  now: NowPlaying;
  /** Cuándo se leyó de Spotify (ms). La capa suma lo que ha pasado desde entonces. */
  fetchedAt: number;
}

interface Memory {
  access: Map<string, { token: string; expiresAt: number }>;
  results: Map<string, { result: NowResult; until: number }>;
  inflight: Map<string, Promise<NowResult>>;
  /** Spotify limita por aplicación: mientras dure la espera no se le pregunta por nadie. */
  blockedUntil: number;
}
const memory: Memory = { access: new Map(), results: new Map(), inflight: new Map(), blockedUntil: 0 };

export function rememberAccess(profileId: string, tokens: Tokens, now: number): void {
  // Un minuto de margen para no usar un permiso a punto de caducar
  memory.access.set(profileId, { token: tokens.accessToken, expiresAt: now + Math.max(60, tokens.expiresInSec - 60) * 1000 });
}

export function forgetProfile(profileId: string): void {
  memory.access.delete(profileId);
  memory.results.delete(profileId);
}

/** Para las pruebas. */
export function resetSpotifyMemory(): void {
  memory.access.clear();
  memory.results.clear();
  memory.inflight.clear();
  memory.blockedUntil = 0;
}

interface ReadDeps {
  fetch: Fetch;
  now: () => number;
  store: Store;
}

async function accessFor(profileId: string, config: SpotifyConfig, deps: ReadDeps, force = false): Promise<string | NowStatus> {
  const known = memory.access.get(profileId);
  if (!force && known && known.expiresAt > deps.now()) return known.token;
  const row = await deps.store.get(profileId, 'spotify');
  if (!row) return 'not_connected';
  if (row.status === 'expired' || !row.secret_enc) return 'expired';
  const refresh = decryptSecret(row.secret_enc, config.key);
  // Guardado con otra clave de cifrado: no se puede leer, hay que conectar de nuevo
  if (!refresh) return 'expired';
  const tokens = await refreshTokens(refresh, config, deps.fetch);
  if (tokens === 'invalid_grant') {
    await deps.store.upsert(profileId, 'spotify', { status: 'expired', secret_enc: null });
    memory.access.delete(profileId);
    return 'expired';
  }
  if (tokens.refreshToken && tokens.refreshToken !== refresh) {
    await deps.store.upsert(profileId, 'spotify', { secret_enc: encryptSecret(tokens.refreshToken, config.key), status: 'connected' });
  }
  rememberAccess(profileId, tokens, deps.now());
  return tokens.accessToken;
}

async function readNow(profileId: string, config: SpotifyConfig, deps: ReadDeps): Promise<{ result: NowResult; ttl: number }> {
  const at = deps.now();
  const done = (status: NowStatus, now: NowPlaying = NOTHING, ttl = NOW_CACHE_MS) => ({ result: { status, now, fetchedAt: at }, ttl });
  const previous = memory.results.get(profileId)?.result;
  if (memory.blockedUntil > at) return done('rate_limited', previous?.now ?? NOTHING, Math.min(memory.blockedUntil - at, 120_000));

  let token = await accessFor(profileId, config, deps);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (token === 'not_connected' || token === 'expired') return done(token, NOTHING, NEGATIVE_CACHE_MS);
    const res = await deps.fetch(NOW_URL, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 401 && attempt === 0) {
      // Permiso de acceso caducado antes de tiempo: se renueva una vez
      token = await accessFor(profileId, config, deps, true);
      continue;
    }
    if (res.status === 429) {
      const wait = retryAfterSeconds(res.headers.get('retry-after')) * 1000;
      memory.blockedUntil = at + wait;
      return done('rate_limited', previous?.now ?? NOTHING, wait);
    }
    if (res.status === 403) return done('forbidden', NOTHING, NEGATIVE_CACHE_MS);
    if (res.status === 204) return done('ok');
    if (!res.ok) return done('error', previous?.now ?? NOTHING);
    const raw = await res.text();
    if (!raw.trim()) return done('ok');
    let body: unknown = null;
    try {
      body = JSON.parse(raw);
    } catch {
      return done('error', previous?.now ?? NOTHING);
    }
    return done('ok', normalizeNowPlaying(body));
  }
  return done('error');
}

/**
 * Qué suena ahora en la cuenta de ese perfil. Varias fuentes de OBS comparten la
 * misma lectura durante unos segundos, y dos consultas a la vez esperan la misma.
 */
export async function nowForProfile(profileId: string, config: SpotifyConfig, deps: ReadDeps): Promise<NowResult> {
  const cached = memory.results.get(profileId);
  if (cached && cached.until > deps.now()) return cached.result;
  const running = memory.inflight.get(profileId);
  if (running) return running;
  const work = readNow(profileId, config, deps)
    .then(({ result, ttl }) => {
      memory.results.set(profileId, { result, until: deps.now() + ttl });
      if (memory.results.size > 500) memory.results.delete(memory.results.keys().next().value as string);
      return result;
    })
    .finally(() => memory.inflight.delete(profileId));
  memory.inflight.set(profileId, work);
  return work;
}
