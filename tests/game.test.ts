/**
 * tests/game.test.ts
 *
 * «Alertas de juego»: normalización de los ajustes, la foto que llega del
 * servidor, la comparación de fotos (qué alertas salen y cuáles no), la sesión
 * y la racha, el texto de la placa, la frase de la voz con su emoción (y que
 * esa frase llega entera a la voz tras el saneado), y el registro del módulo.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GAME_SETTINGS,
  GAME_ALERTS,
  GAME_ALERT_IDS,
  GAME_EMOTIONS,
  GAME_LIMITS,
  GAME_STORAGE_KEY,
  GAME_TONES,
  decodeGameSettings,
  encodeGameSettings,
  normalizeGameSettings,
  type GameSettings,
} from '../src/types/game';
import {
  EMPTY_SESSION,
  GAME_STATE_MAX_AGE_MS,
  SAMPLE_ALERTS,
  advanceGame,
  alertView,
  announceText,
  diffSnapshots,
  groupDigits,
  parseSnapshot,
  rankLabel,
  rankSpoken,
  rankValue,
  readGameState,
  type GameLast,
  type GameSnapshot,
  type GameState,
} from '../src/utils/gameAlerts';
import { normalizeTextForFishAudio, stripEmotionTags } from '../src/utils/emotionMapper';
import { sanitizeTwitchMessage } from '../src/utils/twitchSanitizer';
import { CONFIG_MODULES } from '../src/lib/cloudTypes';
import { MODULE_STORAGE_KEYS } from '../src/lib/cloudConfig';
import { buildSuiteWidgetUrl } from '../src/utils/widgetUrl';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import { RIOT_DISCLAIMER_EN, RIOT_DISCLAIMER_ES } from '../src/components/integraciones/RiotCard';

const settings = (patch: Partial<GameSettings> = {}): GameSettings => ({ ...DEFAULT_GAME_SETTINGS, ...patch });
const withAlert = (id: keyof GameSettings['alerts'], patch: Partial<GameSettings['alerts']['win']>): GameSettings =>
  settings({ alerts: { ...DEFAULT_GAME_SETTINGS.alerts, [id]: { ...DEFAULT_GAME_SETTINGS.alerts[id], ...patch } } });

const last = (patch: Partial<GameLast> = {}): GameLast => ({
  matchId: 'LA1_1',
  win: true,
  remake: false,
  ranked: true,
  champion: 'Ahri',
  queue: 'Clasificatoria solo/dúo',
  durationSec: 1860,
  kills: 9,
  deaths: 2,
  assists: 11,
  pentaKills: 0,
  ...patch,
});
const snap = (patch: Partial<GameSnapshot> = {}): GameSnapshot => ({
  status: 'ok',
  riotId: 'Lalo#LAN',
  rank: { tier: 'GOLD', division: 'III', lp: 50, wins: 10, losses: 10 },
  live: null,
  last: last(),
  mastery: [{ championId: 103, champion: 'Ahri', level: 6, points: 100000 }],
  ...patch,
});
const ids = (alerts: { id: string }[]) => alerts.map((alert) => alert.id);

describe('ajustes de Alertas de juego', () => {
  it('de nada salen los valores por defecto', () => {
    expect(normalizeGameSettings(null)).toEqual(DEFAULT_GAME_SETTINGS);
    expect(normalizeGameSettings('x')).toEqual(DEFAULT_GAME_SETTINGS);
    expect(normalizeGameSettings([])).toEqual(DEFAULT_GAME_SETTINGS);
  });

  it('lo que no vale vuelve a su valor por defecto y los números se acotan', () => {
    const clean = normalizeGameSettings({ pos: 'centro', energy: 'brutal', colorMode: 'arcoiris', color: 'rojo', size: 999, durationSec: 0, announcer: 'dios', voiceSource: 7, sound: 'trompeta', streakMin: 50, soundVolume: 9 });
    expect(clean.pos).toBe('bc');
    expect(clean.energy).toBe('normal');
    expect(clean.colorMode).toBe('tone');
    expect(clean.color).toBe(DEFAULT_GAME_SETTINGS.color);
    expect(clean.size).toBe(GAME_LIMITS.size.max);
    expect(clean.durationSec).toBe(GAME_LIMITS.durationSec.min);
    expect(clean.announcer).toBe('voz');
    expect(clean.voiceSource).toBe('chat');
    expect(clean.sound).toBe('soft-pop');
    expect(clean.streakMin).toBe(GAME_LIMITS.streakMin.max);
    expect(clean.soundVolume).toBe(1);
  });

  it('cada alerta tiene interruptor, título y emoción; la emoción solo puede ser una que entienda la voz', () => {
    const clean = normalizeGameSettings({ alerts: { win: { on: false, title: '  GG   WP  ', emotion: 'sad' }, loss: { emotion: 'inventada' }, penta: 'x' } });
    expect(clean.alerts.win).toEqual({ on: false, title: 'GG WP', emotion: 'sad' });
    expect(clean.alerts.loss).toEqual(DEFAULT_GAME_SETTINGS.alerts.loss);
    expect(clean.alerts.penta).toEqual(DEFAULT_GAME_SETTINGS.alerts.penta);
    expect(Object.keys(clean.alerts).sort()).toEqual([...GAME_ALERT_IDS].sort());
    // Sin emoción también vale
    expect(normalizeGameSettings({ alerts: { win: { emotion: '' } } }).alerts.win.emotion).toBe('');
  });

  it('el título se recorta y no puede colar una etiqueta de emoción', () => {
    const clean = normalizeGameSettings({ alerts: { win: { title: `[gritando] ${'x'.repeat(80)}` } } });
    expect(clean.alerts.win.title).not.toMatch(/[[\]]/);
    expect(clean.alerts.win.title.length).toBeLessThanOrEqual(GAME_LIMITS.title);
  });

  it('las emociones por defecto siguen a la acción', () => {
    const emotion = (id: keyof GameSettings['alerts']) => DEFAULT_GAME_SETTINGS.alerts[id].emotion;
    expect(emotion('win')).toBe('excited');
    expect(emotion('penta')).toBe('excited');
    expect(emotion('promo')).toBe('excited');
    expect(emotion('perfect')).toBe('excited');
    expect(emotion('streak')).toBe('excited');
    expect(emotion('up')).toBe('happy');
    expect(emotion('mastery')).toBe('happy');
    expect(emotion('start')).toBe('happy');
    expect(emotion('loss')).toBe('sad');
    expect(emotion('down')).toBe('sad');
  });

  it('todas las emociones del selector las entiende el motor de voz', () => {
    GAME_EMOTIONS.filter((item) => item.id).forEach((item) => {
      // Una etiqueta canónica se queda igual al normalizar: es que está en el mapa
      expect(normalizeTextForFishAudio(`[${item.id}] hola`)).toBe(`[${item.id}] hola`);
    });
    GAME_ALERTS.forEach((item) => expect(GAME_EMOTIONS.some((emotion) => emotion.id === item.emotion)).toBe(true));
  });

  it('viajan por la URL y vuelven iguales', () => {
    const custom = normalizeGameSettings({ pos: 'tr', size: 120, energy: 'intensa', colorMode: 'fixed', color: '#AABBCC', announcer: 'mascota', voiceSource: 'catalogue', voiceId: 'abcdef1234567890', alerts: { win: { title: 'Ñam ¡GG!', emotion: 'laughing' } } });
    expect(custom.color).toBe('#aabbcc');
    expect(decodeGameSettings(encodeGameSettings(custom))).toEqual(custom);
    expect(decodeGameSettings('no-es-base64-válido%%')).toBeNull();
    expect(decodeGameSettings(null)).toBeNull();
  });

  it('una voz del catálogo con forma rara se descarta', () => {
    expect(normalizeGameSettings({ voiceId: '<script>' }).voiceId).toBe('');
    expect(normalizeGameSettings({ voiceId: 'abcdef1234567890' }).voiceId).toBe('abcdef1234567890');
  });
});

describe('la foto de la cuenta', () => {
  it('tolera cualquier forma: sin estado es un error y no hay datos', () => {
    for (const raw of [null, undefined, 'x', 7, [], {}]) {
      expect(parseSnapshot(raw)).toEqual({ status: 'error', riotId: '', rank: null, live: null, last: null, mastery: [] });
    }
  });

  it('lee lo que entrega el servidor y descarta lo que no reconoce', () => {
    const parsed = parseSnapshot({
      status: 'ok',
      riotId: 'Lalo#LAN',
      rank: { tier: 'gold', division: 'ii', lp: 12, wins: 48, losses: 41, mmr: 1500 },
      live: { gameId: '777', champion: 'Ahri', queue: 'ARAM', rivales: ['x'] },
      last: { matchId: 'LA1_9', win: true, kills: 3, deaths: '2', puuid: 'secreto' },
      mastery: [{ championId: 103, champion: 'Ahri', level: 7, points: 152300 }, 'x', { level: 3 }],
    });
    expect(parsed.rank).toEqual({ tier: 'GOLD', division: 'II', lp: 12, wins: 48, losses: 41 });
    expect(parsed.live).toEqual({ gameId: '777', champion: 'Ahri', queue: 'ARAM' });
    expect(parsed.last).toMatchObject({ matchId: 'LA1_9', win: true, kills: 3, deaths: 0, remake: false });
    expect(parsed.mastery).toEqual([{ championId: 103, champion: 'Ahri', level: 7, points: 152300 }]);
    expect(JSON.stringify(parsed)).not.toMatch(/mmr|rivales|secreto/);
  });

  it('una liga desconocida no es un rango', () => {
    expect(parseSnapshot({ status: 'ok', rank: { tier: 'WOOD', division: 'I' } }).rank).toBeNull();
  });

  it('ordena ligas y divisiones', () => {
    const v = (tier: string, division: string) => rankValue({ tier, division });
    expect(v('GOLD', 'II')).toBeGreaterThan(v('GOLD', 'III'));
    expect(v('GOLD', 'IV')).toBeGreaterThan(v('SILVER', 'I'));
    expect(v('EMERALD', 'IV')).toBeGreaterThan(v('PLATINUM', 'I'));
    expect(v('MASTER', 'I')).toBeGreaterThan(v('DIAMOND', 'I'));
    expect(v('CHALLENGER', 'I')).toBeGreaterThan(v('GRANDMASTER', 'I'));
    expect(rankLabel({ tier: 'GOLD', division: 'II' })).toBe('Oro II');
    expect(rankLabel({ tier: 'MASTER', division: 'I' })).toBe('Maestro');
    expect(rankSpoken({ tier: 'GOLD', division: 'II' })).toBe('Oro dos');
    expect(rankSpoken({ tier: 'PLATINUM', division: 'IV' })).toBe('Platino cuatro');
  });
});

describe('comparación de fotos', () => {
  const NOW = 1_800_000_000_000;
  const state = (snapshot: GameSnapshot, patch: Partial<GameState> = {}): GameState => ({ snapshot, session: EMPTY_SESSION, savedAt: NOW - 30_000, ...patch });

  it('la primera foto no dispara nada: solo fija el punto de partida', () => {
    const first = advanceGame(null, snap({ live: { gameId: '1', champion: 'Ahri', queue: 'ARAM' } }), NOW);
    expect(first.alerts).toEqual([]);
    expect(first.state?.snapshot.last?.matchId).toBe('LA1_1');
    expect(first.state?.session).toEqual(EMPTY_SESSION);
  });

  it('dos fotos iguales no disparan nada', () => {
    expect(advanceGame(state(snap()), snap(), NOW).alerts).toEqual([]);
  });

  it('una foto que no es «ok» ni se compara ni sustituye a la buena', () => {
    const before = state(snap());
    for (const status of ['limited', 'error', 'not_linked', 'key_invalid', 'not_configured']) {
      const step = advanceGame(before, snap({ status, rank: null, last: null, mastery: [] }), NOW);
      expect(step.alerts).toEqual([]);
      expect(step.state).toBe(before);
    }
    // Y sin foto anterior sigue sin haberla
    expect(advanceGame(null, snap({ status: 'error' }), NOW).state).toBeNull();
  });

  it('una foto guardada hace mucho es un punto de partida nuevo: lo que pasó entretanto no se anuncia', () => {
    const old = state(snap(), { savedAt: NOW - GAME_STATE_MAX_AGE_MS - 1, session: { wins: 4, losses: 1, streak: 4 } });
    const step = advanceGame(old, snap({ last: last({ matchId: 'LA1_2' }), rank: { tier: 'PLATINUM', division: 'IV', lp: 0, wins: 11, losses: 10 } }), NOW);
    expect(step.alerts).toEqual([]);
    expect(step.state?.session).toEqual(EMPTY_SESSION);
  });

  it('si cambia la cuenta vinculada tampoco se compara', () => {
    const step = advanceGame(state(snap()), snap({ riotId: 'Otra#EUW', last: last({ matchId: 'EUW1_5' }) }), NOW);
    expect(step.alerts).toEqual([]);
  });

  it('empieza la partida cuando aparece una partida en curso nueva, una sola vez', () => {
    const live = { gameId: '55', champion: 'Ahri', queue: 'Clasificatoria solo/dúo' };
    const one = advanceGame(state(snap()), snap({ live }), NOW);
    expect(one.alerts).toEqual([{ id: 'start', key: 'start:55', champion: 'Ahri', queue: 'Clasificatoria solo/dúo' }]);
    const two = advanceGame(one.state, snap({ live }), NOW + 30_000);
    expect(two.alerts).toEqual([]);
  });

  it('victoria: partida nueva ganada, con los puntos de liga si no cambió de división', () => {
    const next = snap({ last: last({ matchId: 'LA1_2' }), rank: { tier: 'GOLD', division: 'III', lp: 71, wins: 11, losses: 10 } });
    const step = advanceGame(state(snap()), next, NOW);
    expect(ids(step.alerts)).toEqual(['win']);
    expect(step.alerts[0]).toMatchObject({ key: 'win:LA1_2', champion: 'Ahri', kills: 9, deaths: 2, assists: 11, lpDelta: 21 });
    expect(step.state?.session).toEqual({ wins: 1, losses: 0, streak: 1 });
  });

  it('derrota: partida nueva perdida, corta la racha', () => {
    const before = state(snap(), { session: { wins: 2, losses: 0, streak: 2 } });
    const next = snap({ last: last({ matchId: 'LA1_2', win: false, kills: 3, deaths: 7, assists: 5 }), rank: { tier: 'GOLD', division: 'III', lp: 32, wins: 10, losses: 11 } });
    const step = advanceGame(before, next, NOW);
    expect(ids(step.alerts)).toEqual(['loss']);
    expect(step.alerts[0].lpDelta).toBe(-18);
    expect(step.state?.session).toEqual({ wins: 2, losses: 1, streak: 0 });
  });

  it('una partida que no es de solo/dúo no inventa puntos de liga', () => {
    const next = snap({ last: last({ matchId: 'LA1_2', ranked: false, queue: 'ARAM' }), rank: { tier: 'GOLD', division: 'III', lp: 71, wins: 11, losses: 10 } });
    expect(advanceGame(state(snap()), next, NOW).alerts[0].lpDelta).toBeUndefined();
  });

  it('una partida rehecha no cuenta: ni alerta ni sesión', () => {
    const step = advanceGame(state(snap()), snap({ last: last({ matchId: 'LA1_2', remake: true, win: false }) }), NOW);
    expect(step.alerts).toEqual([]);
    expect(step.state?.session).toEqual(EMPTY_SESSION);
  });

  it('la misma partida no se anuncia dos veces', () => {
    const one = advanceGame(state(snap()), snap({ last: last({ matchId: 'LA1_2' }) }), NOW);
    expect(ids(one.alerts)).toEqual(['win']);
    expect(advanceGame(one.state, snap({ last: last({ matchId: 'LA1_2' }) }), NOW + 30_000).alerts).toEqual([]);
  });

  it('sin partida anterior con la que comparar, la primera solo cuenta si se le vio jugando', () => {
    const fresh = snap({ last: null });
    expect(advanceGame(state(fresh), snap({ last: last({ matchId: 'LA1_1' }) }), NOW).alerts).toEqual([]);
    const playing = snap({ last: null, live: { gameId: '9', champion: 'Ahri', queue: 'ARAM' } });
    expect(ids(advanceGame(state(playing), snap({ last: last({ matchId: 'LA1_1' }) }), NOW).alerts)).toEqual(['win']);
  });

  it('pentakill y partida perfecta salen detrás del resultado', () => {
    const penta = advanceGame(state(snap()), snap({ last: last({ matchId: 'LA1_2', pentaKills: 1 }) }), NOW);
    expect(ids(penta.alerts)).toEqual(['win', 'penta']);
    const perfect = advanceGame(state(snap()), snap({ last: last({ matchId: 'LA1_2', deaths: 0, kills: 12, assists: 8 }) }), NOW);
    expect(ids(perfect.alerts)).toEqual(['win', 'perfect']);
    // Un pentakill en una derrota sigue siendo un pentakill; una derrota sin muertes no es perfecta
    const lost = advanceGame(state(snap()), snap({ last: last({ matchId: 'LA1_2', win: false, pentaKills: 1, deaths: 0 }) }), NOW);
    expect(ids(lost.alerts)).toEqual(['loss', 'penta']);
    // Ganar sin tocar a nadie tampoco
    const idle = advanceGame(state(snap()), snap({ last: last({ matchId: 'LA1_2', deaths: 0, kills: 0, assists: 0 }) }), NOW);
    expect(ids(idle.alerts)).toEqual(['win']);
  });

  it('racha de la sesión: avisa al llegar al mínimo y en cada victoria siguiente', () => {
    let current: GameState | null = state(snap());
    const seen: string[][] = [];
    for (let i = 2; i <= 5; i += 1) {
      const step = advanceGame(current, snap({ last: last({ matchId: `LA1_${i}` }) }), NOW + i * 60_000, 3);
      seen.push(ids(step.alerts));
      current = step.state;
    }
    expect(seen).toEqual([['win'], ['win'], ['win', 'streak'], ['win', 'streak']]);
    expect(current?.session).toEqual({ wins: 4, losses: 0, streak: 4 });
    // Una derrota la corta, y la siguiente victoria empieza de cero
    const lost = advanceGame(current, snap({ last: last({ matchId: 'LA1_6', win: false }) }), NOW + 400_000, 3);
    const again = advanceGame(lost.state, snap({ last: last({ matchId: 'LA1_7' }) }), NOW + 460_000, 3);
    expect(ids(again.alerts)).toEqual(['win']);
    expect(again.state?.session).toEqual({ wins: 5, losses: 1, streak: 1 });
  });

  it('la alerta de racha lleva la cuenta de la sesión', () => {
    const before = state(snap(), { session: { wins: 3, losses: 1, streak: 2 } });
    const step = advanceGame(before, snap({ last: last({ matchId: 'LA1_2' }) }), NOW, 3);
    expect(step.alerts[1]).toEqual({ id: 'streak', key: 'streak:LA1_2', streak: 3, sessionWins: 4, sessionLosses: 1 });
  });

  it('sube de división dentro de la misma liga', () => {
    const next = snap({ rank: { tier: 'GOLD', division: 'II', lp: 12, wins: 11, losses: 10 } });
    const step = advanceGame(state(snap()), next, NOW);
    expect(step.alerts).toEqual([{ id: 'up', key: 'up:GOLD-II', rank: next.rank }]);
  });

  it('nueva liga al subir de liga, y también al terminar el posicionamiento', () => {
    const plat = { tier: 'PLATINUM', division: 'IV', lp: 0, wins: 11, losses: 10 };
    expect(ids(advanceGame(state(snap({ rank: { tier: 'GOLD', division: 'I', lp: 90, wins: 10, losses: 10 } })), snap({ rank: plat }), NOW).alerts)).toEqual(['promo']);
    expect(advanceGame(state(snap({ rank: null })), snap({ rank: plat }), NOW).alerts).toEqual([{ id: 'promo', key: 'promo:PLATINUM-IV', rank: plat }]);
  });

  it('baja de división, dentro de la liga o a la de abajo', () => {
    expect(ids(advanceGame(state(snap()), snap({ rank: { tier: 'GOLD', division: 'IV', lp: 75, wins: 10, losses: 11 } }), NOW).alerts)).toEqual(['down']);
    const fromIv = state(snap({ rank: { tier: 'GOLD', division: 'IV', lp: 0, wins: 10, losses: 10 } }));
    const step = advanceGame(fromIv, snap({ rank: { tier: 'SILVER', division: 'I', lp: 75, wins: 10, losses: 11 } }), NOW);
    expect(step.alerts[0]).toMatchObject({ id: 'down', key: 'down:SILVER-I' });
  });

  it('cambiar solo de puntos de liga no es subir ni bajar, y perder el rango no avisa', () => {
    expect(advanceGame(state(snap()), snap({ rank: { tier: 'GOLD', division: 'III', lp: 99, wins: 10, losses: 10 } }), NOW).alerts).toEqual([]);
    expect(advanceGame(state(snap()), snap({ rank: null }), NOW).alerts).toEqual([]);
  });

  it('al subir de división con la partida, salen el resultado y la subida, sin puntos de liga inventados', () => {
    const next = snap({ last: last({ matchId: 'LA1_2' }), rank: { tier: 'GOLD', division: 'II', lp: 5, wins: 11, losses: 10 } });
    const step = advanceGame(state(snap()), next, NOW);
    expect(ids(step.alerts)).toEqual(['win', 'up']);
    expect(step.alerts[0].lpDelta).toBeUndefined();
  });

  it('maestría: solo cuando sube el nivel de un campeón que ya estaba en la foto', () => {
    const up = snap({ mastery: [{ championId: 103, champion: 'Ahri', level: 7, points: 152300 }] });
    expect(advanceGame(state(snap()), up, NOW).alerts).toEqual([{ id: 'mastery', key: 'mastery:103:7', champion: 'Ahri', level: 7, points: 152300 }]);
    // Más puntos sin subir de nivel, o un campeón que entra en la lista, no avisan
    expect(advanceGame(state(snap()), snap({ mastery: [{ championId: 103, champion: 'Ahri', level: 6, points: 120000 }] }), NOW).alerts).toEqual([]);
    expect(advanceGame(state(snap()), snap({ mastery: [...snap().mastery, { championId: 62, champion: 'Wukong', level: 9, points: 9 }] }), NOW).alerts).toEqual([]);
    // Si la maestría falló en una lectura (lista vacía), la siguiente no avisa de todo
    expect(advanceGame(state(snap({ mastery: [] })), up, NOW).alerts).toEqual([]);
  });

  it('el orden es partida, resultado, jugadas, racha, rango y maestría', () => {
    const before = state(snap(), { session: { wins: 2, losses: 0, streak: 2 } });
    const next = snap({
      live: { gameId: '99', champion: 'Ahri', queue: 'ARAM' },
      last: last({ matchId: 'LA1_2', pentaKills: 1, deaths: 0 }),
      rank: { tier: 'PLATINUM', division: 'IV', lp: 0, wins: 11, losses: 10 },
      mastery: [{ championId: 103, champion: 'Ahri', level: 7, points: 152300 }],
    });
    const { alerts } = diffSnapshots(before.snapshot, next, before.session, 3);
    expect(ids(alerts)).toEqual(['start', 'win', 'penta', 'perfect', 'streak', 'promo', 'mastery']);
    // Cada una con su clave, para que una fuente no la repita
    expect(new Set(alerts.map((alert) => alert.key)).size).toBe(alerts.length);
  });

  it('el estado guardado se lee con cuidado: viejo, roto o no «ok» es como no tener nada', () => {
    const saved: GameState = { snapshot: snap(), session: { wins: 2, losses: 1, streak: 2 }, savedAt: NOW - 60_000 };
    expect(readGameState(JSON.stringify(saved), NOW)).toEqual(saved);
    expect(readGameState(JSON.stringify(saved), NOW + GAME_STATE_MAX_AGE_MS)).toBeNull();
    expect(readGameState(JSON.stringify({ ...saved, savedAt: NOW + 3_600_000 }), NOW)).toBeNull();
    expect(readGameState(JSON.stringify({ ...saved, snapshot: snap({ status: 'error' }) }), NOW)).toBeNull();
    expect(readGameState('{no es json', NOW)).toBeNull();
    expect(readGameState('[]', NOW)).toBeNull();
    expect(readGameState(null, NOW)).toBeNull();
    expect(readGameState(JSON.stringify({ ...saved, session: 'x' }), NOW)?.session).toEqual(EMPTY_SESSION);
  });
});

describe('texto de la placa', () => {
  it('cada alerta de ejemplo tiene título, rótulo y color según su tipo', () => {
    GAME_ALERTS.forEach((def) => {
      const view = alertView(SAMPLE_ALERTS[def.id], DEFAULT_GAME_SETTINGS);
      expect(view.title.length).toBeGreaterThan(0);
      expect(view.title).not.toMatch(/[{}]/);
      expect(view.tagline).toBe(`League of Legends · ${def.tag}`);
      expect(view.color).toBe(GAME_TONES[def.tone]);
    });
  });

  it('victoria: campeón, cola, minutos y marcador con los puntos de liga', () => {
    const view = alertView(SAMPLE_ALERTS.win, DEFAULT_GAME_SETTINGS);
    expect(view.title).toBe('Victoria');
    expect(view.sub).toBe('Ahri · Clasificatoria solo/dúo · 31 min');
    expect(view.stats).toEqual([{ label: 'K', value: '9' }, { label: 'D', value: '2' }, { label: 'A', value: '11' }, { label: 'PL', value: '+21' }]);
    expect(alertView(SAMPLE_ALERTS.loss, DEFAULT_GAME_SETTINGS).stats[3]).toEqual({ label: 'PL', value: '-18' });
  });

  it('rango, maestría y racha', () => {
    expect(alertView(SAMPLE_ALERTS.up, DEFAULT_GAME_SETTINGS).title).toBe('Sube a Oro II');
    expect(alertView(SAMPLE_ALERTS.promo, DEFAULT_GAME_SETTINGS).title).toBe('Platino IV');
    expect(alertView(SAMPLE_ALERTS.down, DEFAULT_GAME_SETTINGS).title).toBe('Baja a Plata I');
    const mastery = alertView(SAMPLE_ALERTS.mastery, DEFAULT_GAME_SETTINGS);
    expect(mastery.title).toBe('Maestría 7 con Ahri');
    expect(mastery.sub).toBe('152 300 puntos');
    expect(mastery.stats).toEqual([]);
    const streak = alertView(SAMPLE_ALERTS.streak, DEFAULT_GAME_SETTINGS);
    expect(streak.title).toBe('Racha de 3 victorias');
    expect(streak.sub).toBe('En este directo: 4 V · 1 D');
    expect(groupDigits(1000)).toBe('1 000');
    expect(groupDigits(999)).toBe('999');
  });

  it('respeta el título propio con sus variables, el color fijo y los interruptores', () => {
    const own = withAlert('up', { title: '¡{rango}, chat!' });
    expect(alertView(SAMPLE_ALERTS.up, own).title).toBe('¡Oro II, chat!');
    const fixed = settings({ colorMode: 'fixed', color: '#123456', showStats: false, showGame: false });
    const view = alertView(SAMPLE_ALERTS.win, fixed);
    expect(view.color).toBe('#123456');
    expect(view.stats).toEqual([]);
    expect(view.tagline).toBe('Fin de partida');
  });

  it('sin datos no deja huecos ni llaves', () => {
    const view = alertView({ id: 'win', key: 'k' }, DEFAULT_GAME_SETTINGS);
    expect(view.sub).toBe('');
    expect(view.stats.map((stat) => stat.value)).toEqual(['0', '0', '0']);
    expect(alertView({ id: 'up', key: 'k' }, DEFAULT_GAME_SETTINGS).title).toBe('Sube a');
    expect(alertView({ id: 'promo', key: 'k' }, DEFAULT_GAME_SETTINGS).title).toBe('Nueva liga');
    expect(alertView({ id: 'start', key: 'k' }, DEFAULT_GAME_SETTINGS).sub).toBe('');
  });

  it('un nombre que viene de Riot es texto: no trae corchetes ni llaves a la placa', () => {
    const view = alertView({ id: 'start', key: 'k', champion: '[shouting]{rango}<b>Ahri</b>', queue: 'ARAM' }, DEFAULT_GAME_SETTINGS);
    expect(view.sub).toBe('shoutingrango<b>Ahri</b> · ARAM');
  });
});

describe('la frase de la voz y su emoción', () => {
  it('lleva la emoción de la alerta como etiqueta al inicio', () => {
    expect(announceText(SAMPLE_ALERTS.win, DEFAULT_GAME_SETTINGS)).toBe('[excited] Victoria con Ahri. 9, 2, 11.');
    expect(announceText(SAMPLE_ALERTS.loss, DEFAULT_GAME_SETTINGS)).toBe('[sad] Derrota. A por la siguiente.');
    expect(announceText(SAMPLE_ALERTS.up, DEFAULT_GAME_SETTINGS)).toBe('[happy] Subimos a Oro dos.');
    expect(announceText(SAMPLE_ALERTS.promo, DEFAULT_GAME_SETTINGS)).toBe('[excited] Nueva liga: Platino cuatro.');
    expect(announceText(SAMPLE_ALERTS.down, DEFAULT_GAME_SETTINGS)).toBe('[sad] Bajamos a Plata uno. Se recupera.');
    expect(announceText(SAMPLE_ALERTS.penta, DEFAULT_GAME_SETTINGS)).toBe('[excited] Pentakill con Ahri en la última partida.');
    expect(announceText(SAMPLE_ALERTS.perfect, DEFAULT_GAME_SETTINGS)).toBe('[excited] Partida perfecta: 12, 0, 8.');
    expect(announceText(SAMPLE_ALERTS.mastery, DEFAULT_GAME_SETTINGS)).toBe('[happy] Maestría 7 con Ahri.');
    expect(announceText(SAMPLE_ALERTS.streak, DEFAULT_GAME_SETTINGS)).toBe('[excited] 3 victorias seguidas.');
    expect(announceText(SAMPLE_ALERTS.start, DEFAULT_GAME_SETTINGS)).toBe('[happy] Empieza la partida. Hoy toca Ahri.');
  });

  it('la emoción se puede cambiar o quitar por alerta', () => {
    expect(announceText(SAMPLE_ALERTS.win, withAlert('win', { emotion: 'laughing' }))).toMatch(/^\[laughing\] Victoria/);
    expect(announceText(SAMPLE_ALERTS.win, withAlert('win', { emotion: '' }))).toBe('Victoria con Ahri. 9, 2, 11.');
  });

  it('con un título propio se lee ese título', () => {
    expect(announceText(SAMPLE_ALERTS.up, withAlert('up', { title: 'Arriba, a {rango}' }))).toBe('[happy] Arriba, a Oro II.');
    expect(announceText(SAMPLE_ALERTS.win, withAlert('win', { title: '¡GG!' }))).toBe('[excited] ¡GG!');
  });

  it('un nombre de campeón no puede colar otra etiqueta', () => {
    const text = announceText({ id: 'start', key: 'k', champion: '[shouting] Ahri' }, DEFAULT_GAME_SETTINGS);
    expect(text).toBe('[happy] Empieza la partida. Hoy toca shouting Ahri.');
    expect(text.match(/\[/g)).toHaveLength(1);
  });

  it('la frase pasa el saneado de la cola de voz con la etiqueta y las cifras intactas', () => {
    GAME_ALERT_IDS.forEach((id) => {
      const text = announceText(SAMPLE_ALERTS[id], DEFAULT_GAME_SETTINGS);
      // Lo mismo que hace enqueueManualMessage: antepone «!s » y sanea
      const sanitized = sanitizeTwitchMessage(`!s ${text}`, { username: 'Juego' });
      expect(sanitized?.cleanText).toBe(text);
      // Y lo que el widget manda a /api/tts sigue empezando por la etiqueta canónica
      const emotion = DEFAULT_GAME_SETTINGS.alerts[id].emotion;
      expect(normalizeTextForFishAudio(sanitized?.cleanText ?? '').startsWith(`[${emotion}] `)).toBe(true);
      expect(sanitized?.emotion?.tag).toBe(emotion);
    });
  });

  it('marcadores con cifras repetidas llegan enteros a la voz', () => {
    const text = announceText({ id: 'win', key: 'k', champion: 'Ahri', kills: 111, deaths: 0, assists: 100 }, DEFAULT_GAME_SETTINGS);
    expect(sanitizeTwitchMessage(`!s ${text}`)?.cleanText).toBe('[excited] Victoria con Ahri. 111, 0, 100.');
  });

  it('en pantalla (el bocadillo de la mascota) la frase va sin la etiqueta', () => {
    expect(stripEmotionTags('[excited] Victoria con Ahri. 9, 2, 11.')).toBe('Victoria con Ahri. 9, 2, 11.');
    expect(stripEmotionTags('Hola [feliz] chat [susurro]')).toBe('Hola chat');
    expect(stripEmotionTags('Sin etiquetas')).toBe('Sin etiquetas');
    expect(stripEmotionTags('')).toBe('');
    // Corchetes que no son una etiqueta (cifras) se quedan
    expect(stripEmotionTags('Marcador [9/2/11]')).toBe('Marcador [9/2/11]');
  });
});

describe('registro del módulo', () => {
  it('«game» viaja a la nube con su clave de localStorage', () => {
    expect(CONFIG_MODULES).toContain('game');
    expect(MODULE_STORAGE_KEYS.game).toBe('lalo_game_settings');
    expect(GAME_STORAGE_KEY).toBe('lalo_game_settings');
  });

  it('la fuente de OBS es app=game, con la voz pero sin leer el chat', () => {
    const url = buildSuiteWidgetUrl('https://lalo.test', 'game', 'canal', DEFAULT_SETTINGS, { gs: encodeGameSettings(DEFAULT_GAME_SETTINGS) });
    const query = new URLSearchParams(url.split('?')[1]);
    expect(query.get('app')).toBe('game');
    expect(query.get('channel')).toBe('canal');
    expect(decodeGameSettings(query.get('gs'))).toEqual(DEFAULT_GAME_SETTINGS);
    // Igual que la fuente de la mascota: mismos parámetros de voz
    const pets = new URLSearchParams(buildSuiteWidgetUrl('https://lalo.test', 'pets', 'canal', DEFAULT_SETTINGS).split('?')[1]);
    const names = (q: URLSearchParams) => [...q.keys()].filter((key) => key !== 'gs' && key !== 'app').sort();
    expect(names(query)).toEqual(names(pets));
  });

  it('el aviso de no afiliación es el texto oficial, con el nombre del producto, y tiene traducción', () => {
    expect(RIOT_DISCLAIMER_EN).toBe(
      "Lalo Stream Suite isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc."
    );
    expect(RIOT_DISCLAIMER_ES).toContain('Lalo Stream Suite no está respaldada por Riot Games');
    expect(RIOT_DISCLAIMER_ES).toContain('Riot Games, Inc.');
  });
});
