/**
 * src/hooks/useRouletteSettings.ts
 *
 * Hook reactivo para la gestión de configuración y eventos de la Ruleta de Castigos.
 * Sincroniza en tiempo real con LocalStorage y BroadcastChannel.
 */

import { useState, useCallback, useRef } from 'react';
import {
  RouletteSettings,
  RouletteSegment,
  loadRouletteSettings,
  saveRouletteSettings,
  ROULETTE_PRESETS,
} from '../types/roulette';
import { postBus, RouletteSpinEvent } from '../utils/bus';
import { buildSpin } from '../utils/rouletteLogic';

export function useRouletteSettings() {
  const [rouletteSettings, setRouletteSettings] = useState<RouletteSettings>(() =>
    loadRouletteSettings()
  );
  const [saved, setSaved] = useState(true);
  const currentRotationRef = useRef<number>(0);

  // Guardar en localStorage y sincronizar con BroadcastChannel
  const persistAndBroadcast = useCallback((newSettings: RouletteSettings) => {
    saveRouletteSettings(newSettings);
    postBus({ type: 'ROULETTE_SETTINGS_UPDATE', settings: newSettings });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, []);

  const updateSettings = useCallback(
    (partial: Partial<RouletteSettings>) => {
      setRouletteSettings((prev) => {
        const next = { ...prev, ...partial };
        persistAndBroadcast(next);
        return next;
      });
    },
    [persistAndBroadcast]
  );

  const updateSegment = useCallback(
    (segmentId: string, partial: Partial<RouletteSegment>) => {
      setRouletteSettings((prev) => {
        const nextSegments = prev.segments.map((s) =>
          s.id === segmentId ? { ...s, ...partial } : s
        );
        const next = { ...prev, segments: nextSegments };
        persistAndBroadcast(next);
        return next;
      });
    },
    [persistAndBroadcast]
  );

  const addSegment = useCallback(
    (newSegment: RouletteSegment) => {
      setRouletteSettings((prev) => {
        const next = { ...prev, segments: [...prev.segments, newSegment] };
        persistAndBroadcast(next);
        return next;
      });
    },
    [persistAndBroadcast]
  );

  const deleteSegment = useCallback(
    (segmentId: string) => {
      setRouletteSettings((prev) => {
        if (prev.segments.length <= 2) return prev; // Al menos 2 segmentos
        const nextSegments = prev.segments.filter((s) => s.id !== segmentId);
        const next = { ...prev, segments: nextSegments };
        persistAndBroadcast(next);
        return next;
      });
    },
    [persistAndBroadcast]
  );

  const loadPreset = useCallback(
    (presetId: string) => {
      const preset = ROULETTE_PRESETS.find((p) => p.id === presetId);
      if (!preset) return;
      setRouletteSettings((prev) => {
        const next = {
          ...prev,
          segments: preset.segments,
        };
        persistAndBroadcast(next);
        return next;
      });
    },
    [persistAndBroadcast]
  );

  /**
   * Gira la rueda en el monitor y en las fuentes de la ruleta abiertas en este navegador.
   * `why` cuenta qué lo hizo girar (una prueba, un canje simulado, un cheer simulado).
   */
  const triggerSpin = useCallback(
    (user = 'Streamer', targetSegmentId?: string, why?: string): RouletteSpinEvent | null => {
      const spinEvent = buildSpin(rouletteSettings, {
        id: `spin-${Date.now()}`,
        user,
        why,
        baseRotation: currentRotationRef.current,
        targetSegmentId,
      });
      if (!spinEvent) return null;
      // Ángulo de reposo para el siguiente giro
      currentRotationRef.current = ((spinEvent.finalRotation % 360) + 360) % 360;
      postBus({ type: 'ROULETTE_SPIN', spin: spinEvent });
      return spinEvent;
    },
    [rouletteSettings]
  );

  return {
    rouletteSettings,
    saved,
    updateSettings,
    updateSegment,
    addSegment,
    deleteSegment,
    loadPreset,
    triggerSpin,
  };
}
