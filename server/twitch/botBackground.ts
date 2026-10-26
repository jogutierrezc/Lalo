/**
 * server/twitch/botBackground.ts
 *
 * Lo que el script de Python hacía con bucles (lux_outbox_loop, lux_digest_loop y lux_spontaneous_loop) y el
 * servidor no puede hacer solo, porque no recuerda entre peticiones. Dos piezas, solo para los canales con el
 * bot en la nube encendido (twitch_bot_settings.enabled y sender_mode 'global'):
 *
 *   1. La cola de mensajes. El servidor envía él mismo, con sendChatMessage y el limitador, lo que el streamer
 *      escribe en Mi AI («Decir en el chat») y los saludos de seguidor y directo (server/lux/channelEvents.ts):
 *        a) pushOutboxNow: en cuanto se encola un mensaje (lo llama server/lux/handlers.ts tras guardarlo) y
 *           cuando llega un seguidor o el inicio del directo (eventsub.ts);
 *        b) createChatBackground().afterMessage: como red de seguridad, con cada mensaje que llega del chat.
 *      El mensaje se marca enviado o fallido igual que 'outbox_done' (luxOutboxForProfile). Si el canal NO tiene
 *      el bot en la nube, no se toca nada: la cola sigue siendo del bot de Python.
 *   2. Aprender del chat y comentar. Cada línea del chat (menos comandos) se guarda en un búfer rodante por
 *      streamer (botChatLines.ts, migración 0041). Con los ajustes del streamer (los mismos de las acciones
 *      'learn_status', 'digest' y 'spontaneous' de server/lux/handlers.ts) se decide si toca resumir o hacer un
 *      comentario espontáneo; el comentario se envía con el limitador. Las líneas se borran en cuanto se resumen.
 *
 * Las decisiones no se toman en cada mensaje: el estado del perfil se lee como mucho cada STATUS_TTL_MS por
 * instancia, y la cola, cada OUTBOX_GAP_MS. Es solo ahorro de lecturas; la corrección (un resumen cada 20 min,
 * un comentario por intervalo) la garantizan las marcas de la base de datos.
 *
 * Nunca lanza, ni registra tokens, textos de espectadores ni claves.
 *
 * Diferencias con el script, a propósito:
 *   - El resumen espera a tener MIN_DIGEST_LINES líneas (el script resumía con una sola): en el servidor, el
 *     primer mensaje tras 20 minutos de silencio dispararía un resumen de una línea y gastaría el turno.
 *   - Un saludo de seguidor que aún no está listo (se agrupan 15 s) sale con el siguiente mensaje del chat o
 *     del panel, no a los pocos segundos: no hay bucle que pregunte cada 4 s.
 *
 * SIN PROBAR contra Twitch ni Supabase reales.
 */

import { createClient } from '@supabase/supabase-js';
import type { Env } from '../integrations/store.js';
import type { LuxProactiveStatus } from '../lux/handlers.js';
import { isOwnBotMessage, type ChatMessageEvent } from './eventsub.js';
import { supabaseBotDb, type BotDb } from './botDb.js';
import { CHAT_LINE_TEXT_MAX, CHAT_LINE_VIEWER_MAX, supabaseChatLines, type ChatLinesDb } from './botChatLines.js';
import { sendChatMessage, type SendLimiter } from './chatSend.js';
import { supabaseLimiter } from './chatLimiter.js';
import { sanitizeChatOutput } from '../lux/outputFilter.js';

type Fetch = typeof fetch;

/** Cuentas de otros bots: sus líneas entran en el resumen pero no en los comentarios (LUX_IGNORE del script). */
export const LUX_IGNORE: readonly string[] = ['nightbot', 'streamelements', 'streamlabs', 'moobot', 'fossabot', 'wizebot'];
/** Como LUX_SPONT_LINES_MAX y LUX_SPONT_MIN_SEEN del script. */
export const SPONT_LINES_MAX = 40;
export const SPONT_MIN_SEEN = 3;
/** El resumen necesita al menos tantas líneas (ver «Diferencias» arriba). */
export const MIN_DIGEST_LINES = 10;
/** Cuánto vale el estado de aprendizaje y comentarios leído de un perfil. */
export const STATUS_TTL_MS = 15_000;
/** Cada cuánto, como mucho, se vacía la cola de un canal por mensaje del chat. */
export const OUTBOX_GAP_MS = 3_000;
/** Candados entre instancias (twitch_bot_cooldowns, viewer '_'): solo una instancia a la vez llama a la IA. */
export const DIGEST_LOCK_SECONDS = 120;
export const SPONT_LOCK_SECONDS = 60;

/** Resultado mínimo de las acciones de Mi AI (el mismo de server/lux/handlers.ts). */
export interface LuxAnswer {
  status: number;
  body: Record<string, unknown>;
}

type LineInput = Array<{ viewer: string; text: string }>;

/**
 * Envía un texto del panel o un saludo. true = salió; false = falló para siempre; 'retry' = el limitador (o Twitch) pidió
 * esperar y no salió NADA del mensaje: vuelve a la cola para el siguiente turno en vez de perderse.
 */
export type OutboxSend = (text: string) => Promise<boolean | 'retry'>;

/** Lo que el trabajo de fondo necesita de Mi AI. Por defecto sale de server/lux/handlers.ts. */
export interface BackgroundLux {
  status(profileId: string, env: Env): Promise<LuxProactiveStatus | null>;
  digest(profileId: string, lines: LineInput, env: Env): Promise<LuxAnswer>;
  spontaneous(profileId: string, lines: LineInput, env: Env): Promise<LuxAnswer>;
  outbox(profileId: string, send: OutboxSend, env: Env): Promise<{ sent: number; failed: number }>;
}

/** Carga perezosa: server/lux/handlers.ts es un módulo grande y además importa este (al revés, también perezoso). */
export const defaultBackgroundLux: BackgroundLux = {
  async status(profileId, env) {
    const { luxProactiveStatusForProfile } = await import('../lux/handlers.js');
    return luxProactiveStatusForProfile(profileId, env);
  },
  async digest(profileId, lines, env) {
    const { luxDigestForProfile } = await import('../lux/handlers.js');
    const result = await luxDigestForProfile(profileId, lines, env);
    return { status: result.status, body: (result.body ?? {}) as Record<string, unknown> };
  },
  async spontaneous(profileId, lines, env) {
    const { luxSpontaneousForProfile } = await import('../lux/handlers.js');
    const result = await luxSpontaneousForProfile(profileId, lines, env);
    return { status: result.status, body: (result.body ?? {}) as Record<string, unknown> };
  },
  async outbox(profileId, send, env) {
    const { luxOutboxForProfile } = await import('../lux/handlers.js');
    return luxOutboxForProfile(profileId, send, env);
  },
};

export interface BackgroundDeps {
  db?: (env: Env) => BotDb | null;
  limiter?: (env: Env) => SendLimiter | null;
  lines?: (env: Env) => ChatLinesDb | null;
  lux?: BackgroundLux;
  /** Id de Twitch del canal de un perfil (solo lo usa pushOutboxNow, que no recibe el evento del chat). */
  twitchUserId?: (profileId: string, env: Env) => Promise<string | null>;
  fetch?: Fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pauseMs?: number;
}

// ---------- Piezas por defecto (con la clave de servicio) ----------

const memo = new Map<string, unknown>();
function cached<T>(key: string, make: () => T): T {
  if (!memo.has(key)) memo.set(key, make());
  return memo.get(key) as T;
}
const supabaseKeys = (env: Env): { url: string; key: string } => ({
  url: (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '').trim(),
  key: (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim(),
});

const defaultDb = (env: Env): BotDb | null => {
  const { url, key } = supabaseKeys(env);
  return url && key ? cached(`db:${url}:${key}`, () => supabaseBotDb(env)) : null;
};
const defaultLimiter = (env: Env): SendLimiter | null => {
  const { url, key } = supabaseKeys(env);
  return url && key ? cached(`limiter:${url}:${key}`, () => supabaseLimiter(env)) : null;
};
const defaultLines = (env: Env): ChatLinesDb | null => {
  const { url, key } = supabaseKeys(env);
  return url && key ? cached(`lines:${url}:${key}`, () => supabaseChatLines(env)) : null;
};
const defaultTwitchUserId = async (profileId: string, env: Env): Promise<string | null> => {
  const { url, key } = supabaseKeys(env);
  if (!url || !key) return null;
  const client = cached(`profiles:${url}:${key}`, () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }));
  const { data, error } = await client.from('profiles').select('twitch_user_id').eq('id', profileId).maybeSingle();
  if (error) throw new Error(`Supabase: ${error.code ?? 'error'}`);
  const id = (data as { twitch_user_id?: unknown } | null)?.twitch_user_id;
  return typeof id === 'string' && /^\d{1,20}$/.test(id) ? id : null;
};

const logError = (what: string, err: unknown): void => {
  console.error(`[Lalo bot] ${what}:`, err instanceof Error ? err.message.slice(0, 200) : 'error desconocido');
};

/** Quita el prefijo y el «!»: lo que empieza así es un comando, no conversación. */
export function storableLine(text: string, prefix: string): string | null {
  const line = text.trim().slice(0, CHAT_LINE_TEXT_MAX);
  if (!line || line.startsWith(prefix) || line.startsWith('!')) return null;
  return line;
}

const isIgnoredBot = (login: string): boolean => LUX_IGNORE.includes(login.toLowerCase());

/** Envía un texto como la cuenta del bot a ese canal. true solo si Twitch lo aceptó. */
function senderFor(deps: BackgroundDeps, env: Env, botUserId: string, broadcasterId: string): OutboxSend | null {
  const limiter = (deps.limiter ?? defaultLimiter)(env);
  if (!limiter) return null;
  return async (text) => {
    try {
      const result = await sendChatMessage({
        fetch: deps.fetch ?? ((...args) => fetch(...args)),
        env,
        botUserId,
        broadcasterId,
        text,
        limiter,
        now: deps.now,
        sleep: deps.sleep,
        pauseMs: deps.pauseMs,
      });
      if (result.status !== 'sent') console.warn(`[Lalo bot] mensaje no enviado: ${result.status}`);
      if (result.status === 'sent') return true;
      // Solo se reintenta si no salió ningún trozo: si ya salió una parte, repetir el mensaje entero la duplicaría
      if (result.status === 'rate_limited' && result.messageIds.length === 0) return 'retry';
      return false;
    } catch (err) {
      logError('no se pudo enviar al chat', err);
      return false;
    }
  };
}

// ---------- (a) Enviar la cola ya, cuando se encola ----------

/**
 * Si el streamer tiene el bot en la nube encendido, vacía su cola de mensajes del panel y de saludos enviándola
 * por el chat. Si no, no hace nada. Para quien no tiene el chat delante (el panel, EventSub). No lanza.
 */
export async function pushOutboxNow(profileId: string, env: Env = process.env, deps: BackgroundDeps = {}): Promise<void> {
  try {
    const botUserId = (env.TWITCH_BOT_USER_ID ?? '').trim();
    if (!botUserId) return;
    const db = (deps.db ?? defaultDb)(env);
    if (!db) return;
    const settings = await db.settings(profileId);
    if (!settings || !settings.enabled || settings.senderMode !== 'global') return;
    const broadcasterId = await (deps.twitchUserId ?? defaultTwitchUserId)(profileId, env);
    if (!broadcasterId) return;
    const send = senderFor(deps, env, botUserId, broadcasterId);
    if (!send) return;
    await (deps.lux ?? defaultBackgroundLux).outbox(profileId, send, env);
  } catch (err) {
    logError('no se pudo vaciar la cola de mensajes', err);
  }
}

// ---------- (b) Con cada mensaje del chat ----------

export interface BackgroundInput {
  event: ChatMessageEvent;
  env: Env;
  /** Dueño del canal, con el bot en la nube ya comprobado como encendido y de envío global. */
  profileId: string;
  prefix: string;
  botUserId: string;
}

export interface ChatBackground {
  afterMessage(input: BackgroundInput): Promise<void>;
}

export function createChatBackground(deps: BackgroundDeps = {}): ChatBackground {
  const clock = deps.now ?? Date.now;
  const getDb = deps.db ?? defaultDb;
  const lux = deps.lux ?? defaultBackgroundLux;
  const getLines = deps.lines ?? defaultLines;
  // Solo para no leer la base en cada mensaje; en otra instancia se empieza de cero y no pasa nada
  const lastOutbox = new Map<string, number>();
  const statuses = new Map<string, { at: number; status: LuxProactiveStatus | null }>();

  /** Candado entre instancias: dos avisos a la vez en instancias distintas no llaman los dos a la IA. */
  async function lock(input: BackgroundInput, key: 'digest' | 'spont', seconds: number): Promise<boolean> {
    const db = getDb(input.env);
    if (!db) return false;
    return (await db.takeCooldown(input.profileId, '_', key, seconds)).ok;
  }

  async function digest(input: BackgroundInput, status: LuxProactiveStatus, lines: ChatLinesDb): Promise<void> {
    const all = await lines.all(input.profileId);
    if (all.length < MIN_DIGEST_LINES) return;
    if (!(await lock(input, 'digest', DIGEST_LOCK_SECONDS))) return;
    // Solo se borra lo que se resume: lo que llegue mientras la IA piensa se queda para el siguiente
    const maxId = Math.max(...all.map((line) => line.id));
    const answer = await lux.digest(
      input.profileId,
      all.map(({ viewer, text }) => ({ viewer, text })),
      input.env
    );
    // 'too_soon' = no se resumió (otra instancia se adelantó): las líneas esperan. En cualquier otro caso se resumieron
    // o ya no se pueden resumir (aprendizaje apagado, memoria llena, sin clave...): se borran, como en el script
    // Con los comentarios activos se conservan las líneas que el comentario espontáneo aún no ha contado
    if (answer.body.skipped !== 'too_soon') await lines.clear(input.profileId, maxId, { keepPendingComments: status.spontaneous.enabled });
  }

  async function spontaneous(input: BackgroundInput, status: LuxProactiveStatus, lines: ChatLinesDb): Promise<void> {
    const pending = await lines.pendingSpontaneous(input.profileId, SPONT_LINES_MAX);
    if (pending.length < Math.max(SPONT_MIN_SEEN, status.spontaneous.minMessages)) return;
    if (!(await lock(input, 'spont', SPONT_LOCK_SECONDS))) return;
    const answer = await lux.spontaneous(
      input.profileId,
      pending.map(({ viewer, text }) => ({ viewer, text })),
      input.env
    );
    // Lo que escribe la IA pasa por el filtro (enlaces y menciones) antes de salir al chat
    const reply = typeof answer.body.reply === 'string' ? sanitizeChatOutput(answer.body.reply) : '';
    if (!reply) return;
    // Los comentados salen de la ventana: el siguiente comentario cuenta desde cero
    await lines.markSpontaneousUsed(
      input.profileId,
      pending.map((line) => line.id)
    );
    const send = senderFor(deps, input.env, input.botUserId, input.event.broadcasterId);
    if (send) await send(reply);
  }

  async function run(input: BackgroundInput): Promise<void> {
    const { event, env, profileId } = input;
    const now = clock();

    // 1. Red de seguridad de la cola del panel y de los saludos
    const last = lastOutbox.get(profileId);
    if (last === undefined || now - last >= OUTBOX_GAP_MS || now < last) {
      lastOutbox.set(profileId, now);
      if (lastOutbox.size > 500) lastOutbox.delete(lastOutbox.keys().next().value as string);
      const send = senderFor(deps, env, input.botUserId, event.broadcasterId);
      if (send) await lux.outbox(profileId, send, env);
    }

    // 2. Estado de aprendizaje y comentarios (con caché corta)
    const known = statuses.get(profileId);
    const refreshed = !known || now - known.at >= STATUS_TTL_MS || now < known.at;
    const status = refreshed ? await lux.status(profileId, env) : known.status;
    if (refreshed) {
      statuses.set(profileId, { at: now, status });
      if (statuses.size > 500) statuses.delete(statuses.keys().next().value as string);
    }
    if (!status) return;
    const lines = getLines(env);
    if (!lines) return;

    // Sin aprendizaje ni comentarios no se guarda nada del chat, y lo que hubiera de antes se borra
    if (!status.learning && !status.spontaneous.enabled) {
      if (refreshed) await lines.clear(profileId);
      return;
    }

    // 3. Guardar la línea (los comandos no)
    const line = storableLine(event.text, input.prefix);
    if (line) {
      const login = (event.chatterLogin || event.chatterName).slice(0, CHAT_LINE_VIEWER_MAX);
      await lines.push(profileId, login, line, !isIgnoredBot(event.chatterLogin));
    }

    // 4. Decidir (solo al renovar el estado: como mucho cada STATUS_TTL_MS)
    if (!refreshed) return;
    if (status.learning && status.digestReady) await digest(input, status, lines);
    if (status.spontaneous.enabled && status.spontaneous.waitSeconds === 0) await spontaneous(input, status, lines);
  }

  return {
    async afterMessage(input) {
      // Un mensaje del propio bot nunca llega aquí (el procesador lo descarta), pero por si acaso no se guarda ni se comenta
      if (isOwnBotMessage(input.event, input.botUserId)) return;
      try {
        await run(input);
      } catch (err) {
        logError('trabajo de fondo del chat', err);
      }
    },
  };
}
