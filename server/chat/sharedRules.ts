/**
 * server/chat/sharedRules.ts
 *
 * Reglas del chat que comparten Lux (Mi AI) y Done, para que el bot de Python y el bot
 * de la nube apliquen LAS MISMAS y no cada uno la suya:
 *
 *   - tiempo de espera por espectador entre dos preguntas a la IA;
 *   - texto del aviso de espera («espera N s antes de volver a preguntar a X») y cada
 *     cuánto se puede repetir a la misma persona;
 *   - texto del aviso de fallo de la IA y su límite de frecuencia;
 *   - el comando `!s` (voz del chat) y quién lo lee;
 *   - comandos reservados que ninguna palabra de activación puede tomar.
 *
 * Es lógica pura, sin red ni base de datos. El script de Python (src/components/bot/pythonScript.ts)
 * toma de aquí los textos y los tiempos al generarse; no los repite a mano.
 */

/** Mensaje máximo de un espectador a la IA, en caracteres. */
export const CHAT_MESSAGE_MAX = 300;

/** Tiempo de espera por espectador entre dos preguntas a la IA. */
export const CHAT_COOLDOWN_MS = 5_000;

/** El aviso de espera a la MISMA persona no se repite antes de esto (evita que alguien llene el chat de avisos). */
export const WAIT_NOTICE_GAP_MS = 15_000;

/** El aviso de fallo de la IA no se repite antes de esto, por canal. */
export const FAILURE_NOTICE_GAP_MS = 60_000;

/** Partes del aviso de espera, para armar el texto igual en TypeScript y en el script de Python. */
export const WAIT_NOTICE_BEFORE = ' espera ';
export const WAIT_NOTICE_AFTER = ' s antes de volver a preguntar a ';

/** «@ana espera 3 s antes de volver a preguntar a Done.» */
export function waitNotice(viewer: string, name: string, waitSeconds: number): string {
  const seconds = Number.isFinite(waitSeconds) && waitSeconds > 0 ? Math.ceil(waitSeconds) : CHAT_COOLDOWN_MS / 1000;
  return `@${viewer}${WAIT_NOTICE_BEFORE}${seconds}${WAIT_NOTICE_AFTER}${name}.`;
}

/** Aviso corto cuando la IA falla: «Done no pudo responder ahora, intenta de nuevo». */
export function failureNotice(name: string): string {
  return `${name} no pudo responder ahora, intenta de nuevo.`;
}

/** Comando de voz del chat: `!s <texto>`. Es de la plataforma, no de ninguna IA. */
export const SPEAK_COMMAND = 's';

/**
 * Texto que hay que decir con la voz del chat si el mensaje es `!s <texto>`; null si no lo es.
 * Una sola función para el bot de Python, el bot de la nube y el overlay: así `!s` se lee igual en todos.
 */
export function parseSpeak(content: string, prefix = '!'): string | null {
  const text = content.trim();
  const head = `${prefix}${SPEAK_COMMAND} `;
  if (text.toLowerCase().startsWith(head)) {
    const spoken = text.slice(head.length).trim();
    return spoken || null;
  }
  return null;
}

/**
 * Comandos del bot que ninguna palabra de activación puede tomar. «lux» y «done» NO están aquí:
 * son las palabras por defecto de cada IA y sus alias; cada IA comprueba además que la palabra
 * de la otra no se pise (ver validateChatWord y validateDoneCommandWord).
 */
export const RESERVED_BOT_WORDS = ['s', 'luxon', 'luxoff', 'doneon', 'doneoff', 'tally'] as const;

/**
 * Limitador en memoria de avisos (espera, fallo): `allow` dice si ya pasó el hueco desde el último aviso con esa clave.
 * Cada instancia lleva el suyo; en la nube el bot usa además el cooldown persistente de la base.
 */
export class NoticeGate {
  private last = new Map<string, number>();

  allow(key: string, nowMs: number, gapMs: number): boolean {
    const previous = this.last.get(key);
    if (previous !== undefined && nowMs >= previous && nowMs - previous < gapMs) return false;
    this.last.set(key, nowMs);
    if (this.last.size > 2000) this.last.delete(this.last.keys().next().value as string);
    return true;
  }
}
