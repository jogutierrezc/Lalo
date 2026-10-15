/**
 * src/utils/tournamentIntro.ts
 *
 * Lo que la presentación de la página de inscripción decide sin pintar nada:
 * los seis pasos, lo que dice Axo en cada uno según lo que configuró el
 * streamer (tamaño de la llave, jugadores por equipo, nombre, organizador y
 * juego), las fases con sus equipos y partidas, las reglas generales, la
 * geometría de la llave de ejemplo y el recuerdo de «ya la vi» en este
 * navegador. Funciones puras; el almacenamiento se pasa como argumento.
 *
 * Los textos hablan a quien se inscribe, en llano. Lo que escribió el streamer
 * (nombre, juego, reglas propias) llega aquí ya limpio por
 * normalizePublicTournament y la página lo pinta con React, nunca como HTML.
 */

import type { PetEmotion } from '../types/pets';
import { TOURNAMENT_LIMITS, type TournamentSize } from '../types/tournament';
import { roundCount, roundTitle } from './tournamentLogic';
import { SLUG_RE, type PublicTournament } from './tournamentSignup';

// ---------- Pasos ----------

export const INTRO_STEPS = [
  { id: 'bienvenida', name: 'Bienvenida' },
  { id: 'llave', name: 'Cómo funciona' },
  { id: 'fases', name: 'Las fases' },
  { id: 'equipo', name: 'Tu equipo' },
  { id: 'reglas', name: 'Reglas generales' },
  { id: 'suerte', name: 'Buena suerte' },
] as const;
export type IntroStepId = (typeof INTRO_STEPS)[number]['id'];
export const INTRO_LAST = INTRO_STEPS.length - 1;

/** Un paso válido a partir de cualquier número: fuera de rango se queda en el borde. */
export const clampStep = (step: number): number => (Number.isFinite(step) ? Math.max(0, Math.min(INTRO_LAST, Math.round(step))) : 0);

// ---------- Lo configurado ----------

/** `open`: se puede inscribir. `closed` y `full`: la presentación se ve igual, pero no promete inscribirse. */
export type IntroStatus = 'open' | 'closed' | 'full';

export interface IntroConfig {
  name: string;
  game: string;
  organizer: string;
  size: TournamentSize;
  /** Jugadores por equipo, de 1 a 5. Con 1 se juega uno contra uno. */
  teamSize: number;
  /** Reglas propias del torneo, ya limpias. */
  rules: string[];
  status: IntroStatus;
}

/** Lo que la presentación necesita de lo público de un torneo, con un texto de reserva donde falte. */
export function introConfig(tournament: PublicTournament): IntroConfig {
  const teamSize = Number.isFinite(tournament.teamSize) ? Math.round(tournament.teamSize) : TOURNAMENT_LIMITS.teamSize.max;
  return {
    name: tournament.name || 'el torneo',
    game: tournament.game || 'tu juego',
    organizer: tournament.organizer || NO_ORGANIZER,
    size: tournament.slots,
    teamSize: Math.min(TOURNAMENT_LIMITS.teamSize.max, Math.max(TOURNAMENT_LIMITS.teamSize.min, teamSize)),
    rules: tournament.rules.slice(0, TOURNAMENT_LIMITS.rules),
    status: !tournament.open ? 'closed' : tournament.left === 0 ? 'full' : 'open',
  };
}

/** Lo que se dice cuando el canal no tiene nombre visible. */
const NO_ORGANIZER = 'quien organiza';
const NUMBER_WORDS = ['', 'una', 'dos', 'tres', 'cuatro'];
const upperFirst = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);
const isSolo = (cfg: Pick<IntroConfig, 'teamSize'>): boolean => cfg.teamSize === 1;

/** «cuartos de final, semifinales y final». */
export function roundsList(size: number): string {
  const names = Array.from({ length: roundCount(size) }, (_, round) => roundTitle(round, size).toLowerCase());
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

/** «5 contra 5», o «Uno contra uno». */
export const versusLabel = (teamSize: number): string => (teamSize === 1 ? 'Uno contra uno' : `${teamSize} contra ${teamSize}`);

/** Los datos del torneo que salen en la bienvenida. */
export function introFacts(cfg: IntroConfig): string[] {
  return [cfg.game, versusLabel(cfg.teamSize), 'Eliminación directa', isSolo(cfg) ? `${cfg.size} jugadores` : `${cfg.size} equipos`];
}

/** El aviso de la bienvenida cuando no se puede inscribir, o null. */
export const introStatusNote = (status: IntroStatus): string | null =>
  status === 'closed' ? 'Inscripción cerrada' : status === 'full' ? 'Llave completa' : null;

// ---------- Lo que dice Axo ----------

export interface IntroLine {
  title: string;
  text: string;
  /** La cara que pone Axo en ese paso. */
  mood: PetEmotion;
}

const AXO_MOODS: Record<PetEmotion, string> = {
  feliz: 'Contento',
  neutral: 'Atento',
  emocionado: 'Emocionado',
  sorprendido: 'Sorprendido',
  triste: 'Triste',
  enojado: 'Serio',
};
/** La pastilla de estado: «Axo · Contento». */
export const moodLabel = (mood: PetEmotion): string => `Axo · ${AXO_MOODS[mood] ?? AXO_MOODS.neutral}`;

/** El guion: lo que dice Axo en cada uno de los seis pasos. */
export function introScript(cfg: IntroConfig): IntroLine[] {
  const rounds = roundCount(cfg.size);
  const solo = isSolo(cfg);
  const welcome = `Te doy la bienvenida a ${cfg.name}, el torneo de ${cfg.game} que organiza ${cfg.organizer}.`;
  const who = solo ? 'jugador' : 'equipo';
  return [
    {
      title: '¡Hola! Soy Axo',
      text:
        cfg.status === 'open'
          ? `${welcome} Antes de inscribirte, te cuento cómo va.`
          : cfg.status === 'closed'
            ? `${welcome} Ahora la inscripción está cerrada, pero te cuento cómo va.`
            : `${welcome} La llave ya está completa, pero te cuento cómo va.`,
      mood: 'feliz',
    },
    {
      title: 'Así se juega',
      text: `Es eliminación directa. Si ganas, avanzas. Si pierdes, quedas fuera. Mira el camino de un ${who} de ejemplo por ${roundsList(cfg.size)}.`,
      mood: 'neutral',
    },
    {
      title: `${upperFirst(NUMBER_WORDS[rounds])} rondas hasta el título`,
      text: `Empiezan ${cfg.size} ${solo ? 'jugadores' : 'equipos'} y en cada ronda queda la mitad. Para ser campeón hay que ganar ${NUMBER_WORDS[rounds]} partidas seguidas.`,
      mood: 'feliz',
    },
    {
      title: solo ? 'Juegas tú' : 'Tu equipo',
      text: solo
        ? `Aquí se juega uno contra uno. Te inscribes con tu Riot ID y ${cfg.organizer} revisa tu inscripción antes de aceptarla.`
        : `Cada equipo juega con ${cfg.teamSize} jugadores. El capitán lo inscribe con su Riot ID y el de los demás. Después, ${cfg.organizer} revisa la inscripción y la acepta.`,
      mood: 'neutral',
    },
    {
      title: 'Las reglas',
      text: `Son pocas y valen para todos. Léelas con calma.${cfg.rules.length ? ` Las últimas las puso ${cfg.organizer} para este torneo.` : ''}`,
      mood: 'neutral',
    },
    cfg.status === 'open'
      ? {
          title: '¡Mucha suerte!',
          text: `Ya sabes todo lo que hace falta. ${solo ? 'Prepárate' : 'Reúne a tu equipo'} y que gane el mejor. Nos vemos en la llave.`,
          mood: 'emocionado',
        }
      : {
          title: 'Eso es todo',
          text:
            cfg.status === 'closed'
              ? `Ahora mismo no se admiten inscripciones. Puedes ver los equipos que ya están dentro y preguntarle a ${cfg.organizer} si piensa volver a abrirla.`
              : `Ya están todas las plazas ocupadas. Puedes ver los equipos de la llave. Si alguno se cae, ${cfg.organizer} puede abrir un hueco.`,
          mood: 'feliz',
        },
  ];
}

// ---------- Paso 3: las fases ----------

export interface IntroPhase {
  /** «Cuartos de final». */
  title: string;
  /** Equipos que juegan esa ronda. */
  teams: number;
  games: number;
  /** «8 equipos · 4 partidas». */
  detail: string;
}

/** Las rondas de la llave, de la primera a la final. */
export function introPhases(size: number, solo = false): IntroPhase[] {
  return Array.from({ length: roundCount(size) }, (_, round) => {
    const teams = size >> round;
    const games = teams / 2;
    return {
      title: roundTitle(round, size),
      teams,
      games,
      detail: `${teams} ${solo ? 'jugadores' : 'equipos'} · ${games === 1 ? '1 partida' : `${games} partidas`}`,
    };
  });
}

/** Partidas de todo el torneo: en eliminación directa, una menos que equipos. */
export const introTotalGames = (size: number): number => Math.max(0, size - 1);
/** «partidas en total, en 3 rondas»: lo que acompaña al número. */
export const introTotalLabel = (size: number): string => `partidas en total, en ${roundCount(size)} rondas`;

// ---------- Paso 4: el equipo ----------

export interface IntroSeat {
  title: string;
  note: string;
  captain: boolean;
}

/** Los asientos del equipo: el capitán y los demás. Con un jugador, solo «Tú». */
export function introSeats(teamSize: number): IntroSeat[] {
  if (teamSize <= 1) return [{ title: 'Tú', note: 'Riot ID', captain: true }];
  return Array.from({ length: teamSize }, (_, index) =>
    index === 0 ? { title: 'Capitán', note: 'Inscribe', captain: true } : { title: `Jugador ${index + 1}`, note: 'Riot ID', captain: false }
  );
}

export interface IntroFlowStep {
  title: string;
  text: string;
  /** Estado en el que queda la inscripción al llegar a este punto. */
  tag: 'pending' | 'accepted' | null;
}

/** De inscribirse a entrar en la llave, en tres pasos. */
export function introFlow(cfg: IntroConfig): IntroFlowStep[] {
  const solo = isSolo(cfg);
  const others = cfg.teamSize - 1;
  return [
    {
      title: solo ? 'Te inscribes tú' : 'El capitán inscribe al equipo',
      text: solo ? 'Con tu nombre y tu Riot ID.' : `Con el nombre del equipo, su Riot ID y ${others === 1 ? 'el del otro jugador' : `el de los otros ${others} jugadores`}.`,
      tag: null,
    },
    {
      // Un nombre de canal se deja como está: solo el texto de reserva empieza en mayúscula
      title: `${cfg.organizer === NO_ORGANIZER ? upperFirst(NO_ORGANIZER) : cfg.organizer} revisa la inscripción`,
      text: solo ? 'Hasta que la acepte, todavía no estás dentro.' : 'Hasta que la acepte, tu equipo todavía no está dentro.',
      tag: 'pending',
    },
    {
      title: solo ? 'Entras en la llave' : 'Tu equipo entra en la llave',
      text: solo ? 'Tu nombre aparece en la lista del torneo.' : 'Su nombre aparece en la lista de equipos del torneo.',
      tag: 'accepted',
    },
  ];
}

/** El título del paso «Tu equipo». */
export const teamHeading = (teamSize: number): string => (teamSize === 1 ? 'Uno contra uno' : `Equipos de ${teamSize} jugadores`);

// ---------- Paso 5: las reglas ----------

export const GENERAL_RULES = [
  { id: 'hora', title: 'Llega a tiempo', text: 'Ten a tu equipo listo antes de la hora de tu partida.' },
  { id: 'ausencia', title: 'Si un equipo no se presenta, pierde', text: 'Su rival avanza a la siguiente ronda. Cuánto se espera lo decide el organizador.' },
  { id: 'limpio', title: 'Juego limpio', text: 'Sin trampas, sin programas de ayuda y sin cuentas prestadas.' },
  { id: 'respeto', title: 'Respeto en el chat y en la partida', text: 'Con tu rival, con tu equipo y con quien organiza, ganes o pierdas.' },
  { id: 'inscritos', title: 'Juegan quienes están inscritos', text: 'Si necesitas cambiar a alguien, pídeselo al organizador antes de la partida.' },
  { id: 'decision', title: 'La decisión del organizador es final', text: 'Ante cualquier duda o reclamo, decide quien organiza el torneo.' },
] as const;
export type GeneralRuleId = (typeof GENERAL_RULES)[number]['id'];

/** El título del bloque de reglas propias. */
export const ownRulesHeading = (cfg: IntroConfig): string => `Reglas de ${cfg.organizer} para este torneo`;

// ---------- Paso 6: el cierre ----------

export interface IntroClosing {
  /** El título grande. */
  title: string;
  lead: string;
  /** El botón principal del último paso. */
  action: string;
  /** El botón «Siguiente» cuando ya no quedan pasos. */
  next: string;
  /** La última pastilla de la navegación. */
  pill: string;
  /** Solo se celebra con confeti si de verdad se puede inscribir. */
  confetti: boolean;
}

/** El cierre. Con la inscripción cerrada o la llave completa no promete inscribirse. */
export function introClosing(cfg: IntroConfig): IntroClosing {
  if (cfg.status !== 'open') {
    return {
      title: '¡Nos vemos!',
      lead:
        cfg.status === 'closed'
          ? `La inscripción de ${cfg.name} está cerrada por ahora. Puedes ver los equipos que ya están en la llave.`
          : `La llave de ${cfg.name} ya está completa. Puedes ver los equipos que la forman.`,
      action: 'Ver el torneo',
      next: 'Ver el torneo',
      pill: 'El torneo',
      confetti: false,
    };
  }
  return {
    title: '¡Buena suerte!',
    lead: `Que gane el mejor. Nos vemos en la llave de ${cfg.name}.`,
    action: isSolo(cfg) ? 'Inscribirme' : 'Inscribir a mi equipo',
    next: 'Ir al formulario',
    pill: 'Formulario',
    confetti: true,
  };
}

// ---------- Junto al formulario ----------

/** Lo que dice Axo al lado del formulario, según cómo esté la inscripción. */
export function formGuide(cfg: IntroConfig, received: boolean): { title: string; text: string; mood: PetEmotion } {
  const solo = isSolo(cfg);
  if (received) {
    return { title: '¡Recibido!', text: `Ahora toca esperar a que ${cfg.organizer} acepte ${solo ? 'tu inscripción' : 'a tu equipo'}.`, mood: 'emocionado' };
  }
  if (cfg.status === 'closed') return { title: 'La inscripción está cerrada', text: 'Aquí tienes los equipos que ya están dentro.', mood: 'neutral' };
  if (cfg.status === 'full') return { title: 'La llave está completa', text: 'Aquí tienes los equipos que la forman.', mood: 'neutral' };
  return {
    title: 'Solo falta inscribirte',
    text: `Cuando envíes el formulario, ${solo ? 'tu inscripción' : 'tu equipo'} queda pendiente hasta que ${cfg.organizer} ${solo ? 'la' : 'lo'} acepte.`,
    mood: 'feliz',
  };
}

// ---------- Paso 2: la llave de ejemplo ----------

export interface BracketSlot {
  round: number;
  x: number;
  y: number;
  /** Texto de la plaza: solo en la primera ronda. */
  label: string | null;
  /** `mine`: donde empieza el equipo de ejemplo. `champ`: la plaza de campeón. `tbd`: por decidir. */
  kind: 'plain' | 'mine' | 'tbd' | 'champ';
  /** El rival del equipo de ejemplo en esa ronda: se apaga cuando pierde. */
  opponent: boolean;
}

export interface BracketLayout {
  width: number;
  height: number;
  barW: number;
  barH: number;
  /** Título de cada columna y dónde empieza. */
  heads: { round: number; x: number; label: string }[];
  slots: BracketSlot[];
  /** Los conectores de cada cruce, por ronda. */
  links: { round: number; d: string }[];
  /** El camino del equipo de ejemplo, un tramo por ronda. */
  route: { round: number; d: string }[];
  /** Por dónde pasa la ficha del equipo de ejemplo: de su plaza a la de campeón. */
  token: { x: number; y: number }[];
  tokenLabel: string;
  /** Dónde va la copa, o null si no cabe sobre la plaza de campeón. */
  cup: { x: number; y: number } | null;
}

const TITLES_SHORT = ['Final', 'Semifinales', 'Cuartos', 'Octavos'];
const TITLES_TINY = ['Final', 'Semis', 'Cuartos', 'Octavos'];
const one = (value: number): number => Math.round(value * 10) / 10;

/**
 * La llave de ejemplo dibujada a la medida del hueco: una columna por ronda y
 * otra para el campeón. `width` es el ancho disponible en píxeles; por debajo
 * de 260 se dibuja a 260 y el SVG la encoge. Los textos se acortan cuando la
 * columna es estrecha. Con `solo` (uno contra uno) las plazas son jugadores.
 */
export function bracketLayout(size: number, width: number, solo = false): BracketLayout {
  const W = Math.max(260, Math.floor(Number.isFinite(width) ? width : 0));
  const R = roundCount(size);
  const rowH = size >= 16 ? 22 : size >= 8 ? 34 : 52;
  const head = 28;
  const H = head + size * rowH + 4;
  const colW = W / (R + 1);
  const conn = Math.max(12, Math.min(30, colW * 0.24));
  const barW = colW - conn;
  const barH = Math.min(rowH - 6, 28);
  const cy = (round: number, index: number): number => head + (index + 0.5) * (1 << round) * rowH;
  const x0 = (round: number): number => round * colW;
  // El equipo de ejemplo no empieza arriba del todo: así su camino cruza la llave
  const me = size === 4 ? 1 : 2;
  const names = colW >= 118 ? null : colW < 84 ? TITLES_TINY : TITLES_SHORT;

  const heads = Array.from({ length: R + 1 }, (_, round) => ({
    round,
    x: one(x0(round) + 1),
    label: round === R ? 'Campeón' : names ? names[R - 1 - round] : roundTitle(round, size),
  }));

  const links: BracketLayout['links'] = [];
  const route: BracketLayout['route'] = [];
  for (let round = 0; round < R; round += 1) {
    const xa = one(x0(round) + barW);
    const xm = one(x0(round) + barW + conn / 2);
    const xb = one(x0(round + 1));
    for (let match = 0; match < size >> (round + 1); match += 1) {
      links.push({ round, d: `M${xa} ${one(cy(round, match * 2))}H${xm}V${one(cy(round, match * 2 + 1))}H${xa}M${xm} ${one(cy(round + 1, match))}H${xb}` });
    }
    route.push({ round, d: `M${xa} ${one(cy(round, me >> round))}H${xm}V${one(cy(round + 1, me >> (round + 1)))}H${xb}` });
  }

  const slots: BracketSlot[] = [];
  for (let round = 0; round <= R; round += 1) {
    for (let index = 0; index < size >> round; index += 1) {
      const mine = me >> round === index;
      slots.push({
        round,
        x: one(x0(round)),
        y: one(cy(round, index) - barH / 2),
        label: round === 0 ? (barW >= 84 ? `${solo ? 'Jugador' : 'Equipo'} ${index + 1}` : String(index + 1)) : null,
        kind: round === R ? 'champ' : round === 0 ? (mine ? 'mine' : 'plain') : 'tbd',
        opponent: round < R && ((me >> round) ^ 1) === index,
      });
    }
  }

  const cupY = cy(R, 0) - barH / 2 - 34;
  return {
    width: W,
    height: H,
    barW: one(barW),
    barH,
    heads,
    slots,
    links,
    route,
    token: Array.from({ length: R + 1 }, (_, round) => ({ x: one(x0(round)), y: one(cy(round, me >> round) - barH / 2) })),
    tokenLabel: barW >= 72 && !solo ? 'Tu equipo' : 'Tú',
    cup: cupY > head ? { x: one(x0(R) + barW / 2 - 12), y: one(cupY) } : null,
  };
}

/** Lo que cuenta la llave mientras el equipo de ejemplo avanza. `strong` va resaltado. */
export interface BracketCaption {
  before: string;
  strong: string;
  after: string;
}

/**
 * El pie de la llave. `phase`: `rest` (en reposo, todo dibujado), `start` (al
 * empezar) o el número de la ronda que el equipo de ejemplo acaba de ganar.
 */
export function bracketCaption(size: number, phase: 'rest' | 'start' | number, solo = false): BracketCaption {
  const R = roundCount(size);
  if (phase === 'start') return { before: 'Empiezan ', strong: `${size} ${solo ? 'jugadores' : 'equipos'}`, after: '.' };
  if (phase === 'rest') return { before: `El ${solo ? 'jugador' : 'equipo'} de ejemplo gana ${NUMBER_WORDS[R]} partidas seguidas y `, strong: 'se lleva el torneo', after: '.' };
  const round = Math.max(0, Math.min(R - 1, phase));
  const next = round === R - 1 ? 'se lleva el torneo' : `pasa a ${round === R - 2 ? 'la final' : roundTitle(round + 1, size).toLowerCase()}`;
  return { before: '', strong: `${roundTitle(round, size)}:`, after: ` gana y ${next}.` };
}

/** Lo que lee un lector de pantalla en lugar del dibujo de la llave. */
export const bracketSummary = (size: number, solo = false): string =>
  `Llave de ${size} ${solo ? 'jugadores' : 'equipos'} a eliminación directa: ${roundsList(size)}. Un ${solo ? 'jugador' : 'equipo'} de ejemplo gana todas sus partidas y llega a campeón.`;

/** Segundos que el avance automático espera en un paso. La llave necesita los que tarda en dibujarse. */
export const autoWaitSeconds = (step: number, size: number): number => (step === 1 ? Math.max(7, 4.5 + roundCount(size) * 1.5) : 7);

// ---------- «Ya la vi» ----------

export const INTRO_SEEN_KEY = 'lalo_torneo_presentacion_vista';
/** Cuántos torneos se recuerdan: los más antiguos se olvidan. */
const SEEN_MAX = 40;

type SeenStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** El almacenamiento del navegador, o null si no hay o está bloqueado. */
function browserStorage(): SeenStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readSeen(storage: SeenStorage | null): string[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(INTRO_SEEN_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && SLUG_RE.test(item)) : [];
  } catch {
    return [];
  }
}

/** true si en este navegador ya se vio (o se saltó) la presentación de ese torneo. */
export function introSeen(slug: string, storage: SeenStorage | null = browserStorage()): boolean {
  return readSeen(storage).includes(slug);
}

/** Recuerda que la presentación de ese torneo ya se vio. Sin almacenamiento no hace nada. */
export function markIntroSeen(slug: string, storage: SeenStorage | null = browserStorage()): void {
  if (!storage || !SLUG_RE.test(slug)) return;
  try {
    const next = [...readSeen(storage).filter((item) => item !== slug), slug].slice(-SEEN_MAX);
    storage.setItem(INTRO_SEEN_KEY, JSON.stringify(next));
  } catch {
    // Almacenamiento lleno o bloqueado: la presentación volverá a salir la próxima vez
  }
}

/** Qué se ve al abrir el enlace: la presentación o, si está apagada o ya se vio, el formulario. */
export function firstView(tournament: Pick<PublicTournament, 'intro'>, seen: boolean): 'intro' | 'form' {
  return tournament.intro && !seen ? 'intro' : 'form';
}
