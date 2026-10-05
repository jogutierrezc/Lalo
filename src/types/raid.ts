/**
 * src/types/raid.ts
 *
 * Ajustes de la capa «Saludo de raid»: cuándo aparece, cuánto dura el corto, la
 * bienvenida con voz, el marco y los comandos de moderación. Se guardan en este
 * navegador y, con cuenta abierta, en la nube. Lo leído (de localStorage, de la
 * nube o de la URL) pasa siempre por normalizeRaidSettings.
 */

import { queueCloudPush } from '../lib/cloudConfig';
import { decodeBase64Url, encodeBase64Url } from '../utils/appearance';

export type RaidFrame = 'cabina' | 'cristal' | 'comic';

export interface RaidCommands {
  so: string; // saludo a un canal sin esperar a una raid
  clip: string; // reproduce un corto concreto
  cut: string; // retira el saludo de inmediato
}

export interface RaidSettings {
  enabled: boolean; // la capa responde a raids y comandos
  minViewers: number; // personas mínimas para saludar una raid
  maxClipSeconds: number; // segundos máximos de corto
  clipDays: number; // se busca el corto más visto de estos últimos días
  voice: boolean; // la voz da la bienvenida en las raids
  voiceTemplate: string; // texto con {canal} y {personas}
  /** Voz de la bienvenida y de los avisos por comando (!so, !prediccion). Vacío: la de «Voz del chat». */
  voiceId: string;
  frame: RaidFrame;
  commands: RaidCommands;
  cooldownSec: number; // espera de cada comando entre un uso y el siguiente
  inAll: boolean; // aparece también en la fuente «Todo en uno»
}

export const RAID_FRAMES: { id: RaidFrame; name: string; hint: string }[] = [
  { id: 'cabina', name: 'Cabina', hint: 'Placa mate en el lenguaje del panel, con el nombre en condensada.' },
  { id: 'cristal', name: 'Cristal', hint: 'Cristal esmerilado con los morados de Twitch.' },
  { id: 'comic', name: 'Cómic', hint: 'Fondo blanco, borde grueso y esquinas redondas.' },
];

export const RAID_LIMITS = {
  minViewers: { min: 1, max: 500 },
  maxClipSeconds: { min: 5, max: 30 },
  clipDays: { min: 1, max: 365 },
  cooldownSec: { min: 0, max: 600 },
  template: 160,
} as const;

export const DEFAULT_RAID_COMMANDS: RaidCommands = { so: '!so', clip: '!clip', cut: '!cortar' };
export const DEFAULT_RAID_TEMPLATE = 'Gracias por la raid, {canal}. Bienvenidas las {personas} personas que llegan.';

/** Brisa, la voz «joven y alegre» del catálogo de serie: la que da los avisos si el streamer no elige otra. */
export const ANNOUNCER_VOICE_ID = '654e33e85be3406d90b9723712a035a9';

export const DEFAULT_RAID_SETTINGS: RaidSettings = {
  enabled: true,
  minViewers: 5,
  maxClipSeconds: 12,
  clipDays: 30,
  voice: true,
  voiceTemplate: DEFAULT_RAID_TEMPLATE,
  voiceId: ANNOUNCER_VOICE_ID,
  frame: 'cabina',
  commands: DEFAULT_RAID_COMMANDS,
  cooldownSec: 10,
  inAll: true,
};

export const RAID_STORAGE_KEY = 'lalo_raid_settings';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const int = (value: unknown, limits: { min: number; max: number }, fallback: number): number => {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? Math.round(Math.min(limits.max, Math.max(limits.min, n))) : fallback;
};
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

/**
 * Nombre de comando válido: empieza por !, de 1 a 15 letras, números o guion
 * bajo, en minúsculas. Cualquier otra cosa vuelve al nombre por defecto.
 */
export function normalizeCommandName(value: unknown, fallback: string): string {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  const command = raw.startsWith('!') ? raw : `!${raw}`;
  return /^![a-z0-9_]{1,15}$/.test(command) ? command : fallback;
}

/** Tres nombres distintos: uno repetido vuelve a su nombre por defecto. */
function normalizeCommands(raw: unknown): RaidCommands {
  const source = isObject(raw) ? raw : {};
  const d = DEFAULT_RAID_COMMANDS;
  const commands: RaidCommands = {
    so: normalizeCommandName(source.so, d.so),
    clip: normalizeCommandName(source.clip, d.clip),
    cut: normalizeCommandName(source.cut, d.cut),
  };
  if (commands.clip === commands.so) commands.clip = commands.so === d.clip ? d.so : d.clip;
  if (commands.cut === commands.so || commands.cut === commands.clip) {
    commands.cut = [d.cut, '!cortar2', '!cortar3'].find((name) => name !== commands.so && name !== commands.clip) as string;
  }
  return commands;
}

/** Ajustes válidos a partir de cualquier cosa. Lo que falta o no vale queda en su valor por defecto. */
export function normalizeRaidSettings(raw: unknown): RaidSettings {
  const source = isObject(raw) ? raw : {};
  const d = DEFAULT_RAID_SETTINGS;
  const template = typeof source.voiceTemplate === 'string' ? source.voiceTemplate.replace(/\s+/g, ' ').trim() : '';
  return {
    enabled: bool(source.enabled, d.enabled),
    minViewers: int(source.minViewers, RAID_LIMITS.minViewers, d.minViewers),
    maxClipSeconds: int(source.maxClipSeconds, RAID_LIMITS.maxClipSeconds, d.maxClipSeconds),
    clipDays: int(source.clipDays, RAID_LIMITS.clipDays, d.clipDays),
    voice: bool(source.voice, d.voice),
    voiceTemplate: template ? template.slice(0, RAID_LIMITS.template) : d.voiceTemplate,
    // Sin elegir nunca, Brisa; vacío a propósito, la voz del chat
    voiceId: typeof source.voiceId === 'string' ? (/^[A-Za-z0-9_-]{8,64}$/.test(source.voiceId) ? source.voiceId : '') : d.voiceId,
    frame: RAID_FRAMES.some((frame) => frame.id === source.frame) ? (source.frame as RaidFrame) : d.frame,
    commands: normalizeCommands(source.commands),
    cooldownSec: int(source.cooldownSec, RAID_LIMITS.cooldownSec, d.cooldownSec),
    inAll: bool(source.inAll, d.inAll),
  };
}

export function loadRaidSettings(): RaidSettings {
  try {
    const raw = localStorage.getItem(RAID_STORAGE_KEY);
    return raw ? normalizeRaidSettings(JSON.parse(raw)) : DEFAULT_RAID_SETTINGS;
  } catch {
    return DEFAULT_RAID_SETTINGS;
  }
}

export function saveRaidSettings(settings: RaidSettings): void {
  try {
    localStorage.setItem(RAID_STORAGE_KEY, JSON.stringify(settings));
    queueCloudPush('raid', settings);
  } catch (err) {
    console.error('Error guardando los ajustes del saludo de raid:', err);
  }
}

/** Ajustes compactos para la URL de OBS cuando no hay cuenta en la nube. */
export function encodeRaidSettings(settings: RaidSettings): string {
  return encodeBase64Url(JSON.stringify(settings));
}

/** Ajustes recibidos por URL, o null si el valor no se puede leer. */
export function decodeRaidSettings(param: string | null | undefined): RaidSettings | null {
  const text = decodeBase64Url(param);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return isObject(parsed) ? normalizeRaidSettings(parsed) : null;
  } catch {
    return null;
  }
}
