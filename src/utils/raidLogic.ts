/**
 * src/utils/raidLogic.ts
 *
 * Lógica pura del saludo de raid: qué comando escribió un moderador, qué corto
 * señala un enlace, quién puede mandar, la espera de cada comando, la cola de
 * saludos y cuánto dura cada uno en pantalla. Sin React ni red, para poder
 * probarla; la capa (RaidLayer) y el estudio la usan.
 */

import type { RaidCommands, RaidSettings } from '../types/raid';
import type { UserRole } from './moderation';

// ---------- Datos ----------

/** Lo que devuelve /api/twitch/clip sobre un corto. */
export interface RaidClip {
  id: string;
  title: string;
  duration: number; // segundos
  creator: string;
  thumbnail: string;
  views: number;
  broadcaster: string; // nombre visible del canal del corto
  game: string | null;
}

export type GreetingKind = 'raid' | 'so' | 'clip';

/** Un saludo pedido, antes de saber si hay corto. */
export interface GreetingRequest {
  id: string;
  kind: GreetingKind;
  /** Canal a saludar (raid y saludo). En un corto concreto, el canal sale del propio corto. */
  channel?: string;
  /** Usuario del canal para buscar su corto. */
  login?: string;
  clipId?: string;
  viewers?: number;
  /** Moderador que escribió el comando. */
  by?: string;
  /** Solo en pruebas y en la muestra: no se consulta al servidor. */
  sample?: SampleClip;
}

export type ClipState = 'ok' | 'none' | 'not_configured' | 'error' | 'sample';

/** Para pruebas: el resultado de la búsqueda ya decidido. */
export interface SampleClip {
  state: ClipState;
  clip?: RaidClip;
  note?: string;
}

/** Un saludo listo para pintarse. */
export interface Greeting extends GreetingRequest {
  clip: RaidClip | null;
  clipState: ClipState;
  /** Texto del recuadro del corto cuando no hay reproductor (pruebas y avisos del estudio). */
  note?: string;
}

// ---------- Validación ----------

const LOGIN = /^[a-z0-9_]{1,25}$/;
// Los identificadores de corto son palabras pegadas, a veces con un sufijo tras un guion
const CLIP_ID = /^[A-Za-z0-9_-]{4,120}$/;

/** Usuario de Twitch en minúsculas y sin @ ni #, o '' si no es válido. */
export function normalizeLogin(value: unknown): string {
  const login = String(value ?? '').trim().replace(/^[@#]/, '').toLowerCase();
  return LOGIN.test(login) ? login : '';
}

export function isClipId(value: unknown): value is string {
  return typeof value === 'string' && CLIP_ID.test(value);
}

/**
 * Identificador de un corto a partir de lo que pega un moderador: un enlace
 * clips.twitch.tv/<id>, un enlace twitch.tv/<canal>/clip/<id> o el id suelto.
 * Devuelve null si no es ninguna de las tres cosas.
 */
export function parseClipRef(text: unknown): string | null {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const link = /^(?:https?:\/\/)?(?:www\.|m\.)?(clips\.twitch\.tv|twitch\.tv)\/([^\s?#]+)/i.exec(raw);
  if (link) {
    const parts = link[2].split('/').filter(Boolean);
    let id: string | undefined;
    if (link[1].toLowerCase() === 'clips.twitch.tv') {
      // clips.twitch.tv/embed?clip=<id> no es un enlace que se comparta: solo vale la forma corta
      id = parts.length === 1 && parts[0].toLowerCase() !== 'embed' ? parts[0] : undefined;
    } else if (parts.length === 3 && parts[1].toLowerCase() === 'clip' && normalizeLogin(parts[0])) {
      id = parts[2];
    }
    return isClipId(id) ? id : null;
  }
  // Algo con forma de dirección que no es de Twitch no se toma por un id
  if (/[/.:]/.test(raw)) return null;
  return isClipId(raw) ? raw : null;
}

// ---------- Comandos ----------

export type RaidCommand = { kind: 'so'; login: string } | { kind: 'clip'; clipId: string } | { kind: 'cut' };

/**
 * Comando de moderación escrito en el chat, o null si el mensaje no es uno.
 * Un comando conocido con el argumento mal escrito también es null: no hace nada.
 */
export function parseRaidCommand(message: string, commands: RaidCommands): RaidCommand | null {
  const words = message.trim().split(/\s+/);
  const name = (words[0] || '').toLowerCase();
  if (!name.startsWith('!')) return null;
  if (name === commands.cut) return words.length === 1 ? { kind: 'cut' } : null;
  if (name === commands.so) {
    const login = words.length === 2 ? normalizeLogin(words[1]) : '';
    return login ? { kind: 'so', login } : null;
  }
  if (name === commands.clip) {
    const clipId = words.length === 2 ? parseClipRef(words[1]) : null;
    return clipId ? { kind: 'clip', clipId } : null;
  }
  return null;
}

/** Solo el streamer y los moderadores mandan sobre el saludo. */
export function canUseRaidCommands(role: UserRole): boolean {
  return role === 'broadcaster' || role === 'mod';
}

/** true si la raid llega con gente suficiente para saludarla. */
export function raidPasses(viewers: number, settings: Pick<RaidSettings, 'enabled' | 'minViewers'>): boolean {
  return settings.enabled && Number.isFinite(viewers) && viewers >= settings.minViewers;
}

/** Segundos que le faltan a un comando para poder usarse otra vez (0 = ya se puede). */
export function cooldownLeft(lastAt: number | undefined, now: number, cooldownSec: number): number {
  if (lastAt === undefined || cooldownSec <= 0) return 0;
  return Math.max(0, Math.ceil(cooldownSec - (now - lastAt) / 1000));
}

// ---------- Cola ----------

/** Saludos que pueden esperar a la vez. Lo que no cabe se descarta. */
export const RAID_QUEUE_MAX = 5;

/**
 * Añade un saludo a la cola. No entra si la cola está llena o si ya espera uno
 * igual (el mismo canal o el mismo corto). Devuelve la cola nueva y si entró.
 */
export function enqueueGreeting(
  queue: GreetingRequest[],
  request: GreetingRequest,
  max = RAID_QUEUE_MAX
): { queue: GreetingRequest[]; accepted: boolean } {
  const same = (item: GreetingRequest) =>
    item.kind === request.kind &&
    (request.clipId ? item.clipId === request.clipId : normalizeLogin(item.login) === normalizeLogin(request.login));
  if (queue.length >= max || (!request.sample && queue.some(same))) return { queue, accepted: false };
  return { queue: [...queue, request], accepted: true };
}

// ---------- Tiempos ----------

/** Segundos que la placa sola se queda en pantalla. */
export const SOLO_SECONDS = 6;
/** Margen tras el corto antes de retirar el saludo. */
export const CLIP_MARGIN_SECONDS = 0.6;
/** Espera máxima a que cargue el reproductor antes de empezar a contar. */
export const EMBED_WAIT_SECONDS = 3;

/** Segundos de corto que se muestran: lo que dure, sin pasar del máximo elegido. */
export function clipSeconds(duration: number, maxClipSeconds: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(Math.ceil(duration), maxClipSeconds);
}

/** Segundos en pantalla desde que el corto empieza (o desde la entrada, si no hay corto). */
export function displaySeconds(clipDuration: number | null, maxClipSeconds: number): number {
  const seconds = clipDuration === null ? 0 : clipSeconds(clipDuration, maxClipSeconds);
  return seconds > 0 ? seconds + CLIP_MARGIN_SECONDS : SOLO_SECONDS;
}

// ---------- Textos y direcciones ----------

/** Frase de bienvenida para la voz. El nombre se limpia de guiones para que se lea bien. */
export function welcomeText(template: string, channel: string, viewers: number): string {
  const name = channel.replace(/[_.-]+/g, ' ').trim() || channel;
  return template
    .split('{canal}')
    .join(name)
    .split('{personas}')
    .join(String(Math.max(0, Math.round(viewers) || 0)))
    .trim();
}

/**
 * Dirección del reproductor oficial de cortos de Twitch. `parent` es el dominio
 * de la página que lo incrusta; Twitch lo exige y rechaza el que no coincida.
 */
export function clipEmbedUrl(clipId: string, parent: string, muted = false): string {
  const query = new URLSearchParams({ clip: clipId, parent, autoplay: 'true', muted: muted ? 'true' : 'false' });
  return `https://clips.twitch.tv/embed?${query.toString()}`;
}

// ---------- Respuesta del servidor ----------

export interface ClipLookup {
  state: ClipState;
  clip: RaidClip | null;
  /** Nombre visible del canal, si el servidor lo supo. */
  broadcaster: string | null;
  /** Variables que faltan en el servidor, cuando no está configurado. */
  missing: string[];
  error: string | null;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Lee la respuesta de /api/twitch/clip sin fiarse de su forma. */
export function readClipResponse(body: unknown): ClipLookup {
  const source = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const status = text(source.status);
  const broadcaster = text(source.broadcaster) || null;
  const error = text(source.error) || null;
  const missing = Array.isArray(source.missing) ? source.missing.filter((item): item is string => typeof item === 'string') : [];
  const raw = (typeof source.clip === 'object' && source.clip !== null ? source.clip : null) as Record<string, unknown> | null;

  if (status === 'ok' && raw && isClipId(raw.id)) {
    const duration = Number(raw.duration);
    const thumbnail = text(raw.thumbnail);
    return {
      state: 'ok',
      broadcaster: broadcaster || text(raw.broadcaster) || null,
      missing: [],
      error: null,
      clip: {
        id: raw.id,
        title: text(raw.title).slice(0, 140),
        duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
        creator: text(raw.creator).slice(0, 60),
        // Solo miniaturas servidas por https: lo demás no se pinta
        thumbnail: /^https:\/\//i.test(thumbnail) ? thumbnail : '',
        views: Math.max(0, Math.round(Number(raw.views) || 0)),
        broadcaster: text(raw.broadcaster).slice(0, 60),
        game: text(raw.game).slice(0, 80) || null,
      },
    };
  }
  if (status === 'no_clips') return { state: 'none', clip: null, broadcaster, missing: [], error: null };
  if (status === 'not_configured') return { state: 'not_configured', clip: null, broadcaster: null, missing, error };
  return { state: 'error', clip: null, broadcaster, missing: [], error: error || 'El servidor no respondió como se esperaba.' };
}

/** Dirección de la consulta al servidor para un saludo. */
export function clipLookupUrl(request: Pick<GreetingRequest, 'login' | 'clipId'>, days: number): string | null {
  if (request.clipId && isClipId(request.clipId)) return `/api/twitch/clip?id=${encodeURIComponent(request.clipId)}`;
  const login = normalizeLogin(request.login);
  return login ? `/api/twitch/clip?login=${login}&days=${Math.round(days)}` : null;
}

// ---------- Muestras para el estudio y demo=1 ----------

export type RaidSampleKind = 'raid' | 'so' | 'clip' | 'none';

const sampleClip = (broadcaster: string, title: string, duration: number, game: string): RaidClip => ({
  id: 'MuestraDeLaloSinReproductor',
  title,
  duration,
  creator: 'mar_ia',
  thumbnail: '',
  views: 1840,
  broadcaster,
  game,
});

/** Saludos de ejemplo. `note` es lo que dice el recuadro del corto, que aquí no lleva reproductor. */
export function sampleGreeting(kind: RaidSampleKind, note: string): GreetingRequest {
  const id = `muestra-${kind}-${Date.now()}`;
  switch (kind) {
    case 'so':
      return {
        id,
        kind: 'so',
        channel: 'pau_rl',
        by: 'mar_ia',
        sample: { state: 'sample', note, clip: sampleClip('pau_rl', 'Remontada en el último segundo', 9, 'Hollow Knight') },
      };
    case 'clip':
      return {
        id,
        kind: 'clip',
        channel: 'caro_tv',
        by: 'dani_gg',
        sample: { state: 'sample', note, clip: sampleClip('caro_tv', 'El salto imposible', 24, 'Celeste') },
      };
    case 'none':
      return { id, kind: 'raid', channel: 'luz88', viewers: 12, sample: { state: 'none' } };
    default:
      return {
        id,
        kind: 'raid',
        channel: 'StreamerHost',
        viewers: 48,
        sample: { state: 'sample', note, clip: sampleClip('StreamerHost', 'La mejor jugada de la semana', 18, 'Celeste') },
      };
  }
}
