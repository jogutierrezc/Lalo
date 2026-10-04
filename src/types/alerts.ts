/**
 * src/types/alerts.ts
 *
 * Definición de tipos y almacenamiento para el módulo de Alertas de Stream.
 * Coherente con los estilos visuales de Cabina (Cabina, Bocadillo, Subtítulo, Sticker).
 */

import { queueCloudPush } from '../lib/cloudConfig';
import { AlertEnergy, AlertPosition, AlertStyle, DEFAULT_APPEARANCE } from '../utils/appearance';

export type AlertEventType = 'follow' | 'sub' | 'bits' | 'raid';

export type AlertSoundType = 'synth-bell' | 'retro-fanfare' | 'arcade-chime' | 'soft-pop' | 'none';

export type AlertBlendMode = 'transparent' | 'screen' | 'chroma-green';

export type AlertAudioMode = 'synth' | 'custom_audio' | 'tts' | 'both';

export interface CustomAlertRule {
  id: string;
  name: string;
  triggerKeyword: string;
  enabled: boolean;
  template: string;
  audioMode: AlertAudioMode;
  soundType: AlertSoundType;
  customAudioUrl?: string;
  customAudioName?: string;
  customAudioVolume?: number;
  customAudioDuration?: number; // Máximo 30 segundos
  videoUrl?: string;
  videoName?: string;
  blendMode?: AlertBlendMode;
  videoScale?: number;
  screenShake?: boolean;
  accentColor?: string;
}

export interface BitTierConfig {
  id: string;
  name: string;
  minBits: number;
  template: string;
  accent: string;
  soundType: AlertSoundType;
  customAudioUrl?: string;
  customAudioName?: string;
  customAudioVolume?: number;
  videoUrl?: string;
  videoName?: string;
  blendMode?: AlertBlendMode;
  screenShake?: boolean;
}

export interface SubTierConfig {
  id: string;
  tier: 'tier1' | 'tier2' | 'tier3' | 'gift';
  name: string;
  template: string;
  accent: string;
  soundType: AlertSoundType;
  customAudioUrl?: string;
  customAudioName?: string;
  customAudioVolume?: number;
  videoUrl?: string;
  videoName?: string;
  blendMode?: AlertBlendMode;
  screenShake?: boolean;
}

export interface EventRuleConfig {
  enabled: boolean;
  template: string;
  audioMode?: AlertAudioMode; // 'synth' | 'custom_audio' | 'tts' | 'both'
  soundType: AlertSoundType;
  minAmount?: number; // Para bits o viewers mínimos
  // Soporte para Video Transparente en Alertas de Stream
  videoUrl?: string; // Direct URL, Data URI o Blob URL
  videoName?: string;
  blendMode?: AlertBlendMode;
  videoScale?: number; // 0.5 a 2.0
  screenShake?: boolean;
  // Soporte para Audio Personalizado (.mp3, .wav, .ogg, máx 30s)
  customAudioUrl?: string;
  customAudioName?: string;
  customAudioVolume?: number;
  customAudioDuration?: number; // En segundos (<= 30.0s)
  // Escalonamiento de Bits y Suscripciones
  bitTiers?: BitTierConfig[];
  subTiers?: SubTierConfig[];
}

export const DEFAULT_BIT_TIERS: BitTierConfig[] = [
  {
    id: 'bits-bronze',
    name: 'Bronce (1 - 99 Bits)',
    minBits: 1,
    template: '¡{user} envió {bits} bits!',
    accent: '#cd7f32',
    soundType: 'soft-pop',
    screenShake: false,
  },
  {
    id: 'bits-silver',
    name: 'Plata (100 - 499 Bits)',
    minBits: 100,
    template: '¡{user} envió {bits} bits con mensaje: «{message}»!',
    accent: '#c0c0c0',
    soundType: 'arcade-chime',
    screenShake: false,
  },
  {
    id: 'bits-gold',
    name: 'Oro (500 - 999 Bits)',
    minBits: 500,
    template: '¡EXPLOSIÓN DE BITS! ¡{user} soltó {bits} bits!',
    accent: '#ffd700',
    soundType: 'retro-fanfare',
    screenShake: true,
  },
  {
    id: 'bits-diamond',
    name: 'Diamante / Hype (1000+ Bits)',
    minBits: 1000,
    template: '¡¡¡BOMBA HYPE DIAMANTE!!! ¡{user} DONÓ {bits} BITS!',
    accent: '#00f5ff',
    soundType: 'retro-fanfare',
    screenShake: true,
  },
];

export const DEFAULT_SUB_TIERS: SubTierConfig[] = [
  {
    id: 'sub-t1',
    tier: 'tier1',
    name: 'Tier 1 - Subscripción Básica',
    template: '¡{user} se ha suscrito (Nivel 1 · {detail})!',
    accent: '#9146ff',
    soundType: 'synth-bell',
    screenShake: false,
  },
  {
    id: 'sub-t2',
    tier: 'tier2',
    name: 'Tier 2 - Subscripción Élite',
    template: '¡{user} ascendió a TIER 2 ({detail})!',
    accent: '#00c7ff',
    soundType: 'arcade-chime',
    screenShake: false,
  },
  {
    id: 'sub-t3',
    tier: 'tier3',
    name: 'Tier 3 - Leyenda Suprema',
    template: '¡¡SUB DE ORO TIER 3!! ¡{user} apoyó con todo ({detail})!',
    accent: '#ff0055',
    soundType: 'retro-fanfare',
    screenShake: true,
  },
  {
    id: 'sub-gift',
    tier: 'gift',
    name: 'Suscripciones Regaladas (Gift Subs)',
    template: '¡{user} regaló una suscripción en la comunidad!',
    accent: '#10b981',
    soundType: 'retro-fanfare',
    screenShake: true,
  },
];

export const DEFAULT_CUSTOM_EVENTS: CustomAlertRule[] = [
  {
    id: 'custom-hype-train',
    name: 'Hype Train Nivel 5',
    triggerKeyword: '!hypetrain',
    enabled: true,
    template: '¡¡¡TREN DEL HYPE NIVEL 5 ACTIVADO EN LA COMUNIDAD!!!',
    audioMode: 'both',
    soundType: 'retro-fanfare',
    customAudioDuration: 4.5,
    screenShake: true,
    accentColor: '#ff0055',
  },
  {
    id: 'custom-secret-sound',
    name: 'Efecto Secreto del Chat',
    triggerKeyword: '!secreto',
    enabled: true,
    template: '¡{user} desbloqueó el audio secreto de la cabina!',
    audioMode: 'custom_audio',
    soundType: 'arcade-chime',
    customAudioDuration: 2.5,
    screenShake: false,
    accentColor: '#00f5ff',
  },
];

export interface StreamAlertsSettings {
  channel: string;
  accent: string;
  alertStyle: AlertStyle;
  position: AlertPosition;
  energy: AlertEnergy;
  scale: number;
  duration: number; // segundos en pantalla
  soundVolume: number; // 0 a 1
  soundType: AlertSoundType;
  stickerSvg: string;
  /** Cada alerta sale en un punto distinto de la pantalla. Apagado, sale en `position`. */
  randomPosition: boolean;
  /** Margen libre contra los bordes de la pantalla, en porcentaje (con posición aleatoria). */
  randomMargin: number;
  events: {
    follow: EventRuleConfig;
    sub: EventRuleConfig;
    bits: EventRuleConfig;
    raid: EventRuleConfig;
  };
  customEvents: CustomAlertRule[];
}

export const DEFAULT_ALERTS_SETTINGS: StreamAlertsSettings = {
  channel: 'laloplay_',
  accent: '#9146ff',
  alertStyle: 'cabina',
  position: 'tc',
  energy: 'normal',
  scale: 1,
  duration: 5,
  soundVolume: 0.8,
  soundType: 'synth-bell',
  stickerSvg: DEFAULT_APPEARANCE.stickerSvg,
  randomPosition: false,
  randomMargin: 6,
  events: {
    follow: {
      enabled: true,
      template: '¡{user} te acaba de seguir!',
      audioMode: 'synth',
      soundType: 'synth-bell',
      blendMode: 'transparent',
      videoScale: 1.0,
      screenShake: false,
    },
    sub: {
      enabled: true,
      template: '¡{user} se ha suscrito! ({detail})',
      audioMode: 'both',
      soundType: 'retro-fanfare',
      blendMode: 'transparent',
      videoScale: 1.0,
      screenShake: false,
      subTiers: DEFAULT_SUB_TIERS,
    },
    bits: {
      enabled: true,
      template: '¡{user} envió {bits} bits! {message}',
      audioMode: 'both',
      soundType: 'arcade-chime',
      minAmount: 100,
      blendMode: 'transparent',
      videoScale: 1.0,
      screenShake: false,
      bitTiers: DEFAULT_BIT_TIERS,
    },
    raid: {
      enabled: true,
      template: '¡Raid de {user} con {viewers} espectadores!',
      audioMode: 'synth',
      soundType: 'retro-fanfare',
      minAmount: 5,
      blendMode: 'screen',
      videoScale: 1.15,
      screenShake: true,
    },
  },
  customEvents: DEFAULT_CUSTOM_EVENTS,
};

export const ALERTS_STORAGE_KEY = 'lalo_alerts_settings';

export const RANDOM_MARGIN = { min: 0, max: 20 } as const;

/** Margen de la posición aleatoria dentro de sus límites; lo que no vale queda en el valor por defecto. */
export function clampRandomMargin(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return DEFAULT_ALERTS_SETTINGS.randomMargin;
  return Math.round(Math.min(RANDOM_MARGIN.max, Math.max(RANDOM_MARGIN.min, n)));
}

export function loadAlertsSettings(): StreamAlertsSettings {
  try {
    const raw = localStorage.getItem(ALERTS_STORAGE_KEY);
    if (!raw) return DEFAULT_ALERTS_SETTINGS;
    const parsed = JSON.parse(raw);
    const parsedEvents = parsed.events || {};
    return {
      ...DEFAULT_ALERTS_SETTINGS,
      ...parsed,
      randomPosition: parsed.randomPosition === true,
      randomMargin: clampRandomMargin(parsed.randomMargin),
      events: {
        follow: {
          ...DEFAULT_ALERTS_SETTINGS.events.follow,
          ...(parsedEvents.follow || {}),
        },
        sub: {
          ...DEFAULT_ALERTS_SETTINGS.events.sub,
          ...(parsedEvents.sub || {}),
          subTiers: parsedEvents.sub?.subTiers || DEFAULT_SUB_TIERS,
        },
        bits: {
          ...DEFAULT_ALERTS_SETTINGS.events.bits,
          ...(parsedEvents.bits || {}),
          bitTiers: parsedEvents.bits?.bitTiers || DEFAULT_BIT_TIERS,
        },
        raid: {
          ...DEFAULT_ALERTS_SETTINGS.events.raid,
          ...(parsedEvents.raid || {}),
        },
      },
      customEvents:
        Array.isArray(parsed.customEvents) && parsed.customEvents.length > 0
          ? parsed.customEvents
          : DEFAULT_CUSTOM_EVENTS,
    };
  } catch {
    return DEFAULT_ALERTS_SETTINGS;
  }
}

export function saveAlertsSettings(settings: StreamAlertsSettings): void {
  try {
    localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(settings));
    queueCloudPush('alerts', settings);
  } catch (e) {
    console.error('Error guardando alertas en localStorage:', e);
  }
}
