/**
 * server/twitch/chatLimiter.ts
 *
 * SendLimiter persistente para el bot de chat (interfaz de chatSend.ts). Delega en la
 * función SQL take_twitch_bot_send (migración 0040), que cuenta los envíos de la cuenta
 * del bot entre peticiones: 20 mensajes cada 30 s en total y 1 por segundo por canal, con un tope de 6 por canal en esos 30 s.
 *
 * Si la base falla (o falta la migración) NO deja enviar: pasarse del límite de Twitch
 * supone una hora de bot ignorado, y un mensaje perdido es mucho más barato.
 *
 * SIN PROBAR contra Supabase real.
 */

import { createClient } from '@supabase/supabase-js';
import { ACCOUNT_MAX, ACCOUNT_WINDOW_MS, CHANNEL_MAX, type LimitScope, type SendLimiter, type TakeResult } from './chatSend.js';
import type { Env } from '../integrations/store.js';

/** Lo único que se usa del cliente de Supabase: llamar a una función SQL. Las pruebas pasan uno falso. */
export interface LimiterRpc {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
}

export function createDbLimiter(db: LimiterRpc, options: { accountMax?: number; channelMax?: number } = {}): SendLimiter {
  const accountMax = options.accountMax ?? ACCOUNT_MAX;
  const channelMax = options.channelMax ?? CHANNEL_MAX;
  return {
    async take(botId, channelId): Promise<TakeResult> {
      const closed: TakeResult = { ok: false, waitMs: ACCOUNT_WINDOW_MS, scope: 'account' };
      try {
        const { data, error } = await db.rpc('take_twitch_bot_send', { p_bot_id: botId, p_channel_id: channelId, p_account_max: accountMax, p_channel_max: channelMax });
        if (error) {
          console.error(`[Lalo bot] limitador: Supabase ${error.code ?? 'error'}`);
          return closed;
        }
        const result = data as { ok?: unknown; waitMs?: unknown; scope?: unknown } | null;
        if (result?.ok === true) return { ok: true };
        const waitMs = typeof result?.waitMs === 'number' && result.waitMs > 0 ? result.waitMs : ACCOUNT_WINDOW_MS;
        const scope: LimitScope = result?.scope === 'channel' ? 'channel' : 'account';
        return { ok: false, waitMs, scope };
      } catch {
        console.error('[Lalo bot] limitador: no se pudo consultar la base de datos');
        return closed;
      }
    },
  };
}

/** Limitador con la clave de servicio, o null si el servidor no tiene Supabase. */
export function supabaseLimiter(env: Env): SendLimiter | null {
  const url = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '').trim();
  const key = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!url || !key) return null;
  return createDbLimiter(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }));
}
