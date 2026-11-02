/**
 * server/done/gestures.ts
 *
 * Gestos de Done. El modelo puede añadir UN gesto opcional entre llaves, como {wave}, además de la
 * emoción entre corchetes. El servidor lo extrae, lo valida contra el catálogo y contra los gestos que
 * el personaje elegido sabe hacer, y lo quita siempre del texto: las llaves nunca llegan al chat.
 */

import { DONE_GESTURES } from '../../src/lib/doneSettings.js';
import type { DoneGesture } from '../../src/lib/doneTypes.js';

export { DONE_GESTURES };

/** Palabras que los modelos escriben en lugar del gesto exacto. */
const ALIASES: Record<string, DoneGesture> = {
  cheer: 'arms_up',
  armsup: 'arms_up',
  hello: 'wave',
  hi: 'wave',
  saluda: 'wave',
  saludo: 'wave',
  baila: 'dance',
  bailar: 'dance',
  gira: 'spin',
  salta: 'jump',
  canta: 'sing',
  reverencia: 'bow',
  asiente: 'nod',
  orgullo: 'pride',
  duda: 'shrug',
};

/** Cualquier {palabra} corta: lo que parece una etiqueta de gesto. */
const ANY_GESTURE_TAG = /\s*\{\s*([A-Za-z_ -]{2,16}?)\s*\}/g;

const fold = (value: string): string => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[\s-]+/g, '_');

/** Gesto del catálogo que corresponde a una palabra, o null. */
export function gestureFromWord(word: string): DoneGesture | null {
  const id = fold(word);
  if ((DONE_GESTURES as readonly string[]).includes(id)) return id as DoneGesture;
  return ALIASES[id.replace(/_/g, '')] ?? ALIASES[id] ?? null;
}

/**
 * Separa las etiquetas {gesto} del texto. Devuelve el texto sin ninguna llave y el gesto si es del catálogo Y el
 * personaje lo puede hacer (`allowed`); si no, null. Si hay varias etiquetas manda la última reconocida.
 */
export function parseGesture(text: string, allowed: readonly string[]): { text: string; gesture: DoneGesture | null } {
  const hit: { gesture: DoneGesture | null } = { gesture: null };
  const stripped = text.replace(ANY_GESTURE_TAG, (_all, word: string) => {
    const gesture = gestureFromWord(word);
    if (gesture) hit.gesture = gesture;
    return ' ';
  });
  const clean = stripped.replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.!?;:])/g, '$1').trim();
  const gesture = hit.gesture !== null && allowed.includes(hit.gesture) ? hit.gesture : null;
  return { text: clean, gesture };
}

/** Instrucción al modelo: un gesto opcional, solo de los que el personaje sabe hacer. */
export function gestureInstruction(allowed: readonly string[]): string {
  const list = DONE_GESTURES.filter((id) => allowed.includes(id));
  if (list.length === 0) return '';
  return `Si encaja de verdad, y solo de vez en cuando, puedes añadir UN gesto entre llaves, con una de estas palabras exactas: ${list.join(', ')}. Ejemplo: {wave}. Si ningún gesto encaja, no pongas ninguno.`;
}
