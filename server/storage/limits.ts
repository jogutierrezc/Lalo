/**
 * server/storage/limits.ts
 *
 * Reglas de las subidas de archivos: tipos admitidos, límites del plan y nombre
 * del objeto en el almacenamiento. Son funciones puras y sin dependencias, así
 * que las usa el servidor (que es quien decide) y también el navegador, para
 * avisar antes de empezar una subida que se va a rechazar.
 */

/** Tipos de archivo admitidos. Debe coincidir con MEDIA_ALLOWED_MIME de src/lib/cloudTypes.ts. */
export const UPLOAD_ALLOWED_MIME = [
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'video/webm',
  'video/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
] as const;

export interface PlanLimits {
  storage_limit_bytes: number;
  max_file_bytes: number;
  max_files: number;
}

export interface UsageNow {
  bytes: number;
  files: number;
}

export type UploadProblem = 'empty' | 'mime' | 'file_too_large' | 'too_many_files' | 'storage_full';

export type UploadCheck = { ok: true } | { ok: false; reason: UploadProblem; message: string };

const MB = 1024 * 1024;

function megabytes(bytes: number): string {
  const mb = bytes / MB;
  const text = mb >= 10 ? Math.round(mb).toString() : (Math.round(mb * 10) / 10).toString();
  return `${text.replace('.', ',')} MB`;
}

export function isAllowedMime(mime: string): boolean {
  return (UPLOAD_ALLOWED_MIME as readonly string[]).includes(mime.trim().toLowerCase());
}

export function kindOfMime(mime: string): 'image' | 'video' | 'audio' | null {
  const clean = mime.trim().toLowerCase();
  if (clean.startsWith('image/')) return 'image';
  if (clean.startsWith('video/')) return 'video';
  if (clean.startsWith('audio/')) return 'audio';
  return null;
}

/** ¿Cabe este archivo en el plan, con lo que la cuenta ya tiene subido? */
export function checkUpload(plan: PlanLimits, usage: UsageNow, file: { size: number; mime: string }): UploadCheck {
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, reason: 'empty', message: 'El archivo está vacío o no se pudo leer su tamaño.' };
  }
  if (!isAllowedMime(file.mime)) {
    return {
      ok: false,
      reason: 'mime',
      message: 'Ese tipo de archivo no se admite. Sirven imágenes PNG, GIF, WebP o SVG, vídeos MP4 o WebM y sonidos MP3, WAV u OGG.',
    };
  }
  if (file.size > plan.max_file_bytes) {
    return {
      ok: false,
      reason: 'file_too_large',
      message: `El archivo pesa ${megabytes(file.size)} y tu plan admite como máximo ${megabytes(plan.max_file_bytes)} por archivo.`,
    };
  }
  if (usage.files >= plan.max_files) {
    return {
      ok: false,
      reason: 'too_many_files',
      message: `Ya tienes ${usage.files} archivos, el máximo de tu plan. Borra alguno para subir otro.`,
    };
  }
  if (usage.bytes + file.size > plan.storage_limit_bytes) {
    const left = Math.max(0, plan.storage_limit_bytes - usage.bytes);
    return {
      ok: false,
      reason: 'storage_full',
      message: `El archivo pesa ${megabytes(file.size)} y solo te quedan ${megabytes(left)} libres. Borra archivos o pide un plan mayor.`,
    };
  }
  return { ok: true };
}

/** Nombre apto para una URL: sin acentos, sin espacios y sin símbolos raros. */
export function safeFileName(name: string): string {
  const clean = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(-80)
    .replace(/^[-.]+/, '');
  return clean || 'archivo';
}

/** Nombre del objeto: <carpeta del streamer>/<identificador>-<nombre limpio>. */
export function buildObjectKey(folder: string, id: string, name: string): string {
  return `${folder}/${id}-${safeFileName(name)}`;
}

const KEY_SHAPE = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

/** ¿Ese objeto está dentro de la carpeta de este streamer? */
export function keyBelongsTo(folder: string, key: string): boolean {
  return folder.length > 0 && KEY_SHAPE.test(key) && !key.includes('..') && key.startsWith(`${folder}/`);
}
