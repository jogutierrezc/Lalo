import { Appearance, DEFAULT_APPEARANCE, normalizeAppearance } from '../utils/appearance';
import { queueCloudPush } from '../lib/cloudConfig';
import { DEFAULT_MODERATION, Moderation, normalizeModeration } from '../utils/moderation';
import { DEFAULT_PRE_SOUND, PreSoundSettings, normalizePreSound } from '../utils/preSound';

export interface TTSSettings extends Appearance, Moderation {
  channel: string;
  model: string;
  referenceId: string;
  volume: number; // 0 to 1
  speed: number; // 0.75 a 1.5
  theme: 'glass-dark' | 'neon-purple' | 'cyberpunk';
  enableVisualizer: boolean;
  announceSender: boolean;
  announceTemplate: string;
  /** Sonido que suena justo antes de que la voz lea un mensaje. */
  preSound: PreSoundSettings;
}

export const SPEED_MIN = 0.75;
export const SPEED_MAX = 1.5;

export interface PresetVoice {
  id: string;
  name: string;
  /** Cómo suena, en pocas palabras. Se enseña donde se elige la voz. */
  description: string;
}

// Los nombres son genéricos a propósito (ver src/legal/voces.ts). El id es el de
// la voz en el proveedor y no cambia: los ajustes guardados siguen valiendo.
export const PRESET_VOICES: PresetVoice[] = [
  { id: '5669f8e58ecb476a982bc2b67ac6b538', name: 'Chispa', description: 'Aguda y traviesa. La voz por defecto y la del narrador.' },
  { id: '31dbd39039854d379d1d692a6a97451d', name: 'Seda', description: 'Suave y cercana.' },
  { id: '59fb1f7a5e69481387cc280b9d2b3ad8', name: 'Atlas', description: 'Formal y serena, de asistente.' },
  { id: '37f9f4eec7624089a49b188d47588f2c', name: 'Vera', description: 'Firme y pausada.' },
  { id: '654e33e85be3406d90b9723712a035a9', name: 'Brisa', description: 'Joven y alegre.' },
];

export const DEFAULT_SETTINGS: TTSSettings = {
  channel: 'laloplay_',
  model: 's2.1-pro-free',
  referenceId: '5669f8e58ecb476a982bc2b67ac6b538', // Chispa (por defecto en cuentas nuevas)
  volume: 0.85,
  speed: 1.0,
  theme: 'glass-dark',
  enableVisualizer: true,
  announceSender: true,
  announceTemplate: '{user} dice: {message}',
  preSound: DEFAULT_PRE_SOUND,
  ...DEFAULT_APPEARANCE,
  ...DEFAULT_MODERATION,
};

export const STORAGE_KEY = 'lalo_tts_settings';

const numberIn = (value: unknown, min: number, max: number, fallback: number) => {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/**
 * Ajustes completos y válidos a partir de lo guardado, lo que llega de la nube
 * o lo que envía el panel. Lo que falta o no vale queda en su valor por defecto.
 */
export function normalizeSettings(raw: unknown): TTSSettings {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const parsed = { ...DEFAULT_SETTINGS, ...source } as TTSSettings;

  // Migración automática de valores antiguos almacenados en caché de OBS
  if (parsed.referenceId === '7f92f8afb8ec43bf81429cc1c9199cb1' || !parsed.referenceId) {
    parsed.referenceId = '37f9f4eec7624089a49b188d47588f2c';
  }
  if (parsed.model === 's2.1-pro' || !parsed.model) {
    parsed.model = 's2.1-pro-free';
  }
  // Lo guardado puede venir de una versión anterior o estar manipulado
  return {
    ...parsed,
    volume: numberIn(parsed.volume, 0, 1, DEFAULT_SETTINGS.volume),
    speed: numberIn(parsed.speed, SPEED_MIN, SPEED_MAX, DEFAULT_SETTINGS.speed),
    announceSender: parsed.announceSender !== false,
    announceTemplate: typeof parsed.announceTemplate === 'string' ? parsed.announceTemplate : DEFAULT_SETTINGS.announceTemplate,
    preSound: normalizePreSound(parsed.preSound),
    ...normalizeAppearance(parsed),
    ...normalizeModeration(parsed),
  };
}

export function loadSettings(): TTSSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: TTSSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    queueCloudPush('tts', settings);
  } catch (e) {
    console.error('Error saving settings to localStorage:', e);
  }
}
