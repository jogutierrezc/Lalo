/**
 * src/lib/mediaRef.ts
 *
 * Referencias a archivos (sonido, vídeo, imagen) guardadas en los ajustes de
 * las capas, y cómo convertirlas en una dirección que el navegador de OBS pueda
 * abrir. Lo usan las recompensas y cualquier capa que guarde un archivo subido.
 *
 * Una referencia puede ser:
 *   - una dirección pública (https://...), que es lo que se guarda al subir a la nube;
 *   - `r2:<clave del objeto>`, que se resuelve con VITE_R2_PUBLIC_BASE_URL;
 *   - un archivo incrustado (data:) o temporal (blob:), que solo existe en este navegador.
 */

import type { MediaFileRow, MediaKind } from './cloudTypes';
import { MEDIA_ALLOWED_MIME } from './cloudTypes';
import { StorageApiError, buildPublicUrl, deleteMediaFile, mediaPublicUrl, uploadMediaFile } from './storageApi';

export interface MediaRef {
  /** Dirección guardada: pública, `r2:clave`, data: o blob:. */
  url?: string | null;
  /** Clave del objeto en R2, si se conoce. Manda sobre `url` cuando hay dirección base. */
  objectKey?: string | null;
}

const R2_PREFIX = 'r2:';

/**
 * Dirección reproducible de una referencia, o null si no hay nada que abrir.
 * `publicBase` solo se pasa en las pruebas; en la app sale de VITE_R2_PUBLIC_BASE_URL.
 */
export function resolveMediaUrl(ref: string | MediaRef | null | undefined, publicBase?: string): string | null {
  const byKey = (key: string) => (publicBase === undefined ? mediaPublicUrl(key) : buildPublicUrl(publicBase, key));
  if (!ref) return null;
  if (typeof ref !== 'string') {
    if (ref.objectKey) {
      const fromKey = byKey(ref.objectKey);
      if (fromKey) return fromKey;
    }
    return resolveMediaUrl(ref.url ?? null, publicBase);
  }
  const value = ref.trim();
  if (!value) return null;
  if (value.startsWith(R2_PREFIX)) return byKey(value.slice(R2_PREFIX.length));
  if (/^(https?:|data:|blob:)/i.test(value)) return value;
  // Ruta del propio sitio (por ejemplo /media/intro.webm)
  if (value.startsWith('/')) return value;
  return null;
}

/** ¿Vive solo en este navegador? Un archivo así no llega a OBS ni a la nube. */
export function isLocalOnlyMedia(url: string | null | undefined): boolean {
  if (!url) return false;
  return /^blob:/i.test(url) || (/^data:/i.test(url) && url.length > 2048);
}

/** Tipo de archivo por su MIME, o null si la nube no lo admite. */
export function mediaKindOfMime(mime: string): MediaKind | null {
  const clean = mime.trim().toLowerCase();
  if (!(MEDIA_ALLOWED_MIME as readonly string[]).includes(clean)) return null;
  return clean.split('/')[0] as MediaKind;
}

/** Convierte un archivo incrustado (data:) en un File para poder subirlo. */
export function dataUrlToFile(dataUrl: string, name: string): File | null {
  const match = /^data:([^;,]+)?((?:;[^;,]+)*?)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const mime = (match[1] || 'application/octet-stream').toLowerCase();
  try {
    const bytes = match[3]
      ? Uint8Array.from(atob(match[4]), (c) => c.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(match[4]));
    return new File([bytes], name || 'archivo', { type: mime });
  } catch {
    return null;
  }
}

export interface UploadedMedia {
  url: string;
  mediaId: string;
  name: string;
  kind: MediaKind;
}

/**
 * Sube un archivo al almacén de la cuenta (permiso del servidor, límites del
 * plan y subida directa a R2) y devuelve su dirección pública, que es lo que se
 * guarda en los ajustes para que OBS lo cargue.
 */
export async function uploadMediaForLayer(
  file: File,
  onProgress: (loaded: number, total: number) => void,
  signal: AbortSignal
): Promise<UploadedMedia> {
  const row: MediaFileRow | null = await uploadMediaFile(file, onProgress, signal);
  if (!row) throw new StorageApiError('El archivo se subió, pero el servidor no devolvió su registro.', 'no_row', 0);
  const url = resolveMediaUrl({ objectKey: row.object_key });
  if (!url) {
    // Sin dirección pública el archivo no sirve a ninguna capa: no se deja ocupando espacio
    await releaseMedia(row.id);
    throw new StorageApiError(
      'A este despliegue le falta VITE_R2_PUBLIC_BASE_URL y no se puede montar la dirección pública del archivo. No se guardó nada.',
      'no_public_base',
      0
    );
  }
  return { url, mediaId: row.id, name: row.name || file.name, kind: row.kind };
}

/** Libera un archivo del almacén. Si falla, no interrumpe: el archivo sigue visible en «Mi cuenta». */
export async function releaseMedia(mediaId: string | null | undefined): Promise<boolean> {
  if (!mediaId) return false;
  try {
    await deleteMediaFile(mediaId);
    return true;
  } catch {
    return false;
  }
}

/** Errores de subida tras los que tiene sentido guardar el archivo solo en este navegador. */
export function canFallBackToLocal(err: unknown): boolean {
  return (
    err instanceof StorageApiError &&
    ['cloud_off', 'no_session', 'no_server', 'storage_not_configured', 'server_not_configured', 'not_active', 'offline'].includes(err.code)
  );
}
