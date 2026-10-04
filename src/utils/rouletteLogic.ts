/**
 * src/utils/rouletteLogic.ts
 *
 * Reglas de la ruleta, sin DOM ni reloj propio para poder probarlas:
 *
 * - El nombre que se escribe tras el comando para abrirla o cerrarla.
 * - Si la ruleta está abierta, contando el panel y el chat.
 * - Qué canje o qué cheer la hace girar, quién puede y cada cuánto. Las reglas
 *   de bits, permisos y esperas son las de las recompensas (rewardsLogic.ts).
 * - Que un mismo canje no gire dos veces si llega por el chat y por el canal
 *   de eventos.
 * - La cola: un giro cada vez, con un tope de espera.
 * - Qué dice la voz, y que lo diga una sola vez por giro.
 */

import type { RouletteSegment, RouletteSettings } from '../types/roulette';
import { calculateTargetRotation } from '../types/roulette';
import type { RouletteSpinEvent } from './bus';
import type { ChatTags, UserRole } from './moderation';
import {
  AUDIENCE_TEXT,
  GateState,
  bitsHit,
  canActivate,
  checkGate,
  commitGate,
  readChatTrigger,
} from './rewardsLogic';
import type { TwitchEvent } from './twitchEvents';

/** Giros que pueden esperar turno. El que llega con la cola llena se descarta. */
export const ROULETTE_QUEUE_MAX = 5;
/** Nombre del candado que reparte el mando entre las fuentes abiertas en un mismo navegador. */
export const ROULETTE_LOCK = 'lalo-roulette-engine';

// ---------- Nombre de la ruleta ----------

/** Minúsculas, sin acentos y sin signos: «Castigós!» y «castigos» son lo mismo. */
export function foldName(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export type NameMatch<T> = { kind: 'one'; item: T } | { kind: 'none' } | { kind: 'ambiguous'; items: T[] };

/**
 * Busca una ruleta por el nombre escrito en el chat. Vale el nombre entero o un
 * comienzo que solo encaje con una. Sin nombre, solo acierta si hay una única
 * ruleta: no hay otra a la que pueda referirse.
 */
export function matchRouletteName<T extends { name: string }>(list: readonly T[], query: string): NameMatch<T> {
  const wanted = foldName(query);
  if (!wanted) {
    if (list.length === 1) return { kind: 'one', item: list[0] };
    return list.length === 0 ? { kind: 'none' } : { kind: 'ambiguous', items: [...list] };
  }
  const exact = list.filter((item) => foldName(item.name) === wanted);
  if (exact.length === 1) return { kind: 'one', item: exact[0] };
  if (exact.length > 1) return { kind: 'ambiguous', items: exact };
  const starts = list.filter((item) => foldName(item.name).startsWith(wanted));
  if (starts.length === 1) return { kind: 'one', item: starts[0] };
  return starts.length === 0 ? { kind: 'none' } : { kind: 'ambiguous', items: starts };
}

// ---------- Comandos de la actividad ----------

export interface ActivityCommand {
  action: 'open' | 'close';
  /** Lo escrito tras el comando: el nombre de la ruleta. */
  query: string;
}

/** Lee «!ruleta castigos» o «!cerrarruleta». null si el mensaje no es ninguno de los dos comandos. */
export function parseActivityCommand(
  message: string,
  commands: Pick<RouletteSettings, 'openCommand' | 'closeCommand'>
): ActivityCommand | null {
  const words = message.trim().split(/\s+/);
  const first = (words[0] || '').toLowerCase();
  if (!first.startsWith('!')) return null;
  const query = words.slice(1).join(' ');
  if (first === commands.closeCommand) return { action: 'close', query };
  if (first === commands.openCommand) return { action: 'open', query };
  return null;
}

/** Solo el streamer y los moderadores abren y cierran la ruleta, como el resto de comandos de moderación. */
export function canUseRouletteCommands(role: UserRole): boolean {
  return role === 'broadcaster' || role === 'mod';
}

// ---------- Abierta o cerrada ----------

/** Lo último que se mandó desde el chat en esta fuente. */
export interface ActivityOverride {
  active: boolean;
  at: number;
}

/** Manda el cambio más reciente: el del panel (viaja con los ajustes) o el del chat. */
export function resolveActive(settings: Pick<RouletteSettings, 'active' | 'activeAt'>, override: ActivityOverride | null): boolean {
  return override && override.at > settings.activeAt ? override.active : settings.active;
}

// ---------- Qué la hace girar ----------

export type TriggerRule = Pick<
  RouletteSettings,
  'triggerKind' | 'twitchRewardId' | 'bitsMode' | 'bitsMin' | 'bitsMax' | 'audience' | 'cooldownSeconds' | 'name'
>;

/** Por dónde llegó: el chat, el canal de eventos de Twitch o una prueba del panel. */
export type TriggerVia = 'chat' | 'events' | 'test';

export interface IncomingTrigger {
  kind: 'points' | 'bits';
  /** Id de la recompensa de Twitch, en minúsculas (solo en canjes). */
  rewardId?: string;
  bits?: number;
  /** Nombre visible de quien gira. */
  user: string;
  /** Usuario en minúsculas. */
  username: string;
  role: UserRole;
  via: TriggerVia;
}

/** Cheer o canje con texto que llega por el chat. */
export function triggerFromChat(tags: ChatTags & { 'display-name'?: string }, role: UserRole): IncomingTrigger | null {
  const read = readChatTrigger(tags);
  if (!read) return null;
  return read.kind === 'bits'
    ? { kind: 'bits', bits: read.bits, user: read.user, username: read.username, role, via: 'chat' }
    : { kind: 'points', rewardId: read.rewardId, user: read.user, username: read.username, role, via: 'chat' };
}

/**
 * Lo que aporta el canal de eventos. Solo los canjes de puntos SIN texto: los
 * que piden texto y los cheers ya llegan por el chat, y atenderlos aquí otra vez
 * haría girar la rueda dos veces. Las pruebas del panel entran siempre.
 * El canal de eventos no dice el rol de quien canjea: cuenta como espectador.
 */
export function triggerFromEvent(event: TwitchEvent, options: { pointsViaChannel: boolean }): IncomingTrigger | null {
  const who = { user: event.user, username: event.login || event.user.toLowerCase(), role: 'viewer' as UserRole };
  if (event.test) {
    if (event.kind === 'points') return { kind: 'points', rewardId: event.rewardId, ...who, via: 'test' };
    if (event.kind === 'bits' && event.use === 'cheer') return { kind: 'bits', bits: event.bits, ...who, via: 'test' };
    return null;
  }
  if (event.kind !== 'points' || !options.pointsViaChannel || event.text !== '') return null;
  return { kind: 'points', rewardId: event.rewardId, ...who, via: 'events' };
}

/** ¿Es este canje o este cheer el que gira la ruleta? */
export function matchesTrigger(rule: TriggerRule, incoming: IncomingTrigger): boolean {
  if (incoming.kind !== rule.triggerKind) return false;
  if (incoming.kind === 'points') {
    return rule.twitchRewardId !== '' && (incoming.rewardId || '').trim().toLowerCase() === rule.twitchRewardId;
  }
  return bitsHit(
    { trigger: 'bits', enabled: true, bitsMode: rule.bitsMode, bitsMin: rule.bitsMin, bitsMax: rule.bitsMax },
    incoming.bits ?? 0
  );
}

/** Cómo se cuenta en pantalla y en el registro lo que la hizo girar. */
export function triggerWhy(incoming: Pick<IncomingTrigger, 'kind' | 'bits'>): string {
  if (incoming.kind === 'points') return 'Canje de puntos';
  const bits = incoming.bits ?? 0;
  return `Cheer de ${bits} ${bits === 1 ? 'bit' : 'bits'}`;
}

/** Cómo se lee el disparador en el estudio. */
export function triggerRuleText(rule: Pick<TriggerRule, 'triggerKind' | 'twitchRewardId' | 'bitsMode' | 'bitsMin' | 'bitsMax'>): string {
  if (rule.triggerKind === 'points') return rule.twitchRewardId ? 'un canje de puntos del canal' : 'un canje de puntos (aún sin enlazar)';
  const unit = (n: number) => (n === 1 ? 'bit' : 'bits');
  if (rule.bitsMode === 'exact') return `un cheer de ${rule.bitsMin} ${unit(rule.bitsMin)} exactos`;
  if (rule.bitsMax === null) return `un cheer de ${rule.bitsMin} ${unit(rule.bitsMin)} o más`;
  return `un cheer de ${rule.bitsMin} a ${rule.bitsMax} bits`;
}

const GATE_ID = 'ruleta';
const NO_SHARED_LIMITS = { globalCooldownSeconds: 0, perViewerPerMinute: 0 };

export type TriggerVerdict =
  | { ok: true; why: string }
  | { ok: false; reason: 'no_match' | 'closed' | 'not_allowed' | 'cooldown' | 'no_segments'; message: string };

export interface TriggerContext {
  /** ¿Está abierta la ruleta? */
  active: boolean;
  /** Segmentos encendidos. */
  activeSegments: number;
  gate: GateState;
  now: number;
}

/**
 * ¿Gira la ruleta con esto? No cambia nada: quien llama anota el giro con
 * `commitSpinGate` solo si de verdad entra en la cola. Una prueba del panel no
 * mira el permiso ni la espera, pero sí que la ruleta esté abierta.
 */
export function judgeTrigger(rule: TriggerRule, incoming: IncomingTrigger, ctx: TriggerContext): TriggerVerdict {
  if (!matchesTrigger(rule, incoming)) return { ok: false, reason: 'no_match', message: '' };
  const why = triggerWhy(incoming);
  const who = `${incoming.user} (${why.toLowerCase()})`;
  if (!ctx.active) {
    return { ok: false, reason: 'closed', message: `${who}: la ruleta «${rule.name}» está cerrada y no gira. Twitch no devuelve los puntos ni los bits.` };
  }
  if (ctx.activeSegments < 1) {
    return { ok: false, reason: 'no_segments', message: `${who}: la ruleta no tiene segmentos activos y no gira.` };
  }
  if (incoming.via !== 'test') {
    if (!canActivate(rule.audience, incoming.role)) {
      return { ok: false, reason: 'not_allowed', message: `${who}: solo pueden girarla ${AUDIENCE_TEXT[rule.audience]}. Se descarta.` };
    }
    const gate = checkGate(ctx.gate, { id: GATE_ID, name: rule.name, cooldownSeconds: rule.cooldownSeconds }, NO_SHARED_LIMITS, incoming.username, ctx.now);
    if (!gate.ok) {
      return { ok: false, reason: 'cooldown', message: `${who}: la ruleta está en espera (${gate.waitSeconds} s). Este giro se descarta.` };
    }
  }
  return { ok: true, why };
}

/** Anota un giro aceptado, para la espera entre giros. */
export function commitSpinGate(gate: GateState, rule: Pick<TriggerRule, 'name' | 'cooldownSeconds'>, username: string, now: number): GateState {
  return commitGate(gate, { id: GATE_ID, name: rule.name, cooldownSeconds: rule.cooldownSeconds }, username, now);
}

// ---------- El mismo canje por dos caminos ----------

export interface SeenTrigger {
  key: string;
  via: TriggerVia;
  at: number;
}

/** El canal de eventos se consulta cada pocos segundos: el mismo canje puede llegar por él con ese retraso. */
export const DUPLICATE_WINDOW_MS = 15000;

/** Identifica un canje o un cheer: quién, qué recompensa o cuántos bits. */
export function triggerKey(incoming: Pick<IncomingTrigger, 'kind' | 'rewardId' | 'bits' | 'username'>): string {
  return `${incoming.kind}:${incoming.kind === 'points' ? incoming.rewardId || '' : incoming.bits ?? 0}:${incoming.username}`;
}

/**
 * ¿Ya entró este mismo canje por el OTRO camino hace un momento? Dos canjes
 * seguidos por el mismo camino son dos canjes de verdad y no se descartan.
 */
export function isDuplicateTrigger(seen: readonly SeenTrigger[], incoming: IncomingTrigger, now: number, windowMs = DUPLICATE_WINDOW_MS): boolean {
  if (incoming.via === 'test') return false;
  const key = triggerKey(incoming);
  return seen.some((entry) => entry.key === key && entry.via !== incoming.via && entry.via !== 'test' && now - entry.at < windowMs);
}

/** Anota un canje aceptado y olvida los que ya caducaron. */
export function rememberTrigger(seen: readonly SeenTrigger[], incoming: IncomingTrigger, now: number, windowMs = DUPLICATE_WINDOW_MS): SeenTrigger[] {
  return [...seen.filter((entry) => now - entry.at < windowMs), { key: triggerKey(incoming), via: incoming.via, at: now }];
}

// ---------- Cola: un giro cada vez ----------

/**
 * ¿Qué pasa con un giro nuevo? Con la rueda libre y nadie esperando, gira ya.
 * Si no, espera turno mientras quepa. Con la cola llena se descarta.
 */
export function admitSpin(waiting: number, busy: boolean, max = ROULETTE_QUEUE_MAX): 'start' | 'wait' | 'full' {
  if (!busy && waiting === 0) return 'start';
  return waiting < max ? 'wait' : 'full';
}

/** Saca el siguiente de la cola, por orden de llegada. */
export function takeNextSpin<T>(queue: readonly T[]): { next: T | null; rest: T[] } {
  return queue.length === 0 ? { next: null, rest: [] } : { next: queue[0], rest: queue.slice(1) };
}

// ---------- El giro ----------

export interface BuildSpinInput {
  id: string;
  user: string;
  why?: string;
  /** Ángulo en el que quedó la rueda tras el giro anterior. */
  baseRotation: number;
  /** Segmento forzado (pruebas). Si no existe o está apagado, se elige al azar. */
  targetSegmentId?: string;
  /** Número en [0, 1). Por defecto, Math.random. */
  random?: () => number;
}

/** Elige el segmento y calcula el giro. null si no hay segmentos encendidos. */
export function buildSpin(settings: RouletteSettings, input: BuildSpinInput): RouletteSpinEvent | null {
  const active = settings.segments.filter((segment) => segment.enabled);
  if (active.length === 0) return null;
  const forced = input.targetSegmentId ? active.findIndex((segment) => segment.id === input.targetSegmentId) : -1;
  const random = input.random ?? Math.random;
  const winnerIndex = forced !== -1 ? forced : Math.min(active.length - 1, Math.floor(random() * active.length));
  const startRotation = ((input.baseRotation % 360) + 360) % 360;
  return {
    id: input.id,
    user: input.user,
    why: input.why,
    winnerSegment: active[winnerIndex],
    winnerIndex,
    totalActiveSegments: active.length,
    startRotation,
    // 5 vueltas completas de inercia antes de caer en el segmento
    finalRotation: calculateTargetRotation(winnerIndex, active.length, startRotation, 5),
    spinDurationSec: settings.spinDurationSec || 6.0,
    screenShake: settings.screenShake,
    confetti: settings.confetti,
    victorySoundType: settings.victorySoundType,
    victoryCustomAudioUrl: settings.victoryCustomAudioUrl,
    victoryCustomAudioVolume: settings.victoryCustomAudioVolume ?? 0.85,
    showWinnerBanner: settings.showWinnerBanner,
    winnerBannerDurationSec: settings.winnerBannerDurationSec || 8,
    ttsAnnounceSpin: settings.ttsAnnounceSpin !== false,
    ttsAnnounceWinner: settings.ttsAnnounceWinner !== false,
  };
}

// ---------- Lo que dice la voz ----------

const named = (user?: string): string | null => (user && user !== 'Streamer' && user !== 'Admin' ? user : null);

/** Frase que anuncia que la rueda empieza a girar. Corta, para que acabe antes de que la rueda se detenga. */
export function spinAnnouncement(user: string | undefined, title: string | undefined): string {
  const who = named(user);
  if (who) return `[emocionado] ¡Atención! ¡${who} ha puesto a girar la ruleta!`;
  return title ? `[emocionado] ¡Atención! ¡Gira la ${title}!` : '[emocionado] ¡Atención! ¡La ruleta está girando!';
}

/** Frase que anuncia el resultado. */
export function winnerAnnouncement(winner: RouletteSegment, user?: string): string {
  const who = named(user);
  const target = who ? `@${who}` : null;
  if (winner.category === 'safe') {
    return target
      ? `[alegria] ¡Golpe de suerte para ${target}! Ha salido: ${winner.text}. ¡Te salvaste del castigo!`
      : `[alegria] ¡Golpe de suerte! Ha salido: ${winner.text}. ¡Te salvaste por esta ronda!`;
  }
  if (winner.durationSec && winner.durationSec > 0) {
    return target
      ? `[triunfal] ¡La ruleta se ha detenido para ${target}! El reto es: ${winner.text}. Tienes ${winner.durationSec} segundos para cumplirlo.`
      : `[triunfal] ¡La ruleta se ha detenido! El reto es: ${winner.text}. Tienes ${winner.durationSec} segundos para cumplirlo.`;
  }
  if (winner.intensity === 'extreme') {
    return target
      ? `[sorprendido] ¡Castigo extremo para ${target}! El destino ha dictado: ${winner.text}. ¡A cumplirlo sin excusas!`
      : `[sorprendido] ¡Castigo extremo! El destino ha dictado: ${winner.text}. ¡A cumplirlo sin excusas!`;
  }
  return target
    ? `[emocionado] ¡La ruleta ha hablado para ${target}! El reto es: ${winner.text}. ¡A cumplir ante el chat!`
    : `[emocionado] ¡La ruleta ha hablado! El reto es: ${winner.text}. ¡A cumplirlo ante el chat!`;
}

export type AnnouncePhase = 'spin' | 'winner';

/**
 * Único camino por el que la ruleta pide voz. Recibe la función que pone una
 * frase en la cola de voz del sistema y garantiza una sola petición por giro y
 * por momento (arranque y resultado), aunque el aviso de fin de giro llegue
 * repetido. Con `mayISpeak` en false (otra fuente abierta lleva el mando) calla.
 */
export function createAnnouncer(speak: (text: string) => unknown, mayISpeak: () => boolean = () => true) {
  const said: string[] = [];
  return {
    say(spinId: string, phase: AnnouncePhase, text: string): boolean {
      const key = `${spinId}:${phase}`;
      if (!text.trim() || said.includes(key) || !mayISpeak()) return false;
      said.push(key);
      if (said.length > 40) said.splice(0, said.length - 40);
      speak(text);
      return true;
    },
  };
}
