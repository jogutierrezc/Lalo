/**
 * server/integrations/spotifyRoutes.ts
 *
 * Rutas de Spotify:
 *
 *   GET  /api/spotify/status      (sesión) qué falta en el servidor y si la cuenta está conectada
 *   GET  /api/spotify/login       (sesión) dirección de Spotify para dar el permiso
 *   GET  /api/spotify/callback    vuelta desde Spotify: guarda el permiso y regresa a #integraciones
 *   POST /api/spotify/disconnect  (sesión) borra el permiso guardado
 *   GET  /api/spotify/test        (sesión) qué suena ahora en la cuenta de quien llama
 *   GET  /api/spotify/now?k=      (clave privada de widget) qué suena, para la capa de OBS
 *
 * Seguridad de la conexión: el `state` va firmado, caduca a los diez minutos y
 * lleva el perfil de quien la empezó. Además se compara con una cookie que solo
 * tiene el navegador que la empezó, así nadie puede hacer que otra persona
 * conecte su Spotify a una cuenta de Lalo ajena. La vuelta siempre redirige a
 * una dirección fija de la configuración.
 *
 * SIN PROBAR contra Spotify ni contra Supabase reales.
 */

import { encryptSecret, randomId, safeEqual, signState, verifyState } from './crypto.js';
import { cookieOf, fail, failureOf, isFail, supabaseMissing, type Deps, type IntegrationRequest, type IntegrationResult } from './http.js';
import {
  SPOTIFY_SCOPE,
  exchangeCode,
  fetchAccountName,
  forgetProfile,
  nowForProfile,
  readSpotifyConfig,
  rememberAccess,
  type NowResult,
} from './spotify.js';
import { createLimiter, type Env } from './store.js';

export type SpotifyAction = 'status' | 'login' | 'callback' | 'disconnect' | 'test' | 'now';
export const SPOTIFY_ACTIONS: SpotifyAction[] = ['status', 'login', 'callback', 'disconnect', 'test', 'now'];

const STATE_COOKIE = 'lalo_sp_state';
/** Plazas de la app de Spotify en modo desarrollo. */
export const SPOTIFY_SEATS = 5;
/** Lo que dura el permiso de renovación según Spotify. */
const REFRESH_LIFETIME_MS = 182 * 24 * 60 * 60 * 1000;

// Una capa pregunta cada 5 s; con varias fuentes abiertas caben de sobra
const nowLimiter = createLimiter(90);
const panelLimiter = createLimiter(30);
const keyToProfile = new Map<string, { profileId: string | null; until: number }>();

/** Para las pruebas. */
export function resetSpotifyRoutes(): void {
  nowLimiter.clear();
  panelLimiter.clear();
  keyToProfile.clear();
}

const stateCookie = (value: string, secure: boolean, maxAge: number): string =>
  `${STATE_COOKIE}=${value}; Path=/api/spotify; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

/** Lo que recibe el navegador: nunca un permiso, solo lo que pinta la capa. */
function nowBody(result: NowResult, at: number): Record<string, unknown> {
  const { now } = result;
  return {
    status: result.status,
    kind: now.kind,
    playing: now.playing,
    progressMs: now.progressMs,
    ageMs: Math.max(0, at - result.fetchedAt),
    track: now.track,
  };
}

export async function handleSpotify(action: SpotifyAction, req: IntegrationRequest, env: Env, deps: Deps): Promise<IntegrationResult> {
  const method = req.method.toUpperCase();
  const wanted = action === 'disconnect' ? 'POST' : 'GET';
  if (method !== wanted) return fail(405, 'method', `Esta ruta solo admite ${wanted}.`);

  const { config, missing } = readSpotifyConfig(env);

  try {
    // ---------- Capa de OBS ----------
    if (action === 'now') {
      const key = req.query.k ?? '';
      if (!/^[A-Za-z0-9_-]{32,128}$/.test(key)) return fail(400, 'bad_key', 'Falta la clave de la fuente.');
      if (nowLimiter.tooMany(key, deps.now())) return fail(429, 'busy', 'Demasiadas consultas seguidas.');
      const store = deps.store(env);
      if (!config || !store) return { status: 200, body: { status: 'not_configured' } };
      let known = keyToProfile.get(key);
      if (!known || known.until < deps.now()) {
        known = { profileId: await store.profileByWidgetKey(key), until: deps.now() + 60_000 };
        keyToProfile.set(key, known);
        if (keyToProfile.size > 1000) keyToProfile.delete(keyToProfile.keys().next().value as string);
      }
      if (!known.profileId) return fail(404, 'unknown_key', 'La clave de la fuente no vale.');
      const result = await nowForProfile(known.profileId, config, { fetch: deps.fetch, now: deps.now, store });
      return { status: 200, body: nowBody(result, deps.now()) };
    }

    // ---------- Vuelta desde Spotify ----------
    if (action === 'callback') {
      const back = (code: string): IntegrationResult => ({
        status: 302,
        body: {},
        redirect: `${config ? config.returnTo : '/#integraciones'}?spotify=${code}`,
        cookies: [stateCookie('', Boolean(config?.redirectUri.startsWith('https:')), 0)],
      });
      const store = deps.store(env);
      if (!config || !store) return back('not_configured');
      const claims = verifyState(req.query.state, config.key, deps.now());
      const cookie = cookieOf(req, STATE_COOKIE);
      if (!claims || !cookie || !safeEqual(cookie, claims.nonce)) return back('bad_state');
      if (req.query.error) return back(req.query.error === 'access_denied' ? 'denied' : 'error');
      const code = req.query.code ?? '';
      if (!code || code.length > 2000) return back('error');
      if (!(await store.profileActive(claims.profileId))) return back('error');

      const tokens = await exchangeCode(code, config, deps.fetch);
      if (tokens === 'invalid_grant' || !tokens.refreshToken) return back('error');
      const account = await fetchAccountName(tokens.accessToken, deps.fetch);
      // La cuenta no está en la lista de usuarios de la app de Spotify: no serviría de nada guardarla
      if (account === 'forbidden') return back('not_allowed');
      await store.upsert(claims.profileId, 'spotify', {
        secret_enc: encryptSecret(tokens.refreshToken, config.key),
        account_name: account?.name || null,
        status: 'connected',
        connected_at: new Date(deps.now()).toISOString(),
        last_error: null,
        last_error_at: null,
      });
      forgetProfile(claims.profileId);
      rememberAccess(claims.profileId, tokens, deps.now());
      return back('connected');
    }

    // ---------- Panel (con sesión) ----------
    const caller = await deps.auth(req, env);
    if (isFail(caller)) return caller;
    if (panelLimiter.tooMany(caller.id, deps.now())) return fail(429, 'busy', 'Demasiadas consultas seguidas. Prueba en un minuto.');
    const noDb = supabaseMissing(env);
    const store = deps.store(env);

    if (action === 'status') {
      if (!config || !store) return { status: 200, body: { configured: false, missing: [...missing, ...(noDb ? (noDb.body.missing as string[]) : [])] } };
      const row = await store.get(caller.id, 'spotify');
      const connectedAt = row?.connected_at ? Date.parse(row.connected_at) : NaN;
      return {
        status: 200,
        body: {
          configured: true,
          missing: [],
          state: !row ? 'none' : row.status === 'expired' || !row.secret_enc ? 'expired' : 'connected',
          accountName: row?.account_name ?? '',
          connectedAt: row?.connected_at ?? null,
          expiresAt: Number.isFinite(connectedAt) ? new Date(connectedAt + REFRESH_LIFETIME_MS).toISOString() : null,
          seats: await store.count('spotify'),
          seatsMax: SPOTIFY_SEATS,
        },
      };
    }

    if (!config) return fail(503, 'not_configured', 'Al servidor le falta configuración para conectar con Spotify.', { missing });
    if (!store) return noDb ?? fail(503, 'not_configured', 'Al servidor le falta configuración.');

    if (action === 'login') {
      // Antes de mandar a nadie a Spotify se comprueba que la tabla existe
      await store.get(caller.id, 'spotify');
      const nonce = randomId(18);
      const state = signState({ profileId: caller.id, nonce }, config.key, deps.now());
      const query = new URLSearchParams({
        client_id: config.clientId,
        response_type: 'code',
        redirect_uri: config.redirectUri,
        scope: SPOTIFY_SCOPE,
        state,
      });
      return {
        status: 200,
        body: { url: `https://accounts.spotify.com/authorize?${query.toString()}` },
        cookies: [stateCookie(nonce, config.redirectUri.startsWith('https:'), 600)],
      };
    }

    if (action === 'disconnect') {
      await store.remove(caller.id, 'spotify');
      forgetProfile(caller.id);
      return { status: 200, body: { state: 'none' } };
    }

    // test
    const result = await nowForProfile(caller.id, config, { fetch: deps.fetch, now: deps.now, store });
    return { status: 200, body: nowBody(result, deps.now()) };
  } catch (err) {
    if (action === 'callback') {
      console.error('[Lalo integraciones] spotify/callback:', err instanceof Error ? err.message : 'error desconocido');
      return { status: 302, body: {}, redirect: `${config ? config.returnTo : '/#integraciones'}?spotify=error` };
    }
    return failureOf(err, `spotify/${action}`);
  }
}
