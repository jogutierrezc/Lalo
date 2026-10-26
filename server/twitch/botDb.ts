/**
 * server/twitch/botDb.ts
 *
 * Lo que el bot de chat de Twitch en la nube lee y escribe en Supabase, siempre
 * con la clave de servicio (migración 0039). Va detrás de una interfaz para que
 * las pruebas usen una memoria en lugar de la base de datos, como luxDb.ts.
 *
 * Las reglas de nombres de comando no se repiten aquí: se usan las del script de
 * Python (cleanCommandName, en commandNames.ts, sin dependencias), para que un comando
 * valga igual en los dos sitios.
 *
 * SIN PROBAR contra Supabase real.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { MigrationMissingError, type Env } from '../integrations/store.js';
import { cleanCommandName } from './commandNames.js';
import type { CommandPermission } from '../../src/types/twitchio.js';

export const BOT_PERMISSIONS: readonly CommandPermission[] = ['all', 'sub', 'mod', 'broadcaster'];
export const BOT_DEFAULT_PREFIX = '!';
/** Twitch no deja mensajes de más de 500 caracteres. */
export const BOT_RESPONSE_MAX = 500;
export const BOT_NAME_MAX = 50;
export const BOT_PREFIX_MAX = 5;
/** La posición de un comando se acota a ±1e6 (la columna es integer: un valor enorme daba un error de base de datos). */
export const BOT_POSITION_MAX = 1_000_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** true si es un UUID (los ids de comando lo son; cualquier otra cosa se rechaza antes de tocar la base). */
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

/** 'global' = la cuenta del bot de la plataforma. 'streamer' queda reservado para más adelante. */
export type BotSenderMode = 'global' | 'streamer';

export interface BotSettings {
  enabled: boolean;
  prefix: string;
  welcomeMessage: string;
  senderMode: BotSenderMode;
}

/** Ajustes de un streamer que aún no ha guardado nada. */
export const DEFAULT_BOT_SETTINGS: BotSettings = {
  enabled: false,
  prefix: BOT_DEFAULT_PREFIX,
  welcomeMessage: '',
  senderMode: 'global',
};

export interface BotCommand {
  id: string;
  name: string;
  response: string;
  permission: CommandPermission;
  enabled: boolean;
  position: number;
}

/** Lo que manda el panel al guardar. Sin id se crea; con id se cambia ese comando. */
export interface BotCommandInput {
  id?: string;
  name: string;
  response: string;
  permission?: string;
  enabled?: boolean;
  position?: number;
}

/** Comando ya comprobado y con el nombre limpio, listo para guardar. */
export type BotCommandWrite = Omit<BotCommand, 'id'> & { id?: string };

export type BotCooldownResult = { ok: true } | { ok: false; waitSeconds: number };

export type BotDbErrorCode = 'name' | 'response' | 'permission' | 'prefix' | 'duplicate' | 'not_found' | 'id';

/** Error de datos del streamer (no de la base): el panel puede enseñar el código. */
export class BotDbError extends Error {
  constructor(public readonly code: BotDbErrorCode) {
    super(`bot: ${code}`);
    this.name = 'BotDbError';
  }
}

export interface BotDb {
  /** Ajustes del streamer, o null si nunca los guardó. */
  settings(profileId: string): Promise<BotSettings | null>;
  /**
   * Guarda SOLO los campos que vienen en `patch` (crea la fila si no existe): dos cambios a la vez
   * de campos distintos no se pisan. Devuelve los ajustes completos. Lanza BotDbError si el prefijo no vale.
   */
  saveSettings(profileId: string, patch: Partial<BotSettings>): Promise<BotSettings>;
  /** Todos los comandos del streamer, por posición y luego por nombre. */
  commands(profileId: string): Promise<BotCommand[]>;
  /** Crea o cambia un comando. Lanza BotDbError (name, response, permission, duplicate, not_found). */
  saveCommand(profileId: string, input: BotCommandInput, prefix?: string): Promise<BotCommand>;
  /** Borra un comando del streamer. true si existía. */
  deleteCommand(profileId: string, id: string): Promise<boolean>;
  /**
   * Toma el cooldown de un espectador para una clave, de forma atómica: si puede,
   * lo deja anotado durante `seconds` y devuelve ok; si no, devuelve los segundos
   * que faltan y no toca nada. También sirve de candado y de límite de tasa por
   * perfil (viewer '_'): la base de datos lo comparte entre instancias.
   */
  takeCooldown(profileId: string, viewer: string, key: string, seconds: number): Promise<BotCooldownResult>;
}

/** Prefijo válido: de 1 a 5 caracteres, sin espacios. */
export function validPrefix(prefix: string): boolean {
  return prefix.length >= 1 && prefix.length <= BOT_PREFIX_MAX && !/\s/.test(prefix);
}

/**
 * Comprueba y normaliza un comando del panel. El nombre se limpia con
 * cleanCommandName; la respuesta se recorta de espacios; un permiso desconocido
 * se rechaza (no se cambia en silencio por 'all', que sería abrir el comando).
 */
export function validateBotCommand(input: BotCommandInput, prefix = BOT_DEFAULT_PREFIX): BotCommandWrite {
  const name = cleanCommandName(typeof input.name === 'string' ? input.name : '', prefix);
  if (!name || name.length > BOT_NAME_MAX) throw new BotDbError('name');
  const response = typeof input.response === 'string' ? input.response.trim() : '';
  if (!response || response.length > BOT_RESPONSE_MAX) throw new BotDbError('response');
  const permission = input.permission ?? 'all';
  if (!(BOT_PERMISSIONS as readonly string[]).includes(permission)) throw new BotDbError('permission');
  if (input.id !== undefined && input.id !== '' && !isUuid(input.id)) throw new BotDbError('id');
  const position = Number.isFinite(input.position)
    ? Math.max(-BOT_POSITION_MAX, Math.min(BOT_POSITION_MAX, Math.trunc(input.position as number)))
    : 0;
  return {
    ...(input.id ? { id: input.id } : {}),
    name,
    response,
    permission: permission as CommandPermission,
    enabled: input.enabled !== false,
    position,
  };
}

// 42P01: la tabla no existe. 42883: la función no existe. 42703: columna inexistente. PGRST205 y PGRST202: lo mismo, dicho por PostgREST.
const MISSING_CODES = ['42P01', '42883', '42703', 'PGRST205', 'PGRST202', 'PGRST204'];

function check(error: { code?: string; message: string } | null): void {
  if (!error) return;
  if (MISSING_CODES.includes(error.code ?? '')) throw new MigrationMissingError();
  throw new Error(`Supabase: ${error.code ?? 'error'}`);
}

const COMMAND_COLUMNS = 'id, name, response, permission, enabled, position';

interface CommandRow {
  id: string;
  name: string;
  response: string;
  permission: CommandPermission;
  enabled: boolean;
  position: number;
}

function commandFromRow(row: CommandRow): BotCommand {
  return {
    id: row.id,
    name: row.name,
    response: row.response,
    permission: row.permission,
    enabled: row.enabled,
    position: row.position,
  };
}

export function supabaseBotDb(env: Env): BotDb | null {
  const url = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '').trim();
  const key = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!url || !key) return null;
  const db: SupabaseClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  async function readSettings(profileId: string): Promise<BotSettings | null> {
    const { data, error } = await db
      .from('twitch_bot_settings')
      .select('enabled, prefix, welcome_message, sender_mode')
      .eq('profile_id', profileId)
      .maybeSingle();
    check(error);
    if (!data) return null;
    const row = data as { enabled: boolean; prefix: string; welcome_message: string; sender_mode: BotSenderMode };
    return { enabled: row.enabled, prefix: row.prefix, welcomeMessage: row.welcome_message, senderMode: row.sender_mode };
  }

  return {
    settings: readSettings,

    async saveSettings(profileId, patch) {
      if (patch.prefix !== undefined && !validPrefix(patch.prefix)) throw new BotDbError('prefix');
      // Solo las columnas que cambian: el upsert de PostgREST actualiza únicamente las que van en la fila
      const row: Record<string, unknown> = { profile_id: profileId, updated_at: new Date().toISOString() };
      if (patch.enabled !== undefined) row.enabled = patch.enabled;
      if (patch.prefix !== undefined) row.prefix = patch.prefix;
      if (patch.welcomeMessage !== undefined) row.welcome_message = patch.welcomeMessage;
      if (patch.senderMode !== undefined) row.sender_mode = patch.senderMode;
      const { error } = await db.from('twitch_bot_settings').upsert(row, { onConflict: 'profile_id' });
      check(error);
      return (await readSettings(profileId)) ?? { ...DEFAULT_BOT_SETTINGS, ...patch };
    },

    async commands(profileId) {
      const { data, error } = await db
        .from('twitch_bot_commands')
        .select(COMMAND_COLUMNS)
        .eq('profile_id', profileId)
        .order('position', { ascending: true })
        .order('name', { ascending: true });
      check(error);
      return ((data ?? []) as CommandRow[]).map(commandFromRow);
    },

    async saveCommand(profileId, input, prefix = BOT_DEFAULT_PREFIX) {
      const write = validateBotCommand(input, prefix);
      const fields = {
        name: write.name,
        response: write.response,
        permission: write.permission,
        enabled: write.enabled,
        position: write.position,
        updated_at: new Date().toISOString(),
      };
      if (write.id) {
        // El filtro por profile_id impide tocar el comando de otro streamer aunque se conozca su id
        const { data, error } = await db
          .from('twitch_bot_commands')
          .update(fields)
          .eq('id', write.id)
          .eq('profile_id', profileId)
          .select(COMMAND_COLUMNS)
          .maybeSingle();
        if (error?.code === '23505') throw new BotDbError('duplicate');
        check(error);
        if (!data) throw new BotDbError('not_found');
        return commandFromRow(data as CommandRow);
      }
      const { data, error } = await db
        .from('twitch_bot_commands')
        .insert({ profile_id: profileId, ...fields })
        .select(COMMAND_COLUMNS)
        .single();
      if (error?.code === '23505') throw new BotDbError('duplicate');
      check(error);
      return commandFromRow(data as CommandRow);
    },

    async deleteCommand(profileId, id) {
      // Un id que no es UUID no puede existir: se contesta sin preguntar a la base (daría error de tipo)
      if (!isUuid(id)) return false;
      const { data, error } = await db
        .from('twitch_bot_commands')
        .delete()
        .eq('id', id)
        .eq('profile_id', profileId)
        .select('id');
      check(error);
      return (data ?? []).length > 0;
    },

    async takeCooldown(profileId, viewer, cooldownKey, seconds) {
      const { data, error } = await db.rpc('take_twitch_bot_cooldown', {
        p_profile_id: profileId,
        p_viewer: viewer.toLowerCase(),
        p_key: cooldownKey,
        p_seconds: Math.max(0, Math.ceil(seconds)),
      });
      check(error);
      const wait = Number(data);
      return wait > 0 ? { ok: false, waitSeconds: wait } : { ok: true };
    },
  };
}
