/**
 * server/done/doneDb.ts
 *
 * Lo que Done lee y escribe en Supabase: las MISMAS tablas de Lux (migración 0054: solo columnas nuevas, ninguna tabla).
 * Va detrás de una interfaz para que las pruebas usen una memoria.
 */

import { createClient } from '@supabase/supabase-js';
import { MigrationMissingError, type Env } from '../integrations/store.js';
import { DONE_EMOTIONS, DONE_GESTURES } from '../../src/lib/doneSettings.js';
import type { DoneEmotion, DoneGesture, DoneKind, DoneSpeech } from '../../src/lib/doneTypes.js';
import type { LuxMemoryKind, LuxMemorySource } from '../lux/memory.js';
import { outboxClaimable, supabaseLuxDb, type LuxDb, type LuxMemoryItem, type LuxMemoryRow, type LuxOutboxStatus } from '../lux/luxDb.js';
import { pickCharacter, visibleCharacters } from '../lux/characters.js';
import type { LuxThreadMessage } from '../lux/thread.js';

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
  saveSettingsRow(row: { profile_id: string; done_settings: Record<string, unknown> }): Promise<void>;
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

// ---------- Supabase: las MISMAS tablas de Lux, con el discriminador agent ----------
//
// Compartido con Lux tal cual: lux_memories (con el personaje activo de Lux), lux_viewer_turns, lux_usage_monthly.
// Separado con `agent` ('lux' | 'done'): lux_speech y lux_outbox. Ajustes: lux_settings.done_settings (jsonb).
// Los eventos pendientes viajan en lux_outbox como un texto «[[event]]{json}» (agent 'done'): la tabla exige texto no vacío.

const EVENT_PREFIX = '[[event]]';

const MISSING_CODES = ['42P01', '42883', '42703', 'PGRST205', 'PGRST202', 'PGRST204'];

function check(error: { code?: string; message: string } | null): void {
  if (!error) return;
  if (MISSING_CODES.includes(error.code ?? '')) throw new MigrationMissingError();
  throw new Error(`Supabase: ${error.code ?? 'error'}`);
}

const emotionOf = (value: unknown): DoneEmotion => ((DONE_EMOTIONS as readonly string[]).includes(String(value)) ? (String(value) as DoneEmotion) : 'normal');
const gestureOf = (value: unknown): DoneGesture | null => ((DONE_GESTURES as readonly string[]).includes(String(value)) ? (String(value) as DoneGesture) : null);
const kindOf = (value: unknown): DoneKind => (['chat', 'event', 'spontaneous', 'say'].includes(String(value)) ? (String(value) as DoneKind) : 'chat');

const OUTBOX_COLUMNS = 'id, text, speak, emotion, mode, status, created_at, claimed_at, sent_at';

function outboxFromRow(row: Record<string, unknown>): DoneOutboxItem {
  const raw = String(row.text ?? '');
  const isEvent = raw.startsWith(EVENT_PREFIX);
  let payload: Record<string, unknown> | null = null;
  if (isEvent) {
    try {
      const parsed: unknown = JSON.parse(raw.slice(EVENT_PREFIX.length));
      payload = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      payload = null;
    }
  }
  return {
    id: Number(row.id),
    kind: isEvent ? 'event' : 'say',
    text: isEvent ? '' : raw,
    speak: row.speak === true,
    emotion: emotionOf(row.emotion),
    gesture: null,
    mode: row.mode === 'ai' ? 'ai' : 'literal',
    payload,
    status: (['pending', 'claimed', 'sent', 'failed'].includes(String(row.status)) ? String(row.status) : 'pending') as LuxOutboxStatus,
    createdAt: String(row.created_at),
    claimedAt: (row.claimed_at as string | null) ?? null,
    sentAt: (row.sent_at as string | null) ?? null,
  };
}

export function supabaseDoneDb(env: Env): DoneDb | null {
  const url = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '').trim();
  const key = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  const maybeLux = supabaseLuxDb(env);
  if (!url || !key || !maybeLux) return null;
  const lux: LuxDb = maybeLux;
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const memory = lux as Required<Pick<LuxDb, 'memoryList' | 'memoryGet' | 'memoryInsert' | 'memoryUpdate' | 'memoryDelete' | 'memoryPrune' | 'threadRecent' | 'threadSave'>> & LuxDb;

  /** Los recuerdos de Done son los de Lux: los del personaje activo de la cuenta en Lux. */
  async function characterId(profileId: string): Promise<string> {
    const profile = await lux.profile(profileId);
    const list = lux.characters ? await lux.characters() : [];
    return pickCharacter(visibleCharacters(list, profileId), profile?.luxCharacterId ?? null).id;
  }

  const base = () => db.from('lux_outbox');

  /** Recoge de forma atómica: el UPDATE repite el filtro, así dos peticiones no se llevan la misma fila. */
  async function claim(profileId: string, ids: number[], nowIso: string): Promise<DoneOutboxItem[]> {
    if (ids.length === 0) return [];
    const { data, error } = await base()
      .update({ status: 'claimed', claimed_at: nowIso })
      .eq('profile_id', profileId)
      .eq('agent', 'done')
      .or(outboxClaimable(nowIso))
      .in('id', ids)
      .select(OUTBOX_COLUMNS);
    check(error);
    return ((data ?? []) as Array<Record<string, unknown>>).map(outboxFromRow).sort((a, b) => a.id - b.id);
  }

  return {
    async settingsRow(profileId) {
      const { data, error } = await db.from('lux_settings').select('done_settings').eq('profile_id', profileId).maybeSingle();
      check(error);
      const value = (data as { done_settings?: unknown } | null)?.done_settings;
      return value && typeof value === 'object' && Object.keys(value).length > 0 ? (value as Record<string, unknown>) : null;
    },

    async saveSettingsRow(row) {
      const { error } = await db.from('lux_settings').upsert({ profile_id: row.profile_id, done_settings: row.done_settings }, { onConflict: 'profile_id' });
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
      await lux.insertReply(row);
    },

    async insertSpeech(row) {
      const { error } = await db.from('lux_speech').insert({
        profile_id: row.profile_id,
        text: row.text,
        emotion: row.emotion,
        gesture: row.gesture ?? 'idle',
        agent: 'done',
        viewer: row.viewer,
        kind: row.kind,
      });
      check(error);
    },

    async speechSince(profileId, afterId, limit) {
      const { data, error } = await db
        .from('lux_speech')
        .select('id, text, emotion, gesture, viewer, kind, created_at')
        .eq('profile_id', profileId)
        .eq('agent', 'done')
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
      const { data, error } = await db.from('lux_speech').select('id').eq('profile_id', profileId).eq('agent', 'done').order('id', { ascending: false }).limit(1).maybeSingle();
      check(error);
      return data ? Number((data as { id: number }).id) : 0;
    },

    async pruneSpeech(profileId, beforeIso) {
      const { error } = await db.from('lux_speech').delete().eq('profile_id', profileId).eq('agent', 'done').lt('created_at', beforeIso);
      check(error);
    },

    async memories(profileId, limit) {
      return lux.memories(profileId, await characterId(profileId), limit);
    },
    async memoryList(profileId) {
      return memory.memoryList(profileId, await characterId(profileId));
    },
    async memoryGet(profileId, id) {
      return memory.memoryGet(profileId, await characterId(profileId), id);
    },
    async memoryInsert(profileId, rows) {
      const cid = await characterId(profileId);
      await memory.memoryInsert(profileId, rows.map((row) => ({ ...row, characterId: cid })));
    },
    async memoryUpdate(profileId, id, patch) {
      return memory.memoryUpdate(profileId, await characterId(profileId), id, patch);
    },
    async memoryDelete(profileId, id) {
      return memory.memoryDelete(profileId, await characterId(profileId), id);
    },
    async memoryPrune(profileId, nowIso) {
      await memory.memoryPrune(profileId, nowIso);
    },

    // Hilo por espectador: la tabla de Lux, compartida
    async threadRecent(profileId, viewer, nowMs) {
      return memory.threadRecent(profileId, viewer, nowMs);
    },
    async threadSave(profileId, viewer, pair, nowMs) {
      await memory.threadSave(profileId, viewer, pair, nowMs);
    },

    async outboxInsert(row) {
      const text = row.kind === 'event' ? `${EVENT_PREFIX}${JSON.stringify(row.payload ?? {})}`.slice(0, 500) : row.text;
      const { data, error } = await base()
        .insert({ profile_id: row.profile_id, text, speak: row.speak, emotion: row.emotion, mode: row.mode, agent: 'done' })
        .select('id')
        .single();
      check(error);
      return Number((data as { id: number }).id);
    },

    async outboxList(profileId, limit) {
      const { data, error } = await base()
        .select(OUTBOX_COLUMNS)
        .eq('profile_id', profileId)
        .eq('agent', 'done')
        .not('text', 'like', `${EVENT_PREFIX}%`)
        .order('id', { ascending: false })
        .limit(limit);
      check(error);
      return ((data ?? []) as Array<Record<string, unknown>>).map(outboxFromRow);
    },

    async outboxClaim(profileId, limit, nowIso) {
      const { data, error } = await base()
        .select('id')
        .eq('profile_id', profileId)
        .eq('agent', 'done')
        .not('text', 'like', `${EVENT_PREFIX}%`)
        .or(outboxClaimable(nowIso))
        .order('id', { ascending: true })
        .limit(limit);
      check(error);
      return claim(profileId, ((data ?? []) as Array<{ id: number }>).map((row) => row.id), nowIso);
    },

    async eventsClaim(profileId, olderThanIso, nowIso) {
      const { data, error } = await base()
        .select('id')
        .eq('profile_id', profileId)
        .eq('agent', 'done')
        .like('text', `${EVENT_PREFIX}%`)
        .lte('created_at', olderThanIso)
        .or(outboxClaimable(nowIso))
        .order('id', { ascending: true })
        .limit(20);
      check(error);
      return claim(profileId, ((data ?? []) as Array<{ id: number }>).map((row) => row.id), nowIso);
    },

    async outboxFinish(profileId, id, ok, nowIso) {
      const { data, error } = await base()
        .update({ status: ok ? 'sent' : 'failed', sent_at: nowIso })
        .eq('profile_id', profileId)
        .eq('agent', 'done')
        .eq('id', id)
        .eq('status', 'claimed')
        .select('id');
      check(error);
      return ((data ?? []) as unknown[]).length > 0;
    },

    async outboxRelease(profileId, id) {
      const { data, error } = await base()
        .update({ status: 'pending', claimed_at: null })
        .eq('profile_id', profileId)
        .eq('agent', 'done')
        .eq('id', id)
        .eq('status', 'claimed')
        .select('id');
      check(error);
      return ((data ?? []) as unknown[]).length > 0;
    },

    async outboxPrune(profileId, beforeIso) {
      const { error } = await base().delete().eq('profile_id', profileId).eq('agent', 'done').lt('created_at', beforeIso);
      check(error);
    },
  };
}
