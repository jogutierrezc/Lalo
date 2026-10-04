/**
 * src/utils/studioScenes.ts
 *
 * Operaciones sobre escenas y capas de Studio. Todas devuelven datos nuevos y
 * no tocan los que reciben, para que deshacer y rehacer sean una simple lista
 * de estados. También está aquí el historial y la URL de cada escena.
 */

import { MAX_LAYERS, MAX_SCENES, STUDIO_LIMITS, StudioLayer, StudioScene, StudioSettings, encodeScene } from '../types/studio';
import { buildSuiteWidgetUrl } from './widgetUrl';

export type ZMove = 'front' | 'forward' | 'backward' | 'back';

const cut = (name: string) => name.slice(0, STUDIO_LIMITS.name);

/** Nombre libre: «Texto», «Texto 2», «Texto 3»... */
export function uniqueName(base: string, taken: string[]): string {
  const root = base.trim() || 'Capa';
  if (!taken.includes(root)) return cut(root);
  let n = 2;
  while (taken.includes(`${root} ${n}`)) n += 1;
  return cut(`${root} ${n}`);
}

// ---------- Capas ----------

/** Añade una capa delante de todas. No hace nada si la escena ya está llena. */
export function addLayer(scene: StudioScene, layer: StudioLayer): StudioScene {
  if (scene.layers.length >= MAX_LAYERS) return scene;
  return { ...scene, layers: [layer, ...scene.layers] };
}

export function updateLayer(scene: StudioScene, id: string, patch: Partial<StudioLayer>): StudioScene {
  if (!scene.layers.some((layer) => layer.id === id)) return scene;
  return { ...scene, layers: scene.layers.map((layer) => (layer.id === id ? { ...layer, ...patch, id: layer.id, type: layer.type } : layer)) };
}

export function removeLayer(scene: StudioScene, id: string): StudioScene {
  if (!scene.layers.some((layer) => layer.id === id)) return scene;
  return { ...scene, layers: scene.layers.filter((layer) => layer.id !== id) };
}

/** Copia de una capa, justo delante de la original y un poco desplazada. */
export function duplicateLayer(scene: StudioScene, id: string, newId: string): StudioScene {
  const index = scene.layers.findIndex((layer) => layer.id === id);
  if (index === -1 || scene.layers.length >= MAX_LAYERS) return scene;
  const source = scene.layers[index];
  const copy: StudioLayer = {
    ...source,
    id: newId,
    name: uniqueName(`${source.name} copia`, scene.layers.map((layer) => layer.name)),
    x: source.x + 40,
    y: source.y + 40,
    locked: false,
  };
  const layers = [...scene.layers];
  layers.splice(index, 0, copy);
  return { ...scene, layers };
}

/** Pega una capa copiada, delante de todas. En su misma escena se desplaza para que no tape a la original. */
export function pasteLayer(scene: StudioScene, layer: StudioLayer, newId: string): StudioScene {
  if (scene.layers.length >= MAX_LAYERS) return scene;
  const overlaps = scene.layers.some((item) => item.x === layer.x && item.y === layer.y);
  const copy: StudioLayer = {
    ...layer,
    id: newId,
    name: uniqueName(layer.name, scene.layers.map((item) => item.name)),
    x: overlaps ? layer.x + 40 : layer.x,
    y: overlaps ? layer.y + 40 : layer.y,
    locked: false,
    hidden: false,
  };
  return { ...scene, layers: [copy, ...scene.layers] };
}

/** Orden de apilado. El índice 0 es la capa de delante. */
export function moveLayer(scene: StudioScene, id: string, move: ZMove): StudioScene {
  const from = scene.layers.findIndex((layer) => layer.id === id);
  if (from === -1) return scene;
  const last = scene.layers.length - 1;
  const to = move === 'front' ? 0 : move === 'back' ? last : move === 'forward' ? Math.max(0, from - 1) : Math.min(last, from + 1);
  if (to === from) return scene;
  const layers = [...scene.layers];
  const [layer] = layers.splice(from, 1);
  layers.splice(to, 0, layer);
  return { ...scene, layers };
}

// ---------- Escenas ----------

export const findScene = (settings: StudioSettings, id: string): StudioScene | undefined =>
  settings.scenes.find((scene) => scene.id === id);

export function replaceScene(settings: StudioSettings, scene: StudioScene): StudioSettings {
  const index = settings.scenes.findIndex((item) => item.id === scene.id);
  if (index === -1 || settings.scenes[index] === scene) return settings;
  const scenes = [...settings.scenes];
  scenes[index] = scene;
  return { ...settings, scenes };
}

export function addScene(settings: StudioSettings, scene: StudioScene): StudioSettings {
  if (settings.scenes.length >= MAX_SCENES) return settings;
  const name = uniqueName(scene.name, settings.scenes.map((item) => item.name));
  return { ...settings, scenes: [...settings.scenes, { ...scene, name }] };
}

export function renameScene(settings: StudioSettings, id: string, name: string): StudioSettings {
  const scene = findScene(settings, id);
  if (!scene) return settings;
  return replaceScene(settings, { ...scene, name: cut(name) });
}

/** Copia de una escena con identificadores nuevos, colocada justo después. */
export function duplicateScene(settings: StudioSettings, id: string, sceneId: string, nextId: () => string): StudioSettings {
  const index = settings.scenes.findIndex((scene) => scene.id === id);
  if (index === -1 || settings.scenes.length >= MAX_SCENES) return settings;
  const source = settings.scenes[index];
  const copy: StudioScene = {
    ...source,
    id: sceneId,
    name: uniqueName(`${source.name} copia`, settings.scenes.map((scene) => scene.name)),
    layers: source.layers.map((layer) => ({ ...layer, id: nextId() })),
  };
  const scenes = [...settings.scenes];
  scenes.splice(index + 1, 0, copy);
  return { ...settings, scenes };
}

/** Borra una escena. Siempre queda al menos una. */
export function removeScene(settings: StudioSettings, id: string): StudioSettings {
  if (settings.scenes.length <= 1 || !findScene(settings, id)) return settings;
  return { ...settings, scenes: settings.scenes.filter((scene) => scene.id !== id) };
}

export function moveScene(settings: StudioSettings, id: string, step: -1 | 1): StudioSettings {
  const from = settings.scenes.findIndex((scene) => scene.id === id);
  const to = from + step;
  if (from === -1 || to < 0 || to >= settings.scenes.length) return settings;
  const scenes = [...settings.scenes];
  [scenes[from], scenes[to]] = [scenes[to], scenes[from]];
  return { ...settings, scenes };
}

// ---------- Historial ----------

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export const HISTORY_LIMIT = 80;

export const startHistory = <T>(present: T): History<T> => ({ past: [], present, future: [] });

/**
 * Registra un cambio. Con `merge`, el cambio se suma al paso anterior (un
 * arrastre entero o una tanda de teclas son un solo paso de deshacer).
 */
export function pushHistory<T>(history: History<T>, next: T, merge = false): History<T> {
  if (next === history.present) return history;
  if (merge && history.past.length > 0) return { past: history.past, present: next, future: [] };
  return { past: [...history.past, history.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

export function undoHistory<T>(history: History<T>): History<T> {
  if (history.past.length === 0) return history;
  const past = [...history.past];
  const present = past.pop() as T;
  return { past, present, future: [history.present, ...history.future] };
}

export function redoHistory<T>(history: History<T>): History<T> {
  if (history.future.length === 0) return history;
  const [present, ...future] = history.future;
  return { past: [...history.past, history.present], present, future };
}

// ---------- URL para OBS ----------

export interface SceneUrlOptions {
  /** Clave privada del streamer. Con ella, la escena se lee de su cuenta. */
  key?: string;
  /** Ajustes del chat y del saludo de raid ya codificados, para cuando no hay cuenta. */
  chat?: string;
  raid?: string;
}

/**
 * URL de una escena. Con cuenta en la nube basta el identificador y la clave;
 * sin cuenta, la escena entera viaja en la URL, porque OBS no comparte
 * almacenamiento con el panel.
 */
export function buildSceneUrl(origin: string, channel: string, scene: StudioScene, options: SceneUrlOptions = {}): string {
  if (options.key) return buildSuiteWidgetUrl(origin, 'scene', channel, undefined, { scene: scene.id, k: options.key });
  const extra: Record<string, string> = { scene: scene.id, sc: encodeScene(scene) };
  if (options.chat && scene.layers.some((layer) => layer.type === 'chat')) extra.cs = options.chat;
  if (options.raid && scene.layers.some((layer) => layer.type === 'raid')) extra.rs = options.raid;
  return buildSuiteWidgetUrl(origin, 'scene', channel, undefined, extra);
}
