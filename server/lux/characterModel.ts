/**
 * server/lux/characterModel.ts
 *
 * Subida del modelo 3D de un personaje desde el panel del administrador (Mi AI).
 * El navegador sube el GLB directo al bucket privado de R2 con una URL firmada que
 * caduca a los 900 s; el servidor solo da esa autorización y, al confirmar, mira
 * en R2 el tamaño real antes de guardar la clave en la fila.
 *
 * Aquí viven las reglas puras (tipo, tamaño, clave aleatoria, reintento de borrados)
 * y el acceso a R2 detrás de una interfaz, para que las pruebas usen una falsa.
 * Los mensajes que ve el administrador son los del diseño aprobado: sin detalles técnicos.
 */

import { randomBytes } from 'node:crypto';
import { deleteObject, headObject, presignPut, type Env } from '../storage/r2.js';
import { readModelsConfig, isModelKey } from './mascotaModel.js';

/** Tamaño máximo de un modelo: 50 MB. */
export const MODEL_MAX_BYTES = 50 * 1024 * 1024;
/** Tipo que se firma para la subida. */
export const MODEL_MIME = 'model/gltf-binary';
/** Segundos que vale la autorización de subida (15 minutos). */
export const MODEL_UPLOAD_SECONDS = 900;

/** Mensajes para el administrador. Sin nombres de variables ni códigos de R2. */
export const MODEL_MESSAGES = {
  notGlb: 'El archivo no es un .glb.',
  tooBig: 'El archivo pesa más de 50 MB.',
  empty: 'El archivo está vacío.',
  origin: 'Elige el origen del modelo: Riot Games o propio.',
  upload: 'No se pudo subir. Vuelve a intentarlo.',
  notConfigured: 'El almacenamiento de modelos no está configurado',
  notRequested: 'Esa subida no se pidió para este personaje. Vuelve a subirlo.',
} as const;

/** Comprueba el nombre y el tamaño de un archivo antes de subirlo. Vale para el servidor y para el navegador. */
export function checkModelFile(input: { name: string; size: number }): { ok: true } | { ok: false; message: string } {
  if (!/\.glb$/i.test(input.name.trim())) return { ok: false, message: MODEL_MESSAGES.notGlb };
  if (!Number.isInteger(input.size) || input.size <= 0) return { ok: false, message: MODEL_MESSAGES.empty };
  if (input.size > MODEL_MAX_BYTES) return { ok: false, message: MODEL_MESSAGES.tooBig };
  return { ok: true };
}

/** Clave nueva del objeto: prefijo fijo y 32 hex al azar. Nunca viene del navegador. */
export function newModelKey(): string {
  return `lux-models/${randomBytes(16).toString('hex')}.glb`;
}

/** Acceso a R2 del modelo. Las pruebas pasan una implementación falsa. */
export interface ModelFiles {
  /** URL firmada para subir el archivo con PUT, o null si el bucket privado no está configurado. */
  uploadUrl(env: Env, key: string, size: number, now?: Date): string | null;
  /** Tamaño del objeto; 'missing' si no existe; 'error' si R2 no responde; 'not_configured' sin bucket. */
  head(env: Env, key: string): Promise<{ bytes: number } | 'missing' | 'error' | 'not_configured'>;
  /** true si el objeto ya no está (borrado, o no existía). false si no se pudo borrar. */
  remove(env: Env, key: string): Promise<boolean>;
}

/** Implementación real: el bucket privado de R2 (R2_MODELS_BUCKET). */
export const defaultModelFiles: ModelFiles = {
  uploadUrl(env, key, size, now = new Date()) {
    if (!isModelKey(key)) return null;
    const { config } = readModelsConfig(env);
    if (!config) return null;
    return presignPut(config, { key, mime: MODEL_MIME, size, now, expiresSeconds: MODEL_UPLOAD_SECONDS });
  },
  async head(env, key) {
    const { config } = readModelsConfig(env);
    if (!config) return 'not_configured';
    try {
      const res = await headObject(config, key);
      if (res.status === 404) return 'missing';
      if (!res.ok) return 'error';
      const bytes = Number(res.headers.get('content-length') ?? NaN);
      return Number.isFinite(bytes) ? { bytes } : 'error';
    } catch {
      return 'error';
    }
  },
  async remove(env, key) {
    if (!isModelKey(key)) return true;
    const { config } = readModelsConfig(env);
    if (!config) return false;
    try {
      const res = await deleteObject(config, key);
      return res.ok || res.status === 404;
    } catch {
      return false;
    }
  },
};

/**
 * Reintenta borrar los archivos viejos pendientes. Devuelve los que siguen sin
 * borrarse: esos se guardan otra vez en la fila para el siguiente intento.
 */
export async function retryStaleKeys(files: ModelFiles, env: Env, keys: readonly string[]): Promise<string[]> {
  const left: string[] = [];
  for (const key of new Set(keys)) {
    if (!isModelKey(key)) continue;
    if (!(await files.remove(env, key))) left.push(key);
  }
  return left;
}
