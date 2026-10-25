/**
 * server/lux/proactive.ts
 *
 * Lo que la IA dice sin que se lo pidan en el chat: comentarios espontáneos,
 * saludos a eventos (seguidor, suscripción, raid, inicio del directo) y mensajes
 * que el creador escribe desde el panel. Aquí viven las reglas y los prompts; el
 * camino al modelo, el consumo y la voz son los de handlers.ts.
 */

import type { ChatMessage } from './nvidia.js';
import type { LuxMemoryRow } from './luxDb.js';
import { EMOTION_INSTRUCTION } from './emotion.js';
import { systemFor } from './prompt.js';
import type { ChatLine } from './digest.js';

const LANGUAGE_NAMES = { es: 'español', en: 'inglés', pt: 'portugués' } as const;

/** Frases del chat que se pasan al modelo en un comentario espontáneo. */
export const SPONTANEOUS_LINES_MAX = 40;

/** Texto máximo de una idea para que la IA redacte desde el panel. */
export const SAY_IDEA_MAX = 300;
/** Texto literal máximo desde el panel. Twitch admite 500 por mensaje; el bot parte lo que no quepa. */
export const SAY_TEXT_MAX = 500;
/** Espera mínima entre dos mensajes del panel, por perfil. */
export const SAY_COOLDOWN_MS = 10_000;
/** Mensajes pendientes como máximo por perfil. */
export const SAY_PENDING_MAX = 5;
/** Si pasa este tiempo sin que el bot recoja el mensaje, el panel avisa. */
export const SAY_STALLED_MS = 30_000;
/** Si el bot lo recogió y no confirma el envío en este tiempo, se da por no confirmado. */
export const SAY_UNCONFIRMED_MS = 60_000;
/** El bot cuenta como «en línea» si preguntó hace menos de esto. */
export const BOT_ONLINE_MS = 30_000;

/** Un saludo a eventos como mucho cada tanto, por perfil (el bot ya agrupa; esto es la red). */
export const EVENT_MIN_GAP_MS = 15_000;

export const LUX_EVENT_TYPES = ['follow', 'sub', 'raid', 'start'] as const;
export type LuxEventType = (typeof LUX_EVENT_TYPES)[number];

export interface LuxEvent {
  type: LuxEventType;
  /** Quien lo provoca: seguidor, suscriptor o quien hace la raid. */
  user: string | null;
  /** Suscripción: meses acumulados. */
  months: number | null;
  /** Raid: espectadores que llegan. */
  viewers: number | null;
  /** Suscripción regalada. */
  gift: boolean;
}

const EVENTS_MAX = 20;
const USER_MAX = 40;

const cleanName = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const name = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, USER_MAX);
  return name || null;
};

const cleanCount = (value: unknown, max: number): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), max) : null;
};

/** Eventos que manda el bot. Lo raro se descarta: nunca se fía de los tipos. */
export function normalizeEvents(input: unknown): LuxEvent[] {
  if (!Array.isArray(input)) return [];
  const events: LuxEvent[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.type !== 'string' || !(LUX_EVENT_TYPES as readonly string[]).includes(row.type)) continue;
    events.push({
      type: row.type as LuxEventType,
      user: cleanName(row.user),
      months: cleanCount(row.months, 1200),
      viewers: cleanCount(row.viewers, 10_000_000),
      gift: row.gift === true,
    });
  }
  return events.slice(0, EVENTS_MAX);
}

/** Se quedan los eventos que el creador tiene activados. */
export function eventsAllowed(
  events: LuxEvent[],
  flags: { eventFollow: boolean; eventSub: boolean; eventRaid: boolean; eventStart: boolean }
): LuxEvent[] {
  const on: Record<LuxEventType, boolean> = { follow: flags.eventFollow, sub: flags.eventSub, raid: flags.eventRaid, start: flags.eventStart };
  return events.filter((event) => on[event.type]);
}

const list = (names: string[]): string => {
  const shown = names.slice(0, 5);
  const rest = names.length - shown.length;
  return `${shown.join(', ')}${rest > 0 ? ` y ${rest} más` : ''}`;
};

/** Descripción de los eventos agrupados, una línea por tipo. Va al modelo, no al chat. */
export function describeEvents(events: LuxEvent[]): string[] {
  const lines: string[] = [];
  const follows = events.filter((event) => event.type === 'follow');
  if (follows.length > 0) {
    const names = follows.map((event) => event.user).filter((name): name is string => name !== null);
    lines.push(
      follows.length === 1 && names[0]
        ? `${names[0]} acaba de seguir el canal.`
        : `${follows.length} personas acaban de seguir el canal${names.length ? `: ${list(names)}` : ''}.`
    );
  }
  for (const event of events.filter((item) => item.type === 'sub')) {
    const who = event.user ?? 'Alguien';
    if (event.gift) lines.push(`${who} acaba de regalar una suscripción al canal.`);
    else if (event.months && event.months > 1) lines.push(`${who} se acaba de resuscribir (${event.months} meses en total).`);
    else lines.push(`${who} se acaba de suscribir al canal.`);
  }
  for (const event of events.filter((item) => item.type === 'raid')) {
    const who = event.user ?? 'Otro canal';
    lines.push(`${who} acaba de hacer una raid${event.viewers ? ` con ${event.viewers} espectadores` : ''}.`);
  }
  if (events.some((event) => event.type === 'start')) lines.push('El directo acaba de empezar.');
  return lines;
}

export type OutboxViewState = 'queued' | 'stalled' | 'sending' | 'unconfirmed' | 'sent' | 'failed';

/**
 * Estado de un mensaje del panel. «sent» solo si el bot lo confirmó; «stalled» si el bot
 * no lo ha recogido en SAY_STALLED_MS (¿está corriendo?); «unconfirmed» si lo recogió y
 * no dijo si lo publicó.
 */
export function outboxState(
  item: { status: 'pending' | 'claimed' | 'sent' | 'failed'; createdAt: string; claimedAt: string | null },
  nowMs: number
): OutboxViewState {
  if (item.status === 'sent' || item.status === 'failed') return item.status;
  if (item.status === 'claimed') {
    const claimed = item.claimedAt ? Date.parse(item.claimedAt) : NaN;
    return Number.isFinite(claimed) && nowMs - claimed > SAY_UNCONFIRMED_MS ? 'unconfirmed' : 'sending';
  }
  const created = Date.parse(item.createdAt);
  return Number.isFinite(created) && nowMs - created > SAY_STALLED_MS ? 'stalled' : 'queued';
}

interface ProactiveBase {
  /** Nombre visible de la IA (displayName.ts). */
  name: string;
  personality?: string;
  language?: 'es' | 'en' | 'pt';
  replyMax?: number;
  memories: LuxMemoryRow[];
}

/** Sistema común: nombre, personalidad, idioma, límite, emoción y recuerdos. */
function baseMessages(base: ProactiveBase, task: string[]): ChatMessage[] {
  const lines = [systemFor(base.name)];
  if (base.personality) lines.push(`Personalidad del personaje: ${base.personality}`);
  if (base.language) lines.push(`Responde siempre en ${LANGUAGE_NAMES[base.language]}.`);
  if (base.replyMax) lines.push(`No superes ${base.replyMax} caracteres.`);
  lines.push(...task);
  lines.push(EMOTION_INSTRUCTION);
  const messages: ChatMessage[] = [{ role: 'system', content: lines.join('\n') }];
  if (base.memories.length > 0) {
    const memoryLines = base.memories.map((memory) => `- (${memory.kind}${memory.subject ? `, ${memory.subject}` : ''}) ${memory.content}`);
    messages.push({ role: 'system', content: `Recuerdos del canal:\n${memoryLines.join('\n')}` });
  }
  return messages;
}

/** Comentario espontáneo sobre lo que se habló en el chat. */
export function buildSpontaneousMessages(turn: ProactiveBase & { lines: ChatLine[] }): ChatMessage[] {
  const messages = baseMessages(turn, [
    'Nadie te ha preguntado nada: comentas por tu cuenta lo que se ha hablado en el chat.',
    'Haz un comentario natural y corto sobre el tema, como una persona más del directo. No saludes, no te presentes y no digas «he leído el chat». No repitas frases del chat tal cual. Una sola idea.',
  ]);
  const chat = turn.lines.slice(-SPONTANEOUS_LINES_MAX).map((line) => `${line.viewer}: ${line.text}`);
  messages.push({ role: 'user', content: `Esto se ha dicho en el chat desde tu último comentario:\n${chat.join('\n')}` });
  return messages;
}

/** Saludo a uno o varios eventos seguidos. */
export function buildEventMessages(turn: ProactiveBase & { events: LuxEvent[] }): ChatMessage[] {
  const messages = baseMessages(turn, [
    'Acaba de pasar algo en el canal y lo saludas en el chat.',
    'Escribe un solo saludo corto, cálido y con tu personalidad que cubra todo lo que pasó (si fueron varios, agradécelos juntos). Menciona los nombres que te den, sin inventar nada más.',
  ]);
  messages.push({ role: 'user', content: describeEvents(turn.events).join('\n') });
  return messages;
}

/** El creador da una idea desde el panel y la IA la redacta para el chat. */
export function buildComposeMessages(turn: ProactiveBase & { idea: string }): ChatMessage[] {
  const messages = baseMessages(turn, [
    'El creador del canal te da una idea y tú la escribes en el chat con tus palabras y tu personalidad.',
    'Escribe un solo mensaje corto, sin comillas ni explicaciones. No inventes datos que no estén en la idea.',
  ]);
  messages.push({ role: 'user', content: `Idea del creador: ${turn.idea}` });
  return messages;
}
