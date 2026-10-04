/**
 * src/utils/studioGeometry.ts
 *
 * Geometría del lienzo de Studio, sin React ni DOM para poder probarla:
 * imán al mover y al estirar (lienzo, otras capas y cuadrícula), cambio de
 * tamaño con mínimo y proporción fija, alineación y límites.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export type AlignTo = 'left' | 'hcenter' | 'right' | 'top' | 'vmiddle' | 'bottom';

export interface SnapOptions {
  stageW: number;
  stageH: number;
  /** Las demás capas visibles de la escena. */
  others: Rect[];
  /** Imán a los bordes y centros de las otras capas. */
  layers: boolean;
  /** Paso de la cuadrícula; 0 la apaga. */
  grid: number;
  /** Distancia, en píxeles del lienzo, a la que el imán atrapa. */
  threshold: number;
}

export interface SnapResult extends Rect {
  /** Líneas verticales (x) y horizontales (y) con las que la capa ha quedado alineada. */
  guidesV: number[];
  guidesH: number[];
}

const uniq = (list: number[]) => Array.from(new Set(list.map((n) => Math.round(n * 100) / 100)));

/** Líneas a las que se puede pegar en un eje: bordes y centro del lienzo y de cada capa. */
function targets(stage: number, others: Rect[], axis: 'x' | 'y', layers: boolean): number[] {
  const list = [0, stage / 2, stage];
  if (layers) {
    others.forEach((rect) => {
      const start = axis === 'x' ? rect.x : rect.y;
      const size = axis === 'x' ? rect.w : rect.h;
      list.push(start, start + size / 2, start + size);
    });
  }
  return uniq(list);
}

/** Mejor ajuste de un conjunto de puntos de la capa contra las líneas disponibles. */
function nearest(points: number[], lines: number[], threshold: number): { delta: number; lines: number[] } | null {
  let best: number | null = null;
  points.forEach((point) => {
    lines.forEach((line) => {
      const delta = line - point;
      if (Math.abs(delta) < threshold && (best === null || Math.abs(delta) < Math.abs(best))) best = delta;
    });
  });
  if (best === null) return null;
  const delta: number = best;
  // Todas las líneas que coinciden tras el ajuste se pintan como guía
  const hit = lines.filter((line) => points.some((point) => Math.abs(point + delta - line) < 0.5));
  return { delta, lines: hit };
}

const toGrid = (value: number, grid: number) => (grid > 0 ? Math.round(value / grid) * grid : value);

/** Imán al mover: primero lienzo y capas; si no hay nada cerca, la cuadrícula. */
export function snapMove(rect: Rect, o: SnapOptions): SnapResult {
  const out: SnapResult = { ...rect, guidesV: [], guidesH: [] };
  const sx = nearest([rect.x, rect.x + rect.w / 2, rect.x + rect.w], targets(o.stageW, o.others, 'x', o.layers), o.threshold);
  if (sx) {
    out.x = rect.x + sx.delta;
    out.guidesV = sx.lines;
  } else {
    out.x = toGrid(rect.x, o.grid);
  }
  const sy = nearest([rect.y, rect.y + rect.h / 2, rect.y + rect.h], targets(o.stageH, o.others, 'y', o.layers), o.threshold);
  if (sy) {
    out.y = rect.y + sy.delta;
    out.guidesH = sy.lines;
  } else {
    out.y = toGrid(rect.y, o.grid);
  }
  return out;
}

/** Imán al estirar: solo se pegan los bordes que mueve el tirador. */
export function snapResize(rect: Rect, handle: Handle, o: SnapOptions, min: number): SnapResult {
  const out: SnapResult = { ...rect, guidesV: [], guidesH: [] };
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  const linesX = targets(o.stageW, o.others, 'x', o.layers);
  const linesY = targets(o.stageH, o.others, 'y', o.layers);

  if (handle.includes('e')) {
    const hit = nearest([right], linesX, o.threshold);
    const edge = hit ? right + hit.delta : toGrid(right, o.grid);
    if (edge - rect.x >= min) {
      out.w = edge - rect.x;
      if (hit) out.guidesV = hit.lines;
    }
  }
  if (handle.includes('w')) {
    const hit = nearest([rect.x], linesX, o.threshold);
    const edge = hit ? rect.x + hit.delta : toGrid(rect.x, o.grid);
    if (right - edge >= min) {
      out.x = edge;
      out.w = right - edge;
      if (hit) out.guidesV = hit.lines;
    }
  }
  if (handle.includes('s')) {
    const hit = nearest([bottom], linesY, o.threshold);
    const edge = hit ? bottom + hit.delta : toGrid(bottom, o.grid);
    if (edge - rect.y >= min) {
      out.h = edge - rect.y;
      if (hit) out.guidesH = hit.lines;
    }
  }
  if (handle.includes('n')) {
    const hit = nearest([rect.y], linesY, o.threshold);
    const edge = hit ? rect.y + hit.delta : toGrid(rect.y, o.grid);
    if (bottom - edge >= min) {
      out.y = edge;
      out.h = bottom - edge;
      if (hit) out.guidesH = hit.lines;
    }
  }
  return out;
}

/**
 * Tamaño nuevo al arrastrar un tirador `dx`, `dy` píxeles del lienzo. El borde
 * opuesto no se mueve. Con proporción fija, las esquinas escalan desde la
 * esquina contraria y los lados, desde el centro del otro eje.
 */
export function resizeRect(orig: Rect, handle: Handle, dx: number, dy: number, o: { min: number; keepRatio?: boolean }): Rect {
  const east = handle.includes('e');
  const west = handle.includes('w');
  const south = handle.includes('s');
  const north = handle.includes('n');
  const right = orig.x + orig.w;
  const bottom = orig.y + orig.h;

  let w = east ? orig.w + dx : west ? orig.w - dx : orig.w;
  let h = south ? orig.h + dy : north ? orig.h - dy : orig.h;

  if (!o.keepRatio || orig.w <= 0 || orig.h <= 0) {
    w = Math.max(o.min, w);
    h = Math.max(o.min, h);
    return { x: west ? right - w : orig.x, y: north ? bottom - h : orig.y, w, h };
  }

  const horizontal = east || west;
  const vertical = south || north;
  const least = Math.max(o.min / orig.w, o.min / orig.h);
  let scale: number;
  if (horizontal && vertical) scale = Math.max(w / orig.w, h / orig.h);
  else if (horizontal) scale = w / orig.w;
  else scale = h / orig.h;
  scale = Math.max(least, scale);
  w = orig.w * scale;
  h = orig.h * scale;

  let x = west ? right - w : orig.x;
  let y = north ? bottom - h : orig.y;
  // Tirador de un lado: el otro eje crece por igual hacia los dos lados
  if (horizontal && !vertical) y = orig.y + (orig.h - h) / 2;
  if (vertical && !horizontal) x = orig.x + (orig.w - w) / 2;
  return { x, y, w, h };
}

/** Coloca la capa contra un borde del lienzo o en su centro. */
export function alignRect(rect: Rect, to: AlignTo, stageW: number, stageH: number): Rect {
  switch (to) {
    case 'left':
      return { ...rect, x: 0 };
    case 'hcenter':
      return { ...rect, x: (stageW - rect.w) / 2 };
    case 'right':
      return { ...rect, x: stageW - rect.w };
    case 'top':
      return { ...rect, y: 0 };
    case 'vmiddle':
      return { ...rect, y: (stageH - rect.h) / 2 };
    default:
      return { ...rect, y: stageH - rect.h };
  }
}

/** Nunca se pierde una capa fuera del lienzo: siempre queda a la vista una franja de `keep` píxeles. */
export function keepOnStage(rect: Rect, stageW: number, stageH: number, keep = 24): Rect {
  return {
    ...rect,
    x: Math.min(stageW - keep, Math.max(keep - rect.w, rect.x)),
    y: Math.min(stageH - keep, Math.max(keep - rect.h, rect.y)),
  };
}

export const roundRect = (rect: Rect): Rect => ({
  x: Math.round(rect.x),
  y: Math.round(rect.y),
  w: Math.round(rect.w),
  h: Math.round(rect.h),
});
