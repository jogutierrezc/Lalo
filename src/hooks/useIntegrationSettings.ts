/**
 * src/hooks/useIntegrationSettings.ts
 *
 * Ajustes de «Ahora suena» y de «Ko-fi» con guardado automático. Cada cambio se
 * guarda en este navegador, se avisa a las fuentes abiertas aquí mismo y, con
 * cuenta abierta, sube a la nube: de ahí lo leen las capas de OBS.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { KOFI_STORAGE_KEY, loadKofiSettings, normalizeKofiSettings, saveKofiSettings, type KofiSettings } from '../types/kofi';
import { MUSIC_STORAGE_KEY, loadMusicSettings, normalizeMusicSettings, saveMusicSettings, type MusicSettings } from '../types/music';
import { postBus } from '../utils/bus';

interface Module<T> {
  key: string;
  load: () => T;
  normalize: (raw: unknown) => T;
  save: (settings: T) => void;
  announce: (settings: T) => void;
}

function useModuleSettings<T extends object>(module: Module<T>) {
  const [settings, setSettings] = useState<T>(module.load);
  const [saved, setSaved] = useState(true);
  const dirty = useRef(false);
  const moduleRef = useRef(module);

  const update = useCallback((patch: Partial<T> | ((prev: T) => T)) => {
    dirty.current = true;
    setSaved(false);
    setSettings((prev) => (typeof patch === 'function' ? patch(prev) : { ...prev, ...patch }));
  }, []);

  // Guardado con una pequeña espera, solo cuando el cambio nació en esta pestaña
  useEffect(() => {
    if (!dirty.current) return;
    const timer = setTimeout(() => {
      dirty.current = false;
      const clean = moduleRef.current.normalize(settings);
      moduleRef.current.save(clean);
      moduleRef.current.announce(clean);
      setSaved(true);
    }, 350);
    return () => clearTimeout(timer);
  }, [settings]);

  // Cambios hechos en otra pestaña del panel
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === moduleRef.current.key && !dirty.current) setSettings(moduleRef.current.load());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return { settings, saved, update };
}

const MUSIC: Module<MusicSettings> = {
  key: MUSIC_STORAGE_KEY,
  load: loadMusicSettings,
  normalize: normalizeMusicSettings,
  save: saveMusicSettings,
  announce: (settings) => postBus({ type: 'MUSIC_SETTINGS_UPDATE', settings }),
};

const KOFI: Module<KofiSettings> = {
  key: KOFI_STORAGE_KEY,
  load: loadKofiSettings,
  normalize: normalizeKofiSettings,
  save: saveKofiSettings,
  announce: (settings) => postBus({ type: 'KOFI_SETTINGS_UPDATE', settings }),
};

export const useMusicSettings = () => useModuleSettings(MUSIC);
export const useKofiSettings = () => useModuleSettings(KOFI);
