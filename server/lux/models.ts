/**
 * server/lux/models.ts
 *
 * Catálogo de modelos de Mi AI que decide el administrador: qué modelos aparecen
 * (habilitado), cuánto cuesta cada respuesta en créditos y cuál es el modelo por
 * defecto de cada proveedor. El modelo de cada personaje se elige entre estos.
 *
 * Reglas:
 *   - El modelo por defecto siempre está habilitado y es gratis: es la red de
 *     seguridad. Si un personaje no puede usar su modelo, vuelve a este.
 *   - Deshabilitar un modelo hace que los personajes que lo usaban pasen al
 *     modelo por defecto (la ruta de admin lo deja escrito en cada personaje).
 *   - Un modelo con coste mayor que 0 consume créditos del plan. Si la cuenta
 *     superaría su tope mensual, el personaje vuelve al modelo por defecto.
 *
 * Todo esto es función pura salvo la lectura de app_settings, que hace el
 * manejador. Así las reglas se prueban sin base de datos.
 */

import { LUX_PROVIDERS, providerModel, type LuxProvider } from './nvidia.js';

/** Clave de app_settings con el catálogo (JSON). El modelo por defecto vive en MODEL_SETTING de keyVault. */
export const MODEL_CONFIG_SETTING = 'lux_models';

/** Tope de créditos por respuesta de un modelo. */
export const MODEL_COST_MAX = 100_000;

export interface ModelSetting {
  enabled: boolean;
  /** Créditos que consume cada respuesta. 0 = gratis. */
  cost: number;
}

/** Lo guardado en app_settings: solo lo que el administrador ha tocado. */
export type ModelConfig = Partial<Record<LuxProvider, Record<string, Partial<ModelSetting>>>>;

export interface ModelRow extends ModelSetting {
  id: string;
  label: string;
  isDefault: boolean;
}

/** Lee el catálogo guardado. Un JSON roto no tira nada: cuenta como sin configurar. */
export function parseModelConfig(raw: string | null): ModelConfig {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as ModelConfig) : {};
  } catch {
    return {};
  }
}

/** Estado de un modelo. Sin nada guardado: habilitado y gratis. */
export function modelState(provider: LuxProvider, id: string, config: ModelConfig): ModelSetting {
  const stored = config[provider]?.[id] ?? {};
  return {
    enabled: stored.enabled !== false,
    cost: Number.isInteger(stored.cost) && (stored.cost as number) >= 0 ? (stored.cost as number) : 0,
  };
}

/** Todos los modelos del proveedor, también los deshabilitados (el administrador tiene que verlos). */
export function listModels(provider: LuxProvider, config: ModelConfig, defaultModel: string): ModelRow[] {
  return (LUX_PROVIDERS[provider].models as readonly { id: string; label: string }[]).map((model) => ({
    id: model.id,
    label: model.label,
    isDefault: model.id === defaultModel,
    ...modelState(provider, model.id, config),
  }));
}

/** Aplica un cambio de estado a un modelo y devuelve el catálogo nuevo (no toca el original). */
export function withModelState(config: ModelConfig, provider: LuxProvider, id: string, patch: Partial<ModelSetting>): ModelConfig {
  const next: ModelConfig = { ...config, [provider]: { ...(config[provider] ?? {}) } };
  next[provider]![id] = { ...(next[provider]![id] ?? {}), ...patch };
  return next;
}

/**
 * Por qué el modelo por defecto no puede quedar así: no puede estar deshabilitado
 * ni cobrar créditos. Devuelve el motivo, o null si es válido.
 */
export function defaultModelProblem(provider: LuxProvider, id: string, config: ModelConfig): string | null {
  const state = modelState(provider, id, config);
  if (!state.enabled) return 'El modelo por defecto no se puede deshabilitar. Elige antes otro modelo por defecto.';
  if (state.cost > 0) return 'El modelo por defecto es gratis: es la red de seguridad de los personajes. Pon su coste a 0.';
  return null;
}

export interface PickInput {
  provider: LuxProvider;
  /** Modelo que pidió el personaje, o null para el por defecto. */
  wanted: string | null;
  defaultModel: string;
  config: ModelConfig;
  /** Créditos que la cuenta ya ha gastado este mes. */
  spent: number;
  /** Tope mensual de su plan, o null si no hay tope. */
  budget: number | null;
}

export interface PickResult {
  model: string;
  /** Créditos que cuesta esta respuesta. */
  cost: number;
  /** Por qué no se usa el modelo pedido, o null si se usa. */
  fellBack: null | 'disabled' | 'budget';
}

/** Elige el modelo de una respuesta, con la regla de fallback al por defecto. */
export function pickModel(input: PickInput): PickResult {
  const { provider, defaultModel, config } = input;
  const fallback: PickResult = { model: defaultModel, cost: modelState(provider, defaultModel, config).cost, fellBack: null };
  if (!input.wanted || input.wanted === defaultModel) return fallback;

  if (!providerModel(provider, input.wanted)) return { ...fallback, fellBack: 'disabled' };
  const state = modelState(provider, input.wanted, config);
  if (!state.enabled) return { ...fallback, fellBack: 'disabled' };
  if (state.cost > 0 && input.budget !== null && input.spent + state.cost > input.budget) return { ...fallback, fellBack: 'budget' };
  return { model: input.wanted, cost: state.cost, fellBack: null };
}

/** Mes de facturación (UTC) en formato AAAA-MM. */
export const monthOf = (nowMs: number): string => new Date(nowMs).toISOString().slice(0, 7);
