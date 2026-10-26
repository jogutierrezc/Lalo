/**
 * server/lux/luxDb.ts
 *
 * Lo que el módulo de Mi AI (antes Lux AI) lee y escribe en Supabase, siempre con
 * la clave de servicio (ver migraciones 0020, 0023 y 0032). Va detrás de una
 * interfaz para que las pruebas usen una memoria en lugar de la base de datos.
 *
 * SIN PROBAR contra Supabase real.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { MigrationMissingError, type Env } from '../integrations/store.js';
import { MEMORY_SAVED_MAX, type LuxMemoryKind, type LuxMemorySource } from './memory.js';
import type { LuxAvatar, LuxCharacter, LuxGestureId, LuxModelOrigin } from './characters.js';
import type { LibraryModel, ReviewStatus } from './modelLibrary.js';

export interface LuxProfile {
  id: string;
  role: string;
  luxEnabled: boolean;
  /** Puede usar voces de ElevenLabs (interruptor del administrador, migración 0018). */
  elevenlabsEnabled?: boolean;
  /** Plan de la cuenta: de él sale el tope mensual de créditos (migración 0032). */
  planId?: string | null;
  /** Personaje asignado por el administrador. Null = el personaje por defecto (migración 0032). */
  luxCharacterId?: string | null;
  /** Modelo de la biblioteca que el creador eligió para su personaje (migración 0035). Null = ninguno. */
  luxModelId?: string | null;
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

/** Estado de un mensaje del panel que espera al bot (migración 0037). */
export type LuxOutboxStatus = 'pending' | 'claimed' | 'sent' | 'failed';

export interface LuxOutboxRow {
  profile_id: string;
  text: string;
  /** También se oye en el overlay de OBS cuando el bot lo recoge. */
  speak: boolean;
  emotion: string;
  /** 'literal': texto tal cual. 'ai': lo redactó la IA a partir de una idea. */
  mode: 'literal' | 'ai';
}

export interface LuxOutboxItem {
  id: number;
  text: string;
  speak: boolean;
  emotion: string;
  mode: 'literal' | 'ai';
  status: LuxOutboxStatus;
  createdAt: string;
  claimedAt: string | null;
  sentAt: string | null;
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
  /** Personaje al que pertenece el recuerdo (migración 0032). */
  characterId: string;
}

/** Modelo de un creador tal como lo lee el servidor: además de lo que ve la biblioteca, sus claves internas. */
export interface LuxLibraryRow extends LibraryModel {
  /** Clave de una subida que aún no se confirmó. Interna. */
  pendingKey: string | null;
  /** Archivos cuyo borrado falló. Interna. */
  staleKeys: string[];
}

/** Cambios de un modelo de creador: solo los campos presentes se escriben. */
export interface LuxLibraryPatch {
  name?: string;
  fileName?: string | null;
  bytes?: number | null;
  uploadedAt?: string | null;
  modelKey?: string | null;
  pendingKey?: string | null;
  staleKeys?: string[];
  reviewStatus?: ReviewStatus;
  licenseConfirmed?: boolean;
}

/** Lo que se guarda de un personaje (alta o edición). */
export interface LuxCharacterWrite {
  id?: string;
  name: string;
  avatar: LuxAvatar;
  color: string;
  gestures: LuxGestureId[];
  model: string | null;
  /** Cuenta dueña (migración 0033), o null para todas. */
  ownerProfileId: string | null;
}

/**
 * Escrituras de la memoria. Solo el servidor las hace (clave de servicio). Cada
 * una filtra por el dueño y por el personaje: un recuerdo de otro personaje no se ve ni se toca.
 */
export interface LuxMemoryDb {
  /** Hasta MEMORY_SAVED_MAX recuerdos de ese personaje, fijados primero y luego los más recientes. */
  memoryList(profileId: string, characterId: string): Promise<LuxMemoryItem[]>;
  /** Un recuerdo de ese personaje, o null si no existe o es de otro. */
  memoryGet(profileId: string, characterId: string, id: string): Promise<LuxMemoryItem | null>;
  memoryInsert(profileId: string, rows: LuxMemoryWrite[]): Promise<void>;
  /** true si la fila era de ese personaje y se cambió. */
  memoryUpdate(
    profileId: string,
    characterId: string,
    id: string,
    patch: { content?: string; pinned?: boolean; expiresAt?: string | null }
  ): Promise<boolean>;
  /** true si la fila era de ese personaje y se borró. */
  memoryDelete(profileId: string, characterId: string, id: string): Promise<boolean>;
  /** Borra los recuerdos del chat caducados y sin fijar (de todos los personajes del streamer). */
  memoryPrune(profileId: string, nowIso: string): Promise<void>;
}

export interface LuxDb extends Partial<LuxMemoryDb> {
  /** Valor de app_settings, o null si no existe. */
  setting(key: string): Promise<string | null>;
  /** Escribe el valor; con null, borra la clave. */
  putSetting(key: string, value: string | null): Promise<void>;
  profile(profileId: string): Promise<LuxProfile | null>;
  /** Memorias más recientes de un streamer con ese personaje, las fijadas primero. */
  memories(profileId: string, characterId: string, limit: number): Promise<LuxMemoryRow[]>;
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
  /** Cola de mensajes del panel hacia el chat (migración 0037). Opcionales en las pruebas. */
  outboxInsert?(row: LuxOutboxRow): Promise<number>;
  /** Los más recientes primero. */
  outboxList?(profileId: string, limit: number): Promise<LuxOutboxItem[]>;
  /**
   * Pasa a «claimed» los pendientes más antiguos y los devuelve. Cada mensaje sale una sola vez. También
   * recoge de nuevo los «claimed» de hace más de OUTBOX_RECLAIM_MS: el servidor se cayó a mitad de camino.
   */
  outboxClaim?(profileId: string, limit: number, nowIso: string): Promise<LuxOutboxItem[]>;
  /** El bot confirma que lo publicó (o que no pudo). true si era un mensaje recogido de esta cuenta. */
  outboxFinish?(profileId: string, id: number, ok: boolean, nowIso: string): Promise<boolean>;
  /** Devuelve a «pending» un mensaje recogido que no llegó a salir (límite de envío). true si era un «claimed» de esta cuenta. */
  outboxRelease?(profileId: string, id: number): Promise<boolean>;
  outboxPrune?(profileId: string, beforeIso: string): Promise<void>;
  /** Voz de TTS del streamer (configs, módulo 'tts'): la que usa el !s del chat. */
  ttsVoice?(profileId: string): Promise<{ referenceId: string | null; engine: string | null }>;
  saveSettingsRow(row: Record<string, unknown>): Promise<void>;

  /** Catálogo de personajes (migración 0032). Opcional en las pruebas: sin él, vale el personaje incorporado. */
  characters?(): Promise<LuxCharacter[]>;
  /** Crea (sin id) o edita (con id) un personaje. Devuelve su id. */
  saveCharacter?(row: LuxCharacterWrite): Promise<string>;
  /** Cuentas de streamer que pueden ser dueñas de un personaje (id y nombre para el selector). */
  streamers?(): Promise<Array<{ id: string; label: string }>>;
  /** Borra un personaje que no sea el por defecto. true si existía. */
  deleteCharacter?(id: string): Promise<boolean>;
  /** Estado del modelo 3D de un personaje (migración 0034). Opcional en las pruebas. */
  setCharacterModel?(id: string, patch: LuxCharacterModelPatch): Promise<void>;
  /** Hace que este personaje sea el único por defecto. */
  makeDefaultCharacter?(id: string): Promise<void>;
  /** Asigna el personaje a la cuenta; null vuelve al personaje por defecto. */
  assignCharacter?(profileId: string, characterId: string | null): Promise<void>;
  /** Tope mensual de créditos del plan, o null si el plan no existe. */
  planBudget?(planId: string): Promise<number | null>;
  /** Créditos que la cuenta ha gastado en ese mes (AAAA-MM). */
  usageThisMonth?(profileId: string, month: string): Promise<number>;
  /** Suma créditos al consumo del mes. */
  addUsage?(profileId: string, month: string, credits: number): Promise<void>;

  /** Modelos propios de los creadores (migración 0035). Opcional en las pruebas. */
  libraryModels?(): Promise<LuxLibraryRow[]>;
  /** Crea un modelo sin archivo confirmado, con la clave de la subida pedida. Devuelve su id. */
  libraryInsert?(row: { ownerProfileId: string; name: string; pendingKey: string }): Promise<string>;
  /** Cambia un modelo. true si existía. */
  libraryUpdate?(id: string, patch: LuxLibraryPatch): Promise<boolean>;
  /** Borra un modelo (la fila, no el archivo). */
  libraryDelete?(id: string): Promise<void>;
  /** Modelo elegido por el creador para su personaje; null la quita. */
  setProfileModel?(profileId: string, modelId: string | null): Promise<void>;
  /** Nº máximo de modelos propios del plan (null si el plan no tiene valor o no existe). */
  planModelLimit?(planId: string): Promise<number | null>;
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
const LIBRARY_COLUMNS = 'id, owner_profile_id, name, file_name, file_bytes, model_key, pending_key, stale_keys, review_status, license_confirmed, uploaded_at';
const CHARACTER_COLUMNS =
  'id, name, avatar, color, gestures, model, is_default, owner_profile_id, model_key, model_origin, model_file_name, model_file_bytes, model_uploaded_at, model_pending_key, model_stale_keys';

/** Cambios del estado del modelo: solo los campos presentes se escriben. */
export interface LuxCharacterModelPatch {
  modelKey?: string | null;
  modelOrigin?: LuxModelOrigin | null;
  modelFileName?: string | null;
  modelFileBytes?: number | null;
  modelUploadedAt?: string | null;
  modelPendingKey?: string | null;
  modelStaleKeys?: string[];
}

const OUTBOX_COLUMNS = 'id, text, speak, emotion, mode, status, created_at, claimed_at, sent_at';

/** Un mensaje «claimed» que lleva más de esto sin confirmarse se da por perdido y se recoge de nuevo. */
export const OUTBOX_RECLAIM_MS = 2 * 60_000;

/** Filtro de PostgREST (.or) de lo que se puede recoger: lo pendiente y lo recogido hace demasiado. */
export function outboxClaimable(nowIso: string): string {
  const cutoff = new Date(Date.parse(nowIso) - OUTBOX_RECLAIM_MS).toISOString();
  return `status.eq.pending,and(status.eq.claimed,claimed_at.lt.${cutoff})`;
}

function outboxFromRow(row: Record<string, unknown>): LuxOutboxItem {
  return {
    id: Number(row.id),
    text: String(row.text),
    speak: row.speak === true,
    emotion: String(row.emotion ?? 'normal'),
    mode: row.mode === 'ai' ? 'ai' : 'literal',
    status: (['pending', 'claimed', 'sent', 'failed'].includes(String(row.status)) ? String(row.status) : 'pending') as LuxOutboxStatus,
    createdAt: String(row.created_at),
    claimedAt: (row.claimed_at as string | null) ?? null,
    sentAt: (row.sent_at as string | null) ?? null,
  };
}

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

function characterFromRow(row: Record<string, unknown>): LuxCharacter {
  return {
    id: String(row.id),
    name: String(row.name),
    avatar: String(row.avatar) as LuxAvatar,
    color: String(row.color),
    gestures: (Array.isArray(row.gestures) ? row.gestures : []) as LuxGestureId[],
    model: (row.model as string | null) ?? null,
    isDefault: row.is_default === true,
    ownerProfileId: (row.owner_profile_id as string | null) ?? null,
    modelKey: (row.model_key as string | null) ?? null,
    modelOrigin: (row.model_origin as LuxModelOrigin | null) ?? null,
    modelFile: row.model_key
      ? {
          name: (row.model_file_name as string | null) ?? null,
          bytes: row.model_file_bytes === null || row.model_file_bytes === undefined ? null : Number(row.model_file_bytes),
          uploadedAt: (row.model_uploaded_at as string | null) ?? null,
        }
      : null,
    modelPendingKey: (row.model_pending_key as string | null) ?? null,
    modelStaleKeys: Array.isArray(row.model_stale_keys) ? row.model_stale_keys.map(String) : [],
  };
}

type ProfileRow = {
  id: string;
  role: string;
  lux_enabled: boolean | null;
  elevenlabs_enabled: boolean | null;
  plan_id: string | null;
  lux_character_id: string | null;
  lux_model_id: string | null;
};

function libraryFromRow(row: Record<string, unknown>): LuxLibraryRow {
  return {
    id: String(row.id),
    name: String(row.name),
    source: 'creador',
    ownerProfileId: String(row.owner_profile_id),
    fileName: (row.file_name as string | null) ?? null,
    bytes: row.file_bytes === null || row.file_bytes === undefined ? null : Number(row.file_bytes),
    uploadedAt: (row.uploaded_at as string | null) ?? null,
    reviewStatus: row.review_status as ReviewStatus,
    licenseConfirmed: row.license_confirmed === true,
    modelKey: (row.model_key as string | null) ?? null,
    pendingKey: (row.pending_key as string | null) ?? null,
    staleKeys: Array.isArray(row.stale_keys) ? row.stale_keys.map(String) : [],
  };
}

function profileFromRow(row: ProfileRow): LuxProfile {
  return {
    id: row.id,
    role: row.role,
    luxEnabled: row.lux_enabled === true,
    elevenlabsEnabled: row.elevenlabs_enabled === true,
    planId: row.plan_id ?? null,
    luxCharacterId: row.lux_character_id ?? null,
    luxModelId: row.lux_model_id ?? null,
  };
}

const PROFILE_COLUMNS = 'id, role, lux_enabled, elevenlabs_enabled, plan_id, lux_character_id, lux_model_id';

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
      const { data, error } = await db.from('profiles').select(PROFILE_COLUMNS).eq('id', profileId).maybeSingle();
      check(error);
      return data ? profileFromRow(data as ProfileRow) : null;
    },

    async memories(profileId, characterId, limit) {
      // Los caducados no llegan al modelo aunque la limpieza aún no los haya borrado.
      const { data, error } = await db
        .from('lux_memories')
        .select('kind, subject, content, pinned, created_at')
        .eq('profile_id', profileId)
        .eq('character_id', characterId)
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

    async outboxInsert(row) {
      const { data, error } = await db.from('lux_outbox').insert(row).select('id').single();
      check(error);
      return Number((data as { id: number }).id);
    },

    async outboxList(profileId, limit) {
      const { data, error } = await db
        .from('lux_outbox')
        .select(OUTBOX_COLUMNS)
        .eq('profile_id', profileId)
        .order('id', { ascending: false })
        .limit(limit);
      check(error);
      return ((data ?? []) as Array<Record<string, unknown>>).map(outboxFromRow);
    },

    async outboxClaim(profileId, limit, nowIso) {
      const claimable = outboxClaimable(nowIso);
      const { data: pending, error } = await db
        .from('lux_outbox')
        .select('id')
        .eq('profile_id', profileId)
        .or(claimable)
        .order('id', { ascending: true })
        .limit(limit);
      check(error);
      const ids = ((pending ?? []) as Array<{ id: number }>).map((row) => row.id);
      if (ids.length === 0) return [];
      // El filtro por estado repite el de arriba: si dos peticiones compiten, cada mensaje se lo lleva una sola.
      const { data, error: updateError } = await db
        .from('lux_outbox')
        .update({ status: 'claimed', claimed_at: nowIso })
        .eq('profile_id', profileId)
        .or(claimable)
        .in('id', ids)
        .select(OUTBOX_COLUMNS);
      check(updateError);
      return ((data ?? []) as Array<Record<string, unknown>>).map(outboxFromRow).sort((a, b) => a.id - b.id);
    },

    async outboxFinish(profileId, id, ok, nowIso) {
      const { data, error } = await db
        .from('lux_outbox')
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
        .from('lux_outbox')
        .update({ status: 'pending', claimed_at: null })
        .eq('profile_id', profileId)
        .eq('id', id)
        .eq('status', 'claimed')
        .select('id');
      check(error);
      return ((data ?? []) as unknown[]).length > 0;
    },

    async outboxPrune(profileId, beforeIso) {
      const { error } = await db.from('lux_outbox').delete().eq('profile_id', profileId).lt('created_at', beforeIso);
      check(error);
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
      const { data, error } = await db.from('profiles').select(PROFILE_COLUMNS).eq('widget_key', widgetKey).maybeSingle();
      check(error);
      return data ? profileFromRow(data as ProfileRow) : null;
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

    async memoryList(profileId, characterId) {
      const { data, error } = await db
        .from('lux_memories')
        .select(MEMORY_COLUMNS)
        .eq('profile_id', profileId)
        .eq('character_id', characterId)
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(MEMORY_SAVED_MAX);
      check(error);
      return ((data ?? []) as Array<Record<string, unknown>>).map(memoryFromRow);
    },

    async memoryGet(profileId, characterId, id) {
      const { data, error } = await db
        .from('lux_memories')
        .select(MEMORY_COLUMNS)
        .eq('id', id)
        .eq('profile_id', profileId)
        .eq('character_id', characterId)
        .maybeSingle();
      check(error);
      return data ? memoryFromRow(data as Record<string, unknown>) : null;
    },

    async memoryInsert(profileId, rows) {
      const { error } = await db.from('lux_memories').insert(
        rows.map((row) => ({
          profile_id: profileId,
          character_id: row.characterId,
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

    async memoryUpdate(profileId, characterId, id, patch) {
      const change: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (patch.content !== undefined) change.content = patch.content;
      if (patch.pinned !== undefined) change.pinned = patch.pinned;
      if (patch.expiresAt !== undefined) change.expires_at = patch.expiresAt;
      const { data, error } = await db
        .from('lux_memories')
        .update(change)
        .eq('id', id)
        .eq('profile_id', profileId)
        .eq('character_id', characterId)
        .select('id');
      check(error);
      return (data ?? []).length > 0;
    },

    async memoryDelete(profileId, characterId, id) {
      const { data, error } = await db
        .from('lux_memories')
        .delete()
        .eq('id', id)
        .eq('profile_id', profileId)
        .eq('character_id', characterId)
        .select('id');
      check(error);
      return (data ?? []).length > 0;
    },

    async memoryPrune(profileId, nowIso) {
      const { error } = await db.from('lux_memories').delete().eq('profile_id', profileId).eq('pinned', false).lt('expires_at', nowIso);
      check(error);
    },

    async characters() {
      const { data, error } = await db.from('lux_characters').select(CHARACTER_COLUMNS).order('is_default', { ascending: false }).order('name');
      check(error);
      return ((data ?? []) as Array<Record<string, unknown>>).map(characterFromRow);
    },

    async saveCharacter(row) {
      const change = {
        name: row.name,
        avatar: row.avatar,
        color: row.color,
        gestures: row.gestures,
        model: row.model,
        owner_profile_id: row.ownerProfileId,
        updated_at: new Date().toISOString(),
      };
      if (row.id) {
        const { data, error } = await db.from('lux_characters').update(change).eq('id', row.id).select('id');
        check(error);
        if ((data ?? []).length === 0) throw new Error('Supabase: character_not_found');
        return row.id;
      }
      const { data, error } = await db.from('lux_characters').insert(change).select('id').single();
      check(error);
      return String((data as { id: string }).id);
    },

    async streamers() {
      const { data, error } = await db.from('profiles').select('id, display_name, twitch_login').eq('role', 'streamer').order('display_name');
      check(error);
      return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id),
        label: String(row.display_name || row.twitch_login || row.id),
      }));
    },

    async deleteCharacter(id) {
      // El personaje por defecto no se borra aquí: lo impide el manejador y el índice único lo garantiza en la base.
      const { data, error } = await db.from('lux_characters').delete().eq('id', id).eq('is_default', false).select('id');
      check(error);
      return (data ?? []).length > 0;
    },

    async setCharacterModel(id, patch) {
      // Solo se escriben los campos que vienen en el parche; el resto de la fila queda igual.
      const change: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (patch.modelKey !== undefined) change.model_key = patch.modelKey;
      if (patch.modelOrigin !== undefined) change.model_origin = patch.modelOrigin;
      if (patch.modelFileName !== undefined) change.model_file_name = patch.modelFileName;
      if (patch.modelFileBytes !== undefined) change.model_file_bytes = patch.modelFileBytes;
      if (patch.modelUploadedAt !== undefined) change.model_uploaded_at = patch.modelUploadedAt;
      if (patch.modelPendingKey !== undefined) change.model_pending_key = patch.modelPendingKey;
      if (patch.modelStaleKeys !== undefined) change.model_stale_keys = patch.modelStaleKeys;
      const { data, error } = await db.from('lux_characters').update(change).eq('id', id).select('id');
      check(error);
      if ((data ?? []).length === 0) throw new Error('Supabase: character_not_found');
    },

    async makeDefaultCharacter(id) {
      // Primero se quita el de antes (el índice admite un solo por defecto) y luego se pone este.
      const clear = await db.from('lux_characters').update({ is_default: false }).eq('is_default', true).neq('id', id);
      check(clear.error);
      const { error } = await db.from('lux_characters').update({ is_default: true }).eq('id', id);
      check(error);
    },

    async assignCharacter(profileId, characterId) {
      const { error } = await db.from('profiles').update({ lux_character_id: characterId }).eq('id', profileId);
      check(error);
    },

    async planBudget(planId) {
      const { data, error } = await db.from('plans').select('lux_monthly_credits').eq('id', planId).maybeSingle();
      check(error);
      if (!data) return null;
      return Number((data as { lux_monthly_credits: number }).lux_monthly_credits) || 0;
    },

    async usageThisMonth(profileId, month) {
      const { data, error } = await db.from('lux_usage_monthly').select('credits').eq('profile_id', profileId).eq('month', month).maybeSingle();
      check(error);
      return Number((data as { credits: number } | null)?.credits ?? 0);
    },

    async addUsage(profileId, month, credits) {
      const { error } = await db.rpc('lux_add_usage', { p_profile: profileId, p_month: month, p_credits: credits });
      check(error);
    },

    async libraryModels() {
      const { data, error } = await db.from('lux_models').select(LIBRARY_COLUMNS).order('created_at', { ascending: false });
      check(error);
      return ((data ?? []) as Array<Record<string, unknown>>).map(libraryFromRow);
    },

    async libraryInsert(row) {
      const { data, error } = await db
        .from('lux_models')
        .insert({ owner_profile_id: row.ownerProfileId, name: row.name, pending_key: row.pendingKey, review_status: 'privado' })
        .select('id')
        .single();
      check(error);
      return String((data as { id: string }).id);
    },

    async libraryUpdate(id, patch) {
      const change: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (patch.name !== undefined) change.name = patch.name;
      if (patch.fileName !== undefined) change.file_name = patch.fileName;
      if (patch.bytes !== undefined) change.file_bytes = patch.bytes;
      if (patch.uploadedAt !== undefined) change.uploaded_at = patch.uploadedAt;
      if (patch.modelKey !== undefined) change.model_key = patch.modelKey;
      if (patch.pendingKey !== undefined) change.pending_key = patch.pendingKey;
      if (patch.staleKeys !== undefined) change.stale_keys = patch.staleKeys;
      if (patch.reviewStatus !== undefined) change.review_status = patch.reviewStatus;
      if (patch.licenseConfirmed !== undefined) change.license_confirmed = patch.licenseConfirmed;
      const { data, error } = await db.from('lux_models').update(change).eq('id', id).select('id');
      check(error);
      return (data ?? []).length > 0;
    },

    async libraryDelete(id) {
      const { error } = await db.from('lux_models').delete().eq('id', id);
      check(error);
    },

    async setProfileModel(profileId, modelId) {
      const { error } = await db.from('profiles').update({ lux_model_id: modelId }).eq('id', profileId);
      check(error);
    },

    async planModelLimit(planId) {
      const { data, error } = await db.from('plans').select('lux_max_models').eq('id', planId).maybeSingle();
      check(error);
      if (!data) return null;
      const value = (data as { lux_max_models: number | null }).lux_max_models;
      return value === null || value === undefined ? null : Number(value);
    },
  };
}
