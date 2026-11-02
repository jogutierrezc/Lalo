/**
 * src/components/done/useDoneSettings.ts
 *
 * Ajustes de Done en la ventana con guardado automático: cada cambio se ve al instante en la
 * vista previa y se guarda en el servidor poco después. El estado de guardado (guardando,
 * guardado, error) se muestra en la barra de la ventana.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { doneGetSettings, doneSaveSettings } from '../../lib/doneClient';
import { DONE_DEFAULTS, type DoneSettings } from '../../lib/doneTypes';
import { clampSettings, diffSettings } from './doneLogic';

export type SaveState = 'loading' | 'idle' | 'saving' | 'saved' | 'error';

export const SAVE_DELAY_MS = 600;

export interface DoneSettingsState {
  settings: DoneSettings;
  state: SaveState;
  error: string | null;
  loadError: string | null;
  /** Cambia uno o varios campos: se ve al instante y se guarda solo. */
  update: (patch: Partial<DoneSettings>) => void;
  /** Guarda ya lo pendiente (al cerrar la ventana o cambiar de pestaña). */
  flush: () => Promise<void>;
  /** Vuelve a intentar un guardado que falló. */
  retry: () => void;
}

export function useDoneSettings(delay: number = SAVE_DELAY_MS): DoneSettingsState {
  const [settings, setSettings] = useState<DoneSettings>(DONE_DEFAULTS);
  const [state, setState] = useState<SaveState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const draft = useRef<DoneSettings>(DONE_DEFAULTS);
  const saved = useRef<DoneSettings>(DONE_DEFAULTS);
  const timer = useRef<number | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    doneGetSettings().then((res) => {
      if (!alive.current) return;
      if (res.ok) {
        draft.current = res.data;
        saved.current = res.data;
        setSettings(res.data);
        setState('idle');
      } else {
        setLoadError(res.message);
        setState('error');
      }
    });
    return () => {
      alive.current = false;
      if (timer.current !== null) {
        // Al cerrar la ventana con un cambio pendiente, se guarda sin esperar.
        window.clearTimeout(timer.current);
        const patch = diffSettings(saved.current, draft.current);
        if (Object.keys(patch).length > 0) void doneSaveSettings(patch);
      }
    };
  }, []);

  const save = useCallback(async () => {
    timer.current = null;
    const patch = diffSettings(saved.current, draft.current);
    if (Object.keys(patch).length === 0) {
      if (alive.current) setState((s) => (s === 'saving' ? 'saved' : s));
      return;
    }
    if (alive.current) {
      setState('saving');
      setError(null);
    }
    const run = (async () => {
      const res = await doneSaveSettings(patch);
      if (!alive.current) return;
      if (res.ok) {
        saved.current = { ...saved.current, ...patch };
        // Si mientras tanto cambió algo más, se guardará en el siguiente turno.
        const more = Object.keys(diffSettings(saved.current, draft.current)).length > 0;
        if (more) {
          timer.current = window.setTimeout(() => void save(), delay);
        } else {
          setState('saved');
        }
      } else {
        setError(res.message);
        setState('error');
      }
    })();
    inflight.current = run;
    await run;
    inflight.current = null;
  }, [delay]);

  const update = useCallback(
    (patch: Partial<DoneSettings>) => {
      const next = { ...draft.current, ...clampSettings(patch) };
      draft.current = next;
      setSettings(next);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void save(), delay);
    },
    [delay, save]
  );

  const flush = useCallback(async () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      await save();
    } else if (inflight.current) {
      await inflight.current;
    }
  }, [save]);

  const retry = useCallback(() => void save(), [save]);

  return { settings, state, error, loadError, update, flush, retry };
}
