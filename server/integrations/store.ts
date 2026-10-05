/**
 * server/integrations/store.ts
 *
 * Lo que las integraciones leen y escriben en Supabase, siempre con la clave de
 * servicio. La tabla integration_accounts (migración 0013) no tiene políticas:
 * el navegador no puede leerla ni escribirla.
 *
 * Va detrás de una interfaz para que las pruebas usen una memoria en lugar de
 * la base de datos.
 *
 * SIN PROBAR contra Supabase real.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type Env = Record<string, string | undefined>;
export type Provider = 'spotify' | 'kofi' | 'riot';

export interface AccountRow {
  profile_id: string;
  provider: Provider;
  /** Cifrado: refresh token de Spotify o clave de verificación de Ko-fi. Riot no guarda ningún secreto por streamer. */
  secret_enc: string | null;
  /** Ko-fi: huella de la dirección personal (para buscar) y la dirección cifrada (para enseñársela a su dueño). */
  hook_hash: string | null;
  hook_enc: string | null;
  account_name: string | null;
  status: 'connected' | 'expired';
  connected_at: string | null;
  last_event_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  goal_raised: number;
  recent: unknown;
  /** Riot (migración 0015): servidor, PUUID y Riot ID del streamer. */
  meta?: unknown;
}

export interface KofiIngest {
  profileId: string;
  messageId: string;
  payload: Record<string, unknown>;
  goalAdd: number;
  recent: Record<string, unknown>;
}

export interface Store {
  profileByWidgetKey(key: string): Promise<string | null>;
  profileActive(profileId: string): Promise<boolean>;
  get(profileId: string, provider: Provider): Promise<AccountRow | null>;
  byHook(hash: string): Promise<AccountRow | null>;
  upsert(profileId: string, provider: Provider, patch: Partial<AccountRow>): Promise<void>;
  remove(profileId: string, provider: Provider): Promise<void>;
  count(provider: Provider): Promise<number>;
  /** Cuentas vinculadas de un servicio que no guarda secreto (Riot): cuenta las filas, sin mirar secret_enc. */
  countLinked(provider: Provider): Promise<number>;
  /** Ajustes sincronizados de un módulo del streamer, o null. */
  config(profileId: string, module: string): Promise<unknown>;
  ingestKofi(event: KofiIngest): Promise<'ok' | 'duplicate'>;
}

/** La tabla o las funciones de la migración 0013 no existen todavía. */
export class MigrationMissingError extends Error {
  constructor() {
    super('migration_missing');
  }
}

// 42P01: la tabla no existe. 42883: la función no existe. PGRST205 y PGRST202: lo mismo, dicho por PostgREST.
const MISSING_CODES = ['42P01', '42883', 'PGRST205', 'PGRST202', '42703'];

function check(error: { code?: string; message: string } | null): void {
  if (!error) return;
  if (MISSING_CODES.includes(error.code ?? '')) throw new MigrationMissingError();
  throw new Error(`Supabase: ${error.code ?? 'error'}`);
}

const TABLE = 'integration_accounts';

export function supabaseStore(db: SupabaseClient): Store {
  return {
    async profileByWidgetKey(key) {
      const { data, error } = await db.from('profiles').select('id').eq('widget_key', key).eq('status', 'active').maybeSingle();
      check(error);
      return (data?.id as string | undefined) ?? null;
    },
    async profileActive(profileId) {
      const { data, error } = await db.from('profiles').select('id').eq('id', profileId).eq('status', 'active').maybeSingle();
      check(error);
      return Boolean(data);
    },
    async get(profileId, provider) {
      const { data, error } = await db.from(TABLE).select('*').eq('profile_id', profileId).eq('provider', provider).maybeSingle();
      check(error);
      return (data as AccountRow | null) ?? null;
    },
    async byHook(hash) {
      const { data, error } = await db.from(TABLE).select('*').eq('provider', 'kofi').eq('hook_hash', hash).maybeSingle();
      check(error);
      return (data as AccountRow | null) ?? null;
    },
    async upsert(profileId, provider, patch) {
      const { error } = await db
        .from(TABLE)
        .upsert({ ...patch, profile_id: profileId, provider, updated_at: new Date().toISOString() }, { onConflict: 'profile_id,provider' });
      check(error);
    },
    async remove(profileId, provider) {
      const { error } = await db.from(TABLE).delete().eq('profile_id', profileId).eq('provider', provider);
      check(error);
    },
    async count(provider) {
      const { count, error } = await db.from(TABLE).select('profile_id', { count: 'exact', head: true }).eq('provider', provider).not('secret_enc', 'is', null);
      check(error);
      return count ?? 0;
    },
    async countLinked(provider) {
      const { count, error } = await db.from(TABLE).select('profile_id', { count: 'exact', head: true }).eq('provider', provider);
      check(error);
      return count ?? 0;
    },
    async config(profileId, module) {
      const { data, error } = await db.from('configs').select('data').eq('profile_id', profileId).eq('module', module).maybeSingle();
      check(error);
      return data?.data ?? null;
    },
    async ingestKofi(event) {
      const { data, error } = await db.rpc('ingest_kofi_event', {
        p_profile: event.profileId,
        p_message_id: event.messageId,
        p_payload: event.payload,
        p_goal_add: event.goalAdd,
        p_recent: event.recent,
      });
      check(error);
      return data === 'duplicate' ? 'duplicate' : 'ok';
    },
  };
}

/** Variables de Supabase que le faltan al servidor. */
export function missingSupabase(env: Env): string[] {
  const missing: string[] = [];
  if (!(env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '').trim()) missing.push('SUPABASE_URL');
  if (!(env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  return missing;
}

let cached: { url: string; store: Store } | null = null;

/** Almacén con la clave de servicio, o null si faltan las variables de Supabase. */
export function serviceStore(env: Env): Store | null {
  if (missingSupabase(env).length > 0) return null;
  const url = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '').trim();
  if (!cached || cached.url !== url) {
    const db = createClient(url, (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim(), { auth: { persistSession: false, autoRefreshToken: false } });
    cached = { url, store: supabaseStore(db) };
  }
  return cached.store;
}

// ---------- Tope de peticiones en memoria ----------

/** Cuenta peticiones por clave en una ventana. Vale dentro de un proceso, que es lo que hay. */
export function createLimiter(max: number, windowMs = 60_000, maxKeys = 2000) {
  const hits = new Map<string, number[]>();
  return {
    tooMany(key: string, now: number): boolean {
      const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return true;
      }
      recent.push(now);
      hits.delete(key);
      hits.set(key, recent);
      if (hits.size > maxKeys) hits.delete(hits.keys().next().value as string);
      return false;
    },
    clear: () => hits.clear(),
  };
}
