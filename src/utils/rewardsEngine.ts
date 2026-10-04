/**
 * src/utils/rewardsEngine.ts
 *
 * Puerta de entrada única para disparar una recompensa en la capa de OBS desde
 * cualquier origen: el chat (bits y canjes con texto), un canal de eventos del
 * servidor (canjes sin texto, Power-ups) o una prueba.
 *
 * La capa «Recompensas» montada en el widget se registra aquí. `triggerReward`
 * pasa siempre por las mismas reglas: capa encendida, quién puede activarla,
 * espera de la recompensa, espera general, límite por espectador y cola.
 */

import type { CustomRewardItem, RewardsSettings } from '../types/rewards';
import type { UserRole } from './moderation';
import { matchBitsReward, matchPointsReward } from './rewardsLogic';

export type RewardSource = 'points' | 'bits' | 'powerup' | 'test';

export interface RewardTriggerInput {
  /** De dónde viene. `test` no aplica permisos, esperas ni límites. */
  source: RewardSource;
  /** Nombre visible de quien la activa. */
  user: string;
  /** Usuario en minúsculas, para el límite por espectador. Si falta, se usa `user`. */
  username?: string;
  /** Rol de quien la activa. Si no se conoce, se trata como espectador. */
  role?: UserRole;
  /** Cómo elegir la recompensa. Se mira en este orden: rewardId, twitchRewardId, bits. */
  rewardId?: string;
  /** Id de la recompensa de puntos en Twitch (el `reward.id` de EventSub o el `custom-reward-id` del chat). */
  twitchRewardId?: string;
  /** Bits del cheer o del Power-up: gana la recompensa más específica. */
  bits?: number;
  /** Texto que escribió el espectador, para la variable {message}. */
  text?: string;
  /** Texto de la etiqueta de la placa. Si falta, sale del origen. */
  label?: string;
}

export type RewardTriggerResult =
  | { ok: true; rewardId: string }
  | { ok: false; reason: 'no_layer' | 'disabled' | 'no_match' | 'not_allowed' | 'discarded'; rewardId?: string };

/** Recompensa de Lalo enlazada a una recompensa de puntos de Twitch, o null. */
export function findRewardByTwitchId(settings: Pick<RewardsSettings, 'rewards'>, twitchRewardId: string | null | undefined): CustomRewardItem | null {
  return matchPointsReward(settings.rewards, twitchRewardId);
}

/** Recompensa que le toca a un disparo, sin lanzarla. */
export function resolveReward(settings: Pick<RewardsSettings, 'rewards'>, input: Pick<RewardTriggerInput, 'rewardId' | 'twitchRewardId' | 'bits'>): CustomRewardItem | null {
  if (input.rewardId) return settings.rewards.find((reward) => reward.id === input.rewardId && reward.enabled) ?? null;
  if (input.twitchRewardId) return findRewardByTwitchId(settings, input.twitchRewardId);
  if (typeof input.bits === 'number') return matchBitsReward(settings.rewards, input.bits);
  return null;
}

/** Etiqueta de la placa según el origen. */
export function sourceLabel(input: Pick<RewardTriggerInput, 'source' | 'bits' | 'label'>): string {
  if (input.label) return input.label;
  const bits = input.bits;
  const amount = typeof bits === 'number' ? `${bits} ${bits === 1 ? 'bit' : 'bits'}` : '';
  if (input.source === 'bits') return amount ? `Cheer de ${amount}` : 'Cheer';
  if (input.source === 'powerup') return amount ? `Power-up de ${amount}` : 'Power-up';
  if (input.source === 'points') return 'Canje de puntos';
  return 'Prueba';
}

type Engine = (input: RewardTriggerInput) => RewardTriggerResult;
let active: Engine | null = null;

/** Lo llama la capa del widget al montarse. Devuelve la función para darse de baja. */
export function registerRewardsEngine(engine: Engine): () => void {
  active = engine;
  return () => {
    if (active === engine) active = null;
  };
}

/**
 * Dispara una recompensa en la capa de OBS de esta página. Devuelve por qué no
 * salió si se descarta; `no_layer` significa que esta fuente no muestra la capa.
 */
export function triggerReward(input: RewardTriggerInput): RewardTriggerResult {
  return active ? active(input) : { ok: false, reason: 'no_layer' };
}
