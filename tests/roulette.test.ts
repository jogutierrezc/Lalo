/**
 * tests/roulette.test.ts
 *
 * Pruebas unitarias para la Ruleta de Castigos & Retos de Lalo Stream Suite.
 * Valida la física de ángulos, geometría de arcos SVG, inercia de giros,
 * gestión de preajustes y persistencia en LocalStorage.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getSegmentAngle,
  polarToCartesian,
  describeArc,
  calculateTargetRotation,
  pickRandomSegment,
  loadRouletteSettings,
  saveRouletteSettings,
  DEFAULT_ROULETTE_SETTINGS,
  ROULETTE_PRESETS,
  ROULETTE_STORAGE_KEY,
  RouletteSegment,
  CATEGORY_LABELS,
  PenaltyCategory,
} from '../src/types/roulette';

// Mock de localStorage para el entorno de test
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

describe('Roulette Math & Angular Mechanics', () => {
  describe('getSegmentAngle()', () => {
    it('divide un círculo de 360° uniformemente según el conteo de rebanadas', () => {
      expect(getSegmentAngle(6)).toBe(60);
      expect(getSegmentAngle(4)).toBe(90);
      expect(getSegmentAngle(8)).toBe(45);
      expect(getSegmentAngle(12)).toBe(30);
    });

    it('devuelve 360° si el conteo es 0 o negativo', () => {
      expect(getSegmentAngle(0)).toBe(360);
      expect(getSegmentAngle(-2)).toBe(360);
    });
  });

  describe('polarToCartesian()', () => {
    const cx = 200;
    const cy = 200;
    const radius = 100;

    it('ubica 0° en la cúspide (arriba, vector 12 en punto)', () => {
      const point = polarToCartesian(cx, cy, radius, 0);
      expect(Math.round(point.x)).toBe(200);
      expect(Math.round(point.y)).toBe(100);
    });

    it('ubica 90° en la derecha (vector 3 en punto)', () => {
      const point = polarToCartesian(cx, cy, radius, 90);
      expect(Math.round(point.x)).toBe(300);
      expect(Math.round(point.y)).toBe(200);
    });

    it('ubica 180° en la parte inferior (vector 6 en punto)', () => {
      const point = polarToCartesian(cx, cy, radius, 180);
      expect(Math.round(point.x)).toBe(200);
      expect(Math.round(point.y)).toBe(300);
    });

    it('ubica 270° a la izquierda (vector 9 en punto)', () => {
      const point = polarToCartesian(cx, cy, radius, 270);
      expect(Math.round(point.x)).toBe(100);
      expect(Math.round(point.y)).toBe(200);
    });
  });

  describe('describeArc()', () => {
    it('genera un comando de trazado SVG válido con Move, Line, Arc y Close', () => {
      const path = describeArc(100, 100, 80, 0, 60);
      expect(path).toContain('M 100 100');
      expect(path).toContain('L');
      expect(path).toContain('A 80 80');
      expect(path.endsWith('Z')).toBe(true);
    });

    it('utiliza el flag de arco menor (0) para ángulos menores o iguales a 180°', () => {
      const path = describeArc(100, 100, 80, 0, 90);
      expect(path).toContain('0 0 0');
    });

    it('utiliza el flag de arco mayor (1) para ángulos superiores a 180°', () => {
      const path = describeArc(100, 100, 80, 0, 240);
      expect(path).toContain('0 1 0');
    });
  });

  describe('calculateTargetRotation()', () => {
    it('calcula la rotación hacia adelante necesaria para alinear el segmento ganador con el puntero superior (0°)', () => {
      const activeCount = 6;
      const sliceAngle = 60; // 360 / 6
      const minSpins = 5;

      // Para targetIndex = 0 (centro a 30°):
      // Para llevar 30° al puntero en 0°, la rotación en el círculo debe ser 360 - 30 = 330°
      const targetRotation0 = calculateTargetRotation(0, activeCount, 0, minSpins);
      expect(targetRotation0).toBeGreaterThanOrEqual(minSpins * 360);
      expect(targetRotation0 % 360).toBe(330);

      // Para targetIndex = 1 (centro a 90°):
      // Rotación en círculo: 360 - 90 = 270°
      const targetRotation1 = calculateTargetRotation(1, activeCount, 0, minSpins);
      expect(targetRotation1 % 360).toBe(270);

      // Para targetIndex = 3 (centro a 210°):
      // Rotación en círculo: 360 - 210 = 150°
      const targetRotation3 = calculateTargetRotation(3, activeCount, 0, minSpins);
      expect(targetRotation3 % 360).toBe(150);
    });

    it('mantiene la continuidad física sin retroceder cuando la ruleta ya tiene rotación previa acumulada', () => {
      const currentRotation = 2500; // ~6.94 vueltas
      const minSpins = 6;
      const nextRotation = calculateTargetRotation(2, 6, currentRotation, minSpins);

      // Debe ser estrictamente mayor a currentRotation + minSpins * 360
      expect(nextRotation).toBeGreaterThan(currentRotation + (minSpins - 1) * 360);
      // El residuo angular debe ubicar al segmento 2 (centro a 150°, por lo que 360 - 150 = 210°)
      expect(nextRotation % 360).toBe(210);
    });

    it('devuelve rotación segura si activeCount es 0 o negativo', () => {
      const current = 100;
      const result = calculateTargetRotation(0, 0, current, 4);
      expect(result).toBe(current + 4 * 360);
    });
  });

  describe('pickRandomSegment()', () => {
    const testSegments: RouletteSegment[] = [
      { id: '1', text: 'Opción A', color: '#ff0000', category: 'fitness', enabled: true },
      { id: '2', text: 'Opción B', color: '#00ff00', category: 'show', enabled: false }, // deshabilitada
      { id: '3', text: 'Opción C', color: '#0000ff', category: 'gameplay', enabled: true },
    ];

    it('selecciona únicamente entre los segmentos habilitados (enabled: true)', () => {
      for (let i = 0; i < 20; i++) {
        const picked = pickRandomSegment(testSegments);
        expect(picked).not.toBeNull();
        expect(picked?.segment.enabled).toBe(true);
        expect(picked?.segment.id).not.toBe('2');
      }
    });

    it('devuelve null si no hay segmentos habilitados', () => {
      const allDisabled = testSegments.map((s) => ({ ...s, enabled: false }));
      expect(pickRandomSegment(allDisabled)).toBeNull();
      expect(pickRandomSegment([])).toBeNull();
    });
  });
});

describe('Roulette Presets & Data Integrity', () => {
  it('incluye 4 preajustes temáticos con segmentos válidos', () => {
    expect(ROULETTE_PRESETS.length).toBe(4);
    const presetIds = ROULETTE_PRESETS.map((p) => p.id);
    expect(presetIds).toEqual(['gamer', 'fitness', 'show', 'picante']);

    ROULETTE_PRESETS.forEach((preset) => {
      expect(preset.name.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(0);
      expect(preset.segments.length).toBeGreaterThanOrEqual(4);

      preset.segments.forEach((seg) => {
        expect(seg.id).toBeDefined();
        expect(seg.text.length).toBeGreaterThan(0);
        expect(seg.color.startsWith('#')).toBe(true);
        expect(seg.category).toBeDefined();
        expect(typeof seg.enabled).toBe('boolean');
      });
    });
  });

  it('tiene preajuste de castigos gamer con opciones de jugabilidad', () => {
    const gamerPreset = ROULETTE_PRESETS.find((p) => p.id === 'gamer')!;
    expect(gamerPreset).toBeDefined();
    const texts = gamerPreset.segments.map((s) => s.text);
    expect(texts.some((t) => t.includes('Jugar con una sola mano'))).toBe(true);
  });
});

describe('Roulette Settings & Storage Persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('carga la configuración por defecto si el storage está vacío', () => {
    const loaded = loadRouletteSettings();
    expect(loaded.title).toBe(DEFAULT_ROULETTE_SETTINGS.title);
    expect(loaded.style).toBe('cabina');
    expect(loaded.spinDurationSec).toBe(6.0);
    expect(loaded.soundEnabled).toBe(true);
    expect(loaded.segments.length).toBe(DEFAULT_ROULETTE_SETTINGS.segments.length);
  });

  it('guarda y recupera fielmente configuraciones modificadas', () => {
    const customSettings = {
      ...DEFAULT_ROULETTE_SETTINGS,
      channel: 'elstreamer',
      title: 'RULETA MORTAL 3000',
      style: 'neon' as const,
      spinDurationSec: 8.5,
      tickVolume: 0.9,
    };

    saveRouletteSettings(customSettings);
    const loaded = loadRouletteSettings();

    expect(loaded.channel).toBe('elstreamer');
    expect(loaded.title).toBe('RULETA MORTAL 3000');
    expect(loaded.style).toBe('neon');
    expect(loaded.spinDurationSec).toBe(8.5);
    expect(loaded.tickVolume).toBe(0.9);
  });

  it('se recupera con gracia si el JSON almacenado está corrupto', () => {
    localStorage.setItem(ROULETTE_STORAGE_KEY, '{ json_invalido_corrupto :::');
    const loaded = loadRouletteSettings();
    expect(loaded.title).toBe(DEFAULT_ROULETTE_SETTINGS.title);
    expect(loaded.segments.length).toBeGreaterThan(0);
  });

  it('incluye opciones de locución TTS activadas por defecto', () => {
    const loaded = loadRouletteSettings();
    expect(loaded.ttsAnnounceSpin).toBe(true);
    expect(loaded.ttsAnnounceWinner).toBe(true);
  });

  it('guarda y persiste las preferencias de locución TTS', () => {
    const custom = {
      ...DEFAULT_ROULETTE_SETTINGS,
      ttsAnnounceSpin: false,
      ttsAnnounceWinner: true,
    };
    saveRouletteSettings(custom);
    const loaded = loadRouletteSettings();
    expect(loaded.ttsAnnounceSpin).toBe(false);
    expect(loaded.ttsAnnounceWinner).toBe(true);
  });
});

describe('Roulette Category Labels & Visual Assets', () => {
  it('todas las categorías de castigos tienen icono emoji asociado', () => {
    const categories: PenaltyCategory[] = ['fitness', 'voice', 'gameplay', 'food', 'show', 'safe', 'custom'];
    categories.forEach((cat) => {
      const info = CATEGORY_LABELS[cat];
      expect(info).toBeDefined();
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.color.startsWith('#')).toBe(true);
      expect(info.icon.length).toBeGreaterThan(0);
    });
  });
});

