/**
 * src/hooks/useGoalsSettings.ts
 *
 * Hook de gestión de estado para las Metas Comunitarias & Marcadores.
 * Sincroniza con localStorage y notifica cambios a través de BroadcastChannel (bus.ts).
 * Provee detección de hitos (25%, 50%, 75%, 100%) y generación de anuncios por voz TTS.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  CommunityGoalItem,
  GoalsSettings,
  loadGoalsSettings,
  saveGoalsSettings,
  calculateGoalProgress,
  checkMilestoneCrossed,
  formatMilestoneAnnouncement,
  formatProgressAnnouncement,
} from '../types/goals';
import { postBus } from '../utils/bus';

export function useGoalsSettings() {
  const [goalsSettings, setGoalsSettings] = useState<GoalsSettings>(() => loadGoalsSettings());
  const [saved, setSaved] = useState(true);

  // Guardar en localStorage cuando cambian las configuraciones y notificar a OBS
  const persistSettings = useCallback((newSettings: GoalsSettings) => {
    saveGoalsSettings(newSettings);
    setGoalsSettings(newSettings);
    setSaved(true);

    // Sincronizar en tiempo real con OBS Browser Source
    postBus({
      type: 'GOALS_SETTINGS_UPDATE',
      settings: newSettings,
    });

    const timer = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(timer);
  }, []);

  const activeGoal = useMemo(() => {
    return (
      goalsSettings.goals.find((g) => g.id === goalsSettings.activeGoalId) ||
      goalsSettings.goals[0]
    );
  }, [goalsSettings.goals, goalsSettings.activeGoalId]);

  const updateSettings = useCallback(
    (partial: Partial<GoalsSettings>) => {
      setGoalsSettings((prev) => {
        const next = { ...prev, ...partial };
        persistSettings(next);
        return next;
      });
    },
    [persistSettings]
  );

  const updateGoalItem = useCallback(
    (goalId: string, partial: Partial<CommunityGoalItem>) => {
      setGoalsSettings((prev) => {
        const nextGoals = prev.goals.map((g) => {
          if (g.id !== goalId) return g;
          const updated = { ...g, ...partial };
          // Notificar actualización de progreso por bus
          const pct = calculateGoalProgress(updated.current, updated.target);
          postBus({
            type: 'GOAL_UPDATE',
            goal: {
              goalId: updated.id,
              title: updated.title,
              current: updated.current,
              target: updated.target,
              unit: updated.unit,
              percent: pct,
              completed: updated.current >= updated.target,
            },
          });
          return updated;
        });

        const next = { ...prev, goals: nextGoals };
        persistSettings(next);
        return next;
      });
    },
    [persistSettings]
  );

  const addGoalItem = useCallback(
    (newGoal: CommunityGoalItem) => {
      setGoalsSettings((prev) => {
        const next = {
          ...prev,
          goals: [...prev.goals, newGoal],
          activeGoalId: newGoal.id,
        };
        persistSettings(next);
        return next;
      });
    },
    [persistSettings]
  );

  const deleteGoalItem = useCallback(
    (goalId: string) => {
      setGoalsSettings((prev) => {
        const nextGoals = prev.goals.filter((g) => g.id !== goalId);
        if (nextGoals.length === 0) return prev;
        const nextActiveId =
          prev.activeGoalId === goalId ? nextGoals[0].id : prev.activeGoalId;
        const next = {
          ...prev,
          goals: nextGoals,
          activeGoalId: nextActiveId,
        };
        persistSettings(next);
        return next;
      });
    },
    [persistSettings]
  );

  const setActiveGoalId = useCallback(
    (id: string) => {
      updateSettings({ activeGoalId: id });
    },
    [updateSettings]
  );

  const incrementGoal = useCallback(
    (goalId: string, delta: number, user?: string) => {
      const targetGoal = goalsSettings.goals.find((g) => g.id === goalId);
      if (!targetGoal) return;
      const prevCurrent = targetGoal.current;
      const nextVal = Math.max(0, targetGoal.current + delta);
      const newPct = calculateGoalProgress(nextVal, targetGoal.target);
      const milestone = checkMilestoneCrossed(prevCurrent, nextVal, targetGoal.target);

      let announcement: string | undefined;
      if (milestone && goalsSettings.announceMilestones) {
        announcement = formatMilestoneAnnouncement(targetGoal.title, milestone);
      } else if (goalsSettings.announceProgress && delta > 0) {
        announcement = formatProgressAnnouncement(
          targetGoal.title,
          delta,
          targetGoal.unit,
          nextVal,
          targetGoal.target,
          newPct,
          user
        );
      }

      updateGoalItem(goalId, { current: nextVal });

      postBus({
        type: 'GOAL_UPDATE',
        goal: {
          goalId: targetGoal.id,
          title: targetGoal.title,
          current: nextVal,
          target: targetGoal.target,
          unit: targetGoal.unit,
          percent: newPct,
          completed: nextVal >= targetGoal.target,
          delta,
          user,
          milestone: milestone ?? undefined,
          announcement,
        },
      });

      // Locución auditiva local si hay anuncio activo
      if (announcement && typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
          const utter = new SpeechSynthesisUtterance(announcement);
          utter.lang = 'es-MX';
          utter.volume = goalsSettings.announceTtsVolume ?? 0.85;
          window.speechSynthesis.speak(utter);
        } catch (e) {
          console.warn('SpeechSynthesis error:', e);
        }
      }
    },
    [goalsSettings, updateGoalItem]
  );

  const resetGoal = useCallback(
    (goalId: string) => {
      updateGoalItem(goalId, { current: 0 });
    },
    [updateGoalItem]
  );

  // Sincronizar al montar
  useEffect(() => {
    const loaded = loadGoalsSettings();
    setGoalsSettings(loaded);
  }, []);

  return {
    goalsSettings,
    activeGoal,
    saved,
    updateSettings,
    updateGoalItem,
    addGoalItem,
    deleteGoalItem,
    setActiveGoalId,
    incrementGoal,
    resetGoal,
  };
}
