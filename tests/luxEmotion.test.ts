/**
 * tests/luxEmotion.test.ts
 *
 * Etiqueta de emoción de Lux y voz elegida: que la emoción se separe del texto,
 * que una etiqueta rara no rompa la respuesta, y que la voz se valide.
 */

import { describe, expect, it } from 'vitest';
import { EMOTION_INSTRUCTION, LUX_EMOTIONS, parseEmotion } from '../server/lux/emotion';
import { normalizeLuxSettings } from '../server/lux/settings';

describe('emociones', () => {
  it('quita la etiqueta final y devuelve la emoción', () => {
    expect(parseEmotion('¡Qué bien! [feliz]')).toEqual({ text: '¡Qué bien!', emotion: 'feliz' });
  });

  it('una etiqueta desconocida se quita y la emoción es normal', () => {
    expect(parseEmotion('Hola [aburrida]')).toEqual({ text: 'Hola', emotion: 'normal' });
  });

  it('sin etiqueta, el texto sale igual y la emoción es normal', () => {
    expect(parseEmotion('Hola a todos')).toEqual({ text: 'Hola a todos', emotion: 'normal' });
  });

  it('la etiqueta cuenta en cualquier posición y no queda en el texto', () => {
    expect(parseEmotion('[triste] no sé qué decir')).toEqual({ text: 'no sé qué decir', emotion: 'triste' });
    expect(parseEmotion('Pues [sorprendida] no lo esperaba')).toEqual({ text: 'Pues no lo esperaba', emotion: 'sorprendida' });
  });

  it('entiende masculino, mayúsculas, tildes y sinónimos', () => {
    expect(parseEmotion('Ya basta [molesto]').emotion).toBe('molesta');
    expect(parseEmotion('Hola [Feliz]').emotion).toBe('feliz');
    expect(parseEmotion('Mmm [mágica]').emotion).toBe('magica');
    expect(parseEmotion('Wow [sorprendido]').emotion).toBe('sorprendida');
    expect(parseEmotion('La la la [canta]').emotion).toBe('alegre');
    expect(parseEmotion('Grr [enojado]').emotion).toBe('molesta');
  });

  it('con varias etiquetas manda la última reconocida y todas se quitan', () => {
    expect(parseEmotion('[feliz] Hola [canta] a todos [molesto]')).toEqual({ text: 'Hola a todos', emotion: 'molesta' });
  });

  it('sin etiqueta intuye por risas y emojis', () => {
    expect(parseEmotion('jajaja qué bueno').emotion).toBe('alegre');
    expect(parseEmotion('me da pena 😢').emotion).toBe('triste');
  });

  it('el prompt pide palabras exactas con una pista de cuándo usar cada una', () => {
    expect(EMOTION_INSTRUCTION).toContain('molesta (');
    expect(EMOTION_INSTRUCTION).toContain('femenino');
  });

  it('los ids coinciden con las diez expresiones del personaje', () => {
    expect(LUX_EMOTIONS).toHaveLength(10);
    expect(LUX_EMOTIONS).toContain('sorprendida');
  });
});

describe('voz de Lux', () => {
  it('acepta una voz del catálogo con su motor', () => {
    const check = normalizeLuxSettings({ voiceReferenceId: 'abc_123', voiceEngine: 'fish' });
    expect(check.ok && check.value.voiceReferenceId).toBe('abc_123');
    expect(check.ok && check.value.voiceEngine).toBe('fish');
  });

  it('una voz sin motor, o un motor desconocido, se rechaza', () => {
    expect(normalizeLuxSettings({ voiceReferenceId: 'abc', voiceEngine: 'otro' })).toMatchObject({ ok: false, field: 'voiceEngine' });
    expect(normalizeLuxSettings({ voiceReferenceId: 'abc' })).toMatchObject({ ok: false, field: 'voiceEngine' });
  });

  it('un id con caracteres raros se rechaza', () => {
    expect(normalizeLuxSettings({ voiceReferenceId: '../../x', voiceEngine: 'fish' })).toMatchObject({ ok: false, field: 'voiceReferenceId' });
  });

  it('volver a la voz por defecto limpia las dos columnas', () => {
    const check = normalizeLuxSettings({ voiceReferenceId: null });
    expect(check.ok && check.value.voiceReferenceId).toBeNull();
    expect(check.ok && check.value.voiceEngine).toBeNull();
  });
});
