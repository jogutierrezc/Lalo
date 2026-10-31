/**
 * server/twitch/senderMode.ts
 *
 * Quién escribe en el chat de un canal: la cuenta del bot global «Lalo» ('global', TWITCH_BOT_USER_ID)
 * o la PROPIA cuenta del streamer ('streamer'). Todo con token de aplicación, sin guardar ningún token
 * de usuario. Piezas puras (más el antieco, que usa la base de cooldowns de botDb.ts) para que
 * suscripciones, procesador del chat, cola y envío decidan igual.
 *
 * Twitch (referencia de EventSub channel.chat.message y de Send Chat Message): con token de aplicación,
 * la cuenta `user_id` de la suscripción / `sender_id` del envío debe haber concedido a la aplicación
 * user:read:chat, user:write:chat y user:bot; si el emisor es el dueño del canal NO hace falta channel:bot.
 *
 * ANTIECO. En modo streamer el bot escribe COMO el streamer, así que cada respuesta del bot vuelve por
 * EventSub como un mensaje del propio streamer (chatterId === broadcasterId). No se pueden ignorar todos
 * los mensajes del streamer (también escribe comandos a mano). Decisión: antes de enviar cada trozo se
 * anota en twitch_bot_cooldowns (viewer 'echo', key 'echo:' + hash del texto normalizado) durante
 * ECHO_SECONDS; al llegar un mensaje del streamer se comprueba esa marca (take con 0 s: solo mira, no
 * consume) y, si está, es el eco del bot y se descarta. Se anota ANTES de enviar y por texto porque el
 * message_id solo se conoce después de la respuesta de Twitch y el eco puede llegar antes de que se
 * guardara. Coste conocido: un mensaje a mano del streamer idéntico a uno que el bot acaba de enviar
 * (en ECHO_SECONDS) se toma por eco y se ignora.
 *
 * SIN PROBAR contra Twitch ni Supabase reales.
 */

import { createHash } from 'node:crypto';
import type { Env } from '../integrations/store.js';
import type { BotDb, BotSenderMode, BotSettings } from './botDb.js';
import type { ChatMessageEvent } from './eventsub.js';

/** Permisos que el propio streamer concede a la aplicación en modo streamer. */
export const STREAMER_SCOPES: readonly string[] = ['user:read:chat', 'user:write:chat', 'user:bot'];

/** Cuánto se recuerda un texto enviado por el bot para reconocer su eco. */
export const ECHO_SECONDS = 20;
const ECHO_VIEWER = 'echo';

const TWITCH_ID = /^\d{1,20}$/;

/** Id de Twitch de la cuenta global Lalo, o '' si no está configurada. */
export function globalBotId(env: Env): string {
  const id = (env.TWITCH_BOT_USER_ID ?? '').trim();
  return TWITCH_ID.test(id) ? id : '';
}

/**
 * Id de la cuenta que escribe y lee el chat de ese canal: el del propio streamer en modo 'streamer',
 * el del bot global en 'global'. '' si no se puede saber (modo global sin TWITCH_BOT_USER_ID, o canal inválido).
 */
export function senderIdFor(settings: Pick<BotSettings, 'senderMode'> | null | undefined, broadcasterId: string, env: Env): string {
  const mode: BotSenderMode = settings?.senderMode === 'streamer' ? 'streamer' : 'global';
  if (mode === 'streamer') return TWITCH_ID.test(broadcasterId) ? broadcasterId : '';
  return globalBotId(env);
}

/** true si el mensaje lo escribió la cuenta que envía (en modo streamer: el propio dueño del canal). */
export function isFromSender(event: Pick<ChatMessageEvent, 'chatterId'>, senderId: string): boolean {
  return senderId !== '' && event.chatterId === senderId;
}

/** Clave de la marca de un texto enviado: mismo texto, mismas mayúsculas o espacios, misma clave. */
export function echoKey(text: string): string {
  const normal = text.split(/\s+/).filter(Boolean).join(' ').toLowerCase();
  return `echo:${createHash('sha1').update(normal).digest('hex').slice(0, 16)}`;
}

/** Anota que el bot va a enviar este texto (llamar antes de enviar). Si la base falla, lanza: mejor no enviar que provocar un bucle. */
export async function markBotText(db: Pick<BotDb, 'takeCooldown'>, profileId: string, text: string): Promise<void> {
  await db.takeCooldown(profileId, ECHO_VIEWER, echoKey(text), ECHO_SECONDS);
}

/** El `beforePart` de sendChatMessage para ese modo: en modo streamer anota cada trozo; en global no hace falta. */
export function echoMarkerFor(
  mode: BotSenderMode,
  db: Pick<BotDb, 'takeCooldown'> | null,
  profileId: string
): ((part: string) => Promise<void>) | undefined {
  if (mode !== 'streamer') return undefined;
  // Sin base no se puede reconocer el eco: el envío falla (lanza) antes que arriesgar un bucle
  return async (part) => {
    if (!db) throw new Error('sin base para anotar el eco');
    await markBotText(db, profileId, part);
  };
}

/**
 * ¿Este mensaje es el eco de algo que envió el bot? Solo tiene sentido en modo streamer y para mensajes del
 * propio streamer. take con 0 s no cambia una marca vigente: si no está concedido, es que el bot lo envió hace poco.
 */
export async function isBotEcho(db: Pick<BotDb, 'takeCooldown'>, profileId: string, event: Pick<ChatMessageEvent, 'text'>): Promise<boolean> {
  const check = await db.takeCooldown(profileId, ECHO_VIEWER, echoKey(event.text), 0);
  return !check.ok;
}
