/**
 * src/lib/botApi.ts
 *
 * Llamadas del panel «Bot» (estudio de TwitchIO) a /api/twitch/bot: ajustes,
 * comandos y conexión del bot de chat en la nube. Todo va con la sesión de
 * Supabase; el servidor decide el perfil y el canal por ella, aquí nunca se
 * manda un id de streamer.
 *
 * SIN PROBAR contra Twitch ni contra Supabase reales.
 */

import { call, type ApiOutcome } from './integrationsApi';
import type { CommandPermission } from '../types/twitchio';
import { botErrorMessage, isUuid, serverId } from '../utils/botCloud';

const PATH = '/api/twitch/bot';

/** Con qué cuenta escribe el bot: el nombre del streamer ('streamer') o la cuenta Lalo ('global'). */
export type BotSenderModeView = 'global' | 'streamer';

export interface BotSettingsView {
  enabled: boolean;
  prefix: string;
  welcomeMessage: string;
  senderMode: BotSenderModeView;
}

export interface BotCommandView {
  id: string;
  name: string;
  response: string;
  permission: CommandPermission;
  enabled: boolean;
  position: number;
}

/** Lo que se manda al guardar. Sin id se crea; con id se cambia ese comando. */
export interface BotCommandDraft {
  id?: string;
  name: string;
  response: string;
  permission: CommandPermission;
  enabled: boolean;
  position: number;
}

/** `unavailable`: el servidor aún no sabe consultar la escucha del chat. */
export type BotChatStatus = 'enabled' | 'pending' | 'missing' | 'error' | 'unavailable';

export interface BotConnectionView {
  hasChannel: boolean;
  twitchLogin: string;
  chat: BotChatStatus;
  enabled: boolean;
  /** El servidor tiene la cuenta Lalo: solo entonces se ofrece «Con la cuenta Lalo». */
  globalAvailable: boolean;
}

export interface BotSnapshot {
  settings: BotSettingsView;
  commands: BotCommandView[];
  connection: BotConnectionView;
}

export type BotConnectOutcome = 'created' | 'already' | 'no_permission' | 'error';

export interface BotConnectResult {
  outcome: BotConnectOutcome;
  detail: string;
  /** Con valor, hay que pedir estos permisos a Twitch (signInWithTwitch). */
  authorizeScopes: string[];
  settings: BotSettingsView;
  connection: BotConnectionView;
}

const CHAT_STATUS: BotChatStatus[] = ['enabled', 'pending', 'missing', 'error', 'unavailable'];
const PERMISSIONS: CommandPermission[] = ['all', 'sub', 'mod', 'broadcaster'];
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Cambia los mensajes de los 503 conocidos por otros claros y estables. */
function friendly<T>(res: ApiOutcome<T>): ApiOutcome<T> {
  return res.ok ? res : { ...res, message: botErrorMessage(res.code, res.message) };
}

export function readSettings(value: unknown): BotSettingsView {
  const raw = isObject(value) ? value : {};
  return {
    enabled: raw.enabled === true,
    prefix: typeof raw.prefix === 'string' && raw.prefix ? raw.prefix : '!',
    welcomeMessage: typeof raw.welcomeMessage === 'string' ? raw.welcomeMessage : '',
    senderMode: raw.senderMode === 'global' ? 'global' : 'streamer',
  };
}

export function readCommand(value: unknown): BotCommandView | null {
  if (!isObject(value) || typeof value.id !== 'string' || typeof value.name !== 'string') return null;
  return {
    id: value.id,
    name: value.name,
    response: typeof value.response === 'string' ? value.response : '',
    permission: PERMISSIONS.includes(value.permission as CommandPermission) ? (value.permission as CommandPermission) : 'all',
    enabled: value.enabled !== false,
    position: typeof value.position === 'number' && Number.isFinite(value.position) ? value.position : 0,
  };
}

export function readConnection(value: unknown): BotConnectionView {
  const raw = isObject(value) ? value : {};
  return {
    hasChannel: raw.hasChannel === true,
    twitchLogin: typeof raw.twitchLogin === 'string' ? raw.twitchLogin : '',
    chat: CHAT_STATUS.includes(raw.chat as BotChatStatus) ? (raw.chat as BotChatStatus) : 'unavailable',
    enabled: raw.enabled === true,
    globalAvailable: raw.globalAvailable === true,
  };
}

function readSnapshot(data: Record<string, unknown>): BotSnapshot {
  return {
    settings: readSettings(data.settings),
    commands: (Array.isArray(data.commands) ? data.commands : []).map(readCommand).filter((item): item is BotCommandView => item !== null),
    connection: readConnection(data.connection),
  };
}

/** Ajustes, comandos y estado de la conexión del streamer que ha entrado. */
export async function botStatus(): Promise<ApiOutcome<BotSnapshot>> {
  const res = friendly(await call(PATH, 'GET'));
  if (!res.ok) return res;
  return { ok: true, data: readSnapshot(res.data) };
}

/** Guarda lo que se cambie de los ajustes; lo que no se manda queda como estaba. */
export async function botSaveSettings(settings: Partial<BotSettingsView>): Promise<ApiOutcome<BotSettingsView>> {
  const res = friendly(await call(PATH, 'POST', { action: 'saveSettings', settings }));
  if (!res.ok) return res;
  return { ok: true, data: readSettings(res.data.settings) };
}

/**
 * Cambia con qué cuenta escribe el bot. El servidor apaga el bot y quita la escucha anterior: hay que pulsar
 * «Conectar el bot» otra vez (el user_id de la suscripción cambia).
 */
export async function botSetSenderMode(senderMode: BotSenderModeView): Promise<ApiOutcome<{ settings: BotSettingsView; connection: BotConnectionView | null }>> {
  const res = friendly(await call(PATH, 'POST', { action: 'saveSettings', settings: { senderMode } }));
  if (!res.ok) return res;
  return {
    ok: true,
    data: { settings: readSettings(res.data.settings), connection: isObject(res.data.connection) ? readConnection(res.data.connection) : null },
  };
}

/** Crea o cambia un comando. Devuelve el comando tal como quedó (nombre limpio e id). */
export async function botSaveCommand(command: BotCommandDraft): Promise<ApiOutcome<BotCommandView>> {
  // Un id que no es del servidor (local) no se manda: sin id se CREA el comando
  const { id, ...rest } = command;
  const sent = serverId(id) ? { ...rest, id } : rest;
  const res = friendly(await call(PATH, 'POST', { action: 'saveCommand', command: sent }));
  if (!res.ok) return res;
  const saved = readCommand(res.data.command);
  return saved ? { ok: true, data: saved } : { ok: false, code: 'server', message: 'El servidor no devolvió el comando guardado.', missing: [] };
}

export async function botDeleteCommand(id: string): Promise<ApiOutcome<{ deleted: boolean }>> {
  // Un id local no existe en el servidor: no hay nada que borrar allí
  if (!isUuid(id)) return { ok: true, data: { deleted: false } };
  const res = friendly(await call(PATH, 'POST', { action: 'deleteCommand', id }));
  if (!res.ok) return res;
  return { ok: true, data: { deleted: res.data.deleted === true } };
}

/** Da de alta la escucha del chat y enciende el bot. Sin el permiso de Twitch, `authorizeScopes` dice cuál pedir. */
export async function botConnect(): Promise<ApiOutcome<BotConnectResult>> {
  const res = friendly(await call(PATH, 'POST', { action: 'connect' }));
  if (!res.ok) return res;
  const outcome = (['created', 'already', 'no_permission'] as const).find((item) => item === res.data.outcome) ?? 'error';
  const authorize = isObject(res.data.authorize) && Array.isArray(res.data.authorize.scopes) ? res.data.authorize.scopes : [];
  return {
    ok: true,
    data: {
      outcome,
      detail: typeof res.data.detail === 'string' ? res.data.detail : '',
      authorizeScopes: authorize.filter((item): item is string => typeof item === 'string'),
      settings: readSettings(res.data.settings),
      connection: readConnection(res.data.connection),
    },
  };
}

/** Quita la escucha del chat y apaga el bot. */
export async function botDisconnect(): Promise<ApiOutcome<{ removed: boolean; settings: BotSettingsView; connection: BotConnectionView }>> {
  const res = friendly(await call(PATH, 'POST', { action: 'disconnect' }));
  if (!res.ok) return res;
  return {
    ok: true,
    data: { removed: res.data.removed === true, settings: readSettings(res.data.settings), connection: readConnection(res.data.connection) },
  };
}
