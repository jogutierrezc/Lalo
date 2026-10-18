/**
 * server/lux/keyVault.ts
 *
 * La clave de la API de NVIDIA que pega el administrador en el panel. Se cifra
 * con INTEGRATIONS_ENC_KEY (el mismo mecanismo que las claves de Ko-fi y
 * Spotify) y se guarda en app_settings. Solo el servidor la descifra.
 *
 * Nunca se devuelve al navegador: el panel solo pregunta si está configurada.
 */

import { decryptSecret, encryptSecret, parseKey } from '../integrations/crypto.js';
import type { Env } from '../integrations/store.js';
import { DEFAULT_LUX_MODEL } from './nvidia.js';
import type { LuxDb } from './luxDb.js';

export const SETTING_KEY = 'nvidia_api_key_enc';
export const SETTING_MODEL = 'nvidia_lux_model';

/** Las claves de build.nvidia.com empiezan por «nvapi-». Cualquier otra cosa se rechaza antes de guardarla. */
const KEY_SHAPE = /^nvapi-[A-Za-z0-9_-]{10,200}$/;

export const isNvidiaKey = (value: string): boolean => KEY_SHAPE.test(value);

export type SaveOutcome = 'saved' | 'cleared' | 'no_vault';

/** Guarda la clave cifrada, o la borra si `apiKey` es null. */
export async function saveApiKey(env: Env, db: LuxDb, apiKey: string | null): Promise<SaveOutcome> {
  if (apiKey === null) {
    await db.putSetting(SETTING_KEY, null);
    return 'cleared';
  }
  const vault = parseKey(env.INTEGRATIONS_ENC_KEY);
  if (!vault) return 'no_vault';
  await db.putSetting(SETTING_KEY, encryptSecret(apiKey, vault));
  return 'saved';
}

/** La clave en claro, solo para llamar a NVIDIA desde el servidor. Null si falta algo. */
export async function readApiKey(env: Env, db: LuxDb): Promise<string | null> {
  const vault = parseKey(env.INTEGRATIONS_ENC_KEY);
  if (!vault) return null;
  return decryptSecret(await db.setting(SETTING_KEY), vault);
}

export interface KeyState {
  /** Hay una clave guardada. */
  configured: boolean;
  /** El servidor tiene la clave de cifrado, así que se puede guardar y leer. */
  vault: boolean;
}

export async function keyState(env: Env, db: LuxDb): Promise<KeyState> {
  const vault = parseKey(env.INTEGRATIONS_ENC_KEY) !== null;
  const stored = (await db.setting(SETTING_KEY)) !== null;
  return { configured: stored, vault };
}

/** Modelo que usa Lux: el que eligió el administrador, o el de por defecto. */
export async function activeModel(db: LuxDb): Promise<string> {
  const chosen = (await db.setting(SETTING_MODEL))?.trim();
  return chosen ? chosen : DEFAULT_LUX_MODEL;
}
