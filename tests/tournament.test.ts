import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TOURNAMENT_COMMANDS,
  DEFAULT_TOURNAMENT_SETTINGS,
  TOURNAMENT_LIMITS,
  type TournamentSize,
  type TournamentState,
  decodeTournamentSettings,
  decodeTournamentState,
  emptyTournamentState,
  encodeTournamentSettings,
  normalizeTournamentSettings,
  normalizeTournamentState,
} from '../src/types/tournament';
import {
  advanceTo,
  applyWinner,
  buildBracket,
  championOf,
  cleanResults,
  currentMatch,
  feedersOf,
  inkFor,
  interpretTournamentCommand,
  isNewerState,
  matchName,
  matchTeams,
  narration,
  narrationLine,
  nextAfter,
  parentOf,
  playableCount,
  playedCount,
  replaceTeams,
  resetTournament,
  resizeTournament,
  roundMatches,
  roundOf,
  roundTitle,
  sampleFinishedState,
  sampleTournamentState,
  sceneNow,
  seedSlots,
  showScene,
  shuffleTeams,
  standings,
  undoLast,
} from '../src/utils/tournamentLogic';
import { routeTournamentSignal } from '../src/components/estudio/boxes/torneo';
import { PHASE_BOXES } from '../src/components/estudio/boxes';
import { MODULE_STORAGE_KEYS } from '../src/lib/cloudConfig';
import { CONFIG_MODULES } from '../src/lib/cloudTypes';
import { ANNOUNCER_VOICE_ID } from '../src/types/raid';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import { LAYER_TYPES } from '../src/types/studio';
import { extractPrimaryEmotion, normalizeTextForFishAudio, stripEmotionTags } from '../src/utils/emotionMapper';
import { buildSuiteWidgetUrl } from '../src/utils/widgetUrl';

const NAMES = ['Lobos del Sur', 'Dragones Rojos', 'Nexo Roto', 'Tormenta LAN', 'Furia Andina', 'Cóndor Gaming', 'Kraken Norte', 'Barón Dormido'];

/** Un torneo con `count` equipos en una llave de `size`. */
function tournament(count: number, size: TournamentSize = 8): TournamentState {
  const names = Array.from({ length: count }, (_, i) => NAMES[i] ?? `Equipo ${i + 1}`);
  return normalizeTournamentState({ size, teams: names.map((name, i) => ({ id: `t${i + 1}`, name })) });
}

/** Juega la partida en curso: gana el primero de los dos, o el segundo con `second`. */
function play(state: TournamentState, second = false, now = 1000): TournamentState {
  const match = currentMatch(state);
  if (match === null) throw new Error('No hay partida en juego');
  const next = applyWinner(state, matchTeams(state, match)![second ? 1 : 0], now);
  if (!next) throw new Error('El ganador no se aceptó');
  return next;
}

const options = { victorySec: 5, now: 50_000 };
const run = (message: string, state: TournamentState, commands = DEFAULT_TOURNAMENT_COMMANDS) =>
  interpretTournamentCommand(message, commands, state, options);

describe('torneos: la llave', () => {
  it('de 4, 8 y 16 equipos tiene sus rondas y una partida menos que equipos', () => {
    expect(roundMatches(4)).toEqual([[0, 1], [2]]);
    expect(roundMatches(8)).toEqual([[0, 1, 2, 3], [4, 5], [6]]);
    expect(roundMatches(16).map((list) => list.length)).toEqual([8, 4, 2, 1]);
    ([4, 8, 16] as const).forEach((size) => {
      expect(buildBracket(tournament(size, size))).toHaveLength(size - 1);
      expect(emptyTournamentState(size).results).toHaveLength(size - 1);
    });
  });

  it('cada partida sabe de cuáles viene y a cuál va', () => {
    expect(feedersOf(0, 8)).toBeNull();
    expect(feedersOf(4, 8)).toEqual([0, 1]);
    expect(feedersOf(5, 8)).toEqual([2, 3]);
    expect(feedersOf(6, 8)).toEqual([4, 5]);
    expect(feedersOf(14, 16)).toEqual([12, 13]);
    expect(parentOf(3, 8)).toBe(5);
    expect(parentOf(6, 8)).toBeNull();
    expect(parentOf(7, 16)).toBe(11);
    expect(roundOf(11, 16)).toBe(1);
    expect(feedersOf(2, 4)).toEqual([0, 1]);
  });

  it('nombra rondas y partidas según el tamaño', () => {
    expect([0, 1, 2].map((round) => roundTitle(round, 8))).toEqual(['Cuartos de final', 'Semifinales', 'Final']);
    expect([0, 1, 2, 3].map((round) => roundTitle(round, 16))).toEqual(['Octavos de final', 'Cuartos de final', 'Semifinales', 'Final']);
    expect([0, 1].map((round) => roundTitle(round, 4))).toEqual(['Semifinales', 'Final']);
    expect(matchName(0, 8)).toBe('Cuartos 1');
    expect(matchName(5, 8)).toBe('Semifinal 2');
    expect(matchName(6, 8)).toBe('Final');
    expect(matchName(7, 16)).toBe('Octavos 8');
    expect(matchName(1, 4)).toBe('Semifinal 2');
    expect(advanceTo(0, 16)).toBe('cuartos de final');
    expect(advanceTo(0, 8)).toBe('semifinales');
    expect(advanceTo(4, 8)).toBe('la final');
    expect(advanceTo(6, 8)).toBe('');
  });

  it('completa, empareja a los equipos en su orden de siembra', () => {
    const state = tournament(8);
    expect(buildBracket(state).slice(0, 4).map((match) => match.sides)).toEqual([[0, 1], [2, 3], [4, 5], [6, 7]]);
    expect(currentMatch(state)).toBe(0);
    expect(nextAfter(state, 0)).toBe(1);
    expect(matchTeams(state, 4)).toBeNull();
    expect(championOf(state)).toBeNull();
  });

  it('se juega entera hasta el campeón', () => {
    ([4, 8, 16] as const).forEach((size) => {
      let state = tournament(size, size);
      for (let i = 0; i < size - 1; i += 1) state = play(state, i % 2 === 1);
      expect(currentMatch(state)).toBeNull();
      expect(championOf(state)).not.toBeNull();
      expect(state.scene).toBe('campeon');
      expect(playedCount(state)).toBe(size - 1);
      expect(state.history).toHaveLength(size - 1);
    });
  });
});

describe('torneos: pases directos', () => {
  it('con menos equipos que huecos, los primeros de la lista quedan solos en su partida', () => {
    expect(seedSlots(8, 8)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(seedSlots(5, 8)).toEqual([0, null, 1, null, 2, null, 3, 4]);
    expect(seedSlots(3, 4)).toEqual([0, null, 1, 2]);
    expect(seedSlots(2, 8)).toEqual([0, null, 1, null, null, null, null, null]);
    expect(seedSlots(0, 4)).toEqual([null, null, null, null]);
    // Ninguna siembra repite equipo ni deja a ninguno fuera
    for (const size of [4, 8, 16]) {
      for (let count = 0; count <= size; count += 1) {
        expect(seedSlots(count, size).filter((slot) => slot !== null)).toEqual(Array.from({ length: count }, (_, i) => i));
      }
    }
  });

  it('quien pasa directo llega a la siguiente ronda sin sumar victoria', () => {
    let state = tournament(5);
    const bracket = buildBracket(state);
    expect(bracket[0]).toMatchObject({ sides: [0, 'bye'], out: 0, played: false });
    expect(bracket[4].sides).toEqual([0, 1]);
    expect(bracket[5].sides).toEqual([2, null]);
    // La única partida de cuartos que se juega es la de los dos últimos
    expect(currentMatch(state)).toBe(3);
    expect(playableCount(state)).toBe(4);
    state = play(state);
    expect(matchTeams(state, 5)).toEqual([2, 3]);
    expect(standings(state).find((row) => row.team === 0)).toMatchObject({ wins: 0, losses: 0, status: 'En carrera' });
    expect(standings(state).find((row) => row.team === 3)).toMatchObject({ wins: 1 });
    expect(standings(state).find((row) => row.team === 4)).toMatchObject({ losses: 1, status: 'Fuera en cuartos de final' });
  });

  it('con muy pocos equipos la llave se resuelve con las partidas que hay', () => {
    let state = tournament(2);
    expect(currentMatch(state)).toBe(4);
    expect(championOf(state)).toBeNull();
    state = play(state, true);
    // La final no tiene rival: quien gana la única partida es campeón
    expect(championOf(state)).toBe(1);
    expect(state.scene).toBe('campeon');

    expect(currentMatch(tournament(1))).toBeNull();
    expect(championOf(tournament(1))).toBeNull();
    expect(currentMatch(tournament(0, 4))).toBeNull();
    expect(playableCount(tournament(0, 4))).toBe(0);
  });
});

describe('torneos: ganador, deshacer y reiniciar', () => {
  it('marcar ganador avanza la llave, enseña la victoria y sube la versión', () => {
    const before = tournament(8);
    const after = applyWinner(before, 1, 7000)!;
    expect(before.results[0]).toBeNull();
    expect(after.results[0]).toBe(1);
    expect(after).toMatchObject({ history: [0], last: 0, scene: 'victoria', sceneAt: 7000, cueAt: 7000, version: before.version + 1 });
    expect(isNewerState(after, before)).toBe(true);
    expect(currentMatch(after)).toBe(1);
    // Solo vale uno de los dos que juegan
    expect(applyWinner(before, 5, 7000)).toBeNull();
    expect(applyWinner(sampleFinishedState(8), 0, 7000)).toBeNull();
  });

  it('la pantalla de victoria caduca sola y vuelve a la llave', () => {
    const state = applyWinner(tournament(8), 0, 10_000)!;
    expect(sceneNow(state, 5, 10_000)).toBe('victoria');
    expect(sceneNow(state, 5, 14_999)).toBe('victoria');
    expect(sceneNow(state, 5, 15_000)).toBe('llave');
    // Con campeón, la victoria es la del campeón y no caduca
    const done = sampleFinishedState(4);
    expect(sceneNow({ ...done, scene: 'victoria' }, 5, 9e12)).toBe('campeon');
    // «Sigue» sin partida que anunciar
    expect(sceneNow({ ...done, scene: 'sigue' }, 5, 0)).toBe('campeon');
    expect(sceneNow({ ...tournament(1), scene: 'sigue' }, 5, 0)).toBe('llave');
  });

  it('deshacer borra el último resultado, de uno en uno, sin llamar al narrador', () => {
    let state = play(play(tournament(8), false, 1000), true, 2000);
    expect(state.history).toEqual([0, 1]);
    const undone = undoLast(state, 3000)!;
    expect(undone.results.slice(0, 2)).toEqual([0, null]);
    expect(undone).toMatchObject({ history: [0], last: 0, scene: 'llave', sceneAt: 3000, cueAt: 2000 });
    expect(undone.version).toBe(state.version + 1);
    state = undoLast(undone, 4000)!;
    expect(state).toMatchObject({ history: [], last: null });
    expect(undoLast(state, 5000)).toBeNull();
    // Deshacer la final quita al campeón
    expect(championOf(undoLast(sampleFinishedState(8), 1)!)).toBeNull();
  });

  it('reiniciar deja la llave vacía con los mismos equipos', () => {
    const done = sampleFinishedState(8);
    const fresh = resetTournament(done, 9000);
    expect(fresh.teams).toEqual(done.teams);
    expect(fresh.results.every((winner) => winner === null)).toBe(true);
    expect(fresh).toMatchObject({ history: [], last: null, scene: 'llave', cueAt: 9000 });
    expect(fresh.version).toBeGreaterThan(done.version);
  });

  it('cambiar de pantalla no repite la que ya se ve', () => {
    const state = tournament(8);
    expect(showScene(state, 'llave', 5, 100)).toBe(state);
    const table = showScene(state, 'tabla', 5, 100);
    expect(table).toMatchObject({ scene: 'tabla', sceneAt: 100, cueAt: 100 });
    expect(showScene(table, 'tabla', 5, 200)).toBe(table);
    // Ocultar no es algo que narrar
    expect(showScene(table, 'oculto', 5, 300)).toMatchObject({ scene: 'oculto', cueAt: 100 });
  });

  it('sembrar: renombrar conserva la llave; añadir, quitar, mover, sortear o cambiar de tamaño la reinician', () => {
    const state = play(tournament(8));
    const renamed = replaceTeams(state, state.teams.map((team, i) => (i === 0 ? { ...team, name: 'Otro nombre' } : team)), 10);
    expect(renamed.results[0]).toBe(0);
    expect(renamed.teams[0].name).toBe('Otro nombre');

    const fewer = replaceTeams(state, state.teams.slice(1), 10);
    expect(fewer.results.every((winner) => winner === null)).toBe(true);
    expect(fewer.history).toEqual([]);

    const swapped = replaceTeams(state, [state.teams[1], state.teams[0], ...state.teams.slice(2)], 10);
    expect(swapped.history).toEqual([]);

    const shuffled = shuffleTeams(state, 10, () => 0);
    expect(shuffled.teams.map((team) => team.id).sort()).toEqual(state.teams.map((team) => team.id).sort());
    expect(shuffled.teams.map((team) => team.id)).not.toEqual(state.teams.map((team) => team.id));
    expect(shuffled.history).toEqual([]);

    const small = resizeTournament(state, 4, 10);
    expect(small).toMatchObject({ size: 4, history: [] });
    expect(small.teams).toHaveLength(4);
    expect(small.results).toHaveLength(3);
    expect(resizeTournament(state, 8, 10)).toBe(state);
  });
});

describe('torneos: tabla', () => {
  it('ordena al campeón, a los que siguen y a los eliminados', () => {
    let state = tournament(8);
    expect(standings(state).map((row) => row.team)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    state = play(state);
    const rows = standings(state);
    expect(rows[0]).toMatchObject({ team: 0, wins: 1, losses: 0, out: null, status: 'En carrera' });
    expect(rows[rows.length - 1]).toMatchObject({ team: 1, wins: 0, losses: 1, out: 0, status: 'Fuera en cuartos de final' });

    const done = standings(sampleFinishedState(8));
    expect(done[0]).toMatchObject({ team: 0, champ: true, wins: 3, status: 'Campeón' });
    expect(done[1]).toMatchObject({ wins: 2, status: 'Finalista' });
    expect(done.filter((row) => row.status === 'Fuera en semifinal')).toHaveLength(2);
    expect(done.filter((row) => row.status === 'Fuera en cuartos de final')).toHaveLength(4);
    expect(done.reduce((sum, row) => sum + row.wins, 0)).toBe(7);
  });
});

describe('torneos: comandos', () => {
  it('!ganador acepta el principio del nombre, sin tildes ni mayúsculas, o 1 y 2', () => {
    const state = tournament(8);
    expect(run('!ganador lobos', state)?.state?.results[0]).toBe(0);
    expect(run('!GANADOR Dragones Rojos', state)?.state?.results[0]).toBe(1);
    expect(run('!ganador 2', state)?.state?.results[0]).toBe(1);
    expect(run('  !ganador   1 ', state)?.state?.results[0]).toBe(0);
    const third = play(play(tournament(8)));
    expect(run('!ganador condor', third)?.state?.results[2]).toBe(5);
    expect(run('!ganador lobos', state)).toMatchObject({ ok: true, reply: 'Hecho: Lobos del Sur gana cuartos 1.' });
  });

  it('un equipo que no juega, uno ambiguo o ninguno no cambian nada, pero el comando era suyo', () => {
    const state = tournament(8);
    for (const message of ['!ganador kraken', '!ganador', '!ganador 3', '!ganador <b>']) {
      const result = run(message, state);
      expect(result).toMatchObject({ ok: false, state: null });
      expect(result?.reply).toContain('Lobos del Sur');
    }
    const twins = normalizeTournamentState({ size: 4, teams: [{ name: 'Los Lobos' }, { name: 'Los Leones' }, { name: 'Los' }, { name: 'Lospa' }] });
    expect(run('!ganador los', twins)).toMatchObject({ ok: false, state: null });
    expect(run('!ganador los', twins)?.reply).toContain('vale para los dos');
    expect(run('!ganador los le', twins)?.state?.results[0]).toBe(1);
    // El nombre exacto gana al que solo empieza igual
    const second = play(twins);
    expect(run('!ganador los', second)?.state?.results[1]).toBe(2);
  });

  it('con el torneo terminado o sin equipos, lo dice', () => {
    expect(run('!ganador lobos', sampleFinishedState(8))).toEqual({ ok: false, reply: 'El torneo ya terminó.', state: null });
    expect(run('!ganador lobos', tournament(1))?.reply).toContain('faltan equipos');
    expect(run('!deshacer', tournament(8))).toEqual({ ok: false, reply: 'No hay resultados que deshacer.', state: null });
    expect(run('!deshacer', play(tournament(8)))?.state?.history).toEqual([]);
  });

  it('!torneo cambia de pantalla, oculta y reinicia', () => {
    const state = tournament(8);
    expect(run('!torneo tabla', state)?.state?.scene).toBe('tabla');
    expect(run('!torneo sigue', state)?.state?.scene).toBe('sigue');
    expect(run('!torneo siguiente', state)?.state?.scene).toBe('sigue');
    expect(run('!torneo campeón', state)?.state?.scene).toBe('campeon');
    expect(run('!torneo ocultar', state)?.state?.scene).toBe('oculto');
    expect(run('!torneo llave', state)).toMatchObject({ ok: true, state: null });
    expect(run('!torneo reiniciar', play(state))?.state?.history).toEqual([]);
    expect(run('!torneo', state)).toMatchObject({ ok: false, state: null });
    expect(run('!torneo bailar', state)?.reply).toContain('llave, sigue, tabla');
  });

  it('lo que no es un comando del torneo devuelve null', () => {
    const state = tournament(8);
    for (const message of ['hola', '!so lobos', '!ganadores lobos', 'ganador lobos', '', '!torneos llave']) expect(run(message, state)).toBeNull();
  });

  it('respeta los nombres que el streamer les haya puesto', () => {
    const commands = normalizeTournamentSettings({ commands: { winner: 'Gana', undo: '!atras', main: '!copa' } }).commands;
    expect(commands).toEqual({ winner: '!gana', undo: '!atras', main: '!copa' });
    const state = tournament(8);
    expect(run('!gana lobos', state, commands)?.state?.results[0]).toBe(0);
    expect(run('!copa tabla', state, commands)?.state?.scene).toBe('tabla');
    expect(run('!atras', play(state), commands)?.ok).toBe(true);
    expect(run('!ganador lobos', state, commands)).toBeNull();
    expect(run('!torneo tabla', state, commands)).toBeNull();
  });
});

describe('torneos: narrador', () => {
  const KNOWN = ['shouting', 'excited', 'happy', 'calm'];

  it('cada frase lleva al principio una emoción que la voz reconoce', () => {
    const first = applyWinner(tournament(8), 0, 1000)!;
    const cases: [TournamentState, Parameters<typeof narration>[1]][] = [
      [tournament(8), 'llave'],
      [tournament(8), 'sigue'],
      [tournament(8), 'tabla'],
      [tournament(8), 'campeon'],
      [first, 'victoria'],
      [first, 'tabla'],
      [sampleFinishedState(8), 'campeon'],
      [sampleFinishedState(8), 'victoria'],
      [sampleFinishedState(8), 'tabla'],
      [sampleFinishedState(8), 'sigue'],
      [tournament(0), 'llave'],
      [tournament(0), 'tabla'],
      [tournament(1), 'sigue'],
    ];
    cases.forEach(([state, scene]) => {
      const line = narrationLine(state, scene, 'Copa Lalo')!;
      expect(line).toMatch(/^\[(gritando|emocionado|feliz|calmado)\] \S/);
      expect(KNOWN).toContain(extractPrimaryEmotion(line)?.tag);
      expect(normalizeTextForFishAudio(line)).toMatch(/^\[(shouting|excited|happy|calm)\] /);
      expect(stripEmotionTags(line)).toBe(narration(state, scene, 'Copa Lalo')!.text);
    });
  });

  it('cuenta lo que pasa en cada pantalla', () => {
    const start = tournament(8);
    expect(narration(start, 'llave', 'Copa Lalo')).toEqual({ emotion: 'feliz', text: 'Esta es la llave de Copa Lalo. Van 0 de 7 partidas, y ahora se juega cuartos 1.' });
    expect(narration(start, 'sigue', 'Copa Lalo')).toEqual({ emotion: 'emocionado', text: 'Sigue cuartos 1: Lobos del Sur contra Dragones Rojos.' });
    const first = applyWinner(start, 1, 1000)!;
    expect(narration(first, 'victoria', 'Copa Lalo')).toEqual({ emotion: 'gritando', text: '¡Victoria de Dragones Rojos! Avanza a semifinales.' });
    expect(narration(first, 'tabla', 'Copa Lalo')?.text).toContain('Siguen en carrera 7 equipos');
    expect(narration(first, 'tabla', 'Copa Lalo')?.text).toContain('Ya hay un eliminado.');
    let semi = tournament(4);
    semi = play(semi);
    expect(narration(semi, 'victoria', 'Copa')?.text).toBe('¡Victoria de Lobos del Sur! Avanza a la gran final.');
    const done = sampleFinishedState(8);
    expect(narration(done, 'campeon', 'Copa Lalo')).toEqual({ emotion: 'gritando', text: '¡Tenemos campeón! Lobos del Sur gana Copa Lalo. ¡Felicidades!' });
    expect(narration(done, 'tabla', 'Copa Lalo')?.text).toMatch(/^Tabla final: primero Lobos del Sur, segundo /);
    expect(narration(start, 'campeon', 'Copa Lalo')?.emotion).toBe('calmado');
  });

  it('con la capa oculta no dice nada', () => {
    expect(narration(tournament(8), 'oculto', 'Copa')).toBeNull();
    expect(narrationLine(tournament(8), 'oculto', 'Copa')).toBeNull();
  });
});

describe('torneos: normalización', () => {
  it('de cualquier cosa salen unos ajustes válidos', () => {
    for (const raw of [null, undefined, 7, 'x', [], {}]) expect(normalizeTournamentSettings(raw)).toEqual(DEFAULT_TOURNAMENT_SETTINGS);
    expect(DEFAULT_TOURNAMENT_SETTINGS.voiceId).toBe(ANNOUNCER_VOICE_ID);
    const odd = normalizeTournamentSettings({
      size: 6,
      teamSize: 99,
      style: 'neon',
      color: 'rojo',
      victorySec: 900,
      voiceId: '../../x',
      name: '   ',
      sponsors: 'muchos',
      commands: { winner: '!x', undo: '!x', main: '!y' },
    });
    expect(odd).toMatchObject({ size: 8, teamSize: 5, style: 'grieta', color: DEFAULT_TOURNAMENT_SETTINGS.color, victorySec: 15, name: 'Copa Lalo', sponsors: [] });
    expect(odd.voiceId).toBe(ANNOUNCER_VOICE_ID);
    // Dos comandos iguales no se distinguirían
    expect(odd.commands).toEqual(DEFAULT_TOURNAMENT_COMMANDS);
    expect(normalizeTournamentSettings({ size: '16', teamSize: '1', style: 'cartel', color: '#AABBCC', customColor: true })).toMatchObject({
      size: 16,
      teamSize: 1,
      style: 'cartel',
      color: '#aabbcc',
      customColor: true,
    });
    expect(normalizeTournamentSettings({ commands: { winner: '!con espacio', undo: '!', main: '!demasiado_largo_para_un_comando' } }).commands).toEqual(
      DEFAULT_TOURNAMENT_COMMANDS
    );
  });

  it('de cualquier cosa sale un estado válido', () => {
    for (const raw of [null, 3, 'x', [], {}]) expect(normalizeTournamentState(raw)).toEqual(emptyTournamentState(8));
    const state = normalizeTournamentState({
      size: 4,
      teams: [{ id: 'a', name: 'Uno' }, { id: 'a', name: '' }, 'tres', { name: 'Cuatro' }, { name: 'Cinco' }, { name: 'Seis' }],
      scene: 'fiesta',
      sceneAt: -5,
      version: 'muchas',
    });
    expect(state.teams.map((team) => team.name)).toEqual(['Uno', 'Equipo 2', 'Cuatro', 'Cinco']);
    expect(new Set(state.teams.map((team) => team.id)).size).toBe(4);
    expect(state).toMatchObject({ size: 4, scene: 'llave', sceneAt: 0, version: 0, results: [null, null, null] });
    expect(normalizeTournamentState({ size: 16, teams: Array.from({ length: 30 }, (_, i) => ({ name: `E${i}` })) }).teams).toHaveLength(16);
  });

  it('un estado manipulado no corona a quien no jugó', () => {
    // La final sin semifinales, un ganador que no está en su partida y uno que no existe
    expect(cleanResults(8, 8, [null, null, null, null, null, null, 3])).toEqual([null, null, null, null, null, null, null]);
    expect(cleanResults(8, 8, [5, 2, 99, 'x', null, null, null])).toEqual([null, 2, null, null, null, null, null]);
    expect(cleanResults(8, 8, [0, 2, 4, 6, 0, 4, 0])).toEqual([0, 2, 4, 6, 0, 4, 0]);
    // Un pase directo no es un resultado
    expect(cleanResults(5, 8, [0, 1, 2, 3, 0, 2, 0])).toEqual([null, null, null, 3, 0, 2, 0]);

    const forged = normalizeTournamentState({ size: 8, teams: NAMES.map((name) => ({ name })), results: [null, null, null, null, null, null, 7], history: [6, 6, 2], last: 6 });
    expect(championOf(forged)).toBeNull();
    expect(forged).toMatchObject({ history: [], last: null });

    const partial = normalizeTournamentState({ size: 8, teams: NAMES.map((name) => ({ name })), results: [1, 2], history: [9, 1, 1], last: 4 });
    expect(partial.history).toEqual([1, 0]);
    expect(partial.last).toBe(0);
    // Normalizar dos veces da lo mismo
    expect(normalizeTournamentState(partial)).toEqual(partial);
    expect(normalizeTournamentState(sampleFinishedState(16))).toEqual(sampleFinishedState(16));
    expect(normalizeTournamentState(sampleTournamentState(4))).toEqual(sampleTournamentState(4));
  });

  it('ni los ajustes ni el estado admiten HTML', () => {
    const nasty = '<img src=x onerror=alert(1)>Lobos</b>[gritando]\u0000\n  del   Sur';
    const settings = normalizeTournamentSettings({ name: nasty, game: '<script>x</script>', sponsors: [{ id: '<i>', name: nasty }] });
    const state = normalizeTournamentState({ teams: [{ id: '"><svg>', name: nasty, captain: '<b>Cap#LAN</b>', players: ['<u>uno</u>', 7, '[feliz] dos'] }] });
    const all = JSON.stringify([settings, state]);
    expect(all).not.toMatch(/[<>]/);
    // Los corchetes serían etiquetas de emoción para la voz
    expect(state.teams[0].name).toBe('Lobos del Sur');
    expect(JSON.stringify(state.teams.map((team) => [team.name, team.captain, ...team.players]))).not.toMatch(/gritando|feliz/);
    expect(state.teams[0].name.length).toBeLessThanOrEqual(TOURNAMENT_LIMITS.team);
    expect(state.teams[0].name).not.toMatch(/[\u0000-\u001f]/);
    expect(state.teams[0].id).toMatch(/^[a-z0-9_-]+$/);
    expect(settings.sponsors[0].id).toMatch(/^[a-z0-9_-]+$/);
    expect(state.teams[0].players).toEqual(['uno', 'dos']);
    expect(settings.name.length).toBeLessThanOrEqual(TOURNAMENT_LIMITS.name);
  });

  it('las imágenes solo admiten direcciones que una <img> carga sin ejecutar nada', () => {
    const image = (url: unknown) => normalizeTournamentSettings({ logo: { url, name: 'logo.png', mediaId: 'm1' } }).logo;
    for (const url of ['https://cdn.example/logo.png', 'r2:abc/logo.webp', 'data:image/png;base64,AAAA', 'blob:https://lalo.example/1', '/logo.svg']) {
      expect(image(url)?.url).toBe(url);
    }
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'http://inseguro.example/a.png', 'file:///c:/a.png', 'vbscript:x', '', 7, null]) {
      expect(image(url)).toBeNull();
    }
    const sponsors = normalizeTournamentSettings({
      sponsors: [
        { name: 'Café Aurora', image: { url: 'javascript:alert(1)' } },
        { name: '', image: { url: 'data:text/html,x' } },
        { name: '', image: { url: 'https://cdn.example/s.png' } },
        ...Array.from({ length: 9 }, (_, i) => ({ name: `S${i}` })),
      ],
    }).sponsors;
    expect(sponsors).toHaveLength(TOURNAMENT_LIMITS.sponsors);
    expect(sponsors[0]).toMatchObject({ name: 'Café Aurora', image: null });
    expect(sponsors[1].image?.url).toBe('https://cdn.example/s.png');
    expect(new Set(sponsors.map((sponsor) => sponsor.id)).size).toBe(sponsors.length);
  });

  it('el color propio lleva una tinta que se lee', () => {
    expect(inkFor('#ffffff')).toBe('#121315');
    expect(inkFor('#3ddcff')).toBe('#121315');
    expect(inkFor('#ffb347')).toBe('#121315');
    expect(inkFor('#000000')).toBe('#ffffff');
    expect(inkFor('#9146ff')).toBe('#ffffff');
    expect(inkFor('no-es-color')).toBe('#ffffff');
  });
});

describe('torneos: nube, URL y Studio', () => {
  it('«tournament» viaja a la nube con su clave', () => {
    expect(CONFIG_MODULES).toContain('tournament');
    expect(MODULE_STORAGE_KEYS.tournament).toBe('lalo_tournament_settings');
  });

  it('la migración añade el módulo y conserva todos los que ya había', () => {
    const sql = readFileSync(new URL('../supabase/migrations/0016_tournament.sql', import.meta.url), 'utf8');
    const check = sql.slice(sql.indexOf('add constraint configs_module_check'));
    CONFIG_MODULES.forEach((module) => expect(check).toContain(`'${module}'`));
    expect(sql).not.toMatch(/create table|drop table/i);
  });

  it('los ajustes y la llave de reserva van y vuelven por la URL; lo que solo está en este navegador no viaja', () => {
    const settings = normalizeTournamentSettings({
      name: 'Copa Ñandú',
      size: 4,
      style: 'estadio',
      logo: { url: 'https://cdn.example/logo.png', name: 'logo.png', mediaId: 'm1' },
      sponsors: [{ id: 's1', name: 'TecnoRed', image: { url: 'data:image/png;base64,AAAA', name: 'a.png', mediaId: '' } }],
    });
    const state = play(tournament(4, 4));
    const param = encodeTournamentSettings(settings, state);
    expect(param).toMatch(/^[A-Za-z0-9_-]+$/);
    const back = decodeTournamentSettings(param)!;
    expect(back).toEqual({ ...settings, sponsors: [{ id: 's1', name: 'TecnoRed', image: null }] });
    expect(decodeTournamentState(param)).toEqual(state);
    expect(decodeTournamentState(encodeTournamentSettings(settings))).toBeNull();
    expect(decodeTournamentSettings('no-es-base64-válido')).toBeNull();
    expect(decodeTournamentState(null)).toBeNull();
  });

  it('la fuente de OBS lleva la voz y no las reglas del chat', () => {
    const url = buildSuiteWidgetUrl('https://lalo.example', 'tournament', 'canal', DEFAULT_SETTINGS, { ts: 'abc' });
    expect(url).toContain('app=tournament');
    expect(url).toContain('ts=abc');
    expect(url).toContain('voice=');
    expect(url).not.toContain('block=');
  });

  it('entre dos estados gana el más nuevo', () => {
    const a = { ...tournament(8), updatedAt: 100, version: 3 };
    expect(isNewerState({ ...a, updatedAt: 101, version: 1 }, a)).toBe(true);
    expect(isNewerState({ ...a, version: 4 }, a)).toBe(true);
    expect(isNewerState(a, a)).toBe(false);
    expect(isNewerState({ ...a, updatedAt: 99, version: 9 }, a)).toBe(false);
    // Un cambio hecho con el reloj atrasado sigue siendo más nuevo que el estado del que parte
    expect(isNewerState(applyWinner(a, 0, 5)!, a)).toBe(true);
  });

  it('Studio tiene la capa «Torneo» con su caja y su página', () => {
    const info = LAYER_TYPES.find((item) => item.id === 'tournament');
    expect(info).toMatchObject({ name: 'Torneo', w: 1920, h: 1080, page: { href: '#torneos', label: 'Torneos' } });
    expect(typeof PHASE_BOXES.tournament).toBe('function');
  });

  it('la caja de Studio pasa a la capa los comandos de moderación y la prueba del panel', () => {
    const layer = { command: vi.fn(() => true), test: vi.fn() };
    const sender = { name: 'mod', role: 'mod' as const };
    expect(routeTournamentSignal(layer, { kind: 'staff', message: '!ganador lobos', sender })).toBe(true);
    expect(layer.command).toHaveBeenCalledWith('!ganador lobos', sender);
    expect(routeTournamentSignal(layer, { kind: 'bus', message: { type: 'TOURNAMENT_TEST', say: true } })).toBe(false);
    expect(layer.test).toHaveBeenCalledWith(true);
    expect(routeTournamentSignal(layer, { kind: 'raid', channel: 'x', viewers: 3, login: 'x' })).toBe(false);
    expect(routeTournamentSignal(null, { kind: 'staff', message: '!ganador lobos', sender })).toBe(false);
    expect(layer.command).toHaveBeenCalledTimes(1);
  });
});
