/**
 * server/twitch/botHandlers.ts
 *
 * /api/twitch/bot: el streamer gestiona SU bot de chat en la nube (ajustes,
 * comandos y conexión). La usan api/integraciones.ts (grupo «twitch-bot») y el
 * servidor local (server/index.ts).
 *
 *   GET                                  ajustes + comandos + estado de la conexión
 *   POST { action: 'status' }            lo mismo que GET
 *   POST { action: 'saveSettings', settings: { enabled?, prefix?, welcomeMessage?, senderMode? } }
 *        senderMode: 'streamer' (el bot escribe con el nombre del streamer) o 'global' (cuenta Lalo, solo si hay
 *        TWITCH_BOT_USER_ID). Cambiarlo apaga el bot y quita la escucha anterior: hay que pulsar Conectar otra vez.
 *   POST { action: 'saveCommand', command: { id?, name, response, permission?, enabled?, position? } }
 *   POST { action: 'deleteCommand', id }
 *   POST { action: 'connect' }           da de alta la escucha del chat y enciende el bot
 *   POST { action: 'disconnect' }        apaga el bot, borra las líneas del chat guardadas y quita la escucha
 *
 * Límites: GET/status (BOT_STATUS_COOLDOWN_SECONDS) y connect/disconnect (BOT_CONNECT_COOLDOWN_SECONDS) llevan
 * un límite de tasa por perfil guardado en la base de datos (takeCooldown), no en la memoria de la instancia:
 * en Vercel cada petición puede caer en una instancia distinta. El estado de la suscripción en Twitch se
 * recuerda STATUS_CACHE_MS por instancia y no se pregunta a Twitch con el bot apagado o sin canal.
 *
 * Quién llama se sabe por su sesión de Supabase (cabecera Authorization), igual
 * que en subscriptions.ts. El perfil y el canal salen de esa sesión: nunca se
 * acepta un id de perfil ni de canal enviado en la petición, así nadie puede
 * tocar los comandos ni la conexión de otro streamer.
 *
 * Permiso del streamer (channel:bot): la autorización de Twitch ya se arma en el
 * navegador con Supabase (signInWithTwitch en src/lib/cloud.ts, que pide
 * TWITCH_SCOPES, y entre ellos channel:bot). El servidor no inventa otra URL de
 * autorización: 'connect' devuelve en `authorize` los permisos que debe pedir el
 * panel con ese mismo mecanismo cuando Twitch contesta que falta el permiso: channel:bot en modo
 * global; user:read:chat, user:write:chat y user:bot en modo streamer (STREAMER_SCOPES).
 *
 * DEPENDENCIA INYECTADA (la conecta el capitán): `BotChatPort`, el estado y el
 * alta/baja de la suscripción channel.chat.message del canal. Vive en
 * subscriptions.ts, que este archivo no toca. Mientras no se conecte
 * (setBotChatPort), el estado del chat es «unavailable» y 'connect' responde
 * 503 sin tocar nada.
 *
 * SIN PROBAR contra Twitch ni contra Supabase reales.
 */

import { fail, bodyOf, identify, isResult, type ApiRequest, type ApiResult } from '../storage/handlers.js';
import { MigrationMissingError, type Env } from '../integrations/store.js';
import {
  BOT_RESPONSE_MAX,
  BotDbError,
  DEFAULT_BOT_SETTINGS,
  isUuid,
  supabaseBotDb,
  validPrefix,
  type BotDb,
  type BotSenderMode,
  type BotSettings,
} from './botDb.js';
import { supabaseChatLines, type ChatLinesDb } from './botChatLines.js';
import { STREAMER_SCOPES, globalBotId } from './senderMode.js';

/** Permiso que el streamer concede a Lalo para que el bot (cuenta global) entre en su chat. */
export const BOT_SCOPE = 'channel:bot';
/** Modos de envío que acepta el panel. */
export const SENDER_MODES: readonly BotSenderMode[] = ['global', 'streamer'];
/** Tope de comandos por streamer: evita llenar la base desde un cliente descontrolado. */
export const BOT_COMMANDS_MAX = 100;
/** Espera entre dos peticiones de conectar o desconectar de la misma cuenta (cada una habla con Twitch): 12 por minuto. */
export const BOT_CONNECT_COOLDOWN_SECONDS = 5;
/** Espera entre dos consultas de estado (GET o status) de la misma cuenta: 30 por minuto. */
export const BOT_STATUS_COOLDOWN_SECONDS = 2;
/** Cuánto se recuerda en una instancia el estado de la suscripción de un canal. */
export const STATUS_CACHE_MS = 30_000;

/** Estado de la escucha del chat de un canal. `unavailable`: el servidor no sabe consultarlo. */
export type BotChatStatus = 'enabled' | 'pending' | 'missing' | 'error' | 'unavailable';

export type BotConnectOutcome = 'created' | 'already' | 'no_permission' | 'error' | 'skipped';

/** Lo que el capitán conecta con subscriptions.ts. Todas las funciones reciben el id de Twitch del canal que sale de la sesión. */
export interface BotChatPort {
  /** Estado de la suscripción channel.chat.message de ese canal para ese modo de envío (user_id distinto = otra suscripción). */
  status(twitchUserId: string, mode?: BotSenderMode): Promise<BotChatStatus>;
  /**
   * Da de alta la suscripción (idempotente) y quita la del otro modo. `no_permission` = falta el permiso: channel:bot del
   * streamer y la autorización de la cuenta Lalo (modo global), o user:read:chat, user:write:chat y user:bot del streamer (modo streamer).
   */
  subscribe(twitchUserId: string, mode?: BotSenderMode): Promise<{ outcome: BotConnectOutcome; detail: string }>;
  /** Quita la suscripción, sea del modo que sea. true si quedó sin ella. */
  unsubscribe(twitchUserId: string): Promise<boolean>;
}

/** Sin conectar: no se puede saber ni crear nada. */
export const unavailableChatPort: BotChatPort = {
  async status() {
    return 'unavailable';
  },
  async subscribe() {
    return { outcome: 'skipped', detail: 'El servidor todavía no está conectado a la escucha del chat de Twitch.' };
  },
  async unsubscribe() {
    return false;
  },
};

let chatPort: BotChatPort = unavailableChatPort;

/** Punto único donde el capitán conecta la suscripción al chat. */
export function setBotChatPort(port: BotChatPort): void {
  chatPort = port;
}

/** Quien llama, ya resuelto desde su sesión. */
export interface BotCaller {
  profileId: string;
  /** Id de Twitch del canal del perfil, o '' si la cuenta no tiene canal. */
  twitchUserId: string;
  twitchLogin: string;
}

export interface BotDeps {
  who: (req: ApiRequest, env: Env) => Promise<BotCaller | ApiResult>;
  db: (env: Env) => BotDb | null;
  chat: () => BotChatPort;
  /** Líneas del chat guardadas (migración 0041): se borran al desconectar o apagar el bot. */
  lines: (env: Env) => ChatLinesDb | null;
  now: () => number;
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const isCaller = (value: BotCaller | ApiResult): value is BotCaller => 'profileId' in value;

/** La sesión de Supabase da el perfil; el canal sale de profiles.twitch_user_id. */
async function whoFromSession(req: ApiRequest, env: Env): Promise<BotCaller | ApiResult> {
  const ctx = await identify(req, env);
  if (isResult(ctx)) return ctx;
  if (ctx.caller.status !== 'active') return fail(403, 'not_active', 'Tu cuenta no está activa.');
  const profile = await ctx.db.from('profiles').select('twitch_user_id, twitch_login').eq('id', ctx.caller.id).maybeSingle();
  if (profile.error) return fail(502, 'profile_read', 'No se pudo leer tu perfil.');
  const twitchUserId = str(profile.data?.twitch_user_id);
  return {
    profileId: ctx.caller.id,
    twitchUserId: /^\d{1,20}$/.test(twitchUserId) ? twitchUserId : '',
    twitchLogin: str(profile.data?.twitch_login),
  };
}

const defaultDeps: BotDeps = {
  who: whoFromSession,
  db: supabaseBotDb,
  chat: () => chatPort,
  lines: supabaseChatLines,
  now: Date.now,
};

// Estado de la suscripción por canal, solo para no preguntar a Twitch en cada consulta del panel (por instancia)
const statusCache = new Map<string, { at: number; status: BotChatStatus }>();

/** Para las pruebas. */
export function resetBotState(): void {
  statusCache.clear();
}

/** Qué ve el panel de la conexión: los pasos 1 a 3 de la tarjeta «Bot en la nube». */
export interface BotConnection {
  /** Paso 1: la cuenta tiene un canal de Twitch. */
  hasChannel: boolean;
  twitchLogin: string;
  /** Paso 2: Twitch ya dejó dar de alta la escucha del chat (permiso concedido). */
  chat: BotChatStatus;
  /** Paso 3: el streamer lo tiene encendido. */
  enabled: boolean;
  /** El servidor tiene la cuenta Lalo (TWITCH_BOT_USER_ID): solo entonces se ofrece el modo global. */
  globalAvailable: boolean;
}

/**
 * Estado de la escucha del chat. Sin canal, o con el bot apagado, no se llama a Twitch (con el bot apagado no
 * hay escucha que enseñar: 'connect' la da de alta). `forced` fija el estado cuando ya se sabe (tras conectar o desconectar).
 */
async function connectionOf(
  caller: BotCaller,
  settings: BotSettings,
  chat: BotChatPort,
  now: number,
  env: Env,
  forced?: BotChatStatus
): Promise<BotConnection> {
  let status: BotChatStatus = 'unavailable';
  const id = caller.twitchUserId;
  // La suscripción cambia con el modo de envío (user_id distinto): el estado recordado también
  const cacheKey = `${id}:${settings.senderMode}`;
  if (id && forced) {
    status = forced;
    statusCache.set(cacheKey, { at: now, status });
  } else if (id && !settings.enabled) {
    status = 'missing';
  } else if (id) {
    const known = statusCache.get(cacheKey);
    if (known && now >= known.at && now - known.at < STATUS_CACHE_MS) {
      status = known.status;
    } else {
      try {
        status = await chat.status(id, settings.senderMode);
      } catch {
        status = 'error';
      }
      statusCache.set(cacheKey, { at: now, status });
      if (statusCache.size > 500) statusCache.delete(statusCache.keys().next().value as string);
    }
  }
  return { hasChannel: Boolean(id), twitchLogin: caller.twitchLogin, chat: status, enabled: settings.enabled, globalAvailable: globalBotId(env) !== '' };
}

/** Olvida el estado recordado de ese canal en los dos modos. */
function forgetStatus(twitchUserId: string): void {
  statusCache.delete(`${twitchUserId}:global`);
  statusCache.delete(`${twitchUserId}:streamer`);
}

async function snapshot(caller: BotCaller, db: BotDb, chat: BotChatPort, now: number, env: Env): Promise<ApiResult> {
  const settings = (await db.settings(caller.profileId)) ?? DEFAULT_BOT_SETTINGS;
  const commands = await db.commands(caller.profileId);
  return { status: 200, body: { settings, commands, connection: await connectionOf(caller, settings, chat, now, env) } };
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const DB_ERROR_TEXT: Record<string, string> = {
  name: 'El nombre del comando no vale: usa letras, números o guiones bajos, hasta 50 caracteres.',
  response: `La respuesta no puede estar vacía ni pasar de ${BOT_RESPONSE_MAX} caracteres.`,
  permission: 'Ese permiso no existe.',
  prefix: 'El prefijo debe tener de 1 a 5 caracteres, sin espacios.',
  duplicate: 'Ya tienes un comando con ese nombre.',
  not_found: 'Ese comando no existe.',
  sender_mode: 'El modo de envío debe ser «global» o «streamer».',
  sender_global: 'La cuenta Lalo no está disponible en este servidor: usa el nombre del streamer.',
  id: 'El identificador del comando no es válido.',
};

/** Borra las líneas del chat guardadas de ese perfil (privacidad). Un fallo se registra pero no tumba la petición. */
async function clearLines(deps: BotDeps, env: Env, profileId: string): Promise<void> {
  try {
    await deps.lines(env)?.clear(profileId);
  } catch (err) {
    console.error('[Lalo bot] no se pudieron borrar las líneas del chat:', err instanceof Error ? err.message.slice(0, 200) : 'error desconocido');
  }
}

export async function handleBot(req: ApiRequest, env: Env = process.env, overrides: Partial<BotDeps> = {}): Promise<ApiResult> {
  const deps: BotDeps = { ...defaultDeps, ...overrides };
  const method = req.method.toUpperCase();
  if (method !== 'GET' && method !== 'POST') return fail(405, 'method', 'Esta ruta solo admite GET y POST.');

  try {
    // El perfil sale de la sesión, siempre antes de leer nada de la petición
    const caller = await deps.who(req, env);
    if (!isCaller(caller)) return caller;

    const db = deps.db(env);
    if (!db) return fail(503, 'server_not_configured', 'Al servidor le falta configuración para guardar el bot.');
    const chat = deps.chat();

    // Límite de tasa por perfil en la base de datos: lo comparten todas las instancias
    const limited = async (key: string, seconds: number): Promise<boolean> => !(await db.takeCooldown(caller.profileId, '_', key, seconds)).ok;
    const busy = () => fail(429, 'busy', 'Demasiadas peticiones seguidas. Prueba en unos segundos.');

    if (method === 'GET') {
      if (await limited('api_status', BOT_STATUS_COOLDOWN_SECONDS)) return busy();
      return await snapshot(caller, db, chat, deps.now(), env);
    }

    const body = bodyOf(req);
    const action = body.action;

    if (action === 'status') {
      if (await limited('api_status', BOT_STATUS_COOLDOWN_SECONDS)) return busy();
      return await snapshot(caller, db, chat, deps.now(), env);
    }

    if (action === 'saveSettings') {
      const input = isObject(body.settings) ? body.settings : {};
      // Actualización parcial: solo viajan a la base las columnas que el panel manda
      const patch: Partial<BotSettings> = {};
      if (typeof input.prefix === 'string') {
        if (!validPrefix(input.prefix)) return fail(400, 'prefix', DB_ERROR_TEXT.prefix);
        patch.prefix = input.prefix;
      }
      if (typeof input.welcomeMessage === 'string') {
        const welcome = input.welcomeMessage.trim();
        if (welcome.length > BOT_RESPONSE_MAX) return fail(400, 'welcome', `El saludo no puede pasar de ${BOT_RESPONSE_MAX} caracteres.`);
        patch.welcomeMessage = welcome;
      }
      if (typeof input.enabled === 'boolean') patch.enabled = input.enabled;

      // Un perfil sin ajustes guardados nace con el modo por defecto (el streamer), sin depender del default de la columna
      const current = await db.settings(caller.profileId);
      if (!current) patch.senderMode = DEFAULT_BOT_SETTINGS.senderMode;

      // Modo de envío: solo 'global' o 'streamer'; 'global' únicamente si el servidor tiene la cuenta Lalo
      let modeChanged = false;
      if (input.senderMode !== undefined) {
        if (typeof input.senderMode !== 'string' || !(SENDER_MODES as readonly string[]).includes(input.senderMode)) {
          return fail(400, 'sender_mode', DB_ERROR_TEXT.sender_mode);
        }
        const mode = input.senderMode as BotSenderMode;
        if (mode === 'global' && !globalBotId(env)) return fail(400, 'sender_mode', DB_ERROR_TEXT.sender_global);
        if (mode !== (current ?? DEFAULT_BOT_SETTINGS).senderMode) {
          modeChanged = true;
          patch.senderMode = mode;
          // La suscripción del chat lleva el modo (su user_id): se apaga el bot y hay que conectar de nuevo
          patch.enabled = false;
        }
      }

      if (modeChanged && caller.twitchUserId) {
        // Primero se apaga (el procesador ignora los canales apagados) y después se quita la escucha anterior
        await db.saveSettings(caller.profileId, { enabled: false });
        await chat.unsubscribe(caller.twitchUserId);
        forgetStatus(caller.twitchUserId);
      }
      const saved = await db.saveSettings(caller.profileId, patch);
      // Apagar el bot borra lo que se guardó del chat
      if (patch.enabled === false) await clearLines(deps, env, caller.profileId);
      return {
        status: 200,
        body: { settings: saved, ...(modeChanged ? { connection: await connectionOf(caller, saved, chat, deps.now(), env) } : {}) },
      };
    }

    if (action === 'saveCommand') {
      if (!isObject(body.command)) return fail(400, 'bad_request', 'Falta el comando.');
      const command = body.command;
      if (command.id !== undefined && command.id !== null && command.id !== '' && !isUuid(command.id)) return fail(400, 'id', DB_ERROR_TEXT.id);
      const settings = (await db.settings(caller.profileId)) ?? DEFAULT_BOT_SETTINGS;
      // Sin id es un comando nuevo: se respeta el tope por streamer
      if (!str(command.id) && (await db.commands(caller.profileId)).length >= BOT_COMMANDS_MAX) {
        return fail(400, 'limit', `Puedes tener hasta ${BOT_COMMANDS_MAX} comandos.`);
      }
      const saved = await db.saveCommand(
        caller.profileId,
        {
          ...(str(command.id) ? { id: str(command.id) } : {}),
          name: str(command.name),
          response: str(command.response),
          permission: typeof command.permission === 'string' ? command.permission : undefined,
          enabled: typeof command.enabled === 'boolean' ? command.enabled : undefined,
          position: typeof command.position === 'number' ? command.position : undefined,
        },
        settings.prefix
      );
      return { status: 200, body: { command: saved } };
    }

    if (action === 'deleteCommand') {
      const id = str(body.id);
      if (!id) return fail(400, 'bad_request', 'Falta qué comando quitar.');
      // Un id que no es UUID no puede existir: 404, sin preguntar a la base
      if (!isUuid(id)) return fail(404, 'not_found', DB_ERROR_TEXT.not_found);
      return { status: 200, body: { deleted: await db.deleteCommand(caller.profileId, id) } };
    }

    if (action === 'connect' || action === 'disconnect') {
      if (!caller.twitchUserId) return fail(409, 'no_twitch', 'Esta cuenta no está conectada a un canal de Twitch.');
      if (await limited('api_connect', BOT_CONNECT_COOLDOWN_SECONDS)) return busy();

      if (action === 'disconnect') {
        // Primero se apaga y se borra lo guardado: aunque Twitch no deje quitar la escucha, el bot ya no contesta
        // (el procesador ignora los canales con enabled=false) y el panel y la base cuentan lo mismo.
        const saved = await db.saveSettings(caller.profileId, { enabled: false });
        await clearLines(deps, env, caller.profileId);
        const removed = await chat.unsubscribe(caller.twitchUserId);
        const connection = await connectionOf(caller, saved, chat, deps.now(), env, removed ? 'missing' : 'error');
        return { status: 200, body: { removed, settings: saved, connection } };
      }

      // El modo de envío decide qué cuenta lee y escribe el chat (user_id de la suscripción)
      const row = await db.settings(caller.profileId);
      const mode = (row ?? DEFAULT_BOT_SETTINGS).senderMode;
      const result = await chat.subscribe(caller.twitchUserId, mode);
      if (result.outcome === 'skipped') {
        // El detalle puede nombrar variables del servidor: va al registro, no al cliente
        console.error('[Lalo bot] la escucha del chat no está disponible:', result.detail.slice(0, 200));
        return fail(503, 'chat_unavailable', 'El bot en la nube todavía no está disponible en este servidor.');
      }
      const ok = result.outcome === 'created' || result.outcome === 'already';
      // Un perfil sin fila nace con el modo por defecto, que es el que se acaba de usar
      const saved = ok
        ? await db.saveSettings(caller.profileId, row ? { enabled: true } : { enabled: true, senderMode: mode })
        : (row ?? DEFAULT_BOT_SETTINGS);
      forgetStatus(caller.twitchUserId);
      return {
        status: 200,
        body: {
          outcome: result.outcome,
          detail: result.detail,
          // Sin el permiso, el panel lo pide con signInWithTwitch (mismo mecanismo que el inicio de sesión)
          authorize: result.outcome === 'no_permission' ? { scopes: mode === 'streamer' ? [...STREAMER_SCOPES] : [BOT_SCOPE] } : null,
          settings: saved,
          connection: await connectionOf(caller, saved, chat, deps.now(), env),
        },
      };
    }

    return fail(400, 'bad_request', 'Falta qué hacer.');
  } catch (err) {
    if (err instanceof BotDbError) return fail(err.code === 'not_found' ? 404 : 400, err.code, DB_ERROR_TEXT[err.code] ?? 'Datos no válidos.');
    if (err instanceof MigrationMissingError) {
      return fail(503, 'migration_missing', 'Falta aplicar la migración 0039 (bot de Twitch) en Supabase.');
    }
    // Sin el mensaje de Supabase: puede nombrar tablas o columnas. Solo el código, si lo hay
    console.error('[Lalo bot] error:', err instanceof Error ? err.message.slice(0, 200) : 'error desconocido');
    return fail(502, 'server_error', 'No se pudo completar la operación. Prueba de nuevo en un momento.');
  }
}
