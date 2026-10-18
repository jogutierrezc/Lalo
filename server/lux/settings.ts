/**
 * server/lux/settings.ts
 *
 * Ajustes de Lux AI por streamer y su validación. Es la única puerta: lo que no
 * pasa aquí no llega a la base de datos ni al modelo.
 */

export const LUX_LANGUAGES = ['es', 'en', 'pt'] as const;
export type LuxLanguage = (typeof LUX_LANGUAGES)[number];

export const LUX_LIMITS = {
  personality: 600,
  replyMax: { min: 60, max: 500, default: 200 },
  obsSize: { min: 10, max: 100, default: 40 },
} as const;

export const LUX_VOICE_ENGINES = ['fish', 'elevenlabs'] as const;
export type LuxVoiceEngine = (typeof LUX_VOICE_ENGINES)[number];

export interface LuxSettings {
  personality: string;
  replyMax: number;
  language: LuxLanguage;
  memoryEnabled: boolean;
  obsSize: number;
  /** Voz del catálogo (reference_id) y su motor. Null: la voz por defecto. */
  voiceReferenceId: string | null;
  voiceEngine: LuxVoiceEngine | null;
}

export const DEFAULT_LUX_SETTINGS: LuxSettings = {
  personality: '',
  replyMax: LUX_LIMITS.replyMax.default,
  language: 'es',
  memoryEnabled: true,
  obsSize: LUX_LIMITS.obsSize.default,
  voiceReferenceId: null,
  voiceEngine: null,
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
    voice_reference_id: value.voiceReferenceId,
    voice_engine: value.voiceEngine,
    updated_at: new Date().toISOString(),
  };
}
