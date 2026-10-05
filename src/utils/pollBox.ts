/**
 * src/utils/pollBox.ts
 *
 * Motor de una batalla para la caja «Batalla» de Studio. Es la misma lógica que
 * la fuente suelta lleva dentro de Widget.tsx, sacada a funciones puras: cada
 * paso recibe el estado y devuelve el estado nuevo y lo que hay que hacer sonar
 * o decir. La caja (boxes/fase3.tsx) pone los temporizadores, el sonido y la voz.
 *
 * - POLL_START arranca una batalla propia: esta caja lleva su cuenta atrás.
 * - POLL_VOTE suma un voto por persona; cambiarlo depende del ajuste del panel.
 * - POLL_STATE_UPDATE trae el estado de otra página (el panel, otra fuente). Si
 *   la batalla es propia solo se toman el título y los votos; si no, se enseña
 *   tal cual llega y la cuenta atrás la lleva quien la envía.
 * - Una batalla terminada no revive con un aviso atrasado: solo POLL_START la
 *   reinicia.
 */

import { PollSettings, determineLeader } from '../types/polls';
import type { PollBattleUpdateEvent } from './bus';
import type { PollStartEvent } from './pollCommands';
import { buildModPollAnnouncementText } from './pollsAudio';

export type PollSide = 'A' | 'B' | 'TIE';
export type PollSound = 'notice' | 'tick-a' | 'tick-b' | 'clash' | 'beep' | 'fanfare';
export type PollEffect = { kind: 'sound'; sound: PollSound } | { kind: 'say'; text: string };

export interface PollEngine {
  /** Cambia con cada batalla nueva: la barra se monta de nuevo y repite su entrada. */
  id: number;
  battle: PollBattleUpdateEvent | null;
  /** Arrancó con POLL_START: la cuenta atrás la lleva esta caja. */
  own: boolean;
  /** Qué votó cada persona, por su nombre en minúsculas. */
  voters: ReadonlyMap<string, 0 | 1>;
  /** Último lado que tomó la delantera: el choque suena solo al cambiar. */
  leader: PollSide;
}

export interface PollStep {
  engine: PollEngine;
  effects: PollEffect[];
}

/** El resultado se queda en pantalla este tiempo antes de retirarse. */
export const POLL_WINNER_HOLD_MS = 10000;
/** Una batalla ajena que deja de recibir avisos se retira sola. */
export const POLL_ORPHAN_MS = 20000;
/** Una misma frase no se repite si llega dos veces seguidas (la caja y el panel dicen lo mismo). */
export const POLL_REPEAT_MS = 6000;

export const POLL_COUNTDOWN_LINE = '[susurro] Quedan solo 10 segundos, ¡emitan sus votos en el chat!';

export const EMPTY_POLL: PollEngine = { id: 0, battle: null, own: false, voters: new Map(), leader: 'TIE' };

const same = (engine: PollEngine): PollStep => ({ engine, effects: [] });
const sound = (name: PollSound): PollEffect => ({ kind: 'sound', sound: name });
const say = (text: string): PollEffect => ({ kind: 'say', text });

/** La batalla se ve mientras está en marcha o enseña su resultado. */
export function pollVisible(battle: PollBattleUpdateEvent | null): battle is PollBattleUpdateEvent {
  return !!battle && (battle.isActive || Boolean(battle.winner));
}

/** Frase del resultado, con la emoción como etiqueta al inicio. */
export function pollWinnerLine(battle: PollBattleUpdateEvent, winner: PollSide): string {
  if (winner === 'TIE') return '[tenso] ¡Tiempo finalizado! La votación ha terminado en un empate absoluto entre ambas opciones.';
  const total = battle.optionA.votes + battle.optionB.votes;
  const side = winner === 'A' ? battle.optionA : battle.optionB;
  const pct = total > 0 ? Math.round((side.votes / total) * 100) : 50;
  return `[triunfal] ¡Tiempo finalizado! La opción ganadora indiscutible es ${side.label} con ${pct} por ciento de los votos.`;
}

/** Frase al cancelar una batalla desde el chat o desde el panel. */
export function pollStoppedLine(user?: string): string {
  const name = (user || '').trim();
  const who = !name || name.toLowerCase() === 'streamer' ? 'el streamer' : `el moderador ${name}`;
  return `[tenso] Atención chat, ${who} ha cancelado la votación en curso.`;
}

/** POLL_START: batalla nueva a cero, con su aviso y su locución. */
export function startPoll(engine: PollEngine, poll: PollStartEvent): PollStep {
  const battle: PollBattleUpdateEvent = {
    title: poll.title,
    optionA: {
      id: 'opt-a',
      label: poll.optionA.label,
      sublabel: poll.optionA.sublabel || '!voto 1 o 1',
      color: poll.optionA.color || '#00e5ff',
      accentGlow: 'rgba(0, 229, 255, 0.45)',
      votes: 0,
    },
    optionB: {
      id: 'opt-b',
      label: poll.optionB.label,
      sublabel: poll.optionB.sublabel || '!voto 2 o 2',
      color: poll.optionB.color || '#ff0055',
      accentGlow: 'rgba(255, 0, 85, 0.45)',
      votes: 0,
    },
    timeLeftSec: poll.durationSec,
    totalDurationSec: poll.durationSec,
    isActive: true,
    winner: null,
    leader: 'TIE',
  };
  return {
    engine: { id: engine.id + 1, battle, own: true, voters: new Map(), leader: 'TIE' },
    effects: [
      sound('notice'),
      say(
        buildModPollAnnouncementText({
          modName: poll.startedBy,
          modRole: poll.startedByRole,
          title: poll.title,
          optionALabel: poll.optionA.label,
          optionBLabel: poll.optionB.label,
          durationSec: poll.durationSec,
        })
      ),
    ],
  };
}

/** POLL_VOTE: un voto por persona. Con `allowChange`, quien ya votó puede pasarse al otro lado. */
export function votePoll(engine: PollEngine, user: string, option: 0 | 1, allowChange: boolean): PollStep {
  const battle = engine.battle;
  if (!battle || !battle.isActive) return same(engine);
  const voter = (user || 'Anónimo').toLowerCase().trim();
  const before = engine.voters.get(voter);
  if (before !== undefined && (!allowChange || before === option)) return same(engine);

  let votesA = battle.optionA.votes;
  let votesB = battle.optionB.votes;
  if (before === 0) votesA = Math.max(0, votesA - 1);
  if (before === 1) votesB = Math.max(0, votesB - 1);
  if (option === 0) votesA += 1;
  else votesB += 1;

  const voters = new Map(engine.voters);
  voters.set(voter, option);
  const leader = determineLeader(votesA, votesB);
  const effects: PollEffect[] = [];
  let lastLeader = engine.leader;
  if (leader !== 'TIE' && leader !== lastLeader) {
    lastLeader = leader;
    effects.push(sound('clash'));
  }
  effects.push(sound(option === 0 ? 'tick-a' : 'tick-b'));

  return {
    engine: {
      ...engine,
      voters,
      leader: lastLeader,
      battle: {
        ...battle,
        optionA: { ...battle.optionA, votes: votesA },
        optionB: { ...battle.optionB, votes: votesB },
        leader,
        lastVoteUser: user,
        lastVoteOption: option,
      },
    },
    effects,
  };
}

/** Cierra la batalla con su resultado. */
function finishPoll(engine: PollEngine, battle: PollBattleUpdateEvent, winner: PollSide): PollStep {
  return {
    engine: { ...engine, battle: { ...battle, timeLeftSec: 0, isActive: false, winner } },
    effects: [sound('fanfare'), say(pollWinnerLine(battle, winner))],
  };
}

/** Pasa un segundo de una batalla propia. Al llegar a cero se cierra con su resultado. */
export function tickPoll(engine: PollEngine): PollStep {
  const battle = engine.battle;
  if (!battle || !battle.isActive || !engine.own) return same(engine);
  const left = battle.timeLeftSec - 1;
  if (left <= 0) return finishPoll(engine, battle, determineLeader(battle.optionA.votes, battle.optionB.votes));
  const effects: PollEffect[] = [];
  if (left === 10) effects.push(sound('beep'), say(POLL_COUNTDOWN_LINE));
  else if (left <= 5) effects.push(sound('beep'));
  return { engine: { ...engine, battle: { ...battle, timeLeftSec: left } }, effects };
}

/** POLL_STOP: la batalla en marcha se cancela y se retira. */
export function stopPoll(engine: PollEngine, user?: string): PollStep {
  const wasRunning = !!engine.battle?.isActive;
  return { engine: { ...EMPTY_POLL, id: engine.id }, effects: wasRunning ? [say(pollStoppedLine(user))] : [] };
}

/** POLL_CLEAR: se retira sin decir nada. */
export function clearPoll(engine: PollEngine): PollEngine {
  return { ...EMPTY_POLL, id: engine.id };
}

const isOption = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && typeof (value as { votes?: unknown }).votes === 'number';

/** POLL_STATE_UPDATE: estado que envía otra página de este navegador. */
export function adoptPoll(engine: PollEngine, remote: PollBattleUpdateEvent): PollStep {
  if (!remote || !isOption(remote.optionA) || !isOption(remote.optionB)) return same(engine);
  const current = engine.battle;

  if (remote.isActive) {
    // Aviso atrasado de una batalla que aquí ya terminó
    if (current && !current.isActive && current.winner && current.title === remote.title) return same(engine);
    if (current && current.isActive && engine.own) {
      // Batalla propia: el reloj es el de esta caja; de fuera llegan el título y los votos
      return same({
        ...engine,
        battle: { ...current, title: remote.title, optionA: remote.optionA, optionB: remote.optionB, leader: remote.leader },
      });
    }
    const fresh = !current || !current.isActive;
    return same({
      ...engine,
      id: fresh ? engine.id + 1 : engine.id,
      own: false,
      voters: fresh ? new Map() : engine.voters,
      leader: fresh ? determineLeader(remote.optionA.votes, remote.optionB.votes) : engine.leader,
      battle: { ...remote, winner: null },
    });
  }

  if (remote.winner) {
    // Quien llevaba la cuenta la cerró antes: esta caja la cierra también, una sola vez
    if (current && current.isActive) return finishPoll(engine, { ...current, optionA: remote.optionA, optionB: remote.optionB, title: remote.title }, remote.winner);
    if (current && current.winner) return same(engine);
    return same({ ...engine, id: engine.id + 1, own: false, voters: new Map(), battle: { ...remote, isActive: false } });
  }

  // Parada o a cero, sin resultado: no hay nada que enseñar
  return same(clearPoll(engine));
}

/** Batalla de muestra para el editor y para `demo=1`: a medias y quieta. */
export function samplePoll(settings: Pick<PollSettings, 'activeBattleTitle' | 'options' | 'durationSec'>): PollBattleUpdateEvent {
  const total = Math.max(10, settings.durationSec || 60);
  return {
    title: settings.activeBattleTitle || 'Batalla de muestra',
    optionA: { ...settings.options[0], votes: 14 },
    optionB: { ...settings.options[1], votes: 11 },
    // Nunca por debajo de 11 s: la muestra no enseña el reloj en rojo
    timeLeftSec: Math.max(11, Math.round(total / 2)),
    totalDurationSec: Math.max(22, total),
    isActive: true,
    winner: null,
    leader: 'A',
  };
}

/** Ajustes que llegan por el bus: si no traen sus dos opciones, se quedan los que había. */
export function pollSettingsFromBus(incoming: unknown, current: PollSettings): PollSettings {
  if (typeof incoming !== 'object' || incoming === null) return current;
  const options = (incoming as { options?: unknown }).options;
  if (!Array.isArray(options) || options.length < 2 || !options[0] || !options[1]) return current;
  return { ...current, ...(incoming as PollSettings) };
}

/**
 * Voz de la batalla: pasa cada frase a `speak` y se salta la que repite a la anterior en pocos
 * segundos. La caja anuncia el resultado y el panel puede enviar la misma frase por POLL_TTS_CUE.
 */
export function createPollVoice(speak: (text: string) => unknown, now: () => number = Date.now) {
  let last = { text: '', at: -Infinity };
  return {
    say(text: string): boolean {
      const clean = (text || '').trim();
      if (!clean) return false;
      const at = now();
      if (clean === last.text && at - last.at < POLL_REPEAT_MS) return false;
      last = { text: clean, at };
      speak(clean);
      return true;
    },
  };
}
