/**
 * server/integrations/handlers.ts
 *
 * Entrada única de las rutas de integraciones. La usan la función de Vercel
 * (api/integraciones.ts) y el servidor local (server/index.ts):
 *
 *   /api/spotify/<acción>         ver spotifyRoutes.ts
 *   /api/kofi/<acción o id>       ver kofi.ts (un id largo es el webhook)
 *   /api/integrations/status      (solo administrador) qué le falta al servidor
 */

import { defaultDeps, fail, failureOf, isFail, type Deps, type IntegrationRequest, type IntegrationResult } from './http.js';
import { KOFI_ACTIONS, handleKofiHook, handleKofiPanel, kofiMissing, publicBase, type KofiAction } from './kofi.js';
import { readSpotifyConfig, redirectUri } from './spotify.js';
import { SPOTIFY_ACTIONS, SPOTIFY_SEATS, handleSpotify, type SpotifyAction } from './spotifyRoutes.js';
import { missingSupabase, type Env } from './store.js';

/** Estado del servidor para la consola del administrador. Solo dice qué variables faltan, nunca su valor. */
async function adminStatus(req: IntegrationRequest, env: Env, deps: Deps): Promise<IntegrationResult> {
  if (req.method.toUpperCase() !== 'GET') return fail(405, 'method', 'Esta ruta solo admite GET.');
  try {
    const caller = await deps.auth(req, env);
    if (isFail(caller)) return caller;
    if (caller.role !== 'admin') return fail(403, 'not_admin', 'Solo para administradores.');
    const store = deps.store(env);
    const database = missingSupabase(env);
    let seats: number | null = null;
    let migration: 'ok' | 'missing' | 'unknown' = 'unknown';
    if (store) {
      try {
        seats = await store.count('spotify');
        migration = 'ok';
      } catch (err) {
        migration = failureOf(err, 'integrations/status').body.code === 'migration_missing' ? 'missing' : 'unknown';
      }
    }
    return {
      status: 200,
      body: {
        database,
        migration,
        fish: { configured: Boolean((env.FISH_AUDIO_API_KEY ?? '').trim()) },
        spotify: { missing: readSpotifyConfig(env).missing, redirectUri: redirectUri(env), seats, seatsMax: SPOTIFY_SEATS },
        kofi: { missing: kofiMissing(env), base: publicBase(env) },
      },
    };
  } catch (err) {
    return failureOf(err, 'integrations/status');
  }
}

/** `group` y `part` salen de la dirección: /api/<group>/<part>. */
export async function handleIntegration(
  group: string,
  part: string,
  req: IntegrationRequest,
  env: Env = process.env,
  overrides: Partial<Deps> = {}
): Promise<IntegrationResult> {
  const deps: Deps = { ...defaultDeps, ...overrides };
  if (group === 'spotify' && SPOTIFY_ACTIONS.includes(part as SpotifyAction)) return handleSpotify(part as SpotifyAction, req, env, deps);
  if (group === 'kofi') {
    if (KOFI_ACTIONS.includes(part as KofiAction)) return handleKofiPanel(part as KofiAction, req, env, deps);
    return handleKofiHook(part, req, env, deps);
  }
  if (group === 'integrations' && part === 'status') return adminStatus(req, env, deps);
  return fail(404, 'not_found', 'Ruta no encontrada.');
}

// ---------- Adaptador para Vercel y Express ----------

interface NodeLikeRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, unknown>;
  body?: unknown;
}
interface NodeLikeResponse {
  setHeader(name: string, value: string | string[]): unknown;
  status(code: number): { json(body: unknown): unknown; end(): unknown };
}

const first = (value: unknown): string => (Array.isArray(value) ? String(value[0] ?? '') : typeof value === 'string' ? value : '');

/** Parámetros de la dirección como texto. Si el servidor no los entrega ya leídos, se sacan de la URL. */
export function queryOf(req: Pick<NodeLikeRequest, 'query' | 'url'>): Record<string, string> {
  const out: Record<string, string> = {};
  const search = (req.url ?? '').split('?')[1] ?? '';
  new URLSearchParams(search).forEach((value, key) => {
    if (!(key in out)) out[key] = value;
  });
  Object.entries(req.query ?? {}).forEach(([key, value]) => {
    const text = first(value);
    if (text) out[key] = text;
  });
  return out;
}

export async function integrationNodeHandler(group: string, part: string, req: NodeLikeRequest, res: NodeLikeResponse): Promise<void> {
  const result = await handleIntegration(group, part, {
    method: req.method ?? 'GET',
    headers: req.headers,
    query: queryOf(req),
    body: req.body,
  });
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (result.cookies?.length) res.setHeader('Set-Cookie', result.cookies);
  if (result.redirect) {
    res.setHeader('Location', result.redirect);
    res.status(302).end();
    return;
  }
  res.status(result.status).json(result.body);
}
