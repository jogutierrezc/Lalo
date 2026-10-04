/**
 * src/utils/widgetSettings.ts
 *
 * Qué ajustes de la voz usa una fuente de OBS: mezcla lo guardado con lo que
 * trae la URL. Lógica pura, para poder probar quién manda en cada caso.
 *
 * - Sin cuenta en la nube, la URL manda: el navegador de OBS no comparte
 *   almacenamiento con el panel y lo guardado allí son valores por defecto.
 * - Con cuenta en la nube y los ajustes ya descargados, manda lo guardado: lo
 *   que dice la URL es de cuando se copió y, si ganara, un cambio hecho después
 *   en el panel nunca llegaría a OBS.
 * - Si la nube no responde y no hay nada descargado, la URL vuelve a mandar:
 *   la fuente no se queda en los valores por defecto.
 *
 * El canal siempre sale de la URL si viene en ella: es lo que identifica la fuente.
 */

import { SPEED_MAX, SPEED_MIN, TTSSettings, normalizeSettings } from '../types/settings';
import { appearanceFromParams } from './appearance';
import { moderationFromParams } from './moderation';
import { preSoundFromParams } from './preSound';

export type ParamReader = (key: string) => string | null;

export const WIDGET_DEFAULT_VOICE = '37f9f4eec7624089a49b188d47588f2c';
const OLD_PRESET_VOICE = '7f92f8afb8ec43bf81429cc1c9199cb1';
const FREE_MODEL = 's2.1-pro-free';

const trimId = (value: string) => value.trim().replace(/[.,;/\\]+$/, '');

function cleanVoice(value: string | null | undefined): string {
  const voice = trimId(value || '');
  return !voice || voice === OLD_PRESET_VOICE || voice === 'default' || voice === 'undefined' ? '' : voice;
}

function cleanModel(value: string | null | undefined): string {
  const model = trimId(value || '');
  return !model || model.toLowerCase().includes('free') ? FREE_MODEL : model;
}

/** Lee de la URL solo los ajustes de la voz que vienen en ella y son válidos. */
export function ttsOverridesFromParams(get: ParamReader): Partial<TTSSettings> {
  const overrides: Partial<TTSSettings> = { ...appearanceFromParams(get), ...moderationFromParams(get) };

  const voice = cleanVoice(get('voice') || get('reference_id') || get('v'));
  if (voice) overrides.referenceId = voice;
  const model = get('model') || get('m');
  if (model) overrides.model = cleanModel(model);
  const announce = get('announce') ?? get('a');
  if (announce !== null) overrides.announceSender = announce === 'true' || announce === '1';
  const template = get('tpl');
  if (template && template.includes('{message}')) overrides.announceTemplate = template.slice(0, 200);

  const volume = parseFloat(get('vol') || '');
  if (Number.isFinite(volume)) overrides.volume = Math.min(1, Math.max(0, volume));
  const speed = parseFloat(get('speed') || '');
  if (Number.isFinite(speed)) overrides.speed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed));

  const preSound = preSoundFromParams(get);
  if (preSound) overrides.preSound = preSound;
  return overrides;
}

/**
 * Ajustes con los que trabaja la fuente.
 * `savedWins` es true cuando lo guardado viene de la cuenta en la nube.
 */
export function resolveWidgetSettings(saved: unknown, get: ParamReader, savedWins: boolean): TTSSettings {
  const base = normalizeSettings(saved);
  const merged = savedWins ? base : { ...base, ...ttsOverridesFromParams(get) };
  return {
    ...merged,
    channel: get('channel') || get('c') || base.channel || 'laloplay_',
    referenceId: cleanVoice(merged.referenceId) || WIDGET_DEFAULT_VOICE,
    model: cleanModel(merged.model),
  };
}
