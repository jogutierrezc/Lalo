/**
 * tests/luxIntent.test.ts
 *
 * Intención social del mensaje (insulto, agradecimiento, cumplido, pregunta) y
 * que llega al modelo y al overlay.
 */

import { describe, expect, it } from 'vitest';
import { INTENT_GESTURE, detectIntent, intentGuidance } from '../server/lux/intent';
import { buildLuxMessages } from '../server/lux/prompt';

describe('detectIntent', () => {
  it.each([
    ['eres una idiota', 'insulto'],
    ['cállate ya', 'insulto'],
    ['you are useless', 'insulto'],
    ['gracias por el directo', 'agradecimiento'],
    ['thank you so much', 'agradecimiento'],
    ['obrigada pelo stream', 'agradecimiento'],
    ['qué guapa eres', 'cumplido'],
    ['eres la mejor, te quiero', 'cumplido'],
    ['you are awesome', 'cumplido'],
    ['¿qué juego estás jugando?', 'pregunta'],
    ['hola a todos', 'neutro'],
    ['', 'neutro'],
  ])('"%s" → %s', (message, expected) => {
    expect(detectIntent(message)).toBe(expected);
  });

  it('un insulto con gracias en la misma frase gana el insulto', () => {
    expect(detectIntent('gracias, pero eres una idiota')).toBe('insulto');
  });

  it('cada intención tiene un gesto y las neutras no piden instrucción extra', () => {
    expect(INTENT_GESTURE.insulto).toBe('shrug');
    expect(INTENT_GESTURE.agradecimiento).toBe('bow');
    expect(INTENT_GESTURE.cumplido).toBe('pride');
    expect(intentGuidance('neutro')).toBe('');
    expect(intentGuidance('insulto')).toContain('sin insultar');
  });

  it('la intención llega al mensaje del sistema del modelo', () => {
    const messages = buildLuxMessages({ viewer: 'vale', message: 'gracias', memories: [], intent: 'agradecimiento' });
    expect(String(messages[0].content)).toContain('agradeciendo');
  });
});
