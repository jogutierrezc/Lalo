/**
 * server/lux/nvidia.ts
 *
 * Cliente mínimo de la API de NVIDIA (build.nvidia.com), en el formato de Chat
 * Completions. Solo hace una petición sin streaming y devuelve el texto.
 *
 * La clave llega como argumento y nunca se escribe en un registro ni en un
 * mensaje de error. El modelo por defecto es stepfun-ai/step-5-preview, que
 * acepta texto e imagen; el administrador puede cambiarlo desde el panel
 * (app_settings, ver luxDb.ts).
 */

export const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
export const DEFAULT_LUX_MODEL = 'stepfun-ai/step-5-preview';

/** Modelos que el administrador puede elegir para Lux. Cualquier otro id se rechaza. */
export const LUX_MODELS = [
  { id: 'stepfun-ai/step-5-preview', label: 'Step 5 Preview (texto e imagen)' },
  { id: 'google/gemma-4-31b-it', label: 'Gemma 4 31B' },
] as const;

export const isLuxModel = (id: string): boolean => LUX_MODELS.some((model) => model.id === id);
export const NVIDIA_TIMEOUT_MS = 20_000;

export type NvidiaFetch = typeof fetch;

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export type NvidiaErrorCode = 'no_key' | 'unauthorized' | 'model_unavailable' | 'rate_limited' | 'timeout' | 'bad_response' | 'upstream';

export class NvidiaError extends Error {
  constructor(
    readonly code: NvidiaErrorCode,
    readonly status: number
  ) {
    super(code);
  }
}

export function codeForStatus(status: number): NvidiaErrorCode {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'model_unavailable';
  if (status === 429) return 'rate_limited';
  return 'upstream';
}

/** Algunos modelos de razonamiento dejan su pensamiento dentro del texto. Se quita antes de mostrarlo. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/** Saca el texto de la primera opción de la respuesta, o null si no trae ninguno. */
export function parseChatText(json: unknown): string | null {
  const choices = (json as { choices?: unknown } | null)?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const content = (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content;
  if (typeof content !== 'string') return null;
  const clean = stripThinking(content);
  return clean.length > 0 ? clean : null;
}

export interface ChatOptions {
  /** Base del proveedor (sin /chat/completions). Por defecto, NVIDIA. */
  baseUrl?: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  fetch?: NvidiaFetch;
}

export async function nvidiaChat(opts: ChatOptions): Promise<string> {
  if (!opts.apiKey) throw new NvidiaError('no_key', 0);
  const doFetch = opts.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? NVIDIA_TIMEOUT_MS);

  let res: Response;
  try {
    res = await doFetch(`${opts.baseUrl ?? NVIDIA_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        max_tokens: opts.maxTokens ?? 300,
        temperature: opts.temperature ?? 0.7,
        stream: false,
      }),
      signal: controller.signal,
    });
  } catch {
    throw new NvidiaError(controller.signal.aborted ? 'timeout' : 'upstream', 0);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new NvidiaError(codeForStatus(res.status), res.status);

  const text = parseChatText(await res.json().catch(() => null));
  if (!text) throw new NvidiaError('bad_response', res.status);
  return text;
}

// ---------- Proveedores de IA para Lux ----------

export const MISTRAL_BASE_URL = 'https://api.mistral.ai/v1';

export const LUX_PROVIDERS = {
  nvidia: {
    label: 'NVIDIA',
    baseUrl: NVIDIA_BASE_URL,
    defaultModel: DEFAULT_LUX_MODEL,
    models: LUX_MODELS.map((model) => ({ ...model })),
  },
  mistral: {
    label: 'Mistral AI',
    baseUrl: MISTRAL_BASE_URL,
    defaultModel: 'ministral-8b-latest',
    models: [
      { id: 'ministral-8b-latest', label: 'Ministral 8B (la más rápida)' },
      { id: 'mistral-small-latest', label: 'Mistral Small' },
    ],
  },
} as const;

export type LuxProvider = keyof typeof LUX_PROVIDERS;

export const isLuxProvider = (value: string): value is LuxProvider => Object.prototype.hasOwnProperty.call(LUX_PROVIDERS, value);

/** Modelo válido para ese proveedor, o null si no pertenece a él. */
export const providerModel = (provider: LuxProvider, id: string): string | null =>
  (LUX_PROVIDERS[provider].models as readonly { id: string }[]).some((model) => model.id === id) ? id : null;
