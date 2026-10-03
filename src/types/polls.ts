/**
 * src/types/polls.ts
 *
 * Definiciones de datos y modelos para el Módulo 7: Batallas & Encuestas en Vivo (Polls & Versus Studio).
 * Diseñado bajo directivas de Impeccable (jerarquía visual, estética broadcast) y GSAP.
 */

export type PollLayoutMode = '1v1_battle' | 'multi_choice';
export type PollStyleTheme = 'cabina' | 'neon' | 'esports' | 'cyber';

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
