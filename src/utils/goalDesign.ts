/**
 * src/utils/goalDesign.ts
 *
 * Reglas puras de los diseños de metas: qué diseños hay, cómo se migran los
 * estilos antiguos, cuántos bloques se encienden, qué tinta se lee sobre el
 * color de avance, dónde se coloca cada pieza y qué valor toca el siguiente hito.
 * Sin React ni DOM, para poder probarlo.
 */

/** Las cinco formas de partida y la personalizada. */
export type GoalStyle = 'barra' | 'anillo' | 'bloques' | 'cinta' | 'columna' | 'custom';
/** Formas que se pintan de verdad. */
export type GoalShape = 'barra' | 'anillo' | 'bloques' | 'cinta' | 'columna';
/** Formas que admite el diseño personalizado: la cinta no, porque ocupa el borde entero. */
export type GoalCustomShape = 'barra' | 'anillo' | 'bloques' | 'columna';
export type GoalFontId = 'archivo' | 'onest' | 'bricolage' | 'mono';
/** Arriba o abajo, y a la izquierda, al centro o a la derecha. */
export type GoalsPosition = 'tl' | 'tc' | 'tr' | 'bl' | 'bc' | 'br';

export interface GoalCustom {
  shape: GoalCustomShape;
  background: string;
  text: string;
  font: GoalFontId;
  /** Tamaño en porcentaje, de 70 a 150. */
  size: number;
  /** Redondeo en décimas de em, de 0 a 14. */
  radius: number;
  showTitle: boolean;
  /** Muestra «/meta unidad» junto a la cifra. */
  showTarget: boolean;
}

export const GOAL_DESIGNS: { id: GoalStyle; name: string; hint: string }[] = [
  { id: 'barra', name: 'Barra', hint: 'La clásica, ancha y con marcas en los hitos. El aporte hace brillar la punta.' },
  { id: 'anillo', name: 'Anillo', hint: 'Compacta, para una esquina. El anillo se cierra y el porcentaje va en el centro.' },
  { id: 'bloques', name: 'Bloques', hint: 'Doce bloques que se encienden uno a uno, como un marcador.' },
  { id: 'cinta', name: 'Cinta', hint: 'Una franja de lado a lado en el borde de la pantalla. Ocupa lo mínimo en altura.' },
  { id: 'columna', name: 'Columna', hint: 'Vertical, para pegarla a un lateral. Se llena de abajo arriba.' },
  { id: 'custom', name: 'Personalizado', hint: 'Eliges la forma y cambias colores, tipografía, tamaño, redondeo y qué se muestra.' },
];

export const GOAL_CUSTOM_SHAPES: { id: GoalCustomShape; name: string }[] = [
  { id: 'barra', name: 'Barra' },
  { id: 'anillo', name: 'Anillo' },
  { id: 'bloques', name: 'Bloques' },
  { id: 'columna', name: 'Columna' },
];

export const GOAL_FONTS: { id: GoalFontId; name: string; stack: string }[] = [
  { id: 'archivo', name: 'Archivo condensada', stack: "'Archivo', 'Arial Narrow', system-ui, sans-serif" },
  { id: 'onest', name: 'Onest', stack: "'Onest', system-ui, sans-serif" },
  { id: 'bricolage', name: 'Bricolage', stack: "'Bricolage Grotesque', 'Trebuchet MS', system-ui, sans-serif" },
  { id: 'mono', name: 'JetBrains Mono', stack: "'JetBrains Mono', ui-monospace, Consolas, monospace" },
];

export const GOAL_POSITIONS: { id: GoalsPosition; name: string }[] = [
  { id: 'tl', name: 'Arriba a la izquierda' },
  { id: 'tc', name: 'Arriba al centro' },
  { id: 'tr', name: 'Arriba a la derecha' },
  { id: 'bl', name: 'Abajo a la izquierda' },
  { id: 'bc', name: 'Abajo al centro' },
  { id: 'br', name: 'Abajo a la derecha' },
];

export const DEFAULT_GOALS_POSITION: GoalsPosition = 'tc';
export const GOAL_BLOCKS = 12;
export const GOAL_SIZE_MIN = 70;
export const GOAL_SIZE_MAX = 150;
export const GOAL_RADIUS_MAX = 14;

export const DEFAULT_GOAL_CUSTOM: GoalCustom = {
  shape: 'barra',
  background: '#1b1c1f',
  text: '#efe9dc',
  font: 'archivo',
  size: 100,
  radius: 2,
  showTitle: true,
  showTarget: true,
};

const HEX = /^#[0-9a-f]{6}$/i;
const hexOr = (value: unknown, fallback: string) => (typeof value === 'string' && HEX.test(value) ? value : fallback);
const numberIn = (value: unknown, min: number, max: number, fallback: number) => {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

/**
 * Los estilos antiguos (cabina, neón, cyber, minimal) solo cambiaban colores:
 * todos pasan a Barra. Cualquier valor desconocido también.
 */
export function migrateGoalStyle(style: unknown): GoalStyle {
  return GOAL_DESIGNS.some((design) => design.id === style) ? (style as GoalStyle) : 'barra';
}

export function normalizeGoalsPosition(position: unknown): GoalsPosition {
  return GOAL_POSITIONS.some((entry) => entry.id === position) ? (position as GoalsPosition) : DEFAULT_GOALS_POSITION;
}

export function normalizeGoalCustom(raw: unknown): GoalCustom {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof GoalCustom, unknown>>;
  return {
    shape: GOAL_CUSTOM_SHAPES.some((entry) => entry.id === value.shape)
      ? (value.shape as GoalCustomShape)
      : DEFAULT_GOAL_CUSTOM.shape,
    background: hexOr(value.background, DEFAULT_GOAL_CUSTOM.background),
    text: hexOr(value.text, DEFAULT_GOAL_CUSTOM.text),
    font: GOAL_FONTS.some((entry) => entry.id === value.font) ? (value.font as GoalFontId) : DEFAULT_GOAL_CUSTOM.font,
    size: numberIn(value.size, GOAL_SIZE_MIN, GOAL_SIZE_MAX, DEFAULT_GOAL_CUSTOM.size),
    radius: numberIn(value.radius, 0, GOAL_RADIUS_MAX, DEFAULT_GOAL_CUSTOM.radius),
    showTitle: value.showTitle !== false,
    showTarget: value.showTarget !== false,
  };
}

/**
 * Pone al día una meta guardada: estilo antiguo a Barra, conservando su color
 * y todo lo demás. Solo añade `custom` cuando la meta lo usa o ya lo traía.
 */
export function migrateGoalItem<T extends { style?: unknown; custom?: unknown }>(
  goal: T
): Omit<T, 'style' | 'custom'> & { style: GoalStyle; custom?: GoalCustom } {
  const style = migrateGoalStyle(goal.style);
  const { custom, style: _old, ...rest } = goal;
  void _old;
  const keepCustom = style === 'custom' || custom !== undefined;
  const next: Omit<T, 'style' | 'custom'> = rest;
  return keepCustom ? { ...next, style, custom: normalizeGoalCustom(custom) } : { ...next, style };
}

/** La forma que se pinta: la del diseño, o la elegida en el personalizado. */
export function goalShape(style: GoalStyle, custom?: GoalCustom): GoalShape {
  if (style !== 'custom') return style;
  return custom?.shape ?? DEFAULT_GOAL_CUSTOM.shape;
}

export function goalFontStack(font: GoalFontId): string {
  return (GOAL_FONTS.find((entry) => entry.id === font) || GOAL_FONTS[0]).stack;
}

/**
 * Bloques encendidos para un porcentaje (0 a 100). El último solo se enciende
 * con la meta cumplida, y con cualquier avance hay al menos uno.
 */
export function blocksLit(percent: number, total: number = GOAL_BLOCKS): number {
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  if (percent >= 100) return total;
  return Math.min(total - 1, Math.max(1, Math.round((percent / 100) * total)));
}

/** Tinta que se lee sobre un color: oscura sobre colores claros, blanca sobre el resto. */
export function inkOn(hex: string): string {
  if (!HEX.test(hex)) return '#ffffff';
  const n = parseInt(hex.slice(1), 16);
  const luminance = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return luminance > 0.55 ? '#1b1c1f' : '#ffffff';
}

/** Mezcla dos colores hexadecimales: 0 deja el primero, 1 el segundo. */
export function mixHex(from: string, to: string, amount: number): string {
  if (!HEX.test(from) || !HEX.test(to)) return from;
  const t = Math.min(1, Math.max(0, amount));
  const a = parseInt(from.slice(1), 16);
  const b = parseInt(to.slice(1), 16);
  const channel = (shift: number) => {
    const value = Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
    return value.toString(16).padStart(2, '0');
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

/**
 * Valor al que hay que llegar para tocar el siguiente hito (25, 50, 75 o 100 %).
 * Con la meta cumplida devuelve el objetivo.
 */
export function nextMilestoneValue(current: number, target: number): number {
  if (target <= 0) return current;
  const ratio = current / target;
  const next = [0.25, 0.5, 0.75, 1].find((mark) => mark > ratio + 1e-9) ?? 1;
  return Math.max(current, Math.ceil(next * target - 1e-9));
}

/** Borde que ocupa la Cinta: siempre el ancho entero, arriba o abajo. */
export function cintaEdge(position: GoalsPosition): 't' | 'b' {
  return position[0] === 'b' ? 'b' : 't';
}

/**
 * Cómo se reparten varias piezas (sin contar las cintas): en fila o apiladas.
 * - Al centro van en fila.
 * - En un lateral se apilan, salvo que haya alguna Columna: son altas y solo
 *   caben una al lado de otra.
 */
export function goalsFlow(position: GoalsPosition, shapes: GoalShape[]): 'fila' | 'pila' {
  if (shapes.includes('columna')) return 'fila';
  return position[1] === 'c' ? 'fila' : 'pila';
}

/** Parámetros de muestra de la capa: `demo=1`, `design`, `pos` y `n` (1 a 5 metas). */
export interface GoalsDemo {
  design: GoalStyle | null;
  position: GoalsPosition | null;
  count: number;
  done: boolean;
}

export function parseGoalsDemo(params: URLSearchParams): GoalsDemo | null {
  if (params.get('demo') !== '1') return null;
  const design = params.get('design');
  const position = params.get('pos');
  return {
    design: GOAL_DESIGNS.some((entry) => entry.id === design) ? (design as GoalStyle) : null,
    position: GOAL_POSITIONS.some((entry) => entry.id === position) ? (position as GoalsPosition) : null,
    count: numberIn(params.get('n'), 1, 5, 1),
    done: params.get('done') === '1',
  };
}
