/**
 * src/utils/musicRules.ts
 *
 * Reglas puras de la capa «Ahora suena»: cuándo aparece, cuándo se retira y
 * cuándo cambia de canción sin salir. No toca el DOM ni el reloj: recibe lo que
 * pasa y devuelve el estado nuevo y lo que hay que hacer en pantalla.
 *
 *   - «Al cambiar de canción»: aparece con cada canción y se retira a los N segundos.
 *   - «Siempre que suene»: se queda mientras haya música.
 *   - «Oculta»: solo aparece con el botón del panel o el comando del chat.
 *   - En pausa se queda atenuada o se oculta, según el ajuste.
 *   - Si deja de sonar (o hay un anuncio), se retira.
 */

import type { MusicPause, MusicShow } from '../types/music';

export interface MusicTrack {
  id: string;
  title: string;
  artists: string;
  album: string;
  /** Dirección de la portada, o null (archivo local o sin imagen). */
  art: string | null;
  durationMs: number;
  explicit: boolean;
  /** Enlace de vuelta al servicio. */
  url?: string | null;
  /** Solo en los datos de ejemplo: clase de la portada dibujada con CSS y su color. */
  sampleCover?: string;
  sampleAccent?: string;
}

export interface MusicState {
  /** Hay algo que mostrar. */
  music: boolean;
  playing: boolean;
  /** La capa está en pantalla. */
  vis: boolean;
  trackId: string | null;
}

export const MUSIC_IDLE: MusicState = { music: false, playing: false, vis: false, trackId: null };

export type MusicInput =
  | { type: 'song'; trackId: string; playing?: boolean }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'live'; action: 'show' | 'hide' }
  | { type: 'timeout' }
  /** Cambió «Mostrar» o «Si pones pausa» en el panel. */
  | { type: 'rules'; changed: 'show' | 'pause' }
  /** Cambió el diseño o la posición: la capa vuelve a entrar para verse en su sitio. */
  | { type: 'preview' };

/** enter: entra. leave: sale. swap: transición a otra canción. render: pinta sin animar. arm: (re)inicia la retirada. disarm: la cancela. */
export type MusicEffect = 'enter' | 'leave' | 'swap' | 'render' | 'arm' | 'disarm';

export interface MusicRules {
  show: MusicShow;
  pause: MusicPause;
}

export interface MusicStep {
  state: MusicState;
  effects: MusicEffect[];
  /** Por qué no se mostró, cuando alguien pidió mostrarla y no se pudo. */
  refused?: 'no_music' | 'paused';
}

const canShow = (state: MusicState, rules: MusicRules): boolean => state.music && !(rules.pause === 'ocultar' && !state.playing);
const whyNot = (state: MusicState): 'no_music' | 'paused' => (state.music ? 'paused' : 'no_music');

function show(state: MusicState, rules: MusicRules, effects: MusicEffect[] = []): MusicStep {
  if (!canShow(state, rules)) return { state, effects, refused: whyNot(state) };
  return { state: { ...state, vis: true }, effects: [...effects, ...(state.vis ? [] : (['enter'] as const)), 'arm'] };
}

function leave(state: MusicState, effects: MusicEffect[] = []): MusicStep {
  return { state: { ...state, vis: false }, effects: [...effects, 'disarm', ...(state.vis ? (['leave'] as const) : [])] };
}

export function musicStep(state: MusicState, input: MusicInput, rules: MusicRules): MusicStep {
  switch (input.type) {
    case 'song': {
      const playing = input.playing !== false;
      const next: MusicState = { ...state, music: true, playing, trackId: input.trackId };
      // Ya está en pantalla: transición sin salir
      if (state.vis) return canShow(next, rules) ? { state: next, effects: ['swap', 'arm'] } : leave(next, ['render']);
      if (rules.show === 'oculto' || !playing) return { state: next, effects: ['render'] };
      return show(next, rules, ['render']);
    }
    case 'pause': {
      if (!state.music) return { state, effects: [] };
      const next = { ...state, playing: false };
      return rules.pause === 'ocultar' ? leave(next) : { state: next, effects: [] };
    }
    case 'resume': {
      if (!state.trackId) return { state, effects: [] };
      const next = { ...state, music: true, playing: true };
      return rules.show !== 'oculto' || state.vis ? show(next, rules) : { state: next, effects: [] };
    }
    case 'stop':
      return leave({ ...state, music: false, playing: false });
    case 'live':
      return input.action === 'hide' ? leave(state) : show(state, rules);
    case 'timeout':
      return leave(state);
    case 'rules': {
      if (input.changed === 'show') return rules.show === 'oculto' ? leave(state) : show(state, rules);
      if (state.playing || !state.music) return { state, effects: [] };
      if (rules.pause === 'ocultar') return leave(state);
      return rules.show !== 'oculto' ? show(state, rules) : { state, effects: [] };
    }
    case 'preview': {
      if (!canShow(state, rules)) return { state: { ...state, vis: false }, effects: ['disarm', ...(state.vis ? (['leave'] as const) : [])], refused: whyNot(state) };
      return { state: { ...state, vis: true }, effects: ['enter', 'arm'] };
    }
  }
}

/** Con qué regla se retira sola: solo «Al cambiar de canción». Devuelve los milisegundos, o null si se queda. */
export function hideAfterMs(show: MusicShow, secs: number): number | null {
  return show === 'cambio' ? secs * 1000 : null;
}

// ---------- De lo que dice el servidor a lo que pasa ----------

export interface MusicReading {
  /** Canción que suena o está en pausa; null si no hay nada, hay un anuncio o la cuenta no está conectada. */
  track: MusicTrack | null;
  playing: boolean;
}

/** Qué pasó entre la lectura anterior y esta. */
export function inputsFromReading(state: MusicState, reading: MusicReading): MusicInput[] {
  if (!reading.track) return state.music ? [{ type: 'stop' }] : [];
  if (!state.music || state.trackId !== reading.track.id) return [{ type: 'song', trackId: reading.track.id, playing: reading.playing }];
  if (state.playing && !reading.playing) return [{ type: 'pause' }];
  if (!state.playing && reading.playing) return [{ type: 'resume' }];
  return [];
}

/** Lo que devuelve /api/spotify/now, ya comprobado. */
export interface NowResponse {
  status: string;
  reading: MusicReading;
  /** Posición de la canción en el momento de recibir la respuesta. */
  progressMs: number;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '');
const ms = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

export function parseNowResponse(body: unknown): NowResponse {
  const none: NowResponse = { status: 'error', reading: { track: null, playing: false }, progressMs: 0 };
  if (!isObject(body)) return none;
  const status = str(body.status, 30) || 'error';
  const raw = isObject(body.track) ? body.track : null;
  const title = raw ? str(raw.title, 200) : '';
  // Solo se muestra una canción o un pódcast leídos bien; un anuncio o un fallo retiran la capa.
  // Con el límite de peticiones alcanzado se conserva lo último que se supo
  if (!raw || !title || (status !== 'ok' && status !== 'rate_limited') || body.kind === 'ad') return { ...none, status };
  const art = typeof raw.art === 'string' && /^https:\/\//i.test(raw.art) ? raw.art : null;
  const playing = body.playing === true;
  const durationMs = ms(raw.durationMs);
  const progress = ms(body.progressMs) + (playing ? ms(body.ageMs) : 0);
  return {
    status,
    reading: {
      playing,
      track: {
        id: str(raw.id, 200) || title,
        title,
        artists: str(raw.artists, 200),
        album: str(raw.album, 200),
        art: raw.local === true ? null : art,
        durationMs,
        explicit: raw.explicit === true,
        url: typeof raw.url === 'string' && /^https:\/\//i.test(raw.url) ? raw.url : null,
      },
    },
    progressMs: durationMs ? Math.min(durationMs, progress) : progress,
  };
}

/** 62000 -> «1:02». */
export function formatClock(valueMs: number): string {
  const seconds = Math.max(0, Math.floor(valueMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Avance de la barra entre 0 y 1. */
export const progressRatio = (progressMs: number, durationMs: number): number =>
  durationMs > 0 ? Math.min(1, Math.max(0, progressMs / durationMs)) : 0;

// ---------- Datos de ejemplo (inventados: nunca canciones reales) ----------

export const SAMPLE_TRACKS: MusicTrack[] = [
  { id: 'demo-1', title: 'Marea baja', artists: 'Los Faroles del Puerto', album: 'Costa norte', art: null, durationMs: 214000, explicit: false, sampleCover: 'c1', sampleAccent: '#ff9a6b' },
  { id: 'demo-2', title: 'Circuito cerrado', artists: 'Nube Paralela', album: 'Señal débil', art: null, durationMs: 187000, explicit: true, sampleCover: 'c2', sampleAccent: '#5cd6c8' },
  { id: 'demo-3', title: 'Tres de la mañana', artists: 'Irene Valdoro', album: 'Insomnio', art: null, durationMs: 241000, explicit: false, sampleCover: 'c3', sampleAccent: '#f2c14e' },
  {
    id: 'demo-4',
    title: 'La última vez que cruzamos el puente antes de que amaneciera (versión extendida en directo)',
    artists: 'Orquesta Provisional del Barrio Alto con Mila Requena',
    album: 'Grabado en la azotea, volumen 2',
    art: null,
    durationMs: 402000,
    explicit: false,
    sampleCover: 'c4',
    sampleAccent: '#ff7d95',
  },
];
