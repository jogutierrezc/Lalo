/**
 * src/hooks/useTournament.ts
 *
 * Lo que la página «Torneos» necesita: los AJUSTES, con guardado automático
 * (este navegador, la nube si hay cuenta y las fuentes de OBS abiertas aquí), y
 * el ESTADO VIVO, que lee y escribe por el almacén (lib/tournamentStore.ts).
 *
 * Cada cambio del estado se guarda al momento en el almacén y, con una pequeña
 * espera, vuelve a guardar los ajustes: dentro de ellos viaja la copia del
 * estado que le llega a OBS en otro equipo (ver types/tournament.ts).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { tournamentStore } from '../lib/tournamentStore';
import {
  TOURNAMENT_STORAGE_KEY,
  emptyTournamentState,
  loadTournamentSettings,
  normalizeTournamentSettings,
  saveTournamentSettings,
  type TournamentSettings,
  type TournamentState,
} from '../types/tournament';
import { postBus } from '../utils/bus';
import { isNewerState } from '../utils/tournamentLogic';

const SAVE_DELAY_MS = 350;

export function useTournament() {
  const [settings, setSettings] = useState<TournamentSettings>(loadTournamentSettings);
  const [state, setStateValue] = useState<TournamentState>(() => tournamentStore().read() ?? emptyTournamentState(loadTournamentSettings().size));
  const [saved, setSaved] = useState(true);
  const dirtyRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const updateSettings = useCallback((patch: Partial<TournamentSettings>) => {
    dirtyRef.current = true;
    setSaved(false);
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  /** Aplica un cambio al estado. Si la función devuelve null o el mismo estado, no pasa nada. */
  const changeState = useCallback((change: (state: TournamentState) => TournamentState | null): boolean => {
    const next = change(stateRef.current);
    if (!next || next === stateRef.current) return false;
    stateRef.current = next;
    setStateValue(next);
    tournamentStore().write(next);
    // La copia que viaja con los ajustes se sube en el siguiente guardado
    dirtyRef.current = true;
    setSaved(false);
    return true;
  }, []);

  // Guardado con una pequeña espera, solo cuando el cambio nació en esta pestaña
  useEffect(() => {
    if (!dirtyRef.current) return;
    const timer = setTimeout(() => {
      dirtyRef.current = false;
      const clean = normalizeTournamentSettings(settings);
      saveTournamentSettings(clean, stateRef.current);
      postBus({ type: 'TOURNAMENT_SETTINGS_UPDATE', settings: clean });
      setSaved(true);
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [settings, state]);

  // Estado cambiado en otra pestaña o por un comando en una fuente de OBS de este navegador
  useEffect(
    () =>
      tournamentStore().subscribe((next) => {
        if (!isNewerState(next, stateRef.current)) return;
        stateRef.current = next;
        setStateValue(next);
      }),
    []
  );

  // Ajustes cambiados en otra pestaña del panel
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === TOURNAMENT_STORAGE_KEY && !dirtyRef.current) setSettings(loadTournamentSettings());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return { settings, state, saved, updateSettings, changeState };
}
