/**
 * server/lux/keyVault.ts
 *
 * Las claves de los proveedores de IA (NVIDIA y Mistral) que pega el
 * administrador en el panel, y el proveedor y el modelo que usa Lux. Las claves
 * se cifran con INTEGRATIONS_ENC_KEY (el mismo mecanismo que Ko-fi y Spotify) y
 * se guardan en app_settings. Solo el servidor las descifra.
 *
 * Nunca se devuelven al navegador: el panel solo pregunta si están configuradas.
 */

import { decryptSecret, encryptSecret, parseKey } from '../integrations/crypto.js';
import type { Env } from '../integrations/store.js';
import { LUX_PROVIDERS, isLuxProvider, providerModel, type LuxProvider } from './nvidia.js';
import type { LuxDb } from './luxDb.js';

/** Nombres de las filas en app_settings. Las de NVIDIA son las de siempre. */
export const KEY_SETTING: Record<LuxProvider, string> = { nvidia: 'nvidia_api_key_enc', mistral: 'mistral_api_key_enc' };
export const MODEL_SETTING: Record<LuxProvider, string> = { nvidia: 'nvidia_lux_model', mistral: 'mistral_lux_model' };
export const PROVIDER_SETTING = 'lux_provider';

/** Alias de las filas de NVIDIA, que es el proveedor de siempre. Las pruebas y el código antiguo los usan. */
export const SETTING_KEY = KEY_SETTING.nvidia;
export const SETTING_MODEL = MODEL_SETTING.nvidia;

/** Las claves de build.nvidia.com empiezan por «nvapi-». Las de Mistral son alfanuméricas y largas. */
const NVIDIA_KEY_SHAPE = /^nvapi-[A-Za-z0-9_-]{10,200}$/;
/** Mistral no publica un formato fijo para sus claves: se acepta cualquier texto sin espacios y se deja que la prueba de conexión decida. */
const MISTRAL_KEY_SHAPE = /^\S{16,200}$/;

export const isKeyFor = (provider: LuxProvider, value: string): boolean =>
  provider === 'nvidia' ? NVIDIA_KEY_SHAPE.test(value) : MISTRAL_KEY_SHAPE.test(value) && !value.startsWith('nvapi-');

export const isNvidiaKey = (value: string): boolean => isKeyFor('nvidia', value);

/** Proveedor que usa Lux ahora: el que eligió el administrador, o NVIDIA. */
export async function activeProvider(db: LuxDb): Promise<LuxProvider> {
  const chosen = (await db.setting(PROVIDER_SETTING))?.trim() ?? '';
  return isLuxProvider(chosen) ? chosen : 'nvidia';
}

export type SaveOutcome = 'saved' | 'cleared' | 'no_vault';

/** Guarda la clave cifrada del proveedor, o la borra si `apiKey` es null. */
export async function saveApiKey(env: Env, db: LuxDb, apiKey: string | null, provider: LuxProvider = 'nvidia'): Promise<SaveOutcome> {
  if (apiKey === null) {
    await db.putSetting(KEY_SETTING[provider], null);
    return 'cleared';
  }
  const vault = parseKey(env.INTEGRATIONS_ENC_KEY);
  if (!vault) return 'no_vault';
  await db.putSetting(KEY_SETTING[provider], encryptSecret(apiKey, vault));
  return 'saved';
}

/** La clave en claro del proveedor, solo para llamarle desde el servidor. Null si falta algo. */
export async function readApiKey(env: Env, db: LuxDb, provider: LuxProvider = 'nvidia'): Promise<string | null> {
  const vault = parseKey(env.INTEGRATIONS_ENC_KEY);
  if (!vault) return null;
  return decryptSecret(await db.setting(KEY_SETTING[provider]), vault);
}

export interface KeyState {
  /** Hay una clave guardada para ese proveedor. */
  configured: boolean;
  /** El servidor tiene la clave de cifrado, así que se puede guardar y leer. */
  vault: boolean;
}

export async function keyState(env: Env, db: LuxDb, provider: LuxProvider = 'nvidia'): Promise<KeyState> {
  const vault = parseKey(env.INTEGRATIONS_ENC_KEY) !== null;
  const stored = (await db.setting(KEY_SETTING[provider])) !== null;
  return { configured: stored, vault };
}

/** Modelo que usa Lux con ese proveedor: el elegido por el administrador si pertenece a él, o su modelo por defecto. */
export async function activeModel(db: LuxDb, provider: LuxProvider = 'nvidia'): Promise<string> {
  const chosen = (await db.setting(MODEL_SETTING[provider]))?.trim() ?? '';
  return providerModel(provider, chosen) ?? LUX_PROVIDERS[provider].defaultModel;
}
