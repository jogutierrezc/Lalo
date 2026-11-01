/**
 * pixelSprites.ts
 *
 * Sprites y escenarios de los estilos pixel (Arcade, Aventura y Diálogo). Cada
 * sprite es una cuadrícula de caracteres; spriteRects la convierte en
 * rectángulos SVG fusionando los píxeles contiguos de cada fila. Todo es datos
 * puros: AlertCard los pinta y no hay nada aleatorio (los generadores usan una
 * semilla fija para que el paisaje sea siempre el mismo).
 */

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
}

export type PixelPalette = Record<string, string>;

/** Convierte una cuadrícula de caracteres en rectángulos, fusionando filas. '.' y ' ' son vacío. */
export function spriteRects(rows: string[], palette: PixelPalette): PixelRect[] {
  const rects: PixelRect[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x];
      if (c === '.' || c === ' ' || !palette[c]) {
        x++;
        continue;
      }
      let end = x;
      while (end < row.length && row[end] === c) end++;
      rects.push({ x, y, w: end - x, h: 1, fill: palette[c] });
      x = end;
    }
  });
  return rects;
}

/** Ancho y alto en píxeles de una cuadrícula. */
export function spriteSize(rows: string[]): { w: number; h: number } {
  return { w: rows.reduce((max, row) => Math.max(max, row.length), 0), h: rows.length };
}

/** Generador pseudoaleatorio con semilla (mismo resultado siempre). */
export function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

// ---------- Arcade ----------
export const INV_A = ['..#.....#..', '...#...#...', '..#######..', '.##w###w##.', '###########', '#.#######.#', '#.#.....#.#', '...##.##...'];
export const INV_B = ['..#.....#..', '#..#...#..#', '#.#######.#', '###w###w###', '###########', '.#########.', '..#.....#..', '.#.......#.'];
export const STAR = ['.....#.....', '.....#.....', '....#h#....', '###########', '.#########.', '..#######..', '...#####...', '..#######..', '..###.###..', '.###...###.', '.##.....##.'];

// ---------- Aventura ----------
export const GEM = ['.ooooo.', 'oggwgdo', '.ogggo.', '..ogo..', '...o...'];
export const HERO_A = ['..ooooo..', '.occccco.', '.ocwkwco.', '.occccco.', '..ooooo..', '.obbbbbo.', 'obbbbbbbo', '.obbbbbo.', '.obo.obo.', '.ooo.ooo.'];
export const HERO_B = ['..ooooo..', '.occccco.', '.ocwkwco.', '.occccco.', '..ooooo..', '.obbbbbo.', 'obbbbbbbo', '.obbbbbo.', '..ob.bo..', '..oo.oo..'];
export const PINE = ['....#....', '...###...', '...###...', '..#####..', '..#####..', '.#######.', '.#######.', '#########', '....#....', '....#....'];

// ---------- Diálogo ----------
export const ROBOT_C = ['......##......', '......##......', '..##########..', '.#ffffffffff#.', '.#fwwffffwwf#.', '.#fwkffffkwf#.', '.#ffffffffff#.', '##ffffffffff##', '.#ffffffffff#.', '.#ffMMMMMMff#.', '..##########..'];
export const ROBOT_O = ['......##......', '......##......', '..##########..', '.#ffffffffff#.', '.#fwwffffwwf#.', '.#fwkffffkwf#.', '.#ffffffffff#.', '##ffffffffff##', '.#ffMMMMMMff#.', '.#ffMMMMMMff#.', '..##########..'];
export const ARROW = ['#######', '.#####.', '..###..', '...#...'];

// ---------- Paletas ----------
// 'var(--acc)' se resuelve en el navegador: por eso el relleno va en style, no como atributo.
export const PAL_INVADER: PixelPalette = { '#': 'var(--acc)', w: '#fff' };
export const PAL_STAR: PixelPalette = { '#': '#2fb0ff', h: '#d6f1ff' };
export const PAL_GEM: PixelPalette = { o: '#fff', g: '#5de6e0', d: '#1fa5b5', w: '#d9fffb' };
export const PAL_HERO: PixelPalette = { o: '#fff', c: '#c6f38a', w: '#fff', k: '#12301f', b: '#2f9a8f' };
export const PAL_ROBOT: PixelPalette = { '#': '#fff', f: 'var(--acc)', w: '#fff', k: '#14142b', M: '#14142b' };
export const PAL_ARROW: PixelPalette = { '#': '#fff' };

// ---------- Escenarios (medidas en píxeles del diseño original) ----------

/** Fracciones del recorrido del héroe en las que se recoge cada gema. */
export const GEM_STOPS = [0.15, 0.33, 0.67, 0.85];

export const SKYLINE_W = 448;
export const SKYLINE_H = 36;
export const SCENE_W = 560;

/** Ciudad del fondo de la barra de Arcade. */
export function skylineRects(): PixelRect[] {
  const rnd = seeded(7);
  const rects: PixelRect[] = [];
  let x = 0;
  while (x < SKYLINE_W) {
    const w = 12 + Math.floor(rnd() * 3) * 6;
    const h = [6, 12, 18, 24, 30][Math.floor(rnd() * 5)];
    rects.push({ x, y: SKYLINE_H - h, w, h, fill: '#2b2b2e' });
    if (h > 12 && rnd() > 0.5) rects.push({ x: x + 4, y: SKYLINE_H - h + 4, w: 4, h: 4, fill: '#3b3b40' });
    x += w + 2;
  }
  return rects;
}

/** Colinas escalonadas de ancho w y alto h, con columnas de q píxeles. */
export function hillsRects(w: number, h: number, q: number, fn: (x: number) => number, fill: string): PixelRect[] {
  const rects: PixelRect[] = [];
  for (let x = 0; x < w; x += q) {
    const ht = Math.round(fn(x) / q) * q;
    rects.push({ x, y: h - ht, w: q, h: ht, fill });
  }
  return rects;
}

export const HILLS_FAR = { w: SCENE_W, h: 70, rects: hillsRects(SCENE_W, 70, 6, (x) => 44 + 16 * Math.sin(x / 90 + 2), '#1d4a52') };
export const HILLS_NEAR = { w: SCENE_W, h: 46, rects: hillsRects(SCENE_W, 46, 6, (x) => 24 + 14 * Math.sin(x / 60) + 6 * Math.sin(x / 21), '#2f6d5c') };

/** Pinos del bosque: cada píxel del sprite se amplía a 4x4. */
export function pineRects(): PixelRect[] {
  const rnd = seeded(11);
  const rects: PixelRect[] = [];
  let x = 14;
  while (x < 540) {
    const fill = rnd() > 0.5 ? '#14505a' : '#0f3a46';
    const dy = rnd() > 0.7 ? 8 : 0;
    spriteRects(PINE, { '#': fill }).forEach((r) => rects.push({ x: x + r.x * 4, y: dy + r.y * 4, w: r.w * 4, h: r.h * 4, fill }));
    x += 30 + Math.floor(rnd() * 5) * 12;
  }
  return rects;
}
export const PINES = { w: SCENE_W, h: 48, rects: pineRects() };

/** Suelo de la pantalla de aventura. */
export function groundRects(): PixelRect[] {
  const rects: PixelRect[] = [
    { x: 0, y: 0, w: SCENE_W, h: 24, fill: '#1c6e74' },
    { x: 0, y: 0, w: SCENE_W, h: 6, fill: '#3fd0b4' },
    { x: 0, y: 6, w: SCENE_W, h: 3, fill: '#2aa49a' },
  ];
  for (let x = 0; x < SCENE_W; x += 24) {
    rects.push({ x, y: 9, w: 3, h: 15, fill: '#145057' });
    rects.push({ x: x + 9, y: 15, w: 3, h: 3, fill: '#2a8a8c' });
  }
  return rects;
}
export const GROUND = { w: SCENE_W, h: 24, rects: groundRects() };

export interface SkyStar {
  left: number; // % del ancho
  top: number; // % del alto
  small: boolean;
}

/** Estrellas del cielo de Aventura. */
export function skyStars(): SkyStar[] {
  const rnd = seeded(5);
  const stars: SkyStar[] = [];
  for (let i = 0; i < 26; i++) {
    const small = rnd() > 0.55;
    stars.push({ left: Math.floor(rnd() * 98), top: Math.floor(rnd() * 96), small });
  }
  return stars;
}
