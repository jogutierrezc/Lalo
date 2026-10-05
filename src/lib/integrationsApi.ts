/**
 * src/lib/integrationsApi.ts
 *
 * Llamadas del navegador a las rutas de integraciones del servidor de Lalo
 * (server/integrations/). Las del panel van con la sesión de Supabase; las de
 * las capas de OBS, con la clave privada de widget.
 *
 * El navegador nunca recibe un permiso de Spotify, la clave de verificación de
 * Ko-fi ni la clave de Riot: solo estados, la dirección personal del webhook (a
 * su dueño) y los datos que pinta la capa.
 *
 * SIN PROBAR contra Spotify, Ko-fi, Riot ni Supabase reales.
 */

import { supabase } from './supabase';
import { readKofiRecent, type KofiRecent } from '../../server/integrations/kofiRules';
import { parseSnapshot, type GameSnapshot } from '../utils/gameAlerts';
import { parseNowResponse, type NowResponse } from '../utils/musicRules';

export type ApiOutcome<T> = { ok: true; data: T } | { ok: false; code: string; message: string; missing: string[] };

const NO_SERVER = 'El servidor de Lalo no respondió. En local hace falta arrancarlo con «npm run dev:all».';
const fallo = (code: string, message: string, missing: string[] = []): ApiOutcome<never> => ({ ok: false, code, message, missing });
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

async function call(path: string, method: 'GET' | 'POST', body?: Record<string, unknown>): Promise<ApiOutcome<Record<string, unknown>>> {
  if (!supabase) return fallo('no_cloud', 'Este despliegue no tiene la nube encendida: no hay cuentas que conectar.');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return fallo('no_session', 'Hay que iniciar sesión.');
  try {
    const res = await fetch(path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
      cache: 'no-store',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(20000),
    });
    const parsed = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!parsed) return fallo('no_server', NO_SERVER);
    if (!res.ok) {
      return fallo(typeof parsed.code === 'string' ? parsed.code : 'server', typeof parsed.error === 'string' ? parsed.error : NO_SERVER, strings(parsed.missing));
    }
    return { ok: true, data: parsed };
  } catch {
    return fallo('no_server', NO_SERVER);
  }
}

// ---------- Spotify ----------

export interface SpotifyStatus {
  configured: boolean;
  missing: string[];
  state: 'none' | 'connected' | 'expired';
  accountName: string;
  expiresAt: string | null;
  seats: number | null;
  seatsMax: number;
}

export async function spotifyStatus(): Promise<ApiOutcome<SpotifyStatus>> {
  const result = await call('/api/spotify/status', 'GET');
  if (!result.ok) return result;
  const d = result.data;
  return {
    ok: true,
    data: {
      configured: d.configured === true,
      missing: strings(d.missing),
      state: d.state === 'connected' || d.state === 'expired' ? d.state : 'none',
      accountName: typeof d.accountName === 'string' ? d.accountName : '',
      expiresAt: typeof d.expiresAt === 'string' ? d.expiresAt : null,
      seats: typeof d.seats === 'number' ? d.seats : null,
      seatsMax: typeof d.seatsMax === 'number' ? d.seatsMax : 5,
    },
  };
}

/** Dirección de Spotify a la que llevar al streamer para que dé el permiso. */
export async function spotifyLoginUrl(): Promise<ApiOutcome<string>> {
  const result = await call('/api/spotify/login', 'GET');
  if (!result.ok) return result;
  const url = result.data.url;
  // Solo se navega a la página de permisos de Spotify
  if (typeof url !== 'string' || !url.startsWith('https://accounts.spotify.com/authorize?')) return fallo('server', 'El servidor no devolvió la dirección de Spotify.');
  return { ok: true, data: url };
}

export const spotifyDisconnect = () => call('/api/spotify/disconnect', 'POST');

export async function spotifyTest(): Promise<ApiOutcome<NowResponse>> {
  const result = await call('/api/spotify/test', 'GET');
  return result.ok ? { ok: true, data: parseNowResponse(result.data) } : result;
}

/** Qué suena ahora, para la capa de OBS. No lanza: un fallo de red devuelve estado `error`. */
export async function fetchNowPlaying(key: string): Promise<NowResponse> {
  try {
    const res = await fetch(`/api/spotify/now?k=${encodeURIComponent(key)}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) return parseNowResponse({ status: typeof body?.code === 'string' ? body.code : 'error' });
    return parseNowResponse(body);
  } catch {
    return parseNowResponse(null);
  }
}

// ---------- Ko-fi ----------

export interface KofiStatus {
  configured: boolean;
  missing: string[];
  /** none: sin conectar. address: dirección creada, falta la clave. waiting: falta el primer aviso. connected. */
  state: 'none' | 'address' | 'waiting' | 'connected';
  /** Dirección completa del webhook. Privada: solo la ve su dueño. */
  url: string;
  /** La dirección usa este mismo sitio porque el servidor no conoce su dirección pública. */
  localUrl: boolean;
  lastEventAt: string | null;
  /** Cuándo llegó un aviso con una clave que no coincide, o null. */
  badTokenAt: string | null;
  raised: number;
  recent: KofiRecent[];
}

function toKofiStatus(d: Record<string, unknown>): KofiStatus {
  const base = typeof d.base === 'string' && d.base ? d.base : '';
  const path = typeof d.path === 'string' ? d.path : '';
  const origin = base || (typeof window !== 'undefined' ? window.location.origin : '');
  return {
    configured: d.configured === true,
    missing: strings(d.missing),
    state: d.state === 'address' || d.state === 'waiting' || d.state === 'connected' ? d.state : 'none',
    url: path ? `${origin}${path}` : '',
    localUrl: Boolean(path) && !base,
    lastEventAt: typeof d.lastEventAt === 'string' ? d.lastEventAt : null,
    badTokenAt: typeof d.badTokenAt === 'string' ? d.badTokenAt : null,
    raised: typeof d.raised === 'number' && Number.isFinite(d.raised) ? d.raised : 0,
    recent: readKofiRecent(d.recent),
  };
}

export type KofiPanelAction = 'connect' | 'token' | 'regenerate' | 'disconnect' | 'reset-goal';

export async function kofiStatus(): Promise<ApiOutcome<KofiStatus>> {
  const result = await call('/api/kofi/status', 'GET');
  return result.ok ? { ok: true, data: toKofiStatus(result.data) } : result;
}

export async function kofiAction(action: KofiPanelAction, body?: Record<string, unknown>): Promise<ApiOutcome<KofiStatus>> {
  const result = await call(`/api/kofi/${action}`, 'POST', body);
  return result.ok ? { ok: true, data: toKofiStatus(result.data) } : result;
}

/** Lo recaudado y los últimos apoyos, para las capas fijas de OBS. null si no hay nube, clave o conexión. */
export async function fetchKofiState(key: string): Promise<{ raised: number; recent: KofiRecent[] } | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('widget_kofi_state', { p_key: key });
  if (error || !data || typeof data !== 'object') return null;
  const body = data as { raised?: unknown; recent?: unknown };
  const raised = typeof body.raised === 'number' ? body.raised : Number(body.raised);
  return { raised: Number.isFinite(raised) ? raised : 0, recent: readKofiRecent(body.recent) };
}

// ---------- Riot Games ----------

export interface RiotStatus {
  configured: boolean;
  missing: string[];
  /** Servidores de League of Legends entre los que elegir. */
  platforms: { id: string; name: string }[];
  state: 'none' | 'linked';
  riotId: string;
  platform: string;
  linkedAt: string | null;
}

function toRiotStatus(d: Record<string, unknown>): RiotStatus {
  const platforms = (Array.isArray(d.platforms) ? d.platforms : [])
    .filter((item): item is { id: string; name: string } => Boolean(item) && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string' && typeof (item as { name?: unknown }).name === 'string')
    .map((item) => ({ id: item.id, name: item.name }));
  return {
    configured: d.configured === true,
    missing: strings(d.missing),
    platforms,
    state: d.state === 'linked' ? 'linked' : 'none',
    riotId: typeof d.riotId === 'string' ? d.riotId : '',
    platform: typeof d.platform === 'string' ? d.platform : '',
    linkedAt: typeof d.linkedAt === 'string' ? d.linkedAt : null,
  };
}

export async function riotStatus(): Promise<ApiOutcome<RiotStatus>> {
  const result = await call('/api/riot/status', 'GET');
  return result.ok ? { ok: true, data: toRiotStatus(result.data) } : result;
}

/** Vincula un Riot ID («nombre#etiqueta») de ese servidor a la cuenta de Lalo de quien llama. */
export async function riotLink(riotId: string, platform: string): Promise<ApiOutcome<RiotStatus>> {
  const result = await call('/api/riot/link', 'POST', { riotId, platform });
  return result.ok ? { ok: true, data: toRiotStatus(result.data) } : result;
}

export const riotUnlink = () => call('/api/riot/unlink', 'POST');

/** La foto de la cuenta de Riot, para la capa de OBS. No lanza: un fallo de red devuelve estado `error`. */
export async function fetchRiotState(key: string): Promise<GameSnapshot> {
  try {
    const res = await fetch(`/api/riot/state?k=${encodeURIComponent(key)}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) return parseSnapshot({ status: typeof body?.code === 'string' ? body.code : 'error' });
    return parseSnapshot(body);
  } catch {
    return parseSnapshot(null);
  }
}

// ---------- Administrador ----------

export interface IntegrationsServerStatus {
  database: string[];
  migration: 'ok' | 'missing' | 'unknown';
  fishConfigured: boolean;
  spotifyMissing: string[];
  spotifyRedirectUri: string;
  seats: number | null;
  seatsMax: number;
  kofiMissing: string[];
  kofiBase: string;
  /** El servidor tiene RIOT_API_KEY. Nunca llega su valor. */
  riotConfigured: boolean;
  /** Cuentas de Riot vinculadas, o null si no se pudo contar. */
  riotLinked: number | null;
}

export async function integrationsServerStatus(): Promise<ApiOutcome<IntegrationsServerStatus>> {
  const result = await call('/api/integrations/status', 'GET');
  if (!result.ok) return result;
  const d = result.data;
  const obj = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});
  const spotify = obj(d.spotify);
  const kofi = obj(d.kofi);
  const riot = obj(d.riot);
  return {
    ok: true,
    data: {
      database: strings(d.database),
      migration: d.migration === 'ok' || d.migration === 'missing' ? d.migration : 'unknown',
      fishConfigured: obj(d.fish).configured === true,
      spotifyMissing: strings(spotify.missing),
      spotifyRedirectUri: typeof spotify.redirectUri === 'string' ? spotify.redirectUri : '',
      seats: typeof spotify.seats === 'number' ? spotify.seats : null,
      seatsMax: typeof spotify.seatsMax === 'number' ? spotify.seatsMax : 5,
      kofiMissing: strings(kofi.missing),
      kofiBase: typeof kofi.base === 'string' ? kofi.base : '',
      riotConfigured: riot.configured === true,
      riotLinked: typeof riot.linked === 'number' ? riot.linked : null,
    },
  };
}
