/**
 * tests/goals.test.ts
 *
 * Pruebas unitarias para el módulo de Metas Comunitarias & Marcadores:
 * - Sub Goals, Follower Goals, Bit Goals
 * - Cálculo de progreso y detección de hitos (25%, 50%, 75%, 100%)
 * - Lógica de umbral 4-en-fila vs 5+ carrusel/slideshow con GSAP
 * - Formateo de anuncios por voz TTS
 * - Persistencia y sincronización en localStorage
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DEFAULT_GOALS,
  DEFAULT_GOALS_SETTINGS,
  GOALS_STORAGE_KEY,
  calculateGoalProgress,
  shouldDisplayAsSlideshow,
  checkMilestoneCrossed,
  formatMilestoneAnnouncement,
  formatProgressAnnouncement,
  loadGoalsSettings,
  saveGoalsSettings,
  CommunityGoalItem,
  GoalsSettings,
} from '../src/types/goals';

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

describe('Community Goals Module', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('calculateGoalProgress', () => {
    it('calcula porcentajes con precisión y los limita entre 0 y 100%', () => {
      expect(calculateGoalProgress(0, 100)).toBe(0);
      expect(calculateGoalProgress(25, 100)).toBe(25);
      expect(calculateGoalProgress(18, 25)).toBe(72);
      expect(calculateGoalProgress(340, 500)).toBe(68);
      // Casos límite
      expect(calculateGoalProgress(150, 100)).toBe(100);
      expect(calculateGoalProgress(-10, 100)).toBe(0);
      expect(calculateGoalProgress(50, 0)).toBe(0);
    });
  });

  describe('Slideshow vs Row Threshold (≤4 en fila vs 5+ carrusel)', () => {
    it('en modo auto_4_or_slideshow, se mantiene en fila si hay 1, 2, 3 o 4 metas', () => {
      expect(shouldDisplayAsSlideshow(1, 'auto_4_or_slideshow')).toBe(false);
      expect(shouldDisplayAsSlideshow(2, 'auto_4_or_slideshow')).toBe(false);
      expect(shouldDisplayAsSlideshow(3, 'auto_4_or_slideshow')).toBe(false);
      expect(shouldDisplayAsSlideshow(4, 'auto_4_or_slideshow')).toBe(false);
    });

    it('en modo auto_4_or_slideshow, pasa automáticamente a slideshow al tener 5 o más metas', () => {
      expect(shouldDisplayAsSlideshow(5, 'auto_4_or_slideshow')).toBe(true);
      expect(shouldDisplayAsSlideshow(8, 'auto_4_or_slideshow')).toBe(true);
    });

    it('en modo slideshow_only, activa el carrusel para más de 1 meta', () => {
      expect(shouldDisplayAsSlideshow(2, 'slideshow_only')).toBe(true);
      expect(shouldDisplayAsSlideshow(4, 'slideshow_only')).toBe(true);
      expect(shouldDisplayAsSlideshow(1, 'slideshow_only')).toBe(false);
    });

    it('en modo row_only o single_active, nunca activa slideshow', () => {
      expect(shouldDisplayAsSlideshow(5, 'row_only')).toBe(false);
      expect(shouldDisplayAsSlideshow(10, 'row_only')).toBe(false);
      expect(shouldDisplayAsSlideshow(5, 'single_active')).toBe(false);
    });
  });

  describe('Milestones Detection (25%, 50%, 75%, 100%)', () => {
    it('detecta cuando un incremento cruza el 25%', () => {
      expect(checkMilestoneCrossed(20, 25, 100)).toBe(25);
      expect(checkMilestoneCrossed(10, 30, 100)).toBe(25);
    });

    it('detecta cuando un incremento cruza el 50%', () => {
      expect(checkMilestoneCrossed(40, 50, 100)).toBe(50);
      expect(checkMilestoneCrossed(45, 60, 100)).toBe(50);
    });

    it('detecta cuando un incremento cruza el 75%', () => {
      expect(checkMilestoneCrossed(70, 75, 100)).toBe(75);
      expect(checkMilestoneCrossed(65, 80, 100)).toBe(75);
    });

    it('detecta cuando un incremento cruza el 100% de la meta', () => {
      expect(checkMilestoneCrossed(90, 100, 100)).toBe(100);
      expect(checkMilestoneCrossed(95, 120, 100)).toBe(100);
    });

    it('no detecta hito si no se cruzó ningún umbral o si no hay incremento', () => {
      expect(checkMilestoneCrossed(10, 15, 100)).toBeNull();
      expect(checkMilestoneCrossed(30, 40, 100)).toBeNull();
      expect(checkMilestoneCrossed(50, 40, 100)).toBeNull(); // disminución
      expect(checkMilestoneCrossed(0, 0, 100)).toBeNull();
    });
  });

  describe('Speech Announcements Formatting', () => {
    it('formatea correctamente los anuncios de hitos comunitarios', () => {
      const msg25 = formatMilestoneAnnouncement('Cosplay', 25);
      expect(msg25).toContain('Cosplay');
      expect(msg25).toContain('25 por ciento');

      const msg100 = formatMilestoneAnnouncement('Directo 12h', 100);
      expect(msg100).toContain('Directo 12h');
      expect(msg100).toContain('100 por ciento');
      expect(msg100).toContain('Meta cumplida');
    });

    it('formatea correctamente los anuncios de progreso con usuario', () => {
      const msg = formatProgressAnnouncement('Shure SM7B', 500, 'bits', 4500, 10000, 45, 'LuciaStream');
      expect(msg).toContain('Shure SM7B');
      expect(msg).toContain('LuciaStream aportó');
      expect(msg).toContain('+500 bits');
      expect(msg).toContain('45 por ciento');
    });
  });

  describe('Default Goals Configuration', () => {
    it('debe incluir al menos 5 metas iniciales para permitir pruebas del umbral de carrusel', () => {
      expect(DEFAULT_GOALS.length).toBeGreaterThanOrEqual(5);

      const subGoal = DEFAULT_GOALS.find((g) => g.type === 'subs');
      expect(subGoal).toBeDefined();
      expect(subGoal?.target).toBeGreaterThan(0);
      expect(subGoal?.celebrateOnComplete).toBe(true);

      const followerGoal = DEFAULT_GOALS.find((g) => g.type === 'followers');
      expect(followerGoal).toBeDefined();

      const bitsGoal = DEFAULT_GOALS.find((g) => g.type === 'bits');
      expect(bitsGoal).toBeDefined();
      expect(bitsGoal?.victoryScreenShake).toBe(true);
    });
  });

  describe('Goals Storage & Persistence', () => {
    it('retorna la configuración por defecto si localStorage está vacío', () => {
      const settings = loadGoalsSettings();
      expect(settings.channel).toBe('laloplay_');
      expect(settings.goals.length).toBe(DEFAULT_GOALS.length);
      expect(settings.activeGoalId).toBe('goal-subs');
      expect(settings.displayMode).toBe('auto_4_or_slideshow');
      expect(settings.slideshowIntervalSec).toBe(8);
      expect(settings.announceProgress).toBe(true);
      expect(settings.announceMilestones).toBe(true);
    });

    it('guarda y recupera metas comunitarias y modos de visualización personalizados', () => {
      const customGoal: CommunityGoalItem = {
        id: 'goal-custom-1',
        type: 'subs',
        title: 'Meta de Navidad',
        current: 40,
        target: 50,
        unit: 'subs',
        enabled: true,
        style: 'neon',
        accentColor: '#53fc18',
        showPercentage: true,
        showNumbers: true,
        celebrateOnComplete: true,
        victorySoundType: 'retro-fanfare',
        victoryCustomAudioUrl: 'data:audio/mp3;base64,SUQzBAAAAAAAI1...',
        victoryCustomAudioName: 'fanfarria_navidad.mp3',
        victoryCustomAudioVolume: 0.9,
        victoryScreenShake: true,
        confetti: true,
      };

      const customSettings: GoalsSettings = {
        channel: 'jagc_stream',
        activeGoalId: 'goal-custom-1',
        displayMode: 'slideshow_only',
        slideshowIntervalSec: 12,
        announceProgress: true,
        announceMilestones: true,
        announceTtsVoice: 'es-MX-Standard-A',
        announceTtsVolume: 0.95,
        goals: [customGoal],
      };

      saveGoalsSettings(customSettings);
      const loaded = loadGoalsSettings();

      expect(loaded.channel).toBe('jagc_stream');
      expect(loaded.activeGoalId).toBe('goal-custom-1');
      expect(loaded.displayMode).toBe('slideshow_only');
      expect(loaded.slideshowIntervalSec).toBe(12);
      expect(loaded.goals).toHaveLength(1);
      expect(loaded.goals[0].title).toBe('Meta de Navidad');
      expect(loaded.goals[0].victoryCustomAudioName).toBe('fanfarria_navidad.mp3');
      expect(loaded.goals[0].victoryCustomAudioVolume).toBe(0.9);
      expect(loaded.goals[0].style).toBe('neon');
    });
  });
});
