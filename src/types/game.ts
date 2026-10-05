/**
 * src/types/game.ts
 *
 * Ajustes del módulo «Alertas de juego» (League of Legends, con la cuenta de
 * Riot que el streamer vincula en Integraciones): dónde y cómo sale la placa
 * «Grieta», qué alertas están encendidas, con qué título y con qué emoción las
 * anuncia la voz, y quién las anuncia.
 * Se guardan en este navegador y, con cuenta abierta, en la nube. Lo leído (de
 * localStorage, de la nube o de la URL) pasa siempre por normalizeGameSettings.
 *
 * Aquí no hay nada de la cuenta de Riot: el Riot ID y el servidor los guarda el
 * servidor de Lalo. Estos ajustes los lee cualquiera que tenga la URL de OBS.
 */

import { queueCloudPush } from '../lib/cloudConfig';
import { decodeBase64Url, encodeBase64Url } from '../utils/appearance';

export type GameAlertId = 'start' | 'win' | 'loss' | 'up' | 'promo' | 'down' | 'penta' | 'perfect' | 'mastery' | 'streak';
export type GamePos = 'tl' | 'tc' | 'tr' | 'bl' | 'bc' | 'br';
export type GameColorMode = 'tone' | 'fixed';
export type GameEnergy = 'suave' | 'normal' | 'intensa';
export type GameAnnouncer = 'nadie' | 'voz' | 'mascota';
export type GameVoiceSource = 'chat' | 'pet' | 'catalogue';
export type GameSound = 'none' | 'soft-pop' | 'retro-fanfare' | 'synth-bell' | 'arcade-chime';
export type GameTone = 'win' | 'loss' | 'rank' | 'epic' | 'info';

/** Colores «según la alerta»: verde victorias, rojo derrotas, dorado el rango, morado las jugadas y azul los avisos. */
export const GAME_TONES: Record<GameTone, string> = { win: '#7fe6a9', loss: '#ff8a80', rank: '#ffd166', epic: '#b995ff', info: '#6cc7ff' };

/** Emociones que entiende el motor de voz (EMOTION_MAP en api/tts.ts). Vacío: sin emoción. */
export const GAME_EMOTIONS: { id: string; name: string }[] = [
  { id: '', name: 'Sin emoción' },
  { id: 'excited', name: 'Emocionada' },
  { id: 'happy', name: 'Alegre' },
  { id: 'surprised', name: 'Sorprendida' },
  { id: 'shouting', name: 'Gritando' },
  { id: 'laughing', name: 'Riendo' },
  { id: 'calm', name: 'Tranquila' },
  { id: 'sad', name: 'Triste' },
  { id: 'crying', name: 'Llorando' },
  { id: 'nervous', name: 'Nerviosa' },
  { id: 'sigh', name: 'Suspiro' },
];

export interface GameAlertDef {
  id: GameAlertId;
  group: 'resultado' | 'rango' | 'destacados';
  /** Nombre en el panel. */
  name: string;
  hint: string;
  tone: GameTone;
  /** Rótulo pequeño sobre el título. */
  tag: string;
  /** Título de serie. Admite las mismas variables que el del streamer. */
  title: string;
  /** Variables que admite el título. */
  vars: string;
  emotion: string;
}

export const GAME_ALERTS: GameAlertDef[] = [
  { id: 'win', group: 'resultado', name: 'Victoria', hint: 'Al terminar una partida ganada.', tone: 'win', tag: 'Fin de partida', title: 'Victoria', vars: '{campeon}', emotion: 'excited' },
  { id: 'loss', group: 'resultado', name: 'Derrota', hint: 'Al terminar una partida perdida.', tone: 'loss', tag: 'Fin de partida', title: 'Derrota', vars: '{campeon}', emotion: 'sad' },
  { id: 'up', group: 'rango', name: 'Sube de división', hint: 'Clasificatoria solo/dúo: de Oro III a Oro II, por ejemplo.', tone: 'rank', tag: 'Rango', title: 'Sube a {rango}', vars: '{rango}', emotion: 'happy' },
  { id: 'promo', group: 'rango', name: 'Nueva liga', hint: 'Clasificatoria solo/dúo: de Oro a Platino, o al terminar las partidas de posicionamiento.', tone: 'rank', tag: 'Nueva liga', title: '{rango}', vars: '{rango}', emotion: 'excited' },
  { id: 'down', group: 'rango', name: 'Baja de división', hint: 'Clasificatoria solo/dúo: de Oro IV a Plata I, por ejemplo.', tone: 'loss', tag: 'Rango', title: 'Baja a {rango}', vars: '{rango}', emotion: 'sad' },
  { id: 'penta', group: 'destacados', name: 'Pentakill', hint: 'Si la última partida tuvo un pentakill tuyo. Se sabe al terminar la partida.', tone: 'epic', tag: 'Jugada', title: 'Pentakill', vars: '{campeon}', emotion: 'excited' },
  { id: 'perfect', group: 'destacados', name: 'Partida perfecta', hint: 'Una victoria sin ninguna muerte.', tone: 'epic', tag: 'Jugada', title: 'Partida perfecta', vars: '{campeon}', emotion: 'excited' },
  { id: 'mastery', group: 'destacados', name: 'Maestría de campeón', hint: 'Cuando sube tu nivel de maestría con uno de tus diez campeones más jugados.', tone: 'info', tag: 'Maestría', title: 'Maestría {nivel} con {campeon}', vars: '{nivel} {campeon}', emotion: 'happy' },
  { id: 'streak', group: 'destacados', name: 'Racha de victorias', hint: 'Victorias seguidas desde que la fuente está abierta en OBS.', tone: 'win', tag: 'Sesión', title: 'Racha de {racha} victorias', vars: '{racha}', emotion: 'excited' },
  { id: 'start', group: 'destacados', name: 'Empieza la partida', hint: 'Cuando Riot ve que entras en partida.', tone: 'info', tag: 'En partida', title: 'Empieza la partida', vars: '{campeon}', emotion: 'happy' },
];
export const GAME_ALERT_IDS = GAME_ALERTS.map((item) => item.id);
export const GAME_GROUPS: { id: GameAlertDef['group']; name: string }[] = [
  { id: 'resultado', name: 'Resultado de la partida' },
  { id: 'rango', name: 'Rango' },
  { id: 'destacados', name: 'Destacados y sesión' },
];

export const GAME_POSITIONS: { id: GamePos; name: string }[] = [
  { id: 'tl', name: 'Arriba izq.' },
  { id: 'tc', name: 'Arriba' },
  { id: 'tr', name: 'Arriba der.' },
  { id: 'bl', name: 'Abajo izq.' },
  { id: 'bc', name: 'Abajo' },
  { id: 'br', name: 'Abajo der.' },
];
export const GAME_COLOR_MODES: { id: GameColorMode; name: string }[] = [
  { id: 'tone', name: 'Según la alerta' },
  { id: 'fixed', name: 'Uno fijo' },
];
export const GAME_ENERGIES: { id: GameEnergy; name: string }[] = [
  { id: 'suave', name: 'Suave' },
  { id: 'normal', name: 'Normal' },
  { id: 'intensa', name: 'Intensa' },
];
export const GAME_ANNOUNCERS: { id: GameAnnouncer; name: string; hint: string }[] = [
  { id: 'nadie', name: 'Nadie', hint: 'La alerta solo sale en pantalla.' },
  { id: 'voz', name: 'La voz', hint: 'La lee la cola de voz de Lalo, detrás de lo que esté esperando.' },
  { id: 'mascota', name: 'La mascota', hint: 'La dice tu mascota, con su voz y su bocadillo, si está en la misma fuente de OBS («Todo en uno»). Si no está, la lee la voz.' },
];
export const GAME_VOICE_SOURCES: { id: GameVoiceSource; name: string }[] = [
  { id: 'chat', name: 'La de la Voz del chat' },
  { id: 'pet', name: 'La de la mascota' },
  { id: 'catalogue', name: 'Una del catálogo' },
];
export const GAME_SOUNDS: { id: GameSound; name: string }[] = [
  { id: 'none', name: 'Sin sonido' },
  { id: 'soft-pop', name: 'Toque suave' },
  { id: 'retro-fanfare', name: 'Fanfarria corta' },
  { id: 'synth-bell', name: 'Campana' },
  { id: 'arcade-chime', name: 'Arcade' },
];

export interface GameAlertSettings {
  on: boolean;
  /** Título propio. Vacío: el de serie. */
  title: string;
  /** Etiqueta de emoción con la que la voz lee la alerta. Vacío: sin emoción. */
  emotion: string;
}

export interface GameSettings {
  enabled: boolean;
  /** Aparece también en la fuente «Todo en uno». */
  inAll: boolean;
  pos: GamePos;
  /** Tamaño de la placa, en tanto por ciento. */
  size: number;
  /** Segundos que la placa queda en pantalla. */
  durationSec: number;
  colorMode: GameColorMode;
  /** Color fijo, cuando no va «según la alerta». */
  color: string;
  energy: GameEnergy;
  showStats: boolean;
  /** Antepone «League of Legends» al rótulo. */
  showGame: boolean;
  alerts: Record<GameAlertId, GameAlertSettings>;
  /** Victorias seguidas a partir de las cuales sale la alerta de racha. */
  streakMin: number;
  announcer: GameAnnouncer;
  voiceSource: GameVoiceSource;
  /** Voz del catálogo, cuando voiceSource es «catalogue». */
  voiceId: string;
  sound: GameSound;
  soundVolume: number;
}

export const GAME_STORAGE_KEY = 'lalo_game_settings';
export const GAME_LIMITS = {
  size: { min: 70, max: 140 },
  durationSec: { min: 3, max: 12 },
  title: 40,
  streakMin: { min: 2, max: 10 },
} as const;

export const DEFAULT_GAME_ALERTS = Object.fromEntries(
  GAME_ALERTS.map((item) => [item.id, { on: true, title: '', emotion: item.emotion }])
) as Record<GameAlertId, GameAlertSettings>;

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  enabled: true,
  inAll: false,
  pos: 'bc',
  size: 100,
  durationSec: 6,
  colorMode: 'tone',
  color: GAME_TONES.rank,
  energy: 'normal',
  showStats: true,
  showGame: true,
  alerts: DEFAULT_GAME_ALERTS,
  streakMin: 3,
  announcer: 'voz',
  voiceSource: 'chat',
  voiceId: '',
  sound: 'soft-pop',
  soundVolume: 0.6,
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
const num = (value: unknown, limits: { min: number; max: number }, fallback: number, step = 1): number => {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.min(limits.max, Math.max(limits.min, n)) / step) * step;
};
const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const oneOf = <T extends string>(value: unknown, list: readonly { id: T }[], fallback: T): T =>
  list.some((item) => item.id === value) ? (value as T) : fallback;

function normalizeAlert(raw: unknown, fallback: GameAlertSettings): GameAlertSettings {
  const src = isObject(raw) ? raw : {};
  return {
    on: bool(src.on, fallback.on),
    // Sin corchetes: el título no puede colar una etiqueta de emoción en lo que lee la voz
    title: text(src.title, GAME_LIMITS.title).replace(/[[\]]/g, ''),
    emotion: typeof src.emotion === 'string' && GAME_EMOTIONS.some((item) => item.id === src.emotion) ? src.emotion : fallback.emotion,
  };
}

/** Ajustes válidos a partir de cualquier cosa. Lo que falta o no vale queda en su valor por defecto. */
export function normalizeGameSettings(raw: unknown): GameSettings {
  const src = isObject(raw) ? raw : {};
  const d = DEFAULT_GAME_SETTINGS;
  const rawAlerts = isObject(src.alerts) ? src.alerts : {};
  const alerts = {} as Record<GameAlertId, GameAlertSettings>;
  GAME_ALERT_IDS.forEach((id) => {
    alerts[id] = normalizeAlert(rawAlerts[id], DEFAULT_GAME_ALERTS[id]);
  });
  const volume = typeof src.soundVolume === 'number' && Number.isFinite(src.soundVolume) ? Math.min(1, Math.max(0, src.soundVolume)) : d.soundVolume;
  return {
    enabled: bool(src.enabled, d.enabled),
    inAll: bool(src.inAll, d.inAll),
    pos: oneOf(src.pos, GAME_POSITIONS, d.pos),
    size: num(src.size, GAME_LIMITS.size, d.size, 5),
    durationSec: num(src.durationSec, GAME_LIMITS.durationSec, d.durationSec),
    colorMode: oneOf(src.colorMode, GAME_COLOR_MODES, d.colorMode),
    color: typeof src.color === 'string' && /^#[0-9a-f]{6}$/i.test(src.color) ? src.color.toLowerCase() : d.color,
    energy: oneOf(src.energy, GAME_ENERGIES, d.energy),
    showStats: bool(src.showStats, d.showStats),
    showGame: bool(src.showGame, d.showGame),
    alerts,
    streakMin: num(src.streakMin, GAME_LIMITS.streakMin, d.streakMin),
    announcer: oneOf(src.announcer, GAME_ANNOUNCERS, d.announcer),
    voiceSource: oneOf(src.voiceSource, GAME_VOICE_SOURCES, d.voiceSource),
    voiceId: typeof src.voiceId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(src.voiceId) ? src.voiceId : '',
    sound: oneOf(src.sound, GAME_SOUNDS, d.sound),
    soundVolume: Math.round(volume * 100) / 100,
  };
}

export function loadGameSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(GAME_STORAGE_KEY);
    return raw ? normalizeGameSettings(JSON.parse(raw)) : DEFAULT_GAME_SETTINGS;
  } catch {
    return DEFAULT_GAME_SETTINGS;
  }
}

export function saveGameSettings(settings: GameSettings): void {
  try {
    localStorage.setItem(GAME_STORAGE_KEY, JSON.stringify(settings));
    queueCloudPush('game', settings);
  } catch (err) {
    console.error('No se pudieron guardar los ajustes de Alertas de juego:', err);
  }
}

/** Ajustes compactos para la URL de OBS cuando no hay cuenta en la nube. */
export function encodeGameSettings(settings: GameSettings): string {
  return encodeBase64Url(JSON.stringify(settings));
}

/** Ajustes recibidos por URL, o null si el valor no se puede leer. */
export function decodeGameSettings(param: string | null | undefined): GameSettings | null {
  const decoded = decodeBase64Url(param);
  if (!decoded) return null;
  try {
    const parsed = JSON.parse(decoded);
    return isObject(parsed) ? normalizeGameSettings(parsed) : null;
  } catch {
    return null;
  }
}
