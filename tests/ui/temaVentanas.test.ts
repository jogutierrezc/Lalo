/**
 * Tema de las ventanas internas: dentro de una ventana las páginas usan siempre
 * el tema Tally oscuro, aunque el panel esté en Claro o en Twitch.
 *
 * Es una prueba de lectura del CSS (no hay navegador): comprueba que el bloque
 * existe, que está acotado a la ventana, que remapea todos los tokens que usan
 * las clases cab-* y que ninguno apunta a un valor claro o negro.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/styles/shell.css', 'utf8');
const start = css.indexOf('Tema de las ventanas internas');
const block = css.slice(start);
const rule = (selector: string) => {
  const at = block.indexOf(selector);
  if (at < 0) return '';
  return block.slice(block.indexOf('{', at) + 1, block.indexOf('}', at));
};

describe('tema de las ventanas', () => {
  const tokens = rule('html body.tally .tally-win[data-win].cab,');

  it('el bloque existe y se limita a la ventana', () => {
    expect(start).toBeGreaterThan(0);
    expect(block).toContain('html body.tally .tally-win[data-win] .cab');
    // Gana al tema Claro y al Twitch del panel (body.tally[data-panel-theme] .cab = 4 clases + 1 etiqueta)
    expect(block).toContain('html body.tally .tally-win[data-win].cab');
  });

  it('remapea los tokens --cb-*, --acc y --ui al Tally oscuro', () => {
    for (const token of ['--acc', '--acc-ink', '--ui', '--ui-ink', '--cb-bg', '--cb-panel', '--cb-surface', '--cb-line', '--cb-fg', '--cb-mut', '--cb-off', '--cb-live', '--cb-warn', '--cb-warn-bg', '--cb-ok', '--cb-ok-bg', '--cb-bad', '--cb-bad-bg']) {
      expect(tokens, token).toContain(`${token}:`);
    }
    expect(tokens).toContain('--cb-fg: var(--tally-white)');
    expect(tokens).toContain('--cb-panel: var(--tally-onyx)');
    expect(tokens).toContain('--ui: var(--tally-red)');
    expect(tokens).toContain('color-scheme: dark');
  });

  it('el texto es claro sobre onyx: ningún token apunta a un blanco de fondo ni a un negro', () => {
    expect(tokens).not.toMatch(/--cb-fg:\s*(var\(--tally-dark\)|#0|#1|black)/i);
    expect(tokens).not.toMatch(/--cb-(bg|panel|surface):\s*(#fff|#f|white|var\(--tally-white\))/i);
  });

  it('la acción principal es roja y el botón de Twitch conserva su morado también con el tema Twitch', () => {
    expect(rule('html body.tally .tally-win[data-win] .cab-btn:not(.acc-twitch)')).toContain('background: var(--tally-red)');
    expect(rule('html body.tally .tally-win[data-win] .acc-twitch')).toContain('#9146ff');
  });

  it('el error de las ventanas es un trazo discontinuo, no rojo sólido', () => {
    expect(rule('html body.tally .tally-win[data-win] .cab-btn-danger')).toContain('1px dashed');
  });
});
