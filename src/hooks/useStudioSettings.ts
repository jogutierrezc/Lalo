/**
 * src/hooks/useStudioSettings.ts
 *
 * Escenas de Studio con guardado automático, deshacer y rehacer. Cada cambio
 * se guarda en este navegador (y en la nube, si hay cuenta abierta) y se envía
 * a las fuentes de OBS abiertas en este mismo navegador.
 *
 * `change` recibe una etiqueta opcional: los cambios seguidos con la misma
 * etiqueta (un arrastre, una tanda de teclas, un número que se escribe) cuentan
 * como un solo paso de deshacer. `endStep` cierra la tanda.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { STUDIO_STORAGE_KEY, StudioSettings, loadStudioSettings, saveStudioSettings } from '../types/studio';
import { History, pushHistory, redoHistory, startHistory, undoHistory } from '../utils/studioScenes';
import { postBus } from '../utils/bus';

export function useStudioSettings() {
  const [history, setHistory] = useState<History<StudioSettings>>(() => startHistory(loadStudioSettings()));
  const [saved, setSaved] = useState(true);
  const dirtyRef = useRef(false);
  const tagRef = useRef<string | null>(null);

  const touch = () => {
    dirtyRef.current = true;
    setSaved(false);
  };

  const change = useCallback((updater: (settings: StudioSettings) => StudioSettings, tag?: string) => {
    const merge = tag !== undefined && tag === tagRef.current;
    tagRef.current = tag ?? null;
    setHistory((prev) => {
      const next = updater(prev.present);
      if (next === prev.present) return prev;
      return pushHistory(prev, next, merge);
    });
    touch();
  }, []);

  const endStep = useCallback(() => {
    tagRef.current = null;
  }, []);

  const undo = useCallback(() => {
    tagRef.current = null;
    setHistory(undoHistory);
    touch();
  }, []);

  const redo = useCallback(() => {
    tagRef.current = null;
    setHistory(redoHistory);
    touch();
  }, []);

  const settings = history.present;

  // Guardado con una pequeña espera, solo cuando el cambio nació en esta pestaña
  useEffect(() => {
    if (!dirtyRef.current) return;
    const timer = setTimeout(() => {
      dirtyRef.current = false;
      saveStudioSettings(settings);
      postBus({ type: 'STUDIO_SETTINGS_UPDATE', settings });
      setSaved(true);
    }, 350);
    return () => clearTimeout(timer);
  }, [settings, saved]);

  // Cambios hechos en otra pestaña del panel: se cargan y el historial empieza de nuevo
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STUDIO_STORAGE_KEY && !dirtyRef.current) setHistory(startHistory(loadStudioSettings()));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return {
    settings,
    saved,
    change,
    endStep,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}
