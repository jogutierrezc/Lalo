/**
 * src/components/voz/vozLogic.ts
 *
 * Lógica pura de la página «Voz del chat», separada para poder probarla:
 * el mensaje de prueba con su emoción y el aviso de que la URL de OBS cambió.
 */

const LAST_COPIED_KEY = 'lalo_tts_last_copied_url';

const DEFAULT_LINE = '¡Esto es una prueba de voz con emoción en el stream!';
const SINGING_LINE = 'Cumpleaños feliz, te deseamos a ti, que los cumplas muy feliz.';

/** Quita el comando y la etiqueta de emoción del principio del mensaje de prueba. */
export function stripCommandAndEmotion(text: string): string {
  return text
    .replace(/^\s*!s\s+/i, '')
    .replace(/^\[[^\]]+\]\s*/, '')
    .trim();
}

/**
 * Devuelve el mensaje de prueba con la emoción elegida, o sin ninguna si
 * `emotion` es null. Conserva lo que el streamer ya había escrito.
 */
export function withEmotion(text: string, emotion: { tag: string; example: string } | null): string {
  const body = stripCommandAndEmotion(text);
  if (!emotion) return `!s ${body || DEFAULT_LINE}`;
  return `!s ${emotion.example} ${body || (emotion.tag === 'singing' ? SINGING_LINE : DEFAULT_LINE)}`;
}

/**
 * La URL cambió si hay una copia anterior y ya no coincide con la actual.
 * Sin copia anterior no se sabe qué hay pegado en OBS, así que no se avisa.
 */
export function urlChangedSinceCopy(currentUrl: string, lastCopied: string | null): boolean {
  return lastCopied !== null && lastCopied !== currentUrl;
}

export function readLastCopiedUrl(): string | null {
  try {
    return localStorage.getItem(LAST_COPIED_KEY);
  } catch {
    return null;
  }
}

export function writeLastCopiedUrl(url: string): void {
  try {
    localStorage.setItem(LAST_COPIED_KEY, url);
  } catch {
    // Sin almacenamiento: el aviso solo dura lo que dure la visita
  }
}
