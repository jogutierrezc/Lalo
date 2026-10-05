/**
 * src/types/pets.ts
 *
 * Ajustes del módulo «Mascotas»: el personaje (uno de Lalo o las imágenes que
 * sube el streamer), su voz, cómo se mueve y dónde sale, y a qué reacciona.
 * Se guardan en este navegador y, con cuenta abierta, en la nube. Lo leído (de
 * localStorage, de la nube o de la URL) pasa siempre por normalizePetsSettings.
 *
 * La clave de la IA del streamer NO vive aquí: estos ajustes los lee cualquiera
 * que tenga la URL de OBS. La guarda cifrada el servidor.
 */

import { queueCloudPush } from '../lib/cloudConfig';
import { decodeBase64Url, encodeBase64Url } from '../utils/appearance';

export type PetKind = 'chispa' | 'bit' | 'miso' | 'custom';
export type PetPos = 'bl' | 'br' | 'tl' | 'tr';
export type PetStay = 'always' | 'talk';
export type PetEnter = 'asoma' | 'salta' | 'desliza' | 'aparece';
export type PetIdle = 'respira' | 'flota' | 'quieta';
export type PetFx = 'chispas' | 'onda' | 'sacudida' | 'nada';
export type PetBubble = 'bocadillo' | 'rotulo' | 'none';
export type PetTurn = 'espera' | 'primero' | 'calla';
export type PetTriggerId = 'points' | 'bits' | 'powerup' | 'mention' | 'raid' | 'quiet';
export type PetReply = 'frases' | 'ia';
export type PetBrain = 'frases' | 'ia';
export type PetProvider = 'gemini' | 'openai' | 'anthropic';

/** Personajes de Lalo. Son figuras de muestra: el arte final se dibuja aparte. */
export const PET_KINDS: { id: Exclude<PetKind, 'custom'>; name: string }[] = [
  { id: 'chispa', name: 'Chispa' },
  { id: 'bit', name: 'Bit' },
  { id: 'miso', name: 'Miso' },
];
export const PET_COLORS = ['#ffb347', '#7fe6a9', '#b995ff', '#ff8a80', '#6cc7ff'] as const;

export const PET_POSITIONS: { id: PetPos; name: string }[] = [
  { id: 'bl', name: 'Abajo izq.' },
  { id: 'br', name: 'Abajo der.' },
  { id: 'tl', name: 'Arriba izq.' },
  { id: 'tr', name: 'Arriba der.' },
];
export const PET_STAYS: { id: PetStay; name: string }[] = [
  { id: 'always', name: 'Siempre en pantalla' },
  { id: 'talk', name: 'Solo cuando habla' },
];
export const PET_ENTERS: { id: PetEnter; name: string }[] = [
  { id: 'asoma', name: 'Asoma' },
  { id: 'salta', name: 'Salta' },
  { id: 'desliza', name: 'Desliza' },
  { id: 'aparece', name: 'Aparece' },
];
export const PET_IDLES: { id: PetIdle; name: string }[] = [
  { id: 'respira', name: 'Respira' },
  { id: 'flota', name: 'Flota' },
  { id: 'quieta', name: 'Quieta' },
];
export const PET_FXS: { id: PetFx; name: string }[] = [
  { id: 'chispas', name: 'Chispas' },
  { id: 'onda', name: 'Onda' },
  { id: 'sacudida', name: 'Sacudida' },
  { id: 'nada', name: 'Ninguno' },
];
export const PET_BUBBLES: { id: PetBubble; name: string }[] = [
  { id: 'bocadillo', name: 'Bocadillo' },
  { id: 'rotulo', name: 'Rótulo' },
  { id: 'none', name: 'Solo voz' },
];
export const PET_TURNS: { id: PetTurn; name: string; hint: string }[] = [
  { id: 'espera', name: 'Espera su turno', hint: 'La mascota entra en la misma cola que la Voz del chat y habla cuando le toca.' },
  { id: 'primero', name: 'Pasa primero', hint: 'La mascota se adelanta a los mensajes que estén esperando. Nunca corta al que ya está sonando.' },
  { id: 'calla', name: 'Calla si hay cola', hint: 'Si hay mensajes esperando, la mascota no dice nada. Útil en chats muy activos.' },
];
export const PET_TRIGGERS: { id: PetTriggerId; name: string; hint: string; vars: string }[] = [
  { id: 'points', name: 'Canje de puntos', hint: 'Cuando alguien canjea una recompensa del canal. Necesita el canal de eventos de «Power-ups».', vars: '{user} {canje} {costo}' },
  { id: 'bits', name: 'Bits', hint: 'Cuando alguien envía un cheer.', vars: '{user} {bits}' },
  { id: 'powerup', name: 'Power-up', hint: 'Los de serie y los personalizados. Necesita el canal de eventos de «Power-ups».', vars: '{user} {canje} {bits}' },
  { id: 'mention', name: 'La llaman en el chat', hint: 'Con su comando o al escribir su nombre.', vars: '{user} {mensaje}' },
  { id: 'raid', name: 'Raid', hint: 'Cuando llega otro canal.', vars: '{user} {personas}' },
  { id: 'quiet', name: 'Chat en silencio', hint: 'Tras un rato sin mensajes. Habla una vez y espera a que el chat vuelva.', vars: '' },
];

export interface PetTrigger {
  on: boolean;
  /** `ia` solo cuenta con el modo IA encendido y la cuenta conectada; si no, se leen las frases. */
  reply: PetReply;
  /** Una frase por elemento; la mascota elige una al azar. */
  lines: string[];
  /** Segundos entre una reacción y la siguiente de este activador. */
  cooldownSec: number;
}

export interface PetImage {
  url: string;
  name: string;
  mediaId: string;
}

export interface PetsSettings {
  enabled: boolean;
  /** Aparece también en la fuente «Todo en uno». */
  inAll: boolean;
  kind: PetKind;
  color: string;
  /** Personaje propio: imagen en reposo y, opcional, hablando (puede ser un GIF). */
  idleImage: PetImage | null;
  talkImage: PetImage | null;
  name: string;
  /** Voz del catálogo con la que habla. Vacío: la misma que la Voz del chat. */
  voiceId: string;
  pos: PetPos;
  stay: PetStay;
  /** Ancho del personaje, en em de la capa (a 1920 px, 1 em son 40 px). */
  size: number;
  enter: PetEnter;
  idle: PetIdle;
  fx: PetFx;
  bubble: PetBubble;
  turn: PetTurn;
  triggers: Record<PetTriggerId, PetTrigger>;
  /** Comando con el que el chat la llama. */
  command: string;
  minBits: number;
  quietMinutes: number;
  /** Los canjes con texto ya los lee la Voz del chat: la mascota no los anuncia. */
  skipTextRedemptions: boolean;
  // ---- IA (la clave no va aquí) ----
  brain: PetBrain;
  provider: PetProvider;
  model: string;
  personality: string;
  never: string;
  maxSentences: number;
  aiWaitSec: number;
  aiDailyCap: number;
  aiFilter: boolean;
}

export const PETS_STORAGE_KEY = 'lalo_pets_settings';
export const PET_LIMITS = {
  name: 20,
  line: 200,
  lines: 12,
  size: { min: 5, max: 11 },
  cooldownSec: { min: 0, max: 3600 },
  minBits: { min: 1, max: 100000 },
  quietMinutes: { min: 1, max: 60 },
  personality: 600,
  never: 200,
  maxSentences: { min: 1, max: 3 },
  aiWaitSec: { min: 5, max: 600 },
  aiDailyCap: { min: 10, max: 5000 },
} as const;

export const DEFAULT_PET_COMMAND = '!mascota';
export const DEFAULT_PET_PERSONALITY =
  'Eres {nombre}, la mascota del canal. Hablas con cariño, celebras todo y animas al chat. Frases cortas, sin palabrotas.';

export const DEFAULT_PET_TRIGGERS: Record<PetTriggerId, PetTrigger> = {
  points: { on: true, reply: 'frases', cooldownSec: 10, lines: ['¡{user} canjeó {canje}! Así me gusta.', 'Atención, chat: {user} gastó {costo} puntos en {canje}.'] },
  bits: { on: true, reply: 'frases', cooldownSec: 10, lines: ['¡{bits} bits de {user}! Me brillan los ojos.', '{user} acaba de soltar {bits} bits. Gracias, de verdad.'] },
  powerup: { on: true, reply: 'frases', cooldownSec: 10, lines: ['{user} activó {canje}. ¡Que empiece el caos!'] },
  mention: { on: true, reply: 'frases', cooldownSec: 20, lines: ['Aquí estoy, {user}. ¿Qué necesitas?', 'Me han llamado. Hola, {user}.'] },
  raid: { on: true, reply: 'frases', cooldownSec: 0, lines: ['¡Llega {user} con {personas} personas! Pasen, pasen, hay sitio.'] },
  quiet: { on: false, reply: 'frases', cooldownSec: 300, lines: ['¿Hola? ¿Sigue alguien por ahí?', 'Qué silencio. Yo puedo esperar, tengo todo el directo.'] },
};

export const DEFAULT_PETS_SETTINGS: PetsSettings = {
  enabled: true,
  inAll: false,
  kind: 'chispa',
  color: PET_COLORS[0],
  idleImage: null,
  talkImage: null,
  name: 'Chispa',
  voiceId: '',
  pos: 'bl',
  stay: 'always',
  size: 7.5,
  enter: 'asoma',
  idle: 'respira',
  fx: 'chispas',
  bubble: 'bocadillo',
  turn: 'espera',
  triggers: DEFAULT_PET_TRIGGERS,
  command: DEFAULT_PET_COMMAND,
  minBits: 100,
  quietMinutes: 5,
  skipTextRedemptions: true,
  brain: 'frases',
  provider: 'gemini',
  model: '',
  personality: DEFAULT_PET_PERSONALITY,
  never: 'política, datos personales, otros streamers',
  maxSentences: 2,
  aiWaitSec: 20,
  aiDailyCap: 200,
  aiFilter: true,
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
const TRIGGER_IDS = PET_TRIGGERS.map((item) => item.id);

function normalizeImage(raw: unknown): PetImage | null {
  if (!isObject(raw) || typeof raw.url !== 'string' || !raw.url) return null;
  // Solo direcciones que una <img> puede cargar sin ejecutar nada
  if (!/^(https:\/\/|r2:|data:image\/|blob:|\/)/i.test(raw.url)) return null;
  return { url: raw.url, name: text(raw.name, 120), mediaId: text(raw.mediaId, 80) };
}

function normalizeTrigger(raw: unknown, fallback: PetTrigger): PetTrigger {
  const src = isObject(raw) ? raw : {};
  const lines = Array.isArray(src.lines)
    ? src.lines.map((line) => text(line, PET_LIMITS.line)).filter(Boolean).slice(0, PET_LIMITS.lines)
    : fallback.lines;
  return {
    on: bool(src.on, fallback.on),
    reply: src.reply === 'ia' ? 'ia' : src.reply === 'frases' ? 'frases' : fallback.reply,
    lines,
    cooldownSec: num(src.cooldownSec, PET_LIMITS.cooldownSec, fallback.cooldownSec),
  };
}

/** Comando válido: empieza por !, de 1 a 15 letras, números o guion bajo, en minúsculas. */
export function normalizePetCommand(value: unknown): string {
  const raw = String(value ?? '').trim().toLowerCase();
  const command = raw.startsWith('!') ? raw : `!${raw}`;
  return /^![a-z0-9_]{1,15}$/.test(command) ? command : DEFAULT_PET_COMMAND;
}

/** Ajustes válidos a partir de cualquier cosa. Lo que falta o no vale queda en su valor por defecto. */
export function normalizePetsSettings(raw: unknown): PetsSettings {
  const src = isObject(raw) ? raw : {};
  const d = DEFAULT_PETS_SETTINGS;
  const rawTriggers = isObject(src.triggers) ? src.triggers : {};
  const triggers = {} as Record<PetTriggerId, PetTrigger>;
  TRIGGER_IDS.forEach((id) => {
    triggers[id] = normalizeTrigger(rawTriggers[id], DEFAULT_PET_TRIGGERS[id]);
  });
  const idleImage = normalizeImage(src.idleImage);
  const kind = src.kind === 'custom' ? 'custom' : oneOf(src.kind, PET_KINDS, d.kind);
  return {
    enabled: bool(src.enabled, d.enabled),
    inAll: bool(src.inAll, d.inAll),
    // Sin imagen de reposo no hay personaje propio que pintar
    kind: kind === 'custom' && !idleImage ? d.kind : kind,
    color: typeof src.color === 'string' && /^#[0-9a-f]{6}$/i.test(src.color) ? src.color.toLowerCase() : d.color,
    idleImage,
    talkImage: idleImage ? normalizeImage(src.talkImage) : null,
    name: text(src.name, PET_LIMITS.name) || d.name,
    voiceId: typeof src.voiceId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(src.voiceId) ? src.voiceId : '',
    pos: oneOf(src.pos, PET_POSITIONS, d.pos),
    stay: oneOf(src.stay, PET_STAYS, d.stay),
    size: num(src.size, PET_LIMITS.size, d.size, 0.5),
    enter: oneOf(src.enter, PET_ENTERS, d.enter),
    idle: oneOf(src.idle, PET_IDLES, d.idle),
    fx: oneOf(src.fx, PET_FXS, d.fx),
    bubble: oneOf(src.bubble, PET_BUBBLES, d.bubble),
    turn: oneOf(src.turn, PET_TURNS, d.turn),
    triggers,
    command: normalizePetCommand(src.command ?? d.command),
    minBits: num(src.minBits, PET_LIMITS.minBits, d.minBits),
    quietMinutes: num(src.quietMinutes, PET_LIMITS.quietMinutes, d.quietMinutes),
    skipTextRedemptions: bool(src.skipTextRedemptions, d.skipTextRedemptions),
    brain: src.brain === 'ia' ? 'ia' : 'frases',
    provider: src.provider === 'openai' || src.provider === 'anthropic' ? src.provider : 'gemini',
    model: typeof src.model === 'string' && /^[A-Za-z0-9._:/-]{1,80}$/.test(src.model) ? src.model : '',
    personality: text(src.personality, PET_LIMITS.personality) || d.personality,
    // Vacío vale: el streamer puede no vetar ningún tema
    never: typeof src.never === 'string' ? text(src.never, PET_LIMITS.never) : d.never,
    maxSentences: num(src.maxSentences, PET_LIMITS.maxSentences, d.maxSentences),
    aiWaitSec: num(src.aiWaitSec, PET_LIMITS.aiWaitSec, d.aiWaitSec),
    aiDailyCap: num(src.aiDailyCap, PET_LIMITS.aiDailyCap, d.aiDailyCap),
    aiFilter: bool(src.aiFilter, d.aiFilter),
  };
}

export function loadPetsSettings(): PetsSettings {
  try {
    const raw = localStorage.getItem(PETS_STORAGE_KEY);
    return raw ? normalizePetsSettings(JSON.parse(raw)) : DEFAULT_PETS_SETTINGS;
  } catch {
    return DEFAULT_PETS_SETTINGS;
  }
}

export function savePetsSettings(settings: PetsSettings): void {
  try {
    localStorage.setItem(PETS_STORAGE_KEY, JSON.stringify(settings));
    queueCloudPush('pets', settings);
  } catch (err) {
    console.error('No se pudieron guardar los ajustes de Mascotas:', err);
  }
}

/**
 * Ajustes compactos para la URL de OBS cuando no hay cuenta en la nube. Las
 * imágenes guardadas solo en este navegador no caben en una URL y no viajan.
 */
export function encodePetsSettings(settings: PetsSettings): string {
  const travels = (image: PetImage | null) => (image && !/^(data:|blob:)/i.test(image.url) ? image : null);
  const idleImage = travels(settings.idleImage);
  return encodeBase64Url(
    JSON.stringify({ ...settings, idleImage, talkImage: idleImage ? travels(settings.talkImage) : null })
  );
}

/** Ajustes recibidos por URL, o null si el valor no se puede leer. */
export function decodePetsSettings(param: string | null | undefined): PetsSettings | null {
  const decoded = decodeBase64Url(param);
  if (!decoded) return null;
  try {
    const parsed = JSON.parse(decoded);
    return isObject(parsed) ? normalizePetsSettings(parsed) : null;
  } catch {
    return null;
  }
}
