/**
 * src/utils/rewardsLogic.ts
 *
 * Reglas de las recompensas, sin DOM ni reloj propio para poder probarlas:
 * qué recompensa responde a un cheer o a un canje, quién puede activarla, las
 * esperas, el límite por espectador, la cola y cuánto se queda la placa.
 */

import type { AlertSoundType } from '../types/alerts';
import type { CustomRewardItem, RewardAudience, RewardsSettings } from '../types/rewards';
import type { ChatTags, UserRole } from './moderation';

export const ANON_CHEERER = 'ananonymouscheerer';
export const ANON_NAME = 'Anónimo';
/** Tope de cualquier recompensa en pantalla, el mismo de los sonidos de la suite. */
export const MAX_REWARD_SECONDS = 30;

/** Duración de los sonidos de serie (ver alertsAudio.ts). */
export const SYNTH_SECONDS: Record<AlertSoundType, number> = {
  'synth-bell': 1.4,
  'retro-fanfare': 0.6,
  'arcade-chime': 0.6,
  'soft-pop': 0.25,
  none: 0,
};

// ---------- Bits: gana la más específica ----------

type BitsRule = Pick<CustomRewardItem, 'trigger' | 'enabled' | 'bitsMode' | 'bitsMin' | 'bitsMax'>;

/** ¿Responde esta recompensa a un cheer de `bits`? Los bits son siempre enteros, desde 1. */
export function bitsHit(reward: BitsRule, bits: number): boolean {
  if (reward.trigger !== 'bits' || !reward.enabled) return false;
  if (!Number.isInteger(bits) || bits < 1 || reward.bitsMin < 1) return false;
  if (reward.bitsMode === 'exact') return bits === reward.bitsMin;
  return bits >= reward.bitsMin && (reward.bitsMax === null || bits <= reward.bitsMax);
}

/** Anchura del rango: 0 para una cantidad exacta, infinito sin tope. */
export function bitsSpan(reward: BitsRule): number {
  if (reward.bitsMode === 'exact') return 0;
  return reward.bitsMax === null ? Number.POSITIVE_INFINITY : Math.max(0, reward.bitsMax - reward.bitsMin);
}

/** Todas las que coinciden, de la más específica a la menos: exacta, rango más estrecho, mínimo más alto. */
export function bitsCandidates<T extends BitsRule>(rewards: readonly T[], bits: number): T[] {
  return rewards
    .map((reward, index) => ({ reward, index }))
    .filter((entry) => bitsHit(entry.reward, bits))
    .sort((a, b) => {
      const sa = bitsSpan(a.reward);
      const sb = bitsSpan(b.reward);
      if (sa !== sb) return sa < sb ? -1 : 1;
      return b.reward.bitsMin - a.reward.bitsMin || a.index - b.index;
    })
    .map((entry) => entry.reward);
}

export function matchBitsReward<T extends BitsRule>(rewards: readonly T[], bits: number): T | null {
  return bitsCandidates(rewards, bits)[0] ?? null;
}

/** Recompensa de puntos enlazada a ese id de Twitch (el que llega por el chat cuando el canje pide texto). */
export function matchPointsReward<T extends Pick<CustomRewardItem, 'trigger' | 'enabled' | 'twitchRewardId'>>(
  rewards: readonly T[],
  rewardId: string | null | undefined
): T | null {
  const id = (rewardId || '').trim().toLowerCase();
  if (!id) return null;
  return rewards.find((reward) => reward.enabled && reward.trigger === 'points' && reward.twitchRewardId === id) ?? null;
}

/** Cómo se lee el disparador de una recompensa en la lista. */
export function triggerLabel(reward: Pick<CustomRewardItem, 'trigger' | 'cost' | 'bitsMode' | 'bitsMin' | 'bitsMax'>): string {
  if (reward.trigger === 'points') return `${reward.cost.toLocaleString('es')} puntos`;
  const unit = (n: number) => (n === 1 ? 'bit' : 'bits');
  if (reward.bitsMode === 'exact') return `${reward.bitsMin} ${unit(reward.bitsMin)} ${reward.bitsMin === 1 ? 'exacto' : 'exactos'}`;
  if (reward.bitsMax === null) return `${reward.bitsMin} ${unit(reward.bitsMin)} o más`;
  return `${reward.bitsMin} a ${reward.bitsMax} bits`;
}

/** Un mínimo así de bajo se puede usar para llenar el directo de sonidos por muy poco dinero. */
export const LOW_BITS = 10;
export const isLowBits = (reward: Pick<CustomRewardItem, 'trigger' | 'bitsMin'>): boolean =>
  reward.trigger === 'bits' && reward.bitsMin < LOW_BITS;

// ---------- Lo que llega por el chat ----------

export type ChatTrigger =
  | { kind: 'bits'; bits: number; username: string; user: string }
  | { kind: 'points'; rewardId: string; username: string; user: string };

type TriggerTags = ChatTags & { 'display-name'?: string };

/** Lee de las etiquetas de un mensaje si es un cheer o un canje con texto. Un cheer anónimo sale como «Anónimo». */
export function readChatTrigger(tags: TriggerTags): ChatTrigger | null {
  const username = (tags.username || '').toLowerCase();
  const anonymous = username === ANON_CHEERER;
  const user = anonymous ? ANON_NAME : tags['display-name'] || tags.username || 'Espectador';
  const bits = Number(tags.bits);
  if (Number.isInteger(bits) && bits >= 1) return { kind: 'bits', bits, username: username || ANON_CHEERER, user };
  const rewardId = tags['custom-reward-id'];
  if (typeof rewardId === 'string' && rewardId.trim()) {
    return { kind: 'points', rewardId: rewardId.trim().toLowerCase(), username, user };
  }
  return null;
}

// ---------- Quién puede activarla ----------

const RANK: Record<UserRole, number> = { viewer: 0, sub: 1, vip: 2, mod: 3, broadcaster: 4 };
const NEEDS: Record<RewardAudience, number> = { all: 0, sub: 1, vip: 2 };

export function canActivate(audience: RewardAudience, role: UserRole): boolean {
  return RANK[role] >= NEEDS[audience];
}

export const AUDIENCE_TEXT: Record<RewardAudience, string> = {
  all: 'todos',
  sub: 'suscriptores, VIP y moderadores',
  vip: 'VIP y moderadores',
};

// ---------- Esperas y límite por espectador ----------

export interface GateState {
  /** Último uso aceptado de cada recompensa (ms). */
  byReward: Record<string, number>;
  /** Último uso aceptado de cualquiera (ms). */
  lastAny: number | null;
  /** Usos aceptados de cada espectador en el último minuto (ms). */
  byViewer: Record<string, number[]>;
}

export const emptyGate = (): GateState => ({ byReward: {}, lastAny: null, byViewer: {} });

export type GateVerdict = { ok: true } | { ok: false; reason: 'cooldown' | 'global' | 'viewer'; waitSeconds: number; message: string };

const VIEWER_WINDOW_MS = 60000;
const left = (last: number | null | undefined, now: number, seconds: number): number =>
  last === null || last === undefined || seconds <= 0 ? 0 : Math.max(0, Math.ceil((last + seconds * 1000 - now) / 1000));

type GateRules = Pick<RewardsSettings, 'globalCooldownSeconds' | 'perViewerPerMinute'>;
type GateReward = Pick<CustomRewardItem, 'id' | 'name' | 'cooldownSeconds'>;

/** ¿Se acepta este uso? No cambia el estado: un uso descartado no alarga ninguna espera. */
export function checkGate(state: GateState, reward: GateReward, rules: GateRules, username: string, now: number): GateVerdict {
  const own = left(state.byReward[reward.id], now, reward.cooldownSeconds);
  if (own > 0) {
    return { ok: false, reason: 'cooldown', waitSeconds: own, message: `«${reward.name}» está en espera (${own} s): este uso se descarta.` };
  }
  const any = left(state.lastAny, now, rules.globalCooldownSeconds);
  if (any > 0) {
    return { ok: false, reason: 'global', waitSeconds: any, message: `Espera general entre recompensas (${any} s): «${reward.name}» se descarta.` };
  }
  if (rules.perViewerPerMinute > 0 && username) {
    const recent = (state.byViewer[username] || []).filter((at) => now - at < VIEWER_WINDOW_MS);
    if (recent.length >= rules.perViewerPerMinute) {
      const wait = Math.max(1, Math.ceil((recent[0] + VIEWER_WINDOW_MS - now) / 1000));
      return {
        ok: false,
        reason: 'viewer',
        waitSeconds: wait,
        message: `${username} ya usó ${rules.perViewerPerMinute} recompensas en un minuto: «${reward.name}» se descarta.`,
      };
    }
  }
  return { ok: true };
}

/** Anota un uso aceptado. Devuelve un estado nuevo y olvida lo que ya caducó. */
export function commitGate(state: GateState, reward: GateReward, username: string, now: number): GateState {
  const byViewer: Record<string, number[]> = {};
  Object.entries(state.byViewer).forEach(([user, times]) => {
    const recent = times.filter((at) => now - at < VIEWER_WINDOW_MS);
    if (recent.length) byViewer[user] = recent;
  });
  if (username) byViewer[username] = [...(byViewer[username] || []), now];
  return { byReward: { ...state.byReward, [reward.id]: now }, lastAny: now, byViewer };
}

// ---------- Cola o solape ----------

type QueueRules = Pick<RewardsSettings, 'queueMode' | 'overlapLimit' | 'queueMax'>;

/** Cuántas pueden estar en pantalla a la vez. */
export function activeLimit(rules: Pick<RewardsSettings, 'queueMode' | 'overlapLimit'>): number {
  return rules.queueMode === 'queue' ? 1 : Math.max(2, rules.overlapLimit);
}

/** Cuántas de la cola pueden empezar ahora. */
export function startable(waiting: number, active: number, rules: Pick<RewardsSettings, 'queueMode' | 'overlapLimit'>): number {
  return Math.max(0, Math.min(waiting, activeLimit(rules) - active));
}

/**
 * ¿Entra una recompensa nueva? Si hay hueco en pantalla empieza ya; si no,
 * espera turno mientras la cola no esté llena. Con la cola llena se descarta.
 */
export function admit(waiting: number, active: number, rules: QueueRules): 'start' | 'wait' | 'full' {
  if (waiting === 0 && active < activeLimit(rules)) return 'start';
  return waiting < rules.queueMax ? 'wait' : 'full';
}

// ---------- Cuánto se queda ----------

export interface StayInput {
  /** Duración del sonido en segundos (0 si no hay o no se conoce). */
  clipSeconds: number;
  /** Duración del vídeo en pantalla (0 si no hay vídeo). */
  videoSeconds: number;
  hasPlate: boolean;
  minPlateSeconds: number;
}

/**
 * Segundos en pantalla: lo que dure el sonido o el vídeo, con el mínimo de la
 * placa aunque el clip dure menos de un segundo, y nunca más de 30 s.
 */
export function staySeconds(input: StayInput): number {
  const clean = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  const base = Math.max(clean(input.clipSeconds), clean(input.videoSeconds), input.hasPlate ? clean(input.minPlateSeconds) : 0);
  return Math.min(MAX_REWARD_SECONDS, base);
}
