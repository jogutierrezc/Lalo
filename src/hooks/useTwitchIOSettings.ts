/**
 * src/hooks/useTwitchIOSettings.ts
 *
 * Hook de gestión reactiva de comandos y configuración de TwitchIO.
 * Soporta auto-guardado en localStorage y sincronización entre pestañas.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadTwitchIOSettings,
  saveTwitchIOSettings,
  TWITCHIO_STORAGE_KEY,
  TwitchIOSettings,
} from '../types/twitchio';

export function useTwitchIOSettings() {
  const [twitchIOSettings, setTwitchIOSettings] = useState<TwitchIOSettings>(loadTwitchIOSettings);
  const [saved, setSaved] = useState(true);
  const dirtyRef = useRef(false);

  const updateTwitchIO = useCallback((patch: Partial<TwitchIOSettings>) => {
    dirtyRef.current = true;
    setSaved(false);
    setTwitchIOSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  // Guardado automático debounced
  useEffect(() => {
    if (!dirtyRef.current) return;
    const timer = setTimeout(() => {
      dirtyRef.current = false;
      saveTwitchIOSettings(twitchIOSettings);
      setSaved(true);
    }, 350);
    return () => clearTimeout(timer);
  }, [twitchIOSettings]);

  // Sincronización entre pestañas
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === TWITCHIO_STORAGE_KEY && !dirtyRef.current) {
        setTwitchIOSettings(loadTwitchIOSettings());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return { twitchIOSettings, updateTwitchIO, saved };
}
