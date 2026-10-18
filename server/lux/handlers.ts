/**
 * server/lux/handlers.ts
 *
 * Rutas de Mi AI (antes Lux AI): /api/lux/<acción>.
 *
 *   status      GET   (admin)  proveedor, modelo por defecto y clave de cada proveedor
 *   key         POST  (admin)  guarda la clave del proveedor cifrada; con apiKey vacía, la borra
 *   model       POST  (admin)  cambia el modelo por defecto de un proveedor (debe estar habilitado y ser gratis)
 *   models      GET/POST (admin)  catálogo de modelos: habilitar, deshabilitar y poner coste en créditos
 *   provider    POST  (admin)  elige el proveedor activo
 *   test        POST  (admin)  una petición mínima con la clave y el modelo por defecto
 *   characters  GET/POST (admin)  catálogo de personajes y su asignación a cada streamer
 *   character   GET   (streamer con Lux activo, o admin)  su personaje activo, su modelo y el consumo del mes
 *   mascota-model GET (overlay, con la clave de OBS)  el archivo GLB del personaje de la cuenta, solo si es suyo
 *   character-model POST (admin)  sube (presign + complete), quita el modelo 3D de un personaje
 *   model-library GET/POST  biblioteca de modelos: el creador sube, envía a revisión, quita y elige el suyo;
 *                 el administrador aprueba (con la licencia confirmada) o rechaza
 *   reply      POST  (streamer con Lux activo, o admin)  genera una respuesta de Lux
 *   memory      GET/POST  memoria del personaje activo del streamer
 *   admin-memory POST (admin)  memoria que escribe el administrador en la ficha de la cuenta
 *
 * Nunca se devuelve la clave ni se escribe en los registros. Los errores de
 * los proveedores se traducen a mensajes del panel.
 */

import { defaultDeps, failureOf, fail, isFail, type Auth, type IntegrationRequest, type IntegrationResult } from '../integrations/http.js';
import { MigrationMissingError, type Env } from '../integrations/store.js';
import { MODEL_SETTING, PROVIDER_SETTING, activeModel, activeProvider, isKeyFor, keyState, readApiKey, saveApiKey } from './keyVault.js';
import { LUX_MAX_INPUT, buildLuxMessages } from './prompt.js';
import { supabaseLuxDb, type LuxDb, type LuxLibraryRow, type LuxMemoryDb, type LuxProfile } from './luxDb.js';
import {
  ADMIN_UPLOAD_MAX_BYTES,
  DIGEST_MAX_ITEMS,
  MEMORY_SAVED_MAX,
  MEMORY_USED_IN_REPLY,
  expiresAtFor,
  normalizeAdminMemory,
  normalizeMemoryEdit,
  normalizeNewMemory,
  screenMemory,
  splitIntoMemories,
} from './memory.js';
import { DIGEST_MIN_GAP_MS, buildDigestMessages, keepDigestItems, normalizeDigestLines, parseDigest } from './digest.js';
import { NvidiaError, nvidiaChat, LUX_PROVIDERS, isLuxProvider, providerModel, type LuxProvider, type NvidiaFetch } from './nvidia.js';
import { normalizeLuxSettings, rowFromSettings, settingsFromRow, type LuxSettings } from './settings.js';
import { parseEmotion } from './emotion.js';
import { detectIntent, gestureFor } from './intent.js';
import { buildSongMessages } from './prompt.js';
import { detectSongRequest, normalizeSong, songForChat } from './song.js';
import { LUX_CHAT_MAX, LuxCooldown } from './chatCommands.js';
import { RELEASE_SETTING, nextRelease, parseRelease } from './release.js';
import {
  LUX_AVATAR_CHOICES,
  LUX_GESTURES,
  characterView,
  isModelAvatar,
  normalizeCharacterInput,
  overlayView,
  pickCharacter,
  visibleCharacters,
  type LuxCharacter,
} from './characters.js';
import { fetchPrivateModel, isModelKey, type ModelBytes } from './mascotaModel.js';
import { MODEL_MESSAGES, checkModelFile, defaultModelFiles, newModelKey, retryStaleKeys, MODEL_MAX_BYTES, MODEL_MIME, MODEL_UPLOAD_SECONDS, type ModelFiles } from './characterModel.js';
import { licenseNoticeFor } from './characters.js';
import {
  canApprove,
  canSubmit,
  isShared,
  libraryView,
  modelLimitOf,
  modelsLeft,
  ownedWithFile,
  visibleTo,
  type LibraryModel,
} from './modelLibrary.js';
import {
  MODEL_CONFIG_SETTING,
  defaultModelProblem,
  listModels,
  modelState,
  monthOf,
  parseModelConfig,
  pickModel,
  withModelState,
  MODEL_COST_MAX,
  type ModelSetting,
  type PickResult,
} from './models.js';

/** Como failureOf, pero el aviso de migración nombra las de Lux (0023 a 0032), no la de integraciones. */
function luxFailure(err: unknown, where: string): IntegrationResult {
  if (err instanceof MigrationMissingError) {
    return fail(503, 'migration_missing', 'Falta aplicar una migración de Lux (0023 a 0035) en Supabase.');
  }
  return failureOf(err, where);
}

export const LUX_ACTIONS = [
  'status',
  'key',
  'model',
  'models',
  'provider',
  'test',
  'reply',
  'config',
  'chat',
  'release',
  'speech',
  'memory',
  'admin-memory',
  'characters',
  'character',
  'mascota-model',
  'character-model',
  'model-library',
] as const;
export type LuxAction = (typeof LUX_ACTIONS)[number];

/** Las respuestas a un comando del chat esperan este tiempo antes de sonar y de aparecer en el chat. */
export const LUX_REPLY_DELAY_MS = 5_000;

const MEMORY_LIMIT = MEMORY_USED_IN_REPLY;
const VIEWER_MAX = 40;
/** UUID de un recuerdo, un personaje o una cuenta. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEMORY_METHODS = ['memoryList', 'memoryGet', 'memoryInsert', 'memoryUpdate', 'memoryDelete', 'memoryPrune'] as const;
const CHARACTER_METHODS = ['characters', 'saveCharacter', 'deleteCharacter', 'makeDefaultCharacter', 'assignCharacter'] as const;

/** La base de datos con las escrituras de memoria, o null si la versión del almacén no las tiene (las pruebas sin ellas). */
function memoryApi(db: LuxDb): LuxMemoryDb | null {
  return MEMORY_METHODS.every((name) => typeof db[name] === 'function') ? (db as LuxMemoryDb) : null;
}

/** La base de datos con el catálogo de personajes, o null si falta la migración 0032. */
type CharacterDb = LuxDb & Required<Pick<LuxDb, 'characters' | 'saveCharacter' | 'deleteCharacter' | 'makeDefaultCharacter' | 'assignCharacter'>>;
function characterApi(db: LuxDb): CharacterDb | null {
  return CHARACTER_METHODS.every((name) => typeof db[name] === 'function') ? (db as CharacterDb) : null;
}

/** Clave de app_settings con la hora del último resumen del chat de un streamer. */
const digestKey = (profileId: string): string => `lux_digest:${profileId}`;

export interface LuxDeps {
  fetch: NvidiaFetch;
  auth: Auth;
  db: (env: Env) => LuxDb | null;
  /** Lee el archivo del modelo de un personaje del bucket privado. Las pruebas pasan uno falso. */
  modelBytes?: (env: Env, key: string) => Promise<ModelBytes>;
  /** Acceso a R2 para subir, confirmar y quitar el modelo del personaje. Las pruebas pasan uno falso. */
  modelFiles?: ModelFiles;
  /** Tiempo de espera del chat por espectador. Las pruebas pasan uno propio. */
  cooldown?: LuxCooldown;
  now?: () => number;
}

const chatCooldown = new LuxCooldown();

export const defaultLuxDeps: LuxDeps = {
  fetch: (...args) => fetch(...args),
  auth: defaultDeps.auth,
  db: supabaseLuxDb,
};

const bodyOf = (req: IntegrationRequest): Record<string, unknown> => (req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {});

/** Traduce los fallos de los proveedores a respuestas del panel. Nunca incluye la clave ni el texto de la petición. */
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

// ---------- Personaje, modelo y consumo ----------

/** Personaje activo de la cuenta: el que asignó el administrador, o el que está por defecto. */
async function characterFor(db: LuxDb, profile: LuxProfile): Promise<LuxCharacter> {
  const list = db.characters ? await db.characters() : [];
  return pickCharacter(visibleCharacters(list, profile.id), profile.luxCharacterId ?? null);
}

/** Tope mensual de créditos del plan. Null = sin tope (solo en las pruebas, sin la función). Sin plan, cero. */
async function budgetOf(db: LuxDb, profile: LuxProfile): Promise<number | null> {
  if (!db.planBudget) return null;
  if (!profile.planId) return 0;
  return (await db.planBudget(profile.planId)) ?? 0;
}

/** Créditos gastados este mes y tope del plan. */
async function usageOf(db: LuxDb, profile: LuxProfile, nowMs: number): Promise<{ credits: number; budget: number | null }> {
  const credits = db.usageThisMonth ? await db.usageThisMonth(profile.id, monthOf(nowMs)) : 0;
  return { credits, budget: await budgetOf(db, profile) };
}

/** Modelo que usa el personaje en esta respuesta, con la regla de fallback (models.ts). */
async function modelChoice(db: LuxDb, provider: LuxProvider, character: LuxCharacter, profile: LuxProfile, nowMs: number): Promise<PickResult> {
  const config = parseModelConfig(await db.setting(MODEL_CONFIG_SETTING));
  const usage = await usageOf(db, profile, nowMs);
  return pickModel({
    provider,
    wanted: character.model,
    defaultModel: await activeModel(db, provider),
    config,
    spent: usage.credits,
    budget: usage.budget,
  });
}

/** Suma al consumo del mes lo que costó la respuesta. Si falla, la respuesta se entrega igual. */
async function recordUsage(db: LuxDb, profile: LuxProfile, nowMs: number, choice: PickResult): Promise<void> {
  if (choice.cost <= 0 || !db.addUsage) return;
  await db.addUsage(profile.id, monthOf(nowMs), choice.cost).catch(() => {
    console.error('[Lalo lux] no se pudo registrar el consumo de créditos');
  });
}

/** Nombre del modelo para el panel. */
const modelLabel = (provider: LuxProvider, id: string): string => LUX_PROVIDERS[provider].models.find((model) => model.id === id)?.label ?? id;

// ---------- Rutas de estado y configuración del proveedor ----------

async function status(req: IntegrationRequest, env: Env, deps: LuxDeps): Promise<IntegrationResult> {
  if (req.method.toUpperCase() !== 'GET') return fail(405, 'method', 'Esta ruta solo admite GET.');
  const denied = await requireAdmin(req, env, deps);
  if (denied) return denied;
  const db = deps.db(env);
  if (!db) return fail(503, 'not_configured', 'Al servidor le faltan variables de Supabase.');
  const provider = await activeProvider(db);
  const state = await keyState(env, db, provider);
  const nvidia = await keyState(env, db, 'nvidia');
  const mistral = await keyState(env, db, 'mistral');
  const config = parseModelConfig(await db.setting(MODEL_CONFIG_SETTING));
  const defaultModel = await activeModel(db, provider);
  return {
    status: 200,
    body: {
      provider,
      providers: (Object.keys(LUX_PROVIDERS) as LuxProvider[]).map((id) => ({
        id,
        label: LUX_PROVIDERS[id].label,
        defaultModel: LUX_PROVIDERS[id].defaultModel,
        models: LUX_PROVIDERS[id].models.map((item) => ({ ...item })),
      })),
      configured: state.configured,
      configuredByProvider: { nvidia: nvidia.configured, mistral: mistral.configured },
      vault: state.vault,
      model: defaultModel,
      defaultModel: LUX_PROVIDERS[provider].defaultModel,
      models: listModels(provider, config, defaultModel),
    },
  };
}

/** Proveedor que llega en la petición, o el activo si no llega ninguno válido. */
async function providerFrom(body: Record<string, unknown>, db: LuxDb): Promise<LuxProvider> {
  return typeof body.provider === 'string' && isLuxProvider(body.provider) ? body.provider : activeProvider(db);
}

async function provider(req: IntegrationRequest, env: Env, deps: LuxDeps): Promise<IntegrationResult> {
  if (req.method.toUpperCase() !== 'POST') return fail(405, 'method', 'Esta ruta solo admite POST.');
  const denied = await requireAdmin(req, env, deps);
  if (denied) return denied;
  const db = deps.db(env);
  if (!db) return fail(503, 'not_configured', 'Al servidor le faltan variables de Supabase.');
  const raw = typeof bodyOf(req).provider === 'string' ? (bodyOf(req).provider as string) : '';
  if (!isLuxProvider(raw)) return fail(400, 'bad_provider', 'Proveedor no admitido.');
  await db.putSetting(PROVIDER_SETTING, raw);
  return { status: 200, body: { provider: raw } };
}

/**
 * Modelo por defecto de un proveedor. Debe estar en la lista, habilitado y ser gratis:
 * es el que usan los personajes cuando el suyo no puede (ver models.ts).
 */
async function model(req: IntegrationRequest, env: Env, deps: LuxDeps): Promise<IntegrationResult> {
  if (req.method.toUpperCase() !== 'POST') return fail(405, 'method', 'Esta ruta solo admite POST.');
  const denied = await requireAdmin(req, env, deps);
  if (denied) return denied;
  const db = deps.db(env);
  if (!db) return fail(503, 'not_configured', 'Al servidor le faltan variables de Supabase.');

  const target = await providerFrom(bodyOf(req), db);
  const chosen = typeof bodyOf(req).model === 'string' ? (bodyOf(req).model as string).trim() : '';
  if (!providerModel(target, chosen)) return fail(400, 'bad_model', 'Ese modelo no está en la lista de modelos de ese proveedor.');
  const config = parseModelConfig(await db.setting(MODEL_CONFIG_SETTING));
  const problem = defaultModelProblem(target, chosen, config);
  if (problem) return fail(400, 'default_model', problem);
  await db.putSetting(MODEL_SETTING[target], chosen);
  return { status: 200, body: { provider: target, model: chosen } };
}

/**
 * Catálogo de modelos (admin): habilitar o deshabilitar un modelo y ponerle coste en
 * créditos. Al deshabilitarlo, los personajes que lo usaban pasan al modelo por defecto.
 */
async function models(req: IntegrationRequest, env: Env, deps: LuxDeps): Promise<IntegrationResult> {
  const method = req.method.toUpperCase();
  if (method !== 'GET' && method !== 'POST') return fail(405, 'method', 'Esta ruta admite GET (lista) y POST (cambiar un modelo).');
  const denied = await requireAdmin(req, env, deps);
  if (denied) return denied;
  const db = deps.db(env);
  if (!db) return fail(503, 'not_configured', 'Al servidor le faltan variables de Supabase.');

  try {
    if (method === 'GET') {
      const config = parseModelConfig(await db.setting(MODEL_CONFIG_SETTING));
      const providers = [];
      for (const id of Object.keys(LUX_PROVIDERS) as LuxProvider[]) {
        const defaultModel = await activeModel(db, id);
        providers.push({ id, label: LUX_PROVIDERS[id].label, defaultModel, models: listModels(id, config, defaultModel) });
      }
      return { status: 200, body: { providers, costMax: MODEL_COST_MAX } };
    }

    const raw = bodyOf(req);
    const target = typeof raw.provider === 'string' && isLuxProvider(raw.provider) ? raw.provider : null;
    if (!target) return fail(400, 'bad_provider', 'Proveedor no admitido.');
    const id = typeof raw.model === 'string' ? raw.model.trim() : '';
    if (!providerModel(target, id)) return fail(400, 'bad_model', 'Ese modelo no está en la lista de modelos de ese proveedor.');

    const patch: Partial<ModelSetting> = {};
    if (raw.enabled !== undefined) {
      if (typeof raw.enabled !== 'boolean') return fail(400, 'bad_enabled', 'Habilitar es sí o no.', { field: 'enabled' });
      patch.enabled = raw.enabled;
    }
    if (raw.cost !== undefined) {
      if (!Number.isInteger(raw.cost) || (raw.cost as number) < 0 || (raw.cost as number) > MODEL_COST_MAX) {
        return fail(400, 'bad_cost', `El coste va de 0 a ${MODEL_COST_MAX} créditos por respuesta.`, { field: 'cost' });
      }
      patch.cost = raw.cost as number;
    }
    if (Object.keys(patch).length === 0) return fail(400, 'nothing', 'No hay nada que cambiar.');

    const next = withModelState(parseModelConfig(await db.setting(MODEL_CONFIG_SETTING)), target, id, patch);
    const defaultModel = await activeModel(db, target);
    if (id === defaultModel) {
      const problem = defaultModelProblem(target, id, next);
      if (problem) return fail(400, 'default_model', problem);
    }

    // Los personajes que usaban un modelo deshabilitado pasan al por defecto (su campo model queda vacío).
    let moved = 0;
    const characters = characterApi(db);
    if (patch.enabled === false && characters) {
      for (const character of await characters.characters()) {
        if (character.model !== id) continue;
        await characters.saveCharacter({
          id: character.id,
          name: character.name,
          avatar: character.avatar,
          color: character.color,
          gestures: character.gestures,
          model: null,
          // Conserva la cuenta dueña: quitarla dejaría el personaje visible para todas.
          ownerProfileId: character.ownerProfileId,
        });
        moved += 1;
      }
    }

    await db.putSetting(MODEL_CONFIG_SETTING, JSON.stringify(next));
    return { status: 200, body: { provider: target, models: listModels(target, next, defaultModel), movedCharacters: moved } };
  } catch (err) {
    return luxFailure(err, 'lux/models');
  }
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
  const target = await providerFrom(bodyOf(req), db);
  if (raw && !isKeyFor(target, raw)) {
    return fail(400, 'bad_key', `La clave no tiene el formato de ${LUX_PROVIDERS[target].label}.`);
  }

  const outcome = await saveApiKey(env, db, raw ? raw : null, target);
  if (outcome === 'no_vault') return fail(503, 'no_vault', 'Falta INTEGRATIONS_ENC_KEY en el servidor: no se puede guardar la clave cifrada.');
  return { status: 200, body: { configured: outcome === 'saved' } };
}

async function test(req: IntegrationRequest, env: Env, deps: LuxDeps): Promise<IntegrationResult> {
  if (req.method.toUpperCase() !== 'POST') return fail(405, 'method', 'Esta ruta solo admite POST.');
  const denied = await requireAdmin(req, env, deps);
  if (denied) return denied;
  const db = deps.db(env);
  if (!db) return fail(503, 'not_configured', 'Al servidor le faltan variables de Supabase.');

  const target = await activeProvider(db);
  const apiKey = await readApiKey(env, db, target);
  if (!apiKey) return fail(503, 'no_key', `No hay clave de ${LUX_PROVIDERS[target].label} guardada. Configúrala en Integraciones.`);
  const model = await activeModel(db, target);
  const started = Date.now();
  try {
    await nvidiaChat({
      baseUrl: LUX_PROVIDERS[target].baseUrl,
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

// ---------- Personajes (catálogo solo del administrador) ----------

/** Comprueba que el modelo de un personaje exista, sea del proveedor activo y esté habilitado. */
async function characterModelProblem(db: LuxDb, id: string | null): Promise<string | null> {
  if (id === null) return null;
  const provider = await activeProvider(db);
  if (!providerModel(provider, id)) return `Ese modelo no pertenece a ${LUX_PROVIDERS[provider].label}, el proveedor activo.`;
  const config = parseModelConfig(await db.setting(MODEL_CONFIG_SETTING));
  if (!modelState(provider, id, config).enabled) return 'Ese modelo está deshabilitado. Habilítalo en Modelos o elige otro.';
  return null;
}

/**
 * Personajes de Mi AI. Solo el administrador: el streamer no crea, duplica ni borra.
 * GET lista el catálogo; con `profile` dice qué personaje tiene asignado una cuenta y su consumo.
 * POST con `op`: create, update, delete, default (marcar por defecto) o assign (asignar a una cuenta).
 */
async function characters(req: IntegrationRequest, env: Env, deps: LuxDeps): Promise<IntegrationResult> {
  const method = req.method.toUpperCase();
  if (method !== 'GET' && method !== 'POST') return fail(405, 'method', 'Esta ruta admite GET (lista) y POST (crear, editar, borrar o asignar).');
  const who = await deps.auth(req, env);
  if (isFail(who)) return who;
  if (who.role !== 'admin') return fail(403, 'not_admin', 'Solo para administradores.');
  const db = deps.db(env);
  if (!db) return fail(503, 'not_configured', 'Al servidor le faltan variables de Supabase.');
  const api = characterApi(db);
  if (!api) return fail(503, 'not_configured', 'Al servidor le faltan las funciones de personajes de Lux (migración 0032).');

  try {
    // Lo que el administrador ve y edita: los personajes sin dueño y los suyos. Los de otra cuenta no salen.
    const all = await api.characters();
    const list = visibleCharacters(all, who.id);

    if (method === 'GET') {
      const provider = await activeProvider(db);
      const config = parseModelConfig(await db.setting(MODEL_CONFIG_SETTING));
      const defaultModel = await activeModel(db, provider);
      const body: Record<string, unknown> = {
        characters: list.map(characterView),
        avatars: LUX_AVATAR_CHOICES,
        owners: api.streamers ? await api.streamers() : [],
        gestures: LUX_GESTURES,
        provider,
        providerLabel: LUX_PROVIDERS[provider].label,
        models: listModels(provider, config, defaultModel),
        defaultModel,
      };
      const profileId = typeof req.query.profile === 'string' ? req.query.profile.trim() : '';
      if (profileId) {
        if (!UUID.test(profileId)) return fail(400, 'bad_profile', 'La cuenta no es válida.');
        const profile = await db.profile(profileId);
        if (!profile) return fail(404, 'profile_not_found', 'Esa cuenta no existe.');
        if (profile.role === 'admin') return fail(400, 'not_streamer', 'Solo se asigna personaje a cuentas de streamer.');
        const nowMs = (deps.now ?? Date.now)();
        const choosable = visibleCharacters(all, profile.id);
        body.characters = choosable.map(characterView);
        body.assigned = profile.luxCharacterId ?? null;
        body.resolved = pickCharacter(choosable, profile.luxCharacterId ?? null).id;
        body.usage = await usageOf(db, profile, nowMs);
      }
      return { status: 200, body };
    }

    const raw = bodyOf(req);
    const op = raw.op;

    if (op === 'create' || op === 'update') {
      const check = normalizeCharacterInput(raw);
      if (!check.ok) return fail(400, 'bad_character', check.message, { field: check.field });
      const problem = await characterModelProblem(db, check.value.model);
      if (problem) return fail(400, 'bad_model', problem, { field: 'model' });
      let id: string | undefined;
      if (op === 'update') {
        id = typeof raw.id === 'string' ? raw.id.trim() : '';
        if (!UUID.test(id)) return fail(400, 'bad_id', 'El personaje no es válido.');
        if (!list.some((item) => item.id === id)) return fail(404, 'character_not_found', 'Ese personaje no existe.');
      }
      const saved = await api.saveCharacter({ id, ...check.value });
      return { status: 200, body: { id: saved } };
    }

    if (op === 'delete' || op === 'default') {
      const id = typeof raw.id === 'string' ? raw.id.trim() : '';
      if (!UUID.test(id)) return fail(400, 'bad_id', 'El personaje no es válido.');
      const target = list.find((item) => item.id === id);
      if (!target) return fail(404, 'character_not_found', 'Ese personaje no existe.');
      if (op === 'default') {
        await api.makeDefaultCharacter(id);
        return { status: 200, body: { ok: true } };
      }
      if (target.isDefault) return fail(409, 'is_default', 'El personaje por defecto no se puede borrar. Marca otro como por defecto antes.');
      // Sus recuerdos se borran con él (ON DELETE CASCADE) y las cuentas que lo tenían vuelven al por defecto.
      await api.deleteCharacter(id);
      return { status: 200, body: { ok: true } };
    }

    if (op === 'assign') {
      const profileId = typeof raw.profile === 'string' ? raw.profile.trim() : '';
      if (!UUID.test(profileId)) return fail(400, 'bad_profile', 'La cuenta no es válida.');
      const profile = await db.profile(profileId);
      if (!profile) return fail(404, 'profile_not_found', 'Esa cuenta no existe.');
      if (profile.role === 'admin') return fail(400, 'not_streamer', 'Solo se asigna personaje a cuentas de streamer.');
      let characterId: string | null;
      if (raw.characterId === null || raw.characterId === '') {
        characterId = null;
      } else {
        const chosen = typeof raw.characterId === 'string' ? raw.characterId.trim() : '';
        if (!UUID.test(chosen)) return fail(400, 'bad_id', 'El personaje no es válido.');
        if (!visibleCharacters(all, profileId).some((item) => item.id === chosen)) return fail(404, 'character_not_found', 'Ese personaje no existe.');
        characterId = chosen;
      }
      await api.assignCharacter(profileId, characterId);
      return { status: 200, body: { assigned: characterId } };
    }

    return fail(400, 'bad_op', 'Operación no admitida.');
  } catch (err) {
    return luxFailure(err, 'lux/characters');
  }
}

/**
 * Lo que ve el streamer de su personaje: nombre, color, gestos, el modelo que usa
 * ahora y el consumo del mes. Solo lectura: el streamer no elige personaje ni modelo.
 */
async function character(req: IntegrationRequest, env: Env, deps: LuxDeps): Promise<IntegrationResult> {
  if (req.method.toUpperCase() !== 'GET') return fail(405, 'method', 'Esta ruta solo admite GET.');
  const caller = await deps.auth(req, env);
  if (isFail(caller)) return caller;
  const db = deps.db(env);
  if (!db) return fail(503, 'not_configured', 'Al servidor le faltan variables de Supabase.');

  try {
    const profile = await db.profile(caller.id);
    if (!profile) return fail(403, 'no_profile', 'No se encontró tu perfil.');
    if (profile.role !== 'admin' && !profile.luxEnabled) return fail(403, 'lux_disabled', 'Lux no está activado para tu cuenta.');

    const provider = await activeProvider(db);
    const current = await characterFor(db, profile);
    const choice = await modelChoice(db, provider, current, profile, (deps.now ?? Date.now)());
    const usage = await usageOf(db, profile, (deps.now ?? Date.now)());
    return {
      status: 200,
      body: {
        character: {
          id: current.id,
          name: current.name,
          color: current.color,
          gestures: current.gestures,
          isDefault: current.isDefault,
          licenseNotice: licenseNoticeFor(current),
        },
        model: choice.model,
        modelLabel: modelLabel(provider, choice.model),
        modelNote: choice.fellBack,
        usage,
      },
    };
  } catch (err) {
    return luxFailure(err, 'lux/character');
  }
}

/** Ajustes del streamer que ve su propio panel. Lee y guarda solo su fila; el administrador no edita la de otros aquí. */
async function config(req: IntegrationRequest, env: Env, deps: LuxDeps): Promise<IntegrationResult> {
  const method = req.method.toUpperCase();
  if (method !== 'GET' && method !== 'POST') return fail(405, 'method', 'Esta ruta admite GET y POST.');
  const caller = await deps.auth(req, env);
  if (isFail(caller)) return caller;
  const db = deps.db(env);
  if (!db) return fail(503, 'not_configured', 'Al servidor le faltan variables de Supabase.');

  try {
    const profile = await db.profile(caller.id);
    if (!profile) return fail(403, 'no_profile', 'No se encontró tu perfil.');
    if (profile.role !== 'admin' && !profile.luxEnabled) return fail(403, 'lux_disabled', 'Lux no está activado para tu cuenta.');

    if (method === 'GET') {
      const current = settingsFromRow(await db.settingsRow(caller.id));
      return { status: 200, body: { settings: current, limits: { personality: 600, replyMax: [60, 500], obsSize: [10, 100] } } };
    }

    const current = settingsFromRow(await db.settingsRow(caller.id));
    const check = normalizeLuxSettings(bodyOf(req), current);
    if (!check.ok) return fail(400, 'bad_settings', check.message, { field: check.field });
    // Una voz de ElevenLabs solo se guarda si la cuenta tiene ElevenLabs activado (si no, el servidor da 403 al hablar).
    if (check.value.voiceEngine === 'elevenlabs' && profile.role !== 'admin' && !profile.elevenlabsEnabled) {
      return fail(400, 'voice_not_allowed', 'Tu cuenta no tiene ElevenLabs activado: elige una voz de Fish Audio.');
    }
    await db.saveSettingsRow(rowFromSettings(caller.id, check.value));
    return { status: 200, body: { settings: check.value } };
  } catch (err) {
    return luxFailure(err, 'lux/config');
  }
}

// ---------- Respuestas ----------

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
    const intent = detectIntent(message);
    const nowMs = (deps.now ?? Date.now)();

    const target = await activeProvider(db);
    const apiKey = await readApiKey(env, db, target);
    if (!apiKey) return fail(503, 'no_key', `No hay clave de ${LUX_PROVIDERS[target].label} guardada. Configúrala en Integraciones.`);
    const character = await characterFor(db, profile);
    const choice = await modelChoice(db, target, character, profile, nowMs);
    const model = choice.model;
    const ajustes: LuxSettings = settingsFromRow(await db.settingsRow(profile.id));
    const memories = ajustes.memoryEnabled ? await db.memories(profile.id, character.id, MEMORY_LIMIT) : [];

    const topic = detectSongRequest(message);
    const turn = {
      viewer,
      message,
      memories,
      personality: ajustes.personality,
      language: ajustes.language,
      replyMax: ajustes.replyMax,
      intent,
    };
    const text = await nvidiaChat({
      baseUrl: LUX_PROVIDERS[target].baseUrl,
      apiKey,
      model,
      messages: topic !== null ? buildSongMessages(turn, topic) : buildLuxMessages(turn),
      maxTokens: topic !== null ? 260 : Math.ceil(ajustes.replyMax / 2) + 40,
      fetch: deps.fetch,
    });
    await recordUsage(db, profile, nowMs, choice);
    const isSong = topic !== null;
    const lyrics = isSong ? normalizeSong(text) : '';
    const parsed = isSong ? { text: lyrics, emotion: 'normal' } : parseEmotion(text);
    const emotion = parsed.emotion;
    const clipped = isSong ? songForChat(lyrics) || '…' : (parsed.text || '…').slice(0, ajustes.replyMax);
    const canSing = isSong && ajustes.voiceEngine === 'elevenlabs';

    // Registro de la respuesta: si falla, la respuesta igualmente se entrega.
    await db.insertReply({ profile_id: profile.id, viewer, prompt: message, reply: clipped, model }).catch(() => {
      console.error('[Lalo lux] no se pudo guardar el registro de la respuesta');
    });
    // Desde el panel solo se manda a OBS si el streamer lo pide (botón «Hablar en el overlay»).
    if (raw.speak === true) {
      if (isSong) {
        if (canSing) await enqueueSpeech(db, profile.id, lyrics, 'normal', 'sing', ajustes);
      } else {
        await enqueueSpeech(db, profile.id, clipped, emotion, gestureFor(message, intent), ajustes);
      }
    }
    return {
      status: 200,
      body: {
        reply: clipped,
        emotion,
        intent,
        gesture: isSong ? 'sing' : gestureFor(message, intent),
        song: isSong,
        note: isSong && !canSing ? 'sing_needs_elevenlabs' : undefined,
        model,
        modelNote: choice.fellBack,
        character: character.name,
        voice: { referenceId: ajustes.voiceReferenceId, engine: ajustes.voiceEngine },
      },
    };
  } catch (err) {
    if (err instanceof NvidiaError) return nvidiaFailure(err);
    return luxFailure(err, 'lux/reply');
  }
}

/**
 * Lux en el chat de Twitch. El bot no tiene sesión: el streamer se identifica con
 * su clave de OBS (widget_key), igual que el overlay. Mismo camino de respuesta que el panel.
 */
async function chat(req: IntegrationRequest, env: Env, deps: LuxDeps): Promise<IntegrationResult> {
  if (req.method.toUpperCase() !== 'POST') return fail(405, 'method', 'Esta ruta solo admite POST.');
  const db = deps.db(env);
  if (!db || !db.profileByWidgetKey) return fail(503, 'not_configured', 'Al servidor le faltan variables de Supabase.');

  const raw = bodyOf(req);
  const widgetKey = typeof raw.k === 'string' ? raw.k.trim() : '';
  if (!widgetKey || widgetKey.length > 128) return fail(401, 'bad_widget_key', 'La clave de OBS no es válida.');

  try {
    const profile = await db.profileByWidgetKey(widgetKey);
    if (!profile) return fail(401, 'bad_widget_key', 'La clave de OBS no es válida.');
    const current = settingsFromRow(await db.settingsRow(profile.id));

    if (raw.command === 'on' || raw.command === 'off') {
      // El bot manda privileged según el rango del autor en el chat (canal o moderador).
      if (raw.privileged !== true) return fail(403, 'not_privileged', 'Solo el canal o los moderadores pueden cambiar Lux en el chat.');
      const value = raw.command === 'on';
      await db.saveSettingsRow(rowFromSettings(profile.id, { ...current, chatEnabled: value }));
      return { status: 200, body: { chatEnabled: value } };
    }
    // Resumen del chat (C2). El bot pregunta primero: solo manda mensajes si el streamer tiene el aprendizaje activado.
    if (raw.command === 'learn_status' || raw.command === 'digest') {
      const allowed = profile.role === 'admin' || profile.luxEnabled;
      const learning = allowed && current.chatLearning;
      const last = await db.setting(digestKey(profile.id));
      const lastMs = last && Number.isFinite(Number(last)) ? Number(last) : null;
      const nowMs = (deps.now ?? Date.now)();
      const waitMs = lastMs === null ? 0 : Math.max(0, DIGEST_MIN_GAP_MS - (nowMs - lastMs));

      if (raw.command === 'learn_status') {
        return { status: 200, body: { learning, ready: learning && waitMs === 0, waitSeconds: Math.ceil(waitMs / 1000) } };
      }
      if (!allowed) return { status: 200, body: { skipped: 'lux_disabled' } };
      if (!current.chatLearning) return { status: 200, body: { skipped: 'learning_off' } };
      if (waitMs > 0) return { status: 200, body: { skipped: 'too_soon', waitSeconds: Math.ceil(waitMs / 1000) } };

      const lines = normalizeDigestLines(raw.messages);
      if (lines.length === 0) return { status: 200, body: { skipped: 'no_chat' } };
      const api = memoryApi(db);
      if (!api) return fail(503, 'not_configured', 'Al servidor le faltan las funciones de memoria de Lux.');

      // Los recuerdos que aprende son del personaje activo de la cuenta.
      const character = await characterFor(db, profile);
      const nowIso = new Date(nowMs).toISOString();
      await api.memoryPrune(profile.id, nowIso);
      const existing = await api.memoryList(profile.id, character.id);
      const room = MEMORY_SAVED_MAX - existing.length;
      if (room <= 0) return { status: 200, body: { skipped: 'memory_full' } };

      const target = await activeProvider(db);
      const apiKey = await readApiKey(env, db, target);
      if (!apiKey) return fail(503, 'no_key', `No hay clave de ${LUX_PROVIDERS[target].label} guardada. Configúrala en Integraciones.`);
      const choice = await modelChoice(db, target, character, profile, nowMs);

      // Se marca antes de llamar al modelo: un fallo no provoca reintentos seguidos.
      await db.putSetting(digestKey(profile.id), String(nowMs));
      // Los mensajes crudos solo viven en esta llamada: no se guardan ni se devuelven.
      const text = await nvidiaChat({
        baseUrl: LUX_PROVIDERS[target].baseUrl,
        apiKey,
        model: choice.model,
        messages: buildDigestMessages(lines, existing.slice(0, MEMORY_LIMIT).map((item) => item.content)),
        maxTokens: 700,
        fetch: deps.fetch,
      });
      await recordUsage(db, profile, nowMs, choice);
      const found = parseDigest(text);
      const kept = keepDigestItems(found).slice(0, Math.min(DIGEST_MAX_ITEMS, room));
      if (kept.length > 0) {
        await api.memoryInsert(
          profile.id,
          kept.map((item) => ({
            kind: item.kind,
            subject: item.subject,
            content: item.content,
            pinned: false,
            source: 'chat' as const,
            expiresAt: expiresAtFor(item.kind, false, nowMs),
            characterId: character.id,
          }))
        );
      }
      return { status: 200, body: { learned: kept.length, discarded: found.length - kept.length } };
    }
    if (raw.command !== 'ask') return fail(400, 'bad_command', 'Comando no admitido.');

    if (profile.role !== 'admin' && !profile.luxEnabled) return { status: 200, body: { skipped: 'lux_disabled' } };
    if (!current.chatEnabled) return { status: 200, body: { skipped: 'chat_off' } };

    const message = typeof raw.message === 'string' ? raw.message.trim() : '';
    if (!message || message.length > LUX_CHAT_MAX) {
      return fail(400, 'bad_message', `El mensaje tiene que tener entre 1 y ${LUX_CHAT_MAX} caracteres.`);
    }
    const viewer = typeof raw.viewer === 'string' && raw.viewer.trim() ? raw.viewer.trim().slice(0, VIEWER_MAX) : 'Espectador';
    const nowMs = (deps.now ?? Date.now)();
    const wait = (deps.cooldown ?? chatCooldown).take(`${profile.id}:${viewer.toLowerCase()}`, nowMs);
    if (!wait.ok) return { status: 200, body: { skipped: 'cooldown', waitSeconds: wait.waitSeconds } };

    const target = await activeProvider(db);
    const apiKey = await readApiKey(env, db, target);
    if (!apiKey) return fail(503, 'no_key', `No hay clave de ${LUX_PROVIDERS[target].label} guardada. Configúrala en Integraciones.`);
    const character = await characterFor(db, profile);
    const choice = await modelChoice(db, target, character, profile, nowMs);
    const model = choice.model;
    const memories = current.memoryEnabled ? await db.memories(profile.id, character.id, MEMORY_LIMIT) : [];
    const intent = detectIntent(message);

    const topic = detectSongRequest(message);
    const turn = {
      viewer,
      message,
      memories,
      personality: current.personality,
      language: current.language,
      replyMax: current.replyMax,
      intent,
    };
    const text = await nvidiaChat({
      baseUrl: LUX_PROVIDERS[target].baseUrl,
      apiKey,
      model,
      messages: topic !== null ? buildSongMessages(turn, topic) : buildLuxMessages(turn),
      maxTokens: topic !== null ? 260 : Math.ceil(current.replyMax / 2) + 40,
      fetch: deps.fetch,
    });
    await recordUsage(db, profile, nowMs, choice);
    const isSong = topic !== null;
    const lyrics = isSong ? normalizeSong(text) : '';
    const parsed = isSong ? { text: lyrics, emotion: 'normal' } : parseEmotion(text);
    const emotion = parsed.emotion;
    const reply = isSong ? songForChat(lyrics) || '…' : (parsed.text || '…').slice(0, current.replyMax);
    // Solo ElevenLabs canta: con otra voz, Lux responde con la letra en el chat y sin canto.
    const canSing = isSong && current.voiceEngine === 'elevenlabs';

    await db.insertReply({ profile_id: profile.id, viewer, prompt: message, reply, model }).catch(() => {
      console.error('[Lalo lux] no se pudo guardar el registro de la respuesta del chat');
    });
    // En directo, lo que Lux responde en el chat también se oye en OBS.
    if (isSong) {
      if (canSing) await enqueueSpeech(db, profile.id, lyrics, 'normal', 'sing', current, LUX_REPLY_DELAY_MS);
    } else {
      await enqueueSpeech(db, profile.id, reply, emotion, gestureFor(message, intent), current, LUX_REPLY_DELAY_MS);
    }
    return {
      status: 200,
      body: {
        reply,
        emotion,
        intent,
        gesture: isSong ? 'sing' : gestureFor(message, intent),
        song: isSong,
        note: isSong && !canSing ? 'sing_needs_elevenlabs' : undefined,
        model,
        modelNote: choice.fellBack,
        voice: { referenceId: current.voiceReferenceId, engine: current.voiceEngine },
      },
    };
  } catch (err) {
    if (err instanceof NvidiaError) return nvidiaFailure(err);
    return luxFailure(err, 'lux/chat');
  }
}

/**
 * Versión publicada de Lux. GET es público (lo leen el overlay y el bot); POST lo usa
 * el administrador para publicar una actualización de comandos.
 */
async function release(req: IntegrationRequest, env: Env, deps: LuxDeps): Promise<IntegrationResult> {
  const db = deps.db(env);
  if (!db) return fail(503, 'not_configured', 'Al servidor le faltan variables de Supabase.');
  const method = req.method.toUpperCase();
  if (method === 'GET') {
    try {
      const current = parseRelease(await db.setting(RELEASE_SETTING));
      return { status: 200, body: { version: current.version, note: current.note, at: current.at } };
    } catch (err) {
      return luxFailure(err, 'lux/release');
    }
  }
  if (method !== 'POST') return fail(405, 'method', 'Esta ruta admite GET y POST.');
  const denied = await requireAdmin(req, env, deps);
  if (denied) return denied;
  try {
    const note = typeof bodyOf(req).note === 'string' ? (bodyOf(req).note as string) : '';
    const published = nextRelease(parseRelease(await db.setting(RELEASE_SETTING)), note, (deps.now ?? Date.now)());
    await db.putSetting(RELEASE_SETTING, JSON.stringify(published));
    return { status: 200, body: { version: published.version, note: published.note, at: published.at } };
  } catch (err) {
    return luxFailure(err, 'lux/release');
  }
}

/**
 * Encola lo que Lux dice para el overlay de OBS. El overlay lo lee con su clave de OBS.
 * Se limpia lo que tenga más de diez minutos, para que la tabla no crezca sin fin.
 */
async function enqueueSpeech(db: LuxDb, profileId: string, text: string, emotion: string, gesture: string, s: LuxSettings, delayMs = 0): Promise<void> {
  if (!db.insertSpeech) return;
  await db
    .insertSpeech({
      profile_id: profileId,
      text,
      emotion,
      gesture,
      voice_reference_id: s.voiceReferenceId,
      voice_engine: s.voiceEngine,
      play_after: delayMs > 0 ? new Date(Date.now() + delayMs).toISOString() : null,
    })
    .catch(() => console.error('[Lalo lux] no se pudo encolar la voz para el overlay'));
  if (db.pruneSpeech) {
    await db.pruneSpeech(profileId, new Date(Date.now() - 10 * 60_000).toISOString()).catch(() => undefined);
  }
}

/**
 * Archivo GLB del personaje de la cuenta (Mascota 2). Lo pide el overlay con la clave de OBS.
 * Solo se sirve si el personaje activo tiene modelo y su dueña es esta cuenta: a ninguna otra.
 * El archivo sale del bucket privado; nunca se devuelve una URL.
 */
async function mascotaModel(req: IntegrationRequest, env: Env, deps: LuxDeps): Promise<IntegrationResult> {
  if (req.method.toUpperCase() !== 'GET') return fail(405, 'method', 'Esta ruta solo admite GET.');
  const db = deps.db(env);
  if (!db || !db.profileByWidgetKey) return fail(503, 'not_configured', 'Al servidor le faltan variables de Supabase.');
  const widgetKey = (req.query.k ?? '').trim();
  if (!widgetKey || widgetKey.length > 128) return fail(401, 'bad_widget_key', 'La clave de OBS no es válida.');

  try {
    const profile = await db.profileByWidgetKey(widgetKey);
    if (!profile) return fail(401, 'bad_widget_key', 'La clave de OBS no es válida.');
    if (profile.role !== 'admin' && !profile.luxEnabled) return fail(403, 'lux_disabled', 'Lux no está activado para tu cuenta.');
    const character = await characterFor(db, profile);
    const key = character.modelKey;
    if (!isModelAvatar(character.avatar) || !key || character.ownerProfileId !== profile.id) {
      return fail(404, 'no_model', 'Este personaje no tiene un modelo propio para esta cuenta.');
    }
    const read = await (deps.modelBytes ?? fetchPrivateModel)(env, key);
    if (!read.ok) {
      if (read.reason === 'not_configured') return fail(503, 'models_bucket', 'Falta el bucket privado de modelos en el servidor.', { missing: read.missing });
      if (read.reason === 'missing') return fail(404, 'model_missing', 'El archivo del modelo no está en el almacenamiento.');
      return fail(502, 'model_read', 'No se pudo leer el modelo del almacenamiento.');
    }
    return {
      status: 200,
      body: {},
      raw: { contentType: 'model/gltf-binary', body: read.bytes, cacheControl: 'private, max-age=86400' },
    };
  } catch (err) {
    return luxFailure(err, 'lux/model');
  }
}

/**
 * Modelo 3D de un personaje (ficha del administrador). Solo el administrador: el rol
 * sale de la sesión, nunca del cuerpo. Ops:
 *   presign   { characterId, name, size }          autorización de subida firmada (900 s)
 *   complete  { characterId, key, name, origin }   confirma la subida, guarda la clave y borra la anterior
 *   remove    { characterId }                      quita el modelo
 * Los archivos cuyo borrado falla quedan en model_stale_keys y se reintentan en la siguiente operación.
 */
async function characterModel(req: IntegrationRequest, env: Env, deps: LuxDeps): Promise<IntegrationResult> {
  if (req.method.toUpperCase() !== 'POST') return fail(405, 'method', 'Esta ruta solo admite POST.');
  const who = await deps.auth(req, env);
  if (isFail(who)) return who;
  if (who.role !== 'admin') return fail(403, 'not_admin', 'Solo para administradores.');
  const db = deps.db(env);
  if (!db) return fail(503, 'not_configured', 'Al servidor le faltan variables de Supabase.');
  const api = characterApi(db);
  if (!api || typeof api.setCharacterModel !== 'function') {
    return fail(503, 'not_configured', 'Al servidor le faltan las funciones de personajes de Lux (migración 0034).');
  }
  const files = deps.modelFiles ?? defaultModelFiles;
  const nowMs = (deps.now ?? Date.now)();

  const raw = bodyOf(req);
  const op = raw.op;
  if (op !== 'presign' && op !== 'complete' && op !== 'remove') return fail(400, 'bad_op', 'Operación no admitida.');
  const id = typeof raw.characterId === 'string' ? raw.characterId.trim() : '';
  if (!UUID.test(id)) return fail(400, 'bad_id', 'El personaje no es válido.');

  try {
    // Mismo alcance que el resto del catálogo: el administrador ve los personajes sin dueño y los suyos.
    const list = visibleCharacters(await api.characters(), who.id);
    const target = list.find((item) => item.id === id);
    if (!target) return fail(404, 'character_not_found', 'Ese personaje no existe.');
    if (!isModelAvatar(target.avatar)) return fail(400, 'not_model_avatar', 'Este personaje no usa un modelo 3D.');

    if (op === 'presign') {
      const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 200) : '';
      const size = typeof raw.size === 'number' ? raw.size : NaN;
      const check = checkModelFile({ name, size });
      if (!check.ok) return fail(400, 'bad_file', check.message);
      // Una subida pedida y no confirmada se da por abandonada: su archivo, si existe, se borra en el reintento.
      const abandoned = target.modelPendingKey ? [target.modelPendingKey] : [];
      const stale = await retryStaleKeys(files, env, [...(target.modelStaleKeys ?? []), ...abandoned]);
      const key = newModelKey();
      const uploadUrl = files.uploadUrl(env, key, size, new Date(nowMs));
      if (!uploadUrl) return fail(503, 'models_bucket', MODEL_MESSAGES.notConfigured);
      await api.setCharacterModel!(id, { modelPendingKey: key, modelStaleKeys: stale });
      return { status: 200, body: { key, uploadUrl, expiresIn: MODEL_UPLOAD_SECONDS, headers: { 'Content-Type': MODEL_MIME } } };
    }

    if (op === 'complete') {
      const key = typeof raw.key === 'string' ? raw.key : '';
      if (!isModelKey(key) || key !== target.modelPendingKey) return fail(400, 'not_requested', MODEL_MESSAGES.notRequested);
      const origin = raw.origin === 'riot' || raw.origin === 'propio' ? raw.origin : null;
      if (!origin) return fail(400, 'bad_origin', MODEL_MESSAGES.origin);
      const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 200) : 'modelo.glb';

      // Tamaño real, preguntado a R2: no vale el que diga el navegador.
      const head = await files.head(env, key);
      if (head === 'not_configured') return fail(503, 'models_bucket', MODEL_MESSAGES.notConfigured);
      if (head === 'missing' || head === 'error') return fail(502, 'upload_failed', MODEL_MESSAGES.upload);
      if (head.bytes <= 0 || head.bytes > MODEL_MAX_BYTES) {
        const stale = await retryStaleKeys(files, env, target.modelStaleKeys ?? []);
        const gone = await files.remove(env, key);
        await api.setCharacterModel!(id, { modelPendingKey: null, modelStaleKeys: gone ? stale : [...stale, key] });
        return fail(400, 'bad_file', head.bytes > MODEL_MAX_BYTES ? MODEL_MESSAGES.tooBig : MODEL_MESSAGES.empty);
      }

      // Reemplazo: la fila apunta ya al archivo nuevo; el anterior se borra después.
      const previous = target.modelKey;
      const stale = await retryStaleKeys(files, env, target.modelStaleKeys ?? []);
      await api.setCharacterModel!(id, {
        modelKey: key,
        modelOrigin: origin,
        modelFileName: name,
        modelFileBytes: head.bytes,
        modelUploadedAt: new Date(nowMs).toISOString(),
        modelPendingKey: null,
        modelStaleKeys: stale,
      });
      if (previous && previous !== key && !(await files.remove(env, previous))) {
        await api.setCharacterModel!(id, { modelStaleKeys: [...stale, previous] });
      }
      return { status: 200, body: { ok: true, modelFile: { name, bytes: head.bytes, uploadedAt: new Date(nowMs).toISOString() } } };
    }

    // remove: se borra el archivo actual; si no se puede, queda anotado para reintentar.
    const stale = await retryStaleKeys(files, env, [...(target.modelStaleKeys ?? []), ...(target.modelPendingKey ? [target.modelPendingKey] : [])]);
    let left = stale;
    if (target.modelKey && !(await files.remove(env, target.modelKey))) left = [...stale, target.modelKey];
    await api.setCharacterModel!(id, {
      modelKey: null,
      modelOrigin: null,
      modelFileName: null,
      modelFileBytes: null,
      modelUploadedAt: null,
      modelPendingKey: null,
      modelStaleKeys: left,
    });
    return { status: 200, body: { ok: true } };
  } catch (err) {
    return luxFailure(err, 'lux/character-model');
  }
}

// ---------- Biblioteca de modelos (migración 0035) ----------

/** La base de datos con la biblioteca de modelos de los creadores, o null si falta la migración 0035. */
type LibraryDb = LuxDb & Required<Pick<LuxDb, 'libraryModels' | 'libraryInsert' | 'libraryUpdate' | 'libraryDelete' | 'setProfileModel' | 'planModelLimit'>>;
const LIBRARY_METHODS = ['libraryModels', 'libraryInsert', 'libraryUpdate', 'libraryDelete', 'setProfileModel', 'planModelLimit'] as const;
function libraryApi(db: LuxDb): LibraryDb | null {
  return LIBRARY_METHODS.every((name) => typeof db[name] === 'function') ? (db as LibraryDb) : null;
}

/** Modelos de Riot Games: los GLB de los personajes con model_origin 'riot'. Su id es el del personaje. */
function riotModels(characters: LuxCharacter[]): LibraryModel[] {
  return characters
    .filter((character) => character.modelOrigin === 'riot' && character.modelKey)
    .map((character) => {
      const fileName = character.modelFile?.name ?? null;
      return {
        id: character.id,
        name: fileName ? fileName.replace(/\.glb$/i, '').slice(0, 80) || character.name : character.name,
        source: 'riot' as const,
        ownerProfileId: null,
        fileName,
        bytes: character.modelFile?.bytes ?? null,
        uploadedAt: character.modelFile?.uploadedAt ?? null,
        reviewStatus: 'aprobado' as const,
        licenseConfirmed: true,
        modelKey: character.modelKey,
      };
    });
}

/**
 * Antes de contar la cuota, borra lo que la cuenta dejó a medias: subidas pedidas y no
 * confirmadas, y archivos cuyo borrado falló. Lo que no se puede borrar se vuelve a anotar.
 */
async function sweepAbandoned(api: LibraryDb, files: ModelFiles, env: Env, rows: LuxLibraryRow[], profileId: string): Promise<void> {
  for (const row of rows) {
    if (row.ownerProfileId !== profileId || row.modelKey !== null) continue;
    const left = await retryStaleKeys(files, env, [...row.staleKeys, ...(row.pendingKey ? [row.pendingKey] : [])]);
    if (left.length === 0) await api.libraryDelete(row.id);
    else await api.libraryUpdate(row.id, { pendingKey: null, staleKeys: left });
  }
}

/**
 * Biblioteca de modelos. GET: lo que ve la cuenta (la biblioteca compartida, sus modelos
 * y su cuota) y, al administrador, la cola de revisión. POST con `op`:
 *   presign   { name, size }        autorización de subida para un modelo propio (cuenta con cuota)
 *   complete  { id, key }           confirma la subida: mira el tamaño real en R2 y deja el modelo privado
 *   submit    { id }                envía su modelo a revisión (privado -> pendiente)
 *   remove    { id }                quita su modelo (el administrador puede quitar cualquiera)
 *   approve   { id, licenseConfirmed: true }  (solo administrador) publica en la biblioteca
 *   reject    { id }                (solo administrador) vuelve a privado
 *   choose    { modelId | null }    elige el modelo de su personaje; solo entre los que ve
 * El rol sale de la sesión, nunca del cuerpo. Los modelos de Riot Games no se suben ni se quitan aquí.
 */
async function modelLibrary(req: IntegrationRequest, env: Env, deps: LuxDeps): Promise<IntegrationResult> {
  const method = req.method.toUpperCase();
  if (method !== 'GET' && method !== 'POST') return fail(405, 'method', 'Esta ruta admite GET (biblioteca) y POST (subir, enviar, quitar, aprobar o elegir).');
  const caller = await deps.auth(req, env);
  if (isFail(caller)) return caller;
  const db = deps.db(env);
  if (!db) return fail(503, 'not_configured', 'Al servidor le faltan variables de Supabase.');
  const api = libraryApi(db);
  if (!api || !db.characters) return fail(503, 'not_configured', 'Al servidor le faltan las funciones de la biblioteca de modelos (migración 0035).');
  const files = deps.modelFiles ?? defaultModelFiles;
  const nowMs = (deps.now ?? Date.now)();
  const admin = caller.role === 'admin';

  try {
    const profile = await db.profile(caller.id);
    if (!profile) return fail(403, 'no_profile', 'No se encontró tu perfil.');
    if (!admin && !profile.luxEnabled) return fail(403, 'lux_disabled', 'Lux no está activado para tu cuenta.');

    const rows = await api.libraryModels();
    const models: LibraryModel[] = [...riotModels(await db.characters()), ...rows];
    const findOwn = (id: string): LuxLibraryRow | undefined => rows.find((row) => row.id === id && (row.ownerProfileId === profile.id || admin));

    if (method === 'GET') {
      const limit = modelLimitOf(profile.planId ? await api.planModelLimit(profile.planId) : null);
      const mine = rows.filter((row) => row.ownerProfileId === profile.id && row.modelKey !== null);
      const used = ownedWithFile(models, profile.id).length;
      const visible = visibleTo(models, profile.id);
      const body: Record<string, unknown> = {
        library: models.filter(isShared).map(libraryView),
        mine: mine.map(libraryView),
        limit,
        used,
        left: modelsLeft(limit, used),
        chosen: profile.luxModelId && visible.some((model) => model.id === profile.luxModelId) ? profile.luxModelId : null,
      };
      if (admin) {
        body.review = rows.filter((row) => row.modelKey !== null && row.reviewStatus !== 'aprobado').map(libraryView);
        body.owners = api.streamers ? await api.streamers() : [];
      }
      return { status: 200, body };
    }

    const raw = bodyOf(req);
    const op = raw.op;
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';

    if (op === 'presign') {
      const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 200) : '';
      const size = typeof raw.size === 'number' ? raw.size : NaN;
      const check = checkModelFile({ name, size });
      if (!check.ok) return fail(400, 'bad_file', check.message);
      await sweepAbandoned(api, files, env, rows, profile.id);
      const limit = modelLimitOf(profile.planId ? await api.planModelLimit(profile.planId) : null);
      const used = ownedWithFile(models, profile.id).length;
      if (modelsLeft(limit, used) <= 0) {
        const message = limit === 0 ? 'Tu plan no incluye modelos propios.' : `Tu plan admite ${limit} modelos propios. Quita uno para subir otro.`;
        return fail(409, 'quota_reached', message);
      }
      const key = newModelKey();
      const uploadUrl = files.uploadUrl(env, key, size, new Date(nowMs));
      if (!uploadUrl) return fail(503, 'models_bucket', MODEL_MESSAGES.notConfigured);
      const displayName = name.replace(/\.glb$/i, '').slice(0, 80) || 'Modelo';
      const created = await api.libraryInsert({ ownerProfileId: profile.id, name: displayName, pendingKey: key });
      return { status: 200, body: { id: created, key, uploadUrl, expiresIn: MODEL_UPLOAD_SECONDS, headers: { 'Content-Type': MODEL_MIME } } };
    }

    if (op === 'complete') {
      const row = findOwn(id);
      if (!row || row.ownerProfileId !== profile.id) return fail(404, 'model_not_found', 'Ese modelo no existe.');
      const key = typeof raw.key === 'string' ? raw.key : '';
      if (!isModelKey(key) || key !== row.pendingKey) return fail(400, 'not_requested', MODEL_MESSAGES.notRequested);

      // Tamaño real, preguntado a R2: no vale el que diga el navegador.
      const head = await files.head(env, key);
      if (head === 'not_configured') return fail(503, 'models_bucket', MODEL_MESSAGES.notConfigured);
      if (head === 'missing' || head === 'error') return fail(502, 'upload_failed', MODEL_MESSAGES.upload);
      if (head.bytes <= 0 || head.bytes > MODEL_MAX_BYTES) {
        const left = await retryStaleKeys(files, env, [...row.staleKeys, key]);
        if (left.length === 0) await api.libraryDelete(row.id);
        else await api.libraryUpdate(row.id, { pendingKey: null, staleKeys: left });
        return fail(400, 'bad_file', head.bytes > MODEL_MAX_BYTES ? MODEL_MESSAGES.tooBig : MODEL_MESSAGES.empty);
      }

      const left = await retryStaleKeys(files, env, row.staleKeys);
      const fileName = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 200) : null;
      await api.libraryUpdate(row.id, {
        modelKey: key,
        pendingKey: null,
        fileName,
        bytes: head.bytes,
        uploadedAt: new Date(nowMs).toISOString(),
        staleKeys: left,
        reviewStatus: 'privado',
        licenseConfirmed: false,
      });
      return { status: 200, body: { ok: true } };
    }

    if (op === 'submit') {
      const row = findOwn(id);
      if (!row || row.ownerProfileId !== profile.id) return fail(404, 'model_not_found', 'Ese modelo no existe.');
      const ready = canSubmit(row);
      if (!ready.ok) return fail(409, 'not_submittable', ready.message);
      if (row.reviewStatus === 'privado') await api.libraryUpdate(row.id, { reviewStatus: 'pendiente' });
      return { status: 200, body: { ok: true, reviewStatus: 'pendiente' } };
    }

    if (op === 'remove') {
      const row = findOwn(id);
      if (!row) return fail(404, 'model_not_found', 'Ese modelo no existe.');
      const keys = [...row.staleKeys, ...(row.modelKey ? [row.modelKey] : []), ...(row.pendingKey ? [row.pendingKey] : [])];
      const left = await retryStaleKeys(files, env, keys);
      // Si el archivo no se pudo borrar, la fila sigue con los archivos anotados para reintentar.
      if (left.length === 0) await api.libraryDelete(row.id);
      else await api.libraryUpdate(row.id, { modelKey: null, pendingKey: null, staleKeys: left, reviewStatus: 'privado', licenseConfirmed: false });
      return { status: 200, body: { ok: true } };
    }

    if (op === 'approve' || op === 'reject') {
      if (!admin) return fail(403, 'not_admin', 'Solo para administradores.');
      const row = rows.find((item) => item.id === id);
      if (!row) return fail(404, 'model_not_found', 'Ese modelo no existe.');
      if (op === 'reject') {
        await api.libraryUpdate(row.id, { reviewStatus: 'privado', licenseConfirmed: false });
        return { status: 200, body: { ok: true, reviewStatus: 'privado' } };
      }
      const approval = canApprove(row, raw.licenseConfirmed);
      if (!approval.ok) return fail(400, approval.code, approval.message);
      await api.libraryUpdate(row.id, { reviewStatus: 'aprobado', licenseConfirmed: true });
      return { status: 200, body: { ok: true, reviewStatus: 'aprobado' } };
    }

    if (op === 'choose') {
      let chosen: string | null = null;
      if (raw.modelId !== undefined && raw.modelId !== null && raw.modelId !== '') {
        const wanted = typeof raw.modelId === 'string' ? raw.modelId.trim() : '';
        if (!UUID.test(wanted)) return fail(400, 'bad_id', 'El modelo no es válido.');
        if (!visibleTo(models, profile.id).some((model) => model.id === wanted)) {
          return fail(404, 'model_not_found', 'Ese modelo no está disponible para tu cuenta.');
        }
        chosen = wanted;
      }
      await api.setProfileModel(profile.id, chosen);
      return { status: 200, body: { chosen } };
    }

    return fail(400, 'bad_op', 'Operación no admitida.');
  } catch (err) {
    return luxFailure(err, 'lux/model-library');
  }
}

/**
 * Lo nuevo que Lux tiene que decir en el overlay. Sin `after`, solo devuelve el último id:
 * así el overlay no repite frases viejas al abrirse. Se autoriza con la clave de OBS.
 * Cada respuesta lleva el personaje activo (avatar, color y gestos): el overlay se pinta con él.
 */
async function speech(req: IntegrationRequest, env: Env, deps: LuxDeps): Promise<IntegrationResult> {
  if (req.method.toUpperCase() !== 'GET') return fail(405, 'method', 'Esta ruta solo admite GET.');
  const db = deps.db(env);
  if (!db || !db.profileByWidgetKey || !db.speechSince || !db.latestSpeechId) return fail(503, 'not_configured', 'Al servidor le faltan variables de Supabase.');
  const widgetKey = (req.query.k ?? '').trim();
  if (!widgetKey || widgetKey.length > 128) return fail(401, 'bad_widget_key', 'La clave de OBS no es válida.');

  try {
    const profile = await db.profileByWidgetKey(widgetKey);
    if (!profile) return fail(401, 'bad_widget_key', 'La clave de OBS no es válida.');
    const character = overlayView(await characterFor(db, profile));
    const afterRaw = req.query.after;
    if (afterRaw === undefined || afterRaw === '') {
      const tts = db.ttsVoice ? await db.ttsVoice(profile.id) : { referenceId: null, engine: null };
      const volume = settingsFromRow(await db.settingsRow(profile.id)).voiceVolume;
      return { status: 200, body: { items: [], last: await db.latestSpeechId(profile.id), tts, volume, character } };
    }
    const after = Number(afterRaw);
    if (!Number.isInteger(after) || after < 0) return fail(400, 'bad_after', 'El parámetro after no es válido.');
    const items = profile.role === 'admin' || profile.luxEnabled ? await db.speechSince(profile.id, after) : [];
    const tts = db.ttsVoice ? await db.ttsVoice(profile.id) : { referenceId: null, engine: null };
    const volume = settingsFromRow(await db.settingsRow(profile.id)).voiceVolume;
    return { status: 200, body: { items, last: items.length ? items[items.length - 1].id : after, tts, volume, character } };
  } catch (err) {
    return luxFailure(err, 'lux/speech');
  }
}

/**
 * Memoria del personaje activo del streamer (pestaña Memoria). GET lista sus recuerdos.
 * POST con `op` crea, edita o borra. El dueño es siempre quien hace la petición (su
 * sesión): el id de perfil nunca viene del cuerpo, y cada cambio filtra por ese dueño y
 * por el personaje. El navegador no escribe en la base de datos: todo pasa por aquí.
 */
async function memory(req: IntegrationRequest, env: Env, deps: LuxDeps): Promise<IntegrationResult> {
  const method = req.method.toUpperCase();
  if (method !== 'GET' && method !== 'POST') return fail(405, 'method', 'Esta ruta admite GET (lista) y POST (crear, editar o borrar).');
  const caller = await deps.auth(req, env);
  if (isFail(caller)) return caller;
  const db = deps.db(env);
  if (!db) return fail(503, 'not_configured', 'Al servidor le faltan variables de Supabase.');
  const api = memoryApi(db);
  if (!api) return fail(503, 'not_configured', 'Al servidor le faltan las funciones de memoria de Lux.');

  try {
    const profile = await db.profile(caller.id);
    if (!profile) return fail(403, 'no_profile', 'No se encontró tu perfil.');
    if (profile.role !== 'admin' && !profile.luxEnabled) return fail(403, 'lux_disabled', 'Lux no está activado para tu cuenta.');
    const owner = profile.id;
    const character = await characterFor(db, profile);
    const nowMs = (deps.now ?? Date.now)();

    if (method === 'GET') {
      await api.memoryPrune(owner, new Date(nowMs).toISOString());
      const items = await api.memoryList(owner, character.id);
      const ajustes = settingsFromRow(await db.settingsRow(owner));
      return {
        status: 200,
        body: {
          memories: items,
          character: character.name,
          saved: items.length,
          savedMax: MEMORY_SAVED_MAX,
          usedInReply: ajustes.memoryEnabled ? Math.min(items.length, MEMORY_USED_IN_REPLY) : 0,
          usedMax: MEMORY_USED_IN_REPLY,
          memoryEnabled: ajustes.memoryEnabled,
        },
      };
    }

    const raw = bodyOf(req);
    if (raw.op === 'create') {
      const check = normalizeNewMemory(raw);
      if (!check.ok) return fail(400, 'bad_memory', check.message, { field: check.field });
      const items = await api.memoryList(owner, character.id);
      if (items.length >= MEMORY_SAVED_MAX) {
        return fail(409, 'memory_full', `Lux ya tiene ${MEMORY_SAVED_MAX} recuerdos guardados. Borra alguno para añadir más.`);
      }
      await api.memoryInsert(owner, [
        {
          kind: check.value.kind,
          subject: null,
          content: check.value.content,
          pinned: false,
          source: 'manual',
          expiresAt: expiresAtFor(check.value.kind, false, nowMs),
          characterId: character.id,
        },
      ]);
      return { status: 200, body: { ok: true } };
    }

    if (raw.op === 'update' || raw.op === 'delete') {
      const id = typeof raw.id === 'string' ? raw.id.trim() : '';
      if (!UUID.test(id)) return fail(400, 'bad_id', 'El recuerdo no es válido.');

      // Lo que escribe el administrador (source 'admin') no lo edita ni lo borra el streamer: se ve, nada más.
      const edit = raw.op === 'update' ? normalizeMemoryEdit(raw) : null;
      if (edit && !edit.ok) return fail(400, 'bad_memory', edit.message, { field: edit.field });
      const current = await api.memoryGet(owner, character.id, id);
      if (!current) return fail(404, 'memory_not_found', 'Ese recuerdo no existe.');
      if (current.source === 'admin') return fail(403, 'admin_memory', ADMIN_MEMORY_LOCKED);

      if (!edit) {
        const removed = await api.memoryDelete(owner, character.id, id);
        return removed ? { status: 200, body: { ok: true } } : fail(404, 'memory_not_found', 'Ese recuerdo no existe.');
      }

      const patch: { content?: string; pinned?: boolean; expiresAt?: string | null } = {};
      if (edit.value.content !== undefined) patch.content = edit.value.content;
      if (edit.value.pinned !== undefined) {
        patch.pinned = edit.value.pinned;
        // Fijar quita la caducidad; desfijar un recuerdo del chat le da 30 días desde ahora.
        patch.expiresAt = expiresAtFor(current.kind, edit.value.pinned, nowMs);
      }
      const changed = await api.memoryUpdate(owner, character.id, id, patch);
      return changed ? { status: 200, body: { ok: true } } : fail(404, 'memory_not_found', 'Ese recuerdo no existe.');
    }

    return fail(400, 'bad_op', 'Operación no admitida.');
  } catch (err) {
    return luxFailure(err, 'lux/memory');
  }
}

const ADMIN_MEMORY_LOCKED = 'Ese recuerdo lo puso el administrador. Solo él puede cambiarlo.';

/**
 * Memoria que escribe el administrador en la ficha de una cuenta de streamer (portal
 * admin). El administrador es quien llama (sesión, rol 'admin'); la cuenta destino va en
 * el cuerpo porque el admin actúa sobre ella. Escribe en el personaje activo de esa cuenta
 * y solo toca recuerdos con source 'admin'.
 *
 *   list    lista los recuerdos del personaje activo (todos, para ver el cupo)
 *   split   parte un texto (pegado o de un archivo) en recuerdos y marca los que no se pueden guardar
 *   save    guarda una lista de recuerdos ya revisada (dato o estilo, sin caducidad)
 *   update  cambia el texto de uno de los suyos
 *   delete  borra uno de los suyos
 */
async function adminMemory(req: IntegrationRequest, env: Env, deps: LuxDeps): Promise<IntegrationResult> {
  if (req.method.toUpperCase() !== 'POST') return fail(405, 'method', 'Esta ruta solo admite POST.');
  const denied = await requireAdmin(req, env, deps);
  if (denied) return denied;
  const db = deps.db(env);
  if (!db) return fail(503, 'not_configured', 'Al servidor le faltan variables de Supabase.');
  const api = memoryApi(db);
  if (!api) return fail(503, 'not_configured', 'Al servidor le faltan las funciones de memoria de Lux.');

  const raw = bodyOf(req);
  const target = typeof raw.profile === 'string' ? raw.profile.trim() : '';
  // Basta con que sea un texto corto: que la cuenta exista lo dice la búsqueda de abajo.
  if (!target || target.length > 64) return fail(400, 'bad_profile', 'La cuenta no es válida.');

  try {
    const profile = await db.profile(target);
    if (!profile) return fail(404, 'profile_not_found', 'Esa cuenta no existe.');
    if (profile.role === 'admin') return fail(400, 'not_streamer', 'Solo se guarda memoria en cuentas de streamer.');
    const character = await characterFor(db, profile);
    const nowMs = (deps.now ?? Date.now)();

    if (raw.op === 'list') {
      const items = await api.memoryList(target, character.id);
      return { status: 200, body: { memories: items, character: character.name, saved: items.length, savedMax: MEMORY_SAVED_MAX } };
    }

    if (raw.op === 'split') {
      const text = typeof raw.text === 'string' ? raw.text : '';
      if (new TextEncoder().encode(text).length > ADMIN_UPLOAD_MAX_BYTES) {
        return fail(400, 'file_too_big', `El texto pesa más de ${ADMIN_UPLOAD_MAX_BYTES / 1024} KB. Divídelo en partes más pequeñas.`);
      }
      const chunks = splitIntoMemories(text).map((content) => ({ content, blocked: screenMemory(content) }));
      if (chunks.length === 0) return fail(400, 'empty_text', 'No hay texto que convertir en recuerdos.');
      const items = await api.memoryList(target, character.id);
      return { status: 200, body: { chunks, saved: items.length, savedMax: MEMORY_SAVED_MAX, room: Math.max(0, MEMORY_SAVED_MAX - items.length) } };
    }

    if (raw.op === 'save') {
      if (raw.kind !== 'fact' && raw.kind !== 'style') return fail(400, 'bad_memory', 'El tipo tiene que ser dato o estilo.', { field: 'kind' });
      if (!Array.isArray(raw.items) || raw.items.length === 0) return fail(400, 'bad_memory', 'No hay recuerdos que guardar.', { field: 'items' });
      if (raw.items.length > MEMORY_SAVED_MAX) return fail(400, 'too_many', `De una vez se pueden guardar hasta ${MEMORY_SAVED_MAX} recuerdos.`);
      const rows = [];
      for (let index = 0; index < raw.items.length; index++) {
        const check = normalizeAdminMemory({ kind: raw.kind, content: raw.items[index] });
        if (!check.ok) return fail(400, 'bad_memory', `Recuerdo ${index + 1}: ${check.message}`, { field: check.field, index });
        rows.push({
          kind: check.value.kind,
          subject: null,
          content: check.value.content,
          pinned: false,
          source: 'admin' as const,
          expiresAt: expiresAtFor(check.value.kind, false, nowMs, 'admin'),
          characterId: character.id,
        });
      }
      const items = await api.memoryList(target, character.id);
      const room = Math.max(0, MEMORY_SAVED_MAX - items.length);
      if (rows.length > room) {
        const message = room > 0 ? `Solo caben ${room} recuerdos más (máximo ${MEMORY_SAVED_MAX} por personaje).` : `Este personaje ya tiene ${MEMORY_SAVED_MAX} recuerdos. Borra alguno para añadir más.`;
        return fail(409, 'memory_full', message, { room });
      }
      await api.memoryInsert(target, rows);
      return { status: 200, body: { ok: true, saved: rows.length } };
    }

    if (raw.op === 'update' || raw.op === 'delete') {
      const id = typeof raw.id === 'string' ? raw.id.trim() : '';
      if (!UUID.test(id)) return fail(400, 'bad_id', 'El recuerdo no es válido.');
      // Solo los del administrador: los del personaje (chat o manuales) no se tocan desde aquí.
      const current = await api.memoryGet(target, character.id, id);
      if (!current || current.source !== 'admin') return fail(404, 'memory_not_found', 'Ese recuerdo no existe.');

      if (raw.op === 'delete') {
        const removed = await api.memoryDelete(target, character.id, id);
        return removed ? { status: 200, body: { ok: true } } : fail(404, 'memory_not_found', 'Ese recuerdo no existe.');
      }
      const edit = normalizeMemoryEdit({ content: raw.content });
      if (!edit.ok) return fail(400, 'bad_memory', edit.message, { field: edit.field });
      const content = edit.value.content ?? '';
      const reason = screenMemory(content);
      if (reason) return fail(400, 'bad_memory', `Ese texto no se puede guardar: contiene ${reason}.`, { field: 'content' });
      const changed = await api.memoryUpdate(target, character.id, id, { content });
      return changed ? { status: 200, body: { ok: true } } : fail(404, 'memory_not_found', 'Ese recuerdo no existe.');
    }

    return fail(400, 'bad_op', 'Operación no admitida.');
  } catch (err) {
    return luxFailure(err, 'lux/admin-memory');
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
    case 'models':
      return models(req, env, deps);
    case 'provider':
      return provider(req, env, deps);
    case 'test':
      return test(req, env, deps);
    case 'reply':
      return reply(req, env, deps);
    case 'config':
      return config(req, env, deps);
    case 'chat':
      return chat(req, env, deps);
    case 'release':
      return release(req, env, deps);
    case 'speech':
      return speech(req, env, deps);
    case 'memory':
      return memory(req, env, deps);
    case 'admin-memory':
      return adminMemory(req, env, deps);
    case 'characters':
      return characters(req, env, deps);
    case 'character':
      return character(req, env, deps);
    case 'mascota-model':
      return mascotaModel(req, env, deps);
    case 'character-model':
      return characterModel(req, env, deps);
    case 'model-library':
      return modelLibrary(req, env, deps);
  }
}
