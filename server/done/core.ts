/**
 * server/done/core.ts
 *
 * Piezas comunes de los manejadores de Done: dependencias, acceso a las bases, el actor (perfil + ajustes),
 * la elección del modelo y el consumo, la llamada a la IA y la cola de voz del overlay.
 *
 * Done usa los MISMOS proveedores y la misma configuración que Lux (Mistral o NVIDIA): el proveedor activo
 * (app_settings.lux_provider), la bóveda de claves cifradas (keyVault.ts), el catálogo de modelos y la regla
 * de fallback de pickModel (modelo deshabilitado o sin presupuesto -> el modelo gratis), y los créditos del
 * plan (lux_add_usage / plans.lux_monthly_credits). Aquí no se reinventa nada de eso: se importa.
 */

import { defaultDeps, fail, failureOf, type Auth, type IntegrationResult } from '../integrations/http.js';
import { MigrationMissingError, type Env } from '../integrations/store.js';
import { activeModel, activeProvider, readApiKey } from '../lux/keyVault.js';
import { supabaseLuxDb, type LuxDb, type LuxProfile } from '../lux/luxDb.js';
import { NvidiaError, nvidiaChat, LUX_PROVIDERS, type ChatMessage, type LuxProvider, type NvidiaFetch } from '../lux/nvidia.js';
import { MODEL_CONFIG_SETTING, monthOf, parseModelConfig, pickModel, type PickResult } from '../lux/models.js';
import { BUILTIN_CHARACTER, type LuxCharacter } from '../lux/characters.js';
import { DONE_GESTURES } from '../../src/lib/doneSettings.js';
import { effectiveModel, overlayViewFor, type EffectiveModel } from '../lux/effectiveModel.js';
import { visibleTo, type LibraryModel } from '../lux/modelLibrary.js';
import { replyTokens } from '../lux/prompt.js';
import { LuxCooldown } from '../lux/chatCommands.js';
import { BOT_ONLINE_MS, EVENT_MIN_GAP_MS, SAY_COOLDOWN_MS } from '../lux/proactive.js';
import { FAILURE_NOTICE_GAP_MS, NoticeGate, failureNotice } from '../chat/sharedRules.js';
import { riotModels } from '../lux/handlers.js';
import type { ModelBytes } from '../lux/mascotaModel.js';
import type { DoneSettings } from '../../src/lib/doneTypes.js';
import { supabaseDoneDb, type DoneDb } from './doneDb.js';
import { doneSettingsFromRow } from './settings.js';
import { parseDoneOutput, DONE_NAME } from './prompt.js';
import type { DoneEmotion, DoneGesture, DoneKind } from '../../src/lib/doneTypes.js';

/** Los recuerdos que entran en cada respuesta. */
export const DONE_MEMORIES_IN_REPLY = 20;
/** Espectador por defecto cuando el bot no manda nombre. */
export const VIEWER_MAX = 40;

export interface DoneDeps {
  fetch: NvidiaFetch;
  auth: Auth;
  lux: (env: Env) => LuxDb | null;
  done: (env: Env) => DoneDb | null;
  /** Lee el GLB del bucket privado. Las pruebas pasan uno falso. */
  modelBytes?: (env: Env, key: string) => Promise<ModelBytes>;
  /** Espera por espectador (HTTP). El bot en la nube pasa la persistente. */
  cooldown?: LuxCooldown;
  sayCooldown?: LuxCooldown;
  eventCooldown?: LuxCooldown;
  /** Avisos de espera y de fallo: un límite de frecuencia. Las pruebas pasan los suyos. */
  waitNotices?: NoticeGate;
  failureNotices?: NoticeGate;
  /** Se llama tras dejar un mensaje en la cola, para que el bot en la nube lo envíe ya. */
  afterEnqueue?: (profileId: string, env: Env) => Promise<void>;
  now?: () => number;
}

export const defaultDoneDeps: DoneDeps = {
  fetch: (...args) => fetch(...args),
  auth: defaultDeps.auth,
  lux: supabaseLuxDb,
  done: supabaseDoneDb,
};

/** Estado compartido del proceso (cada instancia lleva el suyo). */
export const chatCooldown = new LuxCooldown();
export const sayGap = new LuxCooldown(SAY_COOLDOWN_MS);
export const eventGap = new LuxCooldown(EVENT_MIN_GAP_MS);
export const waitNotices = new NoticeGate();
export const failureNotices = new NoticeGate();

export interface Stores {
  lux: LuxDb;
  done: DoneDb;
}

export function openStores(env: Env, deps: DoneDeps): Stores | null {
  const lux = deps.lux(env);
  const done = deps.done(env);
  return lux && done ? { lux, done } : null;
}

export const notConfigured = (): IntegrationResult => fail(503, 'not_configured', 'Al servidor le faltan variables de Supabase.');

/** Como failureOf, pero el aviso de migración nombra la de Done. */
export function doneFailure(err: unknown, where: string): IntegrationResult {
  if (err instanceof MigrationMissingError) return fail(503, 'migration_missing', 'Falta aplicar la migración de Done (0054) en Supabase.');
  return failureOf(err, where);
}

export const bodyOf = (body: unknown): Record<string, unknown> => (body && typeof body === 'object' ? (body as Record<string, unknown>) : {});

export const clock = (deps: DoneDeps): number => (deps.now ?? Date.now)();

// ---------- Actor: perfil + ajustes ----------

export interface Actor {
  profile: LuxProfile;
  settings: DoneSettings;
  /** Done está permitido para la cuenta (administrador, o profiles.done_enabled). */
  allowed: boolean;
}

export async function loadActor(stores: Stores, profile: LuxProfile): Promise<Actor> {
  const settings = doneSettingsFromRow(await stores.done.settingsRow(profile.id));
  const allowed = profile.role === 'admin' || (await stores.done.doneEnabled(profile.id));
  return { profile, settings, allowed };
}

// ---------- Personaje, modelo 3D, modelo de IA y consumo ----------

/**
 * Personaje de Done. characterId: 'lux', 'svg:done|cam|faro|sombra' (dibujos) o 'glb:<id>' (modelo 3D, con modelId); null = 'svg:done'.
 * Todos hacen los 11 gestos. El modelo de IA lo decide pickModel (el por defecto del proveedor), no el personaje.
 */
export async function characterOf(_lux: LuxDb, actor: Actor): Promise<LuxCharacter> {
  const id = actor.settings.characterId ?? 'svg:done';
  return { ...BUILTIN_CHARACTER, id, name: DONE_NAME, avatar: id as LuxCharacter['avatar'], gestures: [...DONE_GESTURES], model: null };
}

/** Modelo 3D efectivo: solo con 'glb:<id>' y un modelId que la cuenta ve (biblioteca compartida con Lux, o Riot). */
export async function effectiveOf(lux: LuxDb, actor: Actor, character: LuxCharacter): Promise<EffectiveModel | null> {
  if (!character.id.startsWith('glb:')) return null;
  let chosen: LibraryModel | null = null;
  if (actor.settings.modelId) {
    const characters = lux.characters ? await lux.characters() : [];
    const rows = lux.libraryModels ? await lux.libraryModels() : [];
    chosen = visibleTo([...riotModels(characters), ...rows], actor.profile.id).find((model) => model.id === actor.settings.modelId) ?? null;
  }
  return effectiveModel(character, actor.profile.id, chosen);
}

/** Lo que el overlay dibuja: avatar, color y gestos del personaje, con el modelo efectivo. Sin claves. */
export async function overlayCharacter(lux: LuxDb, actor: Actor) {
  const character = await characterOf(lux, actor);
  const effective = await effectiveOf(lux, actor, character);
  const base = overlayViewFor(character, effective);
  // Resuelto para el overlay: tipo (dibujo o modelo 3D), id del modelo si lo hay, color y gestos permitidos. Sin claves.
  const view = {
    id: actor.settings.characterId ?? 'svg:done',
    kind: effective ? ('glb' as const) : ('svg' as const),
    modelId: effective ? effective.id : null,
    avatar: base.avatar,
    color: base.color,
    gestures: base.gestures,
    licenseNotice: base.licenseNotice,
  };
  return { character, view };
}

async function budgetOf(lux: LuxDb, profile: LuxProfile): Promise<number | null> {
  if (!lux.planBudget) return null;
  if (!profile.planId) return 0;
  return (await lux.planBudget(profile.planId)) ?? 0;
}

/** Modelo de IA de esta respuesta, con la regla de fallback de Lux (models.ts): al gratis si está deshabilitado o sin presupuesto. */
export async function modelChoice(lux: LuxDb, provider: LuxProvider, character: LuxCharacter, profile: LuxProfile, nowMs: number): Promise<PickResult> {
  const config = parseModelConfig(await lux.setting(MODEL_CONFIG_SETTING));
  const spent = lux.usageThisMonth ? await lux.usageThisMonth(profile.id, monthOf(nowMs)) : 0;
  return pickModel({
    provider,
    wanted: character.model,
    defaultModel: await activeModel(lux, provider),
    config,
    spent,
    budget: await budgetOf(lux, profile),
  });
}

/** Suma al consumo del mes lo que costó la respuesta (lux_add_usage). Si falla, la respuesta se entrega igual. */
async function recordUsage(lux: LuxDb, profile: LuxProfile, nowMs: number, choice: PickResult): Promise<void> {
  if (choice.cost <= 0 || !lux.addUsage) return;
  await lux.addUsage(profile.id, monthOf(nowMs), choice.cost).catch(() => {
    console.error('[Tally Studio done] no se pudo registrar el consumo de créditos');
  });
}

// ---------- La llamada a la IA ----------

export type AiCode = 'no_key' | 'unauthorized' | 'model_unavailable' | 'rate_limited' | 'timeout' | 'bad_response' | 'upstream';

export type AiRun =
  | { ok: true; text: string; model: string; fellBack: PickResult['fellBack']; character: LuxCharacter }
  | { ok: false; code: AiCode };

/**
 * Pide una respuesta al proveedor activo de Lux con el modelo que toca. Un fallo del proveedor NO lanza:
 * se devuelve como `{ ok: false, code }` (sin la clave ni el texto de la petición) para que quien llama decida.
 * `build` recibe el personaje (de él salen los gestos permitidos).
 */
export async function runModel(
  env: Env,
  stores: Stores,
  deps: DoneDeps,
  actor: Actor,
  nowMs: number,
  build: (character: LuxCharacter) => ChatMessage[],
  maxTokens?: number
): Promise<AiRun> {
  const provider = await activeProvider(stores.lux);
  const apiKey = await readApiKey(env, stores.lux, provider);
  if (!apiKey) return { ok: false, code: 'no_key' };
  const character = await characterOf(stores.lux, actor);
  const choice = await modelChoice(stores.lux, provider, character, actor.profile, nowMs);
  try {
    const text = await nvidiaChat({
      baseUrl: LUX_PROVIDERS[provider].baseUrl,
      apiKey,
      model: choice.model,
      messages: build(character),
      maxTokens: maxTokens ?? replyTokens(actor.settings.replyMax),
      fetch: deps.fetch,
    });
    await recordUsage(stores.lux, actor.profile, nowMs, choice);
    return { ok: true, text, model: choice.model, fellBack: choice.fellBack, character };
  } catch (err) {
    if (!(err instanceof NvidiaError)) throw err;
    console.error(`[Tally Studio done] la IA falló (${err.code})`);
    return { ok: false, code: err.code };
  }
}

/** Aviso corto para el chat cuando la IA falla, o undefined si ya se avisó hace poco en este canal. */
export function failureNoticeFor(deps: DoneDeps, profileId: string, nowMs: number): string | undefined {
  const gate = deps.failureNotices ?? failureNotices;
  return gate.allow(profileId, nowMs, FAILURE_NOTICE_GAP_MS) ? failureNotice(DONE_NAME) : undefined;
}

// ---------- Voz y gestos del overlay ----------

export interface Delivered {
  text: string;
  emotion: DoneEmotion;
  gesture: DoneGesture | null;
}

/** Deja una frase en la cola de voz del overlay y poda lo viejo (más de diez minutos). No lanza. */
export async function enqueueSpeech(done: DoneDb, profileId: string, out: Delivered, viewer: string | null, kind: DoneKind): Promise<void> {
  await done
    .insertSpeech({ profile_id: profileId, text: out.text, emotion: out.emotion, gesture: out.gesture, viewer, kind })
    .catch(() => console.error('[Tally Studio done] no se pudo encolar la voz para el overlay'));
  await done.pruneSpeech(profileId, new Date(Date.now() - 10 * 60_000).toISOString()).catch(() => undefined);
}

/** Lee lo que dijo el modelo: sin etiquetas, con el gesto validado contra el personaje y filtrado. */
export function readOutput(text: string, character: LuxCharacter, replyMax: number, viewer?: string) {
  return parseDoneOutput(text, character.gestures, replyMax, viewer);
}

// ---------- Presencia del bot ----------

const botSeenKey = (profileId: string): string => `done_bot_seen:${profileId}`;
const botSeenLocal = new Map<string, number>();
const BOT_SEEN_WRITE_GAP_MS = 15_000;

/** El bot ha preguntado: se anota (como mucho cada 15 s). El panel y el overlay saben así que hay un bot vivo. */
export async function touchBot(lux: LuxDb, profileId: string, nowMs: number): Promise<void> {
  const last = botSeenLocal.get(profileId);
  if (last !== undefined && nowMs - last >= 0 && nowMs - last < BOT_SEEN_WRITE_GAP_MS) return;
  botSeenLocal.set(profileId, nowMs);
  await lux.putSetting(botSeenKey(profileId), String(nowMs)).catch(() => undefined);
}

export async function botOnline(lux: LuxDb, profileId: string, nowMs: number): Promise<boolean> {
  const raw = await lux.setting(botSeenKey(profileId)).catch(() => null);
  const seen = raw && Number.isFinite(Number(raw)) ? Number(raw) : null;
  return seen !== null && nowMs - seen < BOT_ONLINE_MS;
}

/** Claves de app_settings del estado de Done (marcas de tiempo; no necesitan transacción). */
export const digestKey = (profileId: string): string => `done_digest:${profileId}`;
export const spontaneousKey = (profileId: string): string => `done_spontaneous:${profileId}`;
