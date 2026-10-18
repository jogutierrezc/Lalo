/**
 * server/lux/handlers.ts
 *
 * Rutas de Lux: /api/lux/<acción>.
 *
 *   status   GET   (admin)  si hay clave guardada, si el servidor puede cifrarla y qué modelo usa
 *   key      POST  (admin)  guarda la clave de NVIDIA cifrada; con apiKey vacía, la borra
 *   test     POST  (admin)  una petición mínima a NVIDIA con la clave y el modelo guardados
 *   reply    POST  (streamer con Lux activo, o admin)  genera una respuesta de Lux
 *
 * Nunca se devuelve la clave ni se escribe en los registros. Los errores de
 * NVIDIA se traducen a mensajes del panel.
 */

import { defaultDeps, failureOf, fail, isFail, type Auth, type IntegrationRequest, type IntegrationResult } from '../integrations/http.js';
import type { Env } from '../integrations/store.js';
import { SETTING_MODEL, activeModel, isNvidiaKey, keyState, readApiKey, saveApiKey } from './keyVault.js';
import { LUX_MAX_INPUT, buildLuxMessages } from './prompt.js';
import { supabaseLuxDb, type LuxDb } from './luxDb.js';
import { NvidiaError, nvidiaChat, DEFAULT_LUX_MODEL, LUX_MODELS, isLuxModel, type NvidiaFetch } from './nvidia.js';

export const LUX_ACTIONS = ['status', 'key', 'model', 'test', 'reply'] as const;
export type LuxAction = (typeof LUX_ACTIONS)[number];

const MEMORY_LIMIT = 20;
const VIEWER_MAX = 40;

export interface LuxDeps {
  fetch: NvidiaFetch;
  auth: Auth;
  db: (env: Env) => LuxDb | null;
}

export const defaultLuxDeps: LuxDeps = {
  fetch: (...args) => fetch(...args),
  auth: defaultDeps.auth,
  db: supabaseLuxDb,
};

const bodyOf = (req: IntegrationRequest): Record<string, unknown> => (req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {});

/** Traduce los fallos de NVIDIA a respuestas del panel. Nunca incluye la clave ni el texto de la petición. */
function nvidiaFailure(err: NvidiaError): IntegrationResult {
  console.error(`[Lalo lux] nvidia: ${err.code} (${err.status})`);
  switch (err.code) {
    case 'no_key':
      return fail(503, 'no_key', 'No hay clave de NVIDIA guardada. Configúrala en el panel de administración, en Integraciones.');
    case 'unauthorized':
      return fail(502, 'nvidia_unauthorized', 'NVIDIA rechazó la clave o no tiene acceso a este modelo.');
    case 'model_unavailable':
      return fail(502, 'nvidia_model', 'El modelo no está disponible para esta cuenta de NVIDIA.');
    case 'rate_limited':
      return fail(429, 'nvidia_rate_limited', 'NVIDIA está limitando las peticiones. Prueba de nuevo en un rato.');
    case 'timeout':
      return fail(504, 'nvidia_timeout', 'NVIDIA tardó demasiado en responder.');
    default:
      return fail(502, 'nvidia_upstream', 'NVIDIA no devolvió una respuesta utilizable.');
  }
}

/** Solo el administrador. Devuelve el error listo para responder, o null si puede seguir. */
async function requireAdmin(req: IntegrationRequest, env: Env, deps: LuxDeps): Promise<IntegrationResult | null> {
  const caller = await deps.auth(req, env);
  if (isFail(caller)) return caller;
  if (caller.role !== 'admin') return fail(403, 'not_admin', 'Solo para administradores.');
  return null;
}

async function status(req: IntegrationRequest, env: Env, deps: LuxDeps): Promise<IntegrationResult> {
  if (req.method.toUpperCase() !== 'GET') return fail(405, 'method', 'Esta ruta solo admite GET.');
  const denied = await requireAdmin(req, env, deps);
  if (denied) return denied;
  const db = deps.db(env);
  if (!db) return fail(503, 'not_configured', 'Al servidor le faltan variables de Supabase.');
  const state = await keyState(env, db);
  return {
    status: 200,
    body: {
      configured: state.configured,
      vault: state.vault,
      model: await activeModel(db),
      defaultModel: DEFAULT_LUX_MODEL,
      models: LUX_MODELS.map((model) => ({ ...model })),
    },
  };
}

async function model(req: IntegrationRequest, env: Env, deps: LuxDeps): Promise<IntegrationResult> {
  if (req.method.toUpperCase() !== 'POST') return fail(405, 'method', 'Esta ruta solo admite POST.');
  const denied = await requireAdmin(req, env, deps);
  if (denied) return denied;
  const db = deps.db(env);
  if (!db) return fail(503, 'not_configured', 'Al servidor le faltan variables de Supabase.');

  const chosen = typeof bodyOf(req).model === 'string' ? (bodyOf(req).model as string).trim() : '';
  if (!isLuxModel(chosen)) return fail(400, 'bad_model', 'Ese modelo no está en la lista de modelos de Lux.');
  await db.putSetting(SETTING_MODEL, chosen);
  return { status: 200, body: { model: chosen } };
}

async function key(req: IntegrationRequest, env: Env, deps: LuxDeps): Promise<IntegrationResult> {
  if (req.method.toUpperCase() !== 'POST') return fail(405, 'method', 'Esta ruta solo admite POST.');
  const denied = await requireAdmin(req, env, deps);
  if (denied) return denied;
  const db = deps.db(env);
  if (!db) return fail(503, 'not_configured', 'Al servidor le faltan variables de Supabase.');

  // Sin campo apiKey la petición está mal formada: no puede borrar la clave por accidente.
  // Solo una cadena vacía explícita borra.
  const field = bodyOf(req).apiKey;
  if (typeof field !== 'string') return fail(400, 'missing_key', 'Falta el campo apiKey.');
  const raw = field.trim();
  if (raw && !isNvidiaKey(raw)) return fail(400, 'bad_key', 'La clave no tiene el formato de NVIDIA (empieza por «nvapi-»).');

  const outcome = await saveApiKey(env, db, raw ? raw : null);
  if (outcome === 'no_vault') return fail(503, 'no_vault', 'Falta INTEGRATIONS_ENC_KEY en el servidor: no se puede guardar la clave cifrada.');
  return { status: 200, body: { configured: outcome === 'saved' } };
}

async function test(req: IntegrationRequest, env: Env, deps: LuxDeps): Promise<IntegrationResult> {
  if (req.method.toUpperCase() !== 'POST') return fail(405, 'method', 'Esta ruta solo admite POST.');
  const denied = await requireAdmin(req, env, deps);
  if (denied) return denied;
  const db = deps.db(env);
  if (!db) return fail(503, 'not_configured', 'Al servidor le faltan variables de Supabase.');

  const apiKey = await readApiKey(env, db);
  if (!apiKey) return fail(503, 'no_key', 'No hay clave de NVIDIA guardada. Configúrala en el panel de administración, en Integraciones.');
  const model = await activeModel(db);
  const started = Date.now();
  try {
    await nvidiaChat({
      apiKey,
      model,
      messages: [{ role: 'user', content: 'Responde solo con la palabra: ok' }],
      maxTokens: 64,
      temperature: 0,
      fetch: deps.fetch,
    });
  } catch (err) {
    if (err instanceof NvidiaError) return nvidiaFailure(err);
    return failureOf(err, 'lux/test');
  }
  return { status: 200, body: { ok: true, model, latencyMs: Date.now() - started } };
}

async function reply(req: IntegrationRequest, env: Env, deps: LuxDeps): Promise<IntegrationResult> {
  if (req.method.toUpperCase() !== 'POST') return fail(405, 'method', 'Esta ruta solo admite POST.');
  const caller = await deps.auth(req, env);
  if (isFail(caller)) return caller;
  const db = deps.db(env);
  if (!db) return fail(503, 'not_configured', 'Al servidor le faltan variables de Supabase.');

  try {
    const profile = await db.profile(caller.id);
    if (!profile) return fail(403, 'no_profile', 'No se encontró tu perfil.');
    if (profile.role !== 'admin' && !profile.luxEnabled) return fail(403, 'lux_disabled', 'Lux no está activado para tu cuenta.');

    const raw = bodyOf(req);
    const message = typeof raw.message === 'string' ? raw.message.trim() : '';
    if (message.length === 0 || message.length > LUX_MAX_INPUT) {
      return fail(400, 'bad_message', `El mensaje tiene que tener entre 1 y ${LUX_MAX_INPUT} caracteres.`);
    }
    const viewer = typeof raw.viewer === 'string' && raw.viewer.trim() ? raw.viewer.trim().slice(0, VIEWER_MAX) : null;

    const apiKey = await readApiKey(env, db);
    if (!apiKey) return fail(503, 'no_key', 'No hay clave de NVIDIA guardada. Configúrala en el panel de administración, en Integraciones.');
    const model = await activeModel(db);
    const memories = await db.memories(profile.id, MEMORY_LIMIT);

    const text = await nvidiaChat({
      apiKey,
      model,
      messages: buildLuxMessages({ viewer, message, memories }),
      maxTokens: 200,
      fetch: deps.fetch,
    });
    const clipped = text.slice(0, LUX_MAX_INPUT);

    // Registro de la respuesta: si falla, la respuesta igualmente se entrega.
    await db.insertReply({ profile_id: profile.id, viewer, prompt: message, reply: clipped, model }).catch(() => {
      console.error('[Lalo lux] no se pudo guardar el registro de la respuesta');
    });
    return { status: 200, body: { reply: clipped, model } };
  } catch (err) {
    if (err instanceof NvidiaError) return nvidiaFailure(err);
    return failureOf(err, 'lux/reply');
  }
}

/** Entrada única de Lux. `overrides` solo lo usan las pruebas. */
export async function handleLux(action: LuxAction, req: IntegrationRequest, env: Env = process.env, overrides: Partial<LuxDeps> = {}): Promise<IntegrationResult> {
  const deps: LuxDeps = { ...defaultLuxDeps, ...overrides };
  switch (action) {
    case 'status':
      return status(req, env, deps);
    case 'key':
      return key(req, env, deps);
    case 'model':
      return model(req, env, deps);
    case 'test':
      return test(req, env, deps);
    case 'reply':
      return reply(req, env, deps);
  }
}
