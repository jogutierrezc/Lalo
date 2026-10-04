/**
 * tests/vozLogic.test.ts
 *
 * Lógica pura de «Voz del chat»: el mensaje de prueba con su emoción y el aviso
 * de que la URL de OBS cambió desde la última copia.
 */

import { describe, it, expect } from 'vitest';
import { stripCommandAndEmotion, urlChangedSinceCopy, withEmotion } from '../src/components/voz/vozLogic';
import { buildSuiteWidgetUrl } from '../src/utils/widgetUrl';
import { DEFAULT_SETTINGS } from '../src/types/settings';

describe('mensaje de prueba', () => {
  it('quita el comando y la etiqueta de emoción del principio', () => {
    expect(stripCommandAndEmotion('!s [feliz] hola chat')).toBe('hola chat');
    expect(stripCommandAndEmotion('[triste] adiós')).toBe('adiós');
    expect(stripCommandAndEmotion('  !s   hola')).toBe('hola');
  });

  it('cambia la emoción y conserva lo escrito', () => {
    expect(withEmotion('!s [feliz] hola chat', { tag: 'sad', example: '[triste]' })).toBe('!s [triste] hola chat');
  });

  it('sin emoción deja solo el comando y el texto', () => {
    expect(withEmotion('!s [feliz] hola chat', null)).toBe('!s hola chat');
  });

  it('con el mensaje vacío pone uno de ejemplo, y una canción si la emoción es cantar', () => {
    expect(withEmotion('!s [feliz]', { tag: 'happy', example: '[feliz]' })).toMatch(/^!s \[feliz\] .+prueba de voz/);
    expect(withEmotion('', { tag: 'singing', example: '[cantando]' })).toMatch(/^!s \[cantando\] Cumpleaños feliz/);
    expect(withEmotion('', null)).toMatch(/^!s .+prueba de voz/);
  });
});

describe('aviso de URL cambiada', () => {
  const origin = 'https://lalo-suite.app';
  const settings = { ...DEFAULT_SETTINGS, channel: 'elstreamer' };
  const copied = buildSuiteWidgetUrl(origin, 'tts', settings.channel, settings);

  it('no avisa si nunca se copió: no se sabe qué hay pegado en OBS', () => {
    expect(urlChangedSinceCopy(copied, null)).toBe(false);
  });

  it('no avisa si la URL es la misma que se copió', () => {
    expect(urlChangedSinceCopy(buildSuiteWidgetUrl(origin, 'tts', settings.channel, settings), copied)).toBe(false);
  });

  it('avisa cuando cambia algo que viaja en la URL', () => {
    const louder = { ...settings, volume: 0.5 };
    expect(urlChangedSinceCopy(buildSuiteWidgetUrl(origin, 'tts', louder.channel, louder), copied)).toBe(true);
    const stricter = { ...settings, blockedWords: ['spoiler'] };
    expect(urlChangedSinceCopy(buildSuiteWidgetUrl(origin, 'tts', stricter.channel, stricter), copied)).toBe(true);
  });

  it('no avisa por un ajuste que no viaja en la URL', () => {
    const other = { ...settings, announceTemplate: '{user}: {message}' };
    expect(urlChangedSinceCopy(buildSuiteWidgetUrl(origin, 'tts', other.channel, other), copied)).toBe(false);
  });
});
