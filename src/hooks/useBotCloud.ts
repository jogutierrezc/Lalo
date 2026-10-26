/**
 * src/hooks/useBotCloud.ts
 *
 * Estado del bot de chat en la nube para el estudio de TwitchIO: ajustes,
 * comandos y conexión, todo en el servidor (por streamer). Cada fila de comando
 * se guarda sola poco después de editarla; una fila nueva solo se envía cuando
 * tiene nombre y respuesta (el servidor no admite comandos vacíos).
 *
 * Si el servidor aún no tiene comandos, se importan UNA vez los que el streamer
 * tenía en este navegador (twitchIOSettings); no se borra nada del navegador.
 * La bandera de «ya importado» guarda el id del perfil que los importó, para que
 * en un navegador compartido otra cuenta no se lleve los comandos de la primera.
 *
 * SIN PROBAR contra Twitch ni contra Supabase reales.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  botConnect,
  botDeleteCommand,
  botDisconnect,
  botSaveCommand,
  botSaveSettings,
  botStatus,
  type BotCommandView,
  type BotConnectResult,
  type BotConnectionView,
  type BotSettingsView,
} from '../lib/botApi';
import { IMPORT_FLAG, importClaim, importFinished, importNotice, isImportFailure, planCommandImport, reinsertRow, serverId } from '../utils/botCloud';
import type { TwitchIOCommand } from '../types/twitchio';

/** Una fila del editor. `id` es null mientras el servidor no la conoce. */
export interface BotRow extends Omit<BotCommandView, 'id'> {
  key: string;
  id: string | null;
  /** Último fallo al guardar esta fila; vacío si no hay. */
  error: string;
}

export type BotPhase = 'loading' | 'ready' | 'error';

const SAVE_DELAY_MS = 450;
const DEFAULT_SETTINGS: BotSettingsView = { enabled: false, prefix: '!', welcomeMessage: '' };

/** Los comandos de este navegador solo se importan si ninguna cuenta los ha llevado ya a la nube. */
function canImport(profileId: string): boolean {
  try {
    return importClaim(localStorage.getItem(IMPORT_FLAG), profileId) === 'none';
  } catch {
    return false;
  }
}

/** Anota qué cuenta importó. Una bandera ya puesta (de otra cuenta o antigua) no se pisa. */
function markImportDone(profileId: string): void {
  try {
    if (localStorage.getItem(IMPORT_FLAG) === null) localStorage.setItem(IMPORT_FLAG, profileId);
  } catch {
    // Sin almacenamiento: como mucho se intentaría otra vez, y el servidor ya no estaría vacío
  }
}

export interface LocalBotData {
  commands: TwitchIOCommand[];
  prefix: string;
  /** El streamer guardó algo alguna vez en este navegador (si no, solo hay los comandos de ejemplo). */
  hasSaved: boolean;
}

const toRow = (command: BotCommandView): BotRow => ({ ...command, key: `srv-${command.id}`, error: '' });

export function useBotCloud(active: boolean, profileId: string, local: LocalBotData) {
  const [phase, setPhase] = useState<BotPhase>('loading');
  const [loadError, setLoadError] = useState('');
  const [settings, setSettings] = useState<BotSettingsView>(DEFAULT_SETTINGS);
  const [settingsError, setSettingsError] = useState('');
  const [connection, setConnection] = useState<BotConnectionView | null>(null);
  const [rows, setRows] = useState<BotRow[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const rowsRef = useRef<BotRow[]>([]);
  const settingsRef = useRef<BotSettingsView>(DEFAULT_SETTINGS);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const chains = useRef(new Map<string, Promise<void>>());
  const settingsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsChain = useRef<Promise<void>>(Promise.resolve());
  const counter = useRef(0);
  const localRef = useRef(local);
  localRef.current = local;
  const profileRef = useRef(profileId);
  profileRef.current = profileId;
  // Cargas: van una detrás de otra y solo la última aplica su resultado (StrictMode lanza dos)
  const loadSeq = useRef(0);
  const loadChain = useRef<Promise<void>>(Promise.resolve());
  // Borrados en curso por fila, para que «Deshacer» espere a que terminen
  const deletes = useRef(new Map<string, Promise<void>>());

  const commitRows = useCallback((next: BotRow[]) => {
    rowsRef.current = next;
    setRows(next);
  }, []);

  const commitSettings = useCallback((next: BotSettingsView) => {
    settingsRef.current = next;
    setSettings(next);
  }, []);

  const patchRowLocal = useCallback(
    (key: string, patch: Partial<BotRow>) => {
      commitRows(rowsRef.current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    },
    [commitRows]
  );

  // ---------- Guardar una fila ----------
  const persist = useCallback(
    async (key: string) => {
      const row = rowsRef.current.find((item) => item.key === key);
      if (!row) return;
      // Sin nombre o sin respuesta todavía: se queda en el panel hasta que esté completa
      if (!row.name.trim() || !row.response.trim()) {
        if (row.error) patchRowLocal(key, { error: '' });
        return;
      }
      // Solo un id del servidor actualiza; uno local (no UUID) crea
      const knownId = serverId(row.id);
      const res = await botSaveCommand({
        ...(knownId ? { id: knownId } : {}),
        name: row.name,
        response: row.response,
        permission: row.permission,
        enabled: row.enabled,
        position: row.position,
      });
      const still = rowsRef.current.find((item) => item.key === key);
      if (!res.ok) {
        if (still) patchRowLocal(key, { error: res.message });
        return;
      }
      if (!still) {
        // La fila se quitó mientras se creaba: no debe quedar huérfana en el servidor
        if (!knownId) await botDeleteCommand(res.data.id);
        return;
      }
      // El servidor limpia el nombre; solo se acepta si el streamer no siguió escribiendo
      patchRowLocal(key, { id: res.data.id, error: '', ...(still.name === row.name ? { name: res.data.name } : {}) });
    },
    [patchRowLocal]
  );

  // Una fila se guarda de una en una, para que un alta no se cruce con el cambio siguiente
  const enqueue = useCallback(
    (key: string) => {
      const previous = chains.current.get(key) ?? Promise.resolve();
      chains.current.set(
        key,
        previous.then(() => persist(key)).catch(() => undefined)
      );
    },
    [persist]
  );

  const schedule = useCallback(
    (key: string, delay: number) => {
      const old = timers.current.get(key);
      if (old) clearTimeout(old);
      timers.current.set(
        key,
        setTimeout(() => {
          timers.current.delete(key);
          enqueue(key);
        }, delay)
      );
    },
    [enqueue]
  );

  // ---------- Carga ----------
  const runLoad = useCallback(
    async (seq: number) => {
      // Si llegó otra carga detrás, esta ya no sirve y no debe importar nada
      const stale = () => seq !== loadSeq.current;
      if (stale()) return;
      setPhase('loading');
      setLoadError('');
      const res = await botStatus();
      if (stale()) return;
      if (!res.ok) {
        setLoadError(res.message);
        setPhase('error');
        return;
      }
      commitSettings(res.data.settings);
      setConnection(res.data.connection);
      let loaded = res.data.commands.map(toRow);

      // Importación única de los comandos que había en el navegador
      const { commands, prefix, hasSaved } = localRef.current;
      const profile = profileRef.current;
      if (loaded.length === 0 && hasSaved && canImport(profile)) {
        const plan = planCommandImport(commands, prefix);
        let imported = 0;
        let failed = 0;
        if (plan.commands.length > 0) {
          let usedPrefix = res.data.settings.prefix;
          if (prefix !== usedPrefix) {
            const saved = await botSaveSettings({ prefix });
            if (saved.ok) {
              usedPrefix = saved.data.prefix;
              commitSettings({ ...settingsRef.current, prefix: usedPrefix });
            }
          }
          // Con otro prefijo en el servidor los nombres se vuelven a limpiar con él
          const again = usedPrefix === prefix ? plan : planCommandImport(commands, usedPrefix);
          for (const command of again.commands) {
            const saved = await botSaveCommand(command);
            if (saved.ok) {
              loaded = [...loaded, toRow(saved.data)];
              imported += 1;
            } else if (isImportFailure(saved.code)) {
              failed += 1;
            }
          }
          if (imported > 0) setNotice(importNotice(imported, again.skipped + (again.commands.length - imported)));
        }
        // Solo se da por hecha si pasó algo o nada falló: tras un fallo de red se reintenta la próxima vez
        if (importFinished(imported, failed)) markImportDone(profile);
      } else if (loaded.length > 0) {
        markImportDone(profile);
      }

      if (stale()) return;
      commitRows(loaded);
      setPhase('ready');
    },
    [commitRows, commitSettings]
  );

  const load = useCallback((): Promise<void> => {
    loadSeq.current += 1;
    const seq = loadSeq.current;
    const run = loadChain.current.then(() => runLoad(seq)).catch(() => undefined);
    loadChain.current = run;
    return run;
  }, [runLoad]);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  // Al salir de la página, lo que esté a medias de guardar se envía
  useEffect(() => {
    const pending = timers.current;
    const settingsPending = settingsTimer;
    return () => {
      pending.forEach((timer, key) => {
        clearTimeout(timer);
        enqueue(key);
      });
      pending.clear();
      if (settingsPending.current) {
        clearTimeout(settingsPending.current);
        void botSaveSettings({ prefix: settingsRef.current.prefix, welcomeMessage: settingsRef.current.welcomeMessage });
      }
    };
  }, [enqueue]);

  // ---------- Comandos ----------
  const addRow = useCallback((): string => {
    counter.current += 1;
    const key = `new-${Date.now()}-${counter.current}`;
    const position = rowsRef.current.reduce((max, row) => Math.max(max, row.position + 1), 0);
    commitRows([...rowsRef.current, { key, id: null, name: '', response: '', permission: 'all', enabled: true, position, error: '' }]);
    return key;
  }, [commitRows]);

  const patchRow = useCallback(
    (key: string, patch: Partial<Pick<BotRow, 'name' | 'response' | 'permission' | 'enabled'>>) => {
      patchRowLocal(key, { ...patch, error: '' });
      schedule(key, 'enabled' in patch || 'permission' in patch ? 0 : SAVE_DELAY_MS);
    },
    [patchRowLocal, schedule]
  );

  const removeRow = useCallback(
    async (key: string) => {
      const row = rowsRef.current.find((item) => item.key === key);
      if (!row) return;
      const pending = timers.current.get(key);
      if (pending) clearTimeout(pending);
      timers.current.delete(key);
      commitRows(rowsRef.current.filter((item) => item.key !== key));
      const id = serverId(row.id);
      if (!id) return;
      const task = (async () => {
        const res = await botDeleteCommand(id);
        if (!res.ok) {
          // No se borró: vuelve a la lista (sin repetir clave ni nombre) y se dice
          commitRows(reinsertRow(rowsRef.current, row));
          setNotice(`No se pudo quitar el comando: ${res.message}`);
        }
      })();
      deletes.current.set(key, task);
      try {
        await task;
      } finally {
        if (deletes.current.get(key) === task) deletes.current.delete(key);
      }
    },
    [commitRows]
  );

  /** Devuelve la lista a como estaba. Espera a los borrados en curso; las filas ya borradas se crean otra vez. */
  const restoreRows = useCallback(
    async (snapshot: BotRow[]) => {
      await Promise.all([...deletes.current.values()]);
      const present = new Set(rowsRef.current.map((row) => row.key));
      const next = snapshot.map((row) => (present.has(row.key) ? (rowsRef.current.find((item) => item.key === row.key) as BotRow) : { ...row, id: null, error: '' }));
      commitRows(next);
      snapshot.filter((row) => !present.has(row.key)).forEach((row) => enqueue(row.key));
    },
    [commitRows, enqueue]
  );

  // ---------- Ajustes ----------
  /** Guarda los ajustes de ahora; una petición detrás de otra para que no se crucen. */
  const saveSettingsNow = useCallback((): Promise<void> => {
    const task = settingsChain.current.then(async () => {
      const res = await botSaveSettings({ prefix: settingsRef.current.prefix, welcomeMessage: settingsRef.current.welcomeMessage });
      setSettingsError(res.ok ? '' : res.message);
    });
    settingsChain.current = task.catch(() => undefined);
    return settingsChain.current;
  }, []);

  const patchSettings = useCallback(
    (patch: Partial<Pick<BotSettingsView, 'prefix' | 'welcomeMessage'>>) => {
      commitSettings({ ...settingsRef.current, ...patch });
      setSettingsError('');
      if (settingsTimer.current) clearTimeout(settingsTimer.current);
      settingsTimer.current = setTimeout(() => {
        settingsTimer.current = null;
        void saveSettingsNow();
      }, SAVE_DELAY_MS);
    },
    [commitSettings, saveSettingsNow]
  );

  /** Envía ya lo que esté esperando (ajustes y filas) y espera a que acabe todo lo que va en camino. */
  const flushPending = useCallback(async () => {
    if (settingsTimer.current) {
      clearTimeout(settingsTimer.current);
      settingsTimer.current = null;
      void saveSettingsNow();
    }
    timers.current.forEach((timer, key) => {
      clearTimeout(timer);
      enqueue(key);
    });
    timers.current.clear();
    await settingsChain.current;
    await Promise.all([...chains.current.values()]);
  }, [enqueue, saveSettingsNow]);

  // ---------- Conexión ----------
  const connect = useCallback(async (): Promise<BotConnectResult | { error: string }> => {
    setBusy(true);
    try {
      // El prefijo o una fila a medio guardar deben estar en el servidor antes de conectar
      await flushPending();
      const res = await botConnect();
      if (!res.ok) {
        // Sin escucha del chat en el servidor: el paso 2 queda «no disponible» y no se insiste
        if (res.code === 'chat_unavailable') setConnection((old) => (old ? { ...old, chat: 'unavailable' } : old));
        return { error: res.message };
      }
      commitSettings({ ...settingsRef.current, enabled: res.data.settings.enabled });
      setConnection(res.data.connection);
      return res.data;
    } finally {
      setBusy(false);
    }
  }, [commitSettings, flushPending]);

  const disconnect = useCallback(async (): Promise<string> => {
    setBusy(true);
    try {
      await flushPending();
      const res = await botDisconnect();
      if (!res.ok) return res.message;
      commitSettings({ ...settingsRef.current, enabled: res.data.settings.enabled });
      setConnection(res.data.connection);
      return res.data.removed ? '' : 'Twitch no dejó apagar la escucha del chat. Prueba de nuevo en un momento.';
    } finally {
      setBusy(false);
    }
  }, [commitSettings, flushPending]);

  /** Vuelve a leer el estado de la conexión (sin tocar la lista que se está editando). Devuelve el fallo, si lo hay. */
  const refreshConnection = useCallback(async (): Promise<string> => {
    const res = await botStatus();
    if (!res.ok) return res.message;
    setConnection(res.data.connection);
    commitSettings({ ...settingsRef.current, enabled: res.data.settings.enabled });
    return '';
  }, [commitSettings]);

  return {
    phase,
    loadError,
    reload: load,
    settings,
    settingsError,
    patchSettings,
    connection,
    rows,
    addRow,
    patchRow,
    removeRow,
    restoreRows,
    notice,
    clearNotice: () => setNotice(''),
    busy,
    connect,
    disconnect,
    refreshConnection,
  };
}
