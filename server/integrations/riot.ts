/**
 * server/integrations/riot.ts
 *
 * Lo que Lalo habla con Riot Games para «Alertas de juego» (League of Legends):
 * resolver un Riot ID, y armar la «foto» de la cuenta del streamer (rango,
 * partida en curso, última partida terminada y maestría) que la capa de OBS
 * compara con la anterior para decidir qué alertas salen.
 *
 * Riot (escrito de memoria; NO se pudo comprobar en developer.riotgames.com):
 *   - Riot ID = gameName#tagLine. account-v1 va por región (americas, europe,
 *     asia); league-v4, spectator-v5 y champion-mastery-v4 por plataforma (la1,
 *     la2, na1, br1, euw1…); match-v5 por región (americas, europe, asia, sea).
 *   - Cabecera X-Riot-Token con la clave. Todo por PUUID: las rutas por nombre
 *     de invocador están retiradas.
 *   - El PUUID depende de la clave: con otra clave Riot lo rechaza (400). Entonces
 *     se vuelve a resolver desde el Riot ID guardado.
 *   - 404 en spectator: no está en partida. 429: hay que esperar Retry-After.
 *   - Los nombres de campeón salen de Data Dragon, que no pide clave.
 *
 * Cada campo que se lee se comprueba antes de usarlo: nada da por hecho la
 * forma de una respuesta.
 *
 * Solo datos de la cuenta del propio streamer: de una partida se lee únicamente
 * su participante. Nada de rivales ni de compañeros.
 *
 * La clave de Riot (RIOT_API_KEY) no sale de aquí: ni en respuestas, ni en el
 * registro, ni en mensajes de error. El PUUID tampoco llega al navegador.
 *
 * SIN PROBAR contra Riot real.
 */

import type { Env, Store } from './store.js';

type Fetch = typeof fetch;

const TIMEOUT_MS = 8000;
/** Cuánto vale una foto para todas las fuentes de OBS del mismo streamer. */
export const RIOT_CACHE_MS = 45_000;
/** Cuánto se recuerda que una cuenta no está vinculada. */
export const RIOT_NEGATIVE_CACHE_MS = 15_000;
const CHAMPIONS_CACHE_MS = 12 * 60 * 60 * 1000;
const CHAMPIONS_RETRY_MS = 10 * 60 * 1000;
const MASTERY_TOP = 10;
const SOLO_QUEUE = 'RANKED_SOLO_5x5';

// ---------- Servidores ----------

export type RiotRegion = 'americas' | 'europe' | 'asia' | 'sea';

export interface RiotPlatform {
  id: string;
  name: string;
  /** Región de account-v1 (solo existe en americas, europe y asia). */
  account: Exclude<RiotRegion, 'sea'>;
  /** Región de match-v5. */
  match: RiotRegion;
}

export const RIOT_PLATFORMS: RiotPlatform[] = [
  { id: 'la1', name: 'Latinoamérica Norte', account: 'americas', match: 'americas' },
  { id: 'la2', name: 'Latinoamérica Sur', account: 'americas', match: 'americas' },
  { id: 'na1', name: 'Norteamérica', account: 'americas', match: 'americas' },
  { id: 'br1', name: 'Brasil', account: 'americas', match: 'americas' },
  { id: 'euw1', name: 'Europa Oeste', account: 'europe', match: 'europe' },
  { id: 'eun1', name: 'Europa Nórdica y Este', account: 'europe', match: 'europe' },
  { id: 'tr1', name: 'Turquía', account: 'europe', match: 'europe' },
  { id: 'ru', name: 'Rusia', account: 'europe', match: 'europe' },
  { id: 'me1', name: 'Oriente Medio', account: 'europe', match: 'europe' },
  { id: 'kr', name: 'Corea', account: 'asia', match: 'asia' },
  { id: 'jp1', name: 'Japón', account: 'asia', match: 'asia' },
  { id: 'oc1', name: 'Oceanía', account: 'asia', match: 'sea' },
  { id: 'sg2', name: 'Sudeste Asiático', account: 'asia', match: 'sea' },
  { id: 'tw2', name: 'Taiwán', account: 'asia', match: 'sea' },
  { id: 'vn2', name: 'Vietnam', account: 'asia', match: 'sea' },
];

export const platformOf = (id: unknown): RiotPlatform | null => RIOT_PLATFORMS.find((item) => item.id === id) ?? null;

/** La clave de Riot del servidor, o null. Solo se usa para la cabecera de las peticiones. */
export function readRiotKey(env: Env): string | null {
  const key = (env.RIOT_API_KEY ?? '').trim();
  return key || null;
}

// ---------- Riot ID ----------

export interface RiotId {
  gameName: string;
  tagLine: string;
}

/** «nombre#etiqueta»: nombre de 3 a 16 caracteres y etiqueta de 3 a 5 letras o números. null si no vale. */
export function parseRiotId(raw: unknown): RiotId | null {
  if (typeof raw !== 'string' || raw.length > 60) return null;
  const clean = raw.replace(/[\u0000-\u001f\u007f​-‍﻿]/g, '').trim();
  const at = clean.lastIndexOf('#');
  if (at <= 0) return null;
  const gameName = clean.slice(0, at).replace(/\s+/g, ' ').trim();
  const tagLine = clean.slice(at + 1).trim();
  if ([...gameName].length < 3 || [...gameName].length > 16 || /[#/\\?%]/.test(gameName)) return null;
  if (!/^[\p{L}\p{N}]{3,5}$/u.test(tagLine)) return null;
  return { gameName, tagLine };
}

// ---------- Peticiones ----------

export type RiotReply =
  | { kind: 'ok'; json: unknown }
  | { kind: 'not_found' }
  /** 400: con un PUUID, casi siempre es que se obtuvo con otra clave. */
  | { kind: 'bad_request' }
  /** 401 o 403: la clave del servidor no vale o caducó. */
  | { kind: 'forbidden' }
  | { kind: 'limited'; retryAfterSec: number }
  | { kind: 'error' };

/** Segundos de espera que pide Riot en un 429. Entre 1 y 120; 10 si no lo dice. */
export function riotRetryAfter(value: string | null | undefined): number {
  const seconds = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(120, seconds) : 10;
}

/** Una petición a Riot. No lanza nunca y no deja pasar ningún texto de error: podría repetir la dirección o la clave. */
export async function riotGet(url: string, key: string | null, doFetch: Fetch): Promise<RiotReply> {
  try {
    const res = await doFetch(url, {
      headers: key ? { 'X-Riot-Token': key, Accept: 'application/json' } : { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) return { kind: 'not_found' };
    if (res.status === 400) return { kind: 'bad_request' };
    if (res.status === 401 || res.status === 403) return { kind: 'forbidden' };
    if (res.status === 429) return { kind: 'limited', retryAfterSec: riotRetryAfter(res.headers.get('retry-after')) };
    if (!res.ok) return { kind: 'error' };
    const json: unknown = await res.json().catch(() => undefined);
    return json === undefined ? { kind: 'error' } : { kind: 'ok', json };
  } catch {
    return { kind: 'error' };
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
const count = (value: unknown, max = 1_000_000_000): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(max, Math.round(value)) : 0;
const PUUID_OK = /^[A-Za-z0-9_-]{20,100}$/;

const host = (where: string): string => `https://${where}.api.riotgames.com`;

export interface RiotAccount extends RiotId {
  puuid: string;
}

/** Resuelve un Riot ID con account-v1. */
export async function resolveAccount(id: RiotId, platform: RiotPlatform, key: string, doFetch: Fetch): Promise<RiotAccount | Exclude<RiotReply, { kind: 'ok' }>> {
  const url = `${host(platform.account)}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(id.gameName)}/${encodeURIComponent(id.tagLine)}`;
  const reply = await riotGet(url, key, doFetch);
  if (reply.kind !== 'ok') return reply;
  const body = isObject(reply.json) ? reply.json : {};
  const puuid = typeof body.puuid === 'string' && PUUID_OK.test(body.puuid) ? body.puuid : '';
  if (!puuid) return { kind: 'error' };
  // El nombre tal como lo escribe Riot (mayúsculas incluidas); si no viene, el que se pidió
  return { puuid, gameName: text(body.gameName, 32) || id.gameName, tagLine: text(body.tagLine, 10) || id.tagLine };
}

// ---------- Lo guardado de cada streamer ----------

export interface RiotMeta extends RiotAccount {
  platform: string;
}

/** Lee la columna `meta` de integration_accounts. null si falta algo. */
export function readRiotMeta(raw: unknown): RiotMeta | null {
  if (!isObject(raw)) return null;
  const platform = platformOf(raw.platform);
  const id = parseRiotId(`${typeof raw.gameName === 'string' ? raw.gameName : ''}#${typeof raw.tagLine === 'string' ? raw.tagLine : ''}`);
  const puuid = typeof raw.puuid === 'string' && PUUID_OK.test(raw.puuid) ? raw.puuid : '';
  if (!platform || !id || !puuid) return null;
  return { platform: platform.id, puuid, gameName: id.gameName, tagLine: id.tagLine };
}

// ---------- De las respuestas de Riot a la foto ----------

export const RIOT_TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'] as const;
const DIVISIONS = ['IV', 'III', 'II', 'I'];

export interface RiotRank {
  tier: string;
  division: string;
  lp: number;
  wins: number;
  losses: number;
}
export interface RiotLive {
  gameId: string;
  champion: string;
  queue: string;
}
export interface RiotLast {
  matchId: string;
  win: boolean;
  /** Partida rehecha: no cuenta como victoria ni como derrota. */
  remake: boolean;
  /** Clasificatoria solo/dúo: la única cola cuyo rango se sigue. */
  ranked: boolean;
  champion: string;
  queue: string;
  durationSec: number;
  kills: number;
  deaths: number;
  assists: number;
  pentaKills: number;
}
export interface RiotMastery {
  championId: number;
  champion: string;
  level: number;
  points: number;
}

/** Nombres de cola en español. Las que no están aquí salen como «Partida». */
const QUEUES: Record<number, string> = {
  400: 'Normal',
  420: 'Clasificatoria solo/dúo',
  430: 'Normal',
  440: 'Clasificatoria flexible',
  450: 'ARAM',
  480: 'Partida rápida',
  490: 'Partida rápida',
  700: 'Clash',
  900: 'URF',
  1700: 'Arena',
  1900: 'URF',
};
const queueName = (id: unknown): string => (typeof id === 'number' && QUEUES[id]) || 'Partida';

/** El rango de solo/dúo a partir de la lista de league-v4, o null si no tiene. */
export function readRank(body: unknown): RiotRank | null {
  if (!Array.isArray(body)) return null;
  const entry = body.filter(isObject).find((item) => item.queueType === SOLO_QUEUE);
  if (!entry) return null;
  const tier = typeof entry.tier === 'string' ? entry.tier.toUpperCase() : '';
  if (!(RIOT_TIERS as readonly string[]).includes(tier)) return null;
  const division = typeof entry.rank === 'string' && DIVISIONS.includes(entry.rank.toUpperCase()) ? entry.rank.toUpperCase() : 'I';
  return { tier, division, lp: count(entry.leaguePoints, 100_000), wins: count(entry.wins, 100_000), losses: count(entry.losses, 100_000) };
}

/** Solo el participante del streamer; los demás no se copian a ningún sitio. */
function ownParticipant(list: unknown, puuid: string): Record<string, unknown> | null {
  if (!Array.isArray(list)) return null;
  return list.filter(isObject).find((item) => item.puuid === puuid) ?? null;
}

export function readLive(body: unknown, puuid: string, champions: Map<number, string>): RiotLive | null {
  if (!isObject(body)) return null;
  const gameId = typeof body.gameId === 'number' && Number.isFinite(body.gameId) ? String(Math.round(body.gameId)) : text(body.gameId, 30);
  if (!gameId) return null;
  const me = ownParticipant(body.participants, puuid);
  const championId = me && typeof me.championId === 'number' ? me.championId : -1;
  return { gameId, champion: champions.get(championId) ?? '', queue: queueName(body.gameQueueConfigId) };
}

export function readMatch(body: unknown, matchId: string, puuid: string, champions: Map<number, string>): RiotLast | null {
  if (!isObject(body) || !isObject(body.info)) return null;
  const info = body.info;
  const me = ownParticipant(info.participants, puuid);
  if (!me) return null;
  // Antes de 2021 la duración venía en milisegundos
  const rawDuration = count(info.gameDuration);
  const durationSec = rawDuration > 100_000 ? Math.round(rawDuration / 1000) : rawDuration;
  const championId = typeof me.championId === 'number' ? me.championId : -1;
  return {
    matchId,
    win: me.win === true,
    remake: me.gameEndedInEarlySurrender === true,
    ranked: info.queueId === 420,
    champion: champions.get(championId) ?? text(me.championName, 40),
    queue: queueName(info.queueId),
    durationSec,
    kills: count(me.kills, 999),
    deaths: count(me.deaths, 999),
    assists: count(me.assists, 999),
    pentaKills: count(me.pentaKills, 99),
  };
}

export function readMastery(body: unknown, champions: Map<number, string>): RiotMastery[] {
  if (!Array.isArray(body)) return [];
  return body
    .filter(isObject)
    .filter((item) => typeof item.championId === 'number' && Number.isFinite(item.championId))
    .slice(0, MASTERY_TOP)
    .map((item) => ({
      championId: item.championId as number,
      champion: champions.get(item.championId as number) ?? '',
      level: count(item.championLevel, 10_000),
      points: count(item.championPoints),
    }));
}

/** Nombres de campeón por id, de la respuesta de Data Dragon. */
export function readChampions(body: unknown): Map<number, string> {
  const out = new Map<number, string>();
  if (!isObject(body) || !isObject(body.data)) return out;
  Object.values(body.data)
    .filter(isObject)
    .forEach((item) => {
      const id = Number.parseInt(String(item.key ?? ''), 10);
      const name = text(item.name, 40);
      if (Number.isFinite(id) && name) out.set(id, name);
    });
  return out;
}

// ---------- Foto con memoria ----------

export type RiotStatus = 'ok' | 'not_linked' | 'limited' | 'key_invalid' | 'error';

export interface RiotSnapshot {
  status: RiotStatus;
  /** Cuándo se leyó de Riot (ms). */
  fetchedAt: number;
  riotId: string;
  rank: RiotRank | null;
  live: RiotLive | null;
  last: RiotLast | null;
  mastery: RiotMastery[];
}

interface Memory {
  snapshots: Map<string, { snapshot: RiotSnapshot; until: number }>;
  inflight: Map<string, Promise<RiotSnapshot>>;
  /** El detalle de una partida no cambia: se pide una sola vez. */
  matches: Map<string, RiotLast>;
  champions: { names: Map<number, string>; until: number };
  /** El cupo de Riot es de la clave, no del streamer: mientras dure la espera no se pregunta por nadie. */
  blockedUntil: number;
}
const memory: Memory = { snapshots: new Map(), inflight: new Map(), matches: new Map(), champions: { names: new Map(), until: 0 }, blockedUntil: 0 };

export function forgetRiotProfile(profileId: string): void {
  memory.snapshots.delete(profileId);
}

/** Para las pruebas. */
export function resetRiotMemory(): void {
  memory.snapshots.clear();
  memory.inflight.clear();
  memory.matches.clear();
  memory.champions = { names: new Map(), until: 0 };
  memory.blockedUntil = 0;
}

interface ReadDeps {
  fetch: Fetch;
  now: () => number;
  store: Store;
}

async function championNames(deps: ReadDeps): Promise<Map<number, string>> {
  const at = deps.now();
  if (memory.champions.until > at) return memory.champions.names;
  let names = new Map<number, string>();
  const versions = await riotGet('https://ddragon.leagueoflegends.com/api/versions.json', null, deps.fetch);
  const version = versions.kind === 'ok' && Array.isArray(versions.json) && typeof versions.json[0] === 'string' ? versions.json[0] : '';
  if (/^[0-9.]{3,20}$/.test(version)) {
    const list = await riotGet(`https://ddragon.leagueoflegends.com/cdn/${version}/data/es_MX/champion.json`, null, deps.fetch);
    if (list.kind === 'ok') names = readChampions(list.json);
  }
  // Sin nombres la foto sigue valiendo; se vuelve a intentar más tarde y entretanto se usan los que hubiera
  if (names.size === 0) names = memory.champions.names;
  memory.champions = { names, until: at + (names.size > 0 ? CHAMPIONS_CACHE_MS : CHAMPIONS_RETRY_MS) };
  return names;
}

const EMPTY = { riotId: '', rank: null, live: null, last: null, mastery: [] as RiotMastery[] };

async function readSnapshot(profileId: string, key: string, deps: ReadDeps): Promise<{ snapshot: RiotSnapshot; ttl: number }> {
  const at = deps.now();
  const previous = memory.snapshots.get(profileId)?.snapshot;
  // Con un fallo se conserva lo último que se supo: la capa no compara fotos que no sean «ok»
  const keep = (status: RiotStatus, ttl = RIOT_CACHE_MS) => ({ snapshot: { ...EMPTY, ...(previous ?? {}), status, fetchedAt: previous?.fetchedAt ?? at }, ttl });
  if (memory.blockedUntil > at) return keep('limited', Math.min(memory.blockedUntil - at, 120_000));

  const row = await deps.store.get(profileId, 'riot');
  let meta = readRiotMeta(row?.meta);
  if (!row || !meta) return { snapshot: { ...EMPTY, status: 'not_linked', fetchedAt: at }, ttl: RIOT_NEGATIVE_CACHE_MS };
  const platform = platformOf(meta.platform) as RiotPlatform;

  const limited = (reply: RiotReply) => {
    if (reply.kind !== 'limited') return false;
    memory.blockedUntil = at + reply.retryAfterSec * 1000;
    return true;
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const puuid = meta.puuid;
    const id = encodeURIComponent(puuid);
    const [league, spectator, ids, mastery, champions] = await Promise.all([
      riotGet(`${host(platform.id)}/lol/league/v4/entries/by-puuid/${id}`, key, deps.fetch),
      riotGet(`${host(platform.id)}/lol/spectator/v5/active-games/by-summoner/${id}`, key, deps.fetch),
      riotGet(`${host(platform.match)}/lol/match/v5/matches/by-puuid/${id}/ids?start=0&count=1`, key, deps.fetch),
      riotGet(`${host(platform.id)}/lol/champion-mastery/v4/champion-masteries/by-puuid/${id}/top?count=${MASTERY_TOP}`, key, deps.fetch),
      championNames(deps),
    ]);
    const replies = [league, spectator, ids, mastery];
    const wait = replies.find((reply) => reply.kind === 'limited');
    if (wait && limited(wait)) return keep('limited', Math.min(memory.blockedUntil - at, 120_000));
    if (replies.some((reply) => reply.kind === 'forbidden')) return keep('key_invalid');

    // PUUID rechazado: se obtuvo con otra clave. Se vuelve a resolver desde el Riot ID, una sola vez
    if (attempt === 0 && (league.kind === 'bad_request' || ids.kind === 'bad_request')) {
      const account = await resolveAccount(meta, platform, key, deps.fetch);
      if ('kind' in account) {
        if (limited(account)) return keep('limited', Math.min(memory.blockedUntil - at, 120_000));
        return keep(account.kind === 'forbidden' ? 'key_invalid' : 'error');
      }
      meta = { ...meta, puuid: account.puuid, gameName: account.gameName, tagLine: account.tagLine };
      await deps.store.upsert(profileId, 'riot', { meta, account_name: `${meta.gameName}#${meta.tagLine}` });
      continue;
    }

    // El rango y la lista de partidas hacen falta para comparar; sin ellos no hay foto
    if (league.kind !== 'ok' || ids.kind !== 'ok') return keep('error');
    // Spectator: 404 es «no está en partida»; cualquier otro fallo no se toma por eso
    if (spectator.kind !== 'ok' && spectator.kind !== 'not_found') return keep('error');

    let last: RiotLast | null = null;
    const matchId = Array.isArray(ids.json) && typeof ids.json[0] === 'string' && /^[A-Z0-9]{2,6}_\d{1,20}$/.test(ids.json[0]) ? ids.json[0] : '';
    if (matchId) {
      const known = memory.matches.get(`${puuid}:${matchId}`);
      if (known) last = known;
      else {
        const detail = await riotGet(`${host(platform.match)}/lol/match/v5/matches/${matchId}`, key, deps.fetch);
        if (limited(detail)) return keep('limited', Math.min(memory.blockedUntil - at, 120_000));
        // El detalle puede tardar unos segundos en existir: se espera a la siguiente lectura
        if (detail.kind !== 'ok') return keep(detail.kind === 'forbidden' ? 'key_invalid' : 'error');
        last = readMatch(detail.json, matchId, puuid, champions);
        if (!last) return keep('error');
        memory.matches.set(`${puuid}:${matchId}`, last);
        if (memory.matches.size > 300) memory.matches.delete(memory.matches.keys().next().value as string);
      }
    }

    return {
      snapshot: {
        status: 'ok',
        fetchedAt: at,
        riotId: `${meta.gameName}#${meta.tagLine}`,
        rank: readRank(league.json),
        live: spectator.kind === 'ok' ? readLive(spectator.json, puuid, champions) : null,
        last,
        // La maestría es un extra: si falla, la foto vale igual
        mastery: mastery.kind === 'ok' ? readMastery(mastery.json, champions) : [],
      },
      ttl: RIOT_CACHE_MS,
    };
  }
  return keep('error');
}

/**
 * La foto de la cuenta de ese perfil. Varias fuentes de OBS comparten la misma
 * lectura durante 45 segundos, y dos consultas a la vez esperan la misma.
 */
export async function snapshotForProfile(profileId: string, key: string, deps: ReadDeps): Promise<RiotSnapshot> {
  const cached = memory.snapshots.get(profileId);
  if (cached && cached.until > deps.now()) return cached.snapshot;
  const running = memory.inflight.get(profileId);
  if (running) return running;
  const work = readSnapshot(profileId, key, deps)
    .then(({ snapshot, ttl }) => {
      memory.snapshots.set(profileId, { snapshot, until: deps.now() + ttl });
      if (memory.snapshots.size > 500) memory.snapshots.delete(memory.snapshots.keys().next().value as string);
      return snapshot;
    })
    .finally(() => memory.inflight.delete(profileId));
  memory.inflight.set(profileId, work);
  return work;
}
