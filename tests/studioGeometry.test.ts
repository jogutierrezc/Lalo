/**
 * tests/studioGeometry.test.ts
 *
 * Geometría del lienzo de Studio (imanes, cambio de tamaño, alineación y
 * límites) y elección del punto aleatorio de los avisos.
 */

import { describe, it, expect } from 'vitest';
import { SnapOptions, alignRect, keepOnStage, resizeRect, roundRect, snapMove, snapResize } from '../src/utils/studioGeometry';
import { pickSpot, spotAt, spotStyle } from '../src/utils/randomSpot';
import { clampRandomMargin, DEFAULT_ALERTS_SETTINGS } from '../src/types/alerts';

const W = 1920;
const H = 1080;
const base: SnapOptions = { stageW: W, stageH: H, others: [], layers: true, grid: 0, threshold: 12 };

describe('studio: imán al mover', () => {
  it('se pega a los bordes y al centro del lienzo', () => {
    const left = snapMove({ x: 7, y: 300, w: 400, h: 100 }, base);
    expect(left.x).toBe(0);
    expect(left.guidesV).toEqual([0]);
    expect(left.guidesH).toEqual([]);

    const center = snapMove({ x: 765, y: 495, w: 400, h: 100 }, base);
    expect([center.x, center.y]).toEqual([760, 490]);
    expect(center.guidesV).toEqual([960]);
    expect(center.guidesH).toEqual([540]);

    const right = snapMove({ x: 1528, y: 300, w: 400, h: 100 }, base);
    expect(right.x).toBe(1520);
    expect(right.guidesV).toEqual([1920]);
  });

  it('lejos de todo no se mueve', () => {
    const free = snapMove({ x: 233, y: 317, w: 400, h: 100 }, base);
    expect([free.x, free.y, free.guidesV, free.guidesH]).toEqual([233, 317, [], []]);
  });

  it('se pega a los bordes y centros de otras capas, si el imán está encendido', () => {
    const other = { x: 1000, y: 200, w: 300, h: 200 };
    const edge = snapMove({ x: 1305, y: 50, w: 100, h: 60 }, { ...base, others: [other] });
    expect(edge.x).toBe(1300);
    expect(edge.guidesV).toEqual([1300]);
    // Centro con centro
    const mid = snapMove({ x: 1104, y: 600, w: 100, h: 60 }, { ...base, others: [other] });
    expect(mid.x).toBe(1100);
    expect(mid.guidesV).toEqual([1150]);
    const off = snapMove({ x: 1305, y: 50, w: 100, h: 60 }, { ...base, others: [other], layers: false });
    expect(off.x).toBe(1305);
  });

  it('elige la línea más cercana y pinta todas las que coinciden', () => {
    const twin = snapMove({ x: 3, y: 100, w: 960, h: 60 }, base);
    expect(twin.x).toBe(0);
    expect(twin.guidesV).toEqual([0, 960]);
  });

  it('sin nada cerca cae en la cuadrícula; una guía manda sobre la cuadrícula', () => {
    const grid = snapMove({ x: 233, y: 317, w: 400, h: 100 }, { ...base, grid: 40 });
    expect([grid.x, grid.y]).toEqual([240, 320]);
    const guide = snapMove({ x: 7, y: 317, w: 400, h: 100 }, { ...base, grid: 40 });
    expect(guide.x).toBe(0);
  });

  it('con el umbral a cero no hay imán', () => {
    expect(snapMove({ x: 1, y: 1, w: 400, h: 100 }, { ...base, threshold: 0 }).x).toBe(1);
  });
});

describe('studio: cambio de tamaño', () => {
  const orig = { x: 100, y: 100, w: 400, h: 200 };

  it('cada tirador mueve solo sus bordes', () => {
    expect(resizeRect(orig, 'se', 50, 30, { min: 40 })).toEqual({ x: 100, y: 100, w: 450, h: 230 });
    expect(resizeRect(orig, 'nw', 50, 30, { min: 40 })).toEqual({ x: 150, y: 130, w: 350, h: 170 });
    expect(resizeRect(orig, 'e', 50, 999, { min: 40 })).toEqual({ x: 100, y: 100, w: 450, h: 200 });
    expect(resizeRect(orig, 'n', 999, -20, { min: 40 })).toEqual({ x: 100, y: 80, w: 400, h: 220 });
  });

  it('respeta el tamaño mínimo sin mover el borde contrario', () => {
    expect(resizeRect(orig, 'se', -900, -900, { min: 40 })).toEqual({ x: 100, y: 100, w: 40, h: 40 });
    const nw = resizeRect(orig, 'nw', 900, 900, { min: 40 });
    expect(nw).toEqual({ x: 460, y: 260, w: 40, h: 40 });
    expect([nw.x + nw.w, nw.y + nw.h]).toEqual([500, 300]);
  });

  it('con proporción fija, las esquinas escalan desde la esquina contraria', () => {
    const se = resizeRect(orig, 'se', 100, 0, { min: 40, keepRatio: true });
    expect(se).toEqual({ x: 100, y: 100, w: 500, h: 250 });
    const nw = resizeRect(orig, 'nw', -100, 0, { min: 40, keepRatio: true });
    expect(nw).toEqual({ x: 0, y: 50, w: 500, h: 250 });
    expect(nw.w / nw.h).toBe(2);
  });

  it('con proporción fija, un lado crece por igual hacia los dos lados del otro eje', () => {
    expect(resizeRect(orig, 'e', 100, 0, { min: 40, keepRatio: true })).toEqual({ x: 100, y: 75, w: 500, h: 250 });
    expect(resizeRect(orig, 's', 0, 100, { min: 40, keepRatio: true })).toEqual({ x: 0, y: 100, w: 600, h: 300 });
  });

  it('con proporción fija, el mínimo se aplica al lado corto', () => {
    const tiny = resizeRect(orig, 'se', -900, -900, { min: 40, keepRatio: true });
    expect(tiny).toEqual({ x: 100, y: 100, w: 80, h: 40 });
  });

  it('el imán al estirar solo pega los bordes que mueve el tirador', () => {
    const east = snapResize({ x: 100, y: 100, w: 857, h: 200 }, 'e', base, 40);
    expect([east.x, east.w, east.guidesV]).toEqual([100, 860, [960]]);
    const west = snapResize({ x: 5, y: 100, w: 400, h: 200 }, 'w', base, 40);
    expect([west.x, west.w]).toEqual([0, 405]);
    const south = snapResize({ x: 100, y: 800, w: 400, h: 276 }, 'se', base, 40);
    expect([south.h, south.guidesH]).toEqual([280, [1080]]);
    // El borde izquierdo está cerca de 0, pero el tirador «e» no lo mueve
    expect(snapResize({ x: 5, y: 100, w: 400, h: 200 }, 'e', base, 40).x).toBe(5);
  });

  it('el imán al estirar nunca deja la capa por debajo del mínimo', () => {
    const narrow = snapResize({ x: 930, y: 100, w: 42, h: 200 }, 'e', base, 40);
    expect(narrow.w).toBe(42);
  });
});

describe('studio: alineación y límites', () => {
  const rect = { x: 300, y: 300, w: 400, h: 200 };

  it('alinea con los bordes y el centro del lienzo', () => {
    expect(alignRect(rect, 'left', W, H).x).toBe(0);
    expect(alignRect(rect, 'hcenter', W, H).x).toBe(760);
    expect(alignRect(rect, 'right', W, H).x).toBe(1520);
    expect(alignRect(rect, 'top', W, H).y).toBe(0);
    expect(alignRect(rect, 'vmiddle', W, H).y).toBe(440);
    expect(alignRect(rect, 'bottom', W, H).y).toBe(880);
    expect(alignRect(rect, 'left', W, H).y).toBe(300);
  });

  it('una capa nunca se pierde fuera del lienzo', () => {
    expect(keepOnStage({ ...rect, x: -5000, y: 9000 }, W, H)).toEqual({ x: -376, y: 1056, w: 400, h: 200 });
    expect(keepOnStage(rect, W, H)).toEqual(rect);
  });

  it('redondea a píxeles enteros', () => {
    expect(roundRect({ x: 1.4, y: 2.5, w: 3.6, h: 4.49 })).toEqual({ x: 1, y: 3, w: 4, h: 4 });
  });
});

describe('avisos: posición aleatoria', () => {
  const bounds = { zoneW: 1000, zoneH: 600, itemW: 200, itemH: 100, margin: 50 };
  /** Fuente de azar que devuelve los valores dados, en orden y en bucle. */
  const seq = (values: number[]) => {
    let i = 0;
    return () => values[i++ % values.length];
  };
  const inside = (spot: { x: number; y: number }, b = bounds) =>
    spot.x >= b.margin && spot.y >= b.margin && spot.x + b.itemW <= b.zoneW - b.margin && spot.y + b.itemH <= b.zoneH - b.margin;

  it('el aviso cabe entero dentro de la zona y respeta el margen', () => {
    expect(spotAt(bounds, 0, 0)).toEqual({ x: 50, y: 50, u: 0, v: 0 });
    expect(spotAt(bounds, 1, 1)).toEqual({ x: 750, y: 450, u: 1, v: 1 });
    expect(spotAt(bounds, 5, -3)).toEqual({ x: 750, y: 50, u: 1, v: 0 });
    for (let i = 0; i <= 10; i += 1) {
      for (let j = 0; j <= 10; j += 1) expect(inside(pickSpot(bounds, null, seq([i / 10, j / 10])))).toBe(true);
    }
  });

  it('usa la fuente de azar que se le inyecta', () => {
    expect(pickSpot(bounds, null, seq([0.5, 0.25]))).toEqual({ x: 400, y: 150, u: 0.5, v: 0.25 });
  });

  it('nunca repite el sitio anterior, aunque el azar insista', () => {
    const stuck = seq([0.5, 0.5]);
    const first = pickSpot(bounds, null, stuck);
    const second = pickSpot(bounds, first, stuck);
    expect([second.x, second.y]).not.toEqual([first.x, first.y]);
    expect(inside(second)).toBe(true);
    const third = pickSpot(bounds, second, stuck);
    expect([third.x, third.y]).not.toEqual([second.x, second.y]);
  });

  it('descarta los puntos demasiado cercanos al anterior y se queda con el primero que se aleja', () => {
    const last = spotAt(bounds, 0.5, 0.5);
    const next = pickSpot(bounds, last, seq([0.52, 0.5, 0.9, 0.1]));
    expect([next.u, next.v]).toEqual([0.9, 0.1]);
  });

  it('en una larga serie nunca salen dos seguidos iguales', () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    let last = pickSpot(bounds, null, random);
    for (let i = 0; i < 300; i += 1) {
      const next = pickSpot(bounds, last, random);
      expect(inside(next)).toBe(true);
      expect(next.x === last.x && next.y === last.y).toBe(false);
      last = next;
    }
  });

  it('si el aviso no cabe en un eje, queda centrado en él; sin recorrido solo hay un punto', () => {
    const tall = { zoneW: 1000, zoneH: 100, itemW: 200, itemH: 100, margin: 0 };
    const spot = pickSpot(tall, null, seq([1, 0.9]));
    expect([spot.x, spot.y, spot.v]).toEqual([800, 0, 0.5]);
    const exact = { zoneW: 200, zoneH: 100, itemW: 200, itemH: 100 };
    const only = pickSpot(exact, null, seq([0.3]));
    expect(pickSpot(exact, only, seq([0.9]))).toEqual({ x: 0, y: 0, u: 0.5, v: 0.5 });
    // Aviso más grande que la zona con margen: centrado, sin salirse por un solo lado
    expect(spotAt({ zoneW: 300, zoneH: 300, itemW: 280, itemH: 100, margin: 40 }, 0.9, 0)).toMatchObject({ x: 10, u: 0.5 });
  });

  it('el estilo CSS coloca el aviso sin medirlo y acota el margen', () => {
    expect(spotStyle({ u: 0, v: 1 }, 6)).toEqual({
      position: 'absolute',
      left: 'calc(6% + 0.0000 * (100% - 12%))',
      top: 'calc(6% + 1.0000 * (100% - 12%))',
      transform: 'translate(0.00%, -100.00%)',
    });
    expect(spotStyle({ u: 0.5, v: 0.5 }, 90).left).toBe('calc(40% + 0.5000 * (100% - 80%))');
  });

  it('en la página de alertas viene apagada y el margen se acota', () => {
    expect(DEFAULT_ALERTS_SETTINGS.randomPosition).toBe(false);
    expect(DEFAULT_ALERTS_SETTINGS.randomMargin).toBe(6);
    expect(clampRandomMargin(99)).toBe(20);
    expect(clampRandomMargin(-3)).toBe(0);
    expect(clampRandomMargin('x')).toBe(6);
  });
});
