/**
 * tests/twitchio.test.ts
 *
 * Pruebas unitarias para la integración de TwitchIO en Lalo Stream Suite.
 * Framework: TwitchIO por PythonistaGuild & EvieePy (MIT License).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DEFAULT_TWITCHIO_SETTINGS,
  DEFAULT_TWITCHIO_COMMANDS,
  loadTwitchIOSettings,
  saveTwitchIOSettings,
  TWITCHIO_STORAGE_KEY,
  TwitchIOSettings,
} from '../src/types/twitchio';

const createStorageMock = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    clear: () => {
      store = {};
    },
    removeItem: (key: string) => {
      delete store[key];
    },
  };
};

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: createStorageMock(),
    writable: true,
  });
}

describe('TwitchIO Module (PythonistaGuild)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('TwitchIO Settings & Defaults', () => {
    it('debe tener una configuración por defecto con créditos y comandos base', () => {
      expect(DEFAULT_TWITCHIO_SETTINGS.prefix).toBe('!');
      expect(DEFAULT_TWITCHIO_SETTINGS.botUsername).toBe('LaloBot');
      expect(DEFAULT_TWITCHIO_SETTINGS.channel).toBe('laloplay_');

      // Comandos base configurados
      const cmdNames = DEFAULT_TWITCHIO_SETTINGS.commands.map((c) => c.name);
      expect(cmdNames).toContain('s');
      expect(cmdNames).toContain('alerta');
      expect(cmdNames).toContain('lalo');
      expect(cmdNames).toContain('reload');

      // EventSub subscriptions por defecto
      expect(DEFAULT_TWITCHIO_SETTINGS.eventsub.follows).toBe(true);
      expect(DEFAULT_TWITCHIO_SETTINGS.eventsub.subs).toBe(true);
      expect(DEFAULT_TWITCHIO_SETTINGS.eventsub.bits).toBe(true);
    });

    it('guarda y recupera la configuración de comandos en localStorage', () => {
      const custom: TwitchIOSettings = {
        ...DEFAULT_TWITCHIO_SETTINGS,
        channel: 'streamer_pro',
        prefix: '?',
        botUsername: 'CustomBot',
        commands: [
          ...DEFAULT_TWITCHIO_COMMANDS,
          {
            id: 'custom-1',
            name: 'discord',
            response: 'Únete a nuestro Discord: discord.gg/ejemplo',
            permission: 'all',
            cooldown: 10,
            enabled: true,
          },
        ],
      };

      saveTwitchIOSettings(custom);
      const loaded = loadTwitchIOSettings();

      expect(loaded.channel).toBe('streamer_pro');
      expect(loaded.prefix).toBe('?');
      expect(loaded.botUsername).toBe('CustomBot');
      expect(loaded.commands.some((c) => c.name === 'discord')).toBe(true);
    });

    it('devuelve DEFAULT_TWITCHIO_SETTINGS si el almacenamiento está dañado', () => {
      localStorage.setItem(TWITCHIO_STORAGE_KEY, 'corrupt{{{');
      const loaded = loadTwitchIOSettings();
      expect(loaded.prefix).toBe('!');
      expect(loaded.botUsername).toBe('LaloBot');
    });
  });
});
