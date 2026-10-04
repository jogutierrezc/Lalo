/**
 * chatFeed.ts
 *
 * Mensajes del chat tal como los pinta la capa «Chat en vivo». Todo es lógica
 * pura: convierte las etiquetas de tmi.js en un mensaje para mostrar, corta el
 * texto en trozos (texto y emotes), elige un color de nombre que se lea y
 * trae los mensajes de muestra del modo demostración.
 *
 * Imágenes de los emotes: plantilla oficial del CDN de Twitch,
 * https://static-cdn.jtvnw.net/emoticons/v2/{id}/{format}/{theme_mode}/{scale}
 * (format: static o animated; theme_mode: light o dark; scale: 1.0, 2.0 o 3.0).
 * Fuente: https://dev.twitch.tv/docs/api/reference/ (Get Channel Emotes) y
 * https://dev.twitch.tv/docs/irc/emotes/
 */

import type { ChatTags } from './moderation';
import { isEmoteOnly, roleFromTags } from './moderation';

export type ChatBadge = 'broadcaster' | 'mod' | 'vip' | 'sub';

export interface EmoteRange {
  id: string;
  start: number; // posición del primer carácter (cuenta caracteres, no bytes)
  end: number; // posición del último carácter, incluido
}

export interface ChatDisplayMessage {
  id: string;
  user: string; // nombre visible
  username: string; // login en minúsculas
  color: string | null; // color que eligió el usuario en Twitch, o null
  badges: ChatBadge[];
  text: string;
  emotes: EmoteRange[];
  bits: number;
  first: boolean; // primer mensaje de esta persona en el canal
  subscriber: boolean;
  highlighted: boolean; // «Destacar mi mensaje» con puntos del canal
  emoteOnly: boolean;
  voice: boolean; // la voz lo va a leer
  at: number;
}

/** Lo que hace un moderador y obliga a quitar mensajes de pantalla. */
export type ChatModerationEvent =
  | { type: 'delete'; id: string }
  | { type: 'user'; username: string }
  | { type: 'clear' };

export type ChatSegment = { kind: 'text'; value: string } | { kind: 'emote'; id: string; name: string };

export interface FeedTags extends ChatTags {
  id?: string;
  color?: string;
  'display-name'?: string;
  'first-msg'?: boolean | string | number;
  'tmi-sent-ts'?: string;
}

const truthy = (value: unknown) => value === true || value === '1' || value === 1;

/** Lee las posiciones de emotes que entrega tmi.js: { id: ['0-4', '6-10'] }. */
export function parseEmoteRanges(emotes: Record<string, string[]> | null | undefined, length: number): EmoteRange[] {
  if (!emotes) return [];
  const ranges: EmoteRange[] = [];
  Object.entries(emotes).forEach(([id, list]) => {
    if (!/^[A-Za-z0-9_]{1,64}$/.test(id) || !Array.isArray(list)) return;
    list.forEach((range) => {
      const [start, end] = String(range).split('-').map(Number);
      if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start && end < length) {
        ranges.push({ id, start, end });
      }
    });
  });
  ranges.sort((a, b) => a.start - b.start);
  // Rangos que se pisan: se queda el primero
  return ranges.filter((range, i) => i === 0 || range.start > ranges[i - 1].end);
}

/** Convierte un mensaje de tmi.js en el mensaje que pinta la capa. */
export function toDisplayMessage(
  tags: FeedTags,
  message: string,
  channel: string,
  extra: { id: string; voice?: boolean; now?: number }
): ChatDisplayMessage {
  const role = roleFromTags(tags, channel);
  const badgeMap = (tags.badges || {}) as Record<string, string | undefined>;
  const subscriber = truthy(tags.subscriber) || badgeMap.subscriber !== undefined || badgeMap.founder !== undefined;
  const badges: ChatBadge[] = [];
  if (role === 'broadcaster') badges.push('broadcaster');
  if (role === 'mod') badges.push('mod');
  if (badgeMap.vip !== undefined) badges.push('vip');
  if (subscriber) badges.push('sub');

  const username = (tags.username || 'viewer').toLowerCase();
  const sent = Number(tags['tmi-sent-ts']);
  return {
    id: extra.id,
    user: tags['display-name'] || tags.username || 'viewer',
    username,
    color: typeof tags.color === 'string' && /^#[0-9a-f]{6}$/i.test(tags.color) ? tags.color : null,
    badges,
    text: message,
    emotes: parseEmoteRanges(tags.emotes, Array.from(message).length),
    bits: Math.max(0, Number(tags.bits) || 0),
    first: truthy(tags['first-msg']),
    subscriber,
    highlighted: tags['msg-id'] === 'highlighted-message',
    emoteOnly: isEmoteOnly(message, tags),
    voice: extra.voice === true,
    at: Number.isFinite(sent) && sent > 0 ? sent : extra.now ?? Date.now(),
  };
}

/** Corta el texto en trozos de texto y emotes, en orden. */
export function splitMessage(text: string, emotes: EmoteRange[]): ChatSegment[] {
  const chars = Array.from(text);
  const segments: ChatSegment[] = [];
  let cursor = 0;
  emotes.forEach((range) => {
    if (range.start < cursor || range.end >= chars.length) return;
    if (range.start > cursor) segments.push({ kind: 'text', value: chars.slice(cursor, range.start).join('') });
    segments.push({ kind: 'emote', id: range.id, name: chars.slice(range.start, range.end + 1).join('') });
    cursor = range.end + 1;
  });
  if (cursor < chars.length) segments.push({ kind: 'text', value: chars.slice(cursor).join('') });
  return segments;
}

export type EmoteFormat = 'default' | 'static';

/** Dirección de la imagen de un emote en el CDN de Twitch. */
export function emoteUrl(id: string, theme: 'dark' | 'light' = 'dark', format: EmoteFormat = 'default'): string {
  return `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(id)}/${format}/${theme}/2.0`;
}

// ---------- Color del nombre ----------

const FALLBACK_COLORS = ['#ff7a45', '#22c8f0', '#3ddc84', '#ffb020', '#ff3b6b', '#b68cff', '#6b8cff'];

const toRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const luminance = (hex: string) => {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Contraste WCAG entre dos colores #rrggbb. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Color del nombre que se lee sobre el fondo de la plantilla. Si Twitch no da
 * color, se elige uno fijo por usuario. Si el color no contrasta lo bastante,
 * se acerca poco a poco al blanco (fondo oscuro) o al negro (fondo claro).
 */
export function readableNameColor(color: string | null, username: string, background: string): string {
  const bg = /^#[0-9a-f]{6}$/i.test(background) ? background : '#1b1c1f';
  let base = color && /^#[0-9a-f]{6}$/i.test(color) ? color : null;
  if (!base) {
    let hash = 0;
    for (const ch of username) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    base = FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
  }
  const target = luminance(bg) > 0.4 ? [0, 0, 0] : [255, 255, 255];
  const rgb = toRgb(base);
  let result = base;
  for (let step = 1; step <= 10 && contrastRatio(result, bg) < 4.5; step += 1) {
    result = toHex(rgb.map((v, i) => v + (target[i] - v) * (step / 10)));
  }
  return result;
}

// ---------- Modo demostración ----------

export type DemoKind = 'normal' | 'command' | 'sub' | 'bits' | 'emotes' | 'first' | 'mod';

interface DemoSeed {
  user: string;
  text: string;
  color?: string;
  badges?: ChatBadge[];
  bits?: number;
  first?: boolean;
  highlighted?: boolean;
  emotes?: Record<string, string[]>;
}

// Emotes globales de Twitch: Kappa (25), LUL (425618), HeyGuys (30259)
const DEMO: Record<DemoKind, DemoSeed[]> = {
  normal: [
    { user: 'leo_m', text: 'qué buena partida', color: '#22c8f0' },
    { user: 'luz88', text: 'ese salto estuvo limpio' },
    { user: 'tomi', text: 'cuánto falta para el jefe?', color: '#1a1a8c' },
    { user: 'nico_vt', text: 'jajaja LUL no me lo esperaba', color: '#ffb020', emotes: { '425618': ['7-9'] } },
  ],
  command: [{ user: 'dani_gg', text: '{cmd} saludos desde Bogotá', color: '#3ddc84' }],
  sub: [{ user: 'mar_ia', text: 'gracias por el directo, aquí seguimos', color: '#ff3b6b', badges: ['sub'], highlighted: true }],
  bits: [{ user: 'pau_rl', text: 'a por ese récord', color: '#b68cff', badges: ['vip'], bits: 500 }],
  emotes: [{ user: 'xx_pro', text: 'Kappa LUL HeyGuys', color: '#ff7a45', emotes: { '25': ['0-4'], '425618': ['6-8'], '30259': ['10-16'] } }],
  first: [{ user: 'ana_k', text: 'primer directo que veo, me quedo', badges: [], first: true }],
  mod: [{ user: 'caro_tv', text: 'recuerden: sin spoilers', color: '#6b8cff', badges: ['mod'] }],
};

let demoCount = 0;

/** Un mensaje de muestra de la clase pedida. `command` es el comando de voz vigente. */
export function demoMessage(kind: DemoKind, command = '!s', voice = false): ChatDisplayMessage {
  const pool = DEMO[kind];
  demoCount += 1;
  const seed = pool[demoCount % pool.length];
  const text = seed.text.replace('{cmd}', command);
  const tags: ChatTags = { emotes: seed.emotes };
  return {
    id: `demo-${Date.now()}-${demoCount}`,
    user: seed.user,
    username: seed.user.toLowerCase(),
    color: seed.color || null,
    badges: seed.badges || [],
    text,
    emotes: parseEmoteRanges(seed.emotes, Array.from(text).length),
    bits: seed.bits || 0,
    first: seed.first === true,
    subscriber: (seed.badges || []).includes('sub'),
    highlighted: seed.highlighted === true,
    emoteOnly: isEmoteOnly(text, tags),
    voice,
    at: Date.now(),
  };
}

/** Orden del chat simulado: mezcla mensajes normales con cada clase especial. */
export const DEMO_SEQUENCE: DemoKind[] = [
  'normal', 'mod', 'command', 'normal', 'sub', 'normal', 'emotes', 'first', 'bits', 'normal',
];
