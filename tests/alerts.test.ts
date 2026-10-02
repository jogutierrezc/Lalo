/**
 * tests/alerts.test.ts
 *
 * Pruebas unitarias para el módulo de Alertas de Stream y su configuración.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DEFAULT_ALERTS_SETTINGS,
  loadAlertsSettings,
  saveAlertsSettings,
  ALERTS_STORAGE_KEY,
  StreamAlertsSettings,
} from '../src/types/alerts';
import { playAlertAudio } from '../src/utils/alertsAudio';

const createStorageMock = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    clear: () => {
      store = {};
    },
    removeItem: (key: string) => {
      delete store[key];
    },
  };
};

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: createStorageMock(),
    writable: true,
  });
}

describe('Stream Alerts Module', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('Alerts Settings & Defaults', () => {
    it('debe tener una configuración por defecto completa y válida', () => {
      expect(DEFAULT_ALERTS_SETTINGS.channel).toBe('laloplay_');
      expect(DEFAULT_ALERTS_SETTINGS.alertStyle).toBe('cabina');
      expect(DEFAULT_ALERTS_SETTINGS.duration).toBeGreaterThanOrEqual(3);
      expect(DEFAULT_ALERTS_SETTINGS.soundVolume).toBeGreaterThan(0);

      // Eventos básicos
      expect(DEFAULT_ALERTS_SETTINGS.events.follow.enabled).toBe(true);
      expect(DEFAULT_ALERTS_SETTINGS.events.sub.enabled).toBe(true);
      expect(DEFAULT_ALERTS_SETTINGS.events.bits.enabled).toBe(true);
      expect(DEFAULT_ALERTS_SETTINGS.events.raid.enabled).toBe(true);
    });

    it('guarda y carga la configuración correctamente en localStorage', () => {
      const custom: StreamAlertsSettings = {
        ...DEFAULT_ALERTS_SETTINGS,
        channel: 'jagc_stream',
        duration: 8,
        alertStyle: 'bocadillo',
      };

      saveAlertsSettings(custom);
      const loaded = loadAlertsSettings();

      expect(loaded.channel).toBe('jagc_stream');
      expect(loaded.duration).toBe(8);
      expect(loaded.alertStyle).toBe('bocadillo');
    });

    it('admite configuración de video transparente y screenShake por evento', () => {
      const custom: StreamAlertsSettings = {
        ...DEFAULT_ALERTS_SETTINGS,
        events: {
          ...DEFAULT_ALERTS_SETTINGS.events,
          follow: {
            ...DEFAULT_ALERTS_SETTINGS.events.follow,
            videoUrl: 'data:video/webm;base64,GkXfo59ChoEBQveBAU...',
            videoName: 'celebration.webm',
            blendMode: 'transparent',
            videoScale: 1.25,
            screenShake: true,
          },
        },
      };

      saveAlertsSettings(custom);
      const loaded = loadAlertsSettings();

      expect(loaded.events.follow.videoUrl).toBe('data:video/webm;base64,GkXfo59ChoEBQveBAU...');
      expect(loaded.events.follow.blendMode).toBe('transparent');
      expect(loaded.events.follow.videoScale).toBe(1.25);
      expect(loaded.events.follow.screenShake).toBe(true);
    });

    it('persiste correctamente el audio personalizado (.mp3 / .wav) en la configuración', () => {
      const custom: StreamAlertsSettings = {
        ...DEFAULT_ALERTS_SETTINGS,
        events: {
          ...DEFAULT_ALERTS_SETTINGS.events,
          bits: {
            ...DEFAULT_ALERTS_SETTINGS.events.bits,
            customAudioUrl: 'data:audio/mp3;base64,SUQzBAAAAAAAI1...',
            customAudioName: 'sonido_donacion.mp3',
            customAudioVolume: 0.95,
          },
        },
      };

      saveAlertsSettings(custom);
      const loaded = loadAlertsSettings();

      expect(loaded.events.bits.customAudioUrl).toBe('data:audio/mp3;base64,SUQzBAAAAAAAI1...');
      expect(loaded.events.bits.customAudioName).toBe('sonido_donacion.mp3');
      expect(loaded.events.bits.customAudioVolume).toBe(0.95);
    });

    it('soporta escalonamiento de alertas por Bits (Tiers) y Suscripciones', () => {
      const settings = loadAlertsSettings();
      expect(settings.events.bits.bitTiers).toBeDefined();
      expect(settings.events.bits.bitTiers?.length).toBeGreaterThanOrEqual(4);

      const goldTier = settings.events.bits.bitTiers?.find((t) => t.id === 'bits-gold');
      expect(goldTier).toBeDefined();
      expect(goldTier?.minBits).toBe(500);
      expect(goldTier?.screenShake).toBe(true);

      expect(settings.events.sub.subTiers).toBeDefined();
      expect(settings.events.sub.subTiers?.length).toBeGreaterThanOrEqual(4);
      const giftTier = settings.events.sub.subTiers?.find((t) => t.tier === 'gift');
      expect(giftTier).toBeDefined();
      expect(giftTier?.screenShake).toBe(true);
    });
  });

  describe('Audio Synthesizer Safe Execution', () => {
    it('no debe arrojar error si el entorno no tiene AudioContext (Node/SSR/Mock)', () => {
      expect(() => {
        playAlertAudio('synth-bell', 0.8);
        playAlertAudio('retro-fanfare', 0.5);
        playAlertAudio('arcade-chime', 0.7);
        playAlertAudio('soft-pop', 0.6);
        playAlertAudio('none', 0);
      }).not.toThrow();
    });
  });
});
