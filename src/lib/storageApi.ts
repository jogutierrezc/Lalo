/**
 * src/lib/storageApi.ts
 *
 * Lado del navegador del almacenamiento de archivos (Cloudflare R2): llama a
 * las rutas del servidor de Lalo con la sesión de Supabase y sube el archivo
 * directo a R2 con la URL firmada que le dan.
 *
 * Las claves de R2 nunca llegan aquí. Lo único público es la dirección base de
 * lectura (VITE_R2_PUBLIC_BASE_URL), que es la que usan las capas de OBS.
 */

import { supabase } from './supabase';
import type { MediaFileRow } from './cloudTypes';

const publicBase = (import.meta.env.VITE_R2_PUBLIC_BASE_URL ?? '').trim().replace(/\/+$/, '');

/** Monta la dirección pública de un archivo. Función pura, para poder probarla. */
export function buildPublicUrl(base: string, objectKey: string): string | null {
  const clean = base.trim().replace(/\/+$/, '');
  if (!clean || !objectKey) return null;
  return `${clean}/${objectKey.split('/').map(encodeURIComponent).join('/')}`;
}

/** Dirección pública de un archivo de R2, o null si falta VITE_R2_PUBLIC_BASE_URL. */
export function mediaPublicUrl(objectKey: string | null | undefined): string | null {
  return objectKey ? buildPublicUrl(publicBase, objectKey) : null;
}

// ---------- Llamadas al servidor ----------

export class StorageApiError extends Error {
  code: string;
  status: number;
  /** Nombres de variables de entorno que faltan en el servidor, si ese es el problema. */
  missing: string[];
  constructor(message: string, code: string, status: number, missing: string[] = []) {
    super(message);
    this.code = code;
    this.status = status;
    this.missing = missing;
  }
}

async function call<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  if (!supabase) throw new StorageApiError('La nube no está configurada en este despliegue.', 'cloud_off', 0);
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new StorageApiError('Hay que iniciar sesión.', 'no_session', 401);

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new StorageApiError('No se pudo conectar con el servidor de Lalo. Revisa tu conexión.', 'offline', 0);
  }

  let parsed: unknown = null;
  if ((res.headers.get('content-type') ?? '').includes('application/json')) {
    parsed = await res.json().catch(() => null);
  }
  if (!parsed || typeof parsed !== 'object') {
    // Sin el servidor en marcha, quien responde es la propia página, no una ruta de /api
    throw new StorageApiError(
      'El servidor de Lalo no respondió a esta ruta. En local hay que arrancar con «npm run dev:all».',
      'no_server',
      res.status
    );
  }
  if (!res.ok) {
    const info = parsed as { error?: string; code?: string; missing?: unknown };
    throw new StorageApiError(
      info.error || `El servidor respondió con el código ${res.status}.`,
      info.code || 'error',
      res.status,
      Array.isArray(info.missing) ? info.missing.filter((name): name is string => typeof name === 'string') : []
    );
  }
  return parsed as T;
}

// ---------- Administración ----------

export interface StorageLastTest {
  at: string;
  ok: boolean;
  step: string | null;
  detail: string | null;
}

export interface StorageStatus {
  configured: boolean;
  /** Nombres de las variables de R2 que faltan en el servidor. */
  missing: string[];
  /** false si falta ejecutar la migración 0005 en Supabase. */
  migrated: boolean;
  bucketName: string | null;
  publicBaseUrl: string | null;
  bucket: { answers: boolean; detail: string } | null;
  capacityBytes: number;
  usedBytes: number;
  fileCount: number;
  lastTest: StorageLastTest | null;
}

export type StorageTestStepId = 'subir' | 'leer' | 'permiso' | 'borrar';

export interface StorageTestResult {
  ok: boolean;
  at: string;
  steps: { step: StorageTestStepId; ok: boolean; detail: string }[];
  saved: boolean;
  saveError: string | null;
}

export const fetchStorageStatus = () => call<StorageStatus>('/api/storage/status', 'GET');
export const runStorageTest = () => call<StorageTestResult>('/api/storage/test', 'POST', {});

// ---------- Archivos del streamer ----------

interface UploadSession {
  key: string;
  uploadUrl: string;
  expiresIn: number;
  headers: Record<string, string>;
}

export const deleteMediaFile = (id: string) => call<{ deleted: string }>('/api/media/delete', 'POST', { id });

/** Sube el cuerpo a la URL firmada. Usa XMLHttpRequest porque fetch no informa del progreso de subida. */
function putWithProgress(
  session: UploadSession,
  file: File,
  onProgress: (loaded: number, total: number) => void,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', session.uploadUrl);
    for (const [name, value] of Object.entries(session.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else if (xhr.status === 403) {
        reject(new StorageApiError('El almacenamiento rechazó la subida (403). El permiso caducó o el archivo cambió. Vuelve a intentarlo.', 'upload_403', 403));
      } else {
        reject(new StorageApiError(`El almacenamiento respondió con el código ${xhr.status}.`, 'upload_failed', xhr.status));
      }
    };
    xhr.onerror = () =>
      reject(
        new StorageApiError(
          'La subida no llegó al almacenamiento. Puede ser la conexión, o que el almacenamiento no acepte subidas desde esta dirección: avisa al administrador.',
          'upload_blocked',
          0
        )
      );
    xhr.onabort = () => reject(new StorageApiError('Subida cancelada.', 'cancelled', 0));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    if (signal.aborted) {
      xhr.abort();
      return;
    }
    xhr.send(file);
  });
}

/**
 * Subida completa: pide permiso al servidor (que comprueba el plan), sube el
 * archivo directo al almacenamiento y pide al servidor que lo registre.
 */
export async function uploadMediaFile(
  file: File,
  onProgress: (loaded: number, total: number) => void,
  signal: AbortSignal
): Promise<MediaFileRow | null> {
  const session = await call<UploadSession>('/api/media/upload-session', 'POST', {
    name: file.name,
    mime: file.type,
    size: file.size,
  });
  await putWithProgress(session, file, onProgress, signal);
  const done = await call<{ file: MediaFileRow | null }>('/api/media/complete', 'POST', { key: session.key, name: file.name });
  return done.file;
}
