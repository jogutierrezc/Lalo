/**
 * server/done/doneDb.ts
 *
 * Lo que Done lee y escribe en sus tablas de Supabase (migración 0054), siempre con la clave de servicio.
 * Va detrás de una interfaz para que las pruebas usen una memoria. Lo que Done COMPARTE con Lux (perfil,
 * personajes, biblioteca de modelos, plan y créditos, ajustes de app_settings) se lee con LuxDb, no aquí.
 *
 * SIN PROBAR contra Supabase real.
 */

import { createClient } from '@supabase/supabase-js';
import { MigrationMissingError, type Env } from '../integrations/store.js';
import { DONE_EMOTIONS, DONE_GESTURES } from '../../src/lib/doneSettings.js';
import type { DoneEmotion, DoneGesture, DoneKind, DoneSpeech } from '../../src/lib/doneTypes.js';
import { MEMORY_SAVED_MAX, type LuxMemoryKind, type LuxMemorySource } from '../lux/memory.js';
import type { LuxMemoryItem, LuxMemoryRow, LuxOutboxStatus } from '../lux/luxDb.js';
import { outboxClaimable } from '../lux/luxDb.js';
import { LUX_THREAD_TTL_MS, LUX_THREAD_TURNS, trimThread, type LuxThreadMessage } from '../lux/thread.js';

export interface DoneReplyRow {
  profile_id: string;
  viewer: string | null;
  prompt: string;
  reply: string;
  model: string;
}

export interface DoneSpeechRow {
  profile_id: string;
  text: string;
  emotion: DoneEmotion;
  gesture: DoneGesture | null;
  viewer: string | null;
  kind: DoneKind;
}

export interface DoneMemoryWrite {
  kind: LuxMemoryKind;
  subject: string | null;
  content: string;
  pinned: boolean;
  source: LuxMemorySource;
  expiresAt: string | null;
}

export interface DoneOutboxRow {
  profile_id: string;
  /** 'say': un texto para el chat. 'event': un evento del canal que aún hay que saludar (el texto lo redacta la IA). */
  kind: 'say' | 'event';
  text: string;
  speak: boolean;
  emotion: DoneEmotion;
  gesture: DoneGesture | null;
  /** 'literal': texto tal cual. 'ai': lo redactó la IA. */
  mode: 'literal' | 'ai';
  /** Eventos: {type, user, ...}. */
  payload?: Record<string, unknown> | null;
}

export interface DoneOutboxItem {
  id: number;
  kind: 'say' | 'event';
  text: string;
  speak: boolean;
  emotion: DoneEmotion;
  gesture: DoneGesture | null;
  mode: 'literal' | 'ai';
  payload: Record<string, unknown> | null;
  status: LuxOutboxStatus;
  createdAt: string;
  claimedAt: string | null;
  sentAt: string | null;
}

export interface DoneDb {
  /** Fila de done_settings, o null si el creador nunca guardó ajustes. */
  settingsRow(profileId: string): Promise<Record<string, unknown> | null>;
  saveSettingsRow(row: Record<string, unknown>): Promise<void>;
  /** profiles.done_enabled (el administrador puede apagarlo por cuenta). Sin columna o sin perfil: true. */
  doneEnabled(profileId: string): Promise<boolean>;
  /** widget_key del perfil: SOLO para derivar y comprobar la clave de lectura. Nunca sale en una respuesta. */
  widgetKeyOf(profileId: string): Promise<string | null>;

  insertReply(row: DoneReplyRow): Promise<void>;

  insertSpeech(row: DoneSpeechRow): Promise<void>;
  speechSince(profileId: string, afterId: number, limit: number): Promise<DoneSpeech[]>;
  latestSpeechId(profileId: string): Promise<number>;
  pruneSpeech(profileId: string, beforeIso: string): Promise<void>;

  /** Recuerdos para el prompt: los fijados primero y luego los más recientes, sin caducados. */
  memories(profileId: string, limit: number): Promise<LuxMemoryRow[]>;
  memoryList(profileId: string): Promise<LuxMemoryItem[]>;
  memoryGet(profileId: string, id: string): Promise<LuxMemoryItem | null>;
  memoryInsert(profileId: string, rows: DoneMemoryWrite[]): Promise<void>;
  memoryUpdate(profileId: string, id: string, patch: { content?: string; pinned?: boolean; expiresAt?: string | null }): Promise<boolean>;
  memoryDelete(profileId: string, id: string): Promise<boolean>;
  memoryPrune(profileId: string, nowIso: string): Promise<void>;

  threadRecent(profileId: string, viewer: string, nowMs: number): Promise<LuxThreadMessage[]>;
  threadSave(profileId: string, viewer: string, pair: { user: string; assistant: string }, nowMs: number): Promise<void>;

  outboxInsert(row: DoneOutboxRow): Promise<number>;
  outboxList(profileId: string, limit: number): Promise<DoneOutboxItem[]>;
  /** Pasa a «claimed» los textos pendientes más antiguos (kind 'say') y los devuelve. Cada uno sale una sola vez. */
  outboxClaim(profileId: string, limit: number, nowIso: string): Promise<DoneOutboxItem[]>;
  /** Pasa a «claimed» los eventos pendientes que llevan esperando desde antes de `olderThanIso` (para agruparlos). */
  eventsClaim(profileId: string, olderThanIso: string, nowIso: string): Promise<DoneOutboxItem[]>;
  outboxFinish(profileId: string, id: number, ok: boolean, nowIso: string): Promise<boolean>;
  outboxRelease(profileId: string, id: number): Promise<boolean>;
  outboxPrune(profileId: string, beforeIso: string): Promise<void>;
}

// ---------- Supabase ----------

const MISSING_CODES = ['42P01', '42883', '42703', 'PGRST205', 'PGRST202', 'PGRST204'];

function check(error: { code?: string; message: string } | null): void {
  if (!error) return;
  if (MISSING_CODES.includes(error.code ?? '')) throw new MigrationMissingError();
  throw new Error(`Supabase: ${error.code ?? 'error'}`);
}

const emotionOf = (value: unknown): DoneEmotion => ((DONE_EMOTIONS as readonly string[]).includes(String(value)) ? (String(value) as DoneEmotion) : 'normal');
const gestureOf = (value: unknown): DoneGesture | null => ((DONE_GESTURES as readonly string[]).includes(String(value)) ? (String(value) as DoneGesture) : null);
const kindOf = (value: unknown): DoneKind => (['chat', 'event', 'spontaneous', 'say'].includes(String(value)) ? (String(value) as DoneKind) : 'chat');

const MEMORY_COLUMNS = 'id, kind, subject, content, pinned, source, created_at, expires_at';
const OUTBOX_COLUMNS = 'id, kind, text, speak, emotion, gesture, mode, payload, status, created_at, claimed_at, sent_at';

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

function outboxFromRow(row: Record<string, unknown>): DoneOutboxItem {
  return {
    id: Number(row.id),
    kind: row.kind === 'event' ? 'event' : 'say',
    text: String(row.text ?? ''),
    speak: row.speak === true,
    emotion: emotionOf(row.emotion),
    gesture: gestureOf(row.gesture),
    mode: row.mode === 'ai' ? 'ai' : 'literal',
    payload: row.payload && typeof row.payload === 'object' ? (row.payload as Record<string, unknown>) : null,
    status: (['pending', 'claimed', 'sent', 'failed'].includes(String(row.status)) ? String(row.status) : 'pending') as LuxOutboxStatus,
    createdAt: String(row.created_at),
    claimedAt: (row.claimed_at as string | null) ?? null,
    sentAt: (row.sent_at as string | null) ?? null,
  };
}

export function supabaseDoneDb(env: Env): DoneDb | null {
  const url = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '').trim();
  const key = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!url || !key) return null;
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  /** Recoge de forma atómica las filas que cumplen el filtro: el UPDATE repite el filtro, así dos peticiones no se llevan la misma. */
  async function claim(profileId: string, kind: 'say' | 'event', ids: number[], nowIso: string): Promise<DoneOutboxItem[]> {
    if (ids.length === 0) return [];
    const { data, error } = await db
      .from('done_outbox')
      .update({ status: 'claimed', claimed_at: nowIso })
      .eq('profile_id', profileId)
      .eq('kind', kind)
      .or(outboxClaimable(nowIso))
      .in('id', ids)
      .select(OUTBOX_COLUMNS);
    check(error);
    return ((data ?? []) as Array<Record<string, unknown>>).map(outboxFromRow).sort((a, b) => a.id - b.id);
  }

  return {
    async settingsRow(profileId) {
      const { data, error } = await db.from('done_settings').select('*').eq('profile_id', profileId).maybeSingle();
      check(error);
      return (data as Record<string, unknown> | null) ?? null;
    },

    async saveSettingsRow(row) {
      const { error } = await db.from('done_settings').upsert(row, { onConflict: 'profile_id' });
      check(error);
    },

    async doneEnabled(profileId) {
      const { data, error } = await db.from('profiles').select('done_enabled').eq('id', profileId).maybeSingle();
      check(error);
      return (data as { done_enabled: boolean | null } | null)?.done_enabled !== false;
    },

    async widgetKeyOf(profileId) {
      const { data, error } = await db.from('profiles').select('widget_key').eq('id', profileId).maybeSingle();
      check(error);
      const value = (data as { widget_key?: unknown } | null)?.widget_key;
      return typeof value === 'string' && value ? value : null;
    },

    async insertReply(row) {
      const { error } = await db.from('done_replies').insert(row);
      check(error);
    },

    async insertSpeech(row) {
      const { error } = await db.from('done_speech').insert(row);
      check(error);
    },

    async speechSince(profileId, afterId, limit) {
      const { data, error } = await db
        .from('done_speech')
        .select('id, text, emotion, gesture, viewer, kind, created_at')
        .eq('profile_id', profileId)
        .gt('id', afterId)
        .order('id', { ascending: true })
        .limit(limit);
      check(error);
      return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id),
        text: String(row.text),
        emotion: emotionOf(row.emotion),
        gesture: gestureOf(row.gesture),
        viewer: (row.viewer as string | null) ?? null,
        kind: kindOf(row.kind),
        createdAt: String(row.created_at),
      }));
    },

    async latestSpeechId(profileId) {
      const { data, error } = await db.from('done_speech').select('id').eq('profile_id', profileId).order('id', { ascending: false }).limit(1).maybeSingle();
      check(error);
      return data ? Number((data as { id: number }).id) : 0;
    },

    async pruneSpeech(profileId, beforeIso) {
      const { error } = await db.from('done_speech').delete().eq('profile_id', profileId).lt('created_at', beforeIso);
      check(error);
    },

    async memories(profileId, limit) {
      const { data, error } = await db
        .from('done_memories')
        .select('kind, subject, content')
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

    async memoryList(profileId) {
      const { data, error } = await db
        .from('done_memories')
        .select(MEMORY_COLUMNS)
        .eq('profile_id', profileId)
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(MEMORY_SAVED_MAX);
      check(error);
      return ((data ?? []) as Array<Record<string, unknown>>).map(memoryFromRow);
    },

    async memoryGet(profileId, id) {
      const { data, error } = await db.from('done_memories').select(MEMORY_COLUMNS).eq('id', id).eq('profile_id', profileId).maybeSingle();
      check(error);
      return data ? memoryFromRow(data as Record<string, unknown>) : null;
    },

    async memoryInsert(profileId, rows) {
      const { error } = await db.from('done_memories').insert(
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
      const { data, error } = await db.from('done_memories').update(change).eq('id', id).eq('profile_id', profileId).select('id');
      check(error);
      return (data ?? []).length > 0;
    },

    async memoryDelete(profileId, id) {
      const { data, error } = await db.from('done_memories').delete().eq('id', id).eq('profile_id', profileId).select('id');
      check(error);
      return (data ?? []).length > 0;
    },

    async memoryPrune(profileId, nowIso) {
      const { error } = await db.from('done_memories').delete().eq('profile_id', profileId).eq('pinned', false).lt('expires_at', nowIso);
      check(error);
    },

    async threadRecent(profileId, viewer, nowMs) {
      const { data, error } = await db
        .from('done_viewer_turns')
        .select('role, content, created_at')
        .eq('profile_id', profileId)
        .eq('viewer', viewer)
        .gte('created_at', new Date(nowMs - LUX_THREAD_TTL_MS).toISOString())
        .order('created_at', { ascending: false })
        .limit(LUX_THREAD_TURNS);
      check(error);
      const rows = ((data ?? []) as Array<{ role: string; content: string; created_at: string }>)
        .filter((row) => row.role === 'user' || row.role === 'assistant')
        .map((row) => ({ role: row.role as 'user' | 'assistant', content: String(row.content), at: Date.parse(row.created_at) }));
      return trimThread(rows, nowMs);
    },

    async threadSave(profileId, viewer, pair, nowMs) {
      const { error } = await db.from('done_viewer_turns').insert([
        { profile_id: profileId, viewer, role: 'user', content: pair.user, created_at: new Date(nowMs).toISOString() },
        { profile_id: profileId, viewer, role: 'assistant', content: pair.assistant, created_at: new Date(nowMs + 1).toISOString() },
      ]);
      check(error);
      const expired = await db.from('done_viewer_turns').delete().eq('profile_id', profileId).lt('created_at', new Date(nowMs - LUX_THREAD_TTL_MS).toISOString());
      check(expired.error);
      const extra = await db
        .from('done_viewer_turns')
        .select('id')
        .eq('profile_id', profileId)
        .eq('viewer', viewer)
        .order('created_at', { ascending: false })
        .range(LUX_THREAD_TURNS, LUX_THREAD_TURNS + 49);
      check(extra.error);
      const ids = ((extra.data ?? []) as Array<{ id: number }>).map((row) => row.id);
      if (ids.length > 0) {
        const removed = await db.from('done_viewer_turns').delete().in('id', ids);
        check(removed.error);
      }
    },

    async outboxInsert(row) {
      const { data, error } = await db.from('done_outbox').insert(row).select('id').single();
      check(error);
      return Number((data as { id: number }).id);
    },

    async outboxList(profileId, limit) {
      const { data, error } = await db
        .from('done_outbox')
        .select(OUTBOX_COLUMNS)
        .eq('profile_id', profileId)
        .eq('kind', 'say')
        .order('id', { ascending: false })
        .limit(limit);
      check(error);
      return ((data ?? []) as Array<Record<string, unknown>>).map(outboxFromRow);
    },

    async outboxClaim(profileId, limit, nowIso) {
      const { data, error } = await db
        .from('done_outbox')
        .select('id')
        .eq('profile_id', profileId)
        .eq('kind', 'say')
        .or(outboxClaimable(nowIso))
        .order('id', { ascending: true })
        .limit(limit);
      check(error);
      return claim(profileId, 'say', ((data ?? []) as Array<{ id: number }>).map((row) => row.id), nowIso);
    },

    async eventsClaim(profileId, olderThanIso, nowIso) {
      const { data, error } = await db
        .from('done_outbox')
        .select('id')
        .eq('profile_id', profileId)
        .eq('kind', 'event')
        .lte('created_at', olderThanIso)
        .or(outboxClaimable(nowIso))
        .order('id', { ascending: true })
        .limit(20);
      check(error);
      return claim(profileId, 'event', ((data ?? []) as Array<{ id: number }>).map((row) => row.id), nowIso);
    },

    async outboxFinish(profileId, id, ok, nowIso) {
      const { data, error } = await db
        .from('done_outbox')
        .update({ status: ok ? 'sent' : 'failed', sent_at: nowIso })
        .eq('profile_id', profileId)
        .eq('id', id)
        .eq('status', 'claimed')
        .select('id');
      check(error);
      return ((data ?? []) as unknown[]).length > 0;
    },

    async outboxRelease(profileId, id) {
      const { data, error } = await db
        .from('done_outbox')
        .update({ status: 'pending', claimed_at: null })
        .eq('profile_id', profileId)
        .eq('id', id)
        .eq('status', 'claimed')
        .select('id');
      check(error);
      return ((data ?? []) as unknown[]).length > 0;
    },

    async outboxPrune(profileId, beforeIso) {
      const { error } = await db.from('done_outbox').delete().eq('profile_id', profileId).lt('created_at', beforeIso);
      check(error);
    },
  };
}
