/**
 * src/lib/doneSettings.ts
 *
 * Validación pura de los ajustes de Done AI (sin red, sin base de datos, sin navegador). La usan el
 * servidor (la única puerta hacia la base de datos) y el frontend (para avisar antes de guardar).
 * El contrato de tipos está en doneTypes.ts.
 */

import { ALERT_STYLES } from '../utils/appearance.js';
import { DONE_DEFAULTS, type DoneEmotion, type DoneGesture, type DoneSettings } from './doneTypes.js';

export const DONE_EMOTIONS: readonly DoneEmotion[] = ['normal', 'habla', 'emocionada', 'grita', 'feliz', 'alegre', 'triste', 'molesta', 'sorprendida', 'magica'];
export const DONE_GESTURES: readonly DoneGesture[] = ['wave', 'spin', 'dance', 'jump', 'sing', 'bow', 'ult', 'pride', 'nod', 'shrug', 'arms_up'];

export const DONE_LANGUAGES = ['auto', 'es', 'en', 'fr', 'pt', 'it'] as const;
export const DONE_BANTER_MODES = ['off', 'pique'] as const;
export const DONE_WRITE_AS = ['creator', 'bot'] as const;
export const DONE_POSITIONS = ['left', 'center', 'right'] as const;
export const DONE_SPONTANEOUS_EVERY = [0, 10, 15, 30, 60] as const;
export const DONE_SPONTANEOUS_MIN_MESSAGES = [3, 5, 10] as const;

export const DONE_LIMITS = {
  personality: 600,
  replyMax: { min: 60, max: 500 },
  obsSize: { min: 10, max: 100 },
  voiceVolume: { min: 0, max: 100 },
  typingCps: { min: 10, max: 200 },
  commandWord: { min: 2, max: 20 },
} as const;

/** Palabra del comando por defecto. */
export const DONE_COMMAND_DEFAULT = 'done';

/**
 * Comandos que la plataforma ya usa y que la palabra de Done no puede tomar. «done» no está aquí: es la palabra
 * por defecto. Los comandos propios del bot (los que el creador definió) los pasa quien valida en `extraReserved`.
 */
export const DONE_COMMAND_RESERVED = ['s', 'doneon', 'doneoff', 'tally', 'lux', 'luxon', 'luxoff'] as const;

export type DoneCheck<T> = { ok: true; value: T } | { ok: false; field: string; message: string };

/**
 * Valida la palabra del comando. Se guarda en minúsculas. `extraReserved`: comandos del bot del creador y la palabra
 * de Lux, para que no se pisen. «lux» está reservada aquí porque es el alias de la otra IA.
 */
export function validateDoneCommandWord(raw: string, extraReserved: readonly string[] = []): DoneCheck<string> {
  const word = raw.trim().toLowerCase();
  const reserved = [...DONE_COMMAND_RESERVED, ...extraReserved].map((name) => name.toLowerCase());
  if (reserved.includes(word)) return { ok: false, field: 'commandWord', message: `«${word}» ya es un comando del bot. Elige otra palabra.` };
  const { min, max } = DONE_LIMITS.commandWord;
  if (word.length < min || word.length > max) return { ok: false, field: 'commandWord', message: `La palabra tiene que tener de ${min} a ${max} caracteres.` };
  if (!/^[a-z0-9]+$/.test(word)) return { ok: false, field: 'commandWord', message: 'La palabra solo puede tener letras sin acento y números, sin espacios ni símbolos.' };
  return { ok: true, value: word };
}

/** Palabras con las que se llama a Done: la del creador y, si sigue activo, el alias «done». */
export function doneCommandWords(word: string = DONE_COMMAND_DEFAULT, keepAlias = true): string[] {
  const words = [word];
  if (keepAlias && word !== DONE_COMMAND_DEFAULT) words.push(DONE_COMMAND_DEFAULT);
  return words;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Personajes: 'lux', los dibujos propios 'svg:*' o un modelo 'glb:<id>' (con modelId = id). null equivale a 'svg:done'. */
export const CHARACTER_ID = /^(lux|svg:(done|cam|faro|sombra)|glb:[a-z0-9-]{1,64})$/;
const isInt =(value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);
const oneOf = <T extends string | number>(list: readonly T[], value: unknown): value is T => (list as readonly unknown[]).includes(value);

/** Ids de los estilos de texto de la voz del chat (ALERT_STYLES). */
export const DONE_TEXT_STYLES: readonly string[] = ALERT_STYLES.map((style) => style.id);

export interface ValidateOptions {
  /** Comandos que la palabra no puede tomar además de los reservados: los del bot del creador y la palabra de Lux. */
  extraReserved?: readonly string[];
}

const BOOLEANS: ReadonlyArray<readonly [keyof DoneSettings, string]> = [
  ['enabled', 'Done activado'],
  ['keepAlias', 'Mantener el alias !done'],
  ['memoryEnabled', 'La memoria'],
  ['threadEnabled', 'Recordar la conversación'],
  ['chatLearning', 'Aprender del chat'],
  ['eventFollow', 'Reaccionar a seguidores'],
  ['eventSub', 'Reaccionar a suscripciones'],
  ['eventRaid', 'Reaccionar a raids'],
  ['eventStart', 'Reaccionar al inicio del directo'],
  ['showText', 'Mostrar el texto'],
];

/**
 * Valida y limpia lo que llega. Lo que no venga se toma de `base` (lo ya guardado), así un formulario parcial
 * no pisa el resto. Los campos desconocidos se ignoran: nunca llegan a la base de datos.
 */
export function validateDoneSettings(
  input: Record<string, unknown>,
  base: DoneSettings = DONE_DEFAULTS,
  options: ValidateOptions = {}
): DoneCheck<DoneSettings> {
  const value: DoneSettings = { ...base };
  const bad = (field: string, message: string): DoneCheck<DoneSettings> => ({ ok: false, field, message });

  for (const [field, label] of BOOLEANS) {
    if (input[field] === undefined) continue;
    if (typeof input[field] !== 'boolean') return bad(field, `${label} es sí o no.`);
    (value as unknown as Record<string, unknown>)[field] = input[field];
  }

  if (input.commandWord !== undefined) {
    if (typeof input.commandWord !== 'string') return bad('commandWord', 'La palabra del comando tiene que ser texto.');
    const check = validateDoneCommandWord(input.commandWord, options.extraReserved);
    if (!check.ok) return bad(check.field, check.message);
    value.commandWord = check.value;
  }

  if (input.writeAs !== undefined) {
    if (!oneOf(DONE_WRITE_AS, input.writeAs)) return bad('writeAs', 'Elige escribir con tu cuenta o con la de Done.');
    value.writeAs = input.writeAs;
  }

  if (input.personality !== undefined) {
    if (typeof input.personality !== 'string') return bad('personality', 'La personalidad tiene que ser texto.');
    const text = input.personality.trim();
    if (text.length > DONE_LIMITS.personality) return bad('personality', `La personalidad admite hasta ${DONE_LIMITS.personality} caracteres.`);
    value.personality = text;
  }

  if (input.language !== undefined) {
    if (!oneOf(DONE_LANGUAGES, input.language)) return bad('language', 'Idioma no admitido.');
    value.language = input.language;
  }

  if (input.replyMax !== undefined) {
    const { min, max } = DONE_LIMITS.replyMax;
    if (!isInt(input.replyMax) || input.replyMax < min || input.replyMax > max) return bad('replyMax', `La longitud de respuesta va de ${min} a ${max} caracteres.`);
    value.replyMax = input.replyMax;
  }

  if (input.banter !== undefined) {
    if (!oneOf(DONE_BANTER_MODES, input.banter)) return bad('banter', 'Modo de respuesta a provocaciones no admitido.');
    value.banter = input.banter;
  }

  if (input.spontaneousEveryMin !== undefined) {
    if (!oneOf(DONE_SPONTANEOUS_EVERY, input.spontaneousEveryMin)) return bad('spontaneousEveryMin', `Cada cuánto comenta: ${DONE_SPONTANEOUS_EVERY.join(', ')} minutos (0 = nunca).`);
    value.spontaneousEveryMin = input.spontaneousEveryMin;
  }

  if (input.spontaneousMinMessages !== undefined) {
    if (!oneOf(DONE_SPONTANEOUS_MIN_MESSAGES, input.spontaneousMinMessages)) return bad('spontaneousMinMessages', `Mensajes mínimos del chat: ${DONE_SPONTANEOUS_MIN_MESSAGES.join(', ')}.`);
    value.spontaneousMinMessages = input.spontaneousMinMessages;
  }

  if (input.characterId !== undefined) {
    if (input.characterId === null || input.characterId === '') value.characterId = null;
    else if (typeof input.characterId === 'string' && CHARACTER_ID.test(input.characterId)) value.characterId = input.characterId;
    else return bad('characterId', 'El personaje elegido no es válido.');
  }
  if (input.modelId !== undefined) {
    if (input.modelId === null || input.modelId === '') value.modelId = null;
    else if (typeof input.modelId === 'string' && UUID.test(input.modelId)) value.modelId = input.modelId.toLowerCase();
    else return bad('modelId', 'El modelo elegido no es válido.');
  }

  if (input.obsSize !== undefined) {
    const { min, max } = DONE_LIMITS.obsSize;
    if (!isInt(input.obsSize) || input.obsSize < min || input.obsSize > max) return bad('obsSize', `El tamaño del personaje va de ${min} a ${max}.`);
    value.obsSize = input.obsSize;
  }

  if (input.position !== undefined) {
    if (!oneOf(DONE_POSITIONS, input.position)) return bad('position', 'La posición es izquierda, centro o derecha.');
    value.position = input.position;
  }

  if (input.voiceVolume !== undefined) {
    const { min, max } = DONE_LIMITS.voiceVolume;
    if (!isInt(input.voiceVolume) || input.voiceVolume < min || input.voiceVolume > max) return bad('voiceVolume', `El volumen va de ${min} a ${max}.`);
    value.voiceVolume = input.voiceVolume;
  }

  if (input.textStyle !== undefined) {
    if (typeof input.textStyle !== 'string' || !DONE_TEXT_STYLES.includes(input.textStyle)) return bad('textStyle', 'Ese estilo de texto no existe.');
    value.textStyle = input.textStyle;
  }

  if (input.typingCps !== undefined) {
    const { min, max } = DONE_LIMITS.typingCps;
    if (!isInt(input.typingCps) || input.typingCps < min || input.typingCps > max) return bad('typingCps', `La velocidad de escritura va de ${min} a ${max} letras por segundo.`);
    value.typingCps = input.typingCps;
  }

  return { ok: true, value };
}
