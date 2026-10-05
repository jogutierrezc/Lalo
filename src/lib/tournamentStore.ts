/**
 * src/lib/tournamentStore.ts
 *
 * El almacén del ESTADO VIVO de «Torneos» (equipos, resultados, pantalla). La
 * capa de OBS y la página del panel solo hablan con esta interfaz: leer,
 * escribir y suscribirse. Para llevar el estado a la nube basta con escribir
 * otro TournamentStore y entregarlo con setTournamentStore; ni la capa ni la
 * página cambian.
 *
 * El almacén de hoy (localTournamentStore):
 * - Guarda en localStorage (`lalo_tournament_state`) y avisa por el bus, así que
 *   el panel y las fuentes de OBS abiertas en ESTE navegador ven lo mismo.
 * - A un OBS en otro equipo el estado le llega como copia dentro de los ajustes
 *   sincronizados (ver types/tournament.ts). Solo viaja del panel a OBS.
 * - Entre dos estados gana el más nuevo (fecha y, a igual fecha, versión). Con
 *   el panel y OBS en equipos distintos eso depende de que sus relojes vayan a
 *   la par; unos segundos de diferencia solo importan si los dos cambian algo a
 *   la vez.
 *
 * LÍMITE del almacén local: un comando escrito en el chat lo atiende la fuente
 * de OBS y cambia el estado de SU navegador. Si ese navegador no es el del
 * panel, la página del panel no se entera. Con la nube encendida y una cuenta
 * activa se usa el almacén de lib/tournamentCloud.ts, que no tiene ese límite:
 * App.tsx lo entrega con setTournamentStore (al panel, por la sesión; a la
 * fuente de OBS, por la clave `k` de su URL).
 */

import { TOURNAMENT_STATE_KEY, TOURNAMENT_STORAGE_KEY, loadSyncedTournamentState, normalizeTournamentState, type TournamentState } from '../types/tournament';
import { listenBus, postBus } from '../utils/bus';
import { isNewerState } from '../utils/tournamentLogic';

export interface TournamentStore {
  /** El estado guardado, o null si aún no hay ninguno. */
  read: () => TournamentState | null;
  /** Guarda el estado y avisa a quien esté suscrito en otras pestañas o fuentes. */
  write: (state: TournamentState) => void;
  /**
   * Avisa de cada estado que llega de fuera. Devuelve la función para dejar de
   * escuchar. Con `forced`, el estado es el vigente en la nube y hay que
   * adoptarlo aunque su fecha sea anterior a la del que se tiene (un cambio
   * local que la nube rechazó).
   */
  subscribe: (listener: (state: TournamentState, forced?: boolean) => void) => () => void;
  /**
   * true cuando el estado vive en la nube y esta responde (lib/tournamentCloud.ts).
   * Entonces la copia del estado deja de viajar dentro de los ajustes y de la URL de OBS.
   */
  cloud?: () => boolean;
}

function readLocal(): TournamentState | null {
  try {
    const raw = localStorage.getItem(TOURNAMENT_STATE_KEY);
    return raw ? normalizeTournamentState(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** El más nuevo entre lo guardado aquí y la copia que trajeron los ajustes sincronizados. */
function readNewest(): TournamentState | null {
  const local = readLocal();
  const synced = loadSyncedTournamentState();
  if (!local || !synced) return local ?? synced;
  return isNewerState(synced, local) ? synced : local;
}

export const localTournamentStore: TournamentStore = {
  read: readNewest,
  write: (state) => {
    try {
      localStorage.setItem(TOURNAMENT_STATE_KEY, JSON.stringify(state));
    } catch {
      // Sin almacenamiento (fuente de navegador restringida): el estado dura lo que dure la página
    }
    postBus({ type: 'TOURNAMENT_STATE_UPDATE', state });
  },
  subscribe: (listener) => {
    const stopBus = listenBus((message) => {
      if (message.type === 'TOURNAMENT_STATE_UPDATE') listener(normalizeTournamentState(message.state));
      // La nube entregó ajustes nuevos: dentro puede venir un estado más reciente
      if (message.type === 'TOURNAMENT_SETTINGS_UPDATE') {
        const newest = readNewest();
        if (newest) listener(newest);
      }
    });
    const onStorage = (event: StorageEvent) => {
      if (event.key !== TOURNAMENT_STATE_KEY && event.key !== TOURNAMENT_STORAGE_KEY) return;
      const newest = readNewest();
      if (newest) listener(newest);
    };
    window.addEventListener('storage', onStorage);
    return () => {
      stopBus();
      window.removeEventListener('storage', onStorage);
    };
  },
};

let active: TournamentStore = localTournamentStore;

/** El almacén en uso. */
export const tournamentStore = (): TournamentStore => active;

/** Cambia el almacén (por ejemplo, por uno que guarde en la nube). Hay que llamarlo antes de montar la capa o la página. */
export function setTournamentStore(store: TournamentStore): void {
  active = store;
}
