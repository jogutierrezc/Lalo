/**
 * tests/widgetSettings.test.ts
 *
 * Qué ajustes usa una fuente de OBS. Comprueba que cada ajuste de «Voz del chat»
 * que viaja en la URL llega igual al otro lado, que «Todo en uno» lleva lo mismo
 * que la fuente de la voz, y quién manda entre lo guardado y la URL.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/supabase', () => ({ isCloudEnabled: true, supabase: null, cloudEnvStatus: { url: true, anonKey: true }, MEDIA_BUCKET: 'media' }));

import { buildSuiteWidgetUrl, buildWidgetUrl } from '../src/utils/widgetUrl';
import { DEFAULT_SETTINGS, TTSSettings, normalizeSettings } from '../src/types/settings';
import { WIDGET_DEFAULT_VOICE, resolveWidgetSettings, ttsOverridesFromParams } from '../src/utils/widgetSettings';
import { cloudDelivered } from '../src/lib/widgetCloud';
import { MODULE_STORAGE_KEYS } from '../src/lib/cloudConfig';

const origin = 'https://lalo-suite.app';

/** Lee los parámetros como lo hace la fuente: de lo que va detrás de `#widget?`. */
function readerOf(url: string) {
  const params = new URLSearchParams(url.slice(url.indexOf('?')));
  return (key: string) => params.get(key);
}

/** Ajustes con todo cambiado respecto a los valores por defecto. */
const CUSTOM: TTSSettings = {
  ...DEFAULT_SETTINGS,
  channel: 'elstreamer',
  referenceId: '59fb1f7a5e69481387cc280b9d2b3ad8',
  volume: 0.35,
  speed: 1.25,
  announceSender: false,
  announceTemplate: '{user} comenta: {message}',
  alertStyle: 'bocadillo',
  accent: '#22c7e0',
  position: 'tr',
  scale: 1.3,
  energy: 'hype',
  minRole: 'subs',
  cooldownSec: 45,
  maxLength: 220,
  maxQueueSize: 7,
  blockedWords: ['spoiler', 'mala palabra'],
  blockedUsers: ['troll_1'],
  commandEnabled: false,
  rewardId: '0a1b2c3d-1111-2222-3333-444455556666',
  minBits: 150,
  approvalMode: true,
  priorityPaid: true,
  textOnly: true,
  modNotificationAudio: false,
  modNotificationVoice: false,
  voiceMode: 'all',
  voiceCommand: '!voz',
  allPerMinute: 12,
  ignoredBots: ['nightbot', 'mi_bot'],
  preSound: { enabled: true, soundType: 'synth-bell', customUrl: 'https://cdn.example/aviso.mp3', customName: '', customMediaId: '', volume: 0.4, when: 'paid' },
};

/** Lo que no viaja en la URL: se queda como esté guardado en el navegador de la fuente. */
const NOT_IN_URL: (keyof TTSSettings)[] = ['theme', 'enableVisualizer', 'stickerSvg'];

function expectSameSettings(actual: TTSSettings, expected: TTSSettings) {
  (Object.keys(expected) as (keyof TTSSettings)[])
    .filter((key) => !NOT_IN_URL.includes(key))
    .forEach((key) => {
      expect(actual[key], `ajuste «${key}»`).toEqual(expected[key]);
    });
}

describe('ida y vuelta por la URL (sin cuenta en la nube)', () => {
  it('cada ajuste de la voz llega igual a la fuente «Voz del chat»', () => {
    const url = buildWidgetUrl(origin, CUSTOM);
    expectSameSettings(resolveWidgetSettings(DEFAULT_SETTINGS, readerOf(url), false), CUSTOM);
  });

  it('«Todo en uno» lleva lo mismo que la fuente de la voz, tamaño y reglas incluidos', () => {
    const url = buildSuiteWidgetUrl(origin, 'all', CUSTOM.channel, CUSTOM, { rs: 'abc' });
    expect(url).toContain('app=all');
    expect(url).toContain('rs=abc');
    expectSameSettings(resolveWidgetSettings(DEFAULT_SETTINGS, readerOf(url), false), CUSTOM);
  });

  it('los valores por defecto también van y vuelven', () => {
    const url = buildWidgetUrl(origin, DEFAULT_SETTINGS);
    // Aunque en el navegador de la fuente hubiera otra cosa guardada, la URL lo dice todo (salvo la recompensa y las listas vacías, que no se escriben)
    expectSameSettings(resolveWidgetSettings({ ...CUSTOM, rewardId: '', blockedWords: [], blockedUsers: [], ignoredBots: DEFAULT_SETTINGS.ignoredBots }, readerOf(url), false), DEFAULT_SETTINGS);
  });

  it('el tamaño cubre todo el rango del panel y se limita fuera de él', () => {
    [0.8, 0.95, 1, 1.15, 1.3].forEach((scale) => {
      const url = buildWidgetUrl(origin, { ...DEFAULT_SETTINGS, scale });
      expect(resolveWidgetSettings(DEFAULT_SETTINGS, readerOf(url), false).scale).toBe(scale);
    });
    expect(resolveWidgetSettings(DEFAULT_SETTINGS, readerOf('#widget?scale=9'), false).scale).toBe(1.3);
    expect(resolveWidgetSettings(DEFAULT_SETTINGS, readerOf('#widget?scale=0.1'), false).scale).toBe(0.8);
  });

  it('el volumen a cero y al máximo llegan tal cual', () => {
    [0, 0.05, 1].forEach((volume) => {
      const url = buildWidgetUrl(origin, { ...DEFAULT_SETTINGS, volume });
      expect(resolveWidgetSettings(DEFAULT_SETTINGS, readerOf(url), false).volume).toBe(volume);
    });
  });

  it('el sticker viaja con su estilo', () => {
    const stickerSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';
    const url = buildWidgetUrl(origin, { ...DEFAULT_SETTINGS, alertStyle: 'sticker', stickerSvg });
    const back = resolveWidgetSettings(DEFAULT_SETTINGS, readerOf(url), false);
    expect(back.alertStyle).toBe('sticker');
    expect(back.stickerSvg).toBe(stickerSvg);
  });

  it('las fuentes que solo hablan (ruleta, raid, batallas, metas) llevan la voz, el volumen y la velocidad', () => {
    (['roulette', 'raid', 'polls', 'goals'] as const).forEach((app) => {
      const back = resolveWidgetSettings(DEFAULT_SETTINGS, readerOf(buildSuiteWidgetUrl(origin, app, CUSTOM.channel, CUSTOM)), false);
      expect(back.referenceId, app).toBe(CUSTOM.referenceId);
      expect(back.volume, app).toBe(CUSTOM.volume);
      expect(back.speed, app).toBe(CUSTOM.speed);
      expect(back.channel, app).toBe('elstreamer');
    });
  });

  it('la fuente de alertas lleva además la apariencia de la tarjeta', () => {
    const back = resolveWidgetSettings(DEFAULT_SETTINGS, readerOf(buildSuiteWidgetUrl(origin, 'alerts', CUSTOM.channel, CUSTOM)), false);
    expect(back).toMatchObject({ alertStyle: 'bocadillo', position: 'tr', scale: 1.3, energy: 'hype', accent: '#22c7e0', volume: 0.35 });
  });

  it('el chat y las recompensas no llevan nada de la voz', () => {
    expect(buildSuiteWidgetUrl(origin, 'chat', 'elstreamer', CUSTOM, { cs: 'x' })).toBe(`${origin}/#widget?app=chat&channel=elstreamer&cs=x`);
    expect(buildSuiteWidgetUrl(origin, 'rewards', 'elstreamer', CUSTOM)).toBe(`${origin}/#widget?app=rewards&channel=elstreamer`);
  });
});

describe('quién manda: lo guardado o la URL', () => {
  const saved: TTSSettings = { ...DEFAULT_SETTINGS, channel: 'guardado', volume: 0.2, scale: 0.8, alertStyle: 'subtitulo', referenceId: '654e33e85be3406d90b9723712a035a9' };
  const url = buildWidgetUrl(origin, CUSTOM);

  it('sin nube manda la URL', () => {
    const result = resolveWidgetSettings(saved, readerOf(url), false);
    expect(result).toMatchObject({ volume: 0.35, scale: 1.3, alertStyle: 'bocadillo', referenceId: CUSTOM.referenceId, announceSender: false });
  });

  it('con los ajustes de la cuenta ya descargados manda lo guardado, aunque la URL diga otra cosa', () => {
    const result = resolveWidgetSettings(saved, readerOf(url), true);
    expect(result).toMatchObject({ volume: 0.2, scale: 0.8, alertStyle: 'subtitulo', referenceId: saved.referenceId });
    // También el anuncio, el sonido previo y las reglas: antes la URL seguía ganando en el arranque
    expect(result.announceSender).toBe(true);
    expect(result.preSound.enabled).toBe(false);
    expect(result.minRole).toBe('everyone');
    expect(result.textOnly).toBe(false);
  });

  it('el canal de la URL identifica la fuente en los dos casos', () => {
    expect(resolveWidgetSettings(saved, readerOf(url), true).channel).toBe('elstreamer');
    expect(resolveWidgetSettings(saved, readerOf(url), false).channel).toBe('elstreamer');
    expect(resolveWidgetSettings(saved, readerOf('#widget?app=all'), true).channel).toBe('guardado');
  });

  it('si la nube no entregó nada, la fuente usa la URL y no los valores por defecto', () => {
    // Así queda el navegador de OBS cuando el paquete de la cuenta no se pudo leer: nada guardado
    const result = resolveWidgetSettings(DEFAULT_SETTINGS, readerOf(`${url}&k=clave-privada`), false);
    expectSameSettings(result, CUSTOM);
  });

  it('una URL sin ajustes deja lo guardado como está', () => {
    expect(ttsOverridesFromParams(readerOf('#widget?app=all&channel=x'))).toEqual({});
    expect(resolveWidgetSettings(saved, readerOf('#widget?app=all&channel=x'), false)).toMatchObject({ volume: 0.2, scale: 0.8 });
  });

  it('una voz vacía o antigua pasa a la de reserva', () => {
    expect(resolveWidgetSettings({ ...saved, referenceId: 'default' }, readerOf('#widget?'), true).referenceId).toBe(WIDGET_DEFAULT_VOICE);
    expect(resolveWidgetSettings(saved, readerOf('#widget?voice=undefined'), false).referenceId).toBe(saved.referenceId);
  });
});

describe('normalizeSettings', () => {
  it('limita el volumen y la velocidad y completa lo que falta', () => {
    const result = normalizeSettings({ volume: 4, speed: 9, scale: 5 });
    expect(result.volume).toBe(1);
    expect(result.speed).toBe(1.5);
    expect(result.scale).toBe(1.3);
    expect(result.preSound).toEqual(DEFAULT_SETTINGS.preSound);
    expect(normalizeSettings({ volume: 'alto', speed: null }).volume).toBe(DEFAULT_SETTINGS.volume);
    expect(normalizeSettings(null)).toEqual(normalizeSettings({}));
  });

  it('lo guardado antes de existir el sonido previo sigue valiendo', () => {
    const old = { channel: 'veterano', volume: 0.5, announceSender: false };
    expect(normalizeSettings(old)).toMatchObject({ channel: 'veterano', volume: 0.5, announceSender: false, preSound: { enabled: false } });
  });
});

describe('cloudDelivered: ¿llegaron los ajustes desde la cuenta?', () => {
  const stub = (hash: string, stored: Record<string, string>) => {
    vi.stubGlobal('window', { location: { search: '', hash } });
    vi.stubGlobal('localStorage', { getItem: (key: string) => (key in stored ? stored[key] : null) });
  };
  afterEach(() => vi.unstubAllGlobals());

  it('con clave en la URL y el módulo descargado, sí', () => {
    stub('#widget?k=clave&vol=1', { [MODULE_STORAGE_KEYS.tts as string]: '{}' });
    expect(cloudDelivered('tts')).toBe(true);
    // Cada módulo por separado: el chat no se descargó, así que vale el de la URL
    expect(cloudDelivered('chat')).toBe(false);
  });

  it('con clave pero sin nada descargado (la nube no respondió), no: manda la URL', () => {
    stub('#widget?k=clave&vol=1', {});
    expect(cloudDelivered('tts')).toBe(false);
  });

  it('sin clave en la URL, no, aunque haya algo guardado en este navegador', () => {
    stub('#widget?vol=1', { [MODULE_STORAGE_KEYS.tts as string]: '{}' });
    expect(cloudDelivered('tts')).toBe(false);
  });
});
