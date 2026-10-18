/**
 * server/lux/song.ts
 *
 * Canciones de Lux: el espectador pide "!lux canta <tema>" y Lux escribe una
 * canción original y corta. Cada verso lleva la etiqueta [canta], que el TTS
 * traduce a [singing] para ElevenLabs. Solo ElevenLabs canta; Fish Audio no.
 *
 * Las letras son siempre originales: el prompt prohíbe copiar canciones existentes.
 */

/** Límite de la letra: una canción corta para que no se sienta larga en directo. */
export const LUX_SONG_MAX = 200;
export const SONG_TAG = '[canta]';

const SONG_REQUEST = /^\s*(canta|cántame|cantame|cantá|canta-me|sing)\b\s*(.*)$/i;

/** Tema de la canción si el mensaje la pide ("canta sobre..." o solo "canta"). null si no es un pedido de canción. */
export function detectSongRequest(message: string): string | null {
  const match = SONG_REQUEST.exec(message.trim());
  if (!match) return null;
  const topic = match[2].replace(/^(sobre|de|del|acerca de|about)\s+/i, '').trim();
  return topic || 'el chat del directo';
}

/** Instrucciones para escribir la canción. Van en el mensaje del sistema. */
export function songGuidance(topic: string, language: string): string {
  return [
    `Escribe una canción corta y original en ${language} sobre: ${topic}.`,
    'Formato: un verso corto de dos líneas y un estribillo de una línea. Cada línea empieza por [canta].',
    'Sin título ni explicaciones: solo la letra. No añadas etiqueta de emoción al final.',
    'La letra tiene que ser tuya. Prohibido copiar, citar o imitar canciones existentes ni letras de otros autores.',
    `Máximo ${LUX_SONG_MAX} caracteres en total.`,
  ].join(' ');
}

/**
 * Cada línea lleva [canta] (toda la canción se canta). Las líneas que no caben
 * en el límite se dejan fuera enteras: nunca se corta una etiqueta a la mitad.
 */
export function normalizeSong(raw: string): string {
  const kept: string[] = [];
  let length = 0;
  for (const source of raw.split('\n')) {
    const text = source.replace(/\[canta\]/gi, '').trim();
    if (!text) continue;
    const line = `${SONG_TAG} ${text}`;
    const next = length + (kept.length ? 1 : 0) + line.length;
    if (next > LUX_SONG_MAX) break;
    kept.push(line);
    length = next;
  }
  return kept.join('\n');
}

/** La misma letra sin etiquetas: es lo que se muestra en el chat. */
export function songForChat(song: string): string {
  return song.replace(/\[canta\]\s*/gi, '').split('\n').join(' / ').slice(0, 500);
}
