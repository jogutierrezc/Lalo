/**
 * tests/guidedTour.test.ts
 *
 * Pruebas unitarias para el sistema de Tutoriales Guiados (GuidedTour)
 * de Lalo Stream Suite en todas las aplicaciones y acciones del sistema.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isTourDone, markTourDone, resetTour, TourStep } from '../src/components/GuidedTour';

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

describe('GuidedTour System', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('Storage persistence & state tracking', () => {
    it('retorna false por defecto cuando un tour no ha sido completado', () => {
      expect(isTourDone('ajustes')).toBe(false);
      expect(isTourDone('catalogo')).toBe(false);
      expect(isTourDone('alertas')).toBe(false);
      expect(isTourDone('recompensas')).toBe(false);
      expect(isTourDone('metas')).toBe(false);
      expect(isTourDone('twitchio')).toBe(false);
    });

    it('marca correctamente como completado el tour por defecto ("ajustes")', () => {
      markTourDone();
      expect(isTourDone('ajustes')).toBe(true);
      expect(localStorage.getItem('lalo_tts_tour_done')).toBe('1');
    });

    it('marca independientemente los tours de cada aplicación', () => {
      markTourDone('alertas');
      expect(isTourDone('alertas')).toBe(true);
      expect(localStorage.getItem('lalo_tts_tour_done_alertas')).toBe('1');

      // Las demás aplicaciones permanecen pendientes
      expect(isTourDone('recompensas')).toBe(false);
      expect(isTourDone('metas')).toBe(false);
      expect(isTourDone('catalogo')).toBe(false);
      expect(isTourDone('twitchio')).toBe(false);

      markTourDone('metas');
      expect(isTourDone('metas')).toBe(true);
      expect(isTourDone('recompensas')).toBe(false);
    });

    it('permite reiniciar un tour mediante resetTour', () => {
      markTourDone('catalogo');
      expect(isTourDone('catalogo')).toBe(true);

      resetTour('catalogo');
      expect(isTourDone('catalogo')).toBe(false);
      expect(localStorage.getItem('lalo_tts_tour_done_catalogo')).toBeNull();
    });

    it('maneja excepciones de localStorage graciosamente', () => {
      const origGet = localStorage.getItem;
      localStorage.getItem = vi.fn().mockImplementation(() => {
        throw new Error('Storage restricted');
      });

      // Debe retornar true para evitar insistir si hay un entorno restringido
      expect(isTourDone('alertas')).toBe(true);

      localStorage.getItem = origGet;
    });
  });

  describe('Tour steps structure and contract', () => {
    it('valida la estructura de pasos con títulos, badges y cuerpos descriptivos', () => {
      const sampleSteps: TourStep[] = [
        {
          badge: 'Bienvenida',
          title: 'Estudio de Alertas de Stream',
          body: 'Configura tus alertas en vivo para Twitch.',
        },
        {
          target: 'alert-audio',
          badge: 'Audio Engine',
          title: 'Chimes & Efectos Sonoros',
          body: 'Sintetizador Web Audio API y archivos de audio personalizados.',
        },
        {
          target: 'alert-obs',
          badge: 'Acción del Sistema',
          title: 'Fuente de Navegador OBS',
          body: 'Copia el enlace para incrustarlo en OBS.',
        },
      ];

      expect(sampleSteps).toHaveLength(3);
      expect(sampleSteps[0].target).toBeUndefined();
      expect(sampleSteps[0].badge).toBe('Bienvenida');
      expect(sampleSteps[1].target).toBe('alert-audio');
      expect(sampleSteps[2].badge).toBe('Acción del Sistema');
    });
  });
});
