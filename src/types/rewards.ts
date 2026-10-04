/**
 * src/types/rewards.ts
 *
 * Modelo de datos de las recompensas: qué las activa (puntos del canal o bits),
 * qué suena, qué se ve (nada, una placa, un vídeo) y las reglas contra el abuso.
 *
 * Todo lo que se lee de localStorage, de la nube o de la URL pasa por
 * normalizeRewardsSettings: los ajustes antiguos (seis posiciones, sin
 * disparador, sin placa) se completan sin cambiar cómo se comportaban.
 */

import { queueCloudPush, stripDataUrls } from '../lib/cloudConfig';
import { decodeBase64Url, encodeBase64Url } from '../utils/appearance';
import { AlertSoundType } from './alerts';

/** Nueve puntos fijos, pantalla completa y posición aleatoria. Los seis valores antiguos siguen valiendo. */
export type RewardVideoPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
  | 'fullscreen'
  | 'random';

/** Los nueve puntos fijos, en orden de lectura (fila por fila). */
export const REWARD_GRID_POSITIONS = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'center',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const satisfies readonly RewardVideoPosition[];

const POSITIONS: readonly RewardVideoPosition[] = [...REWARD_GRID_POSITIONS, 'fullscreen', 'random'];

export type RewardBlendMode = 'transparent' | 'screen' | 'chroma-green';
export type RewardTrigger = 'points' | 'bits';
export type RewardBitsMode = 'exact' | 'range';
/** Quién puede activarla: todos, suscriptores (y de ahí hacia arriba) o VIP y moderadores. */
export type RewardAudience = 'all' | 'sub' | 'vip';
export type RewardQueueMode = 'queue' | 'overlap';

export const PLATE_STYLES = [
  { id: 'cabina', name: 'Cabina', hint: 'Placa mate rectangular, con el nombre en grande.' },
  { id: 'cinta', name: 'Cinta', hint: 'Franja baja y alargada con el borde inclinado.' },
  { id: 'boleto', name: 'Boleto', hint: 'Entrada de papel con muescas y la cantidad en el talón.' },
  { id: 'comic', name: 'Cómic', hint: 'Bocadillo blanco de trazo grueso, un poco girado.' },
  { id: 'cristal', name: 'Cristal', hint: 'Píldora translúcida con un disco de sonido.' },
  { id: 'custom', name: 'Personalizado', hint: 'Tu propia imagen o vídeo como fondo de la placa.' },
] as const;
export type PlateStyleId = (typeof PLATE_STYLES)[number]['id'];
const PLATE_IDS = PLATE_STYLES.map((style) => style.id) as readonly PlateStyleId[];

/** Placa «Personalizado»: el fondo lo pone el creador y decide dónde va cada texto. */
export interface CustomPlate {
  mediaUrl: string;
  mediaId?: string;
  mediaName?: string;
  mediaKind: 'image' | 'video';
  /** Ancho de la placa en em de la capa (a 1920 de ancho, 1 em son 32 px). */
  width: number;
  showText: boolean;
  textColor: string;
  /** Celda de la rejilla 3 × 3 (0 a 8, fila por fila) donde va cada texto. */
  userCell: number;
  nameCell: number;
}

export interface CustomRewardItem {
  id: string;
  name: string;
  cost: number;
  description: string;
  enabled: boolean;
  cooldownSeconds: number;
  userInputRequired: boolean;

  // Qué la activa
  trigger: RewardTrigger;
  /** Id de la recompensa en Twitch, capturado con «Detectar». Vacío: aún sin enlazar. */
  twitchRewardId: string;
  bitsMode: RewardBitsMode;
  bitsMin: number;
  /** Tope del rango; null es «sin tope». En modo exacto no se usa. */
  bitsMax: number | null;
  audience: RewardAudience;

  // Vídeo
  videoUrl?: string; // Dirección pública, data: o blob:
  videoName?: string;
  /** Id del archivo en el almacén (media_files), si se subió a la nube. */
  videoMediaId?: string;
  blendMode: RewardBlendMode;
  position: RewardVideoPosition;
  scale: number; // 0.5 a 2.0
  volume: number; // 0.0 a 1.0
  /** Posición aleatoria: margen a los bordes (% de la pantalla). */
  randomMargin: number;
  randomVary: boolean;
  randomNoRepeat: boolean;

  // Placa
  /** Apagado es solo sonido (y vídeo, si lo hay): no aparece ninguna placa. */
  showPlate: boolean;
  plateStyle: PlateStyleId | 'default';
  showNoticeText: boolean;
  noticeTemplate: string; // "{user} activó {reward}!"
  duration: number; // Segundos del vídeo en pantalla (0: lo que dure el vídeo)

  // Efectos
  screenShake: boolean;
  soundType: AlertSoundType;
  customAudioUrl?: string;
  customAudioName?: string;
  customAudioVolume?: number;
  customAudioMediaId?: string;
  accentColor: string;
}

export interface RewardsSettings {
  channel: string;
  rewards: CustomRewardItem[];
  defaultVolume: number;
  globalCooldownSeconds: number;
  /** Se conserva por compatibilidad: equivale a queueMode === 'overlap'. */
  allowOverlappingVideos: boolean;
  /** Apagado, la capa no reacciona al chat (las pruebas del panel siguen funcionando). */
  enabled: boolean;
  /** Mostrar también en la fuente «Todo en uno». */
  inAll: boolean;
  queueMode: RewardQueueMode;
  /** Cuántas a la vez en modo solape (2 a 4). */
  overlapLimit: number;
  /** Cuántas pueden esperar turno; las siguientes se descartan. */
  queueMax: number;
  /** Usos por espectador y minuto (0: sin límite). */
  perViewerPerMinute: number;
  /** Segundos mínimos de la placa aunque el sonido dure menos. */
  minPlateSeconds: number;
  defaultPlateStyle: PlateStyleId;
  customPlate: CustomPlate;
}

export const REWARDS_STORAGE_KEY = 'lalo_stream_rewards_settings';

export const REWARD_LIMITS = {
  bits: { min: 1, max: 100000 },
  cooldown: { min: 0, max: 3600 },
  globalCooldown: { min: 0, max: 600 },
  perViewer: { min: 0, max: 30 },
  overlap: { min: 2, max: 4 },
  queueMax: { min: 1, max: 30 },
  minPlate: { min: 1, max: 5 },
  maxSeconds: 30,
  randomMargin: { min: 0, max: 20 },
  plateWidth: { min: 12, max: 40 },
} as const;

export const DEFAULT_CUSTOM_PLATE: CustomPlate = {
  mediaUrl: '',
  mediaKind: 'image',
  width: 22,
  showText: true,
  textColor: '#ffffff',
  userCell: 7,
  nameCell: 4,
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);
const optStr = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
const num = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const int = (value: unknown, fallback: number, min: number, max: number): number =>
  Math.round(num(value, fallback, min, max));
const oneOf = <T extends string>(value: unknown, list: readonly T[], fallback: T): T =>
  list.includes(value as T) ? (value as T) : fallback;
const color = (value: unknown, fallback: string): string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;

export function normalizeCustomPlate(raw: unknown): CustomPlate {
  const src = isObject(raw) ? raw : {};
  return {
    mediaUrl: str(src.mediaUrl),
    mediaId: optStr(src.mediaId),
    mediaName: optStr(src.mediaName),
    mediaKind: oneOf(src.mediaKind, ['image', 'video'] as const, 'image'),
    width: num(src.width, DEFAULT_CUSTOM_PLATE.width, REWARD_LIMITS.plateWidth.min, REWARD_LIMITS.plateWidth.max),
    showText: bool(src.showText, true),
    textColor: color(src.textColor, DEFAULT_CUSTOM_PLATE.textColor),
    userCell: int(src.userCell, DEFAULT_CUSTOM_PLATE.userCell, 0, 8),
    nameCell: int(src.nameCell, DEFAULT_CUSTOM_PLATE.nameCell, 0, 8),
  };
}

/**
 * Completa una recompensa. Las guardadas antes de esta versión quedan como
 * estaban: por puntos, para todos, con placa si mostraban texto o no tenían
 * vídeo, y en la misma posición.
 */
export function normalizeReward(raw: unknown, index = 0): CustomRewardItem {
  const src = isObject(raw) ? raw : {};
  const videoUrl = optStr(src.videoUrl);
  const showNoticeText = bool(src.showNoticeText, true);
  const bitsMin = int(src.bitsMin, 100, REWARD_LIMITS.bits.min, REWARD_LIMITS.bits.max);
  const rawMax = src.bitsMax === null || src.bitsMax === undefined || src.bitsMax === '' ? null : int(src.bitsMax, bitsMin, REWARD_LIMITS.bits.min, REWARD_LIMITS.bits.max);
  const volume = num(src.volume, 0.85, 0, 1);
  return {
    id: str(src.id) || `reward-${index}`,
    name: str(src.name, 'Recompensa').slice(0, 60),
    cost: int(src.cost, 100, 0, 10_000_000),
    description: str(src.description),
    enabled: bool(src.enabled, true),
    cooldownSeconds: int(src.cooldownSeconds, 0, REWARD_LIMITS.cooldown.min, REWARD_LIMITS.cooldown.max),
    userInputRequired: bool(src.userInputRequired, false),
    trigger: oneOf(src.trigger, ['points', 'bits'] as const, 'points'),
    twitchRewardId: str(src.twitchRewardId).trim().toLowerCase(),
    bitsMode: oneOf(src.bitsMode, ['exact', 'range'] as const, 'exact'),
    bitsMin,
    // Un tope por debajo del mínimo no deja pasar nada: se sube al mínimo
    bitsMax: rawMax === null ? null : Math.max(bitsMin, rawMax),
    audience: oneOf(src.audience, ['all', 'sub', 'vip'] as const, 'all'),
    videoUrl,
    videoName: optStr(src.videoName),
    videoMediaId: optStr(src.videoMediaId),
    blendMode: oneOf(src.blendMode, ['transparent', 'screen', 'chroma-green'] as const, 'transparent'),
    position: oneOf(src.position, POSITIONS, 'center'),
    scale: num(src.scale, 1, 0.5, 2),
    volume,
    randomMargin: num(src.randomMargin, 6, REWARD_LIMITS.randomMargin.min, REWARD_LIMITS.randomMargin.max),
    randomVary: bool(src.randomVary, true),
    randomNoRepeat: bool(src.randomNoRepeat, true),
    showPlate: bool(src.showPlate, showNoticeText || !videoUrl),
    plateStyle: oneOf(src.plateStyle, ['default', ...PLATE_IDS] as const, 'default'),
    showNoticeText,
    noticeTemplate: str(src.noticeTemplate, '¡{user} canjeó {reward}!'),
    duration: num(src.duration, 5, 0, REWARD_LIMITS.maxSeconds),
    screenShake: bool(src.screenShake, false),
    soundType: oneOf(src.soundType, ['synth-bell', 'retro-fanfare', 'arcade-chime', 'soft-pop', 'none'] as const, 'arcade-chime'),
    customAudioUrl: optStr(src.customAudioUrl),
    customAudioName: optStr(src.customAudioName),
    customAudioVolume: src.customAudioVolume === undefined ? undefined : num(src.customAudioVolume, volume, 0, 1),
    customAudioMediaId: optStr(src.customAudioMediaId),
    accentColor: color(src.accentColor, '#9146ff'),
  };
}

const PRESET_SOURCE = [
  {
    id: 'reward-confetti',
    name: '¡Lluvia de Confeti Neón!',
    cost: 250,
    description: 'Explosión de partículas y confeti brillante en toda la pantalla para celebrar.',
    cooldownSeconds: 15,
    position: 'fullscreen',
    scale: 1.0,
    volume: 0.85,
    noticeTemplate: '¡{user} desató una lluvia de confeti!',
    duration: 5,
    soundType: 'arcade-chime',
    accentColor: '#9146ff',
  },
  {
    id: 'reward-boom',
    name: 'K.O. Explosión Cómic',
    cost: 500,
    description: 'Efecto anime de impacto directo con sacudida elástica de cámara en OBS.',
    cooldownSeconds: 30,
    position: 'center',
    scale: 1.25,
    volume: 0.9,
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
    cooldownSeconds: 20,
    userInputRequired: true,
    position: 'bottom-right',
    scale: 1.0,
    volume: 0.8,
    noticeTemplate: '{user}: «{message}»',
    duration: 6,
    soundType: 'synth-bell',
    accentColor: '#22c7e0',
  },
  {
    id: 'reward-level-up',
    name: 'Fuego Cósmico & Level Up',
    cost: 1000,
    description: 'Llamas púrpuras transparentes envolviendo la pantalla con sonido triunfal.',
    cooldownSeconds: 60,
    blendMode: 'screen',
    position: 'fullscreen',
    scale: 1.1,
    volume: 0.95,
    noticeTemplate: '¡LEVEL UP! {user} activó el poder cósmico',
    duration: 6,
    screenShake: true,
    soundType: 'retro-fanfare',
    accentColor: '#ffb020',
  },
];

export const PRESET_REWARDS: CustomRewardItem[] = PRESET_SOURCE.map((item, index) => normalizeReward(item, index));

/**
 * Valores de partida contra el abuso con cheers de 1 bit: como mucho 3 usos por
 * espectador y minuto, 5 s entre dos recompensas cualesquiera y 8 en espera.
 */
export const DEFAULT_REWARDS_SETTINGS: RewardsSettings = {
  channel: 'laloplay_',
  rewards: PRESET_REWARDS,
  defaultVolume: 0.85,
  globalCooldownSeconds: 5,
  allowOverlappingVideos: false,
  enabled: true,
  inAll: true,
  queueMode: 'queue',
  overlapLimit: 2,
  queueMax: 8,
  perViewerPerMinute: 3,
  minPlateSeconds: 2.5,
  defaultPlateStyle: 'cabina',
  customPlate: DEFAULT_CUSTOM_PLATE,
};

/** Espera de partida de una recompensa nueva por bits: frena la ráfaga de cheers pequeños. */
export const DEFAULT_BITS_COOLDOWN_SECONDS = 10;

export function normalizeRewardsSettings(raw: unknown): RewardsSettings {
  const src = isObject(raw) ? raw : {};
  const d = DEFAULT_REWARDS_SETTINGS;
  const queueMode = oneOf(src.queueMode, ['queue', 'overlap'] as const, src.allowOverlappingVideos === true ? 'overlap' : 'queue');
  const seen = new Set<string>();
  const rewards = (Array.isArray(src.rewards) && src.rewards.length > 0 ? src.rewards.map(normalizeReward) : PRESET_REWARDS).filter(
    (reward) => {
      if (seen.has(reward.id)) return false;
      seen.add(reward.id);
      return true;
    }
  );
  return {
    channel: typeof src.channel === 'string' ? src.channel : d.channel,
    rewards,
    defaultVolume: num(src.defaultVolume, d.defaultVolume, 0, 1),
    globalCooldownSeconds: int(src.globalCooldownSeconds, d.globalCooldownSeconds, REWARD_LIMITS.globalCooldown.min, REWARD_LIMITS.globalCooldown.max),
    allowOverlappingVideos: queueMode === 'overlap',
    enabled: bool(src.enabled, d.enabled),
    inAll: bool(src.inAll, d.inAll),
    queueMode,
    overlapLimit: int(src.overlapLimit, d.overlapLimit, REWARD_LIMITS.overlap.min, REWARD_LIMITS.overlap.max),
    queueMax: int(src.queueMax, d.queueMax, REWARD_LIMITS.queueMax.min, REWARD_LIMITS.queueMax.max),
    perViewerPerMinute: int(src.perViewerPerMinute, d.perViewerPerMinute, REWARD_LIMITS.perViewer.min, REWARD_LIMITS.perViewer.max),
    minPlateSeconds: num(src.minPlateSeconds, d.minPlateSeconds, REWARD_LIMITS.minPlate.min, REWARD_LIMITS.minPlate.max),
    defaultPlateStyle: oneOf(src.defaultPlateStyle, PLATE_IDS, d.defaultPlateStyle),
    customPlate: normalizeCustomPlate(src.customPlate),
  };
}

export function loadRewardsSettings(): RewardsSettings {
  try {
    const raw = localStorage.getItem(REWARDS_STORAGE_KEY);
    if (!raw) return DEFAULT_REWARDS_SETTINGS;
    return normalizeRewardsSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_REWARDS_SETTINGS;
  }
}

export function saveRewardsSettings(settings: RewardsSettings): void {
  try {
    localStorage.setItem(REWARDS_STORAGE_KEY, JSON.stringify(settings));
    queueCloudPush('rewards', settings);
  } catch (err) {
    console.error('Error saving rewards settings:', err);
  }
}

/**
 * Ajustes para la URL de OBS cuando no hay cuenta en la nube. Los archivos
 * incrustados (data:) no caben en una URL y se quedan fuera.
 */
export function encodeRewardsSettings(settings: RewardsSettings): string {
  return encodeBase64Url(JSON.stringify(stripDataUrls(settings).value));
}

/** Ajustes recibidos por URL, o null si el valor no se puede leer. */
export function decodeRewardsSettings(param: string | null | undefined): RewardsSettings | null {
  const text = decodeBase64Url(param);
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return isObject(parsed) ? normalizeRewardsSettings(parsed) : null;
  } catch {
    return null;
  }
}

/** Estilo de placa que le toca a una recompensa: el suyo o el de todas. */
export function plateStyleFor(reward: Pick<CustomRewardItem, 'plateStyle'>, settings: Pick<RewardsSettings, 'defaultPlateStyle'>): PlateStyleId {
  return reward.plateStyle === 'default' ? settings.defaultPlateStyle : reward.plateStyle;
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
