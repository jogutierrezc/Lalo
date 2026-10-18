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
import { MEMORY_SAVED_MAX, type LuxMemoryKind, type LuxMemorySource } from './memory.js';

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

export interface LuxSpeechRow {
  profile_id: string;
  text: string;
  emotion: string;
  gesture: string;
  voice_reference_id: string | null;
  voice_engine: string | null;
  /** Hora a partir de la que puede sonar (ISO), o null si suena ya. Migración 0029. */
  play_after?: string | null;
}

export interface LuxSpeechItem {
  id: number;
  text: string;
  emotion: string;
  gesture: string;
  voice: { referenceId: string | null; engine: string | null };
  /** Hora ISO a partir de la que puede sonar, o null. */
  playAfter: string | null;
}

/** Un recuerdo tal como lo ve el streamer en la pestaña Memoria. */
export interface LuxMemoryItem {
  id: string;
  kind: LuxMemoryKind;
  subject: string | null;
  content: string;
  pinned: boolean;
  source: LuxMemorySource;
  createdAt: string;
  /** Hora ISO de caducidad, o null si no caduca. */
  expiresAt: string | null;
}

export interface LuxMemoryWrite {
  kind: LuxMemoryKind;
  subject: string | null;
  content: string;
  pinned: boolean;
  source: LuxMemorySource;
  expiresAt: string | null;
}

/** Escrituras de la memoria. Solo el servidor las hace (clave de servicio); cada una filtra por el dueño. */
export interface LuxMemoryDb {
  /** Hasta MEMORY_SAVED_MAX recuerdos del streamer, fijados primero y luego los más recientes. */
  memoryList(profileId: string): Promise<LuxMemoryItem[]>;
  /** Un recuerdo del streamer, o null si no existe o es de otro. */
  memoryGet(profileId: string, id: string): Promise<LuxMemoryItem | null>;
  memoryInsert(profileId: string, rows: LuxMemoryWrite[]): Promise<void>;
  /** true si la fila era del streamer y se cambió. */
  memoryUpdate(profileId: string, id: string, patch: { content?: string; pinned?: boolean; expiresAt?: string | null }): Promise<boolean>;
  /** true si la fila era del streamer y se borró. */
  memoryDelete(profileId: string, id: string): Promise<boolean>;
  /** Borra los recuerdos del chat caducados y sin fijar. */
  memoryPrune(profileId: string, nowIso: string): Promise<void>;
}

export interface LuxDb extends Partial<LuxMemoryDb> {
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
  /** Perfil por su clave de OBS (widget_key). Lo usa el chat, que no tiene sesión. Opcional en las pruebas. */
  profileByWidgetKey?(widgetKey: string): Promise<LuxProfile | null>;
  /** Frases pendientes para el overlay de OBS (migración 0027). Opcionales en las pruebas. */
  insertSpeech?(row: LuxSpeechRow): Promise<void>;
  speechSince?(profileId: string, afterId: number): Promise<LuxSpeechItem[]>;
  latestSpeechId?(profileId: string): Promise<number>;
  pruneSpeech?(profileId: string, beforeIso: string): Promise<void>;
  /** Voz de TTS del streamer (configs, módulo 'tts'): la que usa el !s del chat. */
  ttsVoice?(profileId: string): Promise<{ referenceId: string | null; engine: string | null }>;
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

const MEMORY_COLUMNS = 'id, kind, subject, content, pinned, source, created_at, expires_at';

function memoryFromRow(row: Record<string, unknown>): LuxMemoryItem {
  return {
    id: String(row.id),
    kind: row.kind as LuxMemoryKind,
    subject: (row.subject as string | null) ?? null,
    content: String(row.content),
    pinned: row.pinned === true,
    source: row.source === 'chat' ? 'chat' : row.source === 'admin' ? 'admin' : 'manual',
    createdAt: String(row.created_at),
    expiresAt: (row.expires_at as string | null) ?? null,
  };
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
      // Los caducados no llegan al modelo aunque la limpieza aún no los haya borrado.
      const { data, error } = await db
        .from('lux_memories')
        .select('kind, subject, content, pinned, created_at')
        .eq('profile_id', profileId)
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
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

    async insertSpeech(row) {
      const { error } = await db.from('lux_speech').insert(row);
      check(error);
    },

    async speechSince(profileId, afterId) {
      const { data, error } = await db
        .from('lux_speech')
        .select('id, text, emotion, gesture, voice_reference_id, voice_engine, play_after')
        .eq('profile_id', profileId)
        .gt('id', afterId)
        .order('id', { ascending: true })
        .limit(20);
      check(error);
      return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: Number(row.id),
        text: String(row.text),
        emotion: String(row.emotion),
        gesture: String(row.gesture),
        voice: { referenceId: (row.voice_reference_id as string | null) ?? null, engine: (row.voice_engine as string | null) ?? null },
        playAfter: (row.play_after as string | null) ?? null,
      }));
    },

    async latestSpeechId(profileId) {
      const { data, error } = await db
        .from('lux_speech')
        .select('id')
        .eq('profile_id', profileId)
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
      check(error);
      return data ? Number((data as { id: number }).id) : 0;
    },

    async ttsVoice(profileId) {
      const { data, error } = await db.from('configs').select('data').eq('profile_id', profileId).eq('module', 'tts').maybeSingle();
      check(error);
      const cfg = ((data as { data?: Record<string, unknown> } | null)?.data ?? {}) as Record<string, unknown>;
      const referenceId = typeof cfg.referenceId === 'string' && cfg.referenceId ? cfg.referenceId : null;
      const engine = cfg.engine === 'elevenlabs' ? 'elevenlabs' : referenceId ? 'fish' : null;
      return { referenceId, engine };
    },

    async pruneSpeech(profileId, beforeIso) {
      const { error } = await db.from('lux_speech').delete().eq('profile_id', profileId).lt('created_at', beforeIso);
      check(error);
    },

    async profileByWidgetKey(widgetKey) {
      const { data, error } = await db
        .from('profiles')
        .select('id, role, lux_enabled, elevenlabs_enabled')
        .eq('widget_key', widgetKey)
        .maybeSingle();
      check(error);
      if (!data) return null;
      const row = data as { id: string; role: string; lux_enabled: boolean | null; elevenlabs_enabled: boolean | null };
      return { id: row.id, role: row.role, luxEnabled: row.lux_enabled === true, elevenlabsEnabled: row.elevenlabs_enabled === true };
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

    async memoryList(profileId) {
      const { data, error } = await db
        .from('lux_memories')
        .select(MEMORY_COLUMNS)
        .eq('profile_id', profileId)
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(MEMORY_SAVED_MAX);
      check(error);
      return ((data ?? []) as Array<Record<string, unknown>>).map(memoryFromRow);
    },

    async memoryGet(profileId, id) {
      const { data, error } = await db.from('lux_memories').select(MEMORY_COLUMNS).eq('id', id).eq('profile_id', profileId).maybeSingle();
      check(error);
      return data ? memoryFromRow(data as Record<string, unknown>) : null;
    },

    async memoryInsert(profileId, rows) {
      const { error } = await db.from('lux_memories').insert(
        rows.map((row) => ({
          profile_id: profileId,
          kind: row.kind,
          subject: row.subject,
          content: row.content,
          pinned: row.pinned,
          source: row.source,
          expires_at: row.expiresAt,
        }))
      );
      check(error);
    },

    async memoryUpdate(profileId, id, patch) {
      const change: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (patch.content !== undefined) change.content = patch.content;
      if (patch.pinned !== undefined) change.pinned = patch.pinned;
      if (patch.expiresAt !== undefined) change.expires_at = patch.expiresAt;
      const { data, error } = await db.from('lux_memories').update(change).eq('id', id).eq('profile_id', profileId).select('id');
      check(error);
      return (data ?? []).length > 0;
    },

    async memoryDelete(profileId, id) {
      const { data, error } = await db.from('lux_memories').delete().eq('id', id).eq('profile_id', profileId).select('id');
      check(error);
      return (data ?? []).length > 0;
    },

    async memoryPrune(profileId, nowIso) {
      const { error } = await db.from('lux_memories').delete().eq('profile_id', profileId).eq('pinned', false).lt('expires_at', nowIso);
      check(error);
    },
  };
}
