/**
 * server/integrations/http.ts
 *
 * Forma común de las peticiones y respuestas de las rutas de integraciones, y
 * cómo se sabe quién llama: por su sesión de Supabase (cabecera Authorization),
 * igual que en server/storage/handlers.ts. Nunca se acepta un id de perfil
 * enviado en la petición.
 */

import { identify, isResult } from '../storage/handlers.js';
import { MigrationMissingError, missingSupabase, serviceStore, type Env, type Store } from './store.js';

export interface IntegrationRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string>;
  body: unknown;
}

export interface IntegrationResult {
  status: number;
  body: Record<string, unknown>;
  /** Con valor, la respuesta es una redirección a esta dirección (fija, nunca tomada de la petición). */
  redirect?: string;
  /** Cabeceras Set-Cookie. */
  cookies?: string[];
}

export interface Caller {
  id: string;
  role: string;
  status: string;
}

export type Auth = (req: IntegrationRequest, env: Env) => Promise<Caller | IntegrationResult>;

export interface Deps {
  fetch: typeof fetch;
  now: () => number;
  store: (env: Env) => Store | null;
  auth: Auth;
}

export const fail = (status: number, code: string, error: string, extra: Record<string, unknown> = {}): IntegrationResult => ({
  status,
  body: { error, code, ...extra },
});

export const isFail = (value: Caller | IntegrationResult): value is IntegrationResult => 'body' in value;

const sessionAuth: Auth = async (req, env) => {
  const ctx = await identify({ method: req.method, headers: req.headers, body: req.body }, env);
  if (isResult(ctx)) return ctx;
  if (ctx.caller.status !== 'active') return fail(403, 'not_active', 'Tu cuenta no está activa.');
  return { id: ctx.caller.id, role: ctx.caller.role, status: ctx.caller.status };
};

export const defaultDeps: Deps = { fetch: (...args) => fetch(...args), now: Date.now, store: serviceStore, auth: sessionAuth };

export function headerOf(req: IntegrationRequest, name: string): string {
  const value = req.headers[name.toLowerCase()];
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

export function cookieOf(req: IntegrationRequest, name: string): string {
  const found = headerOf(req, 'cookie')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : '';
}

/** Qué decir cuando faltan las variables de Supabase del servidor. */
export function supabaseMissing(env: Env): IntegrationResult | null {
  const missing = missingSupabase(env);
  return missing.length > 0 ? fail(503, 'not_configured', 'Al servidor le faltan variables para hablar con la base de datos.', { missing }) : null;
}

/** Convierte los fallos previsibles en respuestas claras. Nunca incluye datos de la petición. */
export function failureOf(err: unknown, where: string): IntegrationResult {
  if (err instanceof MigrationMissingError) {
    return fail(503, 'migration_missing', 'Falta aplicar la migración 0013 (integraciones) en Supabase.');
  }
  console.error(`[Lalo integraciones] ${where}:`, err instanceof Error ? err.message : 'error desconocido');
  return fail(502, 'server_error', 'El servidor no pudo completar la operación. Prueba de nuevo en un momento.');
}
