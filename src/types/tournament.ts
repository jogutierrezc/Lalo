/**
 * src/types/tournament.ts
 *
 * Módulo «Torneos»: una llave de eliminación directa para 4, 8 o 16 equipos.
 * Son dos cosas separadas:
 *
 * - AJUSTES (TournamentSettings): lo que configura el streamer. Nombre, tamaño,
 *   estilo, color propio, logo, patrocinadores, narrador y nombres de los
 *   comandos. Se guardan en este navegador y, con cuenta abierta, en la nube.
 * - ESTADO VIVO (TournamentState): los equipos en su orden de siembra, quién
 *   ganó cada partida, el historial para deshacer y qué pantalla se ve. Vive
 *   detrás de src/lib/tournamentStore.ts.
 *
 * Todo lo leído (de localStorage, de la nube, de la URL o del bus) pasa por
 * normalizeTournamentSettings o normalizeTournamentState. Los nombres de los
 * equipos los escribe gente de fuera: se guardan como texto llano, sin < > ni
 * corchetes (los corchetes son etiquetas de emoción para la voz), y las
 * imágenes solo admiten direcciones que una <img> carga sin ejecutar nada.
 *
 * La copia del estado dentro de los ajustes. Mientras el estado NO vive en la
 * nube (sin cuenta, sin conexión o sin la migración 0017), lo que se sube con
 * queueCloudPush('tournament', …) y lo que se guarda en `lalo_tournament_settings`
 * lleva, además de los ajustes, una copia del estado en el campo `state`. Así el
 * estado llega a OBS en otro equipo con el mismo paquete que ya descarga cada
 * diez segundos. normalizeTournamentSettings ignora ese campo; lo lee
 * loadSyncedTournamentState. Cuando el almacén de la nube responde
 * (lib/tournamentCloud.ts), la copia se quita: saveTournamentSettings(…, null).
 */

import { queueCloudPush } from '../lib/cloudConfig';
import { decodeBase64Url, encodeBase64Url } from '../utils/appearance';
import { cleanResults } from '../utils/tournamentLogic';
import { ANNOUNCER_VOICE_ID } from './raid';

export type TournamentSize = 4 | 8 | 16;
export type TournamentStyle = 'grieta' | 'cabina' | 'estadio' | 'cartel';
/** Lo que enseña la capa. `oculto` no pinta nada. */
export type TournamentScene = 'llave' | 'sigue' | 'tabla' | 'victoria' | 'campeon' | 'oculto';

export const TOURNAMENT_SIZES: { id: TournamentSize; name: string }[] = [
  { id: 4, name: '4 equipos' },
  { id: 8, name: '8 equipos' },
  { id: 16, name: '16 equipos' },
];
export const TOURNAMENT_STYLES: { id: TournamentStyle; name: string; about: string }[] = [
  { id: 'grieta', name: 'Grieta', about: 'Placas talladas, dorado sobre azul noche. El mismo estilo de las alertas de juego.' },
  { id: 'cabina', name: 'Cabina', about: 'El rótulo de emisión de Lalo, igual que el resto de tus capas.' },
  { id: 'estadio', name: 'Estadio', about: 'Cortes en diagonal y tipografía inclinada, como una retransmisión de esports.' },
  { id: 'cartel', name: 'Cartel', about: 'Papel claro, tinta gruesa y esquinas redondas, como el bocadillo de la mascota.' },
];
export const TOURNAMENT_SCENES: { id: TournamentScene; name: string }[] = [
  { id: 'llave', name: 'Llave' },
  { id: 'sigue', name: 'Sigue' },
  { id: 'tabla', name: 'Tabla' },
  { id: 'victoria', name: 'Victoria' },
  { id: 'campeon', name: 'Campeón' },
  { id: 'oculto', name: 'Oculto' },
];

export interface TournamentImage {
  url: string;
  name: string;
  mediaId: string;
}

export interface TournamentSponsor {
  id: string;
  name: string;
  /** Con imagen, sale el logo; sin ella, el nombre. */
  image: TournamentImage | null;
}

/** Nombres de los comandos de moderación, con su «!». */
export interface TournamentCommands {
  winner: string;
  undo: string;
  main: string;
}

export interface TournamentSettings {
  enabled: boolean;
  /** Aparece también en la fuente «Todo en uno». */
  inAll: boolean;
  name: string;
  /** El juego se nombra en texto: aquí no hay logos de nadie. */
  game: string;
  size: TournamentSize;
  /** Jugadores por equipo, de 1 a 5. */
  teamSize: number;
  style: TournamentStyle;
  /** Con el color propio encendido, `color` sustituye al acento del estilo. */
  customColor: boolean;
  color: string;
  logo: TournamentImage | null;
  sponsors: TournamentSponsor[];
  narrator: boolean;
  /** Voz del catálogo con la que narra. */
  voiceId: string;
  commands: TournamentCommands;
  /** Segundos que dura la pantalla de victoria antes de volver a la llave. */
  victorySec: number;
}

export interface TournamentTeam {
  id: string;
  name: string;
  /** Riot ID del capitán. Lo rellenará la inscripción por enlace; a mano queda vacío. */
  captain: string;
  players: string[];
}

export interface TournamentState {
  /** En su orden de siembra: el primero ocupa el primer hueco de la llave. */
  teams: TournamentTeam[];
  /** Tamaño de la llave a la que pertenecen `results`. */
  size: TournamentSize;
  /** Ganador de cada partida (índice en `teams`) o null. Primero la primera ronda, al final la final. */
  results: (number | null)[];
  /** Partidas resueltas, en el orden en que se resolvieron: lo que «deshacer» recorre hacia atrás. */
  history: number[];
  scene: TournamentScene;
  /** Desde cuándo está esa pantalla (ms de reloj). La de victoria caduca sola. */
  sceneAt: number;
  /** Momento del último cambio que el narrador debe contar. Deshacer no lo mueve. */
  cueAt: number;
  /** Última partida resuelta, o null. */
  last: number | null;
  /** Sube con cada cambio. */
  version: number;
  updatedAt: number;
}

export const TOURNAMENT_STORAGE_KEY = 'lalo_tournament_settings';
export const TOURNAMENT_STATE_KEY = 'lalo_tournament_state';

export const TOURNAMENT_LIMITS = {
  name: 28,
  game: 30,
  team: 22,
  captain: 30,
  player: 30,
  sponsor: 24,
  sponsors: 5,
  teamSize: { min: 1, max: 5 },
  victorySec: { min: 3, max: 15 },
} as const;

export const DEFAULT_TOURNAMENT_COMMANDS: TournamentCommands = { winner: '!ganador', undo: '!deshacer', main: '!torneo' };
export const DEFAULT_TOURNAMENT_COLOR = '#3ddcff';

export const DEFAULT_TOURNAMENT_SETTINGS: TournamentSettings = {
  enabled: true,
  inAll: false,
  name: 'Copa Lalo',
  game: 'League of Legends',
  size: 8,
  teamSize: 5,
  style: 'grieta',
  customColor: false,
  color: DEFAULT_TOURNAMENT_COLOR,
  logo: null,
  sponsors: [],
  narrator: true,
  voiceId: ANNOUNCER_VOICE_ID,
  commands: DEFAULT_TOURNAMENT_COMMANDS,
  victorySec: 5,
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
const num = (value: unknown, limits: { min: number; max: number }, fallback: number): number => {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.min(limits.max, Math.max(limits.min, n)));
};
const stamp = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
/** Texto llano: sin caracteres de control, sin etiquetas HTML ni < > sueltos, y sin corchetes (etiquetas de emoción de la voz). */
const text = (value: unknown, max: number): string =>
  typeof value === 'string'
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/<[^<>]*>|\[[^[\]]*\]/g, ' ')
        .replace(/[<>[\]]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max)
    : '';
const oneOf = <T extends string | number>(value: unknown, list: readonly { id: T }[], fallback: T): T =>
  list.some((item) => item.id === value) ? (value as T) : fallback;
const ID_RE = /^[a-z0-9_-]{1,24}$/;

export function normalizeTournamentImage(raw: unknown): TournamentImage | null {
  if (!isObject(raw) || typeof raw.url !== 'string' || !raw.url) return null;
  // Solo direcciones que una <img> puede cargar sin ejecutar nada
  if (!/^(https:\/\/|r2:|data:image\/|blob:|\/)/i.test(raw.url)) return null;
  return { url: raw.url, name: text(raw.name, 120), mediaId: text(raw.mediaId, 80) };
}

/** Comando válido: empieza por !, de 1 a 15 letras, números o guion bajo, en minúsculas. */
export function normalizeTournamentCommand(value: unknown, fallback: string): string {
  const raw = String(value ?? '').trim().toLowerCase();
  const command = raw.startsWith('!') ? raw : `!${raw}`;
  return /^![a-z0-9_]{1,15}$/.test(command) ? command : fallback;
}

function normalizeCommands(raw: unknown): TournamentCommands {
  const src = isObject(raw) ? raw : {};
  const d = DEFAULT_TOURNAMENT_COMMANDS;
  const commands: TournamentCommands = {
    winner: normalizeTournamentCommand(src.winner, d.winner),
    undo: normalizeTournamentCommand(src.undo, d.undo),
    main: normalizeTournamentCommand(src.main, d.main),
  };
  // Dos comandos con el mismo nombre no se distinguirían: vuelven todos a los de serie
  return new Set(Object.values(commands)).size === 3 ? commands : d;
}

function normalizeSponsors(raw: unknown): TournamentSponsor[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const sponsors: TournamentSponsor[] = [];
  raw.forEach((item, index) => {
    if (!isObject(item) || sponsors.length >= TOURNAMENT_LIMITS.sponsors) return;
    const image = normalizeTournamentImage(item.image);
    const name = text(item.name, TOURNAMENT_LIMITS.sponsor);
    // Sin nombre y sin imagen no hay nada que enseñar
    if (!name && !image) return;
    let id = typeof item.id === 'string' && ID_RE.test(item.id) ? item.id : `s${index + 1}`;
    while (seen.has(id)) id = `${id}x`.slice(0, 24);
    seen.add(id);
    sponsors.push({ id, name, image });
  });
  return sponsors;
}

/** Ajustes válidos a partir de cualquier cosa. Lo que falta o no vale queda en su valor por defecto. */
export function normalizeTournamentSettings(raw: unknown): TournamentSettings {
  const src = isObject(raw) ? raw : {};
  const d = DEFAULT_TOURNAMENT_SETTINGS;
  return {
    enabled: bool(src.enabled, d.enabled),
    inAll: bool(src.inAll, d.inAll),
    name: text(src.name, TOURNAMENT_LIMITS.name) || d.name,
    game: text(src.game, TOURNAMENT_LIMITS.game) || d.game,
    size: oneOf(Number(src.size), TOURNAMENT_SIZES, d.size),
    teamSize: num(src.teamSize, TOURNAMENT_LIMITS.teamSize, d.teamSize),
    style: oneOf(src.style, TOURNAMENT_STYLES, d.style),
    customColor: bool(src.customColor, d.customColor),
    color: typeof src.color === 'string' && /^#[0-9a-f]{6}$/i.test(src.color) ? src.color.toLowerCase() : d.color,
    logo: normalizeTournamentImage(src.logo),
    sponsors: normalizeSponsors(src.sponsors),
    narrator: bool(src.narrator, d.narrator),
    voiceId: typeof src.voiceId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(src.voiceId) ? src.voiceId : d.voiceId,
    commands: normalizeCommands(src.commands),
    victorySec: num(src.victorySec, TOURNAMENT_LIMITS.victorySec, d.victorySec),
  };
}

function normalizeTeams(raw: unknown, size: number): TournamentTeam[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const teams: TournamentTeam[] = [];
  raw.forEach((item) => {
    if (!isObject(item) || teams.length >= size) return;
    let id = typeof item.id === 'string' && ID_RE.test(item.id) ? item.id : `t${teams.length + 1}`;
    while (seen.has(id)) id = `${id}x`.slice(0, 24);
    seen.add(id);
    teams.push({
      id,
      // Un equipo sin nombre conserva su sitio: los resultados van por posición
      name: text(item.name, TOURNAMENT_LIMITS.team) || `Equipo ${teams.length + 1}`,
      captain: text(item.captain, TOURNAMENT_LIMITS.captain),
      players: Array.isArray(item.players)
        ? item.players.map((player) => text(player, TOURNAMENT_LIMITS.player)).filter(Boolean).slice(0, TOURNAMENT_LIMITS.teamSize.max)
        : [],
    });
  });
  return teams;
}

export function emptyTournamentState(size: TournamentSize = DEFAULT_TOURNAMENT_SETTINGS.size): TournamentState {
  return {
    teams: [],
    size,
    results: Array.from({ length: size - 1 }, () => null),
    history: [],
    scene: 'llave',
    sceneAt: 0,
    cueAt: 0,
    last: null,
    version: 0,
    updatedAt: 0,
  };
}

/**
 * Estado válido a partir de cualquier cosa. Un resultado solo se conserva si su
 * partida se puede jugar con los resultados anteriores y el ganador es uno de
 * los dos equipos: un estado manipulado no puede coronar a quien no jugó.
 */
export function normalizeTournamentState(raw: unknown): TournamentState {
  const src = isObject(raw) ? raw : {};
  const size = oneOf(Number(src.size), TOURNAMENT_SIZES, DEFAULT_TOURNAMENT_SETTINGS.size);
  const teams = normalizeTeams(src.teams, size);
  const results = cleanResults(teams.length, size, Array.isArray(src.results) ? src.results : []);
  const decided = results.map((winner, match) => (winner === null ? -1 : match)).filter((match) => match >= 0);
  const history: number[] = [];
  (Array.isArray(src.history) ? src.history : []).forEach((match) => {
    if (typeof match === 'number' && decided.includes(match) && !history.includes(match)) history.push(match);
  });
  // Una partida resuelta que el historial no traía se añade en orden de llave
  decided.forEach((match) => {
    if (!history.includes(match)) history.push(match);
  });
  const last = typeof src.last === 'number' && decided.includes(src.last) ? src.last : (history[history.length - 1] ?? null);
  return {
    teams,
    size,
    results,
    history,
    scene: oneOf(src.scene, TOURNAMENT_SCENES, 'llave'),
    sceneAt: stamp(src.sceneAt),
    cueAt: stamp(src.cueAt),
    last,
    version: stamp(src.version),
    updatedAt: stamp(src.updatedAt),
  };
}

function readStored(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(TOURNAMENT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function loadTournamentSettings(): TournamentSettings {
  const stored = readStored();
  return stored ? normalizeTournamentSettings(stored) : DEFAULT_TOURNAMENT_SETTINGS;
}

/** La copia del estado que viaja dentro de los ajustes sincronizados, o null si no hay. */
export function loadSyncedTournamentState(): TournamentState | null {
  const stored = readStored();
  return stored && isObject(stored.state) ? normalizeTournamentState(stored.state) : null;
}

/**
 * Guarda los ajustes y, dentro de ellos, la copia del estado (ver la cabecera).
 * Sin `state` se conserva la copia que ya hubiera; con `null` se quita, que es
 * lo que toca cuando el estado vive en la nube.
 */
export function saveTournamentSettings(settings: TournamentSettings, state?: TournamentState | null): void {
  try {
    const copy = state === null ? null : (state ?? loadSyncedTournamentState());
    const payload = copy ? { ...settings, state: copy } : settings;
    localStorage.setItem(TOURNAMENT_STORAGE_KEY, JSON.stringify(payload));
    queueCloudPush('tournament', payload);
  } catch (err) {
    console.error('No se pudieron guardar los ajustes de Torneos:', err);
  }
}

/**
 * Ajustes (y estado) compactos para la URL de OBS cuando no hay cuenta en la
 * nube. Las imágenes guardadas solo en este navegador no caben en una URL y no
 * viajan. El estado va de reserva: sin nube es la única forma de que los
 * equipos lleguen a un OBS que no comparte almacenamiento con el panel.
 */
export function encodeTournamentSettings(settings: TournamentSettings, state?: TournamentState | null): string {
  const travels = (image: TournamentImage | null) => (image && !/^(data:|blob:)/i.test(image.url) ? image : null);
  return encodeBase64Url(
    JSON.stringify({
      ...settings,
      logo: travels(settings.logo),
      sponsors: settings.sponsors.map((sponsor) => ({ ...sponsor, image: travels(sponsor.image) })),
      ...(state ? { state } : {}),
    })
  );
}

function decodeParam(param: string | null | undefined): Record<string, unknown> | null {
  const decoded = decodeBase64Url(param);
  if (!decoded) return null;
  try {
    const parsed = JSON.parse(decoded);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Ajustes recibidos por URL, o null si el valor no se puede leer. */
export function decodeTournamentSettings(param: string | null | undefined): TournamentSettings | null {
  const parsed = decodeParam(param);
  return parsed ? normalizeTournamentSettings(parsed) : null;
}

/** El estado de reserva que venía en la URL, o null. */
export function decodeTournamentState(param: string | null | undefined): TournamentState | null {
  const parsed = decodeParam(param);
  return parsed && isObject(parsed.state) ? normalizeTournamentState(parsed.state) : null;
}
