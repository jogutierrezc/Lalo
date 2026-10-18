/**
 * tests/luxEmotion.test.ts
 *
 * Etiqueta de emoción de Lux y voz elegida: que la emoción se separe del texto,
 * que una etiqueta rara no rompa la respuesta, y que la voz se valide.
 */

import { describe, expect, it } from 'vitest';
import { LUX_EMOTIONS, parseEmotion } from '../server/lux/emotion';
import { normalizeLuxSettings } from '../server/lux/settings';

describe('emociones', () => {
  it('quita la etiqueta final y devuelve la emoción', () => {
    expect(parseEmotion('¡Qué bien! [feliz]')).toEqual({ text: '¡Qué bien!', emotion: 'feliz' });
  });

  it('una etiqueta desconocida se ignora y la emoción es normal', () => {
    expect(parseEmotion('Hola [aburrida]')).toEqual({ text: 'Hola', emotion: 'normal' });
  });

  it('sin etiqueta, el texto sale igual y la emoción es normal', () => {
    expect(parseEmotion('Hola a todos')).toEqual({ text: 'Hola a todos', emotion: 'normal' });
  });

  it('la etiqueta solo cuenta al final del texto', () => {
    expect(parseEmotion('[triste] no sé qué decir')).toEqual({ text: '[triste] no sé qué decir', emotion: 'normal' });
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
