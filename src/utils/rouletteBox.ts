/**
 * src/utils/rouletteBox.ts
 *
 * Lo que la caja «Ruleta» de Studio enseña en el editor: la ruleta del
 * streamer abierta y quieta. Si no tiene ningún segmento encendido, se pintan
 * los de muestra para que la rueda no salga vacía.
 */

import { DEFAULT_ROULETTE_SETTINGS, RouletteSettings } from '../types/roulette';

/** Segundos del giro de prueba del editor: corto, para ver el movimiento sin esperar. */
export const ROULETTE_PREVIEW_SPIN_SEC = 3;
/** Milisegundos que el resultado de la prueba se queda antes de volver a la rueda quieta. */
export const ROULETTE_PREVIEW_RESULT_MS = 4500;

/** Ajustes para la muestra del editor: sin sonido, con giro corto y siempre con segmentos. */
export function rouletteSample(settings: RouletteSettings): RouletteSettings {
  const hasSegments = settings.segments.some((segment) => segment.enabled);
  return {
    ...settings,
    segments: hasSegments ? settings.segments : DEFAULT_ROULETTE_SETTINGS.segments,
    soundEnabled: false,
    spinDurationSec: ROULETTE_PREVIEW_SPIN_SEC,
  };
}
