/**
 * src/types/polls.ts
 *
 * Definiciones de datos y modelos para el Módulo 7: Batallas & Encuestas en Vivo (Polls & Versus Studio).
 * Diseñado bajo directivas de Impeccable (jerarquía visual, estética broadcast) y GSAP.
 */

import { queueCloudPush } from '../lib/cloudConfig';

export type PollLayoutMode = '1v1_battle' | 'multi_choice';
export type PollStyleTheme = 'cabina' | 'neon' | 'esports' | 'cyber' | 'minimal';

export interface PollThemeDefinition {
  id: PollStyleTheme;
  name: string;
  description: string;
  badge: string;
  accent: string;
  previewBg: string;
}

export const POLL_THEMES: PollThemeDefinition[] = [
  {
    id: 'cabina',
    name: 'Cabina',
    description: 'Placa gris mate, esquinas casi rectas y letra condensada en mayúsculas.',
    badge: 'Mate',
    accent: '#00e5ff',
    previewBg: 'from-slate-900 to-slate-950',
  },
  {
    id: 'neon',
    name: 'Neón',
    description: 'Fondo casi negro, borde morado y esquinas redondeadas.',
    badge: 'Redondeado',
    accent: '#ff007f',
    previewBg: 'from-fuchsia-950/60 to-purple-950/80',
  },
  {
    id: 'esports',
    name: 'Esports',
    description: 'Fondo azul noche y letra muy condensada en mayúsculas.',
    badge: 'Condensado',
    accent: '#ffd700',
    previewBg: 'from-cyan-950/50 to-rose-950/60',
  },
  {
    id: 'cyber',
    name: 'Cyber',
    description: 'Esquinas rectas y letra monoespaciada sobre fondo azul oscuro.',
    badge: 'Monoespaciado',
    accent: '#00ff66',
    previewBg: 'from-emerald-950/40 to-slate-950',
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Fondo oscuro translúcido sin borde, esquinas muy redondeadas y texto sin mayúsculas.',
    badge: 'Sin borde',
    accent: '#38bdf8',
    previewBg: 'from-slate-900/60 to-slate-950/80',
  },
];

export interface PollOption {
  id: string;
  label: string;
  sublabel?: string;
  color: string;
  accentGlow: string;
  votes: number;
}

export interface PollBattlePreset {
  id: string;
  title: string;
  category: 'gamer' | 'castigos' | 'irl' | 'show';
  optionA: { label: string; sublabel?: string; color: string };
  optionB: { label: string; sublabel?: string; color: string };
  durationSec: number;
}

export interface TtsEmotionConfig {
  enabled: boolean;
  leadChangeText: string;
  leadChangeEmotion: string; // e.g. '[emocionado]'
  countdownText: string;
  countdownEmotion: string;  // e.g. '[susurro]'
  winnerAnnouncementText: string;
  winnerEmotion: string;     // e.g. '[triunfal]'
  tieText: string;
  tieEmotion: string;        // e.g. '[tenso]'
}

export interface PollSettings {
  channel: string;
  activeBattleTitle: string;
  theme: PollStyleTheme;
  layout: PollLayoutMode;
  durationSec: number;
  options: [PollOption, PollOption];
  audioEffectsEnabled: boolean;
  audioVolume: number;
  screenShakeEnabled: boolean;
  confettiEnabled: boolean;
  ttsAnnouncer: TtsEmotionConfig;
  allowVoteChange: boolean;
}

export const DEFAULT_BATTLE_PRESETS: PollBattlePreset[] = [
  {
    id: 'preset-gamer',
    title: '🎮 ¿Qué jugamos en el próximo bloque?',
    category: 'gamer',
    optionA: { label: 'VALORANT COMPETITIVO', sublabel: '!voto 1 · Ranked Tryhard', color: '#00e5ff' },
    optionB: { label: 'GTA RP / HISTORIA', sublabel: '!voto 2 · Rol & Risas', color: '#ff0055' },
    durationSec: 60,
  },
  {
    id: 'preset-castigos',
    title: '🌶️ Penitencia Inmediata del Chat',
    category: 'castigos',
    optionA: { label: '50 FLEXIONES EN VIVO', sublabel: '!voto 1 · Fitness Extremo', color: '#10b981' },
    optionB: { label: 'SHOT DE SALSA PICANTE', sublabel: '!voto 2 · Fuego Puro', color: '#f59e0b' },
    durationSec: 45,
  },
  {
    id: 'preset-comida',
    title: '🍕 Cena Nocturna del Streamer',
    category: 'irl',
    optionA: { label: 'PIZZA ARTESANAL 4 QUESOS', sublabel: '!voto 1 · Clásica & Confort', color: '#38bdf8' },
    optionB: { label: 'SUSHI ROLLS & GYOSAS', sublabel: '!voto 2 · Gourmet Asiático', color: '#ec4899' },
    durationSec: 60,
  },
  {
    id: 'preset-juicio',
    title: '💀 Juicio Final: ¿Salvar o Sacrificar?',
    category: 'show',
    optionA: { label: '¡SALVAR AL STREAMER!', sublabel: '!voto 1 · Piedad del chat', color: '#22c55e' },
    optionB: { label: '¡SACRIFICAR SIN PIEDAD!', sublabel: '!voto 2 · Caos & Destrucción', color: '#ef4444' },
    durationSec: 30,
  },
];

export const INITIAL_POLL_SETTINGS: PollSettings = {
  channel: 'tu_canal',
  activeBattleTitle: '🎮 ¿A QUÉ JUGAMOS EL PRÓXIMO BLOQUE?',
  theme: 'esports',
  layout: '1v1_battle',
  durationSec: 60,
  audioEffectsEnabled: true,
  audioVolume: 0.85,
  screenShakeEnabled: true,
  confettiEnabled: true,
  allowVoteChange: true,
  options: [
    {
      id: 'opt-a',
      label: 'VALORANT COMPETITIVO',
      sublabel: '!voto 1 · Ranked Tryhard',
      color: '#00e5ff',
      accentGlow: 'rgba(0, 229, 255, 0.45)',
      votes: 14,
    },
    {
      id: 'opt-b',
      label: 'GTA RP / HISTORIA',
      sublabel: '!voto 2 · Rol & Risas',
      color: '#ff0055',
      accentGlow: 'rgba(255, 0, 85, 0.45)',
      votes: 11,
    },
  ],
  ttsAnnouncer: {
    enabled: true,
    leadChangeText: '[emocionado] ¡Atención! {ganador} ha tomado la delantera en la votación!',
    leadChangeEmotion: '[emocionado]',
    countdownText: '[susurro] Quedan solo 10 segundos, ¡emitan sus votos en el chat!',
    countdownEmotion: '[susurro]',
    winnerAnnouncementText: '[triunfal] ¡Tiempo finalizado! La opción ganadora indiscutible es {ganador} con {porcentaje} por ciento de los votos.',
    winnerEmotion: '[triunfal]',
    tieText: '[tenso] ¡Empate dramático! Ambas opciones están igualadas a segundos del final.',
    tieEmotion: '[tenso]',
  },
};

export const POLLS_STORAGE_KEY = 'lalo_polls_settings_v1';

/**
 * Parsea un mensaje de chat para extraer el voto del usuario de forma simple o explícita.
 * Acepta: 1, 2, 111, 222, a, b, !1, !2, !a, !b, #1, #2, !voto 1, !voto 2, voto 1, voto 2, !vote 1, etc.
 * Devuelve 0 para la opción 1 (A), 1 para la opción 2 (B), o null si no es un voto válido.
 */
export function parseVoteCommand(message: string): 0 | 1 | null {
  if (!message) return null;
  const trimmed = message.trim().toLowerCase();

  // 1. Sintaxis explícita con prefijo !voto, !vote, voto o vote (ej: !voto 1, !vote 2, voto a, vote b)
  const explicitMatch = trimmed.match(/^!?(?:voto|vote)\s*[:=]?\s*([12ab])$/i);
  if (explicitMatch) {
    const val = explicitMatch[1].toLowerCase();
    if (val === '1' || val === 'a') return 0;
    if (val === '2' || val === 'b') return 1;
  }

  // 2. Sintaxis abreviada con exclamación o hashtag (!1, !2, !a, !b, #1, #2, #a, #b)
  if (/^[!#][1a]$/i.test(trimmed)) return 0;
  if (/^[!#][2b]$/i.test(trimmed)) return 1;

  // 3. Voto simple de un solo carácter o repetición del mismo dígito/letra ("1", "2", "111", "222", "a", "b", "aaa", "bbb")
  if (/^1+$/i.test(trimmed) || /^a+$/i.test(trimmed)) return 0;
  if (/^2+$/i.test(trimmed) || /^b+$/i.test(trimmed)) return 1;

  return null;
}

/**
 * Calcula los porcentajes exactos redondeados garantizando que la suma sea siempre 100%.
 */
export function calculatePollPercentages(votesA: number, votesB: number): { pctA: number; pctB: number } {
  const safeA = Math.max(0, votesA);
  const safeB = Math.max(0, votesB);
  const total = safeA + safeB;

  if (total === 0) {
    return { pctA: 50, pctB: 50 };
  }

  const rawA = Math.round((safeA / total) * 100);
  const rawB = 100 - rawA;
  return { pctA: rawA, pctB: rawB };
}

/**
 * Determina el líder o si hay empate.
 */
export function determineLeader(votesA: number, votesB: number): 'A' | 'B' | 'TIE' {
  if (votesA > votesB) return 'A';
  if (votesB > votesA) return 'B';
  return 'TIE';
}

/**
 * Carga la configuración de encuestas desde localStorage con respaldo seguro.
 */
export function loadPollSettings(): PollSettings {
  if (typeof window === 'undefined') return INITIAL_POLL_SETTINGS;
  try {
    const raw = localStorage.getItem(POLLS_STORAGE_KEY);
    if (!raw) return INITIAL_POLL_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      ...INITIAL_POLL_SETTINGS,
      ...parsed,
      options: [
        { ...INITIAL_POLL_SETTINGS.options[0], ...(parsed.options?.[0] || {}) },
        { ...INITIAL_POLL_SETTINGS.options[1], ...(parsed.options?.[1] || {}) },
      ],
      ttsAnnouncer: {
        ...INITIAL_POLL_SETTINGS.ttsAnnouncer,
        ...(parsed.ttsAnnouncer || {}),
      },
    };
  } catch {
    return INITIAL_POLL_SETTINGS;
  }
}

/**
 * Guarda la configuración de encuestas en localStorage.
 */
export function savePollSettings(settings: PollSettings): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(POLLS_STORAGE_KEY, JSON.stringify(settings));
    queueCloudPush('polls', settings);
  } catch {
    // Ignorar si el almacenamiento está restringido
  }
}

