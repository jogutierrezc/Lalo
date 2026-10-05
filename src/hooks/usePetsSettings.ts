/**
 * src/hooks/usePetsSettings.ts
 *
 * Ajustes del módulo «Mascotas» con guardado automático. Cada cambio se guarda
 * en este navegador (y en la nube, si hay cuenta abierta) y se envía a las
 * fuentes de OBS abiertas en este mismo navegador.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { PETS_STORAGE_KEY, PetTrigger, PetTriggerId, PetsSettings, loadPetsSettings, normalizePetsSettings, savePetsSettings } from '../types/pets';
import { postBus } from '../utils/bus';

export function usePetsSettings() {
  const [settings, setSettings] = useState<PetsSettings>(loadPetsSettings);
  const [saved, setSaved] = useState(true);
  const dirtyRef = useRef(false);

  const updateSettings = useCallback((patch: Partial<PetsSettings>) => {
    dirtyRef.current = true;
    setSaved(false);
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const updateTrigger = useCallback((id: PetTriggerId, patch: Partial<PetTrigger>) => {
    dirtyRef.current = true;
    setSaved(false);
    setSettings((prev) => ({ ...prev, triggers: { ...prev.triggers, [id]: { ...prev.triggers[id], ...patch } } }));
  }, []);

  // Guardado con una pequeña espera, solo cuando el cambio nació en esta pestaña
  useEffect(() => {
    if (!dirtyRef.current) return;
    const timer = setTimeout(() => {
      dirtyRef.current = false;
      const clean = normalizePetsSettings(settings);
      savePetsSettings(clean);
      postBus({ type: 'PETS_SETTINGS_UPDATE', settings: clean });
      setSaved(true);
    }, 350);
    return () => clearTimeout(timer);
  }, [settings]);

  // Cambios hechos en otra pestaña del panel
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === PETS_STORAGE_KEY && !dirtyRef.current) setSettings(loadPetsSettings());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return { settings, saved, updateSettings, updateTrigger };
}
