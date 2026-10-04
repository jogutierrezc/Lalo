/**
 * server/integrations/kofi.ts
 *
 * Rutas de Ko-fi:
 *
 *   POST /api/kofi/<id>           webhook: Ko-fi envía aquí cada pago del streamer dueño de <id>
 *   GET  /api/kofi/status         (sesión) estado de la conexión
 *   POST /api/kofi/connect        (sesión) devuelve la dirección personal; la crea si no existe
 *   POST /api/kofi/token          (sesión) guarda la clave de verificación que da Ko-fi
 *   POST /api/kofi/regenerate     (sesión) dirección nueva; la anterior deja de funcionar
 *   POST /api/kofi/disconnect     (sesión) borra dirección y clave
 *   POST /api/kofi/reset-goal     (sesión) pone a cero lo recaudado de la meta
 *
 * Ko-fi no tiene inicio de sesión para apps: cada streamer pega en su Ko-fi una
 * dirección de Lalo y pega en Lalo la clave de verificación que Ko-fi le da.
 *
 * El webhook es público y escribe con la clave de servicio, así que:
 *   - <id> son 32 bytes aleatorios. En la base se guarda su huella (para buscar)
 *     y, cifrado, el propio id (para enseñárselo de nuevo a su dueño).
 *   - La clave de verificación se guarda cifrada y se compara sin que el tiempo
 *     delate nada.
 *   - Responde lo mismo (200, {"ok":true}) si el id no existe, si la clave no
 *     coincide, si el aviso está repetido y si todo fue bien: quien pruebe ids o
 *     claves no aprende nada. Si la clave no coincide en un id real, se anota en
 *     la fila para que el panel se lo diga a su dueño. Solo responde otra cosa
 *     cuando el cuerpo es ilegible o demasiado grande (antes de mirar el id), o
 *     cuando la clave coincide y no se pudo guardar (500, para que Ko-fi reintente).
 *   - Del aviso solo se guarda tipo, nombre, mensaje, cantidad, moneda y nivel.
 *     El correo y la dirección de envío no pasan de normalizeKofiPayload.
 *
 * SIN PROBAR contra Ko-fi ni contra Supabase reales.
 */

import { decryptSecret, encryptSecret, parseKey, randomId, safeEqual, sha256Hex } from './crypto.js';
import { fail, failureOf, headerOf, isFail, supabaseMissing, type Deps, type IntegrationRequest, type IntegrationResult } from './http.js';
import {
  KOFI_MAX_BODY_BYTES,
  kofiEventToStored,
  kofiGoalAdd,
  kofiSkip,
  normalizeKofiPayload,
  parseKofiBody,
  readKofiRecent,
  readKofiRules,
} from './kofiRules.js';
import { createLimiter, type AccountRow, type Env } from './store.js';

export type KofiAction = 'status' | 'connect' | 'token' | 'regenerate' | 'disconnect' | 'reset-goal';
export const KOFI_ACTIONS: KofiAction[] = ['status', 'connect', 'token', 'regenerate', 'disconnect', 'reset-goal'];

const HOOK_ID = /^[A-Za-z0-9_-]{40,64}$/;
const OK: IntegrationResult = { status: 200, body: { ok: true } };

const hookLimiter = createLimiter(120);
const panelLimiter = createLimiter(30);

/** Para las pruebas. */
export function resetKofiState(): void {
  hookLimiter.clear();
  panelLimiter.clear();
}

/** Dirección pública del sitio, para montar la del webhook. Vacía si no se conoce. */
export function publicBase(env: Env): string {
  const explicit = (env.PUBLIC_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (/^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/i.test(explicit)) return explicit;
  const host = (env.VERCEL_PROJECT_PRODUCTION_URL ?? '').trim();
  return /^[a-z0-9.-]+$/i.test(host) ? `https://${host}` : '';
}

export function kofiMissing(env: Env): string[] {
  return parseKey(env.INTEGRATIONS_ENC_KEY) ? [] : ['INTEGRATIONS_ENC_KEY'];
}

// ---------- Webhook ----------

export async function handleKofiHook(id: string, req: IntegrationRequest, env: Env, deps: Deps): Promise<IntegrationResult> {
  if (req.method.toUpperCase() !== 'POST') return fail(405, 'method', 'Esta ruta solo admite POST.');
  if (Number(headerOf(req, 'content-length') || '0') > KOFI_MAX_BODY_BYTES) return fail(413, 'too_large', 'El aviso es demasiado grande.');
  const payload = normalizeKofiPayload(parseKofiBody(req.body));
  if (!payload) return fail(400, 'bad_body', 'El aviso no tiene la forma esperada.');

  const key = parseKey(env.INTEGRATIONS_ENC_KEY);
  const store = deps.store(env);
  if (!key || !store) return fail(503, 'not_configured', 'El servidor no está configurado para recibir avisos.');
  if (!HOOK_ID.test(id)) return OK;
  const hash = sha256Hex(id);
  if (hookLimiter.tooMany(hash, deps.now())) return fail(429, 'busy', 'Demasiados avisos seguidos.');

  let row: AccountRow | null;
  try {
    row = await store.byHook(hash);
  } catch (err) {
    return failureOf(err, 'kofi/hook');
  }
  const expected = row?.secret_enc ? decryptSecret(row.secret_enc, key) : null;
  // Siempre se compara algo, exista o no la fila
  const matches = safeEqual(payload.token, expected ?? randomId(16)) && expected !== null;
  if (!row || !matches) {
    if (row && expected !== null) {
      // Para que el panel pueda decir «llegó un aviso, pero la clave no coincide». Como mucho una vez por minuto
      const last = row.last_error_at ? Date.parse(row.last_error_at) : 0;
      if (!(deps.now() - last < 60_000)) {
        await store
          .upsert(row.profile_id, 'kofi', { last_error: 'bad_token', last_error_at: new Date(deps.now()).toISOString() })
          .catch(() => undefined);
      }
    }
    return OK;
  }

  try {
    const { event } = payload;
    const rules = readKofiRules(await store.config(row.profile_id, 'kofi'));
    const counts = kofiSkip(event, rules.events[event.kind]) === null;
    await store.ingestKofi({
      profileId: row.profile_id,
      messageId: payload.messageId,
      payload: kofiEventToStored(event),
      goalAdd: kofiGoalAdd(event, rules),
      // Solo entra en «últimos apoyos» lo que pasa el mínimo y el filtro de nivel
      recent: counts ? { name: event.name, amount: event.amount, currency: event.currency, kind: event.kind } : {},
    });
    return OK;
  } catch (err) {
    console.error('[Lalo integraciones] kofi/hook: no se pudo guardar un aviso:', err instanceof Error ? err.message : 'error desconocido');
    return fail(500, 'store_failed', 'No se pudo guardar el aviso.');
  }
}

// ---------- Panel ----------

function statusBody(row: AccountRow | null, key: Buffer, env: Env): Record<string, unknown> {
  const id = row?.hook_enc ? decryptSecret(row.hook_enc, key) : null;
  const state = !row || !id ? 'none' : !row.secret_enc ? 'address' : !row.last_event_at ? 'waiting' : 'connected';
  return {
    configured: true,
    missing: [],
    state,
    /** Ruta del webhook; el panel le pone delante la dirección pública. Solo la ve su dueño. */
    path: id ? `/api/kofi/${id}` : '',
    base: publicBase(env),
    lastEventAt: row?.last_event_at ?? null,
    badTokenAt: row?.last_error === 'bad_token' ? row.last_error_at : null,
    raised: typeof row?.goal_raised === 'number' ? row.goal_raised : Number(row?.goal_raised ?? 0) || 0,
    recent: readKofiRecent(row?.recent),
  };
}

export async function handleKofiPanel(action: KofiAction, req: IntegrationRequest, env: Env, deps: Deps): Promise<IntegrationResult> {
  const method = req.method.toUpperCase();
  const wanted = action === 'status' ? 'GET' : 'POST';
  if (method !== wanted) return fail(405, 'method', `Esta ruta solo admite ${wanted}.`);

  try {
    const caller = await deps.auth(req, env);
    if (isFail(caller)) return caller;
    if (panelLimiter.tooMany(caller.id, deps.now())) return fail(429, 'busy', 'Demasiadas consultas seguidas. Prueba en un minuto.');

    const key = parseKey(env.INTEGRATIONS_ENC_KEY);
    const noDb = supabaseMissing(env);
    const store = deps.store(env);
    if (!key || !store) {
      const missing = [...kofiMissing(env), ...(noDb ? (noDb.body.missing as string[]) : [])];
      if (action === 'status') return { status: 200, body: { configured: false, missing } };
      return fail(503, 'not_configured', 'Al servidor le falta configuración para conectar con Ko-fi.', { missing });
    }

    const row = await store.get(caller.id, 'kofi');

    if (action === 'status') return { status: 200, body: statusBody(row, key, env) };

    if (action === 'disconnect') {
      await store.remove(caller.id, 'kofi');
      return { status: 200, body: statusBody(null, key, env) };
    }

    if (action === 'connect' || action === 'regenerate') {
      const current = row?.hook_enc ? decryptSecret(row.hook_enc, key) : null;
      if (action === 'connect' && current) return { status: 200, body: statusBody(row, key, env) };
      const id = randomId(32);
      await store.upsert(caller.id, 'kofi', {
        hook_hash: sha256Hex(id),
        hook_enc: encryptSecret(id, key),
        // Con dirección nueva hay que esperar otra vez el primer aviso
        last_event_at: null,
        last_error: null,
        last_error_at: null,
        status: 'connected',
      });
      return { status: 200, body: statusBody(await store.get(caller.id, 'kofi'), key, env) };
    }

    if (!row) return fail(409, 'no_address', 'Primero hay que crear la dirección personal.');

    if (action === 'token') {
      const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
      const token = typeof body.token === 'string' ? body.token.trim() : '';
      if (!/^[\x21-\x7e]{8,200}$/.test(token)) return fail(400, 'bad_token', 'La clave de verificación no tiene la forma esperada. Cópiala tal cual de Ko-fi.');
      await store.upsert(caller.id, 'kofi', { secret_enc: encryptSecret(token, key), last_error: null, last_error_at: null });
      return { status: 200, body: statusBody(await store.get(caller.id, 'kofi'), key, env) };
    }

    // reset-goal
    await store.upsert(caller.id, 'kofi', { goal_raised: 0 });
    return { status: 200, body: statusBody(await store.get(caller.id, 'kofi'), key, env) };
  } catch (err) {
    return failureOf(err, `kofi/${action}`);
  }
}
