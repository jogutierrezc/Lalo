/**
 * server/twitch/chatProcessor.ts
 *
 * El bot de chat en la nube: convierte cada mensaje que llega por EventSub
 * (channel.chat.message, ver eventsub.ts) en la respuesta del bot, sin script de Python.
 * Es el ChatHandler que se pasa a handleEventsub. Replica lo que hace el script de
 * src/components/bot/pythonScript.ts, con la cuenta global «Lalo» (TWITCH_BOT_USER_ID),
 * token de aplicación y ningún token de usuario guardado.
 *
 * Para cada mensaje, en este orden:
 *   1. Ignora los de la propia cuenta del bot (si no, se respondería a sí mismo).
 *   2. Busca al streamer dueño del canal (profiles.twitch_user_id, cuenta activa).
 *   3. Si su bot está apagado (twitch_bot_settings.enabled), no hace nada.
 *   4. Si el texto no empieza por SU prefijo, no hace nada.
 *   5. Mi AI: !<palabra> y el alias !lux (según su configuración), !luxon y !luxoff.
 *      Pregunta a Lux «como ese perfil» con luxAskForProfile (server/lux/handlers.ts), sin HTTP.
 *   6. Comandos personalizados: coincidencia sin distinguir mayúsculas, solo los encendidos,
 *      con el permiso de PERMISSION_CHECK del script de Python.
 *   7. Envía la respuesta con sendChatMessage y el limitador persistente (chatLimiter.ts).
 *   8. Después, sin bloquear nada más, el trabajo de fondo (botBackground.ts): vacía la cola de mensajes del panel y
 *      de saludos, apunta la línea en el búfer del chat y decide si toca resumir o hacer un comentario espontáneo.
 *
 * Diferencias con el script de Python, a propósito:
 *   - Ninguna respuesta usa «responder a» (reply_parent_message_id): el script escribe con
 *     channel.send, sin responder a nadie.
 *   - VIP no da permiso en ningún comando: PERMISSION_CHECK solo conoce suscriptor, moderador
 *     y canal, y un VIP no es ninguno de ellos. Darle permisos sería abrir comandos que el
 *     streamer solo ha limitado a «sub» o «mod».
 *   - Cuando un espectador pregunta a Lux dentro del tiempo de espera, no se contesta «espera N s»:
 *     la cuenta del bot es una sola para todos los canales (20 mensajes cada 30 s) y esos avisos
 *     los podría provocar cualquiera.
 *   - No se filtran las cuentas de otros bots: el script solo las ignora para el resumen y los
 *     comentarios espontáneos del chat, no para los comandos.
 *   - No hay «!s» (voz en OBS) ni mensaje de bienvenida al entrar: dependen de IRC y del panel local.
 *   - Un comando personalizado que se llame igual que la palabra de Lux no se ejecuta: gana Lux.
 *
 * Nunca lanza hacia el receptor y no registra tokens, textos de espectadores ni claves.
 *
 * SIN PROBAR contra Twitch ni Supabase reales.
 */

import { createClient } from '@supabase/supabase-js';
import type { Env } from '../integrations/store.js';
import type { CommandPermission } from '../../src/types/twitchio.js';
import { LUX_CHAT_COOLDOWN_MS, luxChatWords, parseLuxChat } from '../lux/chatCommands.js';
import { luxDisplayName } from '../lux/displayName.js';
import { sanitizeChatOutput } from '../lux/outputFilter.js';
import type { LuxSettings } from '../lux/settings.js';
import { isOwnBotMessage, type ChatHandler, type ChatMessageEvent } from './eventsub.js';
import { supabaseBotDb, BOT_DEFAULT_PREFIX, type BotDb } from './botDb.js';
import { sendChatMessage, type ChatSendResult, type SendLimiter } from './chatSend.js';
import { supabaseLimiter } from './chatLimiter.js';
import { createChatBackground, type ChatBackground } from './botBackground.js';

type Fetch = typeof fetch;

/** Clave del cooldown de Mi AI en twitch_bot_cooldowns (un cooldown por espectador y canal). */
export const LUX_COOLDOWN_KEY = 'lux';
/** Espera por espectador y comando antes de volver a contestarle (comandos personalizados y avisos de !lux). */
export const REPLY_COOLDOWN_SECONDS = 5;
/** Cuánto se recuerda un Message-Id ya atendido (EventSub puede reentregar el mismo aviso). */
export const DEDUPE_SECONDS = 600;

/** Resultado mínimo de «preguntar a Lux como este perfil» (el mismo que la ruta /api/lux/chat). */
export interface LuxAnswer {
  status: number;
  body: Record<string, unknown>;
}

/** Lo que el procesador necesita de Mi AI. Por defecto sale de server/lux/handlers.ts. */
export interface ChatLux {
  settings(profileId: string, env: Env): Promise<LuxSettings | null>;
  ask(profileId: string, input: { viewer: string; message: string; takeCooldown: () => Promise<{ ok: true } | { ok: false; waitSeconds: number }> }, env: Env): Promise<LuxAnswer>;
  /** true/false = nuevo estado; null = no se pudo guardar. */
  setEnabled(profileId: string, on: boolean, env: Env): Promise<boolean | null>;
}

export interface ChatProcessorDeps {
  db?: (env: Env) => BotDb | null;
  /** Perfil (cuenta activa de Lalo) dueño del canal de Twitch, o null. */
  profileId?: (broadcasterId: string, env: Env) => Promise<string | null>;
  limiter?: (env: Env) => SendLimiter | null;
  lux?: ChatLux;
  fetch?: Fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Pausa entre trozos de un mensaje largo (por defecto la de chatSend). */
  pauseMs?: number;
  /** Cola del panel, aprendizaje del chat y comentarios (botBackground.ts). Por defecto, el real con las mismas piezas. */
  background?: ChatBackground;
}

// ---------- Piezas por defecto (con la clave de servicio) ----------

const memo = new Map<string, unknown>();

/** Un cliente por URL y clave: en Vercel una instancia atiende muchos avisos. */
function cached<T>(key: string, make: () => T): T {
  if (!memo.has(key)) memo.set(key, make());
  return memo.get(key) as T;
}

const supabaseKeys = (env: Env): { url: string; key: string } => ({
  url: (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '').trim(),
  key: (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim(),
});

const defaultDb = (env: Env): BotDb | null => {
  const { url, key } = supabaseKeys(env);
  return url && key ? cached(`db:${url}:${key}`, () => supabaseBotDb(env)) : null;
};

const defaultLimiter = (env: Env): SendLimiter | null => {
  const { url, key } = supabaseKeys(env);
  return url && key ? cached(`limiter:${url}:${key}`, () => supabaseLimiter(env)) : null;
};

const TWITCH_ID = /^\d{1,20}$/;

/** El streamer dueño del canal sale de profiles.twitch_user_id, solo cuentas activas (como ingest_twitch_event). */
const defaultProfileId = async (broadcasterId: string, env: Env): Promise<string | null> => {
  const { url, key } = supabaseKeys(env);
  if (!url || !key || !TWITCH_ID.test(broadcasterId)) return null;
  const client = cached(`profiles:${url}:${key}`, () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }));
  const { data, error } = await client.from('profiles').select('id').eq('twitch_user_id', broadcasterId).eq('status', 'active').maybeSingle();
  if (error) throw new Error(`Supabase: ${error.code ?? 'error'}`);
  return (data as { id?: string } | null)?.id ?? null;
};

/** Mi AI vía server/lux/handlers.ts (carga perezosa: es un módulo grande). */
const defaultLux: ChatLux = {
  async settings(profileId, env) {
    const { luxSettingsForProfile } = await import('../lux/handlers.js');
    return luxSettingsForProfile(profileId, env);
  },
  async ask(profileId, input, env) {
    const { luxAskForProfile } = await import('../lux/handlers.js');
    const result = await luxAskForProfile(profileId, input, env);
    return { status: result.status, body: (result.body ?? {}) as Record<string, unknown> };
  },
  async setEnabled(profileId, on, env) {
    const { luxSwitchForProfile } = await import('../lux/handlers.js');
    return luxSwitchForProfile(profileId, on, env);
  },
};

// ---------- Reglas ----------

/** Misma jerarquía que PERMISSION_CHECK de pythonScript.ts. VIP no suma (ver arriba). */
export function hasPermission(permission: CommandPermission, who: Pick<ChatMessageEvent, 'isSub' | 'isMod' | 'isBroadcaster'>): boolean {
  switch (permission) {
    case 'all':
      return true;
    case 'sub':
      return who.isSub || who.isMod || who.isBroadcaster;
    case 'mod':
      return who.isMod || who.isBroadcaster;
    case 'broadcaster':
      return who.isBroadcaster;
    default:
      // Un permiso desconocido cierra el comando, no lo abre
      return false;
  }
}

/** fill() del script de Python: {user} y {channel}, todas las veces que aparezcan. */
export function fillResponse(response: string, user: string, channel: string): string {
  return response.split('{user}').join(user).split('{channel}').join(channel);
}

const logError = (what: string, err: unknown): void => {
  console.error(`[Lalo bot] ${what}:`, err instanceof Error ? err.message.slice(0, 200) : 'error desconocido');
};

// ---------- El procesador ----------

export function createChatProcessor(deps: ChatProcessorDeps = {}): ChatHandler {
  const getDb = deps.db ?? defaultDb;
  const findProfile = deps.profileId ?? defaultProfileId;
  const getLimiter = deps.limiter ?? defaultLimiter;
  const lux = deps.lux ?? defaultLux;
  const doFetch: Fetch = deps.fetch ?? ((...args) => fetch(...args));
  const background =
    deps.background ??
    createChatBackground({ db: getDb, limiter: getLimiter, fetch: doFetch, now: deps.now, sleep: deps.sleep, pauseMs: deps.pauseMs });

  /** Lo que se sabe de un mensaje que sí es de un canal con el bot en la nube encendido. */
  interface Gate {
    botUserId: string;
    db: BotDb;
    profileId: string;
    prefix: string;
  }

  async function gate(event: ChatMessageEvent, env: Env): Promise<Gate | null> {
    const botUserId = (env.TWITCH_BOT_USER_ID ?? '').trim();
    // Sin cuenta de bot no hay quién escriba; y sin ella tampoco se puede reconocer al propio bot
    if (!botUserId || isOwnBotMessage(event, botUserId)) return null;

    const db = getDb(env);
    if (!db) return null;
    const profileId = await findProfile(event.broadcasterId, env);
    if (!profileId) return null;
    const settings = await db.settings(profileId);
    if (!settings || !settings.enabled) return null;
    // 'streamer' (cada uno con su cuenta) está reservado y aún no existe: no se responde con la cuenta global
    if (settings.senderMode !== 'global') return null;
    return { botUserId, db, profileId, prefix: settings.prefix || BOT_DEFAULT_PREFIX };
  }

  async function respond(event: ChatMessageEvent, env: Env, { botUserId, db, profileId, prefix }: Gate): Promise<void> {
    const text = event.text.trim();
    if (!text.startsWith(prefix)) return;

    // Un mismo aviso de EventSub puede llegar dos veces (o a dos instancias): solo se atiende el primero
    const fresh = await db.takeCooldown(profileId, 'dedupe', `m:${event.messageId}`.slice(0, 60), DEDUPE_SECONDS);
    if (!fresh.ok) return;

    // Cooldown por espectador y clave: la cuenta del bot es una sola para todos los canales, y sin esto
    // cualquiera podría gastarle el cupo de 20 mensajes cada 30 s. Si no se concede, no se responde
    const viewerKey = event.chatterLogin || event.chatterId;
    const allowed = async (key: string): Promise<boolean> =>
      (await db.takeCooldown(profileId, viewerKey, `cmd:${key}`.slice(0, 60), REPLY_COOLDOWN_SECONDS)).ok;

    const send = async (message: string): Promise<void> => {
      const limiter = getLimiter(env);
      if (!limiter) return;
      let result: ChatSendResult;
      try {
        result = await sendChatMessage({
          fetch: doFetch,
          env,
          botUserId,
          broadcasterId: event.broadcasterId,
          text: message,
          limiter,
          now: deps.now,
          sleep: deps.sleep,
          pauseMs: deps.pauseMs,
        });
      } catch (err) {
        logError('no se pudo enviar al chat', err);
        return;
      }
      if (result.status !== 'sent') console.warn(`[Lalo bot] mensaje no enviado: ${result.status}`);
    };

    // ----- Mi AI -----
    const luxSettings = await lux.settings(profileId, env);
    if (luxSettings) {
      const name = luxDisplayName(luxSettings.chatName, luxSettings.chatWord);
      const options = { word: luxSettings.chatWord, alias: luxSettings.chatAlias };
      const command = parseLuxChat(text, prefix, options);
      const lower = text.toLowerCase();
      const bare = luxChatWords(options.word, options.alias).some((word) => lower === `${prefix}${word}`);

      if (command?.kind === 'on' || command?.kind === 'off') {
        if (!(event.isMod || event.isBroadcaster)) {
          if (!(await allowed('luxperm'))) return;
          await send(`@${event.chatterName} solo el canal o los moderadores pueden hacerlo.`);
          return;
        }
        const saved = await lux.setEnabled(profileId, command.kind === 'on', env);
        if (saved === null) return;
        await send(saved ? `${name} responderá en el chat.` : `${name} dejará de responder en el chat.`);
        return;
      }
      if (bare) {
        if (!(await allowed(lower.slice(prefix.length)))) return;
        await send(`@${event.chatterName} escribe tu mensaje después de ${prefix}${luxSettings.chatWord}.`);
        return;
      }
      if (command?.kind === 'ask') {
        const viewer = event.chatterLogin || event.chatterName;
        const answer = await lux.ask(
          profileId,
          {
            viewer,
            message: command.message,
            takeCooldown: () => db.takeCooldown(profileId, event.chatterLogin || event.chatterId, LUX_COOLDOWN_KEY, LUX_CHAT_COOLDOWN_MS / 1000),
          },
          env
        );
        // Lo que escribe la IA pasa por el filtro (enlaces y menciones) antes de salir al chat
        const reply = typeof answer.body.reply === 'string' ? sanitizeChatOutput(answer.body.reply, { viewer: event.chatterLogin || event.chatterName }) : '';
        if (reply) {
          await send(reply);
        } else if (typeof answer.body.skipped === 'string') {
          // Apagada con !luxoff, sin Mi AI en la cuenta, tiempo de espera...: no se escribe nada
          console.info(`[Lalo bot] Mi AI no respondió: ${answer.body.skipped}`);
        } else {
          console.error(`[Lalo bot] Mi AI no respondió: ${typeof answer.body.error === 'string' ? answer.body.error : `estado ${answer.status}`}`);
        }
        return;
      }
    }

    // ----- Comandos personalizados -----
    const head = text.slice(prefix.length).split(/\s+/)[0]?.toLowerCase() ?? '';
    if (!head) return;
    const found = (await db.commands(profileId)).find((item) => item.enabled && item.name.toLowerCase() === head);
    if (!found || !hasPermission(found.permission, event)) return;
    if (!(await allowed(found.name.toLowerCase()))) return;
    await send(fillResponse(found.response, event.chatterName, event.broadcasterLogin));
  }

  return async (event, env) => {
    let found: Gate | null = null;
    try {
      found = await gate(event, env);
      if (found) await respond(event, env, found);
    } catch (err) {
      logError('no se pudo atender un mensaje del chat', err);
    }
    if (!found) return;
    // Aunque la respuesta fallara, la cola y el aprendizaje siguen. afterMessage no lanza
    try {
      await background.afterMessage({ event, env, profileId: found.profileId, prefix: found.prefix, botUserId: found.botUserId });
    } catch (err) {
      logError('trabajo de fondo del chat', err);
    }
  };
}
