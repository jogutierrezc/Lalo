/**
 * server/done/chat.ts
 *
 * POST /api/done/chat. El bot de Python y el overlay lo llaman con una clave; el bot de la nube llama a las mismas
 * funciones sin HTTP (forProfile.ts). Un solo camino, una sola regla:
 *
 *   ask          un espectador llama a Done (cooldown, aviso de espera y aviso de fallo viven AQUÍ, no en cada bot)
 *   on / off     el canal o un moderador enciende o apaga a Done (privileged lo declara el bot)
 *   outbox       el bot recoge los mensajes del panel y los saludos a eventos que toca decir
 *   outbox_done  el bot confirma que lo publicó
 *   spontaneous  comentario espontáneo con las últimas líneas del chat
 *   event        saludo a eventos del canal (subs y raids llegan por el chat)
 *   summary      resumen del chat en recuerdos (si el creador activó aprender del chat)
 *
 * Autorización: la clave de OBS del creador (profiles.widget_key) para el bot; la clave de LECTURA (readKey.ts) solo
 * vale para `ask` desde el overlay, que no puede escribir en el chat y por eso cede ante un bot vivo.
 *
 * Cada respuesta que el bot debe escribir lleva `reply` (o `notice`: aviso de espera o de fallo, ya con límite de
 * frecuencia). Nunca se devuelve una clave ni un token.
 */

import { fail, type IntegrationRequest, type IntegrationResult } from '../integrations/http.js';
import type { Env } from '../integrations/store.js';
import { CHAT_MESSAGE_MAX, WAIT_NOTICE_GAP_MS, waitNotice } from '../chat/sharedRules.js';
import { detectGestureRequest, detectIntent } from '../lux/intent.js';
import { threadViewerKey, LUX_THREAD_CONTENT_MAX } from '../lux/thread.js';
import { DIGEST_MIN_GAP_MS, keepDigestItems, normalizeDigestLines, parseDigest } from '../lux/digest.js';
import { DIGEST_MAX_ITEMS, MEMORY_SAVED_MAX, expiresAtFor } from '../lux/memory.js';
import { eventsAllowed, normalizeEvents } from '../lux/proactive.js';
import type { LuxProfile } from '../lux/luxDb.js';
import type { DoneGesture } from '../../src/lib/doneTypes.js';
import { doneRowFromSettings } from './settings.js';
import { buildDoneDigestMessages, buildDoneEventMessages, buildDoneMessages, buildDoneSpontaneousMessages, DONE_NAME } from './prompt.js';
import {
  DONE_MEMORIES_IN_REPLY,
  VIEWER_MAX,
  bodyOf,
  botOnline,
  chatCooldown,
  clock,
  digestKey,
  doneFailure,
  enqueueSpeech,
  eventGap,
  failureNoticeFor,
  loadActor,
  notConfigured,
  openStores,
  readOutput,
  runModel,
  spontaneousKey,
  touchBot,
  waitNotices,
  type Actor,
  type DoneDeps,
  type Stores,
} from './core.js';
import { verifyReadKey, profileIdOfReadKey } from './readKey.js';

/** Los eventos juntos se saludan cuando el más viejo lleva esto esperando (agrupa ráfagas de seguidores). */
export const EVENT_GROUP_MS = 10_000;

type Cooldown = (viewer: string, nowMs: number) => Promise<{ ok: true } | { ok: false; waitSeconds: number }> | { ok: true } | { ok: false; waitSeconds: number };

const skipped = (reason: string, extra: Record<string, unknown> = {}): IntegrationResult => ({ status: 200, body: { skipped: reason, ...extra } });

/** Por qué no se atiende nada para esta cuenta, o null. */
function blocked(actor: Actor): IntegrationResult | null {
  if (!actor.allowed) return skipped('done_disabled');
  if (!actor.settings.enabled) return skipped('done_off');
  return null;
}

// ---------- ask ----------

export interface AskRaw {
  viewer?: unknown;
  message?: unknown;
  source?: unknown;
}

export async function askDone(stores: Stores, env: Env, deps: DoneDeps, actor: Actor, raw: AskRaw, takeCooldown: Cooldown): Promise<IntegrationResult> {
  const off = blocked(actor);
  if (off) return off;
  const { profile, settings } = actor;
  const nowMs = clock(deps);
  const fromOverlay = raw.source === 'overlay';

  // El overlay también lee el chat, pero no puede escribir en él: si hay un bot vivo, le cede la pregunta
  if (fromOverlay) {
    if (await botOnline(stores.lux, profile.id, nowMs)) return skipped('bot_active');
  } else {
    await touchBot(stores.lux, profile.id, nowMs);
  }

  const message = typeof raw.message === 'string' ? raw.message.trim() : '';
  if (!message || message.length > CHAT_MESSAGE_MAX) return fail(400, 'bad_message', `El mensaje tiene que tener entre 1 y ${CHAT_MESSAGE_MAX} caracteres.`);
  const named = typeof raw.viewer === 'string' && raw.viewer.trim() ? raw.viewer.trim().slice(0, VIEWER_MAX) : null;
  const viewer = named ?? 'Espectador';

  const wait = await takeCooldown(viewer, nowMs);
  if (!wait.ok) {
    // Un aviso por persona cada WAIT_NOTICE_GAP_MS: la misma regla para el bot de Python y el de la nube
    const notice = !fromOverlay && (deps.waitNotices ?? waitNotices).allow(`${profile.id}:${viewer.toLowerCase()}`, nowMs, WAIT_NOTICE_GAP_MS) ? waitNotice(viewer, DONE_NAME, wait.waitSeconds) : undefined;
    return skipped('cooldown', { waitSeconds: wait.waitSeconds, ...(notice ? { notice } : {}) });
  }

  const intent = detectIntent(message);
  const memories = settings.memoryEnabled ? await stores.done.memories(profile.id, DONE_MEMORIES_IN_REPLY) : [];
  // Sin nombre de espectador («Espectador» es solo el de respaldo) no hay hilo: mezclaría a desconocidos
  const thread = settings.threadEnabled && named ? await stores.done.threadRecent(profile.id, threadViewerKey(named), nowMs).catch(() => []) : [];

  const run = await runModel(env, stores, deps, actor, nowMs, (character) =>
    buildDoneMessages({
      commandWord: settings.commandWord,
      personality: settings.personality,
      language: settings.language,
      replyMax: settings.replyMax,
      gestures: character.gestures,
      memories,
      viewer,
      message,
      intent,
      banter: settings.banter,
      thread,
    })
  );
  if (!run.ok) {
    // La IA falló: el bot escribe un aviso corto en el chat (con límite de frecuencia); el overlay no escribe
    const notice = fromOverlay ? undefined : failureNoticeFor(deps, profile.id, nowMs);
    return { status: 200, body: { failed: run.code === 'no_key' ? 'no_key' : 'ai_failed', ...(notice ? { notice } : {}) } };
  }

  const out = readOutput(run.text, run.character, settings.replyMax, viewer);
  if (!out.text) return skipped('filtered');
  // Si el espectador pidió un gesto («baila»), manda; si no, el que eligió el modelo. Siempre del catálogo del personaje.
  const requested = detectGestureRequest(message);
  const asked = requested && (run.character.gestures as readonly string[]).includes(requested) ? (requested as DoneGesture) : null;
  const gesture = asked ?? out.gesture;

  if (settings.threadEnabled && named) {
    await stores.done
      .threadSave(profile.id, threadViewerKey(named), { user: message.slice(0, LUX_THREAD_CONTENT_MAX), assistant: out.text.slice(0, LUX_THREAD_CONTENT_MAX) }, nowMs)
      .catch(() => console.error('[Tally Studio done] no se pudo guardar el hilo del espectador'));
  }
  await stores.done.insertReply({ profile_id: profile.id, viewer, prompt: message, reply: out.text, model: run.model }).catch(() => {
    console.error('[Tally Studio done] no se pudo guardar el registro de la respuesta');
  });
  await enqueueSpeech(stores.done, profile.id, { text: out.text, emotion: out.emotion, gesture }, viewer, 'chat');
  return { status: 200, body: { reply: out.text, emotion: out.emotion, gesture, intent, model: run.model, modelNote: run.fellBack } };
}

// ---------- on / off ----------

export async function switchDone(stores: Stores, actor: Actor, on: boolean): Promise<IntegrationResult> {
  await stores.done.saveSettingsRow(doneRowFromSettings(actor.profile.id, { ...actor.settings, enabled: on }));
  return { status: 200, body: { enabled: on } };
}

// ---------- Resumen del chat ----------

export function learnState(actor: Actor, lastMs: number | null, nowMs: number) {
  const learning = actor.allowed && actor.settings.enabled && actor.settings.chatLearning;
  const waitMs = lastMs === null ? 0 : Math.max(0, DIGEST_MIN_GAP_MS - (nowMs - lastMs));
  return { learning, ready: learning && waitMs === 0, waitMs, waitSeconds: Math.ceil(waitMs / 1000) };
}

const numberOrNull = (raw: string | null): number | null => (raw && Number.isFinite(Number(raw)) ? Number(raw) : null);

export async function summarizeChat(stores: Stores, env: Env, deps: DoneDeps, actor: Actor, rawLines: unknown, nowMs: number): Promise<IntegrationResult> {
  const off = blocked(actor);
  if (off) return off;
  const state = learnState(actor, numberOrNull(await stores.lux.setting(digestKey(actor.profile.id))), nowMs);
  if (!actor.settings.chatLearning) return skipped('learning_off');
  if (state.waitMs > 0) return skipped('too_soon', { waitSeconds: state.waitSeconds });
  const lines = normalizeDigestLines(rawLines);
  if (lines.length === 0) return skipped('no_chat');

  await stores.done.memoryPrune(actor.profile.id, new Date(nowMs).toISOString());
  const existing = await stores.done.memoryList(actor.profile.id);
  const room = MEMORY_SAVED_MAX - existing.length;
  if (room <= 0) return skipped('memory_full');

  // Se marca antes de llamar al modelo: un fallo no provoca reintentos seguidos
  await stores.lux.putSetting(digestKey(actor.profile.id), String(nowMs));
  const run = await runModel(
    env,
    stores,
    deps,
    actor,
    nowMs,
    () => buildDoneDigestMessages(lines, existing.slice(0, DONE_MEMORIES_IN_REPLY).map((item) => item.content), actor.settings.language),
    700
  );
  if (!run.ok) return skipped('ai_failed');
  const found = parseDigest(run.text);
  const kept = keepDigestItems(found).slice(0, Math.min(DIGEST_MAX_ITEMS, room));
  if (kept.length > 0) {
    await stores.done.memoryInsert(
      actor.profile.id,
      kept.map((item) => ({ kind: item.kind, subject: item.subject, content: item.content, pinned: false, source: 'chat' as const, expiresAt: expiresAtFor(item.kind, false, nowMs) }))
    );
  }
  return { status: 200, body: { learned: kept.length, discarded: found.length - kept.length } };
}

// ---------- Comentario espontáneo ----------

export async function spontaneousDone(stores: Stores, env: Env, deps: DoneDeps, actor: Actor, rawLines: unknown, nowMs: number): Promise<IntegrationResult> {
  const off = blocked(actor);
  if (off) return off;
  const { settings, profile } = actor;
  if (settings.spontaneousEveryMin === 0) return skipped('spontaneous_off');

  const lastMs = numberOrNull(await stores.lux.setting(spontaneousKey(profile.id)));
  const waitMs = lastMs === null ? 0 : Math.max(0, settings.spontaneousEveryMin * 60_000 - (nowMs - lastMs));
  if (waitMs > 0) return skipped('too_soon', { waitSeconds: Math.ceil(waitMs / 1000) });

  const lines = normalizeDigestLines(rawLines);
  if (lines.length < settings.spontaneousMinMessages) return skipped('no_activity', { needed: settings.spontaneousMinMessages, seen: lines.length });

  // Se marca antes de llamar al modelo: un fallo no provoca reintentos seguidos, y no se acumulan los perdidos
  await stores.lux.putSetting(spontaneousKey(profile.id), String(nowMs));
  const memories = settings.memoryEnabled ? await stores.done.memories(profile.id, DONE_MEMORIES_IN_REPLY) : [];
  const run = await runModel(env, stores, deps, actor, nowMs, (character) =>
    buildDoneSpontaneousMessages({
      commandWord: settings.commandWord,
      personality: settings.personality,
      language: settings.language,
      replyMax: settings.replyMax,
      gestures: character.gestures,
      memories,
      lines,
    })
  );
  // Lo que Done dice por su cuenta nunca avisa de un fallo: si la IA falla, no se escribe nada
  if (!run.ok) return skipped('ai_failed');
  const out = readOutput(run.text, run.character, settings.replyMax);
  if (!out.text) return skipped('empty');
  await enqueueSpeech(stores.done, profile.id, out, null, 'spontaneous');
  await stores.done.insertReply({ profile_id: profile.id, viewer: null, prompt: '(comentario espontáneo)', reply: out.text, model: run.model }).catch(() => undefined);
  return { status: 200, body: { reply: out.text, emotion: out.emotion, gesture: out.gesture, model: run.model } };
}

// ---------- Eventos ----------

/** Saludo a eventos que el bot ya agrupó (subs y raids por el chat). */
export async function eventDone(stores: Stores, env: Env, deps: DoneDeps, actor: Actor, rawEvents: unknown, nowMs: number): Promise<IntegrationResult> {
  const off = blocked(actor);
  if (off) return off;
  const events = eventsAllowed(normalizeEvents(rawEvents), actor.settings);
  if (events.length === 0) return skipped('event_off');
  if (!(deps.eventCooldown ?? eventGap).take(actor.profile.id, nowMs).ok) return skipped('cooldown');
  const made = await greet(stores, env, deps, actor, events, nowMs);
  if (!made.ok) return skipped(made.reason);
  return { status: 200, body: { reply: made.text, emotion: made.emotion, gesture: made.gesture, model: made.model } };
}

/** Redacta UN saludo para esos eventos y lo deja en la voz del overlay. */
export async function greet(stores: Stores, env: Env, deps: DoneDeps, actor: Actor, events: ReturnType<typeof normalizeEvents>, nowMs: number) {
  const { settings, profile } = actor;
  const memories = settings.memoryEnabled ? await stores.done.memories(profile.id, DONE_MEMORIES_IN_REPLY) : [];
  const run = await runModel(env, stores, deps, actor, nowMs, (character) =>
    buildDoneEventMessages({
      commandWord: settings.commandWord,
      personality: settings.personality,
      language: settings.language,
      replyMax: settings.replyMax,
      gestures: character.gestures,
      memories,
      events,
    })
  );
  if (!run.ok) return { ok: false as const, reason: 'ai_failed' };
  const out = readOutput(run.text, run.character, settings.replyMax);
  if (!out.text) return { ok: false as const, reason: 'empty' };
  // Un saludo sin gesto del modelo saluda con la mano, si el personaje puede
  const gesture = out.gesture ?? ((run.character.gestures as readonly string[]).includes('wave') ? ('wave' as const) : null);
  await enqueueSpeech(stores.done, profile.id, { ...out, gesture }, null, 'event');
  return { ok: true as const, text: out.text, emotion: out.emotion, gesture, model: run.model };
}

// ---------- Cola de mensajes del panel y saludos pendientes ----------

/**
 * Si hay seguidores nuevos o un inicio de directo esperando (filas kind 'event' que dejó EventSub), los recoge de forma
 * atómica, los agrupa, redacta UN saludo y lo deja en la cola. Lo recogido nunca se reintenta: si la IA falla, no se escribe.
 */
export async function flushEvents(stores: Stores, env: Env, deps: DoneDeps, actor: Actor, nowMs: number): Promise<void> {
  if (blocked(actor)) return;
  const nowIso = new Date(nowMs).toISOString();
  const claimed = await stores.done.eventsClaim(actor.profile.id, new Date(nowMs - EVENT_GROUP_MS).toISOString(), nowIso);
  if (claimed.length === 0) return;
  const finish = async (ok: boolean) => {
    for (const item of claimed) await stores.done.outboxFinish(actor.profile.id, item.id, ok, new Date(clock(deps)).toISOString()).catch(() => false);
  };
  // Mínimo entre dos saludos por perfil: mientras tanto lo pendiente vuelve a la cola
  if (!(deps.eventCooldown ?? eventGap).take(actor.profile.id, nowMs).ok) {
    for (const item of claimed) await stores.done.outboxRelease(actor.profile.id, item.id).catch(() => false);
    return;
  }
  const events = eventsAllowed(normalizeEvents(claimed.map((item) => item.payload)), actor.settings);
  if (events.length === 0) return void (await finish(true));
  const made = await greet(stores, env, deps, actor, events, nowMs);
  if (made.ok) {
    await stores.done.outboxInsert({ profile_id: actor.profile.id, kind: 'say', text: made.text, speak: false, emotion: made.emotion, gesture: made.gesture, mode: 'ai' });
  }
  await finish(made.ok);
}

/** Lo que el bot recoge: hasta 3 mensajes, marcados «claimed». Cada uno sale una sola vez. */
export async function claimOutbox(stores: Stores, env: Env, deps: DoneDeps, actor: Actor, nowMs: number, enqueueVoice = true) {
  await touchBot(stores.lux, actor.profile.id, nowMs);
  if (blocked(actor)) return [];
  await flushEvents(stores, env, deps, actor, nowMs).catch((err: unknown) => {
    console.error('[Tally Studio done] saludo a eventos del canal:', err instanceof Error ? err.message : 'error desconocido');
  });
  const items = await stores.done.outboxClaim(actor.profile.id, 3, new Date(nowMs).toISOString());
  // El bot en la nube decide la voz después de enviar (si el limitador devuelve el mensaje, no suena dos veces)
  if (enqueueVoice) {
    for (const item of items) {
      if (item.speak) await enqueueSpeech(stores.done, actor.profile.id, item, null, 'say');
    }
  }
  if (items.length > 0) await stores.done.outboxPrune(actor.profile.id, new Date(nowMs - 24 * 3_600_000).toISOString()).catch(() => undefined);
  return items;
}

// ---------- Ruta ----------

/** Perfil dueño de la clave: la clave de OBS (bot) o la de lectura (overlay). */
async function profileForKey(stores: Stores, key: string): Promise<{ profile: LuxProfile; readOnly: boolean } | null> {
  if (!key || key.length > 128) return null;
  const readId = profileIdOfReadKey(key);
  if (readId) {
    const widgetKey = await stores.done.widgetKeyOf(readId);
    if (!widgetKey || !verifyReadKey(key, readId, widgetKey)) return null;
    const profile = await stores.lux.profile(readId);
    return profile ? { profile, readOnly: true } : null;
  }
  if (!stores.lux.profileByWidgetKey) return null;
  const profile = await stores.lux.profileByWidgetKey(key);
  return profile ? { profile, readOnly: false } : null;
}

export async function chatRoute(req: IntegrationRequest, env: Env, deps: DoneDeps): Promise<IntegrationResult> {
  if (req.method.toUpperCase() !== 'POST') return fail(405, 'method', 'Esta ruta solo admite POST.');
  const stores = openStores(env, deps);
  if (!stores) return notConfigured();
  const raw = bodyOf(req.body);
  const key = typeof raw.k === 'string' ? raw.k.trim() : '';

  try {
    const found = await profileForKey(stores, key);
    if (!found) return fail(401, 'bad_widget_key', 'La clave de OBS no es válida.');
    const actor = await loadActor(stores, found.profile);
    const nowMs = clock(deps);
    const command = raw.command;

    // La clave de lectura del overlay solo pregunta; nunca enciende, apaga, recoge la cola ni resume
    if (found.readOnly && command !== 'ask') return fail(403, 'read_only_key', 'Esta clave es de solo lectura.');

    if (command === 'ask') {
      const source = found.readOnly ? 'overlay' : raw.source;
      return await askDone(stores, env, deps, actor, { ...raw, source }, async (viewer, now) => (deps.cooldown ?? chatCooldown).take(`${actor.profile.id}:${viewer.toLowerCase()}`, now));
    }
    if (command === 'on' || command === 'off') {
      if (raw.privileged !== true) return fail(403, 'not_privileged', 'Solo el canal o los moderadores pueden cambiar a Done en el chat.');
      return await switchDone(stores, actor, command === 'on');
    }
    if (command === 'outbox' || command === 'outbox_done') {
      if (command === 'outbox_done') {
        await touchBot(stores.lux, actor.profile.id, nowMs);
        if (typeof raw.id !== 'number' || !Number.isInteger(raw.id) || raw.id < 1) return fail(400, 'bad_id', 'El mensaje no es válido.');
        return { status: 200, body: { done: await stores.done.outboxFinish(actor.profile.id, raw.id, raw.ok === true, new Date(nowMs).toISOString()) } };
      }
      const items = await claimOutbox(stores, env, deps, actor, nowMs);
      return { status: 200, body: { items: items.map((item) => ({ id: item.id, text: item.text })) } };
    }
    if (command === 'spontaneous') {
      await touchBot(stores.lux, actor.profile.id, nowMs);
      return await spontaneousDone(stores, env, deps, actor, raw.lines, nowMs);
    }
    if (command === 'event') {
      await touchBot(stores.lux, actor.profile.id, nowMs);
      return await eventDone(stores, env, deps, actor, raw.events, nowMs);
    }
    if (command === 'summary') {
      await touchBot(stores.lux, actor.profile.id, nowMs);
      return await summarizeChat(stores, env, deps, actor, raw.messages, nowMs);
    }
    return fail(400, 'bad_command', 'Comando no admitido.');
  } catch (err) {
    return doneFailure(err, 'done/chat');
  }
}
