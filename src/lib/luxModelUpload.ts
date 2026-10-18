/**
 * src/lib/luxModelUpload.ts
 *
 * Subida del modelo 3D de un personaje desde la ficha del administrador, en cuatro
 * pasos: el navegador comprueba el archivo (.glb y hasta 50 MB); el servidor da una
 * autorización de subida válida 900 s (solo para el administrador); el navegador
 * envía el archivo a R2 con barra de progreso; y el servidor confirma la subida y
 * guarda la clave en el personaje.
 *
 * Todos los fallos de envío a R2 (sin respuesta, 403 por autorización caducada,
 * cualquier código distinto de 2xx) salen con el mismo mensaje, sin detalles técnicos.
 */

import { call, type ApiOutcome } from './integrationsApi';

/** Tamaño máximo: 50 MB. Igual que el del servidor (server/lux/characterModel.ts). */
export const MODEL_MAX_BYTES = 50 * 1024 * 1024;
/** Mensaje único para cualquier fallo al enviar el archivo. */
export const MODEL_UPLOAD_FAILED = 'No se pudo subir. Vuelve a intentarlo.';

export type ModelOrigin = 'riot' | 'propio';
export const MODEL_ORIGIN_LABEL: Record<ModelOrigin, string> = { riot: 'Riot Games', propio: 'Propio' };

const ENDPOINT = '/api/lux/character-model';
const LIBRARY_ENDPOINT = '/api/lux/model-library';

/** Comprueba el archivo antes de subirlo. Devuelve el mensaje para el administrador, o null si vale. */
export function checkModelFileForUpload(file: { name: string; size: number }): string | null {
  if (!/\.glb$/i.test(file.name.trim())) return 'El archivo no es un .glb.';
  if (file.size <= 0) return 'El archivo está vacío.';
  if (file.size > MODEL_MAX_BYTES) return 'El archivo pesa más de 50 MB.';
  return null;
}

/** Texto del archivo actual: nombre, tamaño y fecha. Los modelos subidos por terminal no tienen esos datos. */
export function describeModelFile(file: { name: string | null; bytes: number | null; uploadedAt: string | null } | null): string | null {
  if (!file) return null;
  const parts: string[] = [file.name ?? 'Modelo subido por terminal'];
  if (file.bytes !== null) parts.push(`${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(file.bytes / (1024 * 1024))} MB`);
  if (file.uploadedAt) {
    const date = new Date(file.uploadedAt);
    if (!Number.isNaN(date.getTime())) parts.push(`subido el ${date.toLocaleDateString('es-ES')}`);
  }
  return parts.join(' · ');
}

/** Envía el archivo a R2 con la autorización firmada. El progreso va de 0 a 1. */
export function sendToStorage(uploadUrl: string, headers: Record<string, string>, file: File, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(MODEL_UPLOAD_FAILED)));
    xhr.onerror = () => reject(new Error(MODEL_UPLOAD_FAILED));
    xhr.onabort = () => reject(new Error(MODEL_UPLOAD_FAILED));
    xhr.send(file);
  });
}

/** Sube el modelo de un personaje: pide autorización, envía el archivo y confirma. */
export async function uploadCharacterModel(
  characterId: string,
  file: File,
  origin: ModelOrigin,
  onProgress: (fraction: number) => void
): Promise<ApiOutcome<null>> {
  const problem = checkModelFileForUpload({ name: file.name, size: file.size });
  if (problem) return { ok: false, code: 'bad_file', message: problem, missing: [] };

  const asked = await call(ENDPOINT, 'POST', { op: 'presign', characterId, name: file.name, size: file.size });
  if (!asked.ok) return asked;
  const key = String(asked.data.key ?? '');
  const uploadUrl = String(asked.data.uploadUrl ?? '');
  const headers = (asked.data.headers ?? {}) as Record<string, string>;

  try {
    await sendToStorage(uploadUrl, headers, file, onProgress);
  } catch {
    return { ok: false, code: 'upload_failed', message: MODEL_UPLOAD_FAILED, missing: [] };
  }

  const done = await call(ENDPOINT, 'POST', { op: 'complete', characterId, key, name: file.name, origin });
  return done.ok ? { ok: true, data: null } : done;
}

/**
 * Sube un modelo propio a la biblioteca de su cuenta (creador). Mismo flujo que el del
 * administrador: autorización, envío directo a R2 y confirmación. Queda privado hasta
 * que el administrador lo apruebe; el servidor cuenta la cuota del plan.
 */
export async function uploadLibraryModel(file: File, onProgress: (fraction: number) => void): Promise<ApiOutcome<null>> {
  const problem = checkModelFileForUpload({ name: file.name, size: file.size });
  if (problem) return { ok: false, code: 'bad_file', message: problem, missing: [] };

  const asked = await call(LIBRARY_ENDPOINT, 'POST', { op: 'presign', name: file.name, size: file.size });
  if (!asked.ok) return asked;
  const id = String(asked.data.id ?? '');
  const key = String(asked.data.key ?? '');
  const uploadUrl = String(asked.data.uploadUrl ?? '');
  const headers = (asked.data.headers ?? {}) as Record<string, string>;

  try {
    await sendToStorage(uploadUrl, headers, file, onProgress);
  } catch {
    return { ok: false, code: 'upload_failed', message: MODEL_UPLOAD_FAILED, missing: [] };
  }

  const done = await call(LIBRARY_ENDPOINT, 'POST', { op: 'complete', id, key, name: file.name });
  return done.ok ? { ok: true, data: null } : done;
}

/** Quita el modelo del personaje. El servidor borra el archivo o lo deja anotado para reintentar. */
export function removeCharacterModel(characterId: string): Promise<ApiOutcome<Record<string, unknown>>> {
  return call(ENDPOINT, 'POST', { op: 'remove', characterId });
}
