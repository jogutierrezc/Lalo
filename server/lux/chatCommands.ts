/**
 * server/lux/chatCommands.ts
 *
 * Comandos de Lux en el chat de Twitch. Lo lee el bot (script de Python que
 * genera src/components/bot/pythonScript.ts) y lo manda a /api/lux/chat.
 *
 *   !lux <mensaje>   cualquier espectador habla con Lux (con tiempo de espera)
 *   !luxon           el canal o un moderador enciende las respuestas de Lux en el chat
 *   !luxoff          el canal o un moderador las apaga
 */

export const LUX_CHAT_MAX = 300;
export const LUX_CHAT_COOLDOWN_MS = 10_000;

export type LuxChatCommand = { kind: 'ask'; message: string } | { kind: 'on' } | { kind: 'off' };

/** Lee un mensaje del chat. Devuelve null si no es un comando de Lux. */
export function parseLuxChat(content: string, prefix = '!'): LuxChatCommand | null {
  const text = content.trim();
  if (text === `${prefix}luxon`) return { kind: 'on' };
  if (text === `${prefix}luxoff`) return { kind: 'off' };
  if (text === `${prefix}lux` || text.startsWith(`${prefix}lux `)) {
    const message = text.slice(prefix.length + 3).trim().slice(0, LUX_CHAT_MAX);
    return message ? { kind: 'ask', message } : null;
  }
  return null;
}

/** Tiempo de espera por espectador. En memoria: cada instancia del servidor lleva el suyo. */
export class LuxCooldown {
  private last = new Map<string, number>();

  constructor(private readonly windowMs: number = LUX_CHAT_COOLDOWN_MS) {}

  /** ok si puede preguntar ahora; si no, cuántos segundos faltan. */
  take(key: string, now: number): { ok: true } | { ok: false; waitSeconds: number } {
    const previous = this.last.get(key);
    if (previous !== undefined && now - previous < this.windowMs) {
      return { ok: false, waitSeconds: Math.ceil((this.windowMs - (now - previous)) / 1000) };
    }
    this.last.set(key, now);
    return { ok: true };
  }
}
