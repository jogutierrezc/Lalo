/**
 * src/lib/widgetCloud.ts
 *
 * Lado de OBS de la sincronización. El widget no inicia sesión: lee la
 * configuración del streamer con la clave privada `k` de su URL.
 *
 * Al arrancar descarga el paquete completo y lo escribe en localStorage, que es
 * de donde ya leen todas las capas. Después pregunta cada medio minuto solo por
 * la fecha del último cambio (una respuesta mínima, para no gastar salida de
 * datos) y vuelve a descargar el paquete únicamente si cambió.
 */

import { supabase } from './supabase';
import { MODULE_STORAGE_KEYS, mergeKeepingLocalMedia } from './cloudConfig';
import type { ConfigModule, WidgetBundleResult } from './cloudTypes';
import { postBus } from '../utils/bus';
import { loadSettings } from '../types/settings';
import { loadAlertsSettings } from '../types/alerts';
import { loadGoalsSettings } from '../types/goals';
import { loadRouletteSettings } from '../types/roulette';
import { loadPollSettings } from '../types/polls';
import { loadChatSettings } from '../types/chat';
import { loadRaidSettings } from '../types/raid';
import { loadStudioSettings } from '../types/studio';

const CHECK_EVERY_MS = 30000;

/** Lee `k` de la query o del fragmento (#widget?k=...). */
export function readWidgetKey(): string | null {
  const fromSearch = new URLSearchParams(window.location.search).get('k');
  if (fromSearch) return fromSearch;
  const hash = window.location.hash;
  const at = hash.indexOf('?');
  return at === -1 ? null : new URLSearchParams(hash.slice(at + 1)).get('k');
}

/** Avisa a las capas ya montadas de que su configuración cambió. */
function announce(module: ConfigModule): void {
  if (module === 'tts') {
    postBus({ type: 'SETTINGS_UPDATE', settings: loadSettings() });
    window.dispatchEvent(new StorageEvent('storage', { key: MODULE_STORAGE_KEYS.tts }));
  }
  if (module === 'alerts') postBus({ type: 'ALERT_SETTINGS_UPDATE', settings: loadAlertsSettings() });
  if (module === 'goals') postBus({ type: 'GOALS_SETTINGS_UPDATE', settings: loadGoalsSettings() });
  if (module === 'roulette') postBus({ type: 'ROULETTE_SETTINGS_UPDATE', settings: loadRouletteSettings() });
  if (module === 'polls') postBus({ type: 'POLL_SETTINGS_UPDATE', settings: loadPollSettings() });
  if (module === 'chat') postBus({ type: 'CHAT_SETTINGS_UPDATE', settings: loadChatSettings() });
  if (module === 'raid') postBus({ type: 'RAID_SETTINGS_UPDATE', settings: loadRaidSettings() });
  if (module === 'studio') postBus({ type: 'STUDIO_SETTINGS_UPDATE', settings: loadStudioSettings() });
}

async function pullBundle(key: string, notify: boolean): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc('widget_bundle', { p_key: key });
  if (error) throw new Error(error.message);
  const bundle = data as WidgetBundleResult;
  if (!bundle) return false;

  for (const [module, storageKey] of Object.entries(MODULE_STORAGE_KEYS) as [ConfigModule, string][]) {
    const next = bundle.configs[module];
    if (next === undefined) continue;
    let changed = true;
    try {
      // Si este navegador es también el del panel, conserva sus archivos incrustados
      const current = localStorage.getItem(storageKey);
      const serialized = JSON.stringify(mergeKeepingLocalMedia(next, current ? JSON.parse(current) : undefined));
      changed = current !== serialized;
      if (changed) localStorage.setItem(storageKey, serialized);
    } catch {
      // Sin almacenamiento en la fuente de navegador: la capa usa sus valores por defecto
    }
    if (changed && notify) announce(module);
  }
  return true;
}

/**
 * Descarga la configuración antes de pintar las capas y la mantiene al día.
 * Devuelve la función para dejar de consultar.
 */
export async function startWidgetCloud(key: string): Promise<() => void> {
  if (!supabase) return () => {};
  let lastVersion: string | null = null;
  let stopped = false;

  const readVersion = async (): Promise<string | null> => {
    const { data, error } = await supabase!.rpc('widget_version', { p_key: key });
    return error ? null : ((data as string | null) ?? null);
  };

  try {
    lastVersion = await readVersion();
    await pullBundle(key, false);
  } catch (err) {
    console.error('[Lalo] No se pudo leer la configuración de la nube:', err);
  }

  const timer = setInterval(async () => {
    if (stopped) return;
    const version = await readVersion();
    if (!version || version === lastVersion) return;
    try {
      if (await pullBundle(key, true)) lastVersion = version;
    } catch (err) {
      console.error('[Lalo] No se pudo actualizar la configuración:', err);
    }
  }, CHECK_EVERY_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
