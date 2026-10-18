/**
 * server/lux/luxDb.ts
 *
 * Lo que el módulo de Lux lee y escribe en Supabase, siempre con la clave de
 * servicio (ver migraciones 0020 y 0023). Va detrás de una interfaz para que las
 * pruebas usen una memoria en lugar de la base de datos.
 *
 * SIN PROBAR contra Supabase real.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { MigrationMissingError, type Env } from '../integrations/store.js';

export interface LuxProfile {
  id: string;
  role: string;
  luxEnabled: boolean;
  /** Puede usar voces de ElevenLabs (interruptor del administrador, migración 0018). */
  elevenlabsEnabled?: boolean;
}

export interface LuxMemoryRow {
  kind: 'fact' | 'style' | 'viewer' | 'event';
  subject: string | null;
  content: string;
}

export interface LuxReplyRow {
  profile_id: string;
  viewer: string | null;
  prompt: string;
  reply: string;
  model: string;
}

export interface LuxDb {
  /** Valor de app_settings, o null si no existe. */
  setting(key: string): Promise<string | null>;
  /** Escribe el valor; con null, borra la clave. */
  putSetting(key: string, value: string | null): Promise<void>;
  profile(profileId: string): Promise<LuxProfile | null>;
  /** Memorias más recientes de un streamer, las fijadas primero. */
  memories(profileId: string, limit: number): Promise<LuxMemoryRow[]>;
  insertReply(row: LuxReplyRow): Promise<void>;
  /** Fila de lux_settings del streamer, o null si nunca guardó ajustes. */
  settingsRow(profileId: string): Promise<Record<string, unknown> | null>;
  saveSettingsRow(row: Record<string, unknown>): Promise<void>;
}

// 42P01: la tabla no existe. 42703: columna inexistente. PGRST205 y PGRST202: lo mismo, dicho por PostgREST.
// PGRST204: PostgREST no encuentra una columna nueva en su caché (migración 0025 sin aplicar).
const MISSING_CODES = ['42P01', '42883', '42703', 'PGRST205', 'PGRST202', 'PGRST204'];

function check(error: { code?: string; message: string } | null): void {
  if (!error) return;
  if (MISSING_CODES.includes(error.code ?? '')) throw new MigrationMissingError();
  throw new Error(`Supabase: ${error.code ?? 'error'}`);
}

export function supabaseLuxDb(env: Env): LuxDb | null {
  const url = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '').trim();
  const key = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!url || !key) return null;
  const db: SupabaseClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  return {
    async setting(name) {
      const { data, error } = await db.from('app_settings').select('value').eq('key', name).maybeSingle();
      check(error);
      return (data as { value: string } | null)?.value ?? null;
    },

    async putSetting(name, value) {
      if (value === null) {
        const { error } = await db.from('app_settings').delete().eq('key', name);
        check(error);
        return;
      }
      const { error } = await db
        .from('app_settings')
        .upsert({ key: name, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      check(error);
    },

    async profile(profileId) {
      const { data, error } = await db
        .from('profiles')
        .select('id, role, lux_enabled, elevenlabs_enabled')
        .eq('id', profileId)
        .maybeSingle();
      check(error);
      if (!data) return null;
      const row = data as { id: string; role: string; lux_enabled: boolean | null; elevenlabs_enabled: boolean | null };
      return { id: row.id, role: row.role, luxEnabled: row.lux_enabled === true, elevenlabsEnabled: row.elevenlabs_enabled === true };
    },

    async memories(profileId, limit) {
      const { data, error } = await db
        .from('lux_memories')
        .select('kind, subject, content, pinned, created_at')
        .eq('profile_id', profileId)
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit);
      check(error);
      return ((data ?? []) as Array<{ kind: LuxMemoryRow['kind']; subject: string | null; content: string }>).map((row) => ({
        kind: row.kind,
        subject: row.subject,
        content: row.content,
      }));
    },

    async insertReply(row) {
      const { error } = await db.from('lux_replies').insert(row);
      check(error);
    },

    async settingsRow(profileId) {
      const { data, error } = await db.from('lux_settings').select('*').eq('profile_id', profileId).maybeSingle();
      check(error);
      return (data as Record<string, unknown> | null) ?? null;
    },

    async saveSettingsRow(row) {
      const { error } = await db.from('lux_settings').upsert(row, { onConflict: 'profile_id' });
      check(error);
    },
  };
}
