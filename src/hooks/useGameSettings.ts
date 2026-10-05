/**
 * src/hooks/useGameSettings.ts
 *
 * Ajustes del módulo «Alertas de juego» con guardado automático. Cada cambio se
 * guarda en este navegador (y en la nube, si hay cuenta abierta) y se envía a
 * las fuentes de OBS abiertas en este mismo navegador.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { GAME_STORAGE_KEY, GameAlertId, GameAlertSettings, GameSettings, loadGameSettings, normalizeGameSettings, saveGameSettings } from '../types/game';
import { postBus } from '../utils/bus';

export function useGameSettings() {
  const [settings, setSettings] = useState<GameSettings>(loadGameSettings);
  const [saved, setSaved] = useState(true);
  const dirtyRef = useRef(false);

  const updateSettings = useCallback((patch: Partial<GameSettings>) => {
    dirtyRef.current = true;
    setSaved(false);
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const updateAlert = useCallback((id: GameAlertId, patch: Partial<GameAlertSettings>) => {
    dirtyRef.current = true;
    setSaved(false);
    setSettings((prev) => ({ ...prev, alerts: { ...prev.alerts, [id]: { ...prev.alerts[id], ...patch } } }));
  }, []);

  // Guardado con una pequeña espera, solo cuando el cambio nació en esta pestaña
  useEffect(() => {
    if (!dirtyRef.current) return;
    const timer = setTimeout(() => {
      dirtyRef.current = false;
      const clean = normalizeGameSettings(settings);
      saveGameSettings(clean);
      postBus({ type: 'GAME_SETTINGS_UPDATE', settings: clean });
      setSaved(true);
    }, 350);
    return () => clearTimeout(timer);
  }, [settings]);

  // Cambios hechos en otra pestaña del panel
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === GAME_STORAGE_KEY && !dirtyRef.current) setSettings(loadGameSettings());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return { settings, saved, updateSettings, updateAlert };
}
