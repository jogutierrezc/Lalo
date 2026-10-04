/**
 * src/utils/randomSpot.ts
 *
 * Posición aleatoria de los avisos. Dada una zona y el tamaño del aviso, elige
 * un punto en el que el aviso cabe entero, respeta un margen y no repite el
 * sitio anterior. La fuente de azar se inyecta para poder probarlo.
 */

export interface SpotBounds {
  zoneW: number;
  zoneH: number;
  itemW: number;
  itemH: number;
  /** Margen que se deja libre contra cada borde de la zona. */
  margin?: number;
}

export interface Spot {
  /** Esquina superior izquierda del aviso, medida desde la esquina de la zona. */
  x: number;
  y: number;
  /** El mismo punto como fracción (0 a 1) del recorrido libre en cada eje. */
  u: number;
  v: number;
}

const TRIES = 8;
/** Distancia mínima al sitio anterior, como parte de la diagonal del recorrido libre. */
const MIN_PART = 0.3;

const free = (zone: number, item: number, margin: number) => Math.max(0, zone - item - margin * 2);
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Convierte fracciones en un punto dentro de la zona. Si el aviso no cabe en un eje, lo centra. */
export function spotAt(bounds: SpotBounds, u: number, v: number): Spot {
  const margin = Math.max(0, bounds.margin ?? 0);
  const fx = free(bounds.zoneW, bounds.itemW, margin);
  const fy = free(bounds.zoneH, bounds.itemH, margin);
  const cu = clamp01(u);
  const cv = clamp01(v);
  return {
    x: Math.round(fx > 0 ? margin + cu * fx : (bounds.zoneW - bounds.itemW) / 2),
    y: Math.round(fy > 0 ? margin + cv * fy : (bounds.zoneH - bounds.itemH) / 2),
    u: fx > 0 ? cu : 0.5,
    v: fy > 0 ? cv : 0.5,
  };
}

/**
 * Elige el siguiente punto. Con `last`, el nuevo queda a cierta distancia del
 * anterior: se prueba unas cuantas veces y, si el azar insiste, se va a la
 * esquina del recorrido más alejada. Si no hay recorrido, solo existe un punto.
 */
export function pickSpot(bounds: SpotBounds, last: Pick<Spot, 'u' | 'v'> | null = null, random: () => number = Math.random): Spot {
  const margin = Math.max(0, bounds.margin ?? 0);
  const fx = free(bounds.zoneW, bounds.itemW, margin);
  const fy = free(bounds.zoneH, bounds.itemH, margin);
  if (!last || (fx === 0 && fy === 0)) return spotAt(bounds, random(), random());

  const need = Math.hypot(fx, fy) * MIN_PART;
  const far = (u: number, v: number) => Math.hypot((u - last.u) * fx, (v - last.v) * fy);
  for (let i = 0; i < TRIES; i += 1) {
    const u = random();
    const v = random();
    if (far(u, v) >= need) return spotAt(bounds, u, v);
  }
  return spotAt(bounds, last.u < 0.5 ? 1 : 0, last.v < 0.5 ? 1 : 0);
}

/**
 * Estilo CSS que coloca un aviso de tamaño desconocido en la fracción (u, v) de
 * su contenedor, con un margen en porcentaje. No hace falta medir: el propio
 * desplazamiento descuenta el tamaño del aviso.
 */
export function spotStyle(
  spot: Pick<Spot, 'u' | 'v'>,
  marginPercent: number
): { position: 'absolute'; left: string; top: string; transform: string } {
  const m = Math.min(40, Math.max(0, marginPercent));
  const pos = (f: number) => `calc(${m}% + ${f.toFixed(4)} * (100% - ${m * 2}%))`;
  return {
    position: 'absolute',
    left: pos(spot.u),
    top: pos(spot.v),
    transform: `translate(${(-spot.u * 100).toFixed(2)}%, ${(-spot.v * 100).toFixed(2)}%)`,
  };
}
