/**
 * server/done/sayRoute.ts
 *
 * Escribir en el chat desde el panel (sesión del creador):
 *
 *   GET  /api/done/say    los últimos mensajes con su estado y si hay un bot vivo
 *   POST /api/done/say    { mode: 'literal'|'ai', text, speak? }  deja un mensaje en la cola
 *
 * 'literal' lo escribe tal cual; 'ai' lo redacta Done a partir de una idea. Aquí nunca se escribe en Twitch: lo publica
 * el bot (de Python, o el de la nube en cuanto se encola) y confirma con outbox_done. Con `speak` también suena en OBS.
 */

import { waitUntil } from '@vercel/functions';
import { fail, type IntegrationRequest, type IntegrationResult } from '../integrations/http.js';
import type { Env } from '../integrations/store.js';
import { SAY_IDEA_MAX, SAY_PENDING_MAX, SAY_TEXT_MAX, outboxState } from '../lux/proactive.js';
import { botOnline, bodyOf, clock, doneFailure, readOutput, runModel, sayGap, DONE_MEMORIES_IN_REPLY, type DoneDeps } from './core.js';
import { buildDoneComposeMessages } from './prompt.js';
import { doneDisabled, isSession, sessionOf } from './session.js';
import type { DoneOutboxItem } from './doneDb.js';

/** Carga perezosa: el bot en la nube importa este módulo, así que no puede importarse al revés al cargar. */
async function defaultAfterEnqueue(profileId: string, env: Env): Promise<void> {
  const { pushDoneOutboxNow } = await import('../twitch/botBackground.js');
  await pushDoneOutboxNow(profileId, env);
}

const view = (item: DoneOutboxItem, nowMs: number) => ({
  id: item.id,
  text: item.text,
  mode: item.mode,
  state: outboxState(item, nowMs),
  createdAt: item.createdAt,
});

export async function sayRoute(req: IntegrationRequest, env: Env, deps: DoneDeps): Promise<IntegrationResult> {
  const method = req.method.toUpperCase();
  if (method !== 'GET' && method !== 'POST') return fail(405, 'method', 'Esta ruta admite GET y POST.');
  try {
    const session = await sessionOf(req, env, deps);
    if (!isSession(session)) return session;
    const { stores, actor } = session;
    if (!actor.allowed) return doneDisabled();
    const { profile, settings } = actor;
    const nowMs = clock(deps);
    const recent = await stores.done.outboxList(profile.id, 8);

    if (method === 'GET') {
      return { status: 200, body: { items: recent.map((item) => view(item, nowMs)), botOnline: await botOnline(stores.lux, profile.id, nowMs) } };
    }

    const raw = bodyOf(req.body);
    const mode = raw.mode === 'ai' ? 'ai' : raw.mode === 'literal' ? 'literal' : null;
    if (!mode) return fail(400, 'bad_mode', 'Elige si el texto va tal cual o lo redacta Done.');
    // Saltos de línea y caracteres de control fuera: un mensaje del chat es una sola línea
    const input = (typeof raw.text === 'string' ? raw.text : '').replace(/[\u0000-\u001f\u007f  ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const limit = mode === 'ai' ? SAY_IDEA_MAX : SAY_TEXT_MAX;
    if (!input || input.length > limit) return fail(400, 'bad_message', `El texto tiene que tener entre 1 y ${limit} caracteres.`);
    // «/ban», «.timeout»...: con la cuenta del canal o de un moderador, Twitch los ejecutaría como órdenes
    if (mode === 'literal' && /^[/.]\S/.test(input)) return fail(400, 'bad_message', 'El mensaje no puede empezar por «/» ni por «.»: Twitch lo tomaría por una orden.');
    if (recent.filter((item) => item.status === 'pending').length >= SAY_PENDING_MAX) return fail(429, 'too_many', 'Ya hay varios mensajes esperando al bot. Espera a que salgan.');
    const wait = (deps.sayCooldown ?? sayGap).take(profile.id, nowMs);
    if (!wait.ok) return fail(429, 'cooldown', `Espera ${wait.waitSeconds} s antes de enviar otro mensaje.`);

    let text = input;
    let emotion: DoneOutboxItem['emotion'] = 'normal';
    let gesture: DoneOutboxItem['gesture'] = null;
    if (mode === 'ai') {
      const memories = settings.memoryEnabled ? await stores.done.memories(profile.id, DONE_MEMORIES_IN_REPLY) : [];
      const run = await runModel(env, stores, deps, actor, nowMs, (character) =>
        buildDoneComposeMessages({
          commandWord: settings.commandWord,
          personality: settings.personality,
          language: settings.language,
          replyMax: settings.replyMax,
          gestures: character.gestures,
          memories,
          idea: input,
        })
      );
      if (!run.ok) {
        if (run.code === 'no_key') return fail(503, 'no_key', 'No hay clave del proveedor de IA guardada. Configúrala en Integraciones.');
        return fail(502, 'ai_failed', 'Done no pudo redactarlo. Prueba otra vez o escríbelo tal cual.');
      }
      const out = readOutput(run.text, run.character, settings.replyMax);
      if (!out.text) return fail(502, 'ai_failed', 'Done no pudo redactarlo. Prueba otra vez o escríbelo tal cual.');
      text = out.text;
      emotion = out.emotion;
      gesture = out.gesture;
    }
    const id = await stores.done.outboxInsert({ profile_id: profile.id, kind: 'say', text, speak: raw.speak === true, emotion, gesture, mode });
    // Con el bot en la nube encendido lo envía ya; sigue tras responder al panel. Si el canal usa el bot de Python, no hace nada
    const kick = (deps.afterEnqueue ?? defaultAfterEnqueue)(profile.id, env).catch(() => undefined);
    try {
      waitUntil(kick);
    } catch {
      // Sin contexto de Vercel (local, pruebas): el trabajo sigue igualmente en este proceso
    }
    return { status: 200, body: { id, text, mode, state: 'queued', botOnline: await botOnline(stores.lux, profile.id, nowMs) } };
  } catch (err) {
    return doneFailure(err, 'done/say');
  }
}
