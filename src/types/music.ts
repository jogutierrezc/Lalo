/**
 * src/types/music.ts
 *
 * Ajustes de la capa «Ahora suena»: diseño, cuándo se muestra, cuánto dura, qué
 * pasa en pausa, posición, tamaño, qué se ve, color de acento y los comandos
 * del chat. Se guardan en este navegador y, con cuenta abierta, en la nube. Lo
 * leído (de localStorage, de la nube o de la URL) pasa siempre por
 * normalizeMusicSettings.
 *
 * El nombre de la función no lleva el nombre del servicio de música: lo piden
 * sus normas de marca.
 */

import { queueCloudPush } from '../lib/cloudConfig';
import { decodeBase64Url, encodeBase64Url, normalizeAccent, type AlertPosition } from '../utils/appearance';
import { normalizeCommandName } from './raid';

export type MusicDesign = 'ficha' | 'franja' | 'columna' | 'disco' | 'linea' | 'portada';
export type MusicShow = 'cambio' | 'siempre' | 'oculto';
export type MusicPause = 'atenuar' | 'ocultar';
export type MusicAccent = 'cover' | 'fixed';

export const MUSIC_DESIGNS: { id: MusicDesign; name: string; note: string; hint: string }[] = [
  {
    id: 'ficha',
    name: 'Ficha',
    note: 'Compacta, para una esquina',
    hint: 'Entra deslizándose desde el borde más cercano y el texto se descubre de izquierda a derecha. Al cambiar, el texto sube y entra el nuevo.',
  },
  {
    id: 'franja',
    name: 'Franja',
    note: 'Barra ancha de tercio inferior',
    hint: 'El fondo se despliega de izquierda a derecha y el texto sube por líneas. Al cambiar, un bloque del color de acento barre el texto.',
  },
  {
    id: 'columna',
    name: 'Columna',
    note: 'Vertical, para una barra lateral',
    hint: 'Se desenrolla en vertical desde el borde y las líneas aparecen una a una. Al cambiar, el texto sale hacia un lado y entra por el otro.',
  },
  {
    id: 'disco',
    name: 'Disco',
    note: 'Un disco gira junto a la portada',
    hint: 'La portada se queda quieta: lo que gira y asoma es un disco dibujado por Lalo. Al cambiar, el disco se guarda y vuelve a salir.',
  },
  {
    id: 'linea',
    name: 'Línea',
    note: 'Solo texto, una línea',
    hint: 'Una sola línea que se abre como una cortina. Al cambiar, el texto rueda hacia arriba. Un medidor de tres barras se mueve mientras suena.',
  },
  {
    id: 'portada',
    name: 'Portada',
    note: 'Grande, para inicio o pausa',
    hint: 'El fondo sube desde abajo, luego la portada y las líneas de texto una a una. Pensado para escenas de inicio o de pausa.',
  },
];

export const MUSIC_SHOW: { id: MusicShow; name: string; hint: string }[] = [
  { id: 'cambio', name: 'Al cambiar de canción', hint: 'Aparece con cada canción nueva y se retira sola. Es lo menos invasivo.' },
  { id: 'siempre', name: 'Siempre que suene', hint: 'Se queda en pantalla mientras haya música.' },
  {
    id: 'oculto',
    name: 'Oculta',
    hint: 'No aparece sola. Solo con el botón del panel o con el comando del chat, y se queda hasta que la ocultes.',
  },
];

export const SIX_POSITIONS: { id: AlertPosition; name: string }[] = [
  { id: 'tl', name: 'arriba a la izquierda' },
  { id: 'tc', name: 'arriba al centro' },
  { id: 'tr', name: 'arriba a la derecha' },
  { id: 'bl', name: 'abajo a la izquierda' },
  { id: 'bc', name: 'abajo al centro' },
  { id: 'br', name: 'abajo a la derecha' },
];

export interface MusicCommands {
  show: string;
  hide: string;
}

/** Orden en directo desde el panel. Viaja con los ajustes para llegar a un OBS en otro equipo. */
export interface MusicLive {
  action: 'show' | 'hide' | null;
  /** Cuándo se dio (ms). La capa solo obedece una orden nueva y reciente. */
  at: number;
}

export interface MusicSettings {
  design: MusicDesign;
  show: MusicShow;
  /** Segundos en pantalla con «Al cambiar de canción». */
  secs: number;
  pause: MusicPause;
  pos: AlertPosition;
  /** Tamaño en tanto por ciento. */
  size: number;
  art: boolean;
  bar: boolean;
  artist: boolean;
  album: boolean;
  accent: MusicAccent;
  color: string;
  commands: MusicCommands;
  /** Aparece también en la fuente «Todo en uno». */
  inAll: boolean;
  live: MusicLive;
}

export const MUSIC_LIMITS = { secs: { min: 4, max: 30 }, size: { min: 70, max: 140 } } as const;
export const DEFAULT_MUSIC_COMMANDS: MusicCommands = { show: '!cancion', hide: '!ocultarcancion' };

export const DEFAULT_MUSIC_SETTINGS: MusicSettings = {
  design: 'ficha',
  show: 'cambio',
  secs: 8,
  pause: 'atenuar',
  pos: 'bl',
  size: 100,
  art: true,
  bar: true,
  artist: true,
  album: false,
  accent: 'cover',
  color: '#b68cff',
  commands: DEFAULT_MUSIC_COMMANDS,
  inAll: false,
  live: { action: null, at: 0 },
};

export const MUSIC_STORAGE_KEY = 'lalo_music_settings';

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
const int = (value: unknown, limits: { min: number; max: number }, fallback: number): number => {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? Math.round(Math.min(limits.max, Math.max(limits.min, n))) : fallback;
};
const oneOf = <T extends string>(value: unknown, list: readonly T[], fallback: T): T => (list.includes(value as T) ? (value as T) : fallback);

/** Nombres de comando con más de 15 letras, como !ocultarcancion: hasta 24. */
function commandName(value: unknown, fallback: string): string {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  const command = raw.startsWith('!') ? raw : `!${raw}`;
  if (/^![a-z0-9_]{1,24}$/.test(command)) return command;
  return normalizeCommandName(value, fallback);
}

function normalizeCommands(raw: unknown): MusicCommands {
  const src = isObject(raw) ? raw : {};
  const d = DEFAULT_MUSIC_COMMANDS;
  const show = commandName(src.show, d.show);
  let hide = commandName(src.hide, d.hide);
  // Dos comandos con el mismo nombre: el de ocultar vuelve al suyo
  if (hide === show) hide = show === d.hide ? d.show : d.hide;
  return { show, hide };
}

export function normalizeMusicSettings(raw: unknown): MusicSettings {
  const src = isObject(raw) ? raw : {};
  const d = DEFAULT_MUSIC_SETTINGS;
  const live = isObject(src.live) ? src.live : {};
  return {
    design: oneOf(src.design, MUSIC_DESIGNS.map((item) => item.id), d.design),
    show: oneOf(src.show, ['cambio', 'siempre', 'oculto'] as const, d.show),
    secs: int(src.secs, MUSIC_LIMITS.secs, d.secs),
    pause: oneOf(src.pause, ['atenuar', 'ocultar'] as const, d.pause),
    pos: oneOf(src.pos, SIX_POSITIONS.map((item) => item.id), d.pos),
    size: int(src.size, MUSIC_LIMITS.size, d.size),
    art: bool(src.art, d.art),
    bar: bool(src.bar, d.bar),
    artist: bool(src.artist, d.artist),
    album: bool(src.album, d.album),
    accent: oneOf(src.accent, ['cover', 'fixed'] as const, d.accent),
    color: normalizeAccent(src.color) ?? d.color,
    commands: normalizeCommands(src.commands),
    inAll: bool(src.inAll, d.inAll),
    live: {
      action: live.action === 'show' || live.action === 'hide' ? live.action : null,
      at: typeof live.at === 'number' && Number.isFinite(live.at) ? live.at : 0,
    },
  };
}

export function loadMusicSettings(): MusicSettings {
  try {
    const raw = localStorage.getItem(MUSIC_STORAGE_KEY);
    return raw ? normalizeMusicSettings(JSON.parse(raw)) : DEFAULT_MUSIC_SETTINGS;
  } catch {
    return DEFAULT_MUSIC_SETTINGS;
  }
}

export function saveMusicSettings(settings: MusicSettings): void {
  try {
    localStorage.setItem(MUSIC_STORAGE_KEY, JSON.stringify(settings));
    queueCloudPush('music', settings);
  } catch (err) {
    console.error('No se pudieron guardar los ajustes de «Ahora suena»:', err);
  }
}

/** Ajustes compactos para la URL de OBS cuando no hay cuenta en la nube. La orden en directo no viaja. */
export function encodeMusicSettings(settings: MusicSettings): string {
  return encodeBase64Url(JSON.stringify({ ...settings, live: undefined }));
}

export function decodeMusicSettings(param: string | null | undefined): MusicSettings | null {
  const text = decodeBase64Url(param);
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return isObject(parsed) ? normalizeMusicSettings(parsed) : null;
  } catch {
    return null;
  }
}

/** ¿El mensaje es uno de los dos comandos? Solo cuenta la primera palabra. */
export function parseMusicCommand(message: string, commands: MusicCommands): 'show' | 'hide' | null {
  const word = message.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  if (!word.startsWith('!')) return null;
  if (word === commands.show) return 'show';
  if (word === commands.hide) return 'hide';
  return null;
}
