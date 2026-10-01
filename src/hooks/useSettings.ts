/**
 * useSettings.ts
 *
 * Ajustes del streamer con guardado automático. Lo comparten el panel de
 * ajustes y el control en vivo: cada cambio se persiste, se envía a los widgets
 * abiertos en este navegador y se refleja en las otras pestañas del panel.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadSettings, saveSettings, STORAGE_KEY, TTSSettings } from '../types/settings';
import { postBus } from '../utils/bus';

export function useSettings() {
  const [settings, setSettings] = useState<TTSSettings>(loadSettings);
  const [saved, setSaved] = useState(true);
  const dirtyRef = useRef(false);

  const update = useCallback((patch: Partial<TTSSettings>) => {
    dirtyRef.current = true;
    setSaved(false);
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  // Guardado automático, solo cuando el cambio nació en esta pestaña
  useEffect(() => {
    if (!dirtyRef.current) return;
    const timer = setTimeout(() => {
      dirtyRef.current = false;
      saveSettings(settings);
      postBus({ type: 'SETTINGS_UPDATE', settings });
      setSaved(true);
    }, 350);
    return () => clearTimeout(timer);
  }, [settings]);

  // Cambios hechos en otra pestaña del panel (por ejemplo, ajustes y control abiertos a la vez)
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY && !dirtyRef.current) setSettings(loadSettings());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return { settings, update, saved };
}
