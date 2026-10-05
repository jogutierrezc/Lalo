/**
 * src/lib/tournamentCloud.ts
 *
 * El almacén del ESTADO VIVO de «Torneos» en la nube: otro TournamentStore
 * (lib/tournamentStore.ts) que guarda en `tournament_state`
 * (supabase/migrations/0017_tournament_cloud.sql). Con él, lo que marca el
 * panel llega a OBS en otro equipo y un «!ganador» escrito en el chat, que
 * atiende la fuente de OBS, llega al panel.
 *
 * Dos caminos hasta la misma fila:
 * - Panel (con sesión): lee y escribe la tabla; la RLS solo le deja la suya.
 * - Fuente de OBS (con la clave `k`): widget_tournament_state y
 *   widget_tournament_apply.
 *
 * Cómo se evita pisar un resultado:
 * - La fila lleva una VERSIÓN que sube de uno en uno. Quien escribe dice sobre
 *   qué versión lo hizo; si ya no es la vigente, la escritura se rechaza.
 * - Manda la nube. Un cambio local rechazado se descarta y quien escucha
 *   recibe el estado vigente como obligado (segundo argumento del aviso):
 *   se adopta aunque su fecha sea anterior a la del cambio descartado.
 * - Los relojes del panel y de OBS dejan de importar: el orden lo da la versión.
 *
 * Se entera de los cambios ajenos preguntando cada pocos segundos, y solo
 * mientras alguien escucha (la página «Torneos» abierta o la capa montada en
 * OBS). La pregunta lleva la versión que ya se tiene: si no cambió, la
 * respuesta es mínima.
 *
 * Si la nube no responde (sin conexión, o la migración 0017 sin aplicar), el
 * almacén se comporta como el local: guarda en este navegador, reenvía lo que
 * le llega por el bus y `cloud()` devuelve false, con lo que la copia del
 * estado vuelve a viajar dentro de los ajustes (types/tournament.ts). Lo
 * pendiente se reintenta en la siguiente consulta.
 *
 * SIN PROBAR contra Supabase real: la migración 0017 no se ha ejecutado.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeTournamentState, type TournamentState } from '../types/tournament';
import { supabase } from './supabase';
import { localTournamentStore, setTournamentStore, tournamentStore, type TournamentStore } from './tournamentStore';

/** Cada cuánto se pregunta por cambios ajenos. */
export const TOURNAMENT_POLL_MS = 3000;
/** Lo máximo que la fuente de OBS espera a la primera lectura antes de pintar. */
const PRIME_TIMEOUT_MS = 2500;

/** Lo que hay en la nube. Sin `state`: la versión es la que ya se tenía. `state: null`: aún no hay estado guardado. */
export interface CloudSnapshot {
  version: number;
  state?: TournamentState | null;
}

export type PushResult =
  | { kind: 'ok'; version: number }
  /** Otro escribió antes: este es el estado vigente. */
  | { kind: 'conflict'; version: number; state: TournamentState | null }
  /** La nube no lo admitió ahora (tope por minuto, sin conexión…): se reintenta. */
  | { kind: 'retry' };

/** Cómo se llega a la fila del estado. */
export interface TournamentTransport {
  /** `have` es la versión que ya se tiene. null si la consulta falló. */
  pull: (have: number | null) => Promise<CloudSnapshot | null>;
  push: (state: TournamentState, baseVersion: number) => Promise<PushResult>;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const versionOf = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null);
const stateOf = (value: unknown): TournamentState | null => (isObject(value) ? normalizeTournamentState(value) : null);

// ---------- Fuente de OBS: funciones con la clave de widget ----------

export function widgetTransport(client: SupabaseClient, key: string): TournamentTransport {
  return {
    pull: async (have) => {
      const { data, error } = await client.rpc('widget_tournament_state', { p_key: key, p_have: have });
      // data null: la clave no vale o la cuenta no está activa
      if (error || !isObject(data)) return null;
      const version = versionOf(data.version);
      if (version === null) return null;
      return 'state' in data ? { version, state: stateOf(data.state) } : { version };
    },
    push: async (state, baseVersion) => {
      const { data, error } = await client.rpc('widget_tournament_apply', { p_key: key, p_state: state, p_base_version: baseVersion });
      if (error || !isObject(data)) return { kind: 'retry' };
      const version = versionOf(data.version);
      if (data.ok === true && version !== null) return { kind: 'ok', version };
      if (data.code === 'conflict' && version !== null) return { kind: 'conflict', version, state: stateOf(data.state) };
      return { kind: 'retry' };
    },
  };
}

// ---------- Panel: la tabla, con la sesión del streamer ----------

/** Código de PostgreSQL para «ya existe una fila con esa clave». */
const UNIQUE_VIOLATION = '23505';

export function panelTransport(client: SupabaseClient, profileId: string): TournamentTransport {
  const table = () => client.from('tournament_state');
  const pull = async (have: number | null): Promise<CloudSnapshot | null> => {
    if (have !== null && have > 0) {
      // Primero solo la versión: casi siempre no ha cambiado nada
      const head = await table().select('version').eq('profile_id', profileId).maybeSingle();
      if (head.error) return null;
      if (!head.data) return { version: 0, state: null };
      if (versionOf((head.data as { version?: unknown }).version) === have) return { version: have };
    }
    const { data, error } = await table().select('state, version').eq('profile_id', profileId).maybeSingle();
    if (error) return null;
    if (!data) return { version: 0, state: null };
    const row = data as { state?: unknown; version?: unknown };
    const version = versionOf(row.version);
    return version === null ? null : { version, state: stateOf(row.state) };
  };
  /** La escritura no entró: se lee qué hay y se devuelve como conflicto. */
  const conflict = async (): Promise<PushResult> => {
    const now = await pull(null);
    return now ? { kind: 'conflict', version: now.version, state: now.state ?? null } : { kind: 'retry' };
  };
  return {
    pull,
    push: async (state, baseVersion) => {
      if (baseVersion === 0) {
        const { error } = await table().insert({ profile_id: profileId, state, version: 1 });
        if (!error) return { kind: 'ok', version: 1 };
        return error.code === UNIQUE_VIOLATION ? conflict() : { kind: 'retry' };
      }
      // Solo cambia la fila si sigue en la versión sobre la que se hizo el cambio
      const { data, error } = await table()
        .update({ state, version: baseVersion + 1 })
        .eq('profile_id', profileId)
        .eq('version', baseVersion)
        .select('version');
      if (error) return { kind: 'retry' };
      return Array.isArray(data) && data.length === 1 ? { kind: 'ok', version: baseVersion + 1 } : conflict();
    },
  };
}

// ---------- El almacén ----------

export interface CloudTournamentStore extends TournamentStore {
  /** Una primera lectura de la nube, para pintar ya con el estado vigente. No lanza errores. */
  prime: () => Promise<void>;
  /** Lo que queda por hacer termina: sirve a las pruebas y a quien quiera esperar a que se guarde. */
  settled: () => Promise<void>;
  /** Deja de consultar. */
  stop: () => void;
}

export interface CloudStoreOptions {
  /** Dónde se guarda la copia de este navegador. Por defecto, el almacén local. */
  local?: TournamentStore;
  pollMs?: number;
  /** Panel: si la nube aún no tiene estado, sube el de este navegador. */
  seed?: boolean;
  /** Panel: con la pestaña oculta no se consulta. Las fuentes de OBS consultan siempre. */
  pauseHidden?: boolean;
}

export function createCloudTournamentStore(transport: TournamentTransport, options: CloudStoreOptions = {}): CloudTournamentStore {
  const local = options.local ?? localTournamentStore;
  const pollMs = options.pollMs ?? TOURNAMENT_POLL_MS;
  const listeners = new Set<(state: TournamentState, forced?: boolean) => void>();

  /** El estado vigente que se conoce: el de la nube o, hasta que responda, el de este navegador. */
  let current: TournamentState | null = null;
  /** Versión de la fila que se conoce. null: la nube aún no ha respondido. */
  let version: number | null = null;
  /** true mientras la última llamada a la nube saliera bien. */
  let linked = false;
  /** El cambio local más reciente que falta por subir. */
  let pending: TournamentState | null = null;
  let busy: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopLocal: (() => void) | null = null;
  let stopped = false;

  const hidden = () => options.pauseHidden === true && typeof document !== 'undefined' && document.visibilityState === 'hidden';

  /** El estado de la nube pasa a ser el de aquí, lo quiera o no quien escucha. */
  const adopt = (state: TournamentState) => {
    current = state;
    // Copia en este navegador: es lo que se ve al recargar sin conexión, y avisa a las fuentes sin clave abiertas aquí
    local.write(state);
    listeners.forEach((listener) => listener(state, true));
  };

  const send = async (): Promise<void> => {
    while (pending && !stopped) {
      const sent = pending;
      pending = null;
      if (version === null) {
        // Antes de escribir hay que saber sobre qué versión se escribe
        const snap = await transport.pull(null);
        if (!snap) {
          linked = false;
          pending = pending ?? sent;
          return;
        }
        version = snap.version;
        linked = true;
        if (snap.version > 0 && snap.state) {
          // Ya había un estado en la nube que aquí no se conocía: gana él
          pending = null;
          adopt(snap.state);
          return;
        }
      }
      const result = await transport.push(sent, version);
      if (result.kind === 'ok') {
        version = result.version;
        linked = true;
      } else if (result.kind === 'conflict') {
        version = result.version;
        linked = true;
        if (result.state) {
          // Lo local se descarta, también lo que se hubiera hecho mientras tanto: salía de un estado ya superado
          pending = null;
          adopt(result.state);
        } else {
          // La fila ya no existe: lo de aquí se sube como nuevo
          pending = pending ?? sent;
        }
      } else {
        linked = false;
        pending = pending ?? sent;
        return;
      }
    }
  };

  const check = async (): Promise<void> => {
    const snap = await transport.pull(version);
    // Si mientras tanto hubo un cambio local, su escritura dirá quién gana
    if (pending || stopped) return;
    if (!snap) {
      linked = false;
      return;
    }
    linked = true;
    const changed = snap.version !== version;
    version = snap.version;
    if (changed && snap.state) adopt(snap.state);
    else if (snap.version === 0 && options.seed) {
      const mine = current ?? local.read();
      // Primera vez con la nube: la llave que ya había en este navegador se sube tal cual
      if (mine && mine.teams.length > 0) {
        current = mine;
        pending = mine;
        await send();
      }
    }
  };

  /** Una tarea cada vez: escribir lo pendiente o, si no hay nada, preguntar. */
  const run = (): Promise<void> => {
    if (!busy) {
      busy = (pending ? send() : check())
        .catch(() => {
          linked = false;
        })
        .finally(() => {
          busy = null;
        });
    }
    return busy;
  };

  const onVisible = () => {
    if (!hidden() && !stopped) void run();
  };

  const startPolling = () => {
    if (timer || stopped) return;
    timer = setInterval(() => {
      if (!hidden()) void run();
    }, pollMs);
    // Mientras la nube no responde, este almacén reenvía lo que el local recibe (bus y ajustes sincronizados)
    stopLocal = local.subscribe((state) => {
      if (linked) return;
      listeners.forEach((listener) => listener(state));
    });
    if (options.pauseHidden && typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    void run();
  };

  const stopPolling = () => {
    if (timer) clearInterval(timer);
    timer = null;
    stopLocal?.();
    stopLocal = null;
    if (options.pauseHidden && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
  };

  return {
    read: () => current ?? local.read(),
    write: (state) => {
      current = state;
      local.write(state);
      pending = state;
      // Si hay una tarea en marcha, al terminar se sube lo pendiente
      void run().then(() => {
        if (pending && !stopped) void run();
      });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      startPolling();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stopPolling();
      };
    },
    cloud: () => linked,
    prime: () => run(),
    settled: async () => {
      while (busy) await busy;
      if (pending && !stopped) {
        await run();
        while (busy) await busy;
      }
    },
    stop: () => {
      stopped = true;
      stopPolling();
    },
  };
}

// ---------- Qué almacén le toca a cada página ----------

/** El almacén de una fuente de OBS: el de la nube si hay nube y clave; si no, el local de siempre. */
export function widgetTournamentStore(client: SupabaseClient | null, key: string | null | undefined): TournamentStore {
  // La misma comprobación que hace la base: una clave más corta no es una clave
  if (!client || !key || key.length < 32) return localTournamentStore;
  return createCloudTournamentStore(widgetTransport(client, key));
}

const isCloudStore = (store: TournamentStore): store is CloudTournamentStore => typeof (store as Partial<CloudTournamentStore>).stop === 'function';

/**
 * Fuente de OBS: pone el almacén de la nube antes de montar las capas y espera
 * (poco) a la primera lectura, para que la llave salga ya con el estado
 * vigente y el narrador no cuente como nuevo lo que ya estaba. Devuelve la
 * función para dejar de consultar. Sin nube o sin clave no cambia nada.
 */
export async function startWidgetTournament(key: string | null): Promise<() => void> {
  const store = widgetTournamentStore(supabase, key);
  if (!isCloudStore(store)) return () => {};
  setTournamentStore(store);
  await Promise.race([store.prime(), new Promise<void>((resolve) => setTimeout(resolve, PRIME_TIMEOUT_MS))]);
  return () => {
    store.stop();
    if (tournamentStore() === store) setTournamentStore(localTournamentStore);
  };
}

let panel: { profileId: string; store: CloudTournamentStore } | null = null;

/**
 * Panel: deja puesto el almacén de la nube de la cuenta que ha entrado, o el
 * local si no hay ninguna (`profileId` null). Se puede llamar en cada pintado:
 * si la cuenta es la misma no hace nada. Hay que llamarlo antes de montar la
 * página «Torneos», que lee el almacén al montarse.
 */
export function selectPanelTournamentStore(profileId: string | null): void {
  if ((panel?.profileId ?? null) === profileId) return;
  if (panel) {
    panel.store.stop();
    if (tournamentStore() === panel.store) setTournamentStore(localTournamentStore);
    panel = null;
  }
  if (!profileId || !supabase) return;
  const store = createCloudTournamentStore(panelTransport(supabase, profileId), { seed: true, pauseHidden: true });
  panel = { profileId, store };
  setTournamentStore(store);
}
