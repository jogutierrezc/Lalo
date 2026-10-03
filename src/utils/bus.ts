/**
 * bus.ts
 *
 * Canal BroadcastChannel entre el panel, el control en vivo y el widget.
 * Solo comunica pestañas del MISMO navegador: el navegador de OBS es otro, y
 * allí el control llega por comandos de chat (ver parseControl en moderation.ts).
 */

import type { ControlAction } from './moderation';
import type { TTSSettings } from '../types/settings';
import type { AlertStyle } from './appearance';
import type { StreamAlertsSettings, AlertEventType, AlertSoundType, AlertAudioMode } from '../types/alerts';
import type { GoalsSettings } from '../types/goals';
import type { RouletteSettings, RouletteSegment } from '../types/roulette';
import type { PollSettings, PollOption } from '../types/polls';
import type { PollStartEvent } from './pollCommands';

export type { PollStartEvent };

export const BUS_NAME = 'lalo_tts_bus';

export interface LiveItem {
  id: string;
  user: string;
  username: string;
  text: string;
  trigger?: string;
  bits?: number;
  pending?: boolean; // espera aprobación manual
}

export interface LogItem extends LiveItem {
  at: number;
  status: 'read' | 'skipped' | 'rejected';
  reason?: string;
}

/** Contadores de la sesión del widget (se reinician al recargarlo). */
export interface SessionStats {
  read: number;
  skipped: number;
  rejected: number;
  paid: number; // leídos por puntos o bits
  byUser: Record<string, number>; // leídos por espectador
}

/** Estado que el widget publica para el control en vivo. */
export interface WidgetState {
  channel: string;
  connected: boolean;
  paused: boolean;
  approval: boolean;
  textOnly: boolean;
  timeouts: { user: string; until: number }[];
  stats: SessionStats;
  now: LiveItem | null;
  queue: LiveItem[];
  log: LogItem[];
  at: number;
}

export interface StreamAlertEvent {
  id: string;
  eventType: AlertEventType;
  user: string;
  detail?: string;
  text: string;
  style?: AlertStyle;
  accent?: string;
  soundType?: AlertSoundType;
  duration?: number;
  videoUrl?: string;
  blendMode?: 'transparent' | 'screen' | 'chroma-green';
  videoScale?: number;
  screenShake?: boolean;
  customAudioUrl?: string;
  customAudioVolume?: number;
  audioMode?: AlertAudioMode;
}

export interface RewardTriggerEvent {
  id: string;
  user: string;
  rewardName: string;
  noticeText: string;
  videoUrl?: string;
  blendMode?: 'transparent' | 'screen' | 'chroma-green';
  position?: 'center' | 'fullscreen' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  scale?: number;
  volume?: number;
  screenShake?: boolean;
  accentColor?: string;
  soundType?: AlertSoundType;
  customAudioUrl?: string;
  customAudioVolume?: number;
  duration?: number;
}

export interface GoalProgressEvent {
  goalId: string;
  title: string;
  current: number;
  target: number;
  unit: string;
  percent: number;
  completed: boolean;
  delta?: number;
  user?: string;
  milestone?: 25 | 50 | 75 | 100;
  announcement?: string;
}

export interface GoalCelebrationEvent {
  goalId: string;
  title: string;
  victoryVideoUrl?: string;
  victoryBlendMode?: 'transparent' | 'screen' | 'chroma-green';
  victoryCustomAudioUrl?: string;
  victoryCustomAudioVolume?: number;
  victorySoundType?: AlertSoundType;
  screenShake?: boolean;
  confetti?: boolean;
  duration?: number;
}

export interface RouletteSpinEvent {
  id: string;
  user?: string;
  winnerSegment: RouletteSegment;
  winnerIndex: number;
  totalActiveSegments: number;
  startRotation?: number;
  finalRotation: number;
  spinDurationSec: number;
  screenShake?: boolean;
  confetti?: boolean;
  victorySoundType?: AlertSoundType;
  victoryCustomAudioUrl?: string;
  victoryCustomAudioVolume?: number;
  showWinnerBanner?: boolean;
  winnerBannerDurationSec?: number;
  ttsAnnounceSpin?: boolean;
  ttsAnnounceWinner?: boolean;
}

export interface RouletteTtsCueEvent {
  text: string;
  emotion: string;
}

export interface PollBattleUpdateEvent {
  title: string;
  optionA: PollOption;
  optionB: PollOption;
  timeLeftSec: number;
  totalDurationSec: number;
  isActive: boolean;
  winner?: 'A' | 'B' | 'TIE' | null;
  leader?: 'A' | 'B' | 'TIE';
  lastVoteUser?: string;
  lastVoteOption?: 0 | 1;
}

export interface PollTtsCueEvent {
  text: string;
  emotion: string;
}

export type BusMessage =
  | { type: 'SETTINGS_UPDATE'; settings: TTSSettings }
  | { type: 'ALERT_SETTINGS_UPDATE'; settings: StreamAlertsSettings }
  | { type: 'ALERT_TRIGGER'; alert: StreamAlertEvent }
  | { type: 'REWARD_TRIGGER'; reward: RewardTriggerEvent }
  | { type: 'GOALS_SETTINGS_UPDATE'; settings: GoalsSettings }
  | { type: 'GOAL_UPDATE'; goal: GoalProgressEvent }
  | { type: 'GOAL_CELEBRATE'; celebration: GoalCelebrationEvent }
  | { type: 'ROULETTE_SETTINGS_UPDATE'; settings: RouletteSettings }
  | { type: 'ROULETTE_SPIN'; spin: RouletteSpinEvent }
  | { type: 'ROULETTE_TTS_CUE'; cue: RouletteTtsCueEvent }
  | { type: 'ROULETTE_CLEAR' }
  | { type: 'POLL_SETTINGS_UPDATE'; settings: PollSettings }
  | { type: 'POLL_STATE_UPDATE'; state: PollBattleUpdateEvent }
  | { type: 'POLL_TTS_CUE'; cue: PollTtsCueEvent }
  | { type: 'POLL_VOTE'; option: 0 | 1; user: string }
  | { type: 'POLL_START'; poll: PollStartEvent }
  | { type: 'POLL_STOP'; user?: string }
  | { type: 'POLL_CLEAR' }
  | { type: 'ENQUEUE'; text: string; user?: string }
  | { type: 'FORCE_RELOAD' }
  | { type: 'CONTROL'; action: ControlAction | 'remove'; id?: string; user?: string; minutes?: number; sender?: string; senderRole?: string }
  | { type: 'STATE_REQUEST' }
  | { type: 'STATE'; state: WidgetState };

export function postBus(message: BusMessage): void {
  try {
    const bus = new BroadcastChannel(BUS_NAME);
    bus.postMessage(message);
    bus.close();
  } catch {
    // Ignorar si no está soportado
  }
}

/** Escucha el canal. Devuelve la función para dejar de escuchar. */
export function listenBus(handler: (message: BusMessage) => void): () => void {
  try {
    const bus = new BroadcastChannel(BUS_NAME);
    bus.onmessage = (event) => {
      if (event.data && typeof event.data.type === 'string') handler(event.data as BusMessage);
    };
    return () => bus.close();
  } catch {
    return () => {};
  }
}
