/**
 * src/lib/cloudConfig.ts
 *
 * Sincroniza la configuración de cada módulo entre este navegador y la nube.
 *
 * - El panel sigue guardando en localStorage, como siempre; cada guardado se
 *   envía además a la tabla `configs` del streamer, con una pequeña espera.
 * - Al entrar, la nube manda: lo que haya allí se escribe en localStorage antes
 *   de abrir el panel. Lo que solo exista en este navegador se sube.
 * - Los archivos incrustados (data:) no viajan: no caben en el límite por
 *   módulo. Se quedan en este navegador hasta que exista el almacén de archivos.
 */

import { supabase } from './supabase';
import { CONFIG_MAX_BYTES, type ConfigModule } from './cloudTypes';

/** Módulo → clave de localStorage que ya usa cada pantalla. */
export const MODULE_STORAGE_KEYS: Partial<Record<ConfigModule, string>> = {
  tts: 'lalo_tts_settings',
  alerts: 'lalo_alerts_settings',
  goals: 'lalo_goals_settings',
  roulette: 'lalo_roulette_settings',
  polls: 'lalo_polls_settings_v1',
  rewards: 'lalo_stream_rewards_settings',
  bot: 'lalo_twitchio_settings',
  chat: 'lalo_chat_settings',
  raid: 'lalo_raid_settings',
};

const PUSH_DELAY_MS = 1200;
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isDataUrl = (value: unknown): value is string => typeof value === 'string' && value.startsWith('data:') && value.length > 2048;

/** Copia sin archivos incrustados. `stripped` cuenta cuántos se quitaron. */
export function stripDataUrls<T>(value: T): { value: T; stripped: number } {
  let stripped = 0;
  const walk = (node: unknown): unknown => {
    if (isDataUrl(node)) {
      stripped += 1;
      return '';
    }
    if (Array.isArray(node)) return node.map(walk);
    if (isPlainObject(node)) return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, walk(child)]));
    return node;
  };
  return { value: walk(value) as T, stripped };
}

/**
 * La nube manda, salvo donde la nube trae vacío y este navegador conserva un
 * archivo incrustado: ese se mantiene para no perderlo.
 */
export function mergeKeepingLocalMedia(cloud: unknown, local: unknown): unknown {
  if ((cloud === '' || cloud === undefined || cloud === null) && isDataUrl(local)) return local;
  if (Array.isArray(cloud) && Array.isArray(local)) {
    return cloud.map((item, index) => {
      const id = isPlainObject(item) ? item.id : undefined;
      const match = id !== undefined ? local.find((entry) => isPlainObject(entry) && entry.id === id) : local[index];
      return mergeKeepingLocalMedia(item, match);
    });
  }
  if (isPlainObject(cloud) && isPlainObject(local)) {
    const keys = new Set([...Object.keys(cloud), ...Object.keys(local).filter((key) => isDataUrl(local[key]))]);
    return Object.fromEntries([...keys].map((key) => [key, mergeKeepingLocalMedia(cloud[key], local[key])]));
  }
  return cloud;
}

// ---------- Subida desde el panel ----------

let activeProfileId: string | null = null;
const timers = new Map<ConfigModule, ReturnType<typeof setTimeout>>();
const listeners = new Set<(message: string | null) => void>();

/** El panel indica qué cuenta está abierta; con null se deja de subir. */
export function setCloudProfile(profileId: string | null): void {
  activeProfileId = profileId;
  if (!profileId) {
    timers.forEach((timer) => clearTimeout(timer));
    timers.clear();
  }
}

/** Avisos de sincronización para mostrarlos en el panel (null = todo en orden). */
export function onCloudSyncMessage(listener: (message: string | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const tell = (message: string | null) => listeners.forEach((listener) => listener(message));

async function pushNow(profileId: string, module: ConfigModule, data: unknown): Promise<void> {
  if (!supabase) return;
  const { value, stripped } = stripDataUrls(data);
  if (JSON.stringify(value).length > CONFIG_MAX_BYTES) {
    tell(`La configuración de «${module}» es demasiado grande para guardarla en la nube.`);
    return;
  }
  const { error } = await supabase
    .from('configs')
    .upsert({ profile_id: profileId, module, data: value }, { onConflict: 'profile_id,module' });
  if (error) {
    tell(`No se pudo guardar «${module}» en la nube: ${error.message}`);
    return;
  }
  tell(
    stripped > 0
      ? `Guardado en la nube. ${stripped === 1 ? 'Un archivo subido se queda' : `${stripped} archivos subidos se quedan`} solo en este navegador hasta que conectemos el almacén de archivos.`
      : null
  );
}

/** Lo llaman las funciones de guardado de cada módulo. Sin cuenta abierta no hace nada. */
export function queueCloudPush(module: ConfigModule, data: unknown): void {
  const profileId = activeProfileId;
  if (!supabase || !profileId) return;
  const previous = timers.get(module);
  if (previous) clearTimeout(previous);
  timers.set(
    module,
    setTimeout(() => {
      timers.delete(module);
      pushNow(profileId, module, data).catch(() => tell(`No se pudo guardar «${module}» en la nube.`));
    }, PUSH_DELAY_MS)
  );
}

// ---------- Bajada al entrar ----------

function readLocal(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function writeLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Almacenamiento lleno o bloqueado: la pantalla usará sus valores por defecto
  }
}

/**
 * Trae la configuración de la cuenta a este navegador. Devuelve los módulos
 * que se escribieron. Lo que solo existía aquí se sube a la nube.
 */
export async function pullConfigsToLocal(profileId: string): Promise<ConfigModule[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('configs').select('module,data').eq('profile_id', profileId);
  if (error) throw new Error(error.message);

  const rows = new Map((data || []).map((row) => [row.module as ConfigModule, row.data as unknown]));
  const written: ConfigModule[] = [];

  for (const [module, key] of Object.entries(MODULE_STORAGE_KEYS) as [ConfigModule, string][]) {
    const local = readLocal(key);
    if (rows.has(module)) {
      writeLocal(key, mergeKeepingLocalMedia(rows.get(module), local));
      written.push(module);
    } else if (local !== undefined) {
      await pushNow(profileId, module, local);
    }
  }
  return written;
}
