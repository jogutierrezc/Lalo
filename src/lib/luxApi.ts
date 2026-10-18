/**
 * src/lib/luxApi.ts
 *
 * Llamadas del panel del administrador a las rutas de Lux (/api/lux/*). La
 * clave de NVIDIA viaja una sola vez, al guardarla, y nunca vuelve al navegador:
 * el servidor solo contesta si está configurada.
 */

import { call, type ApiOutcome } from './integrationsApi';

export interface LuxModelOption {
  id: string;
  label: string;
  /** Habilitado en el catálogo del administrador (migración 0032). Sin el dato, se considera habilitado. */
  enabled?: boolean;
  /** Créditos por respuesta. */
  cost?: number;
}

export type LuxProviderId = 'nvidia' | 'mistral';

export interface LuxProviderOption {
  id: LuxProviderId;
  label: string;
  defaultModel: string;
  models: LuxModelOption[];
}

export interface LuxStatus {
  /** Proveedor que usa Lux ahora. */
  provider: LuxProviderId;
  providers: LuxProviderOption[];
  /** Hay clave guardada para el proveedor activo. */
  configured: boolean;
  configuredByProvider: Record<LuxProviderId, boolean>;
  vault: boolean;
  model: string;
  defaultModel: string;
  models: LuxModelOption[];
}

export interface LuxTestResult {
  model: string;
  latencyMs: number;
}

export async function luxStatus(): Promise<ApiOutcome<LuxStatus>> {
  const res = await call('/api/lux/status', 'GET');
  if (!res.ok) return res;
  return {
    ok: true,
    data: {
      provider: res.data.provider === 'mistral' ? 'mistral' : 'nvidia',
      providers: Array.isArray(res.data.providers) ? (res.data.providers as LuxProviderOption[]) : [],
      configured: res.data.configured === true,
      configuredByProvider: (res.data.configuredByProvider ?? { nvidia: false, mistral: false }) as Record<LuxProviderId, boolean>,
      vault: res.data.vault === true,
      model: String(res.data.model ?? ''),
      defaultModel: String(res.data.defaultModel ?? ''),
      models: Array.isArray(res.data.models) ? (res.data.models as LuxModelOption[]) : [],
    },
  };
}

/** Elige el proveedor de IA de Lux (NVIDIA o Mistral). El modelo y la clave son los de ese proveedor. */
export async function luxSetProvider(provider: LuxProviderId): Promise<ApiOutcome<{ provider: LuxProviderId }>> {
  const res = await call('/api/lux/provider', 'POST', { provider });
  if (!res.ok) return res;
  return { ok: true, data: { provider: res.data.provider === 'mistral' ? 'mistral' : 'nvidia' } };
}

/** Modelo por defecto de un proveedor (sin proveedor, el activo). Debe estar habilitado y ser gratis. */
export async function luxSetModel(model: string, provider?: LuxProviderId): Promise<ApiOutcome<{ model: string }>> {
  const res = await call('/api/lux/model', 'POST', provider ? { model, provider } : { model });
  if (!res.ok) return res;
  return { ok: true, data: { model: String(res.data.model ?? model) } };
}

/** Guarda la clave. Con cadena vacía, la borra. */
/** Guarda la clave del proveedor indicado. Sin proveedor, usa el activo. */
export async function luxSaveKey(apiKey: string, provider?: LuxProviderId): Promise<ApiOutcome<{ configured: boolean }>> {
  const res = await call('/api/lux/key', 'POST', { apiKey, provider });
  if (!res.ok) return res;
  return { ok: true, data: { configured: res.data.configured === true } };
}

export async function luxTest(): Promise<ApiOutcome<LuxTestResult>> {
  const res = await call('/api/lux/test', 'POST');
  if (!res.ok) return res;
  return { ok: true, data: { model: String(res.data.model ?? ''), latencyMs: Number(res.data.latencyMs ?? 0) } };
}

/** Versión publicada de Lux para los streams. */
export interface LuxReleaseInfo {
  version: number;
  note: string;
  at: string | null;
}

export async function luxRelease(): Promise<ApiOutcome<LuxReleaseInfo>> {
  const res = await call('/api/lux/release', 'GET');
  if (!res.ok) return res;
  return { ok: true, data: { version: Number(res.data.version ?? 1), note: String(res.data.note ?? ''), at: (res.data.at as string) ?? null } };
}

/** Publica una actualización: los overlays se recargan y los bots avisan. */
export async function luxPublishRelease(note: string): Promise<ApiOutcome<LuxReleaseInfo>> {
  const res = await call('/api/lux/release', 'POST', { note });
  if (!res.ok) return res;
  return { ok: true, data: { version: Number(res.data.version ?? 1), note: String(res.data.note ?? ''), at: (res.data.at as string) ?? null } };
}

/** Ajustes de Lux del streamer (lux_settings, migración 0024). */
export interface LuxSettingsView {
  personality: string;
  replyMax: number;
  language: 'es' | 'en' | 'pt';
  memoryEnabled: boolean;
  obsSize: number;
  voiceReferenceId: string | null;
  voiceEngine: 'fish' | 'elevenlabs' | null;
  /** Volumen de la voz en el overlay, de 0 a 100. */
  voiceVolume: number;
  /** Lux aprende del chat (migración 0030). Apagado por defecto. */
  chatLearning: boolean;
}

/** Recuerdo de Lux tal como lo devuelve /api/lux/memory. */
export type LuxMemoryKind = 'fact' | 'style' | 'viewer' | 'event';

export interface LuxMemory {
  id: string;
  kind: LuxMemoryKind;
  subject: string | null;
  content: string;
  pinned: boolean;
  /** 'admin': lo escribió el administrador desde la ficha de la cuenta (migración 0031). */
  source: 'manual' | 'chat' | 'admin';
  createdAt: string;
  expiresAt: string | null;
}

export interface LuxMemoryList {
  memories: LuxMemory[];
  saved: number;
  savedMax: number;
  /** Recuerdos que se envían al modelo en cada respuesta. */
  usedInReply: number;
  usedMax: number;
  memoryEnabled: boolean;
}

export async function luxMemories(): Promise<ApiOutcome<LuxMemoryList>> {
  const res = await call('/api/lux/memory', 'GET');
  if (!res.ok) return res;
  return {
    ok: true,
    data: {
      memories: (res.data.memories ?? []) as LuxMemory[],
      saved: Number(res.data.saved ?? 0),
      savedMax: Number(res.data.savedMax ?? 100),
      usedInReply: Number(res.data.usedInReply ?? 0),
      usedMax: Number(res.data.usedMax ?? 20),
      memoryEnabled: res.data.memoryEnabled === true,
    },
  };
}

/** Crear, editar o borrar. Todo pasa por el servidor: el navegador no escribe en la base de datos. */
export async function luxCreateMemory(kind: 'fact' | 'style', content: string): Promise<ApiOutcome<null>> {
  const res = await call('/api/lux/memory', 'POST', { op: 'create', kind, content });
  if (!res.ok) return res;
  return { ok: true, data: null };
}

export async function luxUpdateMemory(id: string, patch: { content?: string; pinned?: boolean }): Promise<ApiOutcome<null>> {
  const res = await call('/api/lux/memory', 'POST', { op: 'update', id, ...patch });
  if (!res.ok) return res;
  return { ok: true, data: null };
}

export async function luxDeleteMemory(id: string): Promise<ApiOutcome<null>> {
  const res = await call('/api/lux/memory', 'POST', { op: 'delete', id });
  if (!res.ok) return res;
  return { ok: true, data: null };
}

/*
 * Memoria que escribe el administrador en la ficha de una cuenta (portal admin).
 * Ruta /api/lux/admin-memory: el servidor comprueba que quien llama es admin.
 */

const ADMIN_MEMORY = '/api/lux/admin-memory';

/** Trozo de un texto pegado o subido. `blocked` dice por qué no se puede guardar (filtro de memory.ts), o null. */
export interface LuxSplitChunk {
  content: string;
  blocked: string | null;
}

export interface LuxAdminMemoryList {
  memories: LuxMemory[];
  saved: number;
  savedMax: number;
}

export async function luxAdminMemories(profileId: string): Promise<ApiOutcome<LuxAdminMemoryList>> {
  const res = await call(ADMIN_MEMORY, 'POST', { op: 'list', profile: profileId });
  if (!res.ok) return res;
  return {
    ok: true,
    data: {
      memories: (res.data.memories ?? []) as LuxMemory[],
      saved: Number(res.data.saved ?? 0),
      savedMax: Number(res.data.savedMax ?? 100),
    },
  };
}

/** Parte el texto en recuerdos (el servidor). Nada se guarda todavía. */
export async function luxAdminSplit(profileId: string, text: string): Promise<ApiOutcome<{ chunks: LuxSplitChunk[]; room: number }>> {
  const res = await call(ADMIN_MEMORY, 'POST', { op: 'split', profile: profileId, text });
  if (!res.ok) return res;
  return {
    ok: true,
    data: {
      chunks: (res.data.chunks ?? []) as LuxSplitChunk[],
      room: Number(res.data.room ?? 0),
    },
  };
}

/** Guarda recuerdos del administrador: dato o estilo, sin caducidad. */
export async function luxAdminSave(profileId: string, kind: 'fact' | 'style', items: string[]): Promise<ApiOutcome<null>> {
  const res = await call(ADMIN_MEMORY, 'POST', { op: 'save', profile: profileId, kind, items });
  if (!res.ok) return res;
  return { ok: true, data: null };
}

export async function luxAdminUpdate(profileId: string, id: string, content: string): Promise<ApiOutcome<null>> {
  const res = await call(ADMIN_MEMORY, 'POST', { op: 'update', profile: profileId, id, content });
  if (!res.ok) return res;
  return { ok: true, data: null };
}

export async function luxAdminDelete(profileId: string, id: string): Promise<ApiOutcome<null>> {
  const res = await call(ADMIN_MEMORY, 'POST', { op: 'delete', profile: profileId, id });
  if (!res.ok) return res;
  return { ok: true, data: null };
}

/** Voz que Lux usa para hablar: la del catálogo elegida, o null para la voz por defecto. */
export interface LuxVoice {
  referenceId: string | null;
  engine: 'fish' | 'elevenlabs' | null;
}

export interface LuxSettingsResult {
  settings: LuxSettingsView;
  /** Campo que rechazó el servidor, para marcarlo en el formulario. */
  field?: keyof LuxSettingsView;
}

export async function luxGetSettings(): Promise<ApiOutcome<LuxSettingsView>> {
  const res = await call('/api/lux/config', 'GET');
  if (!res.ok) return res;
  return { ok: true, data: res.data.settings as LuxSettingsView };
}

export async function luxSaveSettings(patch: Partial<LuxSettingsView>): Promise<ApiOutcome<LuxSettingsView>> {
  const res = await call('/api/lux/config', 'POST', patch as Record<string, unknown>);
  if (!res.ok) return res;
  return { ok: true, data: res.data.settings as LuxSettingsView };
}

/** Prueba: un mensaje al modelo con los ajustes guardados. */
export async function luxAsk(
  message: string,
  viewer?: string,
  speak?: boolean
): Promise<ApiOutcome<{ reply: string; emotion: string; intent: string; gesture: string; model: string; voice: LuxVoice }>> {
  // speak: que la respuesta también se oiga en el overlay de OBS (lo encola el servidor).
  const res = await call('/api/lux/reply', 'POST', { message, viewer: viewer || undefined, speak });
  if (!res.ok) return res;
  const voice = (res.data.voice ?? {}) as LuxVoice;
  return {
    ok: true,
    data: {
      reply: String(res.data.reply ?? ''),
      emotion: String(res.data.emotion ?? 'normal'),
      intent: String(res.data.intent ?? 'neutro'),
      gesture: String(res.data.gesture ?? 'idle'),
      model: String(res.data.model ?? ''),
      voice: { referenceId: voice.referenceId ?? null, engine: voice.engine ?? null },
    },
  };
}

/*
 * Mi AI: personajes, modelos y créditos (migración 0032). El catálogo lo gestiona
 * solo el administrador (ruta /api/lux/characters y /api/lux/models); el streamer
 * solo lee su personaje activo (/api/lux/character).
 */

/** Gestos que el overlay reproduce, con el nombre que ve el administrador. */
export const LUX_GESTURE_LABELS: Record<string, string> = {
  wave: 'Saludar',
  spin: 'Girar',
  dance: 'Bailar',
  jump: 'Saltar',
  sing: 'Cantar',
  bow: 'Reverencia',
  ult: 'Ultimate',
  pride: 'Orgullo',
  nod: 'Asentir',
  shrug: 'Encogerse',
  arms_up: 'Brazos arriba',
};

export interface LuxCharacterRow {
  id: string;
  name: string;
  avatar: string;
  color: string;
  gestures: string[];
  /** Modelo propio del personaje, o null para el modelo por defecto. */
  model: string | null;
  isDefault: boolean;
}

export interface LuxModelRow extends LuxModelOption {
  enabled: boolean;
  cost: number;
  isDefault: boolean;
}

export interface LuxCharacterCatalog {
  characters: LuxCharacterRow[];
  gestures: string[];
  provider: LuxProviderId;
  providerLabel: string;
  /** Modelos del proveedor activo, con su estado (los que puede elegir un personaje). */
  models: LuxModelRow[];
  defaultModel: string;
  /** Solo con ?profile=: el personaje asignado a la cuenta, el que usa de verdad y su consumo. */
  assigned?: string | null;
  resolved?: string;
  usage?: LuxUsage;
}

export interface LuxUsage {
  /** Créditos gastados este mes. */
  credits: number;
  /** Tope mensual del plan, o null si no hay tope. */
  budget: number | null;
}

export async function luxCharacters(profileId?: string): Promise<ApiOutcome<LuxCharacterCatalog>> {
  const path = profileId ? `/api/lux/characters?profile=${encodeURIComponent(profileId)}` : '/api/lux/characters';
  const res = await call(path, 'GET');
  if (!res.ok) return res;
  const d = res.data;
  return {
    ok: true,
    data: {
      characters: (d.characters ?? []) as LuxCharacterRow[],
      gestures: (d.gestures ?? []) as string[],
      provider: d.provider === 'mistral' ? 'mistral' : 'nvidia',
      providerLabel: String(d.providerLabel ?? ''),
      models: (d.models ?? []) as LuxModelRow[],
      defaultModel: String(d.defaultModel ?? ''),
      assigned: profileId ? ((d.assigned as string | null) ?? null) : undefined,
      resolved: profileId ? String(d.resolved ?? '') : undefined,
      usage: profileId ? (d.usage as LuxUsage) : undefined,
    },
  };
}

/** Escrituras del catálogo: op create | update | delete | default | assign, con los campos de cada una. */
export async function luxCharacterWrite(body: Record<string, unknown>): Promise<ApiOutcome<Record<string, unknown>>> {
  return call('/api/lux/characters', 'POST', body);
}

export interface LuxProviderModels {
  id: LuxProviderId;
  label: string;
  defaultModel: string;
  models: LuxModelRow[];
}

export async function luxModels(): Promise<ApiOutcome<{ providers: LuxProviderModels[]; costMax: number }>> {
  const res = await call('/api/lux/models', 'GET');
  if (!res.ok) return res;
  return { ok: true, data: { providers: (res.data.providers ?? []) as LuxProviderModels[], costMax: Number(res.data.costMax ?? 0) } };
}

/** Cambia un modelo: habilitarlo, deshabilitarlo o ponerle coste. */
export async function luxModelSet(provider: LuxProviderId, model: string, patch: { enabled?: boolean; cost?: number }): Promise<ApiOutcome<Record<string, unknown>>> {
  return call('/api/lux/models', 'POST', { provider, model, ...patch });
}

/** Lo que ve el streamer de su personaje: nombre, modelo que usa, aviso y consumo del mes. */
export interface LuxCharacterView {
  character: { id: string; name: string; color: string; gestures: string[]; isDefault: boolean };
  model: string;
  modelLabel: string;
  /** Por qué no usa el modelo de su personaje: 'budget' (tope del plan) o 'disabled'. Null si lo usa. */
  modelNote: 'budget' | 'disabled' | null;
  usage: LuxUsage;
}

export async function luxCharacterView(): Promise<ApiOutcome<LuxCharacterView>> {
  const res = await call('/api/lux/character', 'GET');
  if (!res.ok) return res;
  return { ok: true, data: res.data as unknown as LuxCharacterView };
}
