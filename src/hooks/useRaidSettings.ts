/**
 * src/hooks/useRaidSettings.ts
 *
 * Ajustes de la capa «Saludo de raid» con guardado automático. Cada cambio se
 * guarda en este navegador (y en la nube, si hay cuenta abierta) y se envía a
 * las fuentes de OBS abiertas en este mismo navegador.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { RAID_STORAGE_KEY, RaidCommands, RaidSettings, loadRaidSettings, normalizeRaidSettings, saveRaidSettings } from '../types/raid';
import { postBus } from '../utils/bus';

export function useRaidSettings() {
  const [raidSettings, setRaidSettings] = useState<RaidSettings>(loadRaidSettings);
  const [saved, setSaved] = useState(true);
  const dirtyRef = useRef(false);

  const updateSettings = useCallback((patch: Partial<RaidSettings>) => {
    dirtyRef.current = true;
    setSaved(false);
    setRaidSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const updateCommands = useCallback((patch: Partial<RaidCommands>) => {
    dirtyRef.current = true;
    setSaved(false);
    setRaidSettings((prev) => ({ ...prev, commands: { ...prev.commands, ...patch } }));
  }, []);

  // Guardado con una pequeña espera, solo cuando el cambio nació en esta pestaña.
  // Se guarda ya validado: un nombre de comando a medio escribir no llega a OBS
  useEffect(() => {
    if (!dirtyRef.current) return;
    const timer = setTimeout(() => {
      dirtyRef.current = false;
      const clean = normalizeRaidSettings(raidSettings);
      saveRaidSettings(clean);
      postBus({ type: 'RAID_SETTINGS_UPDATE', settings: clean });
      setSaved(true);
    }, 350);
    return () => clearTimeout(timer);
  }, [raidSettings]);

  // Cambios hechos en otra pestaña del panel
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === RAID_STORAGE_KEY && !dirtyRef.current) setRaidSettings(loadRaidSettings());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return { raidSettings, saved, updateSettings, updateCommands };
}
