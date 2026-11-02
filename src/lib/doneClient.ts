/**
 * src/lib/doneClient.ts
 *
 * Cliente HTTP de Done AI (rutas /api/done/*). El navegador solo habla con el servidor de Tally:
 * nunca llama a un proveedor de IA. Con «?demo=1» (o setDoneDemo(true)) el cliente no usa la red:
 * contesta con datos de ejemplo para poder ver y probar la ventana y el overlay sin servidor.
 *
 * Rutas: POST /api/done/chat, GET /api/done/speech, GET|PUT /api/done/settings,
 * GET|POST|PATCH|DELETE /api/done/memory, POST /api/done/say, GET /api/done/release.
 */

import { supabase } from './supabase';
import type { ApiOutcome } from './integrationsApi';
import { DONE_DEFAULTS, type DoneEmotion, type DoneGesture, type DoneKind, type DoneSettings, type DoneSpeech } from './doneTypes';
import type { LuxLibraryModel, LuxMemory, LuxMemoryKind, LuxMemoryList, LuxModelLibrary } from './luxApi';

/* ---------- Modo demo ---------- */

let forcedDemo: boolean | null = null;

/** Fuerza el modo demo (pruebas) o lo devuelve a la URL con null. */
export function setDoneDemo(value: boolean | null): void {
  forcedDemo = value;
}

/** ¿Está activo el modo demo? Lo pide la URL: «#widget?app=done&demo=1» o «?demo=1». */
export function isDoneDemo(): boolean {
  if (forcedDemo !== null) return forcedDemo;
  if (typeof window === 'undefined') return false;
  const fromSearch = new URLSearchParams(window.location.search).get('demo');
  const hash = window.location.hash;
  const at = hash.indexOf('?');
  const fromHash = at === -1 ? null : new URLSearchParams(hash.slice(at)).get('demo');
  return (fromSearch ?? fromHash) === '1';
}

const fail = (code: string, message: string): ApiOutcome<never> => ({ ok: false, code, message, missing: [] });
const NO_SERVER = 'El servidor de Tally no respondió. En local hace falta arrancarlo con «npm run dev:all».';

/* ---------- Llamada con sesión ---------- */

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function call(path: string, method: Method, body?: Record<string, unknown>): Promise<ApiOutcome<Record<string, unknown>>> {
  if (!supabase) return fail('no_cloud', 'Este despliegue no tiene la nube encendida: no hay cuentas que conectar.');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return fail('no_session', 'Hay que iniciar sesión.');
  try {
    const res = await fetch(path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(20000),
    });
    const parsed = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!parsed) return fail('no_server', NO_SERVER);
    if (!res.ok) return fail(typeof parsed.code === 'string' ? parsed.code : 'server', typeof parsed.error === 'string' ? parsed.error : NO_SERVER);
    return { ok: true, data: parsed };
  } catch {
    return fail('no_server', NO_SERVER);
  }
}

/* ---------- Ajustes ---------- */

/** Mezcla lo que llega del servidor con los valores por defecto: un campo ausente nunca rompe la ventana. */
export function normalizeSettings(raw: unknown): DoneSettings {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<DoneSettings>;
  return { ...DONE_DEFAULTS, ...source };
}

let demoSettings: DoneSettings = { ...DONE_DEFAULTS };

export async function doneGetSettings(): Promise<ApiOutcome<DoneSettings>> {
  if (isDoneDemo()) return { ok: true, data: { ...demoSettings } };
  const res = await call('/api/done/settings', 'GET');
  if (!res.ok) return res;
  if (typeof res.data.readKey === 'string') lastReadKey = res.data.readKey;
  return { ok: true, data: normalizeSettings(res.data.settings ?? res.data) };
}

let lastReadKey: string | null = null;
/** Clave de lectura de la fuente de OBS que devuelve GET /api/done/settings (null hasta leerla). */
export const getDoneReadKey = (): string | null => lastReadKey;

/** Guarda los campos indicados. El servidor valida y devuelve los ajustes completos. */
export async function doneSaveSettings(patch: Partial<DoneSettings>): Promise<ApiOutcome<DoneSettings>> {
  if (isDoneDemo()) {
    demoSettings = { ...demoSettings, ...patch };
    return { ok: true, data: { ...demoSettings } };
  }
  const res = await call('/api/done/settings', 'PUT', patch as Record<string, unknown>);
  if (!res.ok) return res;
  return { ok: true, data: normalizeSettings(res.data.settings ?? res.data) };
}

/* ---------- Memoria ---------- */

const DEMO_MEMORIES: LuxMemory[] = [
  { id: 'm1', kind: 'fact', subject: null, content: 'Le gusta el café', pinned: true, source: 'manual', createdAt: '2026-10-01T10:00:00Z', expiresAt: null },
  { id: 'm2', kind: 'fact', subject: null, content: 'Juega de noche', pinned: false, source: 'manual', createdAt: '2026-10-02T10:00:00Z', expiresAt: null },
  { id: 'm3', kind: 'style', subject: null, content: 'Dice «vamos equipo» al empezar', pinned: false, source: 'admin', createdAt: '2026-10-03T10:00:00Z', expiresAt: null },
];
let demoMemories: LuxMemory[] = DEMO_MEMORIES.map((m) => ({ ...m }));
let demoSeq = 100;

/** Reinicia los datos de ejemplo (pruebas). */
export function resetDoneDemo(): void {
  demoSettings = { ...DONE_DEFAULTS };
  demoMemories = DEMO_MEMORIES.map((m) => ({ ...m }));
  demoSeq = 100;
}

const memoryList = (memories: LuxMemory[], memoryEnabled: boolean): LuxMemoryList => ({
  memories,
  saved: memories.length,
  savedMax: 20,
  usedInReply: Math.min(memories.length, 10),
  usedMax: 10,
  memoryEnabled,
});

export async function doneMemories(): Promise<ApiOutcome<LuxMemoryList>> {
  if (isDoneDemo()) return { ok: true, data: memoryList(demoMemories, demoSettings.memoryEnabled) };
  const res = await call('/api/done/memory', 'GET');
  if (!res.ok) return res;
  return {
    ok: true,
    data: {
      memories: (res.data.memories ?? []) as LuxMemory[],
      saved: Number(res.data.saved ?? 0),
      savedMax: Number(res.data.savedMax ?? 20),
      usedInReply: Number(res.data.usedInReply ?? 0),
      usedMax: Number(res.data.usedMax ?? 10),
      memoryEnabled: res.data.memoryEnabled !== false,
    },
  };
}

export async function doneCreateMemory(kind: 'fact' | 'style', content: string): Promise<ApiOutcome<null>> {
  if (isDoneDemo()) {
    if (demoMemories.length >= 20) return fail('full', 'Llegaste al máximo de recuerdos. Borra alguno para añadir más.');
    demoMemories = [...demoMemories, { id: `m${demoSeq++}`, kind, subject: null, content, pinned: false, source: 'manual', createdAt: new Date().toISOString(), expiresAt: null }];
    return { ok: true, data: null };
  }
  const res = await call('/api/done/memory', 'POST', { kind, content });
  return res.ok ? { ok: true, data: null } : res;
}

export async function doneUpdateMemory(id: string, patch: { content?: string; pinned?: boolean }): Promise<ApiOutcome<null>> {
  if (isDoneDemo()) {
    demoMemories = demoMemories.map((m) => (m.id === id ? { ...m, ...patch } : m));
    return { ok: true, data: null };
  }
  const res = await call('/api/done/memory', 'PATCH', { id, ...patch });
  return res.ok ? { ok: true, data: null } : res;
}

export async function doneDeleteMemory(id: string): Promise<ApiOutcome<null>> {
  if (isDoneDemo()) {
    demoMemories = demoMemories.filter((m) => m.id !== id);
    return { ok: true, data: null };
  }
  const res = await call('/api/done/memory', 'DELETE', { id });
  return res.ok ? { ok: true, data: null } : res;
}

export type { LuxMemory as DoneMemory, LuxMemoryKind as DoneMemoryKind, LuxMemoryList as DoneMemoryList };

/* ---------- Chat, decir y versión ---------- */

export type DoneChatCommand = 'ask' | 'on' | 'off' | 'outbox' | 'outbox_done' | 'spontaneous' | 'event' | 'summary';

/** Manda un comando al motor de Done (lo usa el bot y, con la clave de OBS, el overlay). */
export async function doneChat(command: DoneChatCommand, payload: Record<string, unknown> = {}): Promise<ApiOutcome<Record<string, unknown>>> {
  if (isDoneDemo()) return { ok: true, data: { reply: '', demo: true } };
  return call('/api/done/chat', 'POST', { command, ...payload });
}

/** Deja un mensaje en la cola del chat: tal cual (literal) o una idea que la IA redacta (ai). */
export async function doneSay(text: string, mode: 'literal' | 'ai', speak: boolean): Promise<ApiOutcome<Record<string, unknown>>> {
  if (isDoneDemo()) return { ok: true, data: { id: 0, text, demo: true } };
  return call('/api/done/say', 'POST', { text, mode, speak });
}

export interface DoneRelease {
  version: number;
  note: string;
  at: string | null;
}

export async function doneRelease(): Promise<ApiOutcome<DoneRelease>> {
  if (isDoneDemo()) return { ok: true, data: { version: 1, note: 'Demo', at: null } };
  const res = await call('/api/done/release', 'GET');
  if (!res.ok) return res;
  return { ok: true, data: { version: Number(res.data.version ?? 1), note: String(res.data.note ?? ''), at: (res.data.at as string) ?? null } };
}

/* ---------- Frases para el overlay (sondeo con «after», con la clave de OBS) ---------- */

/** Voz que usa Done: la misma de «Voz del chat». Nulos = voz por defecto. */
export interface DoneVoice {
  referenceId: string | null;
  engine: 'fish' | 'elevenlabs' | null;
}

export interface DoneSpeechPage {
  items: DoneSpeech[];
  /** Último id visto: se manda como «after» en el siguiente sondeo. */
  last: string | null;
  /** Ajustes vigentes de Done para el overlay, si el servidor los incluye. */
  settings: Partial<DoneSettings> | null;
  voice: DoneVoice | null;
  /** Aviso de licencia del modelo (Riot Games), texto exacto del servidor. */
  licenseNotice: string | null;
  /** Gestos permitidos del personaje, si el servidor los manda. */
  gestures: DoneGesture[] | null;
}

const EMOTIONS = new Set<string>(['normal', 'habla', 'emocionada', 'grita', 'feliz', 'alegre', 'triste', 'molesta', 'sorprendida', 'magica']);
const GESTURES = new Set<string>(['wave', 'spin', 'dance', 'jump', 'sing', 'bow', 'ult', 'pride', 'nod', 'shrug', 'arms_up']);
const KINDS = new Set<string>(['chat', 'event', 'spontaneous', 'say']);

/** Convierte una frase del servidor en DoneSpeech, o null si no tiene texto. */
export function parseSpeech(raw: unknown): DoneSpeech | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const text = typeof r.text === 'string' ? r.text.trim() : '';
  if (!text || r.id === undefined || r.id === null) return null;
  return {
    id: String(r.id),
    text: text.slice(0, 500),
    emotion: (typeof r.emotion === 'string' && EMOTIONS.has(r.emotion) ? r.emotion : 'normal') as DoneEmotion,
    gesture: typeof r.gesture === 'string' && GESTURES.has(r.gesture) ? (r.gesture as DoneGesture) : null,
    viewer: typeof r.viewer === 'string' && r.viewer ? r.viewer : null,
    kind: (typeof r.kind === 'string' && KINDS.has(r.kind) ? r.kind : 'chat') as DoneKind,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
  };
}

/** Una página de frases. No lleva sesión: la clave de OBS (k) identifica al creador. */
export async function doneSpeech(key: string, after: string | null): Promise<ApiOutcome<DoneSpeechPage>> {
  if (isDoneDemo()) return { ok: true, data: { items: [], last: after, settings: null, voice: null, licenseNotice: null, gestures: null } };
  try {
    const url = `/api/done/speech?k=${encodeURIComponent(key)}${after === null ? '' : `&after=${encodeURIComponent(after)}`}`;
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!data) return fail('no_server', NO_SERVER);
    if (!res.ok) return fail(typeof data.code === 'string' ? data.code : 'server', typeof data.error === 'string' ? data.error : NO_SERVER);
    const items = (Array.isArray(data.items) ? data.items : []).map(parseSpeech).filter((s): s is DoneSpeech => s !== null);
    const voice = (data.voice ?? data.tts ?? null) as Partial<DoneVoice> | null;
    const character = (data.character && typeof data.character === 'object' ? data.character : {}) as Record<string, unknown>;
    const rawGestures = Array.isArray(data.gestures) ? data.gestures : Array.isArray(character.gestures) ? character.gestures : null;
    const gestures = rawGestures ? (rawGestures as unknown[]).filter((g): g is DoneGesture => typeof g === 'string' && GESTURES.has(g)) : null;
    const notice = typeof data.licenseNotice === 'string' ? data.licenseNotice : typeof character.licenseNotice === 'string' ? character.licenseNotice : null;
    const merged: Partial<DoneSettings> = { ...(data.settings && typeof data.settings === 'object' ? (data.settings as Partial<DoneSettings>) : {}) };
    if (typeof data.enabled === 'boolean') merged.enabled = data.enabled;
    if (typeof character.modelId === 'string') merged.modelId = character.modelId;
    if (typeof character.id === 'string' && merged.characterId === undefined) merged.characterId = character.id;
    if (typeof data.command === 'string' && merged.commandWord === undefined) merged.commandWord = data.command;
    return {
      ok: true,
      data: {
        items,
        last: data.last === undefined || data.last === null ? after : String(data.last),
        settings: Object.keys(merged).length ? merged : null,
        voice: voice ? { referenceId: voice.referenceId ?? null, engine: voice.engine ?? null } : null,
        licenseNotice: notice,
        gestures,
      },
    };
  } catch {
    return fail('no_server', NO_SERVER);
  }
}

/* ---------- Voz: la misma ruta que Lux ---------- */

/** Sintetiza con la voz del chat: POST /api/tts. Devuelve el audio, o null si no se pudo. */
export async function doneSynthesize(text: string, key: string | null, voice: DoneVoice | null): Promise<Blob | null> {
  if (isDoneDemo()) return null;
  const body: Record<string, unknown> = { text, k: key || undefined };
  if (voice?.referenceId) body.reference_id = voice.referenceId;
  if (voice?.engine) body.engine = voice.engine;
  try {
    const res = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return res.ok ? await res.blob() : null;
  } catch {
    return null;
  }
}

/** URL del GLB de un modelo para el overlay (R2 privado, con la clave de OBS). */
export const doneModelUrl = (key: string, modelId: string): string =>
  // La clave de lectura (dr.…) solo la entiende la ruta de Done; la clave de OBS, la de Lux (sirve cualquier modelo de la biblioteca)
  key.startsWith('dr.')
    ? `/api/done/model?k=${encodeURIComponent(key)}&m=${encodeURIComponent(modelId)}`
    : `/api/lux/mascota-model?k=${encodeURIComponent(key)}&m=${encodeURIComponent(modelId)}`;

/* ---------- Biblioteca de modelos (compartida con Lux) ---------- */

const DEMO_LIBRARY_MODEL = (id: string, name: string, extra: Partial<LuxLibraryModel>): LuxLibraryModel => ({
  id,
  name,
  source: 'creador',
  ownerProfileId: null,
  fileName: `${name}.glb`,
  bytes: 12 * 1024 * 1024,
  uploadedAt: '2026-09-20T10:00:00Z',
  reviewStatus: 'aprobado',
  licenseConfirmed: true,
  licenseNotice: null,
  ...extra,
});

let demoLibrary: LuxModelLibrary = {
  library: [
    DEMO_LIBRARY_MODEL('demo-lux-riot', 'Lux (Riot Games)', { source: 'riot', licenseNotice: 'Aviso de licencia de ejemplo: este personaje pertenece a Riot Games y se usa según su política de contenido.' }),
    DEMO_LIBRARY_MODEL('demo-admin-1', 'Robot de Tally', {}),
  ],
  mine: [
    DEMO_LIBRARY_MODEL('demo-mine-1', 'Mi mascota', { ownerProfileId: 'me', bytes: 18 * 1024 * 1024, reviewStatus: 'pendiente' }),
    DEMO_LIBRARY_MODEL('demo-mine-2', 'Prueba 2', { ownerProfileId: 'me', bytes: 32 * 1024 * 1024, reviewStatus: 'privado' }),
  ],
  limit: 10,
  used: 2,
  left: 8,
  chosen: null,
};

/** Biblioteca de modelos de Lux (la misma de Mi AI). En demo, datos de ejemplo. */
export async function doneModelLibrary(): Promise<ApiOutcome<LuxModelLibrary>> {
  if (isDoneDemo()) return { ok: true, data: JSON.parse(JSON.stringify(demoLibrary)) as LuxModelLibrary };
  const { luxModelLibrary } = await import('./luxApi');
  return luxModelLibrary();
}

/** Enviar a revisión o quitar un modelo propio. En demo, solo cambia los datos de ejemplo. */
export async function doneModelOp(body: { op: 'submit' | 'remove'; id: string }): Promise<ApiOutcome<Record<string, unknown>>> {
  if (isDoneDemo()) {
    if (body.op === 'submit') {
      demoLibrary = { ...demoLibrary, mine: demoLibrary.mine.map((m) => (m.id === body.id ? { ...m, reviewStatus: 'pendiente' as const } : m)) };
    } else {
      demoLibrary = { ...demoLibrary, mine: demoLibrary.mine.filter((m) => m.id !== body.id), used: demoLibrary.used - 1, left: demoLibrary.left + 1 };
    }
    return { ok: true, data: {} };
  }
  const { luxModelOp } = await import('./luxApi');
  return luxModelOp(body);
}

/** Sube un .glb a la biblioteca (la misma lógica de subida que Lux: URL firmada a R2). */
export async function doneUploadModel(file: File, onProgress: (fraction: number) => void): Promise<ApiOutcome<null>> {
  if (isDoneDemo()) {
    for (let i = 1; i <= 4; i++) {
      onProgress(i / 4);
      await new Promise((r) => setTimeout(r, 120));
    }
    demoLibrary = {
      ...demoLibrary,
      mine: [...demoLibrary.mine, DEMO_LIBRARY_MODEL(`demo-up-${demoSeq++}`, file.name.replace(/\.glb$/i, ''), { ownerProfileId: 'me', bytes: file.size, reviewStatus: 'privado' })],
      used: demoLibrary.used + 1,
      left: demoLibrary.left - 1,
    };
    return { ok: true, data: null };
  }
  const { uploadLibraryModel } = await import('./luxModelUpload');
  return uploadLibraryModel(file, onProgress);
}
