/**
 * tests/widgetUrl.test.ts
 *
 * Pruebas unitarias para la generación de enlaces de OBS Studio en Lalo Stream Suite.
 * Valida la parametrización completa (canal, voz de personaje, volumen, velocidad, estilo, acento)
 * y la compatibilidad con HashRouter y Browser Sources en OBS Studio.
 */

import { describe, it, expect } from 'vitest';
import { buildWidgetUrl, buildSuiteWidgetUrl } from '../src/utils/widgetUrl';
import { DEFAULT_SETTINGS, TTSSettings } from '../src/types/settings';

describe('OBS Widget URL Builder', () => {
  const origin = 'https://lalo-suite.app';

  describe('buildWidgetUrl()', () => {
    it('construye la URL de TTS con canal, voz y parámetros de audio', () => {
      const customSettings: TTSSettings = {
        ...DEFAULT_SETTINGS,
        channel: 'elstreamer',
        referenceId: '59fb1f7a5e69481387cc280b9d2b3ad8', // Jarvis
        volume: 0.85,
        speed: 1.15,
        alertStyle: 'cabina',
        position: 'tr',
        accent: '#00f5ff',
      };

      const url = buildWidgetUrl(origin, customSettings);

      expect(url).toContain(`${origin}/#widget?`);
      expect(url).toContain('channel=elstreamer');
      expect(url).toContain('voice=59fb1f7a5e69481387cc280b9d2b3ad8');
      expect(url).toContain('vol=0.85');
      expect(url).toContain('speed=1.15');
      expect(url).toContain('style=cabina');
      expect(url).toContain('pos=tr');
      expect(url).toContain('accent=00f5ff');
    });

    it('incluye listas de moderación si están configuradas', () => {
      const customSettings: TTSSettings = {
        ...DEFAULT_SETTINGS,
        channel: 'laloplay_',
        blockedUsers: ['spammer1', 'troll2'],
      };

      const url = buildWidgetUrl(origin, customSettings);
      expect(url).toContain('channel=laloplay_');
      expect(url).toContain('block=');
    });
  });

  describe('buildSuiteWidgetUrl()', () => {
    it('genera enlace dedicado para Overlay de Ruleta', () => {
      const url = buildSuiteWidgetUrl(origin, 'roulette', 'laloplay_');
      expect(url).toBe(`${origin}/#widget?app=roulette&channel=laloplay_`);
    });

    it('genera enlace dedicado para Overlay de Alertas', () => {
      const url = buildSuiteWidgetUrl(origin, 'alerts', 'laloplay_');
      expect(url).toBe(`${origin}/#widget?app=alerts&channel=laloplay_`);
    });

    it('genera enlace dedicado para Overlay de Metas', () => {
      const url = buildSuiteWidgetUrl(origin, 'goals', 'laloplay_');
      expect(url).toBe(`${origin}/#widget?app=goals&channel=laloplay_`);
    });

    it('genera enlace dedicado para Overlay de Batallas', () => {
      const url = buildSuiteWidgetUrl(origin, 'polls', 'laloplay_');
      expect(url).toBe(`${origin}/#widget?app=polls&channel=laloplay_`);
    });

    it('genera enlace Todo-en-Uno (Suite) con parámetros completos si se proveen ttsSettings', () => {
      const ttsSettings: TTSSettings = {
        ...DEFAULT_SETTINGS,
        channel: 'laloplay_',
        referenceId: '5669f8e58ecb476a982bc2b67ac6b538', // Teemo
        volume: 0.9,
      };

      const url = buildSuiteWidgetUrl(origin, 'all', 'laloplay_', ttsSettings);
      expect(url).toContain('app=all');
      expect(url).toContain('channel=laloplay_');
      expect(url).toContain('voice=5669f8e58ecb476a982bc2b67ac6b538');
      expect(url).toContain('vol=0.9');
    });
  });
});
