/**
 * src/utils/tournamentLogic.ts
 *
 * Lo que «Torneos» decide sin pintar: la llave de eliminación directa, quién
 * juega ahora, quién es campeón, la tabla, los cambios de estado (ganador,
 * deshacer, reiniciar, sembrar), los comandos de moderación y lo que dice el
 * narrador. Funciones puras: nunca tocan el estado que reciben y la hora y el
 * azar les llegan como argumentos.
 *
 * La llave. Con `size` equipos hay `size - 1` partidas, numeradas por rondas:
 * primero toda la primera ronda y al final la final. La partida `m` de una
 * ronda posterior la juegan los ganadores de dos partidas de la ronda anterior.
 * Los equipos ocupan los huecos en su orden de siembra. Con menos equipos que
 * huecos, los primeros de la lista quedan solos en su partida y pasan directos;
 * un pase directo no cuenta como victoria.
 */

import type { TournamentCommands, TournamentScene, TournamentSize, TournamentState, TournamentTeam } from '../types/tournament';

/** Un lado de una partida: el índice de un equipo, `null` si aún no se sabe, o `bye` si no vendrá nadie. */
export type BracketSide = number | null | 'bye';

export interface BracketMatch {
  index: number;
  round: number;
  sides: [BracketSide, BracketSide];
  /** Quién sale de esta partida: el ganador, el que pasa directo, `bye` si no jugó nadie o null si falta por jugar. */
  out: BracketSide;
  /** true si la ganó alguien jugando (no por pase directo). */
  played: boolean;
}

export const roundCount = (size: number): number => Math.round(Math.log2(size));

/** Las partidas de cada ronda, por su número. */
export function roundMatches(size: number): number[][] {
  const rounds: number[][] = [];
  let start = 0;
  for (let count = size / 2; count >= 1; count /= 2) {
    rounds.push(Array.from({ length: count }, (_, i) => start + i));
    start += count;
  }
  return rounds;
}

export function roundOf(match: number, size: number): number {
  return Math.max(0, roundMatches(size).findIndex((list) => list.includes(match)));
}

/** Las dos partidas de las que salen los rivales de `match`, o null en la primera ronda. */
export function feedersOf(match: number, size: number): [number, number] | null {
  const rounds = roundMatches(size);
  const round = roundOf(match, size);
  if (round === 0) return null;
  const at = rounds[round].indexOf(match);
  return [rounds[round - 1][at * 2], rounds[round - 1][at * 2 + 1]];
}

/** La partida a la que va el ganador de `match`, o null si es la final. */
export function parentOf(match: number, size: number): number | null {
  const rounds = roundMatches(size);
  const round = roundOf(match, size);
  if (round >= rounds.length - 1) return null;
  return rounds[round + 1][Math.floor(rounds[round].indexOf(match) / 2)];
}

/**
 * Qué equipo ocupa cada hueco de la primera ronda (dos huecos por partida).
 * Los pases directos son para los primeros de la lista; el resto se empareja.
 */
export function seedSlots(teamCount: number, size: number): (number | null)[] {
  const matches = size / 2;
  const count = Math.max(0, Math.min(teamCount, size));
  const alone = count >= matches ? size - count : count;
  const slots: (number | null)[] = Array.from({ length: size }, () => null);
  let team = 0;
  for (let match = 0; match < matches && team < count; match += 1) {
    slots[match * 2] = team;
    team += 1;
    if (match >= alone && team < count) {
      slots[match * 2 + 1] = team;
      team += 1;
    }
  }
  return slots;
}

function resolve(teamCount: number, size: number, results: readonly unknown[]): BracketMatch[] {
  const slots = seedSlots(teamCount, size);
  const matches: BracketMatch[] = [];
  roundMatches(size).forEach((list, round) => {
    list.forEach((index, at) => {
      const feed = feedersOf(index, size);
      const sides: [BracketSide, BracketSide] = feed
        ? [matches[feed[0]].out, matches[feed[1]].out]
        : [slots[at * 2] ?? 'bye', slots[at * 2 + 1] ?? 'bye'];
      const [a, b] = sides;
      let out: BracketSide = null;
      let played = false;
      if (a === 'bye' && b === 'bye') out = 'bye';
      else if (a === 'bye') out = b;
      else if (b === 'bye') out = a;
      else if (a !== null && b !== null) {
        const winner = results[index];
        if (winner === a || winner === b) {
          out = winner;
          played = true;
        }
      }
      matches.push({ index, round, sides, out, played });
    });
  });
  return matches;
}

/** Solo los resultados que la llave admite: su partida tiene dos equipos y el ganador es uno de ellos. */
export function cleanResults(teamCount: number, size: number, results: readonly unknown[]): (number | null)[] {
  return resolve(teamCount, size, results).map((match) => (match.played ? (match.out as number) : null));
}

/** La llave entera con lo que se sabe hasta ahora. */
export function buildBracket(state: TournamentState): BracketMatch[] {
  return resolve(state.teams.length, state.size, state.results);
}

const playable = (match: BracketMatch): match is BracketMatch & { sides: [number, number] } =>
  !match.played && typeof match.sides[0] === 'number' && typeof match.sides[1] === 'number';

/** La partida en juego: la primera con dos equipos y sin resultado. null si no hay ninguna. */
export function currentMatch(state: TournamentState): number | null {
  return buildBracket(state).find(playable)?.index ?? null;
}

/** La siguiente partida que ya tiene a sus dos equipos, después de `match`. */
export function nextAfter(state: TournamentState, match: number): number | null {
  return buildBracket(state).find((item) => item.index > match && playable(item))?.index ?? null;
}

/** Los dos equipos de una partida, o null si aún no están los dos. */
export function matchTeams(state: TournamentState, match: number): [number, number] | null {
  const sides = buildBracket(state)[match]?.sides;
  return sides && typeof sides[0] === 'number' && typeof sides[1] === 'number' ? [sides[0], sides[1]] : null;
}

/** El campeón (índice en `teams`) o null. Hace falta haber jugado al menos una partida. */
export function championOf(state: TournamentState): number | null {
  const bracket = buildBracket(state);
  const out = bracket[bracket.length - 1]?.out;
  return typeof out === 'number' && bracket.some((match) => match.played) ? out : null;
}

export const playedCount = (state: TournamentState): number => buildBracket(state).filter((match) => match.played).length;
/** Partidas que se van a jugar de verdad: las que no se resuelven con un pase directo. */
export const playableCount = (state: TournamentState): number => Math.max(0, Math.min(state.teams.length, state.size) - 1);

// ---------- Nombres de rondas y partidas ----------

const ROUND_TITLES = ['Final', 'Semifinales', 'Cuartos de final', 'Octavos de final'];
const ROUND_LABELS = ['Final', 'Semifinal', 'Cuartos de final', 'Octavos de final'];
const MATCH_WORDS = ['Final', 'Semifinal', 'Cuartos', 'Octavos'];
const ADVANCE = ['', 'la final', 'semifinales', 'cuartos de final'];

const fromEnd = (round: number, size: number): number => roundCount(size) - 1 - round;
/** Título de la columna de una ronda: «Cuartos de final», «Semifinales», «Final». */
export const roundTitle = (round: number, size: number): string => ROUND_TITLES[fromEnd(round, size)] ?? 'Ronda';
/** La ronda en singular, para el subtítulo: «Semifinal». */
export const roundLabel = (round: number, size: number): string => ROUND_LABELS[fromEnd(round, size)] ?? 'Ronda';
/** «Cuartos 2», «Semifinal 1», «Final». */
export function matchName(match: number, size: number): string {
  const round = roundOf(match, size);
  const back = fromEnd(round, size);
  return back === 0 ? MATCH_WORDS[0] : `${MATCH_WORDS[back] ?? 'Ronda'} ${roundMatches(size)[round].indexOf(match) + 1}`;
}
/** A dónde avanza quien gana `match`: «semifinales», «la final». Vacío si era la final. */
export const advanceTo = (match: number, size: number): string => ADVANCE[fromEnd(roundOf(match, size), size)] ?? '';

// ---------- Tabla ----------

export interface StandingRow {
  /** Índice del equipo en `teams`. */
  team: number;
  name: string;
  wins: number;
  losses: number;
  /** Ronda en la que cayó, o null si sigue vivo. */
  out: number | null;
  champ: boolean;
  status: string;
}

/** Tabla de posiciones: el campeón, los que siguen en carrera y los eliminados, de más a menos victorias. */
export function standings(state: TournamentState): StandingRow[] {
  const bracket = buildBracket(state);
  const champion = championOf(state);
  const last = roundCount(state.size) - 1;
  return state.teams
    .slice(0, state.size)
    .map((item, team) => {
      let wins = 0;
      let out: number | null = null;
      bracket.forEach((match) => {
        if (!match.played || !match.sides.includes(team)) return;
        if (match.out === team) wins += 1;
        else out = match.round;
      });
      const champ = champion === team;
      const status = champ
        ? 'Campeón'
        : out === null
          ? 'En carrera'
          : out === last
            ? 'Finalista'
            : `Fuera en ${roundLabel(out, state.size).toLowerCase()}`;
      return { team, name: item.name, wins, losses: out === null ? 0 : 1, out, champ, status };
    })
    .sort((x, y) => Number(y.champ) - Number(x.champ) || Number(x.out !== null) - Number(y.out !== null) || y.wins - x.wins || x.team - y.team);
}

// ---------- Cambios de estado ----------

const touch = (state: TournamentState, now: number): Pick<TournamentState, 'version' | 'updatedAt'> => ({
  version: state.version + 1,
  // Nunca hacia atrás: el estado más nuevo es el que gana al sincronizar
  updatedAt: Math.max(now, state.updatedAt + 1),
});
const blank = (size: number): null[] => Array.from({ length: size - 1 }, () => null);

/**
 * La pantalla que toca enseñar ahora. La de victoria caduca a los `victorySec`
 * segundos y vuelve a la llave; con campeón, celebra al campeón. «Sigue» sin
 * partida que anunciar enseña al campeón o, si no lo hay, la llave.
 */
export function sceneNow(state: TournamentState, victorySec: number, now: number): TournamentScene {
  if (state.scene === 'victoria') {
    if (state.last === null || state.results[state.last] == null) return 'llave';
    if (championOf(state) !== null) return 'campeon';
    return now - state.sceneAt >= victorySec * 1000 ? 'llave' : 'victoria';
  }
  if (state.scene === 'sigue' && currentMatch(state) === null) return championOf(state) !== null ? 'campeon' : 'llave';
  return state.scene;
}

/** Da la partida en juego a `team`. Devuelve null si no hay partida o ese equipo no la juega. */
export function applyWinner(state: TournamentState, team: number, now: number): TournamentState | null {
  const match = currentMatch(state);
  if (match === null || !matchTeams(state, match)?.includes(team)) return null;
  const results = state.results.slice();
  results[match] = team;
  const next: TournamentState = { ...state, results, history: [...state.history, match], last: match };
  return { ...next, scene: championOf(next) !== null ? 'campeon' : 'victoria', sceneAt: now, cueAt: now, ...touch(state, now) };
}

/** Borra el último resultado y vuelve a la llave, sin que el narrador diga nada. null si no había ninguno. */
export function undoLast(state: TournamentState, now: number): TournamentState | null {
  const match = state.history[state.history.length - 1];
  if (match === undefined) return null;
  const results = state.results.slice();
  results[match] = null;
  const history = state.history.slice(0, -1);
  return { ...state, results, history, last: history[history.length - 1] ?? null, scene: 'llave', sceneAt: now, ...touch(state, now) };
}

/** Vuelve a empezar la llave con los mismos equipos. */
export function resetTournament(state: TournamentState, now: number): TournamentState {
  return { ...state, results: blank(state.size), history: [], last: null, scene: 'llave', sceneAt: now, cueAt: now, ...touch(state, now) };
}

/** Cambia de pantalla. Si ya era la que se ve, devuelve el mismo estado: ni se repite la entrada ni la frase. */
export function showScene(state: TournamentState, scene: TournamentScene, victorySec: number, now: number): TournamentState {
  if (sceneNow(state, victorySec, now) === scene) return state;
  return { ...state, scene, sceneAt: now, cueAt: scene === 'oculto' ? state.cueAt : now, ...touch(state, now) };
}

/**
 * Cambia los equipos. Si son los mismos en el mismo orden (solo cambió un
 * nombre), la llave sigue como iba; si no, los resultados dejan de valer y se
 * borran.
 */
export function replaceTeams(state: TournamentState, teams: TournamentTeam[], now: number): TournamentState {
  const next = teams.slice(0, state.size);
  const same = next.length === state.teams.length && next.every((team, index) => team.id === state.teams[index].id);
  if (same) return { ...state, teams: next, ...touch(state, now) };
  return { ...state, teams: next, results: blank(state.size), history: [], last: null, scene: 'llave', sceneAt: now, ...touch(state, now) };
}

/** Cambia el tamaño de la llave: sobran los equipos que no caben y los resultados se borran. */
export function resizeTournament(state: TournamentState, size: TournamentSize, now: number): TournamentState {
  if (size === state.size) return state;
  return { ...state, size, teams: state.teams.slice(0, size), results: blank(size), history: [], last: null, scene: 'llave', sceneAt: now, ...touch(state, now) };
}

/** Sortea el orden de siembra y reinicia la llave. `random` como Math.random. */
export function shuffleTeams(state: TournamentState, now: number, random: () => number = Math.random): TournamentState {
  const teams = state.teams.slice();
  for (let i = teams.length - 1; i > 0; i -= 1) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [teams[i], teams[j]] = [teams[j], teams[i]];
  }
  return { ...state, teams, results: blank(state.size), history: [], last: null, scene: 'llave', sceneAt: now, ...touch(state, now) };
}

/** El estado más nuevo de dos: gana la fecha y, a igual fecha, la versión. */
export function isNewerState(candidate: TournamentState, than: TournamentState): boolean {
  return candidate.updatedAt > than.updatedAt || (candidate.updatedAt === than.updatedAt && candidate.version > than.version);
}

/** Id corto para un equipo o un patrocinador nuevo, que no repita ninguno de `taken`. */
export function freshId(prefix: string, taken: readonly string[]): string {
  let n = taken.length + 1;
  while (taken.includes(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

// ---------- Comandos ----------

export const foldText = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export interface TournamentCommandResult {
  /** true si el comando hizo lo que pedía. */
  ok: boolean;
  /** Qué pasó, en una frase, para quien lo escribió. */
  reply: string;
  /** El estado nuevo, o null si no cambió nada. */
  state: TournamentState | null;
}

const SCENE_WORDS: Record<string, TournamentScene> = {
  llave: 'llave',
  sigue: 'sigue',
  siguiente: 'sigue',
  tabla: 'tabla',
  campeon: 'campeon',
  ocultar: 'oculto',
  oculto: 'oculto',
};
const SCENE_NAMES: Record<TournamentScene, string> = {
  llave: 'la llave',
  sigue: 'la siguiente partida',
  tabla: 'la tabla',
  victoria: 'la victoria',
  campeon: 'el campeón',
  oculto: 'nada',
};

/**
 * Interpreta un mensaje del streamer o de un moderador. Devuelve null si no era
 * un comando del torneo; si lo era, qué pasó y el estado nuevo (o null si no
 * cambió). Quien llama ya filtró por rol.
 */
export function interpretTournamentCommand(
  message: string,
  commands: TournamentCommands,
  state: TournamentState,
  options: { victorySec: number; now: number }
): TournamentCommandResult | null {
  const [name, ...rest] = foldText(message).split(' ');
  const arg = rest.join(' ');
  const { now, victorySec } = options;
  const fail = (reply: string): TournamentCommandResult => ({ ok: false, reply, state: null });

  if (name === commands.winner) {
    const match = currentMatch(state);
    if (match === null) {
      return fail(championOf(state) !== null ? 'El torneo ya terminó.' : 'No hay ninguna partida en juego: faltan equipos en la llave.');
    }
    const [a, b] = matchTeams(state, match) as [number, number];
    const names = [state.teams[a].name, state.teams[b].name];
    const help = `En juego están ${names[0]} y ${names[1]}. Escribe el principio de uno de los dos, o 1 y 2.`;
    let pick: number | null = arg === '1' ? a : arg === '2' ? b : null;
    if (pick === null && arg) {
      const folded = names.map(foldText);
      const exact = folded.map((item) => item === arg);
      const starts = folded.map((item) => item.startsWith(arg));
      if (exact[0] !== exact[1]) pick = exact[0] ? a : b;
      else if (starts[0] && starts[1]) return fail(`«${arg}» vale para los dos: ${names[0]} y ${names[1]}. Escribe más letras, o 1 y 2.`);
      else if (starts[0] || starts[1]) pick = starts[0] ? a : b;
    }
    if (pick === null) return fail(help);
    const next = applyWinner(state, pick, now);
    if (!next) return fail(help);
    return { ok: true, reply: `Hecho: ${state.teams[pick].name} gana ${matchName(match, state.size).toLowerCase()}.`, state: next };
  }

  if (name === commands.undo) {
    const next = undoLast(state, now);
    return next ? { ok: true, reply: 'Último resultado borrado.', state: next } : fail('No hay resultados que deshacer.');
  }

  if (name === commands.main) {
    if (arg === 'reiniciar') return { ok: true, reply: 'Llave reiniciada.', state: resetTournament(state, now) };
    const scene = SCENE_WORDS[arg];
    if (!scene) return fail('Prueba con: llave, sigue, tabla, campeon, ocultar o reiniciar.');
    const next = showScene(state, scene, victorySec, now);
    if (next === state) return { ok: true, reply: scene === 'oculto' ? 'El torneo ya estaba oculto.' : `Ya se ve ${SCENE_NAMES[scene]}.`, state: null };
    return { ok: true, reply: scene === 'oculto' ? 'Torneo oculto.' : `En pantalla: ${SCENE_NAMES[scene]}.`, state: next };
  }

  return null;
}

// ---------- Narrador ----------

/** Etiquetas en español que entiende emotionMapper (shouting, excited, happy, calm). */
export type NarratorEmotion = 'gritando' | 'emocionado' | 'feliz' | 'calmado';

export interface Narration {
  emotion: NarratorEmotion;
  text: string;
}

/** Lo que el narrador dice de una pantalla, o null si no hay nada que decir (capa oculta). */
export function narration(state: TournamentState, scene: TournamentScene, tournamentName: string): Narration | null {
  if (scene === 'oculto') return null;
  const name = (index: number) => state.teams[index]?.name ?? 'Un equipo';
  const champion = championOf(state);
  const match = currentMatch(state);

  if (scene === 'victoria' && champion === null && state.last !== null && state.results[state.last] != null) {
    const winner = state.results[state.last] as number;
    const to = advanceTo(state.last, state.size);
    return { emotion: 'gritando', text: `¡Victoria de ${name(winner)}! Avanza a ${to === 'la final' ? 'la gran final' : to}.` };
  }
  if (scene === 'campeon' || scene === 'victoria') {
    return champion === null
      ? { emotion: 'calmado', text: 'Todavía no hay campeón. Sigue la llave.' }
      : { emotion: 'gritando', text: `¡Tenemos campeón! ${name(champion)} gana ${tournamentName}. ¡Felicidades!` };
  }
  if (scene === 'sigue') {
    const teams = match === null ? null : matchTeams(state, match);
    if (match === null || !teams) return { emotion: 'feliz', text: champion === null ? 'Todavía no hay partida que anunciar.' : 'El torneo ha terminado.' };
    return { emotion: 'emocionado', text: `Sigue ${matchName(match, state.size).toLowerCase()}: ${name(teams[0])} contra ${name(teams[1])}.` };
  }
  if (scene === 'tabla') {
    const rows = standings(state);
    if (rows.length === 0) return { emotion: 'calmado', text: 'La tabla está vacía: todavía no hay equipos.' };
    if (champion !== null && rows.length > 1) return { emotion: 'feliz', text: `Tabla final: primero ${rows[0].name}, segundo ${rows[1].name}.` };
    const alive = rows.filter((row) => row.out === null && !row.champ).map((row) => row.name);
    const out = rows.length - alive.length;
    const gone = out === 0 ? 'Aún no hay eliminados.' : out === 1 ? 'Ya hay un eliminado.' : `Ya hay ${out} eliminados.`;
    return { emotion: 'calmado', text: `Así va la tabla. Siguen en carrera ${alive.length} equipos: ${alive.join(', ')}. ${gone}` };
  }
  const total = playableCount(state);
  if (total === 0) return { emotion: 'calmado', text: `Esta es la llave de ${tournamentName}. Todavía faltan equipos.` };
  const played = playedCount(state);
  const now = match === null ? '.' : `, y ahora se juega ${matchName(match, state.size).toLowerCase()}.`;
  return { emotion: 'feliz', text: `Esta es la llave de ${tournamentName}. Van ${played} de ${total} partidas${now}` };
}

/** La frase lista para la cola de voz: la emoción va como etiqueta al principio. */
export function narrationLine(state: TournamentState, scene: TournamentScene, tournamentName: string): string | null {
  const said = narration(state, scene, tournamentName);
  return said ? `[${said.emotion}] ${said.text}` : null;
}

// ---------- Color propio ----------

/** Tinta legible sobre un color de acento: oscura sobre claros, blanca sobre oscuros. */
export function inkFor(hex: string): string {
  const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : '000000';
  const [r, g, b] = [0, 2, 4].map((at) => {
    const channel = parseInt(value.slice(at, at + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // El punto en que el contraste con #121315 iguala al del blanco
  return luminance > 0.19 ? '#121315' : '#ffffff';
}

// ---------- Muestra ----------

const SAMPLE_NAMES = [
  'Lobos del Sur', 'Dragones Rojos', 'Nexo Roto', 'Tormenta LAN', 'Furia Andina', 'Cóndor Gaming', 'Kraken Norte', 'Barón Dormido',
  'Alba Invicta', 'Los Súbditos', 'Hierro Azul', 'Selva Negra', 'Puente Roto', 'Faro del Este', 'Zorros Grises', 'Última Torre',
];

/** Una llave de ejemplo con la primera partida ya jugada: lo que enseña Studio en el editor y `demo=1` en OBS. */
export function sampleTournamentState(size: TournamentSize = 8, scene: TournamentScene = 'llave'): TournamentState {
  const teams = SAMPLE_NAMES.slice(0, size).map((name, index) => ({ id: `m${index + 1}`, name, captain: '', players: [] }));
  const results: (number | null)[] = blank(size);
  results[0] = 0;
  return { teams, size, results, history: [0], scene, sceneAt: 0, cueAt: 0, last: 0, version: 1, updatedAt: 0 };
}

/** La misma llave de ejemplo jugada hasta el final: gana siempre el de arriba. Para enseñar al campeón. */
export function sampleFinishedState(size: TournamentSize = 8): TournamentState {
  let state = sampleTournamentState(size, 'campeon');
  for (let match = currentMatch(state); match !== null; match = currentMatch(state)) {
    const next = applyWinner(state, (matchTeams(state, match) as [number, number])[0], 0);
    if (!next) break;
    state = next;
  }
  return state;
}
