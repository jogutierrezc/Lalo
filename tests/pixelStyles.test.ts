/**
 * tests/pixelStyles.test.ts
 *
 * Estilos pixel (Arcade, Aventura, Diálogo): ritmo de la máquina de escribir y
 * conversión de sprites en rectángulos.
 */

import { describe, it, expect } from 'vitest';
import { typeWeight, typeSchedule } from '../src/utils/typewriter';
import { spriteRects, spriteSize, INV_A } from '../src/utils/pixelSprites';

describe('typewriter', () => {
  it('pesa más las pausas de coma y de punto', () => {
    expect(typeWeight('a')).toBe(1);
    expect(typeWeight(',')).toBe(5);
    expect(typeWeight('.')).toBe(8);
    expect(typeWeight('?')).toBe(8);
    expect(typeWeight('[risa]')).toBe(3);
  });

  it('reparte el tiempo en orden y termina dentro del margen', () => {
    const { starts, end } = typeSchedule(['h', 'o', ',', ' ', 'y', '.'], 3);
    expect(starts[0]).toBe(0);
    starts.slice(1).forEach((s, i) => expect(s).toBeGreaterThan(starts[i]));
    expect(end).toBeCloseTo(3, 5);
    // la unidad que sigue a la coma tarda más que la que sigue a una letra
    expect(starts[3] - starts[2]).toBeGreaterThan(starts[2] - starts[1]);
  });

  it('no falla sin unidades', () => {
    expect(typeSchedule([], 2)).toEqual({ starts: [], end: 0 });
  });
});

describe('pixelSprites', () => {
  it('fusiona los píxeles contiguos de cada fila', () => {
    const rects = spriteRects(['##.#', '..aa'], { '#': 'red', a: 'blue' });
    expect(rects).toEqual([
      { x: 0, y: 0, w: 2, h: 1, fill: 'red' },
      { x: 3, y: 0, w: 1, h: 1, fill: 'red' },
      { x: 2, y: 1, w: 2, h: 1, fill: 'blue' },
    ]);
  });

  it('mide la cuadrícula del invasor', () => {
    expect(spriteSize(INV_A)).toEqual({ w: 11, h: 8 });
  });
});
