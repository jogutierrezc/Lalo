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
  calculateTargetRotation,
  pickRandomSegment,
  ROULETTE_PRESETS,
} from '../types/roulette';
import { postBus, RouletteSpinEvent } from '../utils/bus';

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
   * Dispara un giro de ruleta (calculando la física angular con GSAP).
   * Puede seleccionar un castigo específico o elegir uno al azar con probabilidades justas.
   */
  const triggerSpin = useCallback(
    (user = 'Streamer', targetSegmentId?: string): RouletteSpinEvent | null => {
      const activeSegments = rouletteSettings.segments.filter((s) => s.enabled);
      if (activeSegments.length === 0) return null;

      let winnerSegment: RouletteSegment;
      let winnerIndex: number;

      if (targetSegmentId) {
        const foundIndex = activeSegments.findIndex((s) => s.id === targetSegmentId);
        if (foundIndex !== -1) {
          winnerSegment = activeSegments[foundIndex];
          winnerIndex = foundIndex;
        } else {
          const picked = pickRandomSegment(activeSegments);
          if (!picked) return null;
          winnerSegment = picked.segment;
          winnerIndex = picked.index;
        }
      } else {
        const picked = pickRandomSegment(activeSegments);
        if (!picked) return null;
        winnerSegment = picked.segment;
        winnerIndex = picked.index;
      }

      // Ángulo de partida limpio y normalizado en [0, 360)
      const baseRotation = ((currentRotationRef.current % 360) + 360) % 360;

      // 5 vueltas completas de inercia para una desaceleración fluida y constante
      const fullSpins = 5;
      const finalRotation = calculateTargetRotation(
        winnerIndex,
        activeSegments.length,
        baseRotation,
        fullSpins
      );

      // Actualizar el ángulo de reposo para el siguiente giro
      currentRotationRef.current = ((finalRotation % 360) + 360) % 360;

      const spinEvent: RouletteSpinEvent = {
        id: `spin-${Date.now()}`,
        user,
        winnerSegment,
        winnerIndex,
        totalActiveSegments: activeSegments.length,
        startRotation: baseRotation,
        finalRotation,
        spinDurationSec: rouletteSettings.spinDurationSec || 6.0,
        screenShake: rouletteSettings.screenShake,
        confetti: rouletteSettings.confetti,
        victorySoundType: rouletteSettings.victorySoundType,
        victoryCustomAudioUrl: rouletteSettings.victoryCustomAudioUrl,
        victoryCustomAudioVolume: rouletteSettings.victoryCustomAudioVolume ?? 0.85,
        showWinnerBanner: rouletteSettings.showWinnerBanner,
        winnerBannerDurationSec: rouletteSettings.winnerBannerDurationSec || 8,
        ttsAnnounceSpin: rouletteSettings.ttsAnnounceSpin !== false,
        ttsAnnounceWinner: rouletteSettings.ttsAnnounceWinner !== false,
      };

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
