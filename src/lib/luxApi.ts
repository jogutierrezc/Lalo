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

export interface LuxStatus {
  configured: boolean;
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
      configured: res.data.configured === true,
      vault: res.data.vault === true,
      model: String(res.data.model ?? ''),
      defaultModel: String(res.data.defaultModel ?? ''),
      models: Array.isArray(res.data.models) ? (res.data.models as LuxModelOption[]) : [],
    },
  };
}

export async function luxSetModel(model: string): Promise<ApiOutcome<{ model: string }>> {
  const res = await call('/api/lux/model', 'POST', { model });
  if (!res.ok) return res;
  return { ok: true, data: { model: String(res.data.model ?? model) } };
}

/** Guarda la clave. Con cadena vacía, la borra. */
export async function luxSaveKey(apiKey: string): Promise<ApiOutcome<{ configured: boolean }>> {
  const res = await call('/api/lux/key', 'POST', { apiKey });
  if (!res.ok) return res;
  return { ok: true, data: { configured: res.data.configured === true } };
}

export async function luxTest(): Promise<ApiOutcome<LuxTestResult>> {
  const res = await call('/api/lux/test', 'POST');
  if (!res.ok) return res;
  return { ok: true, data: { model: String(res.data.model ?? ''), latencyMs: Number(res.data.latencyMs ?? 0) } };
}
