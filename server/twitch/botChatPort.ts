/**
 * server/twitch/botChatPort.ts
 *
 * El BotChatPort de botHandlers.ts sobre subscriptions.ts: estado, alta y baja de la
 * suscripción channel.chat.message de un canal. Lo conecta server/integrations/handlers.ts
 * con setBotChatPort, así sirve igual en Vercel (api/integraciones.ts) y en server/index.ts,
 * que pasan por el mismo punto. Este archivo importa botHandlers solo por TIPOS: no hay
 * dependencia circular en tiempo de ejecución.
 *
 * Traducción de estados de Twitch: enabled -> 'enabled', webhook_callback_verification_pending
 * -> 'pending', sin suscripción -> 'missing', cualquier otro (authorization_revoked,
 * notification_failures_exceeded...) o un fallo al preguntar -> 'error'. Si al servidor le
 * falta configuración (secreto, callback, cliente de Twitch) el estado es 'unavailable'.
 *
 * Token de aplicación; no se guarda ningún token de usuario. SIN PROBAR contra Twitch real.
 */

import type { Env } from './clips.js';
import { EVENT_TYPES } from './eventsub.js';
import {
  ALIVE,
  WANTED,
  createOne,
  deleteOne,
  listOwn,
  readEventsConfig,
  type Config,
  type Deps,
  type TwitchSubscription,
} from './subscriptions.js';
import type { BotChatPort, BotChatStatus } from './botHandlers.js';

const CHAT = WANTED.find((entry) => entry.type === EVENT_TYPES.chat);

export interface ChatPortDeps {
  env?: Env;
  fetch?: Deps['fetch'];
  now?: () => number;
}

/** La mejor suscripción de chat de la lista: la que funciona, luego la que está a punto, luego la última. */
function bestOf(found: readonly TwitchSubscription[]): TwitchSubscription | undefined {
  const mine = found.filter((item) => item.type === EVENT_TYPES.chat);
  return mine.find((item) => item.status === 'enabled') ?? mine.find((item) => ALIVE.includes(item.status)) ?? mine[mine.length - 1];
}

export function translateStatus(sub: Pick<TwitchSubscription, 'status'> | undefined): BotChatStatus {
  if (!sub) return 'missing';
  if (sub.status === 'enabled') return 'enabled';
  if (sub.status === 'webhook_callback_verification_pending') return 'pending';
  return 'error';
}

export function createSubscriptionChatPort(options: ChatPortDeps = {}): BotChatPort {
  const deps: Deps = { fetch: options.fetch ?? ((...args) => fetch(...args)), now: options.now ?? Date.now };
  // El entorno se lee en cada llamada: en Vercel las variables ya están, y así las pruebas pueden cambiarlas
  const configOf = (): Config | null => readEventsConfig(options.env ?? process.env).config;

  return {
    async status(twitchUserId) {
      const config = configOf();
      if (!config || !CHAT) return 'unavailable';
      try {
        return translateStatus(bestOf(await listOwn(twitchUserId, config, deps)));
      } catch {
        return 'error';
      }
    },

    async subscribe(twitchUserId) {
      const config = configOf();
      if (!config || !CHAT) {
        return { outcome: 'skipped', detail: 'Al servidor le falta configuración para recibir eventos de Twitch (ver supabase/BOT-NUBE.md).' };
      }
      try {
        const mine = (await listOwn(twitchUserId, config, deps)).filter((item) => item.type === CHAT.type);
        if (mine.some((item) => ALIVE.includes(item.status))) return { outcome: 'already', detail: '' };
        // Las caídas (permiso revocado, demasiados fallos...) se quitan antes de volver a crear
        for (const dead of mine) await deleteOne(dead.id, config, deps);
        return await createOne(CHAT, twitchUserId, config, deps);
      } catch {
        return { outcome: 'error', detail: 'No se pudo hablar con Twitch. Prueba de nuevo en un momento.' };
      }
    },

    async unsubscribe(twitchUserId) {
      const config = configOf();
      if (!config || !CHAT) return false;
      try {
        const mine = (await listOwn(twitchUserId, config, deps)).filter((item) => item.type === CHAT.type);
        let all = true;
        for (const item of mine) all = (await deleteOne(item.id, config, deps)) && all;
        return all;
      } catch {
        return false;
      }
    },
  };
}
