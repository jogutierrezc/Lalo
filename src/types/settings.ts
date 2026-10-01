export interface TTSSettings {
  channel: string;
  model: string;
  referenceId: string;
  volume: number; // 0 to 1
  speed: number;  // 0.5 to 2.0
  theme: 'glass-dark' | 'neon-purple' | 'cyberpunk';
  enableVisualizer: boolean;
  maxQueueSize: number;
  announceSender: boolean;
  announceTemplate: string;
}

export const DEFAULT_SETTINGS: TTSSettings = {
  channel: 'laloplay_',
  model: 's2.1-pro-free',
  referenceId: '37f9f4eec7624089a49b188d47588f2c', // Voz oficial clonada de LaloPlay
  volume: 0.85,
  speed: 1.0,
  theme: 'glass-dark',
  enableVisualizer: true,
  maxQueueSize: 20,
  announceSender: true,
  announceTemplate: '{user} dice: {message}',
};

export const STORAGE_KEY = 'lalo_tts_settings';

export function loadSettings(): TTSSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };

    // Migración automática de valores antiguos almacenados en caché de OBS
    if (parsed.referenceId === '7f92f8afb8ec43bf81429cc1c9199cb1' || !parsed.referenceId) {
      parsed.referenceId = '37f9f4eec7624089a49b188d47588f2c';
    }
    if (parsed.model === 's2.1-pro' || !parsed.model) {
      parsed.model = 's2.1-pro-free';
    }
    return parsed;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: TTSSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Error saving settings to localStorage:', e);
  }
}
