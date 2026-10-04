/**
 * src/hooks/usePowerupsSettings.ts
 *
 * Ajustes del módulo «Power-ups» con guardado automático. Cada cambio se guarda
 * en este navegador y, si hay cuenta abierta, en la nube: de ahí los leen las
 * capas de OBS.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_RULE,
  POWERUPS_STORAGE_KEY,
  PowerupRule,
  PowerupsSettings,
  loadPowerupsSettings,
  normalizePowerupsSettings,
  savePowerupsSettings,
} from '../types/powerups';

export function usePowerupsSettings() {
  const [settings, setSettings] = useState<PowerupsSettings>(loadPowerupsSettings);
  const [saved, setSaved] = useState(true);
  const dirtyRef = useRef(false);

  const updateSettings = useCallback((patch: Partial<PowerupsSettings>) => {
    dirtyRef.current = true;
    setSaved(false);
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const updateRule = useCallback((id: string, patch: Partial<PowerupRule>) => {
    dirtyRef.current = true;
    setSaved(false);
    setSettings((prev) => ({ ...prev, rules: { ...prev.rules, [id]: { ...(prev.rules[id] ?? DEFAULT_RULE), ...patch } } }));
  }, []);

  // Guardado con una pequeña espera, solo cuando el cambio nació en esta pestaña
  useEffect(() => {
    if (!dirtyRef.current) return;
    const timer = setTimeout(() => {
      dirtyRef.current = false;
      savePowerupsSettings(normalizePowerupsSettings(settings));
      setSaved(true);
    }, 350);
    return () => clearTimeout(timer);
  }, [settings]);

  // Cambios hechos en otra pestaña del panel
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === POWERUPS_STORAGE_KEY && !dirtyRef.current) setSettings(loadPowerupsSettings());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return { settings, saved, updateSettings, updateRule };
}
