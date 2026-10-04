/**
 * src/lib/voicesCloud.ts
 *
 * Lado del navegador del catálogo de voces: leerlo de Supabase (con las cinco
 * voces fijas como respaldo), las acciones del administrador y las llamadas al
 * servidor de Lalo para crear y eliminar, que son las que tocan Fish Audio.
 */

import { isCloudEnabled, supabase } from './supabase';
import { rpc } from './cloud';
import type { AdminVoiceRow, PublicVoiceRow, VoiceState } from './cloudTypes';
import { pickCatalogue, presetCatalogue, resolveSavedVoice, type VoiceCatalogue } from './voicesLogic';
import { encodeVoiceEnvelope, type VoiceEnvelopeMeta } from '../../server/voices/rules';

// ---------- Catálogo del streamer ----------

// Las columnas se piden por su nombre: la tabla no deja leer las del permiso (migración 0009)
const PUBLIC_COLUMNS = 'id, name, description, reference_id, visible, is_default, origin, created_at';

let cached: VoiceCatalogue | null = null;
let pending: Promise<VoiceCatalogue> | null = null;

/** El último catálogo leído de la nube en esta pestaña, si lo hay. */
export const cachedVoiceCatalogue = (): VoiceCatalogue | null => cached;

async function readCatalogue(): Promise<VoiceCatalogue> {
  if (!supabase) return presetCatalogue();
  try {
    const { data: auth } = await supabase.auth.getSession();
    // Sin sesión (una capa de OBS, por ejemplo) no se pregunta: la tabla solo la lee quien ha entrado
    if (!auth.session) return presetCatalogue();
    const { data, error } = await supabase.from('voices').select(PUBLIC_COLUMNS).eq('visible', true);
    const catalogue = pickCatalogue({ cloudEnabled: isCloudEnabled, rows: error ? null : ((data as PublicVoiceRow[]) ?? null) });
    if (catalogue.source === 'nube') cached = catalogue;
    return catalogue;
  } catch {
    return presetCatalogue();
  }
}

/**
 * Catálogo para elegir voz. Nunca falla: con la nube apagada, sin la tabla o
 * sin conexión devuelve las cinco voces fijas.
 */
export function loadVoiceCatalogue(force = false): Promise<VoiceCatalogue> {
  if (cached && !force) return Promise.resolve(cached);
  if (!pending) {
    pending = readCatalogue().finally(() => {
      pending = null;
    });
  }
  return pending;
}

/** Qué dice la nube del id guardado. null si no se pudo preguntar. */
export async function fetchVoiceState(referenceId: string): Promise<VoiceState | null> {
  try {
    const state = await rpc('voice_state', { p_reference_id: referenceId });
    return state === 'visible' || state === 'retired' || state === 'unknown' ? state : null;
  } catch {
    return null;
  }
}

/** La voz guardada, comprobada contra el catálogo: dice si hay que pasar a la voz por defecto. */
export async function checkSavedVoice(saved: string) {
  const catalogue = await loadVoiceCatalogue();
  const inCatalogue = catalogue.voices.some((voice) => voice.id === saved.trim());
  const state = catalogue.source === 'nube' && !inCatalogue && saved.trim() ? await fetchVoiceState(saved.trim()) : null;
  return { catalogue, resolved: resolveSavedVoice(saved, catalogue, state) };
}

/** El id con el que hay que hablar ahora mismo: el guardado, o la voz por defecto si aquel ya no está. */
export async function voiceForSpeaking(saved: string): Promise<string> {
  try {
    return (await checkSavedVoice(saved)).resolved.id;
  } catch {
    return saved;
  }
}

// ---------- Administración ----------

export const fetchAdminVoices = (): Promise<AdminVoiceRow[]> => rpc('admin_voices', {});

export async function setVoiceVisible(id: string, visible: boolean): Promise<void> {
  await rpc('admin_set_voice_visible', { p_voice: id, p_visible: visible });
}

export async function setDefaultVoice(id: string): Promise<void> {
  await rpc('admin_set_default_voice', { p_voice: id });
}

/** Traduce los motivos que devuelven las RPC de voces. */
export function voiceRpcProblem(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  if (message.includes('default_voice_cannot_be_hidden')) return 'La voz por defecto no se puede ocultar.';
  if (message.includes('voice_not_found')) return 'Esa voz ya no está en el catálogo. Vuelve a cargar la página.';
  if (message.includes('not_admin')) return 'Solo el administrador puede hacer esto.';
  return `No se pudo guardar el cambio: ${message || 'error desconocido'}`;
}

// ---------- Servidor de Lalo: crear y eliminar ----------

export class VoiceApiError extends Error {
  code: string;
  status: number;
  /** true si el servidor ofrece quitar la voz solo del catálogo, sin tocar Fish Audio. */
  canCatalogOnly: boolean;
  constructor(message: string, code: string, status: number, canCatalogOnly = false) {
    super(message);
    this.code = code;
    this.status = status;
    this.canCatalogOnly = canCatalogOnly;
  }
}

const NO_SERVER = 'El servidor de Lalo no respondió a esta ruta. En local hay que arrancar con «npm run dev:all».';

async function sessionToken(): Promise<string> {
  if (!supabase) throw new VoiceApiError('La nube no está configurada en este despliegue.', 'cloud_off', 0);
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new VoiceApiError('Hay que iniciar sesión.', 'no_session', 401);
  return token;
}

function errorFrom(status: number, parsed: unknown): VoiceApiError {
  if (!parsed || typeof parsed !== 'object') {
    // Vercel corta los cuerpos de más de 4,5 MB antes de que lleguen a la función
    if (status === 413) return new VoiceApiError('El servidor rechazó el envío por pesar demasiado (413).', 'too_large', 413);
    return new VoiceApiError(NO_SERVER, 'no_server', status);
  }
  const info = parsed as { error?: string; code?: string; canCatalogOnly?: unknown };
  return new VoiceApiError(
    info.error || `El servidor respondió con el código ${status}.`,
    info.code || 'error',
    status,
    info.canCatalogOnly === true
  );
}

export interface CreateVoiceResult {
  voice: AdminVoiceRow;
  /** Estado del modelo en Fish Audio al terminar de crearlo. */
  state: string;
  /** false si Fish Audio todavía la está preparando. */
  ready: boolean;
}

/**
 * Manda los audios y la ficha al servidor, que crea el modelo en Fish Audio y
 * guarda la voz. `onUploaded` avisa cuando el audio ya salió del navegador.
 * Usa XMLHttpRequest porque fetch no informa de cuándo termina la subida.
 */
export async function createVoiceRequest(
  meta: VoiceEnvelopeMeta,
  parts: Uint8Array[],
  onUploaded: () => void
): Promise<CreateVoiceResult> {
  const token = await sessionToken();
  const body = encodeVoiceEnvelope(meta, parts);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/voices/create');
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onload = onUploaded;
    xhr.onload = () => {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(xhr.responseText);
      } catch {
        // Lo trata errorFrom: quien respondió no fue una ruta de /api
      }
      if (xhr.status >= 200 && xhr.status < 300 && parsed && typeof parsed === 'object' && 'voice' in parsed) {
        resolve(parsed as CreateVoiceResult);
      } else {
        reject(errorFrom(xhr.status, xhr.status >= 200 && xhr.status < 300 ? null : parsed));
      }
    };
    xhr.onerror = () =>
      reject(new VoiceApiError('No se pudo conectar con el servidor de Lalo. Revisa tu conexión.', 'offline', 0));
    xhr.send(new Blob([body as unknown as BlobPart], { type: 'application/octet-stream' }));
  });
}

export interface DeleteVoiceResult {
  deleted: string;
  fish: 'deleted' | 'not_found' | 'not_owned' | 'skipped';
  /** Aviso para el administrador cuando el modelo no se borró en Fish Audio. */
  notice: string | null;
}

export async function deleteVoiceRequest(id: string, catalogOnly = false): Promise<DeleteVoiceResult> {
  const token = await sessionToken();
  let res: Response;
  try {
    res = await fetch('/api/voices/delete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, catalogOnly }),
    });
  } catch {
    throw new VoiceApiError('No se pudo conectar con el servidor de Lalo. Revisa tu conexión.', 'offline', 0);
  }
  let parsed: unknown = null;
  if ((res.headers.get('content-type') ?? '').includes('application/json')) parsed = await res.json().catch(() => null);
  if (!res.ok || !parsed || typeof parsed !== 'object') throw errorFrom(res.status, res.ok ? null : parsed);
  return parsed as DeleteVoiceResult;
}

// ---------- Probar una voz ----------

export interface VoiceSample {
  url: string;
  /** true si Fish Audio no reconoció la voz y el servidor respondió con la voz base. */
  fallback: boolean;
}

/** Sintetiza un texto con una voz por el servicio de voz de la app (/api/tts). */
export async function synthesizeSample(text: string, referenceId: string, signal: AbortSignal): Promise<VoiceSample> {
  const res = await fetch('/api/tts', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, reference_id: referenceId, model: 's2.1-pro-free' }),
  });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.startsWith('audio/')) throw new Error(`El servicio de voz respondió con el código ${res.status}.`);
  return { url: URL.createObjectURL(await res.blob()), fallback: res.headers.get('X-Lalo-Voice-Fallback') === '1' };
}
