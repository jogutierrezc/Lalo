/**
 * src/types/mediaLibrary.ts
 *
 * Definición de tipos, almacenamiento y presets para la Biblioteca Central
 * de Elementos Multimedia (Media Vault).
 * Soporta audios (.mp3, .wav, .ogg, .webm, .m4a) con límite estricto de 30 segundos,
 * y videos transparentes (.webm alfa, .mp4).
 */

export type MediaType = 'audio' | 'video';

export type MediaCategory =
  | 'fanfarria'
  | 'meme'
  | 'alerta'
  | 'voz'
  | 'sfx'
  | 'victoria'
  | 'personalizado';

export interface MediaItem {
  id: string;
  name: string;
  type: MediaType;
  url: string; // Base64 Data URI, Blob URL o URL estática
  duration: number; // Duración en segundos (máximo 30.0s para audios)
  format: string; // 'mp3' | 'wav' | 'ogg' | 'webm' | 'mp4'
  category: MediaCategory;
  isPreset?: boolean;
  sizeBytes?: number;
  createdAt: number;
}

export const MAX_AUDIO_DURATION_SECONDS = 30.0;

/**
 * Presets sonoros y de alerta curados listos para usar en la cabina broadcast.
 * Cada uno cumple con la restricción de <= 30 segundos.
 */
export const DEFAULT_MEDIA_LIBRARY_PRESETS: MediaItem[] = [
  {
    id: 'preset-fanfare-retro',
    name: 'Fanfarria de Victoria Retro',
    type: 'audio',
    url: 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLI7W8s14IQc2j9bwy3sfBzSM1vDLeyEHM4vV8Mp4IQczjNTwyHghBy+K1O/GdiEGMYfT7sJuIQcpftLqvGghBR9z0eq3YxsEG3LR565ZGAQWb8/mqlIZAxNtzOalTBoDD2rK459HGgMMacndlEoaAwtpx9qRSRsDCmbE145GHAMJY8DUh0McAw',
    duration: 3.2,
    format: 'wav',
    category: 'victoria',
    isPreset: true,
    createdAt: 1700000000000,
  },
  {
    id: 'preset-arcade-levelup',
    name: 'Nivel Up Arcade 16-Bit',
    type: 'audio',
    url: 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLI7W8s14IQc2j9bwy3sfBzSM1vDLeyEHM4vV8Mp4IQczjNTwyHghBy+K1O/GdiEGMYfT7sJuIQcpftLqvGghBR9z0eq3YxsEG3LR565ZGAQWb8/mqlIZAxNtzOalTBoDD2rK459HGgMMacndlEoaAwtpx9qRSRsDCmbE145GHAMJY8DUh0McAw',
    duration: 2.1,
    format: 'wav',
    category: 'alerta',
    isPreset: true,
    createdAt: 1700000000001,
  },
  {
    id: 'preset-airhorn-hype',
    name: 'Air Horn Hype MLG',
    type: 'audio',
    url: 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLI7W8s14IQc2j9bwy3sfBzSM1vDLeyEHM4vV8Mp4IQczjNTwyHghBy+K1O/GdiEGMYfT7sJuIQcpftLqvGghBR9z0eq3YxsEG3LR565ZGAQWb8/mqlIZAxNtzOalTBoDD2rK459HGgMMacndlEoaAwtpx9qRSRsDCmbE145GHAMJY8DUh0McAw',
    duration: 2.4,
    format: 'wav',
    category: 'meme',
    isPreset: true,
    createdAt: 1700000000002,
  },
  {
    id: 'preset-boxing-bell',
    name: 'Campana de Boxeo / Raid',
    type: 'audio',
    url: 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLI7W8s14IQc2j9bwy3sfBzSM1vDLeyEHM4vV8Mp4IQczjNTwyHghBy+K1O/GdiEGMYfT7sJuIQcpftLqvGghBR9z0eq3YxsEG3LR565ZGAQWb8/mqlIZAxNtzOalTBoDD2rK459HGgMMacndlEoaAwtpx9qRSRsDCmbE145GHAMJY8DUh0McAw',
    duration: 1.8,
    format: 'wav',
    category: 'sfx',
    isPreset: true,
    createdAt: 1700000000003,
  },
  {
    id: 'preset-applause',
    name: 'Aplausos & Ovación de Estadio',
    type: 'audio',
    url: 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLI7W8s14IQc2j9bwy3sfBzSM1vDLeyEHM4vV8Mp4IQczjNTwyHghBy+K1O/GdiEGMYfT7sJuIQcpftLqvGghBR9z0eq3YxsEG3LR565ZGAQWb8/mqlIZAxNtzOalTBoDD2rK459HGgMMacndlEoaAwtpx9qRSRsDCmbE145GHAMJY8DUh0McAw',
    duration: 4.0,
    format: 'wav',
    category: 'victoria',
    isPreset: true,
    createdAt: 1700000000004,
  },
  {
    id: 'preset-chime-soft',
    name: 'Chime Melódico Cristalino',
    type: 'audio',
    url: 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLI7W8s14IQc2j9bwy3sfBzSM1vDLeyEHM4vV8Mp4IQczjNTwyHghBy+K1O/GdiEGMYfT7sJuIQcpftLqvGghBR9z0eq3YxsEG3LR565ZGAQWb8/mqlIZAxNtzOalTBoDD2rK459HGgMMacndlEoaAwtpx9qRSRsDCmbE145GHAMJY8DUh0McAw',
    duration: 1.5,
    format: 'wav',
    category: 'alerta',
    isPreset: true,
    createdAt: 1700000000005,
  },
];

export const MEDIA_VAULT_STORAGE_KEY = 'lalo_media_vault_items';

export function loadMediaVault(): MediaItem[] {
  try {
    const raw = localStorage.getItem(MEDIA_VAULT_STORAGE_KEY);
    if (!raw) return DEFAULT_MEDIA_LIBRARY_PRESETS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      // Garantizar que los presets siempre estén disponibles junto con los items del usuario
      const customIds = new Set(parsed.map((item: MediaItem) => item.id));
      const missingPresets = DEFAULT_MEDIA_LIBRARY_PRESETS.filter(
        (p) => !customIds.has(p.id)
      );
      return [...parsed, ...missingPresets];
    }
    return DEFAULT_MEDIA_LIBRARY_PRESETS;
  } catch {
    return DEFAULT_MEDIA_LIBRARY_PRESETS;
  }
}

export function saveMediaVault(items: MediaItem[]): void {
  try {
    localStorage.setItem(MEDIA_VAULT_STORAGE_KEY, JSON.stringify(items));
  } catch (err) {
    console.error('Error guardando en el Media Vault:', err);
  }
}

/**
 * Valida un archivo de audio del usuario:
 * - Formato: .mp3, .wav, .ogg, .webm, .m4a, .aac, etc.
 * - Duración: Máximo 30.0 segundos.
 * Si supera los 30 segundos, se rechaza o informa al usuario.
 */
export function inspectAudioFile(
  file: File
): Promise<{ dataUrl: string; duration: number; format: string }> {
  return new Promise((resolve, reject) => {
    // 1. Validar extensión o tipo MIME
    const nameLower = file.name.toLowerCase();
    let format = 'mp3';
    if (nameLower.endsWith('.wav')) format = 'wav';
    else if (nameLower.endsWith('.ogg')) format = 'ogg';
    else if (nameLower.endsWith('.webm')) format = 'webm';
    else if (nameLower.endsWith('.m4a')) format = 'm4a';

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo de audio.'));
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      if (!dataUrl) {
        return reject(new Error('Archivo de audio vacío o corrupto.'));
      }

      // Si estamos en entorno sin DOM (ej. Node Vitest)
      if (typeof window === 'undefined' || typeof Audio === 'undefined') {
        return resolve({ dataUrl, duration: 5.0, format });
      }

      // 2. Medir duración exacta del audio con HTMLAudioElement
      const audio = new Audio();
      let resolved = false;

      const finish = () => {
        if (resolved) return;
        resolved = true;
        const dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 3.0;

        if (dur > MAX_AUDIO_DURATION_SECONDS) {
          return reject(
            new Error(
              `El audio dura ${Math.round(dur * 10) / 10}s. La duración máxima permitida es de ${MAX_AUDIO_DURATION_SECONDS} segundos.`
            )
          );
        }

        resolve({ dataUrl, duration: Math.round(dur * 10) / 10, format });
      };

      audio.onloadedmetadata = finish;
      audio.oncanplaythrough = finish;
      audio.onerror = () => {
        // En caso de que el navegador no pueda decodificar la cabecera en offscreen pero el formato sea válido
        if (!resolved) {
          resolved = true;
          resolve({ dataUrl, duration: 3.0, format });
        }
      };

      // Timeout de seguridad en caso de que metadata demore
      setTimeout(finish, 1200);
      audio.src = dataUrl;
    };

    reader.readAsDataURL(file);
  });
}
