/**
 * server/lux/settings.ts
 *
 * Ajustes de Lux AI por streamer y su validación. Es la única puerta: lo que no
 * pasa aquí no llega a la base de datos ni al modelo.
 */

import { LUX_CHAT_WORD_DEFAULT, validateChatWord } from './chatCommands.js';
import { validateChatName } from './displayName.js';

export const LUX_LANGUAGES = ['es', 'en', 'pt'] as const;
export type LuxLanguage = (typeof LUX_LANGUAGES)[number];

export const LUX_LIMITS = {
  personality: 600,
  replyMax: { min: 60, max: 500, default: 400 },
  obsSize: { min: 10, max: 100, default: 40 },
} as const;

/** Opciones de los comentarios espontáneos (migración 0037). */
export const LUX_SPONTANEOUS_EVERY = [10, 15, 30, 60] as const;
export const LUX_SPONTANEOUS_MIN_MESSAGES = [3, 5, 10] as const;

export const LUX_VOICE_ENGINES = ['fish', 'elevenlabs'] as const;
export type LuxVoiceEngine = (typeof LUX_VOICE_ENGINES)[number];

export interface LuxSettings {
  personality: string;
  replyMax: number;
  language: LuxLanguage;
  memoryEnabled: boolean;
  obsSize: number;
  /** Lux responde a !lux en el chat (migración 0026). */
  chatEnabled: boolean;
  /** Volumen de la voz en el overlay, de 0 a 100 (migración 0028). */
  voiceVolume: number;
  /** Lux aprende del chat: resume cada media hora y guarda recuerdos del chat. Apagado por defecto (migración 0030). */
  chatLearning: boolean;
  /** Voz del catálogo (reference_id) y su motor. Null: la voz por defecto. */
  voiceReferenceId: string | null;
  voiceEngine: LuxVoiceEngine | null;
  /** Palabra con la que el público habla con Lux en el chat (migración 0036). */
  chatWord: string;
  /** Sigue valiendo !lux como alias de la palabra (migración 0036). */
  chatAlias: boolean;
  /** Nombre visible de la IA en el chat. Vacío = la palabra de activación (migración 0037). */
  chatName: string;
  /** Comentarios espontáneos: cada tanto, si hubo actividad en el chat (migración 0037). */
  spontaneousEnabled: boolean;
  spontaneousEveryMin: number;
  spontaneousMinMessages: number;
  /** Reacciones a eventos: seguidor nuevo, suscripción, raid e inicio del directo (migración 0037). */
  eventFollow: boolean;
  eventSub: boolean;
  eventRaid: boolean;
  eventStart: boolean;
}

export const DEFAULT_LUX_SETTINGS: LuxSettings = {
  personality: '',
  replyMax: LUX_LIMITS.replyMax.default,
  language: 'es',
  memoryEnabled: true,
  obsSize: LUX_LIMITS.obsSize.default,
  voiceReferenceId: null,
  voiceEngine: null,
  chatEnabled: true,
  voiceVolume: 100,
  chatLearning: false,
  chatWord: LUX_CHAT_WORD_DEFAULT,
  chatAlias: true,
  chatName: '',
  spontaneousEnabled: true,
  spontaneousEveryMin: 15,
  spontaneousMinMessages: 10,
  eventFollow: true,
  eventSub: true,
  eventRaid: true,
  eventStart: true,
};

export type SettingsCheck = { ok: true; value: LuxSettings } | { ok: false; field: keyof LuxSettings; message: string };

const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);

/**
 * Valida y limpia la entrada. Los campos que no vengan se toman de `base`
 * (lo que ya estaba guardado), así que un formulario parcial no pisa el resto.
 */
export function normalizeLuxSettings(input: Record<string, unknown>, base: LuxSettings = DEFAULT_LUX_SETTINGS): SettingsCheck {
  const value: LuxSettings = { ...base };

  if (input.personality !== undefined) {
    if (typeof input.personality !== 'string') return { ok: false, field: 'personality', message: 'La personalidad tiene que ser texto.' };
    const text = input.personality.trim();
    if (text.length > LUX_LIMITS.personality) {
      return { ok: false, field: 'personality', message: `La personalidad admite hasta ${LUX_LIMITS.personality} caracteres.` };
    }
    value.personality = text;
  }

  if (input.replyMax !== undefined) {
    const { min, max } = LUX_LIMITS.replyMax;
    if (!isInt(input.replyMax) || input.replyMax < min || input.replyMax > max) {
      return { ok: false, field: 'replyMax', message: `La longitud de respuesta va de ${min} a ${max} caracteres.` };
    }
    value.replyMax = input.replyMax;
  }

  if (input.language !== undefined) {
    if (typeof input.language !== 'string' || !(LUX_LANGUAGES as readonly string[]).includes(input.language)) {
      return { ok: false, field: 'language', message: 'Idioma no admitido.' };
    }
    value.language = input.language as LuxLanguage;
  }

  if (input.memoryEnabled !== undefined) {
    if (typeof input.memoryEnabled !== 'boolean') return { ok: false, field: 'memoryEnabled', message: 'La memoria es sí o no.' };
    value.memoryEnabled = input.memoryEnabled;
  }

  if (input.obsSize !== undefined) {
    const { min, max } = LUX_LIMITS.obsSize;
    if (!isInt(input.obsSize) || input.obsSize < min || input.obsSize > max) {
      return { ok: false, field: 'obsSize', message: `El tamaño del personaje va de ${min} a ${max}.` };
    }
    value.obsSize = input.obsSize;
  }

  if (input.voiceVolume !== undefined) {
    if (!isInt(input.voiceVolume) || input.voiceVolume < 0 || input.voiceVolume > 100) {
      return { ok: false, field: 'voiceVolume', message: 'El volumen va de 0 a 100.' };
    }
    value.voiceVolume = input.voiceVolume;
  }

  if (input.chatEnabled !== undefined) {
    if (typeof input.chatEnabled !== 'boolean') return { ok: false, field: 'chatEnabled', message: 'El chat de Lux es sí o no.' };
    value.chatEnabled = input.chatEnabled;
  }

  if (input.chatLearning !== undefined) {
    if (typeof input.chatLearning !== 'boolean') return { ok: false, field: 'chatLearning', message: 'Aprender del chat es sí o no.' };
    value.chatLearning = input.chatLearning;
  }

  if (input.chatWord !== undefined) {
    if (typeof input.chatWord !== 'string') return { ok: false, field: 'chatWord', message: 'La palabra de activación tiene que ser texto.' };
    const check = validateChatWord(input.chatWord);
    if (!check.ok) return { ok: false, field: 'chatWord', message: check.message };
    value.chatWord = check.word;
  }

  if (input.chatAlias !== undefined) {
    if (typeof input.chatAlias !== 'boolean') return { ok: false, field: 'chatAlias', message: 'El alias !lux es sí o no.' };
    value.chatAlias = input.chatAlias;
  }

  if (input.chatName !== undefined) {
    if (typeof input.chatName !== 'string') return { ok: false, field: 'chatName', message: 'El nombre tiene que ser texto.' };
    const check = validateChatName(input.chatName);
    if (!check.ok) return { ok: false, field: 'chatName', message: check.message };
    value.chatName = check.name;
  }

  if (input.spontaneousEnabled !== undefined) {
    if (typeof input.spontaneousEnabled !== 'boolean') return { ok: false, field: 'spontaneousEnabled', message: 'Los comentarios espontáneos son sí o no.' };
    value.spontaneousEnabled = input.spontaneousEnabled;
  }

  if (input.spontaneousEveryMin !== undefined) {
    if (!isInt(input.spontaneousEveryMin) || !(LUX_SPONTANEOUS_EVERY as readonly number[]).includes(input.spontaneousEveryMin)) {
      return { ok: false, field: 'spontaneousEveryMin', message: `Cada cuánto comenta: ${LUX_SPONTANEOUS_EVERY.join(', ')} minutos.` };
    }
    value.spontaneousEveryMin = input.spontaneousEveryMin;
  }

  if (input.spontaneousMinMessages !== undefined) {
    if (!isInt(input.spontaneousMinMessages) || !(LUX_SPONTANEOUS_MIN_MESSAGES as readonly number[]).includes(input.spontaneousMinMessages)) {
      return { ok: false, field: 'spontaneousMinMessages', message: `Mensajes mínimos del chat: ${LUX_SPONTANEOUS_MIN_MESSAGES.join(', ')}.` };
    }
    value.spontaneousMinMessages = input.spontaneousMinMessages;
  }

  for (const [field, label] of [
    ['eventFollow', 'Reaccionar a seguidores'],
    ['eventSub', 'Reaccionar a suscripciones'],
    ['eventRaid', 'Reaccionar a raids'],
    ['eventStart', 'Reaccionar al inicio del directo'],
  ] as const) {
    if (input[field] === undefined) continue;
    if (typeof input[field] !== 'boolean') return { ok: false, field, message: `${label} es sí o no.` };
    value[field] = input[field] as boolean;
  }

  if (input.voiceReferenceId !== undefined) {
    if (input.voiceReferenceId === null) {
      value.voiceReferenceId = null;
      value.voiceEngine = null;
    } else {
      if (typeof input.voiceReferenceId !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(input.voiceReferenceId)) {
        return { ok: false, field: 'voiceReferenceId', message: 'La voz elegida no es válida.' };
      }
      if (typeof input.voiceEngine !== 'string' || !(LUX_VOICE_ENGINES as readonly string[]).includes(input.voiceEngine)) {
        return { ok: false, field: 'voiceEngine', message: 'El motor de la voz no es válido.' };
      }
      value.voiceReferenceId = input.voiceReferenceId;
      value.voiceEngine = input.voiceEngine as LuxVoiceEngine;
    }
  }

  return { ok: true, value };
}

/** Fila de la base de datos (snake_case) a ajustes validados. Una fila rara cae a los valores por defecto. */
/**
 * Valida la fila campo por campo: un valor malo se queda en su valor por defecto
 * y no arrastra al resto (antes, una voz rara dejaba sin personalidad a Lux).
 */
export function settingsFromRow(row: Record<string, unknown> | null): LuxSettings {
  if (!row) return { ...DEFAULT_LUX_SETTINGS };
  const parts: Record<string, unknown>[] = [
    { personality: row.personality },
    { replyMax: row.reply_max },
    { language: row.language },
    { memoryEnabled: row.memory_enabled },
    { obsSize: row.obs_size },
    { chatEnabled: row.chat_enabled },
    { voiceVolume: row.voice_volume },
    { chatLearning: row.chat_learning },
    { chatWord: row.chat_word },
    { chatAlias: row.chat_alias },
    { chatName: row.chat_name },
    { spontaneousEnabled: row.spontaneous_enabled },
    { spontaneousEveryMin: row.spontaneous_every_min },
    { spontaneousMinMessages: row.spontaneous_min_messages },
    { eventFollow: row.event_follow },
    { eventSub: row.event_sub },
    { eventRaid: row.event_raid },
    { eventStart: row.event_start },
    // La voz va como pareja: o las dos columnas, o ninguna.
    { voiceReferenceId: row.voice_reference_id ?? null, voiceEngine: row.voice_engine ?? null },
  ];
  let value: LuxSettings = { ...DEFAULT_LUX_SETTINGS };
  for (const part of parts) {
    if (Object.values(part).every((item) => item === undefined)) continue;
    const check = normalizeLuxSettings(part, value);
    if (check.ok) value = check.value;
  }
  return value;
}

/** Ajustes a fila de la base de datos. */
export function rowFromSettings(profileId: string, value: LuxSettings): Record<string, unknown> {
  return {
    profile_id: profileId,
    personality: value.personality,
    reply_max: value.replyMax,
    language: value.language,
    memory_enabled: value.memoryEnabled,
    obs_size: value.obsSize,
    chat_enabled: value.chatEnabled,
    voice_volume: value.voiceVolume,
    chat_learning: value.chatLearning,
    chat_word: value.chatWord,
    chat_alias: value.chatAlias,
    chat_name: value.chatName,
    spontaneous_enabled: value.spontaneousEnabled,
    spontaneous_every_min: value.spontaneousEveryMin,
    spontaneous_min_messages: value.spontaneousMinMessages,
    event_follow: value.eventFollow,
    event_sub: value.eventSub,
    event_raid: value.eventRaid,
    event_start: value.eventStart,
    voice_reference_id: value.voiceReferenceId,
    voice_engine: value.voiceEngine,
    updated_at: new Date().toISOString(),
  };
}
