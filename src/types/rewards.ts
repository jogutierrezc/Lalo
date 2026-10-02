/**
 * src/types/rewards.ts
 *
 * Modelos de datos para el módulo de Puntos de Canal, Biblioteca de Recompensas
 * y Avisos con Videos Transparentes (WebM con canal alfa, Screen blend y Chroma Key).
 */

import { AlertSoundType } from './alerts';

export type RewardVideoPosition =
  | 'center'
  | 'fullscreen'
  | 'bottom-right'
  | 'bottom-left'
  | 'top-right'
  | 'top-left';

export type RewardBlendMode = 'transparent' | 'screen' | 'chroma-green';

export interface CustomRewardItem {
  id: string;
  name: string;
  cost: number;
  description: string;
  enabled: boolean;
  cooldownSeconds: number;
  userInputRequired: boolean;
  
  // Capa Multimedia / Video Transparente
  videoUrl?: string; // Direct URL, Data URI o Blob URL
  videoName?: string;
  blendMode: RewardBlendMode;
  position: RewardVideoPosition;
  scale: number; // 0.5 a 2.0
  volume: number; // 0.0 a 1.0
  
  // Avisos y Textos Personalizados
  showNoticeText: boolean;
  noticeTemplate: string; // "{user} activó {reward}!"
  duration: number; // En segundos (o 0 para automático según duración del video)
  
  // Efectos de Impacto
  screenShake: boolean; // Sacudida sísmica elástica con GSAP
  soundType: AlertSoundType;
  customAudioUrl?: string;
  customAudioName?: string;
  customAudioVolume?: number;
  accentColor: string;
}

export interface RewardsSettings {
  channel: string;
  rewards: CustomRewardItem[];
  defaultVolume: number;
  globalCooldownSeconds: number;
  allowOverlappingVideos: boolean;
}

export const REWARDS_STORAGE_KEY = 'lalo_stream_rewards_settings';

export const PRESET_REWARDS: CustomRewardItem[] = [
  {
    id: 'reward-confetti',
    name: '¡Lluvia de Confeti Neón!',
    cost: 250,
    description: 'Explosión de partículas y confeti brillante en toda la pantalla para celebrar.',
    enabled: true,
    cooldownSeconds: 15,
    userInputRequired: false,
    blendMode: 'transparent',
    position: 'fullscreen',
    scale: 1.0,
    volume: 0.85,
    showNoticeText: true,
    noticeTemplate: '¡{user} desató una lluvia de confeti!',
    duration: 5,
    screenShake: false,
    soundType: 'arcade-chime',
    accentColor: '#9146ff',
  },
  {
    id: 'reward-boom',
    name: 'K.O. Explosión Cómic',
    cost: 500,
    description: 'Efecto anime de impacto directo con sacudida elástica de cámara en OBS.',
    enabled: true,
    cooldownSeconds: 30,
    userInputRequired: false,
    blendMode: 'transparent',
    position: 'center',
    scale: 1.25,
    volume: 0.9,
    showNoticeText: true,
    noticeTemplate: '¡K.O.! {user} lanzó un impacto demoledor',
    duration: 4,
    screenShake: true,
    soundType: 'retro-fanfare',
    accentColor: '#ff2d46',
  },
  {
    id: 'reward-bongo',
    name: 'Meme Bailarín / Gato Bongo',
    cost: 350,
    description: 'Animación en bucle transparente tocando los bongos en la esquina inferior.',
    enabled: true,
    cooldownSeconds: 20,
    userInputRequired: true,
    blendMode: 'transparent',
    position: 'bottom-right',
    scale: 1.0,
    volume: 0.8,
    showNoticeText: true,
    noticeTemplate: '{user}: «{message}»',
    duration: 6,
    screenShake: false,
    soundType: 'synth-bell',
    accentColor: '#22c7e0',
  },
  {
    id: 'reward-level-up',
    name: 'Fuego Cósmico & Level Up',
    cost: 1000,
    description: 'Llamas púrpuras transparentes envolviendo la pantalla con sonido triunfal.',
    enabled: true,
    cooldownSeconds: 60,
    userInputRequired: false,
    blendMode: 'screen',
    position: 'fullscreen',
    scale: 1.1,
    volume: 0.95,
    showNoticeText: true,
    noticeTemplate: '¡LEVEL UP! {user} activó el poder cósmico',
    duration: 6,
    screenShake: true,
    soundType: 'retro-fanfare',
    accentColor: '#ffb020',
  },
];

export const DEFAULT_REWARDS_SETTINGS: RewardsSettings = {
  channel: 'laloplay_',
  rewards: PRESET_REWARDS,
  defaultVolume: 0.85,
  globalCooldownSeconds: 5,
  allowOverlappingVideos: false,
};

export function loadRewardsSettings(): RewardsSettings {
  try {
    const raw = localStorage.getItem(REWARDS_STORAGE_KEY);
    if (!raw) return DEFAULT_REWARDS_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      channel: typeof parsed.channel === 'string' ? parsed.channel : DEFAULT_REWARDS_SETTINGS.channel,
      rewards: Array.isArray(parsed.rewards) && parsed.rewards.length > 0 ? parsed.rewards : PRESET_REWARDS,
      defaultVolume: typeof parsed.defaultVolume === 'number' ? parsed.defaultVolume : DEFAULT_REWARDS_SETTINGS.defaultVolume,
      globalCooldownSeconds: typeof parsed.globalCooldownSeconds === 'number' ? parsed.globalCooldownSeconds : DEFAULT_REWARDS_SETTINGS.globalCooldownSeconds,
      allowOverlappingVideos: Boolean(parsed.allowOverlappingVideos),
    };
  } catch {
    return DEFAULT_REWARDS_SETTINGS;
  }
}

export function saveRewardsSettings(settings: RewardsSettings): void {
  try {
    localStorage.setItem(REWARDS_STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.error('Error saving rewards settings:', err);
  }
}

export function buildRewardNotice(
  template: string,
  user: string,
  rewardName: string,
  message?: string
): string {
  let res = template
    .replace('{user}', user || 'Espectador')
    .replace('{reward}', rewardName || 'Recompensa');
  if (message) {
    res = res.replace('{message}', message);
  } else {
    res = res.replace('{message}', '');
  }
  return res.trim();
}
