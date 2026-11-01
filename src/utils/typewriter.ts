/**
 * typewriter.ts
 *
 * Ritmo de la máquina de escribir del estilo Diálogo. Cada unidad (un carácter,
 * o una etiqueta [expresión] entera) pesa más si cierra una frase o una coma,
 * así el texto hace pausas como al leerse en voz alta. Lógica pura, sin DOM.
 */

/** Peso de una unidad: 1 normal, +4 tras coma o punto y coma, +7 tras punto o cierre de pregunta. */
export function typeWeight(unit: string): number {
  if (unit.length > 1) return 3; // una etiqueta [expresión] es una sola unidad
  return 1 + (/[,;:]/.test(unit) ? 4 : 0) + (/[.!?]/.test(unit) ? 7 : 0);
}

export interface TypeSchedule {
  starts: number[]; // segundo (desde 0) en que aparece cada unidad
  end: number; // segundo en que termina de escribirse la última
}

/** Reparte `span` segundos entre las unidades según su peso. */
export function typeSchedule(units: string[], span: number): TypeSchedule {
  const weights = units.map(typeWeight);
  const sum = weights.reduce((a, b) => a + b, 0);
  const unit = sum > 0 ? Math.max(0.01, span / sum) : 0;
  const starts: number[] = [];
  let at = 0;
  weights.forEach((w) => {
    starts.push(at);
    at += w * unit;
  });
  return { starts, end: at };
}
