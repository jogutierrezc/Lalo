/**
 * server/lux/mascotaModel.ts
 *
 * Archivo del modelo GLB de Mascota 2. Solo lo sirve /api/lux/model, a la cuenta
 * dueña del personaje, y nunca como URL pública.
 *
 * Va en un bucket PRIVADO de R2 aparte (R2_MODELS_BUCKET). El bucket de R2_BUCKET
 * sale por R2_PUBLIC_BASE_URL, así que ahí el modelo sería público por URL. Si
 * falta la variable, no se sirve nada (falla cerrado).
 */

import { getObject, type Env, type R2Config } from '../storage/r2.js';

export const MODELS_BUCKET_ENV = 'R2_MODELS_BUCKET';

/** Clave del objeto: prefijo fijo y 32 hex al azar. La genera el script de subida; se guarda en lux_characters.model_key. */
const MODEL_KEY = /^lux-models\/[0-9a-f]{32}\.glb$/;

export const isModelKey = (value: unknown): value is string => typeof value === 'string' && MODEL_KEY.test(value);

/** Configuración del bucket privado. Devuelve los nombres de las variables que faltan, nunca sus valores. */
export function readModelsConfig(env: Env): { config: R2Config | null; missing: string[] } {
  const value = (name: string) => (env[name] ?? '').trim();
  // Las credenciales son las de R2; el bucket es el privado, no el público de R2_BUCKET.
  const names = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', MODELS_BUCKET_ENV];
  const missing = names.filter((name) => value(name).length === 0);
  if (missing.length > 0) return { config: null, missing };
  return {
    missing: [],
    config: {
      accountId: value('R2_ACCOUNT_ID'),
      accessKeyId: value('R2_ACCESS_KEY_ID'),
      secretAccessKey: value('R2_SECRET_ACCESS_KEY'),
      bucket: value(MODELS_BUCKET_ENV),
      publicBaseUrl: '',
    },
  };
}

export type ModelBytes =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: 'not_configured'; missing: string[] }
  | { ok: false; reason: 'missing' | 'error' };

/** Lee el archivo del modelo con firma. Nunca devuelve una URL ni registra la clave. */
export async function fetchPrivateModel(env: Env, key: string): Promise<ModelBytes> {
  if (!isModelKey(key)) return { ok: false, reason: 'missing' };
  const { config, missing } = readModelsConfig(env);
  if (!config) return { ok: false, reason: 'not_configured', missing };
  try {
    const res = await getObject(config, key);
    if (res.status === 404) return { ok: false, reason: 'missing' };
    if (!res.ok) {
      console.error(`[Lalo lux] modelo: R2 respondió ${res.status}`);
      return { ok: false, reason: 'error' };
    }
    return { ok: true, bytes: new Uint8Array(await res.arrayBuffer()) };
  } catch {
    console.error('[Lalo lux] modelo: no se pudo leer del bucket privado');
    return { ok: false, reason: 'error' };
  }
}
