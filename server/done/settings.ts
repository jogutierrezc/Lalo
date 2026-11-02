/**
 * server/done/settings.ts
 *
 * Paso entre los ajustes de Done y la fila de `done_settings` (migración 0054). La validación en sí es la de
 * src/lib/doneSettings.ts: este archivo solo traduce nombres y obliga a que lo leído de la base de datos pase por ella.
 */

import { validateDoneSettings } from '../../src/lib/doneSettings.js';
import { DONE_DEFAULTS, type DoneSettings } from '../../src/lib/doneTypes.js';

/** Campos de la fila (snake_case) y su nombre en los ajustes. */
const COLUMNS: ReadonlyArray<readonly [keyof DoneSettings, string]> = [
  ['enabled', 'enabled'],
  ['commandWord', 'command_word'],
  ['keepAlias', 'keep_alias'],
  ['writeAs', 'write_as'],
  ['personality', 'personality'],
  ['language', 'language'],
  ['replyMax', 'reply_max'],
  ['banter', 'banter'],
  ['memoryEnabled', 'memory_enabled'],
  ['threadEnabled', 'thread_enabled'],
  ['chatLearning', 'chat_learning'],
  ['spontaneousEveryMin', 'spontaneous_every_min'],
  ['spontaneousMinMessages', 'spontaneous_min_messages'],
  ['eventFollow', 'event_follow'],
  ['eventSub', 'event_sub'],
  ['eventRaid', 'event_raid'],
  ['eventStart', 'event_start'],
  ['characterId', 'character_id'],
  ['modelId', 'model_id'],
  ['obsSize', 'obs_size'],
  ['position', 'position'],
  ['voiceVolume', 'voice_volume'],
  ['textStyle', 'text_style'],
  ['showText', 'show_text'],
  ['typingCps', 'typing_cps'],
];

/**
 * Fila de la base de datos a ajustes. Se valida campo por campo: un valor malo se queda en su valor por defecto
 * y no arrastra al resto. Sin fila, los valores por defecto.
 */
export function doneSettingsFromRow(row: Record<string, unknown> | null): DoneSettings {
  let value: DoneSettings = { ...DONE_DEFAULTS };
  if (!row) return value;
  for (const [field, column] of COLUMNS) {
    if (row[column] === undefined) continue;
    const check = validateDoneSettings({ [field]: row[column] }, value);
    if (check.ok) value = check.value;
  }
  return value;
}

/** Ajustes a fila de la base de datos. */
export function doneRowFromSettings(profileId: string, value: DoneSettings): Record<string, unknown> {
  const row: Record<string, unknown> = { profile_id: profileId };
  for (const [field, column] of COLUMNS) row[column] = value[field];
  row.updated_at = new Date().toISOString();
  return row;
}
