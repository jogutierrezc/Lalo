/**
 * server/twitch/chatSend.ts
 *
 * Escribe en el chat de Twitch desde el servidor con el bot global "Lalo".
 * Usa el token de APLICACIÓN (appToken de clips.ts) y no guarda tokens de usuario.
 *
 * Twitch (comprobado en dev.twitch.tv el 2026-10-25):
 *   - POST https://api.twitch.tv/helix/chat/messages con {broadcaster_id, sender_id,
 *     message, reply_parent_message_id?}, Authorization: Bearer <token de aplicación>
 *     y Client-Id. La cuenta sender_id debe haber concedido user:write:chat y user:bot
 *     a la aplicación, y el canal channel:bot (o el emisor ser moderador).
 *   - Máximo 500 caracteres (422 si se pasa). 200: {data:[{message_id, is_sent, drop_reason?}]}.
 *   - 401 token inválido, 403 el emisor no puede escribir en esa sala, 429 demasiados.
 *   - Límites del bot: sin ser moderador/VIP, 20 mensajes cada 30 s en total y 1 por
 *     segundo por canal; con moderador/VIP, 100 cada 30 s. Si se excede, Twitch ignora
 *     al bot durante 1 HORA: por eso el servidor se limita solo y descarta lo que sobre.
 *
 * Nunca lanza por errores de Twitch: los devuelve tipados. Nunca registra tokens.
 *
 * SIN PROBAR contra la API real de Twitch.
 */

import { appToken, readTwitchConfig, type Env } from './clips.js';

type Fetch = typeof fetch;

/** Máximo de caracteres por mensaje de chat en Twitch. */
export const CHAT_LIMIT = 500;
/** Pausa entre los trozos de un mensaje largo (la misma que usa el script de Python). */
export const PART_PAUSE_MS = 1200;
/** Lo máximo que se espera al limitador en una llamada: esto corre en serverless. */
export const MAX_LIMITER_WAIT_MS = 3000;
const TWITCH_TIMEOUT_MS = 6000;

// ---------- Partir y limpiar el texto (misma lógica que split_message y chat_send de Python) ----------

/**
 * Parte un texto en trozos de como mucho `limit` caracteres, cortando en frases o en espacios.
 * Igual que split_message del script de Python: colapsa los espacios, busca el último
 * separador (". ", "! ", "? ", "; ", ", ", " ") que caiga pasado el primer tercio del
 * límite y, si no hay ninguno, corta en seco. (Se cuenta en unidades UTF-16: nunca se
 * pasa del límite de Twitch y el corte en seco no parte un par sustituto.)
 */
export function splitChatMessage(text: string, limit: number = CHAT_LIMIT): string[] {
  let rest = String(text).split(/\s+/).filter(Boolean).join(' ');
  const parts: string[] = [];
  const third = Math.floor(limit / 3);
  while (rest.length > limit) {
    let chunk = '';
    let next = '';
    for (const sep of ['. ', '! ', '? ', '; ', ', ', ' ']) {
      // rfind(sep, 0, limit) de Python: el separador entero debe caber dentro de los primeros `limit`
      const at = rest.lastIndexOf(sep, limit - sep.length);
      if (at > third) {
        chunk = rest.slice(0, at + sep.trimEnd().length);
        next = rest.slice(at + sep.length);
        break;
      }
    }
    if (!chunk) {
      let cut = limit;
      const last = rest.charCodeAt(cut - 1);
      if (last >= 0xd800 && last <= 0xdbff) cut -= 1; // no partir un emoji por la mitad
      chunk = rest.slice(0, cut);
      next = rest.slice(cut);
    }
    parts.push(chunk);
    rest = next.trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** Quita las / . y espacios iniciales: Twitch tomaría "/ban" o ".timeout" por una orden. */
export function stripCommandPrefix(part: string): string {
  return part.replace(/^[/. ]+/, '');
}

/** Lo que realmente se manda: partido en trozos, sin prefijo de orden y sin trozos vacíos. */
export function prepareChatParts(text: string, limit: number = CHAT_LIMIT): string[] {
  return splitChatMessage(text, limit).map(stripCommandPrefix).filter((part) => part !== '');
}

// ---------- Limitador de envíos ----------

export type LimitScope = 'channel' | 'account';

export type TakeResult = { ok: true } | { ok: false; waitMs: number; scope: LimitScope };

/**
 * Contrato del limitador. `take` pide permiso para UN mensaje del bot `botId` en el canal
 * `channelId` en el instante `now` (ms). Si lo concede ({ok:true}) lo deja contado; si no,
 * dice cuánto falta (waitMs) y qué límite lo frena (scope) y NO cuenta nada.
 *
 * La política es la de Twitch: 1 mensaje por segundo por canal y 20 cada 30 s por cuenta
 * (suma de todos los canales), con un tope de 6 por canal en esos 30 s, o 100 cada 30 s si el bot es moderador/VIP.
 *
 * Debe ser atómico: dos peticiones simultáneas no pueden llevarse el mismo hueco. La
 * versión en memoria de abajo sirve para pruebas y desarrollo local; en Vercel, donde
 * el proceso no recuerda entre peticiones, hace falta una implementación persistente en
 * base de datos (una fila por mensaje enviado, o un contador por ventana, comprobado y
 * anotado en una sola transacción) que cumpla esta misma interfaz.
 */
export interface SendLimiter {
  take(botId: string, channelId: string, now: number): Promise<TakeResult>;
}

export const CHANNEL_INTERVAL_MS = 1000;
export const ACCOUNT_WINDOW_MS = 30_000;
export const ACCOUNT_MAX = 20;
export const ACCOUNT_MAX_MOD = 100;
/** Tope de mensajes de UN canal en la ventana de 30 s: ningún canal se lleva todo el cupo de la cuenta. */
export const CHANNEL_MAX = 6;

/** Limitador en memoria del proceso. `moderator: true` sube el tope de cuenta a 100 cada 30 s. */
export function createMemoryLimiter(options: { moderator?: boolean } = {}): SendLimiter {
  const accountMax = options.moderator ? ACCOUNT_MAX_MOD : ACCOUNT_MAX;
  const account = new Map<string, number[]>();
  const channel = new Map<string, number[]>();
  return {
    async take(botId, channelId, now) {
      const recent = (account.get(botId) ?? []).filter((at) => at > now - ACCOUNT_WINDOW_MS);
      const key = `${botId}:${channelId}`;
      const inChannel = (channel.get(key) ?? []).filter((at) => at > now - ACCOUNT_WINDOW_MS);
      const last = inChannel[inChannel.length - 1];
      const spacingWait = last !== undefined && now - last < CHANNEL_INTERVAL_MS ? CHANNEL_INTERVAL_MS - (now - last) : 0;
      const capWait = inChannel.length >= CHANNEL_MAX ? inChannel[inChannel.length - CHANNEL_MAX] + ACCOUNT_WINDOW_MS - now : 0;
      const channelWait = Math.max(spacingWait, capWait);
      const accountWait = recent.length >= accountMax ? recent[recent.length - accountMax] + ACCOUNT_WINDOW_MS - now : 0;
      account.set(botId, recent);
      if (channelWait > 0 || accountWait > 0) {
        // Se avisa del límite que más tarda en abrirse
        return accountWait > channelWait
          ? { ok: false, waitMs: accountWait, scope: 'account' }
          : { ok: false, waitMs: channelWait, scope: 'channel' };
      }
      recent.push(now);
      inChannel.push(now);
      channel.set(key, inChannel);
      return { ok: true };
    },
  };
}

// ---------- Envío ----------

export interface ChatSendInput {
  fetch: Fetch;
  env: Env;
  /** Cuenta del bot (sender_id). */
  botUserId: string;
  /** Canal donde se escribe (broadcaster_id). */
  broadcasterId: string;
  text: string;
  /** Id del mensaje al que se responde; solo se aplica al primer trozo. */
  replyTo?: string;
  limiter: SendLimiter;
  /** Reloj en ms (por defecto Date.now). */
  now?: () => number;
  /** Espera inyectable para las pruebas (por defecto setTimeout). */
  sleep?: (ms: number) => Promise<void>;
  /** Pausa entre trozos (por defecto 1200 ms). */
  pauseMs?: number;
  /** Tope de espera al limitador por llamada (por defecto 3000 ms). */
  maxWaitMs?: number;
}

export interface ChatDropReason {
  code: string;
  message: string;
}

/** Cada resultado dice qué trozos salieron (`messageIds`) y cuáles no (`remaining`). */
interface Progress {
  messageIds: string[];
  /** Trozos que no se mandaron (el que falló incluido, salvo que Twitch lo descartara). */
  remaining: string[];
}

export type ChatSendResult =
  | ({ status: 'sent'; messageId: string } & Progress)
  | ({ status: 'dropped'; dropReason: ChatDropReason } & Progress)
  | ({ status: 'rate_limited'; waitMs: number; scope: LimitScope | 'twitch' } & Progress)
  | ({ status: 'no_permission' } & Progress)
  | ({ status: 'auth_failed' } & Progress)
  | ({ status: 'too_long' } & Progress)
  | ({ status: 'empty' } & Progress)
  | ({ status: 'error'; reason: string } & Progress);

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type PostOutcome =
  | { kind: 'sent'; messageId: string }
  | { kind: 'dropped'; dropReason: ChatDropReason }
  | { kind: 'failed'; result: (progress: Progress) => ChatSendResult };

/** Respuesta de Twitch del código 429: espera según Ratelimit-Reset (segundos epoch) o 1 s. */
function twitchWait(res: Response, now: number): number {
  const reset = Number(res.headers?.get?.('Ratelimit-Reset'));
  const wait = Number.isFinite(reset) && reset > 0 ? reset * 1000 - now : 1000;
  return Math.max(1000, Math.min(wait, ACCOUNT_WINDOW_MS));
}

async function postOnce(input: ChatSendInput, clientId: string, bearer: string, message: string, reply: string | undefined) {
  const body: Record<string, string> = {
    broadcaster_id: input.broadcasterId,
    sender_id: input.botUserId,
    message,
  };
  if (reply) body.reply_parent_message_id = reply;
  return input.fetch('https://api.twitch.tv/helix/chat/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearer}`, 'Client-Id': clientId, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TWITCH_TIMEOUT_MS),
  });
}

async function postPart(input: ChatSendInput, now: () => number, message: string, reply: string | undefined): Promise<PostOutcome> {
  const config = readTwitchConfig(input.env);
  if (config.missing.length > 0) {
    return { kind: 'failed', result: (p) => ({ status: 'error', reason: 'not_configured', ...p }) };
  }
  const deps = { fetch: input.fetch, now };
  try {
    let res = await postOnce(input, config.clientId, await appToken(config.clientId, config.clientSecret, deps), message, reply);
    // Un permiso caducado o revocado antes de tiempo: se renueva y se reintenta una sola vez
    if (res.status === 401) {
      res = await postOnce(input, config.clientId, await appToken(config.clientId, config.clientSecret, deps, true), message, reply);
    }
    if (res.status === 401) return { kind: 'failed', result: (p) => ({ status: 'auth_failed', ...p }) };
    if (res.status === 403) return { kind: 'failed', result: (p) => ({ status: 'no_permission', ...p }) };
    if (res.status === 422) return { kind: 'failed', result: (p) => ({ status: 'too_long', ...p }) };
    if (res.status === 429) {
      const waitMs = twitchWait(res, now());
      return { kind: 'failed', result: (p) => ({ status: 'rate_limited', waitMs, scope: 'twitch', ...p }) };
    }
    if (!res.ok) {
      const reason = `twitch_${res.status}`;
      return { kind: 'failed', result: (p) => ({ status: 'error', reason, ...p }) };
    }
    const data = (await res.json()) as { data?: Array<{ message_id?: unknown; is_sent?: unknown; drop_reason?: unknown }> };
    const item = Array.isArray(data.data) ? data.data[0] : undefined;
    if (!item) return { kind: 'failed', result: (p) => ({ status: 'error', reason: 'bad_response', ...p }) };
    if (item.is_sent !== true) {
      // Cualquier drop_reason se trata igual (la única documentada es automod_held)
      const raw = (item.drop_reason ?? {}) as { code?: unknown; message?: unknown };
      const dropReason = {
        code: typeof raw.code === 'string' ? raw.code : 'unknown',
        message: typeof raw.message === 'string' ? raw.message : '',
      };
      return { kind: 'dropped', dropReason };
    }
    return { kind: 'sent', messageId: typeof item.message_id === 'string' ? item.message_id : '' };
  } catch (error) {
    // appToken lanza con el código HTTP de Twitch; el mensaje de la excepción no se devuelve
    const http = (error as { httpStatus?: unknown })?.httpStatus;
    if (http === 400 || http === 401 || http === 403) {
      return { kind: 'failed', result: (p) => ({ status: 'auth_failed', ...p }) };
    }
    const reason = typeof http === 'number' ? `twitch_${http}` : 'network';
    return { kind: 'failed', result: (p) => ({ status: 'error', reason, ...p }) };
  }
}

/**
 * Escribe `text` en el chat de `broadcasterId` como `botUserId`. Los textos largos se
 * parten y se mandan con una pausa entre trozos. Si el limitador no deja mandar un trozo
 * (y no hay que esperar más de `maxWaitMs`) o Twitch falla, se corta ahí y el resultado
 * dice qué salió y qué no. No lanza nunca por errores de Twitch.
 */
export async function sendChatMessage(input: ChatSendInput): Promise<ChatSendResult> {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? defaultSleep;
  const pauseMs = input.pauseMs ?? PART_PAUSE_MS;
  let budget = input.maxWaitMs ?? MAX_LIMITER_WAIT_MS;

  const parts = prepareChatParts(input.text);
  if (parts.length === 0) return { status: 'empty', messageIds: [], remaining: [] };

  const messageIds: string[] = [];
  for (let index = 0; index < parts.length; index++) {
    const progress = (skip: number): Progress => ({ messageIds, remaining: parts.slice(index + skip) });

    // El limitador manda: se espera un poco si falta poco, y si no se descarta
    let taken = await input.limiter.take(input.botUserId, input.broadcasterId, now());
    if (!taken.ok && taken.waitMs <= budget) {
      budget -= taken.waitMs;
      await sleep(taken.waitMs);
      taken = await input.limiter.take(input.botUserId, input.broadcasterId, now());
    }
    if (!taken.ok) {
      return { status: 'rate_limited', waitMs: taken.waitMs, scope: taken.scope, ...progress(0) };
    }

    const outcome = await postPart(input, now, parts[index], index === 0 ? input.replyTo : undefined);
    if (outcome.kind === 'failed') return outcome.result(progress(0));
    if (outcome.kind === 'dropped') return { status: 'dropped', dropReason: outcome.dropReason, ...progress(1) };
    messageIds.push(outcome.messageId);

    if (index < parts.length - 1) await sleep(pauseMs);
  }
  return { status: 'sent', messageId: messageIds[0], messageIds, remaining: [] };
}
