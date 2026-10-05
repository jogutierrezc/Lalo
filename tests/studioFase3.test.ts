/**
 * tests/studioFase3.test.ts
 *
 * Studio, fase 3: el motor de la caja «Batalla» (arranque, votos, cuenta atrás,
 * cierre, estados que llegan de otra página, voz sin repeticiones), la muestra
 * de la caja «Ruleta» y las reglas que las dos cajas deben cumplir dentro de
 * una escena (registradas, sin medidas de ventana, fuera de «disponible pronto»).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INITIAL_POLL_SETTINGS } from '../src/types/polls';
import { DEFAULT_ROULETTE_SETTINGS } from '../src/types/roulette';
import { LAYER_TYPES } from '../src/types/studio';
import type { PollBattleUpdateEvent } from '../src/utils/bus';
import type { PollStartEvent } from '../src/utils/pollCommands';
import {
  EMPTY_POLL,
  POLL_COUNTDOWN_LINE,
  POLL_REPEAT_MS,
  PollEngine,
  PollStep,
  adoptPoll,
  clearPoll,
  createPollVoice,
  pollSettingsFromBus,
  pollStoppedLine,
  pollVisible,
  pollWinnerLine,
  samplePoll,
  startPoll,
  stopPoll,
  tickPoll,
  votePoll,
} from '../src/utils/pollBox';
import { ROULETTE_PREVIEW_SPIN_SEC, rouletteSample } from '../src/utils/rouletteBox';

const read = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8');

const POLL: PollStartEvent = {
  title: '¿Pizza o tacos?',
  optionA: { label: 'Pizza', color: '#00e5ff' },
  optionB: { label: 'Tacos' },
  durationSec: 30,
  startedBy: 'mar_ia',
  startedByRole: 'mod',
};

const sounds = (step: PollStep) => step.effects.flatMap((effect) => (effect.kind === 'sound' ? [effect.sound] : []));
const lines = (step: PollStep) => step.effects.flatMap((effect) => (effect.kind === 'say' ? [effect.text] : []));
const started = () => startPoll(EMPTY_POLL, POLL).engine;
const votes = (engine: PollEngine) => [engine.battle?.optionA.votes, engine.battle?.optionB.votes];
/** Deja pasar `seconds` segundos y devuelve el último paso. */
const wait = (engine: PollEngine, seconds: number): PollStep => {
  let step: PollStep = { engine, effects: [] };
  for (let i = 0; i < seconds; i += 1) step = tickPoll(step.engine);
  return step;
};

describe('Batalla en Studio: arranque', () => {
  it('empieza a cero, en marcha y con la cuenta atrás completa', () => {
    const step = startPoll(EMPTY_POLL, POLL);
    const battle = step.engine.battle!;
    expect(battle.isActive).toBe(true);
    expect(battle.winner).toBeNull();
    expect(battle.timeLeftSec).toBe(30);
    expect(battle.totalDurationSec).toBe(30);
    expect(votes(step.engine)).toEqual([0, 0]);
    expect(step.engine.own).toBe(true);
    expect(pollVisible(battle)).toBe(true);
  });

  it('toma los colores del aviso y pone los de siempre si faltan', () => {
    const battle = started().battle!;
    expect(battle.optionA.color).toBe('#00e5ff');
    expect(battle.optionB.color).toBe('#ff0055');
  });

  it('suena el aviso y anuncia quién la abrió y cómo se vota', () => {
    const step = startPoll(EMPTY_POLL, POLL);
    expect(sounds(step)).toEqual(['notice']);
    expect(lines(step)).toHaveLength(1);
    expect(lines(step)[0]).toContain('mar_ia');
    expect(lines(step)[0]).toContain('¿Pizza o tacos?');
    expect(lines(step)[0]).toContain('30 segundos');
  });

  it('cada batalla nueva cambia de id y olvida los votos de la anterior', () => {
    const first = votePoll(started(), 'ana', 0, true).engine;
    const second = startPoll(first, POLL).engine;
    expect(second.id).toBe(first.id + 1);
    expect(votes(second)).toEqual([0, 0]);
    expect(second.voters.size).toBe(0);
    expect(votes(votePoll(second, 'ana', 0, false).engine)).toEqual([1, 0]);
  });
});

describe('Batalla en Studio: votos', () => {
  it('sin batalla en marcha un voto no hace nada', () => {
    expect(votePoll(EMPTY_POLL, 'ana', 0, true)).toEqual({ engine: EMPTY_POLL, effects: [] });
  });

  it('cuenta un voto por persona, sin distinguir mayúsculas ni espacios', () => {
    let engine = votePoll(started(), 'Ana', 0, false).engine;
    engine = votePoll(engine, ' ana ', 0, false).engine;
    engine = votePoll(engine, 'ANA', 1, false).engine;
    expect(votes(engine)).toEqual([1, 0]);
  });

  it('con cambio de voto permitido, pasa el voto al otro lado sin duplicarlo', () => {
    let engine = votePoll(started(), 'ana', 0, true).engine;
    engine = votePoll(engine, 'ana', 1, true).engine;
    expect(votes(engine)).toEqual([0, 1]);
    // Repetir el mismo voto no suma ni suena
    const again = votePoll(engine, 'ana', 1, true);
    expect(again.engine).toBe(engine);
    expect(again.effects).toEqual([]);
  });

  it('cada voto suena con el tono de su lado', () => {
    const a = votePoll(started(), 'ana', 0, true);
    expect(sounds(a)).toContain('tick-a');
    const b = votePoll(a.engine, 'leo', 1, true);
    expect(sounds(b)).toEqual(['tick-b']);
  });

  it('el choque suena solo cuando cambia quién va delante', () => {
    const first = votePoll(started(), 'ana', 0, true);
    expect(sounds(first)).toEqual(['clash', 'tick-a']);
    const more = votePoll(first.engine, 'leo', 0, true);
    expect(sounds(more)).toEqual(['tick-a']);
    // Empate: nadie toma la delantera
    let engine = votePoll(more.engine, 'eva', 1, true).engine;
    const tie = votePoll(engine, 'gus', 1, true);
    expect(sounds(tie)).toEqual(['tick-b']);
    engine = tie.engine;
    expect(sounds(votePoll(engine, 'rut', 1, true))).toEqual(['clash', 'tick-b']);
  });

  it('un nombre raro no rompe el recuento', () => {
    let engine = votePoll(started(), '__proto__', 0, true).engine;
    engine = votePoll(engine, 'constructor', 1, true).engine;
    engine = votePoll(engine, '', 1, true).engine;
    expect(votes(engine)).toEqual([1, 2]);
  });
});

describe('Batalla en Studio: cuenta atrás y cierre', () => {
  it('cada paso quita un segundo', () => {
    const step = tickPoll(started());
    expect(step.engine.battle?.timeLeftSec).toBe(29);
    expect(step.effects).toEqual([]);
  });

  it('a los 10 segundos avisa con un pitido y una frase; en los últimos 5, un pitido por segundo', () => {
    const at10 = wait(started(), 20);
    expect(at10.engine.battle?.timeLeftSec).toBe(10);
    expect(sounds(at10)).toEqual(['beep']);
    expect(lines(at10)).toEqual([POLL_COUNTDOWN_LINE]);
    const at9 = tickPoll(at10.engine);
    expect(at9.effects).toEqual([]);
    const at5 = wait(at9.engine, 4);
    expect(at5.engine.battle?.timeLeftSec).toBe(5);
    expect(sounds(at5)).toEqual(['beep']);
    expect(lines(at5)).toEqual([]);
  });

  it('al llegar a cero se cierra con su ganador, la fanfarria y la frase del resultado', () => {
    let engine = votePoll(started(), 'ana', 1, true).engine;
    engine = votePoll(engine, 'leo', 1, true).engine;
    engine = votePoll(engine, 'eva', 0, true).engine;
    const end = wait(engine, 30);
    const battle = end.engine.battle!;
    expect(battle.isActive).toBe(false);
    expect(battle.winner).toBe('B');
    expect(battle.timeLeftSec).toBe(0);
    expect(sounds(end)).toEqual(['fanfare']);
    expect(lines(end)[0]).toContain('Tacos');
    expect(lines(end)[0]).toContain('67 por ciento');
    expect(pollVisible(battle)).toBe(true);
  });

  it('sin votos o igualada, termina en empate', () => {
    const end = wait(started(), 30);
    expect(end.engine.battle?.winner).toBe('TIE');
    expect(lines(end)[0]).toContain('empate');
  });

  it('una batalla cerrada no sigue contando ni admite votos', () => {
    const end = wait(started(), 30).engine;
    expect(tickPoll(end)).toEqual({ engine: end, effects: [] });
    expect(votePoll(end, 'ana', 0, true).engine).toBe(end);
  });

  it('la frase del resultado da el porcentaje del lado que gana', () => {
    const battle = { ...started().battle!, optionA: { ...started().battle!.optionA, votes: 3 }, optionB: { ...started().battle!.optionB, votes: 1 } };
    expect(pollWinnerLine(battle, 'A')).toContain('Pizza con 75 por ciento');
    expect(pollWinnerLine(battle, 'B')).toContain('Tacos con 25 por ciento');
  });

  it('cancelarla la retira y lo dice; si no había ninguna en marcha, calla', () => {
    const stop = stopPoll(started(), 'mar_ia');
    expect(stop.engine.battle).toBeNull();
    expect(lines(stop)).toEqual([pollStoppedLine('mar_ia')]);
    expect(lines(stop)[0]).toContain('el moderador mar_ia');
    expect(pollStoppedLine('Streamer')).toContain('el streamer');
    expect(stopPoll(EMPTY_POLL, 'mar_ia').effects).toEqual([]);
  });

  it('limpiar la retira sin decir nada y conserva el id', () => {
    const engine = started();
    const cleared = clearPoll(engine);
    expect(cleared.battle).toBeNull();
    expect(cleared.id).toBe(engine.id);
    expect(pollVisible(cleared.battle)).toBe(false);
  });
});

describe('Batalla en Studio: estados que llegan de otra página', () => {
  const remote = (patch: Partial<PollBattleUpdateEvent> = {}): PollBattleUpdateEvent => ({
    title: 'Batalla de demostración',
    optionA: { id: 'opt-a', label: 'Pizza', color: '#00e5ff', accentGlow: '#00e5ff', votes: 14 },
    optionB: { id: 'opt-b', label: 'Tacos', color: '#ff0055', accentGlow: '#ff0055', votes: 10 },
    totalDurationSec: 45,
    timeLeftSec: 45,
    isActive: true,
    winner: null,
    ...patch,
  });

  it('sin batalla propia, enseña la que llega y no lleva su cuenta atrás', () => {
    const step = adoptPoll(EMPTY_POLL, remote());
    expect(step.effects).toEqual([]);
    expect(step.engine.own).toBe(false);
    expect(step.engine.id).toBe(EMPTY_POLL.id + 1);
    expect(votes(step.engine)).toEqual([14, 10]);
    expect(tickPoll(step.engine).engine).toBe(step.engine);
  });

  it('las actualizaciones de la misma batalla ajena no la montan de nuevo', () => {
    const first = adoptPoll(EMPTY_POLL, remote()).engine;
    const next = adoptPoll(first, remote({ timeLeftSec: 44 })).engine;
    expect(next.id).toBe(first.id);
    expect(next.battle?.timeLeftSec).toBe(44);
  });

  it('en una batalla propia toma los votos de fuera pero el reloj sigue siendo el suyo', () => {
    const engine = wait(started(), 3).engine;
    const step = adoptPoll(engine, remote({ title: POLL.title, timeLeftSec: 29 }));
    expect(step.engine.own).toBe(true);
    expect(step.engine.id).toBe(engine.id);
    expect(step.engine.battle?.timeLeftSec).toBe(27);
    expect(votes(step.engine)).toEqual([14, 10]);
  });

  it('si otra página la cierra antes, se cierra aquí una sola vez', () => {
    const closed = adoptPoll(started(), remote({ title: POLL.title, isActive: false, winner: 'A', timeLeftSec: 0 }));
    expect(closed.engine.battle?.winner).toBe('A');
    expect(closed.engine.battle?.isActive).toBe(false);
    expect(sounds(closed)).toEqual(['fanfare']);
    const again = adoptPoll(closed.engine, remote({ title: POLL.title, isActive: false, winner: 'A', timeLeftSec: 0 }));
    expect(again.engine).toBe(closed.engine);
    expect(again.effects).toEqual([]);
  });

  it('una batalla terminada no revive con un aviso atrasado de la misma batalla', () => {
    const end = wait(started(), 30).engine;
    const late = adoptPoll(end, remote({ title: POLL.title, timeLeftSec: 1 }));
    expect(late.engine).toBe(end);
    // Otra batalla distinta sí entra
    expect(adoptPoll(end, remote()).engine.battle?.isActive).toBe(true);
  });

  it('un resultado que llega sin batalla en pantalla se enseña sin sonar', () => {
    const step = adoptPoll(EMPTY_POLL, remote({ isActive: false, winner: 'B' }));
    expect(step.effects).toEqual([]);
    expect(pollVisible(step.engine.battle)).toBe(true);
  });

  it('parada o a cero, sin resultado, la retira', () => {
    const step = adoptPoll(started(), remote({ isActive: false, winner: null }));
    expect(step.engine.battle).toBeNull();
    expect(step.effects).toEqual([]);
  });

  it('ignora un estado sin sus dos opciones', () => {
    const engine = started();
    const broken = { title: 'x', isActive: true } as unknown as PollBattleUpdateEvent;
    expect(adoptPoll(engine, broken).engine).toBe(engine);
    expect(adoptPoll(engine, null as unknown as PollBattleUpdateEvent).engine).toBe(engine);
  });
});

describe('Batalla en Studio: muestra, ajustes y voz', () => {
  it('la muestra del editor está a medias, en marcha y sin el reloj en rojo', () => {
    const sample = samplePoll(INITIAL_POLL_SETTINGS);
    expect(sample.isActive).toBe(true);
    expect(sample.winner).toBeNull();
    expect(sample.optionA.votes).toBeGreaterThan(0);
    expect(sample.optionB.votes).toBeGreaterThan(0);
    expect(sample.optionA.votes).not.toBe(sample.optionB.votes);
    expect(sample.optionA.label).toBe(INITIAL_POLL_SETTINGS.options[0].label);
    expect(sample.timeLeftSec).toBeGreaterThan(10);
    expect(sample.timeLeftSec).toBeLessThan(sample.totalDurationSec);
    const short = samplePoll({ ...INITIAL_POLL_SETTINGS, durationSec: 10 });
    expect(short.timeLeftSec).toBeGreaterThan(10);
    expect(short.timeLeftSec).toBeLessThan(short.totalDurationSec);
  });

  it('los ajustes del bus se toman solo si traen sus dos opciones', () => {
    const next = { ...INITIAL_POLL_SETTINGS, theme: 'cyber' as const, audioVolume: 0.2 };
    expect(pollSettingsFromBus(next, INITIAL_POLL_SETTINGS).theme).toBe('cyber');
    expect(pollSettingsFromBus({ theme: 'cyber' }, INITIAL_POLL_SETTINGS)).toBe(INITIAL_POLL_SETTINGS);
    expect(pollSettingsFromBus(null, INITIAL_POLL_SETTINGS)).toBe(INITIAL_POLL_SETTINGS);
  });

  it('la voz no repite la misma frase seguida, pero sí pasado un rato', () => {
    const said: string[] = [];
    let now = 1000;
    const voice = createPollVoice(
      (text) => said.push(text),
      () => now
    );
    expect(voice.say(POLL_COUNTDOWN_LINE)).toBe(true);
    now += 500;
    expect(voice.say(` ${POLL_COUNTDOWN_LINE} `)).toBe(false);
    expect(voice.say('otra frase')).toBe(true);
    expect(voice.say('   ')).toBe(false);
    now += POLL_REPEAT_MS + 1;
    expect(voice.say('otra frase')).toBe(true);
    expect(said).toEqual([POLL_COUNTDOWN_LINE, 'otra frase', 'otra frase']);
  });
});

describe('Ruleta en Studio: muestra del editor', () => {
  it('usa los segmentos del streamer, sin sonido y con un giro corto', () => {
    const sample = rouletteSample(DEFAULT_ROULETTE_SETTINGS);
    expect(sample.segments).toBe(DEFAULT_ROULETTE_SETTINGS.segments);
    expect(sample.soundEnabled).toBe(false);
    expect(sample.spinDurationSec).toBe(ROULETTE_PREVIEW_SPIN_SEC);
    expect(sample.title).toBe(DEFAULT_ROULETTE_SETTINGS.title);
  });

  it('sin segmentos encendidos pinta los de muestra, para que la rueda no salga vacía', () => {
    const off = DEFAULT_ROULETTE_SETTINGS.segments.map((segment) => ({ ...segment, enabled: false }));
    expect(rouletteSample({ ...DEFAULT_ROULETTE_SETTINGS, segments: off }).segments.some((segment) => segment.enabled)).toBe(true);
    expect(rouletteSample({ ...DEFAULT_ROULETTE_SETTINGS, segments: [] }).segments.length).toBeGreaterThan(0);
  });
});

describe('Fase 3: las cajas dentro de una escena', () => {
  const boxes = read('src/components/estudio/boxes/fase3.tsx');
  const css = read('src/styles/estudio-fase3.css');
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');

  it('registra la ruleta y la batalla, y ya no salen como «disponible pronto»', () => {
    expect(boxes).toMatch(/roulette:\s*RouletteBox/);
    expect(boxes).toMatch(/poll:\s*PollBox/);
    const soon = read('src/components/estudio/SidePanel.tsx').match(/export const SOON[\s\S]*?\n};/)?.[0] || '';
    expect(soon).not.toBe('');
    expect(soon).not.toMatch(/\broulette:/);
    expect(soon).not.toMatch(/\bpoll:/);
  });

  it('las reglas de la hoja cuelgan de la caja y no miden con la ventana', () => {
    const selectors = rules.match(/[^{}]+(?=\{)/g)?.map((selector) => selector.trim()) || [];
    expect(selectors.length).toBeGreaterThan(0);
    selectors.forEach((selector) => expect(selector.startsWith('.es-cv .es-box ')).toBe(true));
    expect(rules).not.toMatch(/\d(vw|vh)\b/);
    expect(rules).not.toMatch(/position:\s*fixed/);
    expect(rules).not.toMatch(/transition:\s*all/);
  });

  it('la ruleta de la caja no se ancla a la pantalla y la fuente suelta sigue como estaba', () => {
    const layer = read('src/components/roulette/RouletteLayer.tsx');
    expect(layer).toContain("boxed ? 'rl-box' : 'pointer-events-none fixed inset-0");
    expect(boxes).toMatch(/<RouletteLayer[^>]*\bboxed\b/);
    expect(boxes).toContain("speak(text, 'Ruleta', true)");
  });

  it('nada de lo que llega del chat se inserta como HTML', () => {
    expect(boxes).not.toContain('dangerouslySetInnerHTML');
    expect(boxes).not.toContain('innerHTML');
  });

  it('el tamaño de partida de cada caja respeta la proporción de su capa', () => {
    const size = (id: string) => LAYER_TYPES.find((type) => type.id === id)!;
    // Ruleta: 52em × 30em. Batalla: 44em × 12em (ver estudio-fase3.css)
    expect(size('roulette').w / size('roulette').h).toBeCloseTo(52 / 30, 1);
    expect(size('poll').w / size('poll').h).toBeCloseTo(44 / 12, 1);
  });
});
