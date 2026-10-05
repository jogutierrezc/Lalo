/**
 * src/components/estudio/boxes/fase2Logic.ts
 *
 * Lo que las cajas de la fase 2 deciden sin tocar el DOM, para poder probarlo:
 * qué piezas de Ko-fi enseña cada caja, la alerta y las placas de muestra del
 * editor, qué hace la caja «Aviso de Power-up» con un evento de Twitch, cómo
 * entra en la caja «Recompensa» lo que llega por el bus y quién suena cuando
 * una escena tiene dos cajas del mismo tipo.
 */

import { decideKofi, parseStoredKofiEvent } from '../../../../server/integrations/kofiRules';
import { kofiRuleSet, type KofiSettings } from '../../../types/kofi';
import type { PowerupsSettings } from '../../../types/powerups';
import { normalizeReward } from '../../../types/rewards';
import type { RewardTestEvent, RewardTriggerEvent } from '../../../utils/bus';
import { kofiSamplePayload, type KofiSampleId } from '../../../utils/kofiSamples';
import { MAX_REWARD_SECONDS } from '../../../utils/rewardsLogic';
import { planActions, type PlannedAction, type TwitchEvent } from '../../../utils/twitchEvents';
import type { KofiAlertItem } from '../../integraciones/KofiAlerts';
import type { KofiParts } from '../../integraciones/KofiStage';
import type { PlateContent } from '../../recompensas/RewardPlate';
import type { RewardRequest } from '../../recompensas/RewardsLayer';

// ---------- Ko-fi ----------

export type KofiBoxType = 'kofi' | 'kofigoal' | 'kofirecent';

/** Cada caja de Ko-fi enseña una sola pieza. */
export const KOFI_BOX_PARTS: Record<KofiBoxType, KofiParts> = {
  kofi: { alerts: true, goal: false, recent: false },
  kofigoal: { alerts: false, goal: true, recent: false },
  kofirecent: { alerts: false, goal: false, recent: true },
};

/**
 * La alerta de muestra del editor: un aviso inventado, pasado por las reglas del
 * streamer (su plantilla, su umbral de donación grande) y sin tiempo que la retire.
 * Con `still` aparece ya colocada; sin él, repite su entrada (la prueba del editor).
 */
export function kofiSampleAlert(settings: KofiSettings, still: boolean, id: KofiSampleId = 'd25'): KofiAlertItem {
  const payload = kofiSamplePayload(id, settings.goal.currency);
  const event = parseStoredKofiEvent(payload, true);
  if (!event) throw new Error(`Aviso de ejemplo de Ko-fi no válido: ${id}`);
  const decision = decideKofi(event, kofiRuleSet(settings), settings.hold, false);
  return {
    kind: event.kind,
    big: decision.big,
    title: decision.title,
    amount: event.amount,
    currency: event.currency,
    tier: event.tier,
    message: decision.message,
    hold: Infinity,
    still,
  };
}

// ---------- Aviso de Power-up ----------

type Plate = Extract<PlannedAction, { do: 'plate' }>;
type Voice = Extract<PlannedAction, { do: 'voice' }>;

/**
 * Lo que la caja «Aviso de Power-up» hace con un evento de Twitch: los avisos en
 * pantalla y las frases para la voz. Las recompensas y las metas del mismo
 * evento no son suyas: las lanza TwitchEventLayer, que sigue montada en la fuente.
 */
export function powerupBoxActions(event: TwitchEvent, settings: PowerupsSettings): { plates: Plate[]; voices: Voice[] } {
  const actions = planActions(event, settings);
  return {
    plates: actions.filter((action): action is Plate => action.do === 'plate'),
    voices: actions.filter((action): action is Voice => action.do === 'voice'),
  };
}

/** El aviso de muestra del editor y de demo=1. */
export const POWERUP_SAMPLE = { tag: 'Power-up · 100 bits', text: 'pau_rl usó Emote gigante' } as const;

// ---------- Recompensa ----------

/** La placa de muestra del editor, con el estilo de partida del streamer. */
export const REWARD_SAMPLE: PlateContent = { tag: 'Cheer de 100 bits', name: 'Bocina', user: 'mar_ia', amount: '100', unit: 'bits' };
export const REWARD_SAMPLE_ACCENT = '#9146ff';

/** Una prueba del panel (REWARD_TEST): vaciar la caja, lanzar la recompensa del editor o nada. */
export function rewardTestAction(test: RewardTestEvent): { clear: true } | { request: RewardRequest } | null {
  if (test.clear) return { clear: true };
  if (!test.reward) return null;
  return {
    request: { reward: normalizeReward(test.reward), user: test.user, why: test.why, amount: test.amount, unit: test.unit },
  };
}

/**
 * El aviso antiguo (REWARD_TRIGGER) convertido en una recompensa de la caja: su
 * placa con el texto del aviso y su vídeo, ajustado a la caja aunque pidiera
 * pantalla completa. Va sin sonido porque el widget ya lo hace sonar una vez
 * para toda la fuente.
 */
export function legacyRewardRequest(event: RewardTriggerEvent): RewardRequest {
  const seconds = Math.min(MAX_REWARD_SECONDS, Math.max(1, event.duration || 6));
  return {
    reward: normalizeReward({
      id: event.id,
      name: event.rewardName,
      videoUrl: event.videoUrl,
      blendMode: event.blendMode,
      position: event.position,
      scale: event.scale,
      volume: event.volume,
      accentColor: event.accentColor,
      // Sin vídeo, el aviso es la recompensa
      showPlate: Boolean(event.noticeText) || !event.videoUrl,
      showNoticeText: false,
      duration: seconds,
      screenShake: event.screenShake === true,
      soundType: 'none',
    }),
    user: event.noticeText || `Canjeado por ${event.user}`,
    why: 'Recompensa',
    amount: '1',
    unit: 'canje',
    silent: true,
    holdSeconds: seconds,
  };
}

// ---------- Dos cajas del mismo tipo en una escena ----------

/**
 * Turno entre las cajas de un mismo tipo. Todas pintan, pero lo que no debe
 * ocurrir dos veces en la misma fuente (el sonido, la voz, lanzar una
 * recompensa) lo hace solo la primera que se montó. Si esa se quita, pasa a la
 * siguiente.
 */
export function createTurn<T = true>() {
  const members: { id: string; value: T }[] = [];
  return {
    /** Entra en el turno. Devuelve la función para salir. */
    join(id: string, value: T): () => void {
      const at = members.findIndex((member) => member.id === id);
      if (at === -1) members.push({ id, value });
      else members[at] = { id, value };
      return () => {
        const index = members.findIndex((member) => member.id === id && member.value === value);
        if (index !== -1) members.splice(index, 1);
      };
    },
    leads: (id: string): boolean => members[0]?.id === id,
    /** Lo que aportó la caja que lleva el turno, o undefined si no hay ninguna. */
    lead: (): T | undefined => members[0]?.value,
    size: (): number => members.length,
  };
}
