/**
 * src/types/studio.ts
 *
 * Modelo de Studio, el editor de escenas. Una escena es una lista de capas
 * colocadas en un lienzo de 1920 × 1080; la primera de la lista es la que queda
 * delante. Cada escena tiene su propia URL para OBS.
 *
 * Todo lo leído (de este navegador, de la nube o de la URL) pasa por
 * normalizeStudioSettings. Las capas de un tipo que esta versión no conoce no
 * se dibujan, pero se conservan tal cual en `extra` para no perderlas.
 */

import { queueCloudPush } from '../lib/cloudConfig';
import { decodeBase64Url, encodeBase64Url } from '../utils/appearance';
import { CHAT_FONTS, ChatFont } from './chat';

export const STAGE_W = 1920;
export const STAGE_H = 1080;
/** Lado mínimo de una capa, en píxeles del lienzo. */
export const MIN_SIZE = 40;
export const MAX_SCENES = 12;
export const MAX_LAYERS = 40;
export const STUDIO_VERSION = 1;

export type LaloLayerType = 'alert' | 'goal' | 'chat' | 'raid';
export type BasicLayerType = 'text' | 'shape' | 'cam' | 'timer' | 'image';
export type LayerType = LaloLayerType | BasicLayerType;
export type AnimId = 'none' | 'fade' | 'up' | 'side' | 'wipe' | 'pop';

export interface LayerTypeInfo {
  id: LayerType;
  name: string;
  w: number;
  h: number;
  /** Capa de Lalo: sus ajustes viven en su propia página del panel. */
  page?: { href: string; label: string };
}

export const LAYER_TYPES: LayerTypeInfo[] = [
  { id: 'alert', name: 'Alerta', w: 620, h: 150, page: { href: '#alertas', label: 'Alertas' } },
  { id: 'goal', name: 'Meta', w: 640, h: 120, page: { href: '#metas', label: 'Metas' } },
  { id: 'chat', name: 'Chat', w: 480, h: 360, page: { href: '#chat', label: 'Chat' } },
  { id: 'raid', name: 'Saludo de raid', w: 760, h: 210, page: { href: '#raid', label: 'Raids' } },
  { id: 'cam', name: 'Marco de cámara', w: 520, h: 300 },
  { id: 'text', name: 'Texto', w: 560, h: 110 },
  { id: 'shape', name: 'Forma', w: 400, h: 160 },
  { id: 'image', name: 'Imagen o vídeo', w: 360, h: 360 },
  { id: 'timer', name: 'Temporizador', w: 300, h: 120 },
];

export const ANIMS: { id: AnimId; name: string }[] = [
  { id: 'none', name: 'Ninguna' },
  { id: 'fade', name: 'Aparecer' },
  { id: 'up', name: 'Subir' },
  { id: 'side', name: 'Entrar de lado' },
  { id: 'wipe', name: 'Cortina' },
  { id: 'pop', name: 'Crecer' },
];

export type TextAlign = 'l' | 'c' | 'r';
export type TextLegibility = 'none' | 'outline' | 'shadow';

export interface TextProps {
  content: string;
  font: ChatFont;
  weight: number; // de 400 a 800
  size: number; // píxeles del lienzo
  align: TextAlign;
  color: string;
  upper: boolean;
  legibility: TextLegibility;
}

export interface ShapeProps {
  fill: string;
  filled: boolean;
  border: string;
  borderWidth: number; // píxeles del lienzo; 0 = sin borde
  radius: number;
}

export interface CamProps {
  color: string;
  thickness: number;
  radius: number;
  label: boolean;
  labelText: string;
}

export type TimerMode = 'down' | 'up';
export type TimerFormat = 'mmss' | 'hmmss';
export type TimerAtZero = 'zero' | 'text' | 'hide';

export interface TimerProps {
  mode: TimerMode;
  minutes: number; // solo en cuenta atrás
  format: TimerFormat;
  atZero: TimerAtZero;
  endText: string;
  color: string;
  plate: boolean;
}

export interface MediaProps {
  url: string;
  kind: 'image' | 'video';
  fit: 'contain' | 'cover';
  loop: boolean;
  muted: boolean;
  /** Nombre del archivo subido, para enseñarlo en el inspector. Vacío si es una dirección pegada. */
  name: string;
  /** Archivo del almacén de la cuenta, para liberarlo al cambiarlo o quitarlo. */
  mediaId: string;
}

/** Posición aleatoria: la caja de la capa es la zona y esto, el tamaño del aviso. */
export interface RandomProps {
  enabled: boolean;
  w: number;
  h: number;
}

export interface StudioLayer {
  id: string;
  type: LayerType;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number; // de 10 a 100
  hidden: boolean;
  locked: boolean;
  keepRatio: boolean;
  enter: AnimId;
  exit: AnimId;
  delay: number; // segundos
  duration: number; // segundos
  text?: TextProps;
  shape?: ShapeProps;
  cam?: CamProps;
  timer?: TimerProps;
  media?: MediaProps;
  random?: RandomProps;
}

export interface StudioScene {
  id: string;
  name: string;
  layers: StudioLayer[];
  /** Capas de tipos desconocidos: se guardan sin tocar y no se dibujan. */
  extra: unknown[];
}

export interface StudioSettings {
  version: number;
  scenes: StudioScene[];
}

export const STUDIO_LIMITS = {
  name: 24,
  opacity: { min: 10, max: 100 },
  delay: { min: 0, max: 5 },
  duration: { min: 0.2, max: 2 },
  textSize: { min: 16, max: 320 },
  textLength: 160,
  borderWidth: { min: 0, max: 40 },
  radius: { min: 0, max: 540 },
  thickness: { min: 2, max: 40 },
  minutes: { min: 1, max: 600 },
} as const;

export const DEFAULT_TEXT: TextProps = {
  content: 'En directo',
  font: 'archivo',
  weight: 800,
  size: 72,
  align: 'c',
  color: '#ffffff',
  upper: true,
  legibility: 'shadow',
};
export const DEFAULT_SHAPE: ShapeProps = { fill: '#9146ff', filled: true, border: '#ffffff', borderWidth: 0, radius: 10 };
export const DEFAULT_CAM: CamProps = { color: '#9146ff', thickness: 10, radius: 20, label: true, labelText: 'Cámara' };
export const DEFAULT_TIMER: TimerProps = {
  mode: 'down',
  minutes: 5,
  format: 'mmss',
  atZero: 'zero',
  endText: 'Empezamos',
  color: '#efe9dc',
  plate: true,
};
export const DEFAULT_MEDIA: MediaProps = { url: '', kind: 'image', fit: 'contain', loop: true, muted: true, name: '', mediaId: '' };
export const DEFAULT_RANDOM: Record<'alert' | 'raid', RandomProps> = {
  alert: { enabled: false, w: 620, h: 150 },
  raid: { enabled: false, w: 760, h: 210 },
};

export const typeInfo = (type: LayerType): LayerTypeInfo => LAYER_TYPES.find((item) => item.id === type) || LAYER_TYPES[0];
export const isLaloLayer = (type: LayerType): type is LaloLayerType => ['alert', 'goal', 'chat', 'raid'].includes(type);
export const hasRandom = (type: LayerType): type is 'alert' | 'raid' => type === 'alert' || type === 'raid';

/** Identificador corto. `random` se puede inyectar en las pruebas. */
export function makeId(prefix: string, random: () => number = Math.random): string {
  return `${prefix}${Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0')}`;
}

/** Capa nueva de un tipo, centrada en el lienzo y con sus ajustes por defecto. */
export function createLayer(type: LayerType, id: string, patch: Partial<StudioLayer> = {}): StudioLayer {
  const info = typeInfo(type);
  const w = patch.w ?? info.w;
  const h = patch.h ?? info.h;
  const layer: StudioLayer = {
    id,
    type,
    name: info.name,
    x: Math.round((STAGE_W - w) / 2),
    y: Math.round((STAGE_H - h) / 2),
    w,
    h,
    opacity: 100,
    hidden: false,
    locked: false,
    keepRatio: false,
    enter: 'up',
    exit: 'fade',
    delay: 0,
    duration: 0.5,
  };
  if (type === 'text') layer.text = DEFAULT_TEXT;
  if (type === 'shape') layer.shape = DEFAULT_SHAPE;
  if (type === 'cam') layer.cam = DEFAULT_CAM;
  if (type === 'timer') layer.timer = DEFAULT_TIMER;
  if (type === 'image') layer.media = DEFAULT_MEDIA;
  if (hasRandom(type)) layer.random = DEFAULT_RANDOM[type];
  return { ...layer, ...patch };
}

// ---------- Plantillas de partida ----------

export type SceneTemplateId = 'blank' | 'live' | 'starting' | 'pause' | 'end';

export const SCENE_TEMPLATES: { id: SceneTemplateId; name: string }[] = [
  { id: 'blank', name: 'En blanco' },
  { id: 'live', name: 'En directo' },
  { id: 'starting', name: 'Empezando' },
  { id: 'pause', name: 'Pausa' },
  { id: 'end', name: 'Fin' },
];

/** Escena hecha a partir de una plantilla. `nextId` da un identificador nuevo en cada llamada. */
export function buildTemplateScene(template: SceneTemplateId, sceneId: string, nextId: () => string): StudioScene {
  const mk = (type: LayerType, x: number, y: number, patch: Partial<StudioLayer> = {}) => createLayer(type, nextId(), { x, y, ...patch });
  const text = (content: string, size: number, patch: Partial<TextProps> = {}): TextProps => ({ ...DEFAULT_TEXT, content, size, ...patch });
  const name = SCENE_TEMPLATES.find((item) => item.id === template)?.name || 'Escena';
  let layers: StudioLayer[] = [];
  if (template === 'live') {
    layers = [
      mk('alert', 650, 60),
      mk('goal', 40, 40, { w: 520, h: 110 }),
      mk('chat', 1400, 660),
      mk('cam', 40, 740),
    ];
  }
  if (template === 'starting') {
    layers = [
      mk('text', 480, 380, { w: 960, h: 150, text: text('Empezamos en', 110) }),
      mk('timer', 760, 560, { w: 400, h: 150, enter: 'pop', delay: 0.15 }),
      mk('shape', 0, 960, { w: 1920, h: 120, opacity: 60, enter: 'wipe', shape: { ...DEFAULT_SHAPE, radius: 0 } }),
    ];
  }
  if (template === 'pause') {
    layers = [
      mk('text', 460, 300, { w: 1000, h: 150, text: text('Vuelvo enseguida', 110) }),
      mk('chat', 720, 500, { delay: 0.15 }),
    ];
  }
  if (template === 'end') {
    layers = [
      mk('text', 360, 380, { w: 1200, h: 170, text: text('Gracias por venir', 130) }),
      mk('text', 460, 570, {
        w: 1000,
        h: 90,
        name: 'Despedida',
        delay: 0.15,
        text: text('Hasta el próximo directo', 54, { weight: 600, upper: false, font: 'onest' }),
      }),
      mk('shape', 840, 690, { w: 240, h: 40, enter: 'wipe', delay: 0.25, shape: { ...DEFAULT_SHAPE, radius: 20 } }),
    ];
  }
  return { id: sceneId, name, layers, extra: [] };
}

function defaultScene(template: SceneTemplateId, sceneId: string): StudioScene {
  let n = 0;
  return buildTemplateScene(template, sceneId, () => `${sceneId}-${(n += 1)}`);
}

export const DEFAULT_STUDIO_SETTINGS: StudioSettings = {
  version: STUDIO_VERSION,
  scenes: [defaultScene('live', 'directo'), defaultScene('starting', 'empezando'), defaultScene('pause', 'pausa'), defaultScene('end', 'fin')],
};

export const STUDIO_STORAGE_KEY = 'lalo_studio_settings';

// ---------- Validación ----------

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const oneOf = <T extends string>(value: unknown, list: readonly T[], fallback: T): T =>
  list.includes(value as T) ? (value as T) : fallback;
const num = (value: unknown, min: number, max: number, fallback: number, decimals = 0): number => {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return fallback;
  const k = 10 ** decimals;
  return Math.round(Math.min(max, Math.max(min, n)) * k) / k;
};
const hex = (value: unknown, fallback: string): string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : fallback;
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
const str = (value: unknown, max: number, fallback: string): string =>
  typeof value === 'string' ? value.slice(0, max) : fallback;
const safeId = (value: unknown): string | null =>
  typeof value === 'string' && /^[a-z0-9_-]{1,40}$/i.test(value) ? value : null;

/** Solo direcciones http(s): nada de javascript: ni de archivos incrustados. */
export function cleanMediaUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const url = value.trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(url) && url.length <= 600 ? url : '';
}

/** Tipo de archivo que se deduce de la dirección. */
export const mediaKindOf = (url: string): 'image' | 'video' => (/\.(webm|mp4|mov|m4v)(\?|#|$)/i.test(url) ? 'video' : 'image');

const TYPE_IDS = LAYER_TYPES.map((item) => item.id);
const ANIM_IDS = ANIMS.map((item) => item.id);
const FONT_IDS = CHAT_FONTS.map((font) => font.id);
const L = STUDIO_LIMITS;

/** Capa válida, o null si el tipo no se conoce. Acepta también las claves cortas de la maqueta. */
export function normalizeLayer(raw: unknown): StudioLayer | null {
  if (!isObject(raw)) return null;
  const type = raw.type ?? raw.t;
  if (!TYPE_IDS.includes(type as LayerType)) return null;
  const kind = type as LayerType;
  const info = typeInfo(kind);
  const w = num(raw.w, MIN_SIZE, STAGE_W * 2, info.w);
  const h = num(raw.h, MIN_SIZE, STAGE_H * 2, info.h);
  const layer: StudioLayer = {
    id: safeId(raw.id) || makeId('l'),
    type: kind,
    name: str(raw.name, L.name, '').trim() || info.name,
    x: num(raw.x, -STAGE_W * 2, STAGE_W * 2, Math.round((STAGE_W - w) / 2)),
    y: num(raw.y, -STAGE_H * 2, STAGE_H * 2, Math.round((STAGE_H - h) / 2)),
    w,
    h,
    opacity: num(raw.opacity ?? raw.op, L.opacity.min, L.opacity.max, 100),
    hidden: bool(raw.hidden ?? raw.hid, false),
    locked: bool(raw.locked ?? raw.lock, false),
    keepRatio: bool(raw.keepRatio, false),
    enter: oneOf(raw.enter ?? raw.anim, ANIM_IDS, 'up'),
    exit: oneOf(raw.exit, ANIM_IDS, 'fade'),
    delay: num(raw.delay, L.delay.min, L.delay.max, 0, 2),
    duration: num(raw.duration, L.duration.min, L.duration.max, 0.5, 2),
  };

  if (kind === 'text') {
    const t = isObject(raw.text) ? raw.text : {};
    layer.text = {
      // La maqueta guardaba el texto y el color sueltos en la capa
      content: str(t.content ?? raw.text, L.textLength, DEFAULT_TEXT.content),
      font: oneOf(t.font, FONT_IDS, DEFAULT_TEXT.font),
      weight: num(t.weight, 400, 800, DEFAULT_TEXT.weight),
      size: num(t.size, L.textSize.min, L.textSize.max, DEFAULT_TEXT.size),
      align: oneOf(t.align, ['l', 'c', 'r'] as const, DEFAULT_TEXT.align),
      color: hex(t.color ?? raw.color, DEFAULT_TEXT.color),
      upper: bool(t.upper, DEFAULT_TEXT.upper),
      legibility: oneOf(t.legibility, ['none', 'outline', 'shadow'] as const, DEFAULT_TEXT.legibility),
    };
  }
  if (kind === 'shape') {
    const s = isObject(raw.shape) ? raw.shape : {};
    layer.shape = {
      fill: hex(s.fill ?? raw.color, DEFAULT_SHAPE.fill),
      filled: bool(s.filled, DEFAULT_SHAPE.filled),
      border: hex(s.border, DEFAULT_SHAPE.border),
      borderWidth: num(s.borderWidth, L.borderWidth.min, L.borderWidth.max, DEFAULT_SHAPE.borderWidth),
      radius: num(s.radius, L.radius.min, L.radius.max, DEFAULT_SHAPE.radius),
    };
  }
  if (kind === 'cam') {
    const c = isObject(raw.cam) ? raw.cam : {};
    layer.cam = {
      color: hex(c.color, DEFAULT_CAM.color),
      thickness: num(c.thickness, L.thickness.min, L.thickness.max, DEFAULT_CAM.thickness),
      radius: num(c.radius, L.radius.min, L.radius.max, DEFAULT_CAM.radius),
      label: bool(c.label, DEFAULT_CAM.label),
      labelText: str(c.labelText, L.name, DEFAULT_CAM.labelText),
    };
  }
  if (kind === 'timer') {
    const t = isObject(raw.timer) ? raw.timer : {};
    layer.timer = {
      mode: oneOf(t.mode, ['down', 'up'] as const, DEFAULT_TIMER.mode),
      minutes: num(t.minutes, L.minutes.min, L.minutes.max, DEFAULT_TIMER.minutes),
      format: oneOf(t.format, ['mmss', 'hmmss'] as const, DEFAULT_TIMER.format),
      atZero: oneOf(t.atZero, ['zero', 'text', 'hide'] as const, DEFAULT_TIMER.atZero),
      endText: str(t.endText, 40, DEFAULT_TIMER.endText),
      color: hex(t.color, DEFAULT_TIMER.color),
      plate: bool(t.plate, DEFAULT_TIMER.plate),
    };
  }
  if (kind === 'image') {
    const m = isObject(raw.media) ? raw.media : {};
    const url = cleanMediaUrl(m.url);
    layer.media = {
      url,
      kind: oneOf(m.kind, ['image', 'video'] as const, mediaKindOf(url)),
      fit: oneOf(m.fit, ['contain', 'cover'] as const, DEFAULT_MEDIA.fit),
      loop: bool(m.loop, DEFAULT_MEDIA.loop),
      muted: bool(m.muted, DEFAULT_MEDIA.muted),
      // Sin dirección no hay archivo del que acordarse
      name: url ? str(m.name, 120, '') : '',
      mediaId: url && typeof m.mediaId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(m.mediaId) ? m.mediaId : '',
    };
  }
  if (hasRandom(kind)) {
    const r = isObject(raw.random) ? raw.random : {};
    const d = DEFAULT_RANDOM[kind];
    layer.random = {
      enabled: bool(r.enabled, d.enabled),
      w: num(r.w, MIN_SIZE, STAGE_W, d.w),
      h: num(r.h, MIN_SIZE, STAGE_H, d.h),
    };
  }
  return layer;
}

export function normalizeScene(raw: unknown, index = 0): StudioScene {
  const source = isObject(raw) ? raw : {};
  const list = Array.isArray(source.layers) ? source.layers : Array.isArray(source.L) ? source.L : [];
  const layers: StudioLayer[] = [];
  const extra: unknown[] = Array.isArray(source.extra) ? source.extra.filter(isObject).slice(0, MAX_LAYERS) : [];
  const seen = new Set<string>();
  list.forEach((item) => {
    const layer = normalizeLayer(item);
    if (!layer) {
      // Tipo que esta versión no conoce: se conserva sin dibujarlo
      if (isObject(item) && extra.length < MAX_LAYERS) extra.push(item);
      return;
    }
    if (layers.length >= MAX_LAYERS) return;
    while (seen.has(layer.id)) layer.id = makeId('l');
    seen.add(layer.id);
    layers.push(layer);
  });
  return {
    id: safeId(source.id) || makeId('s'),
    name: str(source.name ?? source.n, L.name, '').trim() || `Escena ${index + 1}`,
    layers,
    extra,
  };
}

/** Ajustes válidos a partir de cualquier cosa. Sin escenas válidas, las de partida. */
export function normalizeStudioSettings(raw: unknown): StudioSettings {
  const source = isObject(raw) ? raw : {};
  if (!Array.isArray(source.scenes) || source.scenes.length === 0) return DEFAULT_STUDIO_SETTINGS;
  const seen = new Set<string>();
  const scenes = source.scenes.slice(0, MAX_SCENES).map((item, index) => {
    const scene = normalizeScene(item, index);
    while (seen.has(scene.id)) scene.id = makeId('s');
    seen.add(scene.id);
    return scene;
  });
  return { version: STUDIO_VERSION, scenes };
}

export function loadStudioSettings(): StudioSettings {
  try {
    const raw = localStorage.getItem(STUDIO_STORAGE_KEY);
    return raw ? normalizeStudioSettings(JSON.parse(raw)) : DEFAULT_STUDIO_SETTINGS;
  } catch {
    return DEFAULT_STUDIO_SETTINGS;
  }
}

export function saveStudioSettings(settings: StudioSettings): void {
  try {
    localStorage.setItem(STUDIO_STORAGE_KEY, JSON.stringify(settings));
    queueCloudPush('studio', settings);
  } catch (err) {
    console.error('Error guardando las escenas de Studio:', err);
  }
}

/** Una escena compacta para la URL de OBS cuando no hay cuenta en la nube. */
export function encodeScene(scene: StudioScene): string {
  return encodeBase64Url(JSON.stringify({ ...scene, extra: [] }));
}

export function decodeScene(param: string | null | undefined): StudioScene | null {
  const text = decodeBase64Url(param);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return isObject(parsed) ? normalizeScene(parsed) : null;
  } catch {
    return null;
  }
}

/** Escena que pinta una fuente de OBS: la que viaja en la URL o, si no, la guardada con ese identificador. */
export function sceneForWidget(settings: StudioSettings, sceneId: string | null, encoded: string | null): StudioScene | null {
  const fromUrl = decodeScene(encoded);
  if (fromUrl) return fromUrl;
  if (!sceneId) return settings.scenes[0] || null;
  return settings.scenes.find((scene) => scene.id.toLowerCase() === sceneId.toLowerCase()) || null;
}

// ---------- Temporizador ----------

const two = (n: number) => String(n).padStart(2, '0');

export function formatClock(totalSeconds: number, format: TimerFormat): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (format === 'hmmss') return `${Math.floor(s / 3600)}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`;
  return `${two(Math.floor(s / 60))}:${two(s % 60)}`;
}

/** Lo que muestra el temporizador cuando han pasado `elapsed` segundos. `hidden`: ya no se dibuja. */
export function timerDisplay(timer: TimerProps, elapsed: number): { text: string; done: boolean; hidden: boolean } {
  if (timer.mode === 'up') return { text: formatClock(elapsed, timer.format), done: false, hidden: false };
  const left = timer.minutes * 60 - Math.floor(Math.max(0, elapsed));
  if (left > 0) return { text: formatClock(left, timer.format), done: false, hidden: false };
  if (timer.atZero === 'hide') return { text: '', done: true, hidden: true };
  if (timer.atZero === 'text') return { text: timer.endText || formatClock(0, timer.format), done: true, hidden: false };
  return { text: formatClock(0, timer.format), done: true, hidden: false };
}
