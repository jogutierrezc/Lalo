/**
 * src/types/twitchio.ts
 *
 * Definición de tipos y almacenamiento para la integración con TwitchIO
 * (https://github.com/TwitchIO/TwitchIO) por PythonistaGuild & EvieePy.
 * Licencia: MIT.
 */

export type CommandPermission = 'all' | 'sub' | 'mod' | 'broadcaster';

export interface TwitchIOCommand {
  id: string;
  name: string; // ej: "tts", "alerta", "redes"
  response: string;
  permission: CommandPermission;
  cooldown: number; // segundos
  enabled: boolean;
  category?: 'stream' | 'social' | 'fun' | 'tts';
}

export interface TwitchIOEventSubConfig {
  follows: boolean;
  subs: boolean;
  bits: boolean;
  raids: boolean;
  channelPoints: boolean;
}

export interface TwitchIOSettings {
  channel: string;
  botUsername: string;
  prefix: string;
  autoConnect: boolean;
  welcomeMessage: string;
  commands: TwitchIOCommand[];
  eventsub: TwitchIOEventSubConfig;
}

export const DEFAULT_TWITCHIO_COMMANDS: TwitchIOCommand[] = [
  {
    id: 'cmd-1',
    name: 's',
    response: '[TTS] Mensaje recibido y encolado para lectura por voz.',
    permission: 'all',
    cooldown: 5,
    enabled: true,
    category: 'tts',
  },
  {
    id: 'cmd-2',
    name: 'alerta',
    response: '¡Alerta en pantalla activada desde el chat por {user}!',
    permission: 'all',
    cooldown: 10,
    enabled: true,
    category: 'stream',
  },
  {
    id: 'cmd-3',
    name: 'lalo',
    response: 'Lalo Stream Suite: TTS con voces clonadas por IA + Alertas de cabina. ¡Todo en vivo!',
    permission: 'all',
    cooldown: 15,
    enabled: true,
    category: 'stream',
  },
  {
    id: 'cmd-4',
    name: 'redes',
    response: 'Síguenos en nuestras redes: twitch.tv/{channel} y disfruta del stream.',
    permission: 'all',
    cooldown: 15,
    enabled: true,
    category: 'social',
  },
  {
    id: 'cmd-5',
    name: 'reload',
    response: 'Overlay de OBS recargado exitosamente por moderación.',
    permission: 'mod',
    cooldown: 20,
    enabled: true,
    category: 'stream',
  },
];

export const DEFAULT_TWITCHIO_SETTINGS: TwitchIOSettings = {
  channel: 'laloplay_',
  botUsername: 'LaloBot',
  prefix: '!',
  autoConnect: true,
  welcomeMessage: '¡LaloBot conectado a la cabina de {channel} (Powered by TwitchIO)!',
  commands: DEFAULT_TWITCHIO_COMMANDS,
  eventsub: {
    follows: true,
    subs: true,
    bits: true,
    raids: true,
    channelPoints: true,
  },
};

export const TWITCHIO_STORAGE_KEY = 'lalo_twitchio_settings';

export function loadTwitchIOSettings(): TwitchIOSettings {
  try {
    const raw = localStorage.getItem(TWITCHIO_STORAGE_KEY);
    if (!raw) return DEFAULT_TWITCHIO_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_TWITCHIO_SETTINGS,
      ...parsed,
      commands: Array.isArray(parsed.commands) ? parsed.commands : DEFAULT_TWITCHIO_COMMANDS,
      eventsub: {
        ...DEFAULT_TWITCHIO_SETTINGS.eventsub,
        ...(parsed.eventsub || {}),
      },
    };
  } catch {
    return DEFAULT_TWITCHIO_SETTINGS;
  }
}

export function saveTwitchIOSettings(settings: TwitchIOSettings): void {
  try {
    localStorage.setItem(TWITCHIO_STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Error guardando configuración de TwitchIO en localStorage:', e);
  }
}
