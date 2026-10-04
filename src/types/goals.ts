/**
 * src/types/goals.ts
 *
 * Definición de tipos, modelos de datos y persistencia para el módulo de
 * Metas Comunitarias & Marcadores (Sub Goals, Follower Goals, Bit Goals).
 * Diseñado con estética de hardware Cabina Broadcast, física GSAP,
 * soporte multi-meta simultánea con compresión (hasta 4 en fila)
 * y carrusel/slideshow rotativo dinámico (5 o más metas), más anuncios por voz y sonido.
 *
 * El diseño de cada meta (Barra, Anillo, Bloques, Cinta, Columna o Personalizado)
 * y la posición en pantalla se definen en src/utils/goalDesign.ts.
 */

import { queueCloudPush } from '../lib/cloudConfig';
import { AlertSoundType } from './alerts';
import {
  DEFAULT_GOALS_POSITION,
  GoalCustom,
  GoalStyle,
  GoalsPosition,
  migrateGoalItem,
  normalizeGoalsPosition,
} from '../utils/goalDesign';

export type { GoalCustom, GoalStyle, GoalsPosition } from '../utils/goalDesign';

export type GoalType = 'subs' | 'followers' | 'bits' | 'raids' | 'donations';

export type GoalsDisplayMode =
  | 'auto_4_or_slideshow' // Hasta 4 en fila con compresión armónica; con 5 o más pasa automáticamente a Slideshow rotativo
  | 'slideshow_only'      // Siempre en carrusel rotativo continuo con transiciones suaves
  | 'row_only'            // Siempre en fila horizontal adaptable
  | 'reactive_progress'   // Muestra o destaca la meta con aportes o progreso reciente
  | 'single_active';      // Solo la meta seleccionada actualmente

export interface CommunityGoalItem {
  id: string;
  type: GoalType;
  title: string;
  current: number;
  target: number;
  unit: string; // 'subs' | 'seguidores' | 'bits' | 'raids' | 'puntos'
  enabled: boolean;
  style: GoalStyle;
  /** Ajustes del diseño personalizado; solo se usan con style 'custom'. */
  custom?: GoalCustom;
  /** Color de avance, en todos los diseños. */
  accentColor: string;
  showPercentage: boolean;
  showNumbers: boolean;
  celebrateOnComplete: boolean;
  // Acciones al alcanzar el 100% de la meta
  victorySoundType: AlertSoundType;
  victoryCustomAudioUrl?: string;
  victoryCustomAudioName?: string;
  victoryCustomAudioVolume?: number;
  victoryVideoUrl?: string; // Video transparente de victoria (.webm con alfa o .mp4)
  victoryVideoName?: string;
  victoryBlendMode?: 'transparent' | 'screen' | 'chroma-green';
  victoryScreenShake?: boolean;
  confetti?: boolean;
  autoResetOnComplete?: boolean;
}

export interface GoalsSettings {
  channel: string;
  activeGoalId: string;
  displayMode: GoalsDisplayMode;
  slideshowIntervalSec: number; // Duración por diapositiva en segundos (def: 8s)
  position: GoalsPosition;       // Punto de la pantalla; la Cinta ocupa el borde entero
  announceProgress: boolean;     // Locución TTS / sonido al sumar progreso
  announceMilestones: boolean;   // Locución TTS al cruzar hitos (25%, 50%, 75%, 100%)
  announceTtsVoice?: string;
  announceTtsVolume?: number;
  goals: CommunityGoalItem[];
}

export const DEFAULT_GOALS: CommunityGoalItem[] = [
  {
    id: 'goal-subs',
    type: 'subs',
    title: 'Meta de Suscriptores: ¡Cosplay Especial!',
    current: 18,
    target: 25,
    unit: 'subs',
    enabled: true,
    style: 'barra',
    accentColor: '#9146ff',
    showPercentage: true,
    showNumbers: true,
    celebrateOnComplete: true,
    victorySoundType: 'retro-fanfare',
    victoryScreenShake: true,
    confetti: true,
  },
  {
    id: 'goal-followers',
    type: 'followers',
    title: 'Meta de Seguidores: ¡Directo de 12 Horas!',
    current: 340,
    target: 500,
    unit: 'seguidores',
    enabled: true,
    style: 'barra',
    accentColor: '#00f5ff',
    showPercentage: true,
    showNumbers: true,
    celebrateOnComplete: true,
    victorySoundType: 'arcade-chime',
    victoryScreenShake: false,
    confetti: true,
  },
  {
    id: 'goal-bits',
    type: 'bits',
    title: 'Meta de Bits: ¡Micrófono Shure SM7B!',
    current: 4500,
    target: 10000,
    unit: 'bits',
    enabled: true,
    style: 'barra',
    accentColor: '#ffd700',
    showPercentage: true,
    showNumbers: true,
    celebrateOnComplete: true,
    victorySoundType: 'retro-fanfare',
    victoryScreenShake: true,
    confetti: true,
  },
  {
    id: 'goal-raids',
    type: 'raids',
    title: 'Meta de Raids: ¡Sorteo Teclado Mecánico!',
    current: 7,
    target: 10,
    unit: 'raids',
    enabled: true,
    style: 'barra',
    accentColor: '#ff0055',
    showPercentage: true,
    showNumbers: true,
    celebrateOnComplete: true,
    victorySoundType: 'retro-fanfare',
    victoryScreenShake: true,
    confetti: true,
  },
  {
    id: 'goal-donations',
    type: 'donations',
    title: 'Hype Nocturno: ¡Almuerzo para el Stream!',
    current: 65,
    target: 100,
    unit: 'puntos',
    enabled: true,
    style: 'barra',
    accentColor: '#00ff88',
    showPercentage: true,
    showNumbers: true,
    celebrateOnComplete: true,
    victorySoundType: 'arcade-chime',
    victoryScreenShake: false,
    confetti: true,
  },
];

export const DEFAULT_GOALS_SETTINGS: GoalsSettings = {
  channel: 'laloplay_',
  activeGoalId: 'goal-subs',
  displayMode: 'auto_4_or_slideshow',
  slideshowIntervalSec: 8,
  position: DEFAULT_GOALS_POSITION,
  announceProgress: true,
  announceMilestones: true,
  announceTtsVoice: 'es-MX-Standard-A',
  announceTtsVolume: 0.85,
  goals: DEFAULT_GOALS,
};

export const GOALS_STORAGE_KEY = 'lalo_goals_settings';

export function calculateGoalProgress(current: number, target: number): number {
  if (target <= 0) return 0;
  const pct = (current / target) * 100;
  return Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
}

/**
 * Determina si la vista debe renderizarse como Slideshow o como fila en base a las metas activas y el modo.
 * Regla: en 'auto_4_or_slideshow', si hay 5 o más metas habilitadas, pasa automáticamente a slideshow.
 */
export function shouldDisplayAsSlideshow(
  enabledGoalsCount: number,
  mode: GoalsDisplayMode
): boolean {
  if (mode === 'slideshow_only') return enabledGoalsCount > 1;
  if (mode === 'row_only') return false;
  if (mode === 'single_active') return false;
  if (mode === 'reactive_progress') return false;
  // 'auto_4_or_slideshow'
  return enabledGoalsCount >= 5;
}

/**
 * Detecta si un incremento cruza algún hito importante (25%, 50%, 75%, 100%).
 */
export function checkMilestoneCrossed(
  prevCurrent: number,
  newCurrent: number,
  target: number
): 25 | 50 | 75 | 100 | null {
  if (target <= 0 || newCurrent <= prevCurrent) return null;
  const prevPct = (prevCurrent / target) * 100;
  const newPct = (newCurrent / target) * 100;

  if (prevPct < 100 && newPct >= 100) return 100;
  if (prevPct < 75 && newPct >= 75) return 75;
  if (prevPct < 50 && newPct >= 50) return 50;
  if (prevPct < 25 && newPct >= 25) return 25;
  return null;
}

/**
 * Genera el guion de anuncio TTS para hitos alcanzados.
 */
export function formatMilestoneAnnouncement(title: string, milestone: 25 | 50 | 75 | 100): string {
  switch (milestone) {
    case 25:
      return `¡Atención comunidad! La meta «${title}» ha alcanzado el 25 por ciento. ¡Excelente inicio!`;
    case 50:
      return `¡Mitad de camino superada! La meta «${title}» ya se encuentra al 50 por ciento.`;
    case 75:
      return `¡Ya casi lo logramos! La meta «${title}» alcanzó el 75 por ciento. ¡Último empujón!`;
    case 100:
      return `¡Felicidades comunidad! La meta «${title}» ha llegado al 100 por ciento. ¡Meta cumplida con éxito!`;
  }
}

/**
 * Genera el guion de anuncio TTS para nuevo progreso.
 */
export function formatProgressAnnouncement(
  title: string,
  delta: number,
  unit: string,
  current: number,
  target: number,
  pct: number,
  user?: string
): string {
  const who = user ? `${user} aportó` : 'Sumamos';
  return `¡Nuevo avance en la meta «${title}»! ${who} +${delta} ${unit}. Progreso actual: ${current} de ${target}, ${pct} por ciento completado.`;
}

export function loadGoalsSettings(): GoalsSettings {
  try {
    const raw = localStorage.getItem(GOALS_STORAGE_KEY);
    if (!raw) return DEFAULT_GOALS_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_GOALS_SETTINGS,
      ...parsed,
      displayMode: parsed.displayMode || DEFAULT_GOALS_SETTINGS.displayMode,
      slideshowIntervalSec: parsed.slideshowIntervalSec || DEFAULT_GOALS_SETTINGS.slideshowIntervalSec,
      announceProgress: parsed.announceProgress !== undefined ? Boolean(parsed.announceProgress) : DEFAULT_GOALS_SETTINGS.announceProgress,
      announceMilestones: parsed.announceMilestones !== undefined ? Boolean(parsed.announceMilestones) : DEFAULT_GOALS_SETTINGS.announceMilestones,
      position: normalizeGoalsPosition(parsed.position),
      // Las metas guardadas con un estilo antiguo pasan a Barra con su color
      goals:
        Array.isArray(parsed.goals) && parsed.goals.length > 0
          ? (parsed.goals as CommunityGoalItem[]).map((goal) => migrateGoalItem(goal))
          : DEFAULT_GOALS,
      activeGoalId: parsed.activeGoalId || DEFAULT_GOALS_SETTINGS.activeGoalId,
    };
  } catch {
    return DEFAULT_GOALS_SETTINGS;
  }
}

export function saveGoalsSettings(settings: GoalsSettings): void {
  try {
    localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(settings));
    queueCloudPush('goals', settings);
  } catch (err) {
    console.error('Error guardando configuración de metas:', err);
  }
}
