/**
 * src/types/chat.ts
 *
 * Ajustes de la capa «Chat en vivo»: plantilla, plantilla personalizada,
 * movimiento, colocación y destacados. Se guardan en este navegador y, con
 * cuenta abierta, en la nube. Lo leído (de localStorage, de la nube o de la URL)
 * pasa siempre por normalizeChatSettings.
 */

import { queueCloudPush } from '../lib/cloudConfig';
import { decodeBase64Url, encodeBase64Url } from '../utils/appearance';

export type ChatTemplate = 'cabina' | 'burbuja' | 'subtitulo' | 'cristal' | 'terminal' | 'custom';
/** 'propio' es el movimiento que trae cada plantilla; los demás son genéricos. */
export type ChatMotion = 'propio' | 'deslizar' | 'brotar' | 'aparecer' | 'escribir';
export type ChatEnergy = 'calma' | 'normal' | 'hype';
export type ChatSide = 'l' | 'r';
export type ChatFont = 'archivo' | 'onest' | 'bricolage' | 'mono';

export interface ChatCustom {
  font: ChatFont;
  bg: string; // fondo del mensaje
  fg: string; // color del texto
  accent: string; // color de los destacados
  opacity: number; // opacidad del fondo, de 0 a 1
  radius: number; // redondeo en em, de 0 a 1.6
}

export interface ChatSettings {
  template: ChatTemplate;
  custom: ChatCustom;
  motion: ChatMotion;
  energy: ChatEnergy;
  side: ChatSide;
  size: number; // tamaño del texto, de 0.7 a 1.5
  width: number; // ancho de la columna en em
  maxMessages: number; // mensajes a la vez en pantalla
  seconds: number; // segundos en pantalla (0 = se quedan hasta que los empuja otro)
  badges: boolean; // insignias MOD, SUB, VIP y la del canal
  highlightSubs: boolean; // franja de color en mensajes de suscriptores y destacados
  highlightBits: boolean; // mensajes con bits en color lleno
  bigEmotes: boolean; // mensajes de solo emotes más grandes
  hideCommands: boolean; // no mostrar mensajes que empiezan por !
  hideBots: boolean; // no mostrar los bots conocidos
  voiceMark: boolean; // marca en los mensajes que lee la voz
  inAll: boolean; // aparece también en la fuente «Todo en uno»
}

export const CHAT_TEMPLATES: { id: ChatTemplate; name: string; hint: string }[] = [
  { id: 'cabina', name: 'Cabina', hint: 'Placas mate en el lenguaje del panel. La más sobria.' },
  { id: 'burbuja', name: 'Burbuja', hint: 'Globos de cómic con borde grueso. Para canales desenfadados.' },
  { id: 'subtitulo', name: 'Subtítulo', hint: 'Sin caja: texto con contorno sobre la imagen. Ocupa lo mínimo.' },
  { id: 'cristal', name: 'Cristal', hint: 'Cristal esmerilado con los morados de Twitch.' },
  { id: 'terminal', name: 'Terminal', hint: 'Monoespaciada, en verde sobre negro, sin separación entre líneas.' },
  { id: 'custom', name: 'Personalizada', hint: 'Parte de Cabina y cambias tipografía, colores, opacidad y redondeo.' },
];

export const CHAT_MOTIONS: { id: ChatMotion; name: string }[] = [
  { id: 'propio', name: 'Propio de la plantilla' },
  { id: 'deslizar', name: 'Deslizar' },
  { id: 'brotar', name: 'Brotar' },
  { id: 'aparecer', name: 'Aparecer' },
  { id: 'escribir', name: 'Escribir' },
];

export const CHAT_ENERGIES: { id: ChatEnergy; name: string }[] = [
  { id: 'calma', name: 'Calma' },
  { id: 'normal', name: 'Normal' },
  { id: 'hype', name: 'Hype' },
];

export const CHAT_FONTS: { id: ChatFont; name: string; stack: string }[] = [
  { id: 'archivo', name: 'Archivo condensada', stack: "'Archivo', 'Arial Narrow', system-ui, sans-serif" },
  { id: 'onest', name: 'Onest', stack: "'Onest', system-ui, sans-serif" },
  { id: 'bricolage', name: 'Bricolage', stack: "'Bricolage Grotesque', 'Trebuchet MS', system-ui, sans-serif" },
  { id: 'mono', name: 'JetBrains Mono', stack: "'JetBrains Mono', ui-monospace, Consolas, monospace" },
];

/** Qué describe en una línea el movimiento propio de cada plantilla (para el estudio). */
export const CHAT_SIGNATURE: Record<ChatTemplate, string> = {
  cabina: 'Se despliega desde el borde, con el nombre por delante, como un rótulo de televisión.',
  burbuja: 'El globo crece desde su punta, rebota un poco y se asienta.',
  subtitulo: 'Las palabras suben una a una y se van desenfocando.',
  cristal: 'Llega borroso, se enfoca y un brillo lo cruza una sola vez.',
  terminal: 'La línea se escribe sola con un cursor que parpadea dos veces.',
  custom: 'Usa el movimiento de Cabina: se despliega desde el borde con el nombre por delante.',
};

export const CHAT_LIMITS = {
  size: { min: 0.7, max: 1.5 },
  width: { min: 16, max: 40 },
  maxMessages: { min: 3, max: 15 },
  seconds: { min: 0, max: 60 },
  radius: { min: 0, max: 1.6 },
} as const;

export const DEFAULT_CHAT_CUSTOM: ChatCustom = {
  font: 'archivo',
  bg: '#1b1c1f',
  fg: '#efe9dc',
  accent: '#9146ff',
  opacity: 0.92,
  radius: 0.2,
};

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  template: 'cabina',
  custom: DEFAULT_CHAT_CUSTOM,
  motion: 'propio',
  energy: 'normal',
  side: 'l',
  size: 1,
  width: 24,
  maxMessages: 8,
  seconds: 12,
  badges: true,
  highlightSubs: true,
  highlightBits: true,
  bigEmotes: true,
  hideCommands: false,
  hideBots: true,
  voiceMark: false,
  inAll: true,
};

export const CHAT_STORAGE_KEY = 'lalo_chat_settings';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const oneOf = <T extends string>(value: unknown, list: readonly { id: T }[], fallback: T): T =>
  list.some((item) => item.id === value) ? (value as T) : fallback;
const num = (value: unknown, min: number, max: number, fallback: number, round = false): number => {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.min(max, Math.max(min, n));
  return round ? Math.round(clamped) : Math.round(clamped * 100) / 100;
};
const hex = (value: unknown, fallback: string): string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : fallback;
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

/** Ajustes válidos a partir de cualquier cosa. Lo que falta o no vale queda en su valor por defecto. */
export function normalizeChatSettings(raw: unknown): ChatSettings {
  const source = isObject(raw) ? raw : {};
  const custom = isObject(source.custom) ? source.custom : {};
  const d = DEFAULT_CHAT_SETTINGS;
  return {
    template: oneOf(source.template, CHAT_TEMPLATES, d.template),
    custom: {
      font: oneOf(custom.font, CHAT_FONTS, DEFAULT_CHAT_CUSTOM.font),
      bg: hex(custom.bg, DEFAULT_CHAT_CUSTOM.bg),
      fg: hex(custom.fg, DEFAULT_CHAT_CUSTOM.fg),
      accent: hex(custom.accent, DEFAULT_CHAT_CUSTOM.accent),
      opacity: num(custom.opacity, 0, 1, DEFAULT_CHAT_CUSTOM.opacity),
      radius: num(custom.radius, CHAT_LIMITS.radius.min, CHAT_LIMITS.radius.max, DEFAULT_CHAT_CUSTOM.radius),
    },
    motion: oneOf(source.motion, CHAT_MOTIONS, d.motion),
    energy: oneOf(source.energy, CHAT_ENERGIES, d.energy),
    side: source.side === 'r' ? 'r' : 'l',
    size: num(source.size, CHAT_LIMITS.size.min, CHAT_LIMITS.size.max, d.size),
    width: num(source.width, CHAT_LIMITS.width.min, CHAT_LIMITS.width.max, d.width, true),
    maxMessages: num(source.maxMessages, CHAT_LIMITS.maxMessages.min, CHAT_LIMITS.maxMessages.max, d.maxMessages, true),
    seconds: num(source.seconds, CHAT_LIMITS.seconds.min, CHAT_LIMITS.seconds.max, d.seconds, true),
    badges: bool(source.badges, d.badges),
    highlightSubs: bool(source.highlightSubs, d.highlightSubs),
    highlightBits: bool(source.highlightBits, d.highlightBits),
    bigEmotes: bool(source.bigEmotes, d.bigEmotes),
    hideCommands: bool(source.hideCommands, d.hideCommands),
    hideBots: bool(source.hideBots, d.hideBots),
    voiceMark: bool(source.voiceMark, d.voiceMark),
    inAll: bool(source.inAll, d.inAll),
  };
}

export function loadChatSettings(): ChatSettings {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    return raw ? normalizeChatSettings(JSON.parse(raw)) : DEFAULT_CHAT_SETTINGS;
  } catch {
    return DEFAULT_CHAT_SETTINGS;
  }
}

export function saveChatSettings(settings: ChatSettings): void {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(settings));
    queueCloudPush('chat', settings);
  } catch (err) {
    console.error('Error guardando los ajustes del chat:', err);
  }
}

/** Ajustes compactos para la URL de OBS cuando no hay cuenta en la nube. */
export function encodeChatSettings(settings: ChatSettings): string {
  return encodeBase64Url(JSON.stringify(settings));
}

/** Ajustes recibidos por URL, o null si el valor no se puede leer. */
export function decodeChatSettings(param: string | null | undefined): ChatSettings | null {
  const text = decodeBase64Url(param);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return isObject(parsed) ? normalizeChatSettings(parsed) : null;
  } catch {
    return null;
  }
}

/** Fondo sobre el que se lee el nombre en cada plantilla, para elegir un color con contraste. */
export function chatNameBackground(settings: ChatSettings): string {
  switch (settings.template) {
    case 'burbuja':
      return '#ffffff';
    case 'subtitulo':
      return '#0c0b12';
    case 'cristal':
      return '#1a1030';
    case 'terminal':
      return '#06090c';
    case 'custom':
      return settings.custom.bg;
    default:
      return '#1b1c1f';
  }
}
