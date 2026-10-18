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
import { MigrationMissingError, type Env } from '../integrations/store.js';

/** Como failureOf, pero el aviso de migración nombra las de Lux (0023 a 0025), no la de integraciones. */
function luxFailure(err: unknown, where: string): IntegrationResult {
  if (err instanceof MigrationMissingError) {
    return fail(503, 'migration_missing', 'Falta aplicar una migración de Lux (0023 a 0031) en Supabase.');
  }
  return failureOf(err, where);
}
import { MODEL_SETTING, PROVIDER_SETTING, activeModel, activeProvider, isKeyFor, keyState, readApiKey, saveApiKey } from './keyVault.js';
import { LUX_MAX_INPUT, buildLuxMessages } from './prompt.js';
import { supabaseLuxDb, type LuxDb, type LuxMemoryDb } from './luxDb.js';
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

export const LUX_ACTIONS = ['status', 'key', 'model', 'provider', 'test', 'reply', 'config', 'chat', 'release', 'speech', 'memory', 'admin-memory'] as const;
export type LuxAction = (typeof LUX_ACTIONS)[number];

/** Las respuestas a un comando del chat esperan este tiempo antes de sonar y de aparecer en el chat. */
export const LUX_REPLY_DELAY_MS = 5_000;

const MEMORY_LIMIT = MEMORY_USED_IN_REPLY;
const VIEWER_MAX = 40;
/** UUID de un recuerdo (rutas de edición y borrado) o de una cuenta (ruta del administrador). */
const MEMORY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEMORY_METHODS = ['memoryList', 'memoryGet', 'memoryInsert', 'memoryUpdate', 'memoryDelete', 'memoryPrune'] as const;

/** La base de datos con las escrituras de memoria, o null si la versión del almacén no las tiene (las pruebas sin ellas). */
function memoryApi(db: LuxDb): LuxMemoryDb | null {
  return MEMORY_METHODS.every((name) => typeof db[name] === 'function') ? (db as LuxMemoryDb) : null;
}

/** Clave de app_settings con la hora del último resumen del chat de un streamer. */
const digestKey = (profileId: string): string => `lux_digest:${profileId}`;

export interface LuxDeps {
  fetch: NvidiaFetch;
  auth: Auth;
  db: (env: Env) => LuxDb | null;
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
  const provider = await activeProvider(db);
  const state = await keyState(env, db, provider);
  const nvidia = await keyState(env, db, 'nvidia');
  const mistral = await keyState(env, db, 'mistral');
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
      model: await activeModel(db, provider),
      defaultModel: LUX_PROVIDERS[provider].defaultModel,
      models: LUX_PROVIDERS[provider].models.map((item) => ({ ...item })),
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

async function model(req: IntegrationRequest, env: Env, deps: LuxDeps): Promise<IntegrationResult> {
  if (req.method.toUpperCase() !== 'POST') return fail(405, 'method', 'Esta ruta solo admite POST.');
  const denied = await requireAdmin(req, env, deps);
  if (denied) return denied;
  const db = deps.db(env);
  if (!db) return fail(503, 'not_configured', 'Al servidor le faltan variables de Supabase.');

  const target = await providerFrom(bodyOf(req), db);
  const chosen = typeof bodyOf(req).model === 'string' ? (bodyOf(req).model as string).trim() : '';
  if (!providerModel(target, chosen)) return fail(400, 'bad_model', 'Ese modelo no está en la lista de modelos de ese proveedor.');
  await db.putSetting(MODEL_SETTING[target], chosen);
  return { status: 200, body: { provider: target, model: chosen } };
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

    const target = await activeProvider(db);
    const apiKey = await readApiKey(env, db, target);
    if (!apiKey) return fail(503, 'no_key', `No hay clave de ${LUX_PROVIDERS[target].label} guardada. Configúrala en Integraciones.`);
    const model = await activeModel(db, target);
    const ajustes: LuxSettings = settingsFromRow(await db.settingsRow(profile.id));
    const memories = ajustes.memoryEnabled ? await db.memories(profile.id, MEMORY_LIMIT) : [];

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

      const nowIso = new Date(nowMs).toISOString();
      await api.memoryPrune(profile.id, nowIso);
      const existing = await api.memoryList(profile.id);
      const room = MEMORY_SAVED_MAX - existing.length;
      if (room <= 0) return { status: 200, body: { skipped: 'memory_full' } };

      const target = await activeProvider(db);
      const apiKey = await readApiKey(env, db, target);
      if (!apiKey) return fail(503, 'no_key', `No hay clave de ${LUX_PROVIDERS[target].label} guardada. Configúrala en Integraciones.`);
      const model = await activeModel(db, target);

      // Se marca antes de llamar al modelo: un fallo no provoca reintentos seguidos.
      await db.putSetting(digestKey(profile.id), String(nowMs));
      // Los mensajes crudos solo viven en esta llamada: no se guardan ni se devuelven.
      const text = await nvidiaChat({
        baseUrl: LUX_PROVIDERS[target].baseUrl,
        apiKey,
        model,
        messages: buildDigestMessages(lines, existing.slice(0, MEMORY_LIMIT).map((item) => item.content)),
        maxTokens: 700,
        fetch: deps.fetch,
      });
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
    const wait = (deps.cooldown ?? chatCooldown).take(`${profile.id}:${viewer.toLowerCase()}`, (deps.now ?? Date.now)());
    if (!wait.ok) return { status: 200, body: { skipped: 'cooldown', waitSeconds: wait.waitSeconds } };

    const target = await activeProvider(db);
    const apiKey = await readApiKey(env, db, target);
    if (!apiKey) return fail(503, 'no_key', `No hay clave de ${LUX_PROVIDERS[target].label} guardada. Configúrala en Integraciones.`);
    const model = await activeModel(db, target);
    const memories = current.memoryEnabled ? await db.memories(profile.id, MEMORY_LIMIT) : [];
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
 * Lo nuevo que Lux tiene que decir en el overlay. Sin `after`, solo devuelve el último id:
 * así el overlay no repite frases viejas al abrirse. Se autoriza con la clave de OBS.
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
    const afterRaw = req.query.after;
    if (afterRaw === undefined || afterRaw === '') {
      const tts = db.ttsVoice ? await db.ttsVoice(profile.id) : { referenceId: null, engine: null };
      const volume = settingsFromRow(await db.settingsRow(profile.id)).voiceVolume;
      return { status: 200, body: { items: [], last: await db.latestSpeechId(profile.id), tts, volume } };
    }
    const after = Number(afterRaw);
    if (!Number.isInteger(after) || after < 0) return fail(400, 'bad_after', 'El parámetro after no es válido.');
    const items = profile.role === 'admin' || profile.luxEnabled ? await db.speechSince(profile.id, after) : [];
    const tts = db.ttsVoice ? await db.ttsVoice(profile.id) : { referenceId: null, engine: null };
    const volume = settingsFromRow(await db.settingsRow(profile.id)).voiceVolume;
    return { status: 200, body: { items, last: items.length ? items[items.length - 1].id : after, tts, volume } };
  } catch (err) {
    return luxFailure(err, 'lux/speech');
  }
}

/**
 * Memoria del streamer (pestaña Memoria). GET lista sus recuerdos. POST con `op`
 * crea, edita o borra. El dueño es siempre quien hace la petición (su sesión): el
 * id de perfil nunca viene del cuerpo, y cada cambio filtra por ese dueño. El
 * navegador no escribe en la base de datos: todo pasa por aquí.
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
    const nowMs = (deps.now ?? Date.now)();

    if (method === 'GET') {
      await api.memoryPrune(owner, new Date(nowMs).toISOString());
      const items = await api.memoryList(owner);
      const ajustes = settingsFromRow(await db.settingsRow(owner));
      return {
        status: 200,
        body: {
          memories: items,
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
      const items = await api.memoryList(owner);
      if (items.length >= MEMORY_SAVED_MAX) {
        return fail(409, 'memory_full', `Lux ya tiene ${MEMORY_SAVED_MAX} recuerdos guardados. Borra alguno para añadir más.`);
      }
      await api.memoryInsert(owner, [
        { kind: check.value.kind, subject: null, content: check.value.content, pinned: false, source: 'manual', expiresAt: expiresAtFor(check.value.kind, false, nowMs) },
      ]);
      return { status: 200, body: { ok: true } };
    }

    if (raw.op === 'update' || raw.op === 'delete') {
      const id = typeof raw.id === 'string' ? raw.id.trim() : '';
      if (!MEMORY_ID.test(id)) return fail(400, 'bad_id', 'El recuerdo no es válido.');

      // Lo que escribe el administrador (source 'admin') no lo edita ni lo borra el streamer: se ve, nada más.
      const edit = raw.op === 'update' ? normalizeMemoryEdit(raw) : null;
      if (edit && !edit.ok) return fail(400, 'bad_memory', edit.message, { field: edit.field });
      const current = await api.memoryGet(owner, id);
      if (!current) return fail(404, 'memory_not_found', 'Ese recuerdo no existe.');
      if (current.source === 'admin') return fail(403, 'admin_memory', ADMIN_MEMORY_LOCKED);

      if (!edit) {
        const removed = await api.memoryDelete(owner, id);
        return removed ? { status: 200, body: { ok: true } } : fail(404, 'memory_not_found', 'Ese recuerdo no existe.');
      }

      const patch: { content?: string; pinned?: boolean; expiresAt?: string | null } = {};
      if (edit.value.content !== undefined) patch.content = edit.value.content;
      if (edit.value.pinned !== undefined) {
        patch.pinned = edit.value.pinned;
        // Fijar quita la caducidad; desfijar un recuerdo del chat le da 30 días desde ahora.
        patch.expiresAt = expiresAtFor(current.kind, edit.value.pinned, nowMs);
      }
      const changed = await api.memoryUpdate(owner, id, patch);
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
 * el cuerpo porque el admin actúa sobre ella. Solo toca recuerdos con source 'admin'.
 *
 *   list    lista los recuerdos de la cuenta (todos, para ver el cupo)
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
    const nowMs = (deps.now ?? Date.now)();

    if (raw.op === 'list') {
      const items = await api.memoryList(target);
      return { status: 200, body: { memories: items, saved: items.length, savedMax: MEMORY_SAVED_MAX } };
    }

    if (raw.op === 'split') {
      const text = typeof raw.text === 'string' ? raw.text : '';
      if (new TextEncoder().encode(text).length > ADMIN_UPLOAD_MAX_BYTES) {
        return fail(400, 'file_too_big', `El texto pesa más de ${ADMIN_UPLOAD_MAX_BYTES / 1024} KB. Divídelo en partes más pequeñas.`);
      }
      const chunks = splitIntoMemories(text).map((content) => ({ content, blocked: screenMemory(content) }));
      if (chunks.length === 0) return fail(400, 'empty_text', 'No hay texto que convertir en recuerdos.');
      const items = await api.memoryList(target);
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
        rows.push({ kind: check.value.kind, subject: null, content: check.value.content, pinned: false, source: 'admin' as const, expiresAt: expiresAtFor(check.value.kind, false, nowMs, 'admin') });
      }
      const items = await api.memoryList(target);
      const room = Math.max(0, MEMORY_SAVED_MAX - items.length);
      if (rows.length > room) {
        const message = room > 0 ? `Solo caben ${room} recuerdos más (máximo ${MEMORY_SAVED_MAX} por streamer).` : `Esta cuenta ya tiene ${MEMORY_SAVED_MAX} recuerdos. Borra alguno para añadir más.`;
        return fail(409, 'memory_full', message, { room });
      }
      await api.memoryInsert(target, rows);
      return { status: 200, body: { ok: true, saved: rows.length } };
    }

    if (raw.op === 'update' || raw.op === 'delete') {
      const id = typeof raw.id === 'string' ? raw.id.trim() : '';
      if (!MEMORY_ID.test(id)) return fail(400, 'bad_id', 'El recuerdo no es válido.');
      // Solo los del administrador: los de la cuenta (chat o manuales) no se tocan desde aquí.
      const current = await api.memoryGet(target, id);
      if (!current || current.source !== 'admin') return fail(404, 'memory_not_found', 'Ese recuerdo no existe.');

      if (raw.op === 'delete') {
        const removed = await api.memoryDelete(target, id);
        return removed ? { status: 200, body: { ok: true } } : fail(404, 'memory_not_found', 'Ese recuerdo no existe.');
      }
      const edit = normalizeMemoryEdit({ content: raw.content });
      if (!edit.ok) return fail(400, 'bad_memory', edit.message, { field: edit.field });
      const content = edit.value.content ?? '';
      const reason = screenMemory(content);
      if (reason) return fail(400, 'bad_memory', `Ese texto no se puede guardar: contiene ${reason}.`, { field: 'content' });
      const changed = await api.memoryUpdate(target, id, { content });
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
  }
}
