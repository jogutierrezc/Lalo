/**
 * server/twitch/botChatLines.ts
 *
 * El búfer rodante de las últimas líneas del chat de cada streamer (migración 0041), con la clave
 * de servicio. Es lo que en el script de Python eran lux_lines y spont_lines, listas en memoria
 * que en Vercel no sobreviven entre peticiones. Va detrás de una interfaz para que las pruebas
 * usen una memoria, como botDb.ts.
 *
 * Privacidad: solo se guarda lo que hace falta para resumir o comentar (nombre de usuario y texto
 * recortado) y se borra al resumir. El tope por streamer y el borrado de lo viejo los hace la función SQL.
 *
 * SIN PROBAR contra Supabase real.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { MigrationMissingError, type Env } from '../integrations/store.js';

/** Filas que se conservan por streamer (el tope de líneas del resumen del script de Python). */
export const CHAT_LINES_KEEP = 200;
export const CHAT_LINE_TEXT_MAX = 300;
export const CHAT_LINE_VIEWER_MAX = 40;

export interface BufferedLine {
  id: number;
  viewer: string;
  text: string;
}

export interface ChatLinesDb {
  /** Guarda una línea. `spont` = false para las cuentas de bots: solo valen para el resumen. */
  push(profileId: string, viewer: string, text: string, spont: boolean): Promise<void>;
  /** Todas las líneas guardadas, de la más vieja a la más nueva (para resumir). */
  all(profileId: string): Promise<BufferedLine[]>;
  /** Las últimas `limit` que el comentario espontáneo aún no ha contado, de la más vieja a la más nueva. */
  pendingSpontaneous(profileId: string, limit: number): Promise<BufferedLine[]>;
  /** El comentario ya las contó: la siguiente ventana empieza de cero. */
  markSpontaneousUsed(profileId: string, ids: number[]): Promise<void>;
  /**
   * Sin `maxId`: borra todo lo guardado de ese streamer (desconectar, apagar el bot, apagar el aprendizaje).
   * Con `maxId`: borra solo las de `id <= maxId` (las que se leyeron para resumir; las que llegaron mientras
   * tanto se conservan) y, con `keepPendingComments`, también conserva las que el comentario espontáneo aún no
   * ha contado (spont_used = false), para que no se pierdan.
   */
  clear(profileId: string, maxId?: number, options?: { keepPendingComments?: boolean }): Promise<void>;
}

const memo = new Map<string, SupabaseClient>();

function check(error: { code?: string; message: string } | null): void {
  if (!error) return;
  // 42P01 (PostgreSQL) y PGRST205 (PostgREST): no existe la tabla o la función
  if (error.code === '42P01' || error.code === 'PGRST205' || error.code === 'PGRST202' || error.code === '42883') throw new MigrationMissingError();
  throw new Error(`Supabase: ${error.code ?? 'error'}`);
}

export function supabaseChatLines(env: Env): ChatLinesDb | null {
  const url = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '').trim();
  const key = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!url || !key) return null;
  const cacheKey = `${url}:${key}`;
  if (!memo.has(cacheKey)) memo.set(cacheKey, createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }));
  const db = memo.get(cacheKey) as SupabaseClient;

  const toLines = (data: unknown): BufferedLine[] =>
    ((data ?? []) as Array<{ id: number; viewer: string; line: string }>).map((row) => ({ id: Number(row.id), viewer: row.viewer, text: row.line }));

  return {
    async push(profileId, viewer, text, spont) {
      const { error } = await db.rpc('push_twitch_bot_chat_line', {
        p_profile_id: profileId,
        p_viewer: viewer.slice(0, CHAT_LINE_VIEWER_MAX),
        p_line: text.slice(0, CHAT_LINE_TEXT_MAX),
        p_spont: spont,
        p_max: CHAT_LINES_KEEP,
      });
      check(error);
    },

    async all(profileId) {
      const { data, error } = await db
        .from('twitch_bot_chat_lines')
        .select('id, viewer, line')
        .eq('profile_id', profileId)
        .order('id', { ascending: true })
        .limit(CHAT_LINES_KEEP);
      check(error);
      return toLines(data);
    },

    async pendingSpontaneous(profileId, limit) {
      const { data, error } = await db
        .from('twitch_bot_chat_lines')
        .select('id, viewer, line')
        .eq('profile_id', profileId)
        .eq('spont', true)
        .eq('spont_used', false)
        .order('id', { ascending: false })
        .limit(limit);
      check(error);
      return toLines(data).reverse();
    },

    async markSpontaneousUsed(profileId, ids) {
      if (ids.length === 0) return;
      const { error } = await db.from('twitch_bot_chat_lines').update({ spont_used: true }).eq('profile_id', profileId).in('id', ids);
      check(error);
    },

    async clear(profileId, maxId, options = {}) {
      let query = db.from('twitch_bot_chat_lines').delete().eq('profile_id', profileId);
      if (maxId !== undefined) {
        query = query.lte('id', maxId);
        // Se conserva lo que solo el comentario espontáneo puede usar todavía: spont = true y spont_used = false
        if (options.keepPendingComments) query = query.or('spont.eq.false,spont_used.eq.true');
      }
      const { error } = await query;
      check(error);
    },
  };
}
