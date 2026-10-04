/**
 * src/types/roulette.ts
 *
 * Modelo de datos, preajustes y utilidades matemáticas para la Ruleta de Castigos y Retos
 * de Lalo Stream Suite.
 *
 * Diseñado con estética de hardware Cabina Broadcast, física de rotación con GSAP
 * y principios de diseño de Emil Kowalski e Impeccable.
 */

import { queueCloudPush, stripDataUrls } from '../lib/cloudConfig';
import { decodeBase64Url, encodeBase64Url } from '../utils/appearance';
import { AlertSoundType } from './alerts';
import type { RewardAudience } from './rewards';

export type PenaltyCategory =
  | 'fitness'
  | 'voice'
  | 'gameplay'
  | 'food'
  | 'show'
  | 'safe'
  | 'custom';

export type RouletteStyle = 'cabina' | 'neon' | 'cyber' | 'gold';

export interface RouletteSegment {
  id: string;
  text: string;
  color: string;
  textColor?: string;
  category: PenaltyCategory;
  durationSec?: number; // Para retos con temporizador en pantalla
  intensity?: 'light' | 'medium' | 'hard' | 'extreme';
  enabled: boolean;
}

export interface RoulettePreset {
  id: string;
  name: string;
  description: string;
  iconName: string;
  segments: RouletteSegment[];
}

export interface RouletteSettings {
  channel: string;
  title: string;
  style: RouletteStyle;
  spinDurationSec: number; // Duración del giro en segundos (e.g. 5 a 8s)
  soundEnabled: boolean;
  tickVolume: number; // Volumen del sonido de tick mecánico (0 a 1)
  victorySoundType: AlertSoundType;
  victoryCustomAudioUrl?: string;
  victoryCustomAudioVolume?: number;
  screenShake: boolean;
  confetti: boolean;
  showWinnerBanner: boolean;
  winnerBannerDurationSec: number;
  segments: RouletteSegment[];
  ttsAnnounceSpin?: boolean; // Anunciar con voz TTS cuando la ruleta va a girar
  ttsAnnounceWinner?: boolean; // Anunciar con voz TTS el resultado seleccionado

  // ---------- Actividad: se abre y se cierra, con el panel o con un comando ----------
  /** Nombre que se escribe tras el comando para abrirla (ej: !ruleta castigos). */
  name: string;
  /** Abierta desde el panel. Cerrada, ni los puntos ni los bits la giran. */
  active: boolean;
  /** Cuándo se abrió o cerró desde el panel (ms). El cambio más reciente manda sobre el del chat. */
  activeAt: number;
  /** Comandos del streamer y sus moderadores para abrirla y cerrarla. */
  openCommand: string;
  closeCommand: string;

  // ---------- Qué la hace girar: puntos del canal o bits, nunca un comando ----------
  triggerKind: RouletteTriggerKind;
  /** Id de la recompensa de puntos en Twitch, en minúsculas. Vacío: sin enlazar. */
  twitchRewardId: string;
  bitsMode: 'exact' | 'range';
  bitsMin: number;
  /** Tope del rango. null = sin tope. */
  bitsMax: number | null;
  /** Quién puede girarla. */
  audience: RewardAudience;
  /** Segundos de espera entre un giro aceptado y el siguiente. */
  cooldownSeconds: number;
  /** Aviso pendiente: estos ajustes venían de la versión que giraba con un comando del chat. */
  spinNotice: boolean;
}

export type RouletteTriggerKind = 'points' | 'bits';

export const ROULETTE_LIMITS = {
  bits: { min: 1, max: 100000 },
  cooldown: { min: 0, max: 3600 },
  nameMax: 30,
} as const;

export const DEFAULT_OPEN_COMMAND = '!ruleta';
export const DEFAULT_CLOSE_COMMAND = '!cerrarruleta';
export const DEFAULT_ROULETTE_NAME = 'castigos';

export const ROULETTE_STORAGE_KEY = 'lalo_roulette_settings';

export const CATEGORY_LABELS: Record<PenaltyCategory, { label: string; color: string; icon: string }> = {
  fitness: { label: 'Fitness / Físico', color: '#ff2d46', icon: '🏋️' },
  voice: { label: 'Voz & Show', color: '#9146ff', icon: '🎤' },
  gameplay: { label: 'Gameplay / Juego', color: '#00f5ff', icon: '🎮' },
  food: { label: 'Sabor / Picante', color: '#ffb020', icon: '🌶️' },
  show: { label: 'Humor & Castigo', color: '#ec4899', icon: '🎭' },
  safe: { label: 'Inmunidad / Libre', color: '#53fc18', icon: '🛡️' },
  custom: { label: 'Personalizado', color: '#a855f7', icon: '⭐' },
};

export const ROULETTE_STYLE_PRESETS: { id: RouletteStyle; name: string; desc: string }[] = [
  { id: 'cabina', name: 'Cabina Broadcast', desc: 'Chasis industrial negro mate con indicadores LED perimetrales' },
  { id: 'neon', name: 'Neón Glow', desc: 'Resplandor energético y alto contraste cibernético' },
  { id: 'cyber', name: 'Cyberpunk', desc: 'Bordes biselados con estética futurista de alta intensidad' },
  { id: 'gold', name: 'Casino Oro VIP', desc: 'Acabados dorados y estética de juego televisivo' },
];

export const VIBRANT_SEGMENT_COLORS = [
  '#9146ff', // Morado Twitch
  '#ff2d46', // Rojo Carmesí
  '#00f5ff', // Cian Neón
  '#ffb020', // Ámbar Dorado
  '#53fc18', // Verde Neón
  '#ec4899', // Rosa Intenso
  '#3b82f6', // Azul Eléctrico
  '#8b5cf6', // Violeta
  '#10b981', // Esmeralda
  '#f97316', // Naranja Fuego
];

/** Presets Temáticos listos para usar */
export const ROULETTE_PRESETS: RoulettePreset[] = [
  {
    id: 'gamer',
    name: 'Castigos Gamer / En Directo',
    description: 'Retos de jugabilidad para subir la dificultad en directo.',
    iconName: 'Gamepad2',
    segments: [
      { id: 'g-1', text: 'Jugar con una sola mano', color: '#ff2d46', category: 'gameplay', durationSec: 60, intensity: 'medium', enabled: true },
      { id: 'g-2', text: 'Invertir ejes de la cámara', color: '#9146ff', category: 'gameplay', durationSec: 90, intensity: 'hard', enabled: true },
      { id: 'g-3', text: 'Jugar sin sonido 1 ronda', color: '#00f5ff', category: 'gameplay', durationSec: 120, intensity: 'medium', enabled: true },
      { id: 'g-4', text: 'Usar la peor arma / personaje', color: '#ffb020', category: 'gameplay', durationSec: 0, intensity: 'light', enabled: true },
      { id: 'g-5', text: 'Pantalla apagada 5 segundos', color: '#ec4899', category: 'gameplay', durationSec: 5, intensity: 'extreme', enabled: true },
      { id: 'g-6', text: '¡Te salvaste! Inmunidad total', color: '#53fc18', category: 'safe', durationSec: 0, intensity: 'light', enabled: true },
    ],
  },
  {
    id: 'fitness',
    name: 'Castigos Físicos & Fitness',
    description: 'Ejercicios rápidos para mantener al streamer en movimiento.',
    iconName: 'Flame',
    segments: [
      { id: 'f-1', text: '15 Flexiones en directo', color: '#ff2d46', category: 'fitness', durationSec: 45, intensity: 'hard', enabled: true },
      { id: 'f-2', text: '20 Sentadillas enérgicas', color: '#9146ff', category: 'fitness', durationSec: 40, intensity: 'medium', enabled: true },
      { id: 'f-3', text: 'Plancha abdominal 30s', color: '#00f5ff', category: 'fitness', durationSec: 30, intensity: 'hard', enabled: true },
      { id: 'f-4', text: '25 Saltos de tijera', color: '#ffb020', category: 'fitness', durationSec: 35, intensity: 'light', enabled: true },
      { id: 'f-5', text: 'Mantener postura estática 45s', color: '#ec4899', category: 'fitness', durationSec: 45, intensity: 'medium', enabled: true },
      { id: 'f-6', text: '¡Descanso merecido! Puntos gratis', color: '#53fc18', category: 'safe', durationSec: 0, intensity: 'light', enabled: true },
    ],
  },
  {
    id: 'show',
    name: 'Show, Voz & Actuación',
    description: 'Risas aseguradas cambiando la voz o actuando ante el chat.',
    iconName: 'Mic',
    segments: [
      { id: 's-1', text: 'Hablar como robot 2 minutos', color: '#00f5ff', category: 'voice', durationSec: 120, intensity: 'medium', enabled: true },
      { id: 's-2', text: 'Cantar el coro de una canción', color: '#ec4899', category: 'show', durationSec: 30, intensity: 'hard', enabled: true },
      { id: 's-3', text: 'Imitar a Bob Esponja o Pitufo', color: '#ffb020', category: 'voice', durationSec: 60, intensity: 'medium', enabled: true },
      { id: 's-4', text: 'Decir 3 trabalenguas rápido', color: '#9146ff', category: 'voice', durationSec: 30, intensity: 'light', enabled: true },
      { id: 's-5', text: 'Voz de susurro ASMR 2 min', color: '#3b82f6', category: 'voice', durationSec: 120, intensity: 'light', enabled: true },
      { id: 's-6', text: '¡Inmunidad divina!', color: '#53fc18', category: 'safe', durationSec: 0, intensity: 'light', enabled: true },
    ],
  },
  {
    id: 'picante',
    name: 'Sabores & Retos Picantes',
    description: 'Castigos con comida, limón o condimentos en directo.',
    iconName: 'Skull',
    segments: [
      { id: 'p-1', text: 'Cucharada de salsa picante', color: '#ff2d46', category: 'food', durationSec: 0, intensity: 'extreme', enabled: true },
      { id: 'p-2', text: 'Morder un trozo de limón sin caras', color: '#ffb020', category: 'food', durationSec: 0, intensity: 'hard', enabled: true },
      { id: 'p-3', text: 'Beber vaso de agua de un trago', color: '#00f5ff', category: 'food', durationSec: 20, intensity: 'light', enabled: true },
      { id: 'p-4', text: 'Comer snack con ojos vendados', color: '#ec4899', category: 'food', durationSec: 30, intensity: 'medium', enabled: true },
      { id: 'p-5', text: 'Mezcla sorpresa de bebidas', color: '#9146ff', category: 'food', durationSec: 0, intensity: 'hard', enabled: true },
      { id: 'p-6', text: '¡Saludable! Te salvaste', color: '#53fc18', category: 'safe', durationSec: 0, intensity: 'light', enabled: true },
    ],
  },
];

export const DEFAULT_ROULETTE_SETTINGS: RouletteSettings = {
  channel: 'jagc',
  title: 'RULETA DE CASTIGOS & RETOS',
  style: 'cabina',
  spinDurationSec: 6.0,
  soundEnabled: true,
  tickVolume: 0.75,
  victorySoundType: 'arcade-chime',
  victoryCustomAudioVolume: 0.85,
  screenShake: true,
  confetti: true,
  showWinnerBanner: true,
  winnerBannerDurationSec: 8,
  segments: ROULETTE_PRESETS[0].segments,
  ttsAnnounceSpin: true,
  ttsAnnounceWinner: true,
  name: DEFAULT_ROULETTE_NAME,
  active: false,
  activeAt: 0,
  openCommand: DEFAULT_OPEN_COMMAND,
  closeCommand: DEFAULT_CLOSE_COMMAND,
  triggerKind: 'points',
  twitchRewardId: '',
  bitsMode: 'exact',
  bitsMin: 100,
  bitsMax: null,
  audience: 'all',
  cooldownSeconds: 0,
  spinNotice: false,
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const whole = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

/** Un comando válido: empieza por «!», va en minúsculas, sin espacios y con 25 caracteres como mucho. */
export function normalizeRouletteCommand(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const word = value.trim().toLowerCase().split(/\s+/)[0] || '';
  const clean = `!${word.replace(/^!+/, '').replace(/[^a-z0-9_ñáéíóúü-]/g, '')}`.slice(0, 25);
  return clean.length > 1 ? clean : fallback;
}

/** Nombre de la ruleta: una línea corta, sin saltos ni espacios repetidos. */
export function normalizeRouletteName(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_ROULETTE_NAME;
  const clean = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ROULETTE_LIMITS.nameMax);
  return clean || DEFAULT_ROULETTE_NAME;
}

/**
 * Completa unos ajustes guardados o recibidos (nube, URL, otra pestaña).
 *
 * Migración: hasta ahora cualquiera giraba la rueda escribiendo un comando
 * (`triggerCommand`) y el canje se anotaba por su nombre (`triggerRewardName`),
 * que nunca llegó a enlazarse. Esos dos campos desaparecen. El comando guardado
 * pasa a ser el que abre la ruleta, la ruleta queda cerrada y sin recompensa
 * enlazada, y `spinNotice` pide al editor que lo explique una vez.
 */
export function normalizeRouletteSettings(raw: unknown): RouletteSettings {
  const d = DEFAULT_ROULETTE_SETTINGS;
  if (!isObject(raw)) return d;
  const { triggerCommand, triggerRewardName, ...rest } = raw;
  const legacy = raw.triggerKind === undefined && (triggerCommand !== undefined || triggerRewardName !== undefined);

  const bitsMin = whole(raw.bitsMin, d.bitsMin, ROULETTE_LIMITS.bits.min, ROULETTE_LIMITS.bits.max);
  const rawMax =
    raw.bitsMax === null || raw.bitsMax === undefined || raw.bitsMax === ''
      ? null
      : whole(raw.bitsMax, bitsMin, ROULETTE_LIMITS.bits.min, ROULETTE_LIMITS.bits.max);
  const openCommand = normalizeRouletteCommand(legacy ? triggerCommand : raw.openCommand, d.openCommand);
  const closeCommand = normalizeRouletteCommand(raw.closeCommand, d.closeCommand);

  return {
    ...d,
    ...(rest as Partial<RouletteSettings>),
    segments: Array.isArray(raw.segments) && raw.segments.length > 0 ? (raw.segments as RouletteSegment[]) : d.segments,
    name: normalizeRouletteName(raw.name),
    active: raw.active === true,
    activeAt: whole(raw.activeAt, 0, 0, Number.MAX_SAFE_INTEGER),
    openCommand,
    // Los dos comandos no pueden ser el mismo: no se sabría si abre o cierra
    closeCommand: closeCommand === openCommand ? (openCommand === d.closeCommand ? '!finruleta' : d.closeCommand) : closeCommand,
    triggerKind: raw.triggerKind === 'bits' ? 'bits' : 'points',
    twitchRewardId: typeof raw.twitchRewardId === 'string' ? raw.twitchRewardId.trim().toLowerCase().slice(0, 64) : '',
    bitsMode: raw.bitsMode === 'range' ? 'range' : 'exact',
    bitsMin,
    bitsMax: rawMax === null ? null : Math.max(bitsMin, rawMax),
    audience: raw.audience === 'sub' || raw.audience === 'vip' ? raw.audience : 'all',
    cooldownSeconds: whole(raw.cooldownSeconds, d.cooldownSeconds, ROULETTE_LIMITS.cooldown.min, ROULETTE_LIMITS.cooldown.max),
    spinNotice: legacy ? true : raw.spinNotice === true,
  };
}

/** Carga segura desde LocalStorage */
export function loadRouletteSettings(): RouletteSettings {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_ROULETTE_SETTINGS;
    const raw = localStorage.getItem(ROULETTE_STORAGE_KEY);
    if (!raw) return DEFAULT_ROULETTE_SETTINGS;
    return normalizeRouletteSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_ROULETTE_SETTINGS;
  }
}

/** Guarda configuración en LocalStorage */
export function saveRouletteSettings(settings: RouletteSettings): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(ROULETTE_STORAGE_KEY, JSON.stringify(settings));
    queueCloudPush('roulette', settings);
  } catch {
    // Silencioso ante cuotas restringidas
  }
}

/**
 * Ajustes para la URL de OBS cuando no hay cuenta en la nube (parámetro `rl`).
 * Los archivos incrustados (data:) no caben en una URL y se quedan fuera.
 */
export function encodeRouletteSettings(settings: RouletteSettings): string {
  return encodeBase64Url(JSON.stringify(stripDataUrls(settings).value));
}

/** Ajustes recibidos por URL, o null si el valor no se puede leer. */
export function decodeRouletteSettings(param: string | null | undefined): RouletteSettings | null {
  const text = decodeBase64Url(param);
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return isObject(parsed) ? normalizeRouletteSettings(parsed) : null;
  } catch {
    return null;
  }
}

// ==========================================
// CÁLCULOS MATEMÁTICOS Y FÍSICA DE ROTACIÓN
// ==========================================

/**
 * Calcula el ángulo central de cada segmento.
 * @param count Cantidad total de segmentos activos.
 */
export function getSegmentAngle(count: number): number {
  if (count <= 0) return 360;
  return 360 / count;
}

/**
 * Convierte coordenadas polares (ángulo en grados y radio) a cartesianas (x, y).
 */
export function polarToCartesian(centerX: number, centerY: number, radius: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

/**
 * Genera el path SVG ('d') para una rebanada (wedge/slice) de la ruleta.
 */
export function describeArc(
  x: number,
  y: number,
  radius: number,
  startAngle: number,
  endAngle: number
): string {
  const start = polarToCartesian(x, y, radius, endAngle);
  const end = polarToCartesian(x, y, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';

  return [
    'M', x, y,
    'L', start.x, start.y,
    'A', radius, radius, 0, largeArcFlag, 0, end.x, end.y,
    'Z',
  ].join(' ');
}

/**
 * Calcula la rotación objetivo final (en grados continuos) para que el puntero (en la parte superior 0°)
 * caiga exactamente en el segmento seleccionado, sumando un número mínimo de vueltas completas de inercia.
 *
 * @param targetIndex Índice del segmento ganador (0 a activeCount - 1).
 * @param activeCount Número total de segmentos activos.
 * @param currentRotation Rotación acumulada previa de la ruleta (grados).
 * @param minFullSpins Mínimo de giros de 360° para generar expectación dramática (ej: 5 a 8).
 * @returns Ángulo absoluto total al que debe rotar el elemento con GSAP.
 */
export function calculateTargetRotation(
  targetIndex: number,
  activeCount: number,
  currentRotation: number,
  minFullSpins = 6
): number {
  if (activeCount <= 0) return currentRotation + minFullSpins * 360;

  const sliceAngle = 360 / activeCount;
  // El centro del segmento 'targetIndex' se ubica en su mitad
  const sliceCenter = targetIndex * sliceAngle + sliceAngle / 2;

  // Para que el centro del segmento quede en la parte superior (0°):
  // La rotación deseada en el círculo [0, 360) es:
  const desiredNormalized = (360 - sliceCenter) % 360;

  // Calculamos la rotación actual normalizada
  const currentNormalized = ((currentRotation % 360) + 360) % 360;

  // Diferencia hacia adelante para llegar a desiredNormalized
  let forwardDelta = desiredNormalized - currentNormalized;
  if (forwardDelta <= 0) {
    forwardDelta += 360;
  }

  // Añadimos las vueltas completas mínimas de inercia
  const totalDelta = minFullSpins * 360 + forwardDelta;

  return currentRotation + totalDelta;
}

/**
 * Selecciona un segmento aleatorio entre los segmentos activos.
 */
export function pickRandomSegment(segments: RouletteSegment[]): {
  segment: RouletteSegment;
  index: number;
} | null {
  const active = segments.filter((s) => s.enabled);
  if (active.length === 0) return null;

  const randomIndex = Math.floor(Math.random() * active.length);
  return {
    segment: active[randomIndex],
    index: randomIndex,
  };
}
