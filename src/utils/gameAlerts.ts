/**
 * src/utils/gameAlerts.ts
 *
 * Lógica pura de «Alertas de juego», sin pantalla ni red:
 *
 * - Lee la «foto» que entrega el servidor (/api/riot/state): rango, partida en
 *   curso, última partida terminada y maestría. Solo datos de la cuenta del
 *   propio streamer.
 * - Compara la foto anterior con la nueva y decide qué alertas salen. La primera
 *   foto solo fija el punto de partida: no dispara nada. Una foto que no es «ok»
 *   (Riot no respondió, hay que esperar) no se compara ni sustituye a la buena.
 * - Lleva la cuenta de la sesión (victorias, derrotas y racha).
 * - Da a cada alerta su texto en pantalla y la frase que lee la voz, con la
 *   etiqueta de emoción delante.
 *
 * Los nombres que llegan de Riot (campeón, cola) son texto: se pintan como
 * texto y nunca como HTML.
 */

import { GAME_ALERTS, GAME_TONES, type GameAlertDef, type GameAlertId, type GameSettings } from '../types/game';

// ---------- La foto ----------

export interface GameRank {
  tier: string;
  division: string;
  lp: number;
  wins: number;
  losses: number;
}
export interface GameLive {
  gameId: string;
  champion: string;
  queue: string;
}
export interface GameLast {
  matchId: string;
  win: boolean;
  remake: boolean;
  ranked: boolean;
  champion: string;
  queue: string;
  durationSec: number;
  kills: number;
  deaths: number;
  assists: number;
  pentaKills: number;
}
export interface GameMastery {
  championId: number;
  champion: string;
  level: number;
  points: number;
}
export interface GameSnapshot {
  /** ok, not_linked, not_configured, limited, key_invalid, error… Solo «ok» se compara. */
  status: string;
  riotId: string;
  rank: GameRank | null;
  live: GameLive | null;
  last: GameLast | null;
  mastery: GameMastery[];
}

export const GAME_TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'] as const;
const DIVISIONS = ['IV', 'III', 'II', 'I'];
const APEX = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];
const TIER_NAMES: Record<string, string> = {
  IRON: 'Hierro',
  BRONZE: 'Bronce',
  SILVER: 'Plata',
  GOLD: 'Oro',
  PLATINUM: 'Platino',
  EMERALD: 'Esmeralda',
  DIAMOND: 'Diamante',
  MASTER: 'Maestro',
  GRANDMASTER: 'Gran Maestro',
  CHALLENGER: 'Retador',
};
const DIVISION_WORDS: Record<string, string> = { I: 'uno', II: 'dos', III: 'tres', IV: 'cuatro' };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const count = (value: unknown, max = 1_000_000_000): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(max, Math.round(value)) : 0;

function parseRank(raw: unknown): GameRank | null {
  if (!isObject(raw)) return null;
  const tier = typeof raw.tier === 'string' ? raw.tier.toUpperCase() : '';
  if (!(GAME_TIERS as readonly string[]).includes(tier)) return null;
  const division = typeof raw.division === 'string' && DIVISIONS.includes(raw.division.toUpperCase()) ? raw.division.toUpperCase() : 'I';
  return { tier, division, lp: count(raw.lp, 100_000), wins: count(raw.wins, 100_000), losses: count(raw.losses, 100_000) };
}

function parseLive(raw: unknown): GameLive | null {
  if (!isObject(raw)) return null;
  const gameId = text(raw.gameId, 30);
  return gameId ? { gameId, champion: text(raw.champion, 40), queue: text(raw.queue, 40) } : null;
}

function parseLast(raw: unknown): GameLast | null {
  if (!isObject(raw)) return null;
  const matchId = text(raw.matchId, 40);
  if (!matchId) return null;
  return {
    matchId,
    win: raw.win === true,
    remake: raw.remake === true,
    ranked: raw.ranked === true,
    champion: text(raw.champion, 40),
    queue: text(raw.queue, 40),
    durationSec: count(raw.durationSec, 100_000),
    kills: count(raw.kills, 999),
    deaths: count(raw.deaths, 999),
    assists: count(raw.assists, 999),
    pentaKills: count(raw.pentaKills, 99),
  };
}

function parseMastery(raw: unknown): GameMastery[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isObject)
    .filter((item) => typeof item.championId === 'number' && Number.isFinite(item.championId))
    .slice(0, 20)
    .map((item) => ({ championId: item.championId as number, champion: text(item.champion, 40), level: count(item.level, 10_000), points: count(item.points) }));
}

/** La foto a partir de lo que responda el servidor. Tolera cualquier forma; sin estado, «error». */
export function parseSnapshot(raw: unknown): GameSnapshot {
  const src = isObject(raw) ? raw : {};
  return {
    status: text(src.status, 30) || 'error',
    riotId: text(src.riotId, 40),
    rank: parseRank(src.rank),
    live: parseLive(src.live),
    last: parseLast(src.last),
    mastery: parseMastery(src.mastery),
  };
}

/** Posición de un rango en la escalera: más alto, mejor. */
export function rankValue(rank: Pick<GameRank, 'tier' | 'division'>): number {
  const tier = (GAME_TIERS as readonly string[]).indexOf(rank.tier);
  return tier * 4 + (APEX.includes(rank.tier) ? 3 : Math.max(0, DIVISIONS.indexOf(rank.division)));
}

/** «Oro II», «Maestro». */
export function rankLabel(rank: Pick<GameRank, 'tier' | 'division'>): string {
  const name = TIER_NAMES[rank.tier] ?? rank.tier;
  return APEX.includes(rank.tier) ? name : `${name} ${rank.division}`;
}

/** Como lo dice la voz: «Oro dos». */
export function rankSpoken(rank: Pick<GameRank, 'tier' | 'division'>): string {
  const name = TIER_NAMES[rank.tier] ?? rank.tier;
  return APEX.includes(rank.tier) ? name : `${name} ${DIVISION_WORDS[rank.division] ?? rank.division}`;
}

// ---------- Alertas ----------

export interface GameAlert {
  id: GameAlertId;
  /** Identifica el hecho (la partida, el rango alcanzado…): una fuente no la enseña dos veces. */
  key: string;
  champion?: string;
  queue?: string;
  durationSec?: number;
  kills?: number;
  deaths?: number;
  assists?: number;
  /** Puntos de liga ganados o perdidos, si se pueden saber. */
  lpDelta?: number;
  rank?: GameRank;
  level?: number;
  points?: number;
  streak?: number;
  sessionWins?: number;
  sessionLosses?: number;
}

export interface GameSession {
  wins: number;
  losses: number;
  streak: number;
}
export const EMPTY_SESSION: GameSession = { wins: 0, losses: 0, streak: 0 };

export interface GameState {
  snapshot: GameSnapshot;
  session: GameSession;
  savedAt: number;
}

/** Una foto guardada hace más que esto ya no sirve de punto de partida: lo que pasó entretanto no se anuncia. */
export const GAME_STATE_MAX_AGE_MS = 20 * 60 * 1000;

/** El estado guardado en localStorage, o null si no hay, no se lee o es viejo. */
export function readGameState(raw: string | null | undefined, now: number): GameState | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed)) return null;
    const savedAt = typeof parsed.savedAt === 'number' ? parsed.savedAt : 0;
    if (!(savedAt > 0) || now - savedAt > GAME_STATE_MAX_AGE_MS || savedAt - now > 60_000) return null;
    const snapshot = parseSnapshot(parsed.snapshot);
    if (snapshot.status !== 'ok') return null;
    const session = isObject(parsed.session) ? parsed.session : {};
    return { snapshot, session: { wins: count(session.wins, 9999), losses: count(session.losses, 9999), streak: count(session.streak, 9999) }, savedAt };
  } catch {
    return null;
  }
}

/**
 * Compara dos fotos «ok» y devuelve las alertas, en el orden en que salen, y la
 * sesión actualizada. No mira qué alertas tiene encendidas el streamer.
 */
export function diffSnapshots(prev: GameSnapshot, next: GameSnapshot, session: GameSession, streakMin = 3): { alerts: GameAlert[]; session: GameSession } {
  const alerts: GameAlert[] = [];
  let after = session;

  // Empieza una partida
  if (next.live && next.live.gameId !== prev.live?.gameId) {
    alerts.push({ id: 'start', key: `start:${next.live.gameId}`, champion: next.live.champion, queue: next.live.queue });
  }

  // Termina una partida: la última de la lista ya no es la misma. Sin una partida anterior con la
  // que comparar solo cuenta si se le vio jugando
  const last = next.last;
  if (last && last.matchId !== prev.last?.matchId && (prev.last || prev.live) && !last.remake) {
    after = last.win ? { wins: session.wins + 1, losses: session.losses, streak: session.streak + 1 } : { wins: session.wins, losses: session.losses + 1, streak: 0 };
    const base = { champion: last.champion, queue: last.queue, durationSec: last.durationSec, kills: last.kills, deaths: last.deaths, assists: last.assists };
    // Los puntos de liga solo se saben si la partida era de solo/dúo y no hubo cambio de división
    const sameStep = prev.rank && next.rank && prev.rank.tier === next.rank.tier && prev.rank.division === next.rank.division;
    const lpDelta = last.ranked && sameStep && prev.rank && next.rank ? next.rank.lp - prev.rank.lp : 0;
    alerts.push({ id: last.win ? 'win' : 'loss', key: `${last.win ? 'win' : 'loss'}:${last.matchId}`, ...base, ...(lpDelta !== 0 ? { lpDelta } : {}) });
    if (last.pentaKills > 0) alerts.push({ id: 'penta', key: `penta:${last.matchId}`, ...base });
    if (last.win && last.deaths === 0 && last.kills + last.assists > 0) alerts.push({ id: 'perfect', key: `perfect:${last.matchId}`, ...base });
    if (last.win && after.streak >= streakMin) {
      alerts.push({ id: 'streak', key: `streak:${last.matchId}`, streak: after.streak, sessionWins: after.wins, sessionLosses: after.losses });
    }
  }

  // Rango de solo/dúo
  if (next.rank) {
    const now = rankValue(next.rank);
    const key = `${next.rank.tier}-${next.rank.division}`;
    if (!prev.rank) {
      // Acaba de terminar el posicionamiento
      alerts.push({ id: 'promo', key: `promo:${key}`, rank: next.rank });
    } else {
      const before = rankValue(prev.rank);
      if (now > before) alerts.push({ id: prev.rank.tier === next.rank.tier ? 'up' : 'promo', key: `${prev.rank.tier === next.rank.tier ? 'up' : 'promo'}:${key}`, rank: next.rank });
      if (now < before) alerts.push({ id: 'down', key: `down:${key}`, rank: next.rank });
    }
  }

  // Maestría: solo de un campeón que ya estaba en la foto anterior, para que entrar en la lista no cuente
  next.mastery.forEach((item) => {
    const before = prev.mastery.find((old) => old.championId === item.championId);
    if (before && item.level > before.level) {
      alerts.push({ id: 'mastery', key: `mastery:${item.championId}:${item.level}`, champion: item.champion, level: item.level, points: item.points });
    }
  });

  return { alerts, session: after };
}

/**
 * Un paso del sondeo: con el estado anterior (o null) y la foto nueva devuelve
 * el estado a guardar y las alertas. Una foto que no es «ok» deja todo como estaba.
 */
export function advanceGame(state: GameState | null, next: GameSnapshot, now: number, streakMin = 3): { state: GameState | null; alerts: GameAlert[] } {
  if (next.status !== 'ok') return { state, alerts: [] };
  // Primera foto, foto vieja u otra cuenta: punto de partida, sin alertas
  if (!state || now - state.savedAt > GAME_STATE_MAX_AGE_MS || state.snapshot.riotId !== next.riotId) {
    return { state: { snapshot: next, session: EMPTY_SESSION, savedAt: now }, alerts: [] };
  }
  const { alerts, session } = diffSnapshots(state.snapshot, next, state.session, streakMin);
  return { state: { snapshot: next, session, savedAt: now }, alerts };
}

// ---------- Texto en pantalla y frase de la voz ----------

export interface GameAlertView {
  id: GameAlertId;
  color: string;
  tagline: string;
  title: string;
  sub: string;
  stats: { label: string; value: string }[];
}

const DEFS = Object.fromEntries(GAME_ALERTS.map((item) => [item.id, item])) as Record<GameAlertId, GameAlertDef>;
export const GAME_NAME = 'League of Legends';
const SOLO = 'Clasificatoria solo/dúo';

/** 152300 → «152 300». */
export const groupDigits = (value: number): string => String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
// Un nombre que viene de fuera no puede traer corchetes: la voz los tomaría por una etiqueta de emoción
const plain = (value: string | undefined): string => (value ?? '').replace(/[[\]{}]/g, '').trim();

function fill(template: string, alert: GameAlert): string {
  return template
    .replace(/\{rango\}/g, alert.rank ? rankLabel(alert.rank) : '')
    .replace(/\{campeon\}/g, plain(alert.champion))
    .replace(/\{nivel\}/g, alert.level ? String(alert.level) : '')
    .replace(/\{racha\}/g, alert.streak ? String(alert.streak) : '')
    .replace(/\s+/g, ' ')
    .trim();
}

const kda = (alert: GameAlert) => [
  { label: 'K', value: String(alert.kills ?? 0) },
  { label: 'D', value: String(alert.deaths ?? 0) },
  { label: 'A', value: String(alert.assists ?? 0) },
];
const joined = (...parts: (string | undefined | false)[]): string => parts.filter(Boolean).join(' · ');

/** Lo que pinta la placa para esa alerta con los ajustes del streamer. */
export function alertView(alert: GameAlert, settings: GameSettings): GameAlertView {
  const def = DEFS[alert.id];
  const own = settings.alerts[alert.id]?.title ?? '';
  const champion = plain(alert.champion);
  const minutes = alert.durationSec ? `${Math.max(1, Math.round(alert.durationSec / 60))} min` : '';
  let sub = '';
  let stats: GameAlertView['stats'] = [];
  if (alert.id === 'win' || alert.id === 'loss') {
    sub = joined(champion, plain(alert.queue), minutes);
    stats = [...kda(alert), ...(alert.lpDelta ? [{ label: 'PL', value: `${alert.lpDelta > 0 ? '+' : ''}${alert.lpDelta}` }] : [])];
  } else if (alert.id === 'up' || alert.id === 'promo' || alert.id === 'down') {
    sub = SOLO;
    if (alert.rank) {
      stats = [{ label: 'PL', value: String(alert.rank.lp) }, { label: 'V', value: String(alert.rank.wins) }, { label: 'D', value: String(alert.rank.losses) }];
    }
  } else if (alert.id === 'penta') {
    sub = joined(champion, 'en la última partida');
    stats = kda(alert);
  } else if (alert.id === 'perfect') {
    sub = joined(champion, 'Sin ninguna muerte');
    stats = kda(alert);
  } else if (alert.id === 'mastery') {
    sub = alert.points ? `${groupDigits(alert.points)} puntos` : '';
  } else if (alert.id === 'streak') {
    sub = `En este directo: ${alert.sessionWins ?? 0} V · ${alert.sessionLosses ?? 0} D`;
    stats = [{ label: 'V', value: String(alert.sessionWins ?? 0) }, { label: 'D', value: String(alert.sessionLosses ?? 0) }];
  } else {
    sub = joined(champion, plain(alert.queue));
  }
  return {
    id: alert.id,
    color: settings.colorMode === 'tone' ? GAME_TONES[def.tone] : settings.color,
    tagline: settings.showGame ? `${GAME_NAME} · ${def.tag}` : def.tag,
    title: fill(own, alert) || fill(def.title, alert) || def.name,
    sub,
    stats: settings.showStats ? stats : [],
  };
}

/** La frase de serie de cada alerta, sin etiqueta. */
function phrase(alert: GameAlert): string {
  const champion = plain(alert.champion);
  const score = `${alert.kills ?? 0}, ${alert.deaths ?? 0}, ${alert.assists ?? 0}`;
  switch (alert.id) {
    case 'win':
      return champion ? `Victoria con ${champion}. ${score}.` : `Victoria. ${score}.`;
    case 'loss':
      return 'Derrota. A por la siguiente.';
    case 'up':
      return alert.rank ? `Subimos a ${rankSpoken(alert.rank)}.` : 'Subimos de división.';
    case 'promo':
      return alert.rank ? `Nueva liga: ${rankSpoken(alert.rank)}.` : 'Nueva liga.';
    case 'down':
      return alert.rank ? `Bajamos a ${rankSpoken(alert.rank)}. Se recupera.` : 'Bajamos de división. Se recupera.';
    case 'penta':
      return champion ? `Pentakill con ${champion} en la última partida.` : 'Pentakill en la última partida.';
    case 'perfect':
      return `Partida perfecta: ${score}.`;
    case 'mastery':
      return `${`Maestría ${alert.level ?? ''}`.trim()}${champion ? ` con ${champion}` : ''}.`;
    case 'streak':
      return `${alert.streak ?? 0} victorias seguidas.`;
    default:
      return champion ? `Empieza la partida. Hoy toca ${champion}.` : 'Empieza la partida.';
  }
}

/**
 * Lo que lee la voz: la etiqueta de emoción entre corchetes y la frase. Con un
 * título propio se lee ese título; si no, la frase de serie.
 */
export function announceText(alert: GameAlert, settings: GameSettings): string {
  const own = fill(settings.alerts[alert.id]?.title ?? '', alert).replace(/[[\]]/g, '');
  const body = own ? (/[.!?…]$/.test(own) ? own : `${own}.`) : phrase(alert);
  const emotion = settings.alerts[alert.id]?.emotion ?? '';
  return emotion ? `[${emotion}] ${body}` : body;
}

/** Alertas de ejemplo para el estudio y para demo=1. Datos inventados. */
export const SAMPLE_ALERTS: Record<GameAlertId, GameAlert> = {
  win: { id: 'win', key: 'sample:win', champion: 'Ahri', queue: SOLO, durationSec: 1860, kills: 9, deaths: 2, assists: 11, lpDelta: 21 },
  loss: { id: 'loss', key: 'sample:loss', champion: 'Ahri', queue: SOLO, durationSec: 1620, kills: 3, deaths: 7, assists: 5, lpDelta: -18 },
  up: { id: 'up', key: 'sample:up', rank: { tier: 'GOLD', division: 'II', lp: 12, wins: 48, losses: 41 } },
  promo: { id: 'promo', key: 'sample:promo', rank: { tier: 'PLATINUM', division: 'IV', lp: 0, wins: 63, losses: 52 } },
  down: { id: 'down', key: 'sample:down', rank: { tier: 'SILVER', division: 'I', lp: 75, wins: 30, losses: 34 } },
  penta: { id: 'penta', key: 'sample:penta', champion: 'Ahri', queue: SOLO, durationSec: 1860, kills: 9, deaths: 2, assists: 11 },
  perfect: { id: 'perfect', key: 'sample:perfect', champion: 'Ahri', queue: SOLO, durationSec: 1500, kills: 12, deaths: 0, assists: 8 },
  mastery: { id: 'mastery', key: 'sample:mastery', champion: 'Ahri', level: 7, points: 152300 },
  streak: { id: 'streak', key: 'sample:streak', streak: 3, sessionWins: 4, sessionLosses: 1 },
  start: { id: 'start', key: 'sample:start', champion: 'Ahri', queue: SOLO },
};
