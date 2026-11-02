/**
 * src/components/shell/windowStore.tsx
 *
 * Estado de las ventanas internas: cuáles están abiertas, minimizadas o
 * maximizadas y cuál va delante. Vive en el cascarón (no en cada vista), así
 * que las ventanas persisten al cambiar de vista. Máximo MAX_WINDOWS a la vez.
 *
 * El elemento que abrió una ventana se guarda aparte para devolverle el foco al
 * cerrarla.
 */

import React, { createContext, useCallback, useContext, useMemo, useReducer, useRef } from 'react';

export const MAX_WINDOWS = 3;

export interface WinState {
  /** Id de la herramienta: solo hay una ventana por herramienta. */
  id: string;
  minimized: boolean;
  maximized: boolean;
  z: number;
  /** Punto desde el que se anima la apertura, relativo a la capa de ventanas. */
  origin: { x: number; y: number } | null;
  /** Se incrementa para repetir la animación de entrada al restaurar. */
  restoreTick: number;
}

interface State {
  wins: WinState[];
  z: number;
}

type Action =
  | { type: 'open'; id: string; origin: WinState['origin'] }
  | { type: 'close'; id: string }
  | { type: 'minimize'; id: string }
  | { type: 'toggleMax'; id: string }
  | { type: 'focus'; id: string };

export function windowsReducer(state: State, action: Action): State {
  const has = state.wins.some((w) => w.id === action.id);
  switch (action.type) {
    case 'open': {
      const z = state.z + 1;
      if (has) {
        return {
          z,
          wins: state.wins.map((w) => (w.id === action.id ? { ...w, z, minimized: false, restoreTick: w.minimized ? w.restoreTick + 1 : w.restoreTick } : w)),
        };
      }
      if (state.wins.length >= MAX_WINDOWS) return state;
      return { z, wins: [...state.wins, { id: action.id, minimized: false, maximized: false, z, origin: action.origin, restoreTick: 0 }] };
    }
    case 'close':
      return { ...state, wins: state.wins.filter((w) => w.id !== action.id) };
    case 'minimize':
      return { ...state, wins: state.wins.map((w) => (w.id === action.id ? { ...w, minimized: true } : w)) };
    case 'toggleMax': {
      const z = state.z + 1;
      return { z, wins: state.wins.map((w) => (w.id === action.id ? { ...w, maximized: !w.maximized, z } : w)) };
    }
    case 'focus': {
      if (!has) return state;
      const z = state.z + 1;
      return { z, wins: state.wins.map((w) => (w.id === action.id ? { ...w, z } : w)) };
    }
  }
}

interface WindowsApi {
  wins: WinState[];
  /** Abre (o trae al frente) la ventana de una herramienta. Devuelve false si ya hay MAX_WINDOWS abiertas. */
  open: (id: string, opener?: HTMLElement | null) => boolean;
  close: (id: string) => void;
  minimize: (id: string) => void;
  toggleMax: (id: string) => void;
  focus: (id: string) => void;
  /** La ventana visible que está más al frente. */
  topId: () => string | null;
  openerOf: (id: string) => HTMLElement | null;
}

const WindowsContext = createContext<WindowsApi | null>(null);

export const WindowsProvider: React.FC<{ children: React.ReactNode; layerRef?: React.RefObject<HTMLElement | null> }> = ({ children, layerRef }) => {
  const [state, dispatch] = useReducer(windowsReducer, { wins: [], z: 10 });
  const stateRef = useRef(state);
  stateRef.current = state;
  const openers = useRef(new Map<string, HTMLElement>());

  const open = useCallback(
    (id: string, opener?: HTMLElement | null) => {
      const current = stateRef.current;
      if (!current.wins.some((w) => w.id === id) && current.wins.length >= MAX_WINDOWS) return false;
      const el = opener ?? (document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null);
      if (el && !current.wins.some((w) => w.id === id)) openers.current.set(id, el);
      let origin: WinState['origin'] = null;
      const layer = layerRef?.current;
      if (el && layer) {
        const r = el.getBoundingClientRect();
        const l = layer.getBoundingClientRect();
        origin = { x: r.left - l.left + r.width / 2, y: r.top - l.top + r.height / 2 };
      }
      dispatch({ type: 'open', id, origin });
      return true;
    },
    [layerRef]
  );

  const api = useMemo<WindowsApi>(
    () => ({
      wins: state.wins,
      open,
      close: (id) => dispatch({ type: 'close', id }),
      minimize: (id) => dispatch({ type: 'minimize', id }),
      toggleMax: (id) => dispatch({ type: 'toggleMax', id }),
      focus: (id) => dispatch({ type: 'focus', id }),
      topId: () => {
        const visible = stateRef.current.wins.filter((w) => !w.minimized).sort((a, b) => b.z - a.z);
        return visible[0]?.id ?? null;
      },
      openerOf: (id) => openers.current.get(id) ?? null,
    }),
    [state.wins, open]
  );

  return <WindowsContext.Provider value={api}>{children}</WindowsContext.Provider>;
};

export function useWindows(): WindowsApi {
  const ctx = useContext(WindowsContext);
  if (!ctx) throw new Error('useWindows debe usarse dentro de WindowsProvider.');
  return ctx;
}
