/**
 * server/lux/chatCommands.ts
 *
 * Comandos de Lux en el chat de Twitch. Lo lee el bot (script de Python que
 * genera src/components/bot/pythonScript.ts) y lo manda a /api/lux/chat.
 *
 *   !<palabra> <mensaje>   cualquier espectador habla con Lux. La palabra la elige
 *                          el creador (por defecto «lux»)
 *   !lux <mensaje>         alias de la palabra, si el creador lo deja activado
 *   !luxon                 el canal o un moderador enciende las respuestas de Lux en el chat
 *   !luxoff                el canal o un moderador las apaga
 */

export const LUX_CHAT_MAX = 300;
export const LUX_CHAT_COOLDOWN_MS = 5_000;

/** Palabra por defecto: la que ya conocen los espectadores. */
export const LUX_CHAT_WORD_DEFAULT = 'lux';
export const LUX_CHAT_WORD_LIMITS = { min: 2, max: 20 } as const;
/**
 * Comandos que ya usa el bot y que la palabra no puede tomar. «lux» no está aquí:
 * es la palabra por defecto y el alias.
 */
export const LUX_CHAT_RESERVED = ['s', 'luxon', 'luxoff'] as const;

export type LuxChatCommand = { kind: 'ask'; message: string } | { kind: 'on' } | { kind: 'off' };

export type ChatWordCheck = { ok: true; word: string } | { ok: false; message: string };

/**
 * Valida la palabra de activación. Se guarda en minúsculas: en el chat no distingue
 * mayúsculas. `extraReserved` son comandos que el cliente conoce y el servidor no
 * (los del propio bot de TwitchIO), para que el panel también los rechace.
 */
export function validateChatWord(raw: string, extraReserved: readonly string[] = []): ChatWordCheck {
  const word = raw.trim().toLowerCase();
  // Primero los comandos reservados: «s» es corta, pero el motivo real es que ya es del bot.
  const reserved = [...LUX_CHAT_RESERVED, ...extraReserved].map((name) => name.toLowerCase());
  if (reserved.includes(word)) {
    return { ok: false, message: `«${word}» ya es un comando del bot. Elige otra palabra.` };
  }
  const { min, max } = LUX_CHAT_WORD_LIMITS;
  if (word.length < min || word.length > max) {
    return { ok: false, message: `La palabra tiene que tener de ${min} a ${max} caracteres.` };
  }
  if (!/^[a-z0-9]+$/.test(word)) {
    return { ok: false, message: 'La palabra solo puede tener letras sin acento y números, sin espacios ni símbolos.' };
  }
  return { ok: true, word };
}

/**
 * Palabras con las que se llama a Lux. La palabra del creador siempre vale; el alias
 * «lux» se añade si está activado y la palabra no es ya «lux».
 */
export function luxChatWords(word: string = LUX_CHAT_WORD_DEFAULT, alias = true): string[] {
  const words = [word];
  if (alias && word !== LUX_CHAT_WORD_DEFAULT) words.push(LUX_CHAT_WORD_DEFAULT);
  return words;
}

/** Lee un mensaje del chat. Devuelve null si no es un comando de Lux. */
export function parseLuxChat(
  content: string,
  prefix = '!',
  options: { word?: string; alias?: boolean } = {}
): LuxChatCommand | null {
  const text = content.trim();
  const lower = text.toLowerCase();
  if (lower === `${prefix}luxon`) return { kind: 'on' };
  if (lower === `${prefix}luxoff`) return { kind: 'off' };
  for (const word of luxChatWords(options.word, options.alias)) {
    const head = `${prefix}${word}`;
    if (lower === head || lower.startsWith(`${head} `)) {
      const message = text.slice(head.length).trim().slice(0, LUX_CHAT_MAX);
      return message ? { kind: 'ask', message } : null;
    }
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
