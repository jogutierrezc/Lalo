/**
 * src/components/done/doneLogic.ts
 *
 * Lógica pura de Done AI (sin React ni DOM): catálogo de personajes y filtros de la galería,
 * validación del comando, cola de frases, medidas del escenario, ritmo del texto y volumen de la
 * boca. La usan la ventana de configuración, el overlay y las pruebas (tests/doneLogic.test.ts).
 */

import { validateChatWord, type ChatWordCheck } from '../../../server/lux/chatCommands';
import type { LuxLibraryModel, LuxModelLibrary } from '../../lib/luxApi';
import type { DoneEmotion, DoneGesture, DoneSettings, DoneSpeech } from '../../lib/doneTypes';
import { ALERT_STYLES } from '../../utils/appearance';

/* ---------- Emociones y gestos (los de Lux, que Done conserva) ---------- */

export const DONE_EMOTIONS: DoneEmotion[] = ['normal', 'habla', 'emocionada', 'grita', 'feliz', 'alegre', 'triste', 'molesta', 'sorprendida', 'magica'];
export const DONE_EMOTION_LABEL: Record<DoneEmotion, string> = {
  normal: 'Normal',
  habla: 'Habla',
  emocionada: 'Emocionada',
  grita: 'Grita',
  feliz: 'Feliz',
  alegre: 'Alegre',
  triste: 'Triste',
  molesta: 'Molesta',
  sorprendida: 'Sorprendida',
  magica: 'Mágica',
};
export const DONE_GESTURES: DoneGesture[] = ['wave', 'spin', 'dance', 'jump', 'sing', 'bow', 'ult', 'pride', 'nod', 'shrug', 'arms_up'];
export const DONE_GESTURE_LABEL: Record<DoneGesture, string> = {
  wave: 'Saludar',
  spin: 'Girar',
  dance: 'Bailar',
  jump: 'Saltar',
  sing: 'Cantar',
  bow: 'Reverencia',
  ult: 'Ultimate',
  pride: 'Orgullo',
  nod: 'Asentir',
  shrug: 'Encoger hombros',
  arms_up: 'Brazos arriba',
};

/**
 * Emoción de Done → etiqueta canónica de las alertas de la voz del chat (utils/emotionMapper):
 * así la tarjeta del texto entra con el mismo gesto que en la voz (rebote, grito, susurro…).
 */
export const DONE_EMOTION_TAG: Record<DoneEmotion, string | null> = {
  normal: null,
  habla: null,
  emocionada: 'excited',
  grita: 'shouting',
  feliz: 'happy',
  alegre: 'laughing',
  triste: 'sad',
  molesta: 'angry',
  sorprendida: 'surprised',
  magica: 'singing',
};

export const isDoneEmotion =(value: unknown): value is DoneEmotion => typeof value === 'string' && (DONE_EMOTIONS as string[]).includes(value);
export const isDoneGesture = (value: unknown): value is DoneGesture => typeof value === 'string' && (DONE_GESTURES as string[]).includes(value);

/* ---------- Comando ---------- */

/** Comandos que el comando de Done no puede tomar, además de los reservados de Lux (s, luxon, luxoff). */
export const DONE_RESERVED = ['doneon', 'doneoff', 'tally'] as const;

/** Valida la palabra de activación con la misma regla de Lux: 2 a 20 letras o números, sin reservadas. */
export function validateDoneCommand(raw: string, botCommands: readonly string[] = []): ChatWordCheck {
  return validateChatWord(raw, [...DONE_RESERVED, ...botCommands]);
}

/** Palabras con las que se llama a Done: la propia y, si el alias está activo, «done». */
export function doneCommandWords(word: string, keepAlias: boolean): string[] {
  const clean = word.trim().toLowerCase();
  return keepAlias && clean !== 'done' ? [clean, 'done'] : [clean];
}

/** Si el mensaje del chat empieza por el comando de Done, devuelve la palabra usada y el resto. */
export function matchDoneCommand(message: string, word: string, keepAlias: boolean): { word: string; rest: string } | null {
  const text = message.trim();
  const lower = text.toLowerCase();
  for (const candidate of doneCommandWords(word, keepAlias)) {
    const head = `!${candidate}`;
    if (lower === head || lower.startsWith(`${head} `)) return { word: candidate, rest: text.slice(head.length).trim() };
  }
  return null;
}

/* ---------- Límites de los ajustes (los de Lux, que Done conserva) ---------- */

export const PERSONALITY_MAX = 600;
export const REPLY_LIMITS = { min: 60, max: 500, step: 10 } as const;
export const VOLUME_LIMITS = { min: 0, max: 100 } as const;
export const SPONTANEOUS_EVERY = [0, 10, 15, 30, 60] as const;
export const SPONTANEOUS_MIN = [3, 5, 10] as const;
export const COOLDOWN_SECONDS = 5;

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

/** Deja cada campo numérico o de texto de un cambio dentro de su rango, como lo haría el servidor. */
export function clampSettings(patch: Partial<DoneSettings>): Partial<DoneSettings> {
  const out: Partial<DoneSettings> = { ...patch };
  if (patch.personality !== undefined) out.personality = String(patch.personality).slice(0, PERSONALITY_MAX);
  if (patch.replyMax !== undefined) {
    const step = REPLY_LIMITS.step;
    out.replyMax = Math.round(clampInt(patch.replyMax, REPLY_LIMITS.min, REPLY_LIMITS.max, 200) / step) * step;
  }
  if (patch.obsSize !== undefined) out.obsSize = clampSize(patch.obsSize);
  if (patch.voiceVolume !== undefined) out.voiceVolume = clampInt(patch.voiceVolume, VOLUME_LIMITS.min, VOLUME_LIMITS.max, 80);
  if (patch.typingCps !== undefined) out.typingCps = clampInt(patch.typingCps, CPS_LIMITS.min, CPS_LIMITS.max, 55);
  if (patch.textStyle !== undefined) out.textStyle = normalizeTextStyle(patch.textStyle);
  return out;
}

/** Los campos que cambiaron entre dos ajustes. */
export function diffSettings(base: DoneSettings, next: DoneSettings): Partial<DoneSettings> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(next) as (keyof DoneSettings)[]) {
    if (base[key] !== next[key]) out[key] = next[key];
  }
  return out as Partial<DoneSettings>;
}

/* ---------- Estilos de texto (los de la voz del chat) ---------- */

export const DONE_TEXT_STYLES = ALERT_STYLES;
export const DEFAULT_TEXT_STYLE = 'cabina';

/** El estilo guardado si existe entre los de la voz del chat; si no, Cabina. */
export function normalizeTextStyle(id: string | null | undefined): (typeof ALERT_STYLES)[number]['id'] {
  const hit = ALERT_STYLES.find((style) => style.id === id);
  return (hit ? hit.id : DEFAULT_TEXT_STYLE) as (typeof ALERT_STYLES)[number]['id'];
}

/* ---------- Personajes: catálogo ---------- */

export type CharacterKind = 'svg' | 'lux' | 'glb';

export interface SvgPalette {
  body: string;
  head: string;
  accent: string;
  screen: string;
}

/** Lo que necesita el renderizado para dibujar un personaje. */
export interface CharacterSpec {
  id: string;
  kind: CharacterKind;
  name: string;
  /** Solo svg. */
  palette?: SvgPalette;
  /** Solo glb: id del modelo en la biblioteca (el de avatar glb:<id>). */
  modelId?: string;
  /** Gestos permitidos; null = todos. */
  allowedGestures: DoneGesture[] | null;
  /** Aviso de licencia de Riot Games, con el texto exacto del servidor. */
  licenseNotice?: string | null;
}

export type CatalogStatus = 'aprobado' | 'pendiente' | 'privado';
export type CatalogOrigin = 'tally' | 'mio';

export interface CatalogEntry extends CharacterSpec {
  origin: CatalogOrigin;
  status: CatalogStatus;
  /** Texto corto bajo el nombre ("Modelo de Tally", "Tuyo · 18 MB"…). */
  detail: string;
  /** Solo glb propio: se puede enviar a revisión o quitar. */
  deletable: boolean;
}

export const SVG_PALETTES: Record<string, SvgPalette & { name: string }> = {
  done: { name: 'Done clásico', body: '#2b3138', head: '#3a4047', accent: '#ff2a2a', screen: '#0b0d0f' },
  cam: { name: 'Cámara', body: '#dfe3e8', head: '#f5f6f8', accent: '#ff2a2a', screen: '#16191c' },
  faro: { name: 'Faro', body: '#c42020', head: '#e63a3a', accent: '#f5f6f8', screen: '#16191c' },
  sombra: { name: 'Sombra', body: '#1e2227', head: '#2e343b', accent: '#f5f6f8', screen: '#0b0d0f' },
};

export const DEFAULT_CHARACTER_ID = 'svg:done';

/** Los personajes que no dependen de la biblioteca: las mascotas SVG de Done y Lux procedural. */
export function builtinCharacters(): CatalogEntry[] {
  const svg = Object.entries(SVG_PALETTES).map(
    ([key, p]): CatalogEntry => ({
      id: `svg:${key}`,
      kind: 'svg',
      name: p.name,
      palette: { body: p.body, head: p.head, accent: p.accent, screen: p.screen },
      allowedGestures: null,
      origin: 'tally',
      status: 'aprobado',
      detail: key === 'done' ? 'Personaje por defecto de Done' : 'Mascota de Done',
      deletable: false,
    })
  );
  const lux: CatalogEntry = {
    id: 'lux',
    kind: 'lux',
    name: 'Lux',
    allowedGestures: null,
    origin: 'tally',
    status: 'aprobado',
    detail: 'Personaje 3D de Tally',
    deletable: false,
  };
  return [svg[0], lux, ...svg.slice(1)];
}

const mb = (bytes: number | null): string | null => (bytes && bytes > 0 ? `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1).replace('.', ',')} MB` : null);

/** Un modelo GLB de la biblioteca como entrada del catálogo. */
export function glbEntry(model: LuxLibraryModel, mine: boolean): CatalogEntry {
  const status: CatalogStatus = model.reviewStatus;
  const size = mb(model.bytes);
  const origin: CatalogOrigin = mine ? 'mio' : 'tally';
  const base = mine ? 'Tuyo' : model.source === 'riot' ? 'Riot Games · de Tally' : 'Modelo de Tally';
  return {
    id: `glb:${model.id}`,
    kind: 'glb',
    name: model.name,
    modelId: model.id,
    allowedGestures: null,
    licenseNotice: model.licenseNotice,
    origin,
    status,
    detail: size ? `${base} · ${size}` : base,
    deletable: mine,
  };
}

/** Catálogo completo: los personajes de Tally, la biblioteca compartida y los modelos propios (sin repetir). */
export function buildCatalog(library: LuxModelLibrary | null): CatalogEntry[] {
  const entries = builtinCharacters();
  if (!library) return entries;
  const mineIds = new Set(library.mine.map((m) => m.id));
  const seen = new Set<string>();
  for (const model of library.library) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    entries.push(glbEntry(model, mineIds.has(model.id)));
  }
  for (const model of library.mine) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    entries.push(glbEntry(model, true));
  }
  return entries;
}

export type GalleryFilter = 'todos' | 'tally' | 'mios' | 'pendientes';
export const GALLERY_FILTERS: { value: GalleryFilter; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'tally', label: 'De Tally' },
  { value: 'mios', label: 'Míos' },
  { value: 'pendientes', label: 'Pendientes' },
];

const fold = (text: string): string => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Filtra la galería por pestaña y por nombre (sin tildes ni mayúsculas). «Pendientes» incluye lo privado sin enviar. */
export function filterCatalog(entries: CatalogEntry[], filter: GalleryFilter, query: string): CatalogEntry[] {
  const needle = fold(query.trim());
  return entries.filter((entry) => {
    if (filter === 'tally' && !(entry.origin === 'tally' && entry.status === 'aprobado')) return false;
    if (filter === 'mios' && entry.origin !== 'mio') return false;
    if (filter === 'pendientes' && !(entry.origin === 'mio' && entry.status !== 'aprobado')) return false;
    return needle === '' || fold(entry.name).includes(needle);
  });
}

export const STATUS_LABEL: Record<CatalogStatus, string> = { aprobado: 'Aprobado', pendiente: 'Pendiente de revisión', privado: 'Privado' };

/** «2 de 10 modelos» o, sin cuota, el aviso de que el plan no incluye modelos propios. */
export function quotaLabel(used: number, limit: number): string {
  if (limit <= 0) return 'Tu plan no incluye modelos propios.';
  return `Cuota del plan: ${used} de ${limit} modelos`;
}

/** Lo que se guarda en los ajustes al elegir un personaje. */
export function selectionFor(entry: Pick<CatalogEntry, 'id' | 'kind' | 'modelId'>): Pick<DoneSettings, 'characterId' | 'modelId'> {
  if (entry.kind === 'glb') return { characterId: entry.id, modelId: entry.modelId ?? null };
  return { characterId: entry.id, modelId: null };
}

/** La entrada que describen los ajustes. Un modelo desconocido o sin elegir cae en el personaje por defecto. */
export function resolveEntry(catalog: CatalogEntry[], settings: Pick<DoneSettings, 'characterId' | 'modelId'>): CatalogEntry {
  const fallback = catalog.find((e) => e.id === DEFAULT_CHARACTER_ID) ?? catalog[0];
  if (settings.modelId) {
    const hit = catalog.find((e) => e.kind === 'glb' && e.modelId === settings.modelId);
    if (hit) return hit;
  }
  if (settings.characterId) {
    const hit = catalog.find((e) => e.id === settings.characterId);
    if (hit) return hit;
  }
  return fallback;
}

/** ¿El personaje deja hacer este gesto? Sin lista, todos. */
export const gestureAllowed = (spec: Pick<CharacterSpec, 'allowedGestures'>, gesture: DoneGesture | null): boolean =>
  gesture !== null && (spec.allowedGestures === null || spec.allowedGestures.includes(gesture));

/* ---------- Escenario ---------- */

export const SIZE_LIMITS = { min: 10, max: 100 } as const;
export const CHARACTER_ASPECT = 200 / 270;

export const clampSize = (value: number): number => Math.min(SIZE_LIMITS.max, Math.max(SIZE_LIMITS.min, Math.round(Number(value) || 40)));

export interface StageLayout {
  /** Alto del personaje en % del alto del escenario. */
  heightPct: number;
  /** Ancho del personaje en % del alto del escenario (para colocar el texto a su lado). */
  widthOfHeightPct: number;
  /** Lado donde se ancla el personaje. */
  anchor: 'left' | 'center' | 'right';
  /** Margen lateral en % del ancho del escenario. */
  sideMarginPct: number;
}

/** Tamaño y posición del personaje en el escenario, a partir de los ajustes. */
export function stageLayout(size: number, position: DoneSettings['position']): StageLayout {
  const heightPct = clampSize(size);
  return { heightPct, widthOfHeightPct: Math.round(heightPct * CHARACTER_ASPECT * 100) / 100, anchor: position, sideMarginPct: 4 };
}

/* ---------- Texto: ritmo ---------- */

export const CPS_LIMITS = { min: 20, max: 120 } as const;

/** Segundos que tarda en escribirse un texto a esa velocidad. */
export const typingSeconds = (text: string, cps: number): number => Math.max(0.3, text.length / Math.max(CPS_LIMITS.min, Math.min(CPS_LIMITS.max, cps || 55)));

/** Segundos que el personaje habla sin audio: lo que tarda el texto en leerse en voz alta. */
export const spokenSeconds = (text: string): number => Math.max(0.8, text.length / 18);

/* ---------- Voz: boca por volumen ---------- */

/** Volumen RMS (0..1) de un bloque de muestras de 8 bits centradas en 128 (AnalyserNode.getByteTimeDomainData). */
export function rmsOf(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = (samples[i] - 128) / 128;
    sum += s * s;
  }
  return Math.sqrt(sum / samples.length);
}

/** Volumen de la voz de los ajustes (0..100) como volumen de audio (0..1). */
export const audioVolume = (voiceVolume: number): number => Math.min(1, Math.max(0, (Number(voiceVolume) || 0) / 100));

/* ---------- Cola de frases ---------- */

export const QUEUE_MAX = 12;

/** Cola de frases de Done: orden de llegada, sin repetir ids ya vistos, con tope para no acumular. */
export class SpeechQueue {
  private items: DoneSpeech[] = [];
  private seen = new Set<string>();

  /** Añade las frases nuevas (las ya vistas se ignoran). Devuelve cuántas entraron. */
  push(...speeches: DoneSpeech[]): number {
    let added = 0;
    for (const speech of speeches) {
      if (this.seen.has(speech.id)) continue;
      this.seen.add(speech.id);
      this.items.push(speech);
      added += 1;
    }
    // Con la cola llena se descartan las más antiguas: lo reciente importa más en un directo.
    while (this.items.length > QUEUE_MAX) this.items.shift();
    if (this.seen.size > 500) this.seen = new Set(this.items.map((i) => i.id));
    return added;
  }

  next(): DoneSpeech | undefined {
    return this.items.shift();
  }

  get length(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
  }
}

/* ---------- Tarjeta del espectador ---------- */

export type CardKind = 'chat' | 'event' | 'spontaneous' | 'none';

/** Qué tarjeta lleva delante cada frase: el espectador, el evento o el comentario espontáneo; «say» no lleva. */
export function cardKindOf(speech: Pick<DoneSpeech, 'kind' | 'viewer'>): CardKind {
  if (speech.kind === 'say') return 'none';
  if (speech.kind === 'chat') return speech.viewer ? 'chat' : 'none';
  return speech.kind;
}

/** Color estable de un espectador (el del diseño). */
const VIEWER_COLORS = ['#ff9f7a', '#7fd6ff', '#b4f070', '#ffd166', '#e29bff'];
export function viewerColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return VIEWER_COLORS[h % VIEWER_COLORS.length];
}
