/**
 * server/voices/rules.ts
 *
 * Reglas de las voces del catálogo, compartidas por el navegador (la sección
 * «Voces» de la consola) y por el servidor (server/voices/handlers.ts), para que
 * los dos validen lo mismo. Son funciones puras: no tocan la red, ni el
 * navegador, ni Node.
 *
 * Datos comprobados en la documentación (octubre de 2026):
 *   - Fish Audio acepta muestras .wav, .mp3, .m4a y .opus, y recomienda al menos
 *     10 segundos por clip (docs.fish.audio/features/voice-cloning). No nombra
 *     webm, que es lo que graba el navegador: por eso la grabación se convierte
 *     a WAV antes de enviarla.
 *   - Una función de Vercel no acepta cuerpos de más de 4,5 MB
 *     (vercel.com/docs/functions/limitations, «Request body size»).
 */

// ---------- Límites ----------

export const VOICE_MAX_FILES = 5;
/** Tope de un envío. Queda por debajo de los 4,5 MB que admite una función de Vercel. */
export const VOICE_MAX_TOTAL_BYTES = 4 * 1024 * 1024;
export const VOICE_MAX_TOTAL_LABEL = '4 MB';
export const RECORD_MIN_SECONDS = 15;
export const RECORD_MAX_SECONDS = 60;
/** Mono a 24 kHz y 16 bits: un minuto pesa 2,9 MB y cabe en un envío. */
export const RECORD_SAMPLE_RATE = 24000;
export const VOICE_NAME_MAX = 18;
export const VOICE_DESCRIPTION_MAX = 70;
export const VOICE_PERMISSION_MAX = 60;

export type VoiceOrigin = 'initial' | 'recorded' | 'uploaded';
export type VoiceOwner = 'own' | 'other' | 'unknown';

const MB = 1024 * 1024;
const megas = (bytes: number) => `${(bytes / MB).toLocaleString('es', { maximumFractionDigits: 1 })} MB`;

// ---------- Archivos ----------

const ALLOWED_EXTENSIONS = ['mp3', 'wav', 'm4a'];

export interface AudioFileInfo {
  name: string;
  type: string;
  size: number;
}

export interface CheckedFile extends AudioFileInfo {
  /** Por qué no vale, o null si vale. */
  problem: string | null;
}

export interface FilesCheck {
  /** Los archivos que se usarían (como mucho cinco), cada uno con su problema. */
  files: CheckedFile[];
  /** Cuántos se dejaron fuera por pasar de cinco. */
  ignored: number;
  totalBytes: number;
  /** Problema del conjunto (por ahora, el peso total), o null. */
  problem: string | null;
  ok: boolean;
}

const extensionOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');

/** ¿Es un audio de los que admite Fish Audio? Se mira la extensión y, si el navegador lo dice, el tipo. */
export function isAllowedVoiceFile(file: Pick<AudioFileInfo, 'name' | 'type'>): boolean {
  if (!ALLOWED_EXTENSIONS.includes(extensionOf(file.name))) return false;
  const type = file.type.trim().toLowerCase();
  return type === '' || type.startsWith('audio/') || type === 'video/mp4';
}

export function checkVoiceFiles(all: AudioFileInfo[]): FilesCheck {
  const used = all.slice(0, VOICE_MAX_FILES);
  const files: CheckedFile[] = used.map((file) => {
    let problem: string | null = null;
    if (!isAllowedVoiceFile(file)) problem = 'No vale: tiene que ser MP3, WAV o M4A.';
    else if (file.size <= 0) problem = 'No vale: el archivo está vacío.';
    else if (file.size > VOICE_MAX_TOTAL_BYTES) problem = `No vale: pesa ${megas(file.size)} y el máximo es ${VOICE_MAX_TOTAL_LABEL}.`;
    return { name: file.name, type: file.type, size: file.size, problem };
  });
  const totalBytes = files.reduce((sum, file) => sum + Math.max(0, file.size), 0);
  const allValid = files.every((file) => file.problem === null);
  const problem =
    allValid && totalBytes > VOICE_MAX_TOTAL_BYTES
      ? `Entre todos pesan ${megas(totalBytes)} y el máximo es ${VOICE_MAX_TOTAL_LABEL} en total. Quita alguno o usa audios más cortos.`
      : null;
  return {
    files,
    ignored: Math.max(0, all.length - VOICE_MAX_FILES),
    totalBytes,
    problem,
    ok: files.length > 0 && allValid && problem === null,
  };
}

// ---------- Grabación ----------

/** Por qué no vale una grabación de esa duración, o null si vale. */
export function recordingProblem(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'La grabación salió vacía. Repítela.';
  if (seconds < RECORD_MIN_SECONDS) {
    return `Solo ${formatClock(seconds)}: hacen falta al menos ${RECORD_MIN_SECONDS} segundos. Repite la grabación.`;
  }
  // Medio segundo de margen: la grabación se corta sola al llegar al máximo
  if (seconds > RECORD_MAX_SECONDS + 0.5) return `Dura más de ${RECORD_MAX_SECONDS} segundos. Repite la grabación.`;
  return null;
}

/** 75 → «1:15» */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

// ---------- Nombre y permiso ----------

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Por qué no vale el nombre, o null si vale. No distingue mayúsculas al buscar repetidos. */
export function voiceNameProblem(name: string, existing: string[]): string | null {
  const clean = name.trim();
  if (!clean) return 'Falta el nombre.';
  if (clean.length > VOICE_NAME_MAX) return `El nombre no puede pasar de ${VOICE_NAME_MAX} letras.`;
  if (existing.some((other) => sameName(other, clean))) return 'Ya hay una voz con ese nombre.';
  return null;
}

/** Por qué no vale el paso del permiso, o null si vale. Es obligatorio: lo pide la política de voces. */
export function permissionProblem(owner: string, permissionBy: string, confirmed: boolean): string | null {
  if (owner !== 'own' && owner !== 'other') return 'Falta indicar de quién es la voz.';
  if (owner === 'other' && permissionBy.trim().length < 2) return 'Falta indicar quién dio el permiso.';
  if (permissionBy.trim().length > VOICE_PERMISSION_MAX) return `El nombre de quien dio el permiso no puede pasar de ${VOICE_PERMISSION_MAX} letras.`;
  if (!confirmed) return 'Falta confirmar que tienes derecho a usar esta voz.';
  return null;
}

export interface CreateDraft {
  audioReady: boolean;
  name: string;
  existingNames: string[];
  owner: VoiceOwner;
  permissionBy: string;
  confirmed: boolean;
}

export interface CreateChecklist {
  /** Lo que falta, con las palabras que se enseñan. Vacío si se puede crear. */
  missing: string[];
  canCreate: boolean;
  message: string;
}

export function createChecklist(draft: CreateDraft): CreateChecklist {
  const missing: string[] = [];
  if (!draft.audioReady) missing.push('el audio');
  if (voiceNameProblem(draft.name, draft.existingNames) !== null) missing.push('un nombre libre');
  if (draft.owner === 'other' && draft.permissionBy.trim().length < 2) missing.push('quién dio el permiso');
  if (!draft.confirmed) missing.push('la confirmación');
  return {
    missing,
    canCreate: missing.length === 0,
    message: missing.length === 0 ? 'Todo listo.' : `Falta ${missing.join(', ')}.`,
  };
}

// ---------- Envío al servidor ----------
// El navegador manda un solo cuerpo binario (application/octet-stream), que es
// lo que Vercel y Express entregan tal cual, sin dependencias para leer
// formularios: «LVOZ», el largo de la ficha, la ficha en JSON y los audios
// seguidos, en el orden y con los tamaños que dice la ficha.

export interface VoiceEnvelopeMeta {
  name: string;
  description: string;
  origin: 'recorded' | 'uploaded';
  owner: 'own' | 'other';
  permissionBy: string;
  confirmed: boolean;
  files: AudioFileInfo[];
}

const MAGIC = [0x4c, 0x56, 0x4f, 0x5a]; // LVOZ
const HEADER_BYTES = 8;
const META_MAX_BYTES = 16 * 1024;

export function encodeVoiceEnvelope(meta: VoiceEnvelopeMeta, parts: Uint8Array[]): Uint8Array {
  const files = parts.map((part, index) => ({
    name: meta.files[index]?.name ?? `audio-${index + 1}`,
    type: meta.files[index]?.type ?? '',
    size: part.byteLength,
  }));
  const json = new TextEncoder().encode(JSON.stringify({ ...meta, files }));
  const total = HEADER_BYTES + json.byteLength + parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(4, json.byteLength);
  out.set(json, HEADER_BYTES);
  let offset = HEADER_BYTES + json.byteLength;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

/** Lee un envío. Devuelve null si no tiene la forma esperada o los tamaños no cuadran. */
export function decodeVoiceEnvelope(bytes: Uint8Array): { meta: VoiceEnvelopeMeta; parts: Uint8Array[] } | null {
  if (bytes.byteLength < HEADER_BYTES || MAGIC.some((value, index) => bytes[index] !== value)) return null;
  const jsonLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4);
  if (jsonLength <= 0 || jsonLength > META_MAX_BYTES || HEADER_BYTES + jsonLength > bytes.byteLength) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes.subarray(HEADER_BYTES, HEADER_BYTES + jsonLength)));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  if (!Array.isArray(data.files)) return null;

  const files: AudioFileInfo[] = [];
  for (const entry of data.files as unknown[]) {
    if (!entry || typeof entry !== 'object') return null;
    const file = entry as Record<string, unknown>;
    if (typeof file.size !== 'number' || !Number.isInteger(file.size) || file.size < 0) return null;
    files.push({ name: text(file.name).slice(0, 200), type: text(file.type).slice(0, 100), size: file.size });
  }

  const parts: Uint8Array[] = [];
  let offset = HEADER_BYTES + jsonLength;
  for (const file of files) {
    if (offset + file.size > bytes.byteLength) return null;
    parts.push(bytes.subarray(offset, offset + file.size));
    offset += file.size;
  }
  if (offset !== bytes.byteLength) return null;

  return {
    meta: {
      name: text(data.name),
      description: text(data.description),
      origin: data.origin === 'recorded' ? 'recorded' : 'uploaded',
      owner: data.owner === 'other' ? 'other' : 'own',
      permissionBy: text(data.permissionBy),
      confirmed: data.confirmed === true,
      files,
    },
    parts,
  };
}

// ---------- WAV ----------

/** WAV de un canal, PCM de 16 bits: cabecera de 44 bytes y las muestras. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // tamaño del bloque fmt
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // un canal
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes por segundo
  view.setUint16(32, 2, true); // bytes por muestra
  view.setUint16(34, 16, true); // bits por muestra
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff), true);
  }
  return out;
}

// ---------- Respuestas de Fish Audio ----------

/** Texto del error que manda Fish Audio: {"status", "message", "reason"}. */
export function fishErrorDetail(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === 'object') {
      const data = parsed as Record<string, unknown>;
      const parts = [data.message, data.reason, data.detail].filter(
        (value): value is string => typeof value === 'string' && value.trim() !== ''
      );
      if (parts.length > 0) return parts.join('. ').slice(0, 300);
    }
  } catch {
    // No es JSON: se usa el texto tal cual
  }
  return body.trim().slice(0, 300);
}

/** Explica en español por qué Fish Audio no hizo lo que se le pidió. */
export function fishProblem(action: 'crear' | 'borrar', status: number, body: string): string {
  const detail = fishErrorDetail(body);
  const said = detail ? ` Fish Audio dijo: «${detail}».` : '';
  const what = action === 'crear' ? 'crear la voz' : 'borrar la voz';
  if (status === 401) {
    return action === 'crear'
      ? `Fish Audio rechazó la clave del servidor (401). Revisa FISH_AUDIO_API_KEY.${said}`
      : `Fish Audio no dejó borrar el modelo (401): la clave del servidor no vale o el modelo no es de esa cuenta.${said}`;
  }
  if (status === 402) return `La cuenta de Fish Audio no tiene saldo o plan para ${what} (402).${said}`;
  if (status === 403) return `Fish Audio no permite ${what} con esta clave (403).${said}`;
  if (status === 404) return `Fish Audio no encontró el modelo (404).${said}`;
  if (status === 413) return `Fish Audio rechazó el audio por pesar demasiado (413).${said}`;
  if (status === 400 || status === 422) return `Fish Audio no aceptó los datos o el audio (${status}).${said}`;
  if (status === 429) return `Fish Audio pide esperar: demasiadas peticiones seguidas (429). Prueba dentro de un minuto.${said}`;
  if (status >= 500) return `Fish Audio está saturado o caído (${status}). Prueba dentro de unos minutos.${said}`;
  return `Fish Audio respondió con el código ${status} al ${what}.${said}`;
}

/**
 * Qué significa la respuesta de Fish Audio a un borrado:
 *   - deleted: el modelo se borró.
 *   - not_found / not_owned: el modelo no existe o no es de esta clave. Se quita
 *     solo del catálogo de Lalo.
 *   - failed: otro fallo (incluido el 401, que no distingue entre clave mala y
 *     modelo ajeno). No se toca el catálogo sin que el administrador lo decida.
 */
export type FishDeleteOutcome = 'deleted' | 'not_found' | 'not_owned' | 'failed';

export function fishDeleteOutcome(status: number): FishDeleteOutcome {
  if (status >= 200 && status < 300) return 'deleted';
  if (status === 404) return 'not_found';
  if (status === 403) return 'not_owned';
  return 'failed';
}
