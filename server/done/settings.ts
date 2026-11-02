/**
 * server/done/settings.ts
 *
 * Los ajustes de Done viven en `lux_settings.done_settings` (jsonb, migración 0054), con los nombres del contrato
 * (camelCase). Todo lo que se lee pasa por validateDoneSettings (src/lib/doneSettings.ts), campo por campo: un valor
 * malo se queda en su valor por defecto y no arrastra al resto.
 */

import { validateDoneSettings } from '../../src/lib/doneSettings.js';
import { DONE_DEFAULTS, type DoneSettings } from '../../src/lib/doneTypes.js';

/** Contenido del jsonb a ajustes. Sin datos, los valores por defecto. */
export function doneSettingsFromRow(json: Record<string, unknown> | null): DoneSettings {
  let value: DoneSettings = { ...DONE_DEFAULTS };
  if (!json) return value;
  for (const field of Object.keys(DONE_DEFAULTS)) {
    if (json[field] === undefined) continue;
    const check = validateDoneSettings({ [field]: json[field] }, value);
    if (check.ok) value = check.value;
  }
  return value;
}

/** Ajustes a lo que se guarda: el jsonb de lux_settings. */
export function doneRowFromSettings(profileId: string, value: DoneSettings): { profile_id: string; done_settings: Record<string, unknown> } {
  return { profile_id: profileId, done_settings: { ...value } };
}
