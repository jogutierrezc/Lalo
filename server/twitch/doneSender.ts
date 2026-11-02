/**
 * server/twitch/doneSender.ts
 *
 * Con qué cuenta escribe Done en el chat del bot en la nube (ajuste `writeAs` de Done):
 *
 *   'creator'  la propia cuenta del creador (senderMode 'streamer' de senderMode.ts: token de aplicación, el creador ya
 *              concedió user:write:chat y user:bot). Cada trozo se anota para descartar su eco. Si Twitch responde
 *              no_permission o auth_failed (el creador no concedió el permiso), se registra el motivo y se cae a la cuenta global.
 *   'bot'      la cuenta global «Lalo» (TWITCH_BOT_USER_ID); si no está configurada, la cuenta con la que escribe el canal.
 *
 * Lo comparten el procesador del chat y el trabajo de fondo. No lanza; no registra tokens ni textos.
 */

import type { Env } from '../integrations/store.js';
import type { BotDb } from './botDb.js';
import { sendChatMessage, type SendLimiter } from './chatSend.js';
import { echoMarkerFor, globalBotId } from './senderMode.js';

export type DoneWriteAs = 'creator' | 'bot';

export interface DoneSenderInput {
  fetch: typeof fetch;
  env: Env;
  db: BotDb | null;
  limiter: SendLimiter;
  profileId: string;
  broadcasterId: string;
  writeAs: DoneWriteAs;
  /** Cuenta con la que escribe el canal (la del modo de envío del bot), por si no hay cuenta global. */
  channelSenderId: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pauseMs?: number;
}

/** true = salió; false = falló; 'retry' = el limitador pidió esperar y no salió nada. */
export type DoneSend = (text: string) => Promise<boolean | 'retry'>;

export function createDoneSender(input: DoneSenderInput): DoneSend {
  const globalId = globalBotId(input.env) || input.channelSenderId;

  const attempt = (botUserId: string, asCreator: boolean, text: string) =>
    sendChatMessage({
      fetch: input.fetch,
      env: input.env,
      botUserId,
      beforePart: asCreator ? echoMarkerFor('streamer', input.db, input.profileId) : undefined,
      broadcasterId: input.broadcasterId,
      text,
      limiter: input.limiter,
      now: input.now,
      sleep: input.sleep,
      pauseMs: input.pauseMs,
    });

  return async (text) => {
    try {
      let result;
      if (input.writeAs === 'creator') {
        result = await attempt(input.broadcasterId, true, text);
        if ((result.status === 'no_permission' || result.status === 'auth_failed') && result.messageIds.length === 0 && globalId && globalId !== input.broadcasterId) {
          console.warn(`[Lalo done] no se pudo escribir con la cuenta del creador (${result.status}): se usa la cuenta global`);
          result = await attempt(globalId, false, text);
        }
      } else {
        result = await attempt(globalId, false, text);
      }
      if (result.status === 'sent') return true;
      console.warn(`[Lalo done] mensaje no enviado: ${result.status}`);
      // Solo se reintenta si no salió ningún trozo: si ya salió una parte, repetir el mensaje entero la duplicaría
      if (result.status === 'rate_limited' && result.messageIds.length === 0) return 'retry';
      return false;
    } catch (err) {
      console.error('[Lalo done] no se pudo enviar al chat:', err instanceof Error ? err.message.slice(0, 200) : 'error desconocido');
      return false;
    }
  };
}
