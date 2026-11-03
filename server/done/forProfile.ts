/**
 * server/done/forProfile.ts
 *
 * Done «como este perfil», para el bot en la nube y EventSub: lo mismo que /api/done/chat, sin pasar por HTTP ni por
 * la clave de OBS (el canal de Twitch ya identificó al perfil). Son las MISMAS funciones de chat.ts: ninguna regla
 * se repite aquí. Ninguna de estas lanza; los fallos se devuelven (o se registran sin datos sensibles).
 */

import { fail, type IntegrationResult } from '../integrations/http.js';
import type { Env } from '../integrations/store.js';
import { clock, defaultDoneDeps, doneFailure, loadActor, openStores, spontaneousKey, touchBot, digestKey, type Actor, type DoneDeps, type Stores } from './core.js';
import { askDone, claimOutbox, learnState, spontaneousDone, summarizeChat, switchDone } from './chat.js';
import { cleanName } from '../lux/proactive.js';
import type { DoneSettings } from '../../src/lib/doneTypes.js';

const logError = (what: string, err: unknown): void => {
  console.error(`[Lalo done] ${what}:`, err instanceof Error ? err.message.slice(0, 200) : 'error desconocido');
};

type Overrides = Partial<DoneDeps>;

/** Abre las bases y carga al actor del perfil. null si falta Supabase o el perfil no existe. */
async function open(profileId: string, env: Env, overrides: Overrides): Promise<{ stores: Stores; actor: Actor; deps: DoneDeps } | null> {
  const deps: DoneDeps = { ...defaultDoneDeps, ...overrides };
  const stores = openStores(env, deps);
  if (!stores) return null;
  const profile = await stores.lux.profile(profileId);
  return profile ? { stores, actor: await loadActor(stores, profile), deps } : null;
}

/** Ajustes de Done del perfil y si está permitido; null si no se pueden leer. */
export async function doneSettingsForProfile(profileId: string, env: Env = process.env, overrides: Overrides = {}): Promise<{ settings: DoneSettings; allowed: boolean } | null> {
  try {
    const found = await open(profileId, env, overrides);
    return found ? { settings: found.actor.settings, allowed: found.actor.allowed } : null;
  } catch (err) {
    logError('no se pudieron leer los ajustes', err);
    return null;
  }
}

export interface DoneAskInput {
  viewer: string;
  message: string;
  /** Espera por espectador. El bot en la nube pasa la persistente (BotDb.takeCooldown). */
  takeCooldown: (viewer: string, nowMs: number) => Promise<{ ok: true } | { ok: false; waitSeconds: number }> | { ok: true } | { ok: false; waitSeconds: number };
}

/** Lo mismo que POST /api/done/chat con command 'ask' desde el bot en la nube. body.reply = lo que hay que escribir; body.notice = aviso. */
export async function doneAskForProfile(profileId: string, input: DoneAskInput, env: Env = process.env, overrides: Overrides = {}): Promise<IntegrationResult> {
  try {
    const found = await open(profileId, env, overrides);
    if (!found) return fail(403, 'no_profile', 'No se encontró tu perfil.');
    return await askDone(found.stores, env, found.deps, found.actor, { viewer: input.viewer, message: input.message, source: 'cloud' }, input.takeCooldown);
  } catch (err) {
    return doneFailure(err, 'done/chat');
  }
}

/** !doneon / !doneoff desde el bot en la nube (quien llama comprueba antes que el autor es el canal o un moderador). */
export async function doneSwitchForProfile(profileId: string, on: boolean, env: Env = process.env, overrides: Overrides = {}): Promise<boolean | null> {
  try {
    const found = await open(profileId, env, overrides);
    if (!found) return null;
    await switchDone(found.stores, found.actor, on);
    return on;
  } catch (err) {
    logError('no se pudo cambiar a Done', err);
    return null;
  }
}

/**
 * La cola del panel y los saludos a eventos, enviados por el servidor: recoge hasta 3 mensajes, los manda con `send` y marca cada
 * uno como enviado o fallido. 'retry' devuelve el mensaje a la cola (el limitador pidió esperar). Un `send` que falla no se reintenta.
 */
export async function doneOutboxForProfile(
  profileId: string,
  send: (text: string) => Promise<boolean | 'retry'>,
  env: Env = process.env,
  overrides: Overrides = {}
): Promise<{ sent: number; failed: number }> {
  const result = { sent: 0, failed: 0 };
  try {
    const found = await open(profileId, env, overrides);
    if (!found) return result;
    const { stores, actor, deps } = found;
    const items = await claimOutbox(stores, env, deps, actor, clock(deps), false);
    for (const item of items) {
      let outcome: boolean | 'retry' = false;
      try {
        outcome = await send(item.text);
      } catch {
        outcome = false;
      }
      if (outcome === 'retry') {
        if (await stores.done.outboxRelease(profileId, item.id).catch(() => false)) continue;
        outcome = false;
      }
      if (item.speak) {
        await stores.done.insertSpeech({ profile_id: profileId, text: item.text, emotion: item.emotion, gesture: item.gesture, viewer: null, kind: 'say' }).catch(() => undefined);
      }
      const ok = outcome === true;
      await stores.done.outboxFinish(profileId, item.id, ok, new Date(clock(deps)).toISOString()).catch(() => false);
      if (ok) result.sent += 1;
      else result.failed += 1;
    }
    return result;
  } catch (err) {
    logError('cola de mensajes en la nube', err);
    return result;
  }
}

export type DoneEventInput = { kind: 'follow'; user: string } | { kind: 'start'; streamId: string };

const startKey = (profileId: string): string => `done_start:${profileId}`;

/**
 * Apunta un seguidor nuevo o un inicio de directo que llegó por EventSub (lo llama el webhook, ya con la firma
 * comprobada). Solo deja UNA fila en la cola (done_outbox, kind 'event'): escritura atómica, sin estado repartido en
 * app_settings. El saludo lo redacta flushEvents cuando el bot pregunta su cola. Devuelve qué pasó; no lanza.
 */
export async function doneRecordChannelEvent(profileId: string, input: DoneEventInput, env: Env = process.env, overrides: Overrides = {}): Promise<string> {
  try {
    const found = await open(profileId, env, overrides);
    if (!found) return 'no_profile';
    const { stores, actor } = found;
    if (!actor.allowed) return 'done_disabled';
    if (!actor.settings.enabled) return 'done_off';
    if (input.kind === 'follow') {
      if (!actor.settings.eventFollow) return 'event_off';
      await stores.done.outboxInsert({
        profile_id: profileId,
        kind: 'event',
        text: '',
        speak: false,
        emotion: 'normal',
        gesture: null,
        mode: 'ai',
        payload: { type: 'follow', user: cleanName(input.user) },
      });
      return 'queued';
    }
    if (!actor.settings.eventStart) return 'event_off';
    // Twitch puede avisar dos veces del mismo directo: solo se saluda una vez por directo
    const streamId = input.streamId.slice(0, 40);
    if (streamId && (await stores.lux.setting(startKey(profileId)).catch(() => null)) === streamId) return 'repeat';
    if (streamId) await stores.lux.putSetting(startKey(profileId), streamId).catch(() => undefined);
    await stores.done.outboxInsert({ profile_id: profileId, kind: 'event', text: '', speak: false, emotion: 'normal', gesture: null, mode: 'ai', payload: { type: 'start' } });
    return 'queued';
  } catch (err) {
    logError('no se pudo apuntar el evento del canal', err);
    return 'error';
  }
}

export interface DoneProactiveStatus {
  allowed: boolean;
  /** Done está encendido y el creador activó aprender del chat. */
  learning: boolean;
  digestReady: boolean;
  spontaneous: { enabled: boolean; waitSeconds: number; minMessages: number };
}

const numberOrNull = (raw: string | null): number | null => (raw && Number.isFinite(Number(raw)) ? Number(raw) : null);

/** Estado de aprendizaje y comentarios espontáneos del perfil, o null si no se puede leer. */
export async function doneProactiveStatusForProfile(profileId: string, env: Env = process.env, overrides: Overrides = {}): Promise<DoneProactiveStatus | null> {
  try {
    const found = await open(profileId, env, overrides);
    if (!found) return null;
    const { stores, actor, deps } = found;
    const nowMs = clock(deps);
    const state = learnState(actor, numberOrNull(await stores.lux.setting(digestKey(profileId))), nowMs);
    const enabled = actor.allowed && actor.settings.enabled && actor.settings.spontaneousEveryMin > 0;
    const lastMs = numberOrNull(await stores.lux.setting(spontaneousKey(profileId)));
    const waitMs = lastMs === null ? 0 : Math.max(0, actor.settings.spontaneousEveryMin * 60_000 - (nowMs - lastMs));
    return {
      allowed: actor.allowed,
      learning: state.learning,
      digestReady: state.ready,
      spontaneous: { enabled, waitSeconds: Math.ceil(waitMs / 1000), minMessages: actor.settings.spontaneousMinMessages },
    };
  } catch (err) {
    logError('no se pudo leer el estado del aprendizaje', err);
    return null;
  }
}

/** Mismo resultado que `command: 'summary'` de la ruta, para el bot en la nube. */
export async function doneSummaryForProfile(profileId: string, lines: Array<{ viewer: string; text: string }>, env: Env = process.env, overrides: Overrides = {}): Promise<IntegrationResult> {
  try {
    const found = await open(profileId, env, overrides);
    if (!found) return fail(403, 'no_profile', 'No se encontró tu perfil.');
    return await summarizeChat(found.stores, env, found.deps, found.actor, lines, clock(found.deps));
  } catch (err) {
    return doneFailure(err, 'done/chat');
  }
}

/** Mismo resultado que `command: 'spontaneous'` de la ruta, para el bot en la nube. body.reply = lo que hay que escribir. */
export async function doneSpontaneousForProfile(profileId: string, lines: Array<{ viewer: string; text: string }>, env: Env = process.env, overrides: Overrides = {}): Promise<IntegrationResult> {
  try {
    const found = await open(profileId, env, overrides);
    if (!found) return fail(403, 'no_profile', 'No se encontró tu perfil.');
    const nowMs = clock(found.deps);
    await touchBot(found.stores.lux, profileId, nowMs);
    return await spontaneousDone(found.stores, env, found.deps, found.actor, lines, nowMs);
  } catch (err) {
    return doneFailure(err, 'done/chat');
  }
}
