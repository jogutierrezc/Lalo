/**
 * server/lux/channelEvents.ts
 *
 * Seguidores nuevos e inicio del directo, que llegan por EventSub (server/twitch/eventsub.ts)
 * y no por el chat. El webhook no tiene estado (en Vercel cada aviso puede caer en un proceso
 * distinto), así que la agrupación vive en la base de datos, en app_settings, como el
 * comentario espontáneo (lux_spontaneous:<perfil>):
 *
 *   lux_event_follow:<perfil>  grupo de seguidores que espera su saludo
 *   lux_event_start:<perfil>   último inicio de directo visto (pendiente o ya saludado)
 *   lux_event_last:<perfil>    hora del último saludo a eventos, para el mínimo entre saludos
 *
 * El aviso solo APUNTA aquí. El saludo lo genera handlers.ts cuando el grupo está listo: el
 * bot pregunta su cola cada pocos segundos (comando outbox) y ahí se vacía lo pendiente. Así
 * el webhook responde a Twitch al instante (tiene diez segundos) y la llamada a la IA no
 * corre dentro de él.
 *
 * Sin transacciones: dos avisos exactamente simultáneos pueden contar uno de menos en el grupo.
 * Es el coste de usar app_settings; el saludo sigue siendo uno.
 */

import type { LuxEvent } from './proactive.js';

/** Un grupo de seguidores se saluda cuando pasa este tiempo sin ninguno nuevo... */
export const FOLLOW_QUIET_MS = 15_000;
/** ...o, como tope, cuando pasa este tiempo desde el primero (una avalancha no retrasa el saludo sin fin). */
export const FOLLOW_MAX_MS = 45_000;
/** Nombres que se guardan del grupo; el resto solo se cuenta. */
export const FOLLOW_NAMES_MAX = 5;
/** Un aviso que nadie recogió (bot apagado) caduca: saludar a alguien de hace un rato suena raro. */
export const PENDING_TTL_MS = 10 * 60_000;
/** Un solo saludo de inicio por directo: aunque el stream caiga y vuelva, no se repite en este tiempo. */
export const START_WINDOW_MS = 2 * 3_600_000;

export const followKey = (profileId: string): string => `lux_event_follow:${profileId}`;
export const startKey = (profileId: string): string => `lux_event_start:${profileId}`;
export const lastKey = (profileId: string): string => `lux_event_last:${profileId}`;

export interface FollowGroup {
  /** Hora del primer seguidor del grupo y del último (ms). */
  first: number;
  last: number;
  count: number;
  names: string[];
}

export interface StartState {
  streamId: string;
  at: number;
  state: 'pending' | 'done';
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Lee un valor guardado sin fiarse de él. */
function parse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function parseFollowGroup(raw: string | null): FollowGroup | null {
  const value = parse(raw);
  if (!isObject(value) || !finite(value.first) || !finite(value.last) || !finite(value.count) || value.count < 1) return null;
  const names = Array.isArray(value.names) ? value.names.filter((name): name is string => typeof name === 'string').slice(0, FOLLOW_NAMES_MAX) : [];
  return { first: value.first, last: value.last, count: Math.min(Math.floor(value.count), 100_000), names };
}

export function parseStart(raw: string | null): StartState | null {
  const value = parse(raw);
  if (!isObject(value) || typeof value.streamId !== 'string' || !finite(value.at)) return null;
  return { streamId: value.streamId, at: value.at, state: value.state === 'done' ? 'done' : 'pending' };
}

/** Suma un seguidor al grupo. Un grupo abandonado hace mucho (bot apagado) se descarta y empieza otro. */
export function addFollow(group: FollowGroup | null, user: string, nowMs: number): FollowGroup {
  const alive = group !== null && nowMs - group.last <= PENDING_TTL_MS && nowMs >= group.first;
  if (!alive || group === null) return { first: nowMs, last: nowMs, count: 1, names: user ? [user] : [] };
  return {
    first: group.first,
    last: nowMs,
    count: group.count + 1,
    names: user && group.names.length < FOLLOW_NAMES_MAX ? [...group.names, user] : group.names,
  };
}

/** ¿Toca saludar al grupo? Cuando se calmó o cuando ya lleva demasiado abierto. */
export function followReady(group: FollowGroup, nowMs: number): boolean {
  return nowMs - group.last >= FOLLOW_QUIET_MS || nowMs - group.first >= FOLLOW_MAX_MS;
}

export function followExpired(group: FollowGroup, nowMs: number): boolean {
  return nowMs - group.last > PENDING_TTL_MS;
}

/**
 * Anota un inicio de directo. null si es repetido: el mismo directo, o cualquier otro dentro de
 * la ventana larga (una caída y reconexión). Si no, el estado nuevo, pendiente de saludo.
 */
export function acceptStart(previous: StartState | null, streamId: string, nowMs: number): StartState | null {
  if (previous && (previous.streamId === streamId || (nowMs >= previous.at && nowMs - previous.at < START_WINDOW_MS))) return null;
  return { streamId, at: nowMs, state: 'pending' };
}

/** Los eventos que Mi AI saludaría ahora, en la forma que entiende proactive.ts. */
export function pendingEvents(follow: FollowGroup | null, start: StartState | null): LuxEvent[] {
  const events: LuxEvent[] = [];
  if (follow) {
    // Los nombres guardados y, del resto, solo el número: describeEvents dice «y N más»
    for (let i = 0; i < Math.min(follow.count, 500); i += 1) {
      events.push({ type: 'follow', user: follow.names[i] ?? null, months: null, viewers: null, gift: false });
    }
  }
  if (start && start.state === 'pending') events.push({ type: 'start', user: null, months: null, viewers: null, gift: false });
  return events;
}
