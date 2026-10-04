/**
 * tests/chat.test.ts
 *
 * Capa «Chat en vivo»: ajustes validados, mensajes para mostrar a partir de las
 * etiquetas de tmi.js, corte en texto y emotes, color legible del nombre y URL.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CHAT_SETTINGS,
  chatNameBackground,
  decodeChatSettings,
  encodeChatSettings,
  normalizeChatSettings,
} from '../src/types/chat';
import {
  DEMO_SEQUENCE,
  contrastRatio,
  demoMessage,
  emoteUrl,
  parseEmoteRanges,
  readableNameColor,
  splitMessage,
  toDisplayMessage,
} from '../src/utils/chatFeed';
import { CHAT_ENERGY, lookOf } from '../src/utils/chatMotion';
import { buildSuiteWidgetUrl } from '../src/utils/widgetUrl';
import { CONFIG_MODULES } from '../src/lib/cloudTypes';
import { MODULE_STORAGE_KEYS } from '../src/lib/cloudConfig';

describe('chat: ajustes', () => {
  it('sin nada guardado devuelve los valores por defecto', () => {
    expect(normalizeChatSettings(null)).toEqual(DEFAULT_CHAT_SETTINGS);
    expect(normalizeChatSettings('basura')).toEqual(DEFAULT_CHAT_SETTINGS);
    expect(DEFAULT_CHAT_SETTINGS.motion).toBe('propio');
    expect(DEFAULT_CHAT_SETTINGS.voiceMark).toBe(false);
  });

  it('descarta valores manipulados y recorta los que se salen', () => {
    const result = normalizeChatSettings({
      template: 'hackeada',
      motion: 'volar',
      energy: 'maxima',
      side: 'arriba',
      size: 99,
      width: 2,
      maxMessages: 500,
      seconds: -4,
      badges: 'si',
      voiceMark: true,
      custom: { font: 'comic', bg: 'red', fg: '#FFFFFF', accent: 'url(x)', opacity: 7, radius: -1 },
    });
    expect(result).toMatchObject({
      template: 'cabina',
      motion: 'propio',
      energy: 'normal',
      side: 'l',
      size: 1.5,
      width: 16,
      maxMessages: 15,
      seconds: 0,
      badges: true,
      voiceMark: true,
    });
    expect(result.custom).toEqual({ font: 'archivo', bg: '#1b1c1f', fg: '#ffffff', accent: '#9146ff', opacity: 1, radius: 0 });
  });

  it('viaja en la URL y vuelve igual', () => {
    const settings = normalizeChatSettings({ template: 'terminal', motion: 'escribir', energy: 'hype', side: 'r', seconds: 20 });
    expect(decodeChatSettings(encodeChatSettings(settings))).toEqual(settings);
    expect(decodeChatSettings('%%%')).toBeNull();
    expect(decodeChatSettings(null)).toBeNull();
  });

  it('la plantilla personalizada usa el movimiento de Cabina', () => {
    expect(lookOf('custom')).toBe('cabina');
    expect(lookOf('burbuja')).toBe('burbuja');
    expect(CHAT_ENERGY.calma.bounce).toBe(0);
    expect(CHAT_ENERGY.hype.amp).toBeGreaterThan(CHAT_ENERGY.normal.amp);
    expect(CHAT_ENERGY.hype.time).toBeLessThan(CHAT_ENERGY.calma.time);
  });

  it('está dado de alta como módulo de la nube y como fuente de OBS', () => {
    expect(CONFIG_MODULES).toContain('chat');
    expect(MODULE_STORAGE_KEYS.chat).toBe('lalo_chat_settings');
    expect(buildSuiteWidgetUrl('https://lalo.app', 'chat', 'laloplay_', undefined, { k: 'abc' })).toBe(
      'https://lalo.app/#widget?app=chat&channel=laloplay_&k=abc'
    );
  });
});

describe('chat: mensajes para mostrar', () => {
  it('convierte las etiquetas de tmi.js', () => {
    const message = toDisplayMessage(
      {
        id: 'abc',
        username: 'Mar_ia',
        'display-name': 'Mar_ia',
        color: '#FF3B6B',
        badges: { subscriber: '6', vip: '1' },
        subscriber: true,
        'first-msg': true,
        'msg-id': 'highlighted-message',
        bits: '500',
        emotes: { '25': ['5-9'] },
        'tmi-sent-ts': '1700000000000',
      },
      'hola Kappa',
      'laloplay_',
      { id: 'abc', voice: true }
    );
    expect(message).toMatchObject({
      id: 'abc',
      user: 'Mar_ia',
      username: 'mar_ia',
      color: '#FF3B6B',
      badges: ['vip', 'sub'],
      bits: 500,
      first: true,
      subscriber: true,
      highlighted: true,
      emoteOnly: false,
      voice: true,
      at: 1700000000000,
    });
    expect(message.emotes).toEqual([{ id: '25', start: 5, end: 9 }]);
  });

  it('marca al streamer y a los moderadores, y no se fía de colores raros', () => {
    const owner = toDisplayMessage({ username: 'laloplay_', color: 'red; background:url(x)' }, 'hola', 'laloplay_', { id: '1' });
    expect(owner.badges).toEqual(['broadcaster']);
    expect(owner.color).toBeNull();
    const moderator = toDisplayMessage({ username: 'caro', mod: true }, 'hola', 'laloplay_', { id: '2' });
    expect(moderator.badges).toEqual(['mod']);
    expect(moderator.voice).toBe(false);
  });

  it('descarta rangos de emotes inválidos o que se pisan', () => {
    expect(parseEmoteRanges({ '25': ['0-4', '3-6'], '<img>': ['0-1'], '30': ['90-95', 'x-y'] }, 10)).toEqual([
      { id: '25', start: 0, end: 4 },
    ]);
    expect(parseEmoteRanges(null, 10)).toEqual([]);
  });

  it('corta el texto en trozos de texto y emotes contando caracteres', () => {
    expect(splitMessage('jaja Kappa bien', [{ id: '25', start: 5, end: 9 }])).toEqual([
      { kind: 'text', value: 'jaja ' },
      { kind: 'emote', id: '25', name: 'Kappa' },
      { kind: 'text', value: ' bien' },
    ]);
    // Un emoji ocupa un carácter aunque sean dos unidades UTF-16
    expect(splitMessage('\u{1F600} Kappa', [{ id: '25', start: 2, end: 6 }])).toEqual([
      { kind: 'text', value: '\u{1F600} ' },
      { kind: 'emote', id: '25', name: 'Kappa' },
    ]);
    expect(splitMessage('<b>hola</b>', [])).toEqual([{ kind: 'text', value: '<b>hola</b>' }]);
  });

  it('construye la dirección de la imagen del emote', () => {
    expect(emoteUrl('25')).toBe('https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0');
    expect(emoteUrl('emotesv2_abc', 'light', 'static')).toBe('https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_abc/static/light/2.0');
  });
});

describe('chat: color del nombre', () => {
  it('da un color fijo a quien no eligió ninguno', () => {
    const first = readableNameColor(null, 'pepe', '#1b1c1f');
    expect(first).toMatch(/^#[0-9a-f]{6}$/);
    expect(readableNameColor(null, 'pepe', '#1b1c1f')).toBe(first);
  });

  it('aclara los colores demasiado oscuros sobre fondo oscuro y los deja si ya se leen', () => {
    const dark = readableNameColor('#00008b', 'x', '#1b1c1f');
    expect(dark).not.toBe('#00008b');
    expect(contrastRatio(dark, '#1b1c1f')).toBeGreaterThanOrEqual(4.5);
    expect(readableNameColor('#22c8f0', 'x', '#1b1c1f')).toBe('#22c8f0');
  });

  it('oscurece los colores claros sobre la burbuja blanca', () => {
    const light = readableNameColor('#ffff00', 'x', '#ffffff');
    expect(contrastRatio(light, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(chatNameBackground({ ...DEFAULT_CHAT_SETTINGS, template: 'burbuja' })).toBe('#ffffff');
    expect(chatNameBackground({ ...DEFAULT_CHAT_SETTINGS, template: 'custom' })).toBe(DEFAULT_CHAT_SETTINGS.custom.bg);
  });
});

describe('chat: modo demostración', () => {
  it('trae cada clase especial de mensaje', () => {
    expect(new Set(DEMO_SEQUENCE)).toEqual(new Set(['normal', 'mod', 'command', 'sub', 'emotes', 'first', 'bits']));
    expect(demoMessage('bits').bits).toBeGreaterThan(0);
    expect(demoMessage('emotes').emoteOnly).toBe(true);
    expect(demoMessage('sub').subscriber).toBe(true);
    expect(demoMessage('first').first).toBe(true);
    expect(demoMessage('command', '!di').text.startsWith('!di ')).toBe(true);
    expect(demoMessage('normal').id).not.toBe(demoMessage('normal').id);
  });
});
