/**
 * tests/polls.test.ts
 *
 * Suite de pruebas unitarias para el Módulo 7: Batallas & Encuestas Cinemáticas en Vivo.
 * Valida el parser de comandos de voto del chat, cálculo porcentual exacto,
 * detección de liderazgo y persistencia de configuración.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseVoteCommand,
  calculatePollPercentages,
  determineLeader,
  loadPollSettings,
  savePollSettings,
  INITIAL_POLL_SETTINGS,
  DEFAULT_BATTLE_PRESETS,
  POLL_THEMES,
} from '../src/types/polls';
import { parsePollCommand, clampPollDuration } from '../src/utils/pollCommands';
import { buildModPollAnnouncementText } from '../src/utils/pollsAudio';

// Mock de localStorage para el entorno de test en Node/Vitest
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

const storageMock = createStorageMock();

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: storageMock,
    writable: true,
  });
}

if (typeof (globalThis as unknown as { window?: { localStorage: unknown } }).window === 'undefined') {
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage: storageMock },
    writable: true,
  });
}

describe('Polls & Versus Studio Engine', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  describe('parseVoteCommand', () => {
    it('debe reconocer sintaxis explícita !voto 1 y !voto 2', () => {
      expect(parseVoteCommand('!voto 1')).toBe(0);
      expect(parseVoteCommand('!voto 2')).toBe(1);
      expect(parseVoteCommand('!VOTO 1')).toBe(0);
      expect(parseVoteCommand('!VOTO 2')).toBe(1);
    });

    it('debe reconocer sintaxis explícita con letras !voto a y !voto b', () => {
      expect(parseVoteCommand('!voto a')).toBe(0);
      expect(parseVoteCommand('!voto b')).toBe(1);
      expect(parseVoteCommand('!VOTO A')).toBe(0);
      expect(parseVoteCommand('!VOTO B')).toBe(1);
    });

    it('debe reconocer sintaxis en inglés !vote 1 y !vote 2', () => {
      expect(parseVoteCommand('!vote 1')).toBe(0);
      expect(parseVoteCommand('!vote 2')).toBe(1);
      expect(parseVoteCommand('!vote a')).toBe(0);
      expect(parseVoteCommand('!vote b')).toBe(1);
    });

    it('debe reconocer sintaxis abreviada rápida !1 y !2', () => {
      expect(parseVoteCommand('!1')).toBe(0);
      expect(parseVoteCommand('!2')).toBe(1);
      expect(parseVoteCommand('!a')).toBe(0);
      expect(parseVoteCommand('!b')).toBe(1);
    });

    it('debe reconocer votos ultra simples directos: 1, 2, 111, 222, a, b', () => {
      expect(parseVoteCommand('1')).toBe(0);
      expect(parseVoteCommand('2')).toBe(1);
      expect(parseVoteCommand('111')).toBe(0);
      expect(parseVoteCommand('2222')).toBe(1);
      expect(parseVoteCommand('a')).toBe(0);
      expect(parseVoteCommand('b')).toBe(1);
      expect(parseVoteCommand('A')).toBe(0);
      expect(parseVoteCommand('B')).toBe(1);
      expect(parseVoteCommand('#1')).toBe(0);
      expect(parseVoteCommand('#2')).toBe(1);
      expect(parseVoteCommand('voto 1')).toBe(0);
      expect(parseVoteCommand('voto 2')).toBe(1);
    });

    it('debe ignorar mensajes no relacionados o texto regular', () => {
      expect(parseVoteCommand('hola mundo')).toBeNull();
      expect(parseVoteCommand('!s hola qué tal')).toBeNull();
      expect(parseVoteCommand('!skip')).toBeNull();
      expect(parseVoteCommand('!pausa')).toBeNull();
      expect(parseVoteCommand('!voto')).toBeNull();
      expect(parseVoteCommand('!voto 3')).toBeNull();
      expect(parseVoteCommand('!123')).toBeNull();
      expect(parseVoteCommand('10')).toBeNull();
      expect(parseVoteCommand('2024')).toBeNull();
      expect(parseVoteCommand('1 persona me dijo')).toBeNull();
      expect(parseVoteCommand('')).toBeNull();
    });
  });

  describe('parsePollCommand & Moderator Customization', () => {
    it('debe reconocer sintaxis con comillas: título, opciones y duración', () => {
      const res = parsePollCommand('!poll "¿Qué cenamos?" "Pizza" "Sushi" 45');
      expect(res).not.toBeNull();
      expect(res?.action).toBe('start');
      expect(res?.title).toBe('¿Qué cenamos?');
      expect(res?.optionA).toBe('Pizza');
      expect(res?.optionB).toBe('Sushi');
      expect(res?.durationSec).toBe(45);
    });

    it('debe admitir sintaxis con comillas para 2 opciones y duración por defecto', () => {
      const res = parsePollCommand('!encuesta "Gatos" "Perros"');
      expect(res).not.toBeNull();
      expect(res?.action).toBe('start');
      expect(res?.optionA).toBe('Gatos');
      expect(res?.optionB).toBe('Perros');
      expect(res?.title).toBe('Gatos vs Perros');
      expect(res?.durationSec).toBe(60);
    });

    it('debe reconocer sintaxis con barra separadora (pipes): título | opción A | opción B | duración', () => {
      const res = parsePollCommand('!batalla ¿Qué jugamos? | Valorant | Minecraft | 30');
      expect(res).not.toBeNull();
      expect(res?.action).toBe('start');
      expect(res?.title).toBe('¿Qué jugamos?');
      expect(res?.optionA).toBe('Valorant');
      expect(res?.optionB).toBe('Minecraft');
      expect(res?.durationSec).toBe(30);
    });

    it('debe reconocer sintaxis con pipes para 2 opciones y duración', () => {
      const res = parsePollCommand('!versus Coca Cola | Pepsi | 45');
      expect(res).not.toBeNull();
      expect(res?.action).toBe('start');
      expect(res?.optionA).toBe('Coca Cola');
      expect(res?.optionB).toBe('Pepsi');
      expect(res?.durationSec).toBe(45);
    });

    it('debe reconocer carga de presets mediante comandos de mods', () => {
      const resGamer = parsePollCommand('!poll preset gamer 50');
      expect(resGamer?.action).toBe('start');
      expect(resGamer?.presetId).toBe('preset-gamer');
      expect(resGamer?.durationSec).toBe(50);

      const resCastigos = parsePollCommand('!encuesta preset 2');
      expect(resCastigos?.action).toBe('start');
      expect(resCastigos?.presetId).toBe('preset-castigos');
    });

    it('debe reconocer inicio rápido con o sin duración', () => {
      const withDuration = parsePollCommand('!poll 45');
      expect(withDuration?.action).toBe('start');
      expect(withDuration?.durationSec).toBe(45);

      const simple = parsePollCommand('!batalla');
      expect(simple?.action).toBe('start');
      expect(simple?.durationSec).toBe(60);

      const startWord = parsePollCommand('!encuesta start 30');
      expect(startWord?.action).toBe('start');
      expect(startWord?.durationSec).toBe(30);
    });

    it('debe reconocer comandos de detención y cancelación de moderadores', () => {
      expect(parsePollCommand('!poll stop')?.action).toBe('stop');
      expect(parsePollCommand('!poll cancel')?.action).toBe('stop');
      expect(parsePollCommand('!poll cancelar')?.action).toBe('stop');
      expect(parsePollCommand('!encuesta fin')?.action).toBe('stop');
      expect(parsePollCommand('!batalla parar')?.action).toBe('stop');
    });

    it('debe acotar la duración de la encuesta dentro de límites seguros (10s a 600s)', () => {
      expect(clampPollDuration(5)).toBe(10);
      expect(clampPollDuration(1200)).toBe(600);
      expect(clampPollDuration('45s')).toBe(45);
      expect(clampPollDuration('60 seg')).toBe(60);
      expect(clampPollDuration(null)).toBe(60);
    });

    it('debe ignorar mensajes que no sean comandos de encuestas', () => {
      expect(parsePollCommand('hola poll')).toBeNull();
      expect(parsePollCommand('!s mensaje tts')).toBeNull();
      expect(parsePollCommand('!skip')).toBeNull();
      expect(parsePollCommand('')).toBeNull();
    });
  });

  describe('Moderator Pre-Announcement Audio & TTS Text', () => {
    it('debe estructurar el anuncio TTS con instrucciones simples de voto y emoción', () => {
      const text = buildModPollAnnouncementText({
        modName: 'AlexMod',
        modRole: 'mod',
        title: 'Pizza con Piña',
        optionALabel: 'Delicia',
        optionBLabel: 'Crimen',
        durationSec: 45,
      });

      expect(text).toContain('[emocionado]');
      expect(text).toContain('El moderador AlexMod');
      expect(text).toContain('Pizza con Piña');
      expect(text).toContain('Para votar por Delicia, escribe 1 en el chat');
      expect(text).toContain('Para votar por Crimen, escribe 2');
      expect(text).toContain('45 segundos');
    });

    it('debe adaptar el locutor cuando es el streamer quien inicia la votación', () => {
      const text = buildModPollAnnouncementText({
        modName: 'jagc',
        modRole: 'broadcaster',
        title: '¿Qué jugamos?',
        optionALabel: 'Valorant',
        optionBLabel: 'Minecraft',
        durationSec: 60,
      });

      expect(text).toContain('El streamer');
      expect(text).toContain('Valorant');
      expect(text).toContain('Minecraft');
      expect(text).toContain('60 segundos');
    });
  });

  describe('calculatePollPercentages', () => {
    it('debe retornar 50/50 cuando no hay votos', () => {
      const res = calculatePollPercentages(0, 0);
      expect(res.pctA).toBe(50);
      expect(res.pctB).toBe(50);
    });

    it('debe manejar 100/0 y 0/100 correctamente', () => {
      expect(calculatePollPercentages(15, 0)).toEqual({ pctA: 100, pctB: 0 });
      expect(calculatePollPercentages(0, 20)).toEqual({ pctA: 0, pctB: 100 });
    });

    it('debe garantizar que la suma de porcentajes sea exactamente 100%', () => {
      const cases = [
        [14, 11],
        [1, 2],
        [3, 7],
        [73, 27],
        [1, 1],
        [99, 1],
      ];

      cases.forEach(([a, b]) => {
        const { pctA, pctB } = calculatePollPercentages(a, b);
        expect(pctA + pctB).toBe(100);
      });
    });

    it('debe manejar números negativos de forma segura tratándolos como 0', () => {
      expect(calculatePollPercentages(-5, -10)).toEqual({ pctA: 50, pctB: 50 });
      expect(calculatePollPercentages(-5, 10)).toEqual({ pctA: 0, pctB: 100 });
    });
  });

  describe('determineLeader', () => {
    it('debe detectar líder A cuando votesA > votesB', () => {
      expect(determineLeader(10, 9)).toBe('A');
    });

    it('debe detectar líder B cuando votesB > votesA', () => {
      expect(determineLeader(4, 8)).toBe('B');
    });

    it('debe detectar empate TIE cuando votesA === votesB', () => {
      expect(determineLeader(5, 5)).toBe('TIE');
      expect(determineLeader(0, 0)).toBe('TIE');
    });
  });

  describe('Storage & Default Presets', () => {
    it('debe cargar configuración por defecto si localStorage está vacío', () => {
      const settings = loadPollSettings();
      expect(settings.activeBattleTitle).toBe(INITIAL_POLL_SETTINGS.activeBattleTitle);
      expect(settings.options.length).toBe(2);
      expect(settings.ttsAnnouncer.enabled).toBe(true);
    });

    it('debe guardar y recuperar configuración modificada', () => {
      const custom = {
        ...INITIAL_POLL_SETTINGS,
        activeBattleTitle: 'Batalla de Prueba Personalizada',
        durationSec: 45,
      };

      savePollSettings(custom);
      const loaded = loadPollSettings();
      expect(loaded.activeBattleTitle).toBe('Batalla de Prueba Personalizada');
      expect(loaded.durationSec).toBe(45);
    });

    it('debe contener los 4 presets oficiales de batalla con estructura válida', () => {
      expect(DEFAULT_BATTLE_PRESETS.length).toBeGreaterThanOrEqual(4);
      DEFAULT_BATTLE_PRESETS.forEach((preset) => {
        expect(preset.id).toBeTruthy();
        expect(preset.title).toBeTruthy();
        expect(preset.optionA.label).toBeTruthy();
        expect(preset.optionB.label).toBeTruthy();
        expect(preset.durationSec).toBeGreaterThan(0);
      });
    });
  });

  describe('Battle Visual Themes (5 Broadcast Themes)', () => {
    it('debe contener exactamente los 5 temas visuales cinemáticos', () => {
      const themeIds = POLL_THEMES.map((t) => t.id);
      expect(themeIds).toEqual(['cabina', 'neon', 'esports', 'cyber', 'minimal']);
    });

    it('cada tema debe tener badge, acento y descripción válidos', () => {
      POLL_THEMES.forEach((theme) => {
        expect(theme.name).toBeTruthy();
        expect(theme.description).toBeTruthy();
        expect(theme.badge).toBeTruthy();
        expect(theme.accent.startsWith('#')).toBe(true);
      });
    });

    it('debe permitir guardar y recuperar tema visual en loadPollSettings', () => {
      const customThemeSettings = {
        ...INITIAL_POLL_SETTINGS,
        theme: 'esports' as const,
      };
      savePollSettings(customThemeSettings);
      const loaded = loadPollSettings();
      expect(loaded.theme).toBe('esports');
    });
  });
});
