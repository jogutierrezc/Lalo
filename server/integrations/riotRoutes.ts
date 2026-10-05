/**
 * server/integrations/riotRoutes.ts
 *
 * Rutas de Riot Games («Alertas de juego», League of Legends):
 *
 *   GET  /api/riot/status     (sesión) si el servidor tiene clave y qué cuenta está vinculada
 *   POST /api/riot/link       (sesión) vincula un Riot ID: { riotId: "nombre#etiqueta", platform: "la1", policy: "1.0" }
 *   POST /api/riot/accept     (sesión) acepta la versión nueva de la política con la cuenta ya vinculada: { policy }
 *
 * La política de uso de la integración (src/legal/riot.ts) solo se pide aquí,
 * al vincular: no forma parte de la aceptación general de Lalo. `policy` tiene
 * que ser la versión vigente; se guarda con su fecha junto a la cuenta.
 *   POST /api/riot/unlink     (sesión) borra lo guardado
 *   GET  /api/riot/state?k=   (clave privada de widget) la foto de la cuenta, para la capa de OBS
 *
 * No hay inicio de sesión de Riot (RSO): el streamer escribe su Riot ID y Lalo
 * lo resuelve con account-v1. Es un dato público; nada impide escribir el de
 * otra persona, y el RSO lo cerraría más adelante.
 *
 * La clave de Riot (RIOT_API_KEY) solo se usa para la cabecera de las
 * peticiones. Ninguna respuesta la lleva, ni el PUUID.
 *
 * SIN PROBAR contra Riot ni contra Supabase reales.
 */

import { fail, failureOf, isFail, supabaseMissing, type Deps, type IntegrationRequest, type IntegrationResult } from './http.js';
import {
  RIOT_PLATFORMS,
  forgetRiotProfile,
  parseRiotId,
  platformOf,
  readRiotKey,
  readRiotMeta,
  resolveAccount,
  snapshotForProfile,
  type RiotSnapshot,
} from './riot.js';
import { RIOT_POLICY_VERSION } from './riotPolicy.js';
import { MigrationMissingError, createLimiter, type Env } from './store.js';

export type RiotAction = 'status' | 'link' | 'accept' | 'unlink' | 'state';
export const RIOT_ACTIONS: RiotAction[] = ['status', 'link', 'accept', 'unlink', 'state'];

const NO_POLICY = 'Para vincular tu cuenta hay que aceptar la política de uso de la integración con Riot Games.';
/** Versión de la política que aceptó la cuenta, tal como quedó guardada. Vacío: ninguna. */
const acceptedPolicy = (meta: unknown): string => {
  const value = meta && typeof meta === 'object' ? (meta as Record<string, unknown>).policy : '';
  return typeof value === 'string' && /^\d+(\.\d+)*$/.test(value) ? value : '';
};

// Una capa pregunta cada 30 s; con varias fuentes abiertas caben de sobra
const stateLimiter = createLimiter(30);
const panelLimiter = createLimiter(20);
const keyToProfile = new Map<string, { profileId: string | null; until: number }>();

/** Para las pruebas. */
export function resetRiotRoutes(): void {
  stateLimiter.clear();
  panelLimiter.clear();
  keyToProfile.clear();
}

const NO_MIGRATION = 'Falta aplicar la migración 0015 (Riot) en Supabase.';

/** Lo que recibe el navegador de OBS: la foto, sin el PUUID y sin nada de la clave. */
function stateBody(snapshot: RiotSnapshot, at: number): Record<string, unknown> {
  return {
    status: snapshot.status,
    ageMs: Math.max(0, at - snapshot.fetchedAt),
    riotId: snapshot.riotId,
    rank: snapshot.rank,
    live: snapshot.live,
    last: snapshot.last,
    mastery: snapshot.mastery,
  };
}

/** Sin la migración 0015 faltan la columna `meta` y el proveedor «riot» en el check de la tabla. */
function migrationFail(err: unknown): IntegrationResult | null {
  if (err instanceof MigrationMissingError) return fail(503, 'migration_missing', NO_MIGRATION);
  // 23514: el check de `provider` no admite «riot». PGRST204: PostgREST no conoce la columna `meta`
  if (err instanceof Error && /^Supabase: (23514|PGRST204)$/.test(err.message)) return fail(503, 'migration_missing', NO_MIGRATION);
  return null;
}

export async function handleRiot(action: RiotAction, req: IntegrationRequest, env: Env, deps: Deps): Promise<IntegrationResult> {
  const method = req.method.toUpperCase();
  const wanted = action === 'link' || action === 'unlink' || action === 'accept' ? 'POST' : 'GET';
  if (method !== wanted) return fail(405, 'method', `Esta ruta solo admite ${wanted}.`);

  const key = readRiotKey(env);

  try {
    // ---------- Capa de OBS ----------
    if (action === 'state') {
      const widgetKey = req.query.k ?? '';
      if (!/^[A-Za-z0-9_-]{32,128}$/.test(widgetKey)) return fail(400, 'bad_key', 'Falta la clave de la fuente.');
      if (stateLimiter.tooMany(widgetKey, deps.now())) return fail(429, 'busy', 'Demasiadas consultas seguidas.');
      const store = deps.store(env);
      if (!key || !store) return { status: 200, body: { status: 'not_configured' } };
      let known = keyToProfile.get(widgetKey);
      if (!known || known.until < deps.now()) {
        known = { profileId: await store.profileByWidgetKey(widgetKey), until: deps.now() + 60_000 };
        keyToProfile.set(widgetKey, known);
        if (keyToProfile.size > 1000) keyToProfile.delete(keyToProfile.keys().next().value as string);
      }
      if (!known.profileId) return fail(404, 'unknown_key', 'La clave de la fuente no vale.');
      const snapshot = await snapshotForProfile(known.profileId, key, { fetch: deps.fetch, now: deps.now, store });
      return { status: 200, body: stateBody(snapshot, deps.now()) };
    }

    // ---------- Panel (con sesión) ----------
    const caller = await deps.auth(req, env);
    if (isFail(caller)) return caller;
    if (panelLimiter.tooMany(caller.id, deps.now())) return fail(429, 'busy', 'Demasiadas consultas seguidas. Prueba en un minuto.');
    const noDb = supabaseMissing(env);
    const store = deps.store(env);
    const platforms = RIOT_PLATFORMS.map((item) => ({ id: item.id, name: item.name }));

    if (action === 'status') {
      if (!key || !store) {
        return {
          status: 200,
          body: { configured: false, missing: [...(key ? [] : ['RIOT_API_KEY']), ...(noDb ? (noDb.body.missing as string[]) : [])], platforms, policyCurrent: RIOT_POLICY_VERSION },
        };
      }
      const row = await store.get(caller.id, 'riot');
      const meta = readRiotMeta(row?.meta);
      return {
        status: 200,
        body: {
          configured: true,
          missing: [],
          platforms,
          state: meta ? 'linked' : 'none',
          riotId: meta ? `${meta.gameName}#${meta.tagLine}` : '',
          platform: meta?.platform ?? '',
          linkedAt: meta ? (row?.connected_at ?? null) : null,
          policy: meta ? acceptedPolicy(row?.meta) : '',
          policyCurrent: RIOT_POLICY_VERSION,
        },
      };
    }

    if (!store) return noDb ?? fail(503, 'not_configured', 'Al servidor le falta configuración.');

    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? (req.body as Record<string, unknown>) : {};
    // Solo vale aceptar la versión vigente: una vieja o inventada no cuenta
    const accepts = body.policy === RIOT_POLICY_VERSION;

    // La política cambió y la cuenta ya estaba vinculada: se apunta la versión nueva sin volver a preguntar a Riot
    if (action === 'accept') {
      if (!accepts) return fail(400, 'policy', NO_POLICY);
      const row = await store.get(caller.id, 'riot');
      const meta = readRiotMeta(row?.meta);
      if (!row || !meta) return fail(409, 'not_linked', 'No hay ninguna cuenta de Riot vinculada.');
      await store.upsert(caller.id, 'riot', { meta: { ...meta, policy: RIOT_POLICY_VERSION, policyAt: new Date(deps.now()).toISOString() } });
      return {
        status: 200,
        body: {
          configured: Boolean(key),
          missing: key ? [] : ['RIOT_API_KEY'],
          platforms,
          state: 'linked',
          riotId: `${meta.gameName}#${meta.tagLine}`,
          platform: meta.platform,
          linkedAt: row.connected_at ?? null,
          policy: RIOT_POLICY_VERSION,
          policyCurrent: RIOT_POLICY_VERSION,
        },
      };
    }

    if (action === 'unlink') {
      await store.remove(caller.id, 'riot');
      forgetRiotProfile(caller.id);
      return { status: 200, body: { state: 'none' } };
    }

    // link
    if (!key) return fail(503, 'not_configured', 'Al servidor le falta la clave de Riot.', { missing: ['RIOT_API_KEY'] });
    const id = parseRiotId(body.riotId);
    if (!id) return fail(400, 'bad_riot_id', 'Escribe tu Riot ID completo, con la etiqueta: nombre#etiqueta.');
    const platform = platformOf(body.platform);
    if (!platform) return fail(400, 'bad_platform', 'Elige tu servidor de la lista.');
    // Sin aceptar la política no se pregunta nada a Riot ni se guarda nada
    if (!accepts) return fail(400, 'policy', NO_POLICY);
    // Antes de preguntar a Riot se comprueba que la tabla existe
    await store.get(caller.id, 'riot');

    const account = await resolveAccount(id, platform, key, deps.fetch);
    if ('kind' in account) {
      if (account.kind === 'not_found') return fail(404, 'riot_not_found', 'Riot no conoce ese Riot ID. Revisa el nombre y la etiqueta.');
      if (account.kind === 'limited') return fail(429, 'riot_limited', 'Riot pide esperar un momento. Prueba otra vez en un minuto.');
      if (account.kind === 'forbidden') return fail(502, 'riot_key', 'La clave de Riot del servidor no vale o caducó. La renueva quien administra Lalo.');
      return fail(502, 'riot_error', 'Riot no respondió. Prueba otra vez en un momento.');
    }
    const riotId = `${account.gameName}#${account.tagLine}`;
    await store.upsert(caller.id, 'riot', {
      secret_enc: null,
      account_name: riotId.slice(0, 80),
      status: 'connected',
      connected_at: new Date(deps.now()).toISOString(),
      last_error: null,
      last_error_at: null,
      meta: {
        platform: platform.id,
        puuid: account.puuid,
        gameName: account.gameName,
        tagLine: account.tagLine,
        policy: RIOT_POLICY_VERSION,
        policyAt: new Date(deps.now()).toISOString(),
      },
    });
    forgetRiotProfile(caller.id);
    return {
      status: 200,
      body: {
        configured: true,
        missing: [],
        platforms,
        state: 'linked',
        riotId,
        platform: platform.id,
        linkedAt: new Date(deps.now()).toISOString(),
        policy: RIOT_POLICY_VERSION,
        policyCurrent: RIOT_POLICY_VERSION,
      },
    };
  } catch (err) {
    return migrationFail(err) ?? failureOf(err, `riot/${action}`);
  }
}
