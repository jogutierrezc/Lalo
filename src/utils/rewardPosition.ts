/**
 * src/utils/rewardPosition.ts
 *
 * Dónde cae el vídeo de una recompensa. Todo se mide en porcentaje de la
 * pantalla: `left` y `width` sobre el ancho, `top` y `height` sobre el alto. El
 * hueco del vídeo es siempre 16:9 y el vídeo se encaja dentro, así que cabe
 * entero sea cual sea su proporción. El azar se inyecta para poder probarlo.
 */

import { REWARD_GRID_POSITIONS, type RewardVideoPosition } from '../types/rewards';

export interface VideoBox {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Zona de la rejilla 3 × 3 donde cae el centro (0 a 8, fila por fila). */
  zone: number;
  /** En aleatorio con «no repetir»: no hubo forma de caer en otra zona. */
  repeated?: boolean;
}

export const ZONE_NAMES = [
  'arriba a la izquierda',
  'arriba al centro',
  'arriba a la derecha',
  'centro izquierda',
  'centro',
  'centro derecha',
  'abajo a la izquierda',
  'abajo al centro',
  'abajo a la derecha',
] as const;

/** Separación de los puntos fijos a los bordes (% de la pantalla). */
export const FIXED_EDGE = 3;
const BOX_ASPECT = 16 / 9;
const TRIES = 40;

/** Ancho del vídeo en % del ancho de pantalla: el tamaño 100% ocupa un 30%. */
export function videoWidthPercent(scale: number): number {
  const safe = Number.isFinite(scale) ? scale : 1;
  return Math.min(60, Math.max(15, 30 * safe));
}

const heightFor = (width: number, stageAspect: number) => (width * stageAspect) / BOX_ASPECT;
const zoneOf = (left: number, top: number, width: number, height: number) =>
  Math.min(2, Math.max(0, Math.floor((top + height / 2) / (100 / 3)))) * 3 + Math.min(2, Math.max(0, Math.floor((left + width / 2) / (100 / 3))));

/** Encoge el hueco, sin deformarlo, hasta que cabe en la zona libre que deja el margen. */
function fit(width: number, margin: number, stageAspect: number): { width: number; height: number } {
  const room = Math.max(1, 100 - margin * 2);
  let w = Math.min(width, room);
  if (heightFor(w, stageAspect) > room) w = (room * BOX_ASPECT) / stageAspect;
  return { width: w, height: heightFor(w, stageAspect) };
}

/** Hueco en uno de los nueve puntos fijos. `fullscreen` y `random` no pasan por aquí. */
export function fixedBox(position: RewardVideoPosition, widthPercent: number, stageAspect = BOX_ASPECT): VideoBox {
  const index = Math.max(0, (REWARD_GRID_POSITIONS as readonly string[]).indexOf(position));
  const cell = (REWARD_GRID_POSITIONS as readonly string[]).includes(position) ? index : 4;
  const { width, height } = fit(widthPercent, FIXED_EDGE, stageAspect);
  const along = (size: number, step: number) => [FIXED_EDGE, (100 - size) / 2, 100 - FIXED_EDGE - size][step];
  return { left: along(width, cell % 3), top: along(height, Math.floor(cell / 3)), width, height, zone: cell };
}

export interface RandomBoxOptions {
  widthPercent: number;
  /** Margen libre contra cada borde, en % de la pantalla. */
  margin: number;
  /** Variar el tamaño hasta un 20% más o menos. */
  vary: boolean;
  /** No caer en la misma zona que la vez anterior. */
  noRepeat: boolean;
  lastZone?: number | null;
  stageAspect?: number;
}

/**
 * Hueco aleatorio, siempre entero dentro de la pantalla y del margen. Con
 * «no repetir» prueba hasta salir de la zona anterior; si el tamaño y el margen
 * solo dejan una zona, cae en ella y lo indica en `repeated`.
 */
export function randomBox(options: RandomBoxOptions, random: () => number = Math.random): VideoBox {
  const stageAspect = options.stageAspect ?? BOX_ASPECT;
  const margin = Math.min(40, Math.max(0, options.margin));
  const factor = options.vary ? 0.8 + random() * 0.4 : 1;
  const { width, height } = fit(options.widthPercent * factor, margin, stageAspect);
  const freeX = Math.max(0, 100 - margin * 2 - width);
  const freeY = Math.max(0, 100 - margin * 2 - height);
  const last = options.noRepeat ? options.lastZone ?? null : null;

  let left = margin;
  let top = margin;
  let zone = 0;
  for (let attempt = 0; attempt < TRIES; attempt += 1) {
    left = margin + random() * freeX;
    top = margin + random() * freeY;
    zone = zoneOf(left, top, width, height);
    if (last === null || zone !== last) return { left, top, width, height, zone };
  }
  return { left, top, width, height, zone, repeated: true };
}
