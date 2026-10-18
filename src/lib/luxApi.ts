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

export async function luxSetModel(model: string): Promise<ApiOutcome<{ model: string }>> {
  const res = await call('/api/lux/model', 'POST', { model });
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
