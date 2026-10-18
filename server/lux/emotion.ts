/**
 * server/lux/emotion.ts
 *
 * Contrato de emociones entre el modelo y el personaje. El modelo termina su
 * respuesta con una etiqueta [emocion] de esta lista. Los ids son los de las
 * expresiones de public/lux/index.html: si se cambian allí, se cambian aquí.
 */

export const LUX_EMOTIONS = [
  'normal',
  'habla',
  'emocionada',
  'grita',
  'feliz',
  'alegre',
  'triste',
  'molesta',
  'sorprendida',
  'magica',
] as const;

export type LuxEmotion = (typeof LUX_EMOTIONS)[number];

export const EMOTION_INSTRUCTION = `Al final de tu respuesta añade exactamente una etiqueta de emoción entre corchetes, elegida de esta lista: ${LUX_EMOTIONS.join(', ')}. Ejemplo: [feliz]`;

const TAG = /\s*\[([a-z]+)\]\s*$/i;

/**
 * Quita la etiqueta final y devuelve la emoción. Sin etiqueta válida, la emoción es 'normal':
 * el texto se muestra igual, nunca se pierde por una etiqueta mal escrita.
 */
export function parseEmotion(text: string): { text: string; emotion: LuxEmotion } {
  const match = TAG.exec(text);
  if (!match) return { text: text.trim(), emotion: 'normal' };
  const id = match[1].toLowerCase();
  const clean = text.slice(0, match.index).trim();
  const known = (LUX_EMOTIONS as readonly string[]).includes(id);
  return { text: clean, emotion: known ? (id as LuxEmotion) : 'normal' };
}
