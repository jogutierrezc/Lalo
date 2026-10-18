/**
 * server/lux/song.ts
 *
 * Canciones de Lux: el espectador pide "!lux canta <tema>" y Lux escribe una
 * canción original y corta. Cada verso lleva la etiqueta [canta], que el TTS
 * traduce a [singing] para ElevenLabs. Solo ElevenLabs canta; Fish Audio no.
 *
 * Las letras son siempre originales: el prompt prohíbe copiar canciones existentes.
 */

export const LUX_SONG_MAX = 400;
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
    'Formato: dos versos de dos o cuatro líneas y un estribillo. Cada línea empieza por [canta].',
    'Sin título ni explicaciones: solo la letra. No añadas etiqueta de emoción al final.',
    'La letra tiene que ser tuya. Prohibido copiar, citar o imitar canciones existentes ni letras de otros autores.',
    `Máximo ${LUX_SONG_MAX} caracteres en total.`,
  ].join(' ');
}

/** Asegura que cada línea de la canción lleve [canta] y que quepa en el límite. */
export function normalizeSong(raw: string): string {
  const lines = raw
    .split('\n')
    .map((line) => line.replace(/\[canta\]/gi, '').trim())
    .filter((line) => line.length > 0)
    .map((line) => `${SONG_TAG} ${line}`);
  return lines.join('\n').slice(0, LUX_SONG_MAX);
}

/** La misma letra sin etiquetas: es lo que se muestra en el chat. */
export function songForChat(song: string): string {
  return song.replace(/\[canta\]\s*/gi, '').split('\n').join(' / ').slice(0, 500);
}
