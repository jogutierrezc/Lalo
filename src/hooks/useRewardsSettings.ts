/**
 * src/hooks/useRewardsSettings.ts
 *
 * Hook para gestionar la biblioteca de recompensas, videos transparentes
 * y avisos personalizados con sincronización en localStorage y BroadcastChannel.
 */

import { useState, useCallback, useEffect } from 'react';
import {
  RewardsSettings,
  loadRewardsSettings,
  normalizeRewardsSettings,
  saveRewardsSettings,
  CustomRewardItem,
} from '../types/rewards';

export function useRewardsSettings() {
  const [rewardsSettings, setRewardsSettings] = useState<RewardsSettings>(loadRewardsSettings);
  const [saved, setSaved] = useState(true);

  // Escuchar cambios de storage entre pestañas
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'lalo_stream_rewards_settings' && e.newValue) {
        try {
          setRewardsSettings(normalizeRewardsSettings(JSON.parse(e.newValue)));
        } catch {
          // ignore
        }
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const updateRewards = useCallback((patch: Partial<RewardsSettings>) => {
    setRewardsSettings((prev) => {
      const next: RewardsSettings = { ...prev, ...patch };
      saveRewardsSettings(next);
      return next;
    });
    setSaved(false);
    setTimeout(() => setSaved(true), 800);
  }, []);

  const updateRewardItem = useCallback((id: string, patch: Partial<CustomRewardItem>) => {
    setRewardsSettings((prev) => {
      const updatedRewards = prev.rewards.map((r) => (r.id === id ? { ...r, ...patch } : r));
      const next: RewardsSettings = { ...prev, rewards: updatedRewards };
      saveRewardsSettings(next);
      return next;
    });
    setSaved(false);
    setTimeout(() => setSaved(true), 800);
  }, []);

  const addRewardItem = useCallback((newItem: CustomRewardItem) => {
    setRewardsSettings((prev) => {
      const next: RewardsSettings = { ...prev, rewards: [newItem, ...prev.rewards] };
      saveRewardsSettings(next);
      return next;
    });
    setSaved(false);
    setTimeout(() => setSaved(true), 800);
  }, []);

  const deleteRewardItem = useCallback((id: string) => {
    setRewardsSettings((prev) => {
      const next: RewardsSettings = {
        ...prev,
        rewards: prev.rewards.filter((r) => r.id !== id),
      };
      saveRewardsSettings(next);
      return next;
    });
    setSaved(false);
    setTimeout(() => setSaved(true), 800);
  }, []);

  return {
    rewardsSettings,
    updateRewards,
    updateRewardItem,
    addRewardItem,
    deleteRewardItem,
    saved,
  };
}
