/**
 * server/storage/handlers.ts
 *
 * Lógica de las rutas de almacenamiento, compartida por las funciones de Vercel
 * (api/storage/*, api/media/*) y por el servidor local (server/index.ts), para
 * que las dos se comporten igual.
 *
 *   GET  /api/storage/status         solo administrador
 *   POST /api/storage/test           solo administrador
 *   POST /api/media/upload-session   cuenta activa
 *   POST /api/media/complete         cuenta activa
 *   POST /api/media/delete           dueño del archivo o administrador
 *
 * Quién llama se sabe verificando su sesión de Supabase (cabecera
 * Authorization: Bearer) con la clave de servicio. Nunca se acepta un id de
 * usuario enviado en el cuerpo.
 *
 * SIN PROBAR contra Supabase ni contra R2 reales.
 */

import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { buildObjectKey, checkUpload, isAllowedMime, keyBelongsTo, type PlanLimits, type UsageNow } from './limits.js';
import {
  deleteObject,
  headObject,
  listOne,
  objectApiUrl,
  presignPut,
  publicObjectUrl,
  putSmallObject,
  readR2Config,
  type Env,
  type R2Config,
} from './r2.js';

export type ApiRoute = 'storage/status' | 'storage/test' | 'media/upload-session' | 'media/complete' | 'media/delete';

export interface ApiRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

export interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

const ROUTE_METHOD: Record<ApiRoute, 'GET' | 'POST'> = {
  'storage/status': 'GET',
  'storage/test': 'POST',
  'media/upload-session': 'POST',
  'media/complete': 'POST',
  'media/delete': 'POST',
};

/** Capacidad por defecto: 10 GB, el almacenamiento gratuito de R2 (developers.cloudflare.com/r2/pricing). */
export const DEFAULT_CAPACITY_BYTES = 10 * 1024 * 1024 * 1024;
/** Minutos que vale la URL de subida. */
const UPLOAD_URL_SECONDS = 300;

export const fail = (status: number, code: string, error: string, extra: Record<string, unknown> = {}): ApiResult => ({
  status,
  body: { error, code, ...extra },
});

export function header(req: ApiRequest, name: string): string {
  const value = req.headers[name] ?? req.headers[name.toLowerCase()];
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

export function bodyOf(req: ApiRequest): Record<string, unknown> {
  if (req.body && typeof req.body === 'object') return req.body as Record<string, unknown>;
  if (typeof req.body === 'string') {
    try {
      const parsed: unknown = JSON.parse(req.body);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

// ---------- Quién llama ----------

export interface Caller {
  id: string;
  role: string;
  status: string;
  planId: string | null;
  mediaFolder: string;
}

export interface Context {
  db: SupabaseClient;
  caller: Caller;
}

/** Nombres de las variables de Supabase que faltan en el servidor. */
export function missingSupabaseEnv(env: Env): string[] {
  const missing: string[] = [];
  if (!(env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '').trim()) missing.push('SUPABASE_URL');
  if (!(env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  return missing;
}

export async function identify(req: ApiRequest, env: Env): Promise<Context | ApiResult> {
  const missing = missingSupabaseEnv(env);
  if (missing.length > 0) {
    return fail(503, 'server_not_configured', 'Al servidor le faltan variables para comprobar quién eres.', { missing });
  }
  const token = header(req, 'authorization').replace(/^Bearer\s+/i, '').trim();
  if (!token) return fail(401, 'no_session', 'Hay que iniciar sesión.');

  const url = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '').trim();
  const db = createClient(url, (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return fail(401, 'bad_session', 'La sesión no es válida o ha caducado. Vuelve a entrar.');

  const profile = await db
    .from('profiles')
    .select('id, role, status, plan_id, media_folder')
    .eq('id', data.user.id)
    .maybeSingle();
  if (profile.error) return fail(502, 'profile_read', `No se pudo leer tu perfil: ${profile.error.message}`);
  if (!profile.data) return fail(403, 'no_profile', 'Esta cuenta no tiene perfil.');

  return {
    db,
    caller: {
      id: profile.data.id as string,
      role: profile.data.role as string,
      status: profile.data.status as string,
      planId: (profile.data.plan_id as string | null) ?? null,
      mediaFolder: profile.data.media_folder as string,
    },
  };
}

export const isResult = (value: Context | ApiResult): value is ApiResult => 'status' in value && 'body' in value;
export const isAdmin = (caller: Caller) => caller.role === 'admin' && caller.status === 'active';

// ---------- Lecturas comunes ----------

interface StorageSettings {
  capacity_bytes: number;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_step: string | null;
  last_test_detail: string | null;
}

async function readSettings(db: SupabaseClient): Promise<{ settings: StorageSettings; migrated: boolean }> {
  const fallback: StorageSettings = {
    capacity_bytes: DEFAULT_CAPACITY_BYTES,
    last_test_at: null,
    last_test_ok: null,
    last_test_step: null,
    last_test_detail: null,
  };
  const { data, error } = await db.from('storage_settings').select('*').eq('id', 1).maybeSingle();
  if (error) return { settings: fallback, migrated: false };
  if (!data) return { settings: fallback, migrated: true };
  return {
    migrated: true,
    settings: {
      capacity_bytes: Number(data.capacity_bytes) || DEFAULT_CAPACITY_BYTES,
      last_test_at: (data.last_test_at as string | null) ?? null,
      last_test_ok: (data.last_test_ok as boolean | null) ?? null,
      last_test_step: (data.last_test_step as string | null) ?? null,
      last_test_detail: (data.last_test_detail as string | null) ?? null,
    },
  };
}

async function readPlanAndUsage(ctx: Context): Promise<{ plan: PlanLimits; usage: UsageNow } | ApiResult> {
  if (!ctx.caller.planId) return fail(403, 'no_plan', 'Tu cuenta no tiene un plan asignado. Pídeselo al administrador.');
  const plan = await ctx.db
    .from('plans')
    .select('storage_limit_bytes, max_file_bytes, max_files')
    .eq('id', ctx.caller.planId)
    .maybeSingle();
  if (plan.error || !plan.data) return fail(502, 'plan_read', 'No se pudo leer tu plan.');

  const usage = await ctx.db.rpc('media_usage', { p_profile: ctx.caller.id });
  if (usage.error) {
    return fail(502, 'usage_read', 'No se pudo leer tu uso. Puede faltar la migración 0005 en Supabase.');
  }
  const row = (Array.isArray(usage.data) ? usage.data[0] : usage.data) as { bytes_used?: number; file_count?: number } | null;
  return {
    plan: {
      storage_limit_bytes: Number(plan.data.storage_limit_bytes),
      max_file_bytes: Number(plan.data.max_file_bytes),
      max_files: Number(plan.data.max_files),
    },
    usage: { bytes: Number(row?.bytes_used ?? 0), files: Number(row?.file_count ?? 0) },
  };
}

function r2OrFail(env: Env): R2Config | ApiResult {
  const { config, missing } = readR2Config(env);
  if (!config) {
    return fail(503, 'storage_not_configured', 'El almacenamiento de archivos aún no está configurado.', { missing });
  }
  return config;
}

const describe = (err: unknown) => (err instanceof Error ? err.message : 'error desconocido');

// ---------- Administración ----------

async function storageStatus(ctx: Context, env: Env): Promise<ApiResult> {
  if (!isAdmin(ctx.caller)) return fail(403, 'not_admin', 'Solo el administrador puede ver esto.');
  const { config, missing } = readR2Config(env);
  const { settings, migrated } = await readSettings(ctx.db);

  let bucket: { answers: boolean; detail: string } | null = null;
  if (config) {
    try {
      const res = await listOne(config);
      bucket = res.ok
        ? { answers: true, detail: 'El bucket responde.' }
        : {
            answers: false,
            detail:
              res.status === 404
                ? 'R2 dice que ese bucket no existe (404). Revisa R2_BUCKET y R2_ACCOUNT_ID.'
                : res.status === 403
                  ? 'R2 rechazó las claves (403). Revisa R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY y que el token tenga permiso sobre ese bucket.'
                  : `R2 respondió con el código ${res.status}.`,
          };
    } catch (err) {
      bucket = { answers: false, detail: `No se pudo llegar a R2: ${describe(err)}` };
    }
  }

  let totals = { bytes: 0, files: 0 };
  const totalsRes = await ctx.db.rpc('storage_totals', {});
  if (!totalsRes.error && totalsRes.data) {
    const data = totalsRes.data as { bytes?: number; files?: number };
    totals = { bytes: Number(data.bytes ?? 0), files: Number(data.files ?? 0) };
  }

  return {
    status: 200,
    body: {
      configured: config !== null,
      missing,
      migrated: migrated && !totalsRes.error,
      bucketName: config?.bucket ?? null,
      publicBaseUrl: config?.publicBaseUrl ?? null,
      bucket,
      capacityBytes: settings.capacity_bytes,
      usedBytes: totals.bytes,
      fileCount: totals.files,
      lastTest: settings.last_test_at
        ? {
            at: settings.last_test_at,
            ok: settings.last_test_ok === true,
            step: settings.last_test_step,
            detail: settings.last_test_detail,
          }
        : null,
    },
  };
}

export type TestStepId = 'subir' | 'leer' | 'permiso' | 'borrar';
export interface TestStep {
  step: TestStepId;
  ok: boolean;
  detail: string;
}

async function storageTest(ctx: Context, req: ApiRequest, env: Env): Promise<ApiResult> {
  if (!isAdmin(ctx.caller)) return fail(403, 'not_admin', 'Solo el administrador puede hacer esto.');
  const config = r2OrFail(env);
  if ('status' in config) return config;

  const id = randomUUID();
  const key = `_lalo-prueba/${id}.txt`;
  const content = `lalo-prueba-${id}`;
  const steps: TestStep[] = [];
  let uploaded = false;

  // 1. Subir un archivo pequeño con las claves del servidor
  try {
    const res = await putSmallObject(config, key, content, 'text/plain');
    uploaded = res.ok;
    steps.push({
      step: 'subir',
      ok: res.ok,
      detail: res.ok ? 'El archivo de prueba se subió.' : `R2 respondió con el código ${res.status} al subir.`,
    });
  } catch (err) {
    steps.push({ step: 'subir', ok: false, detail: `No se pudo llegar a R2: ${describe(err)}` });
  }

  if (uploaded) {
    // 2. Leerlo por la dirección pública, sin claves, como hace una capa de OBS
    try {
      const res = await fetch(publicObjectUrl(config.publicBaseUrl, key), { cache: 'no-store' });
      const text = res.ok ? await res.text() : '';
      const same = res.ok && text === content;
      steps.push({
        step: 'leer',
        ok: same,
        detail: same
          ? 'Se leyó por la dirección pública, sin sesión.'
          : res.ok
            ? 'La dirección pública respondió, pero con otro contenido. Revisa que R2_PUBLIC_BASE_URL sea la de este bucket.'
            : `La dirección pública respondió con el código ${res.status}.`,
      });
    } catch (err) {
      steps.push({ step: 'leer', ok: false, detail: `No se pudo abrir la dirección pública: ${describe(err)}` });
    }

    // 3. ¿Deja el bucket que un navegador suba desde esta página? (regla CORS)
    const origin = header(req, 'origin');
    if (origin) {
      try {
        const res = await fetch(objectApiUrl(config, key), {
          method: 'OPTIONS',
          headers: {
            Origin: origin,
            'Access-Control-Request-Method': 'PUT',
            'Access-Control-Request-Headers': 'content-type',
          },
        });
        const allowed = res.headers.get('access-control-allow-origin');
        const ok = allowed === origin || allowed === '*';
        steps.push({
          step: 'permiso',
          ok,
          detail: ok
            ? `El bucket acepta subidas desde ${origin}.`
            : `El bucket no acepta subidas desde ${origin}. Falta esa dirección en su regla CORS.`,
        });
      } catch (err) {
        steps.push({ step: 'permiso', ok: false, detail: `No se pudo comprobar la regla CORS: ${describe(err)}` });
      }
    } else {
      steps.push({
        step: 'permiso',
        ok: false,
        detail: 'El navegador no indicó desde qué dirección llamaba, así que no se pudo comprobar la regla CORS.',
      });
    }

    // 4. Borrarlo
    try {
      const res = await deleteObject(config, key);
      const ok = res.ok || res.status === 404;
      steps.push({
        step: 'borrar',
        ok,
        detail: ok ? 'El archivo de prueba se borró.' : `R2 respondió con el código ${res.status} al borrar.`,
      });
    } catch (err) {
      steps.push({ step: 'borrar', ok: false, detail: `No se pudo borrar: ${describe(err)}` });
    }
  }

  const failed = steps.find((entry) => !entry.ok) ?? null;
  const at = new Date().toISOString();
  const saved = await ctx.db.from('storage_settings').upsert({
    id: 1,
    last_test_at: at,
    last_test_ok: failed === null,
    last_test_step: failed?.step ?? null,
    last_test_detail: failed?.detail ?? null,
    updated_at: at,
  });

  return {
    status: 200,
    body: {
      ok: failed === null,
      at,
      steps,
      // Si no se pudo guardar, los streamers seguirán sin ver el almacenamiento activo
      saved: !saved.error,
      saveError: saved.error ? saved.error.message : null,
    },
  };
}

// ---------- Subidas del streamer ----------

async function uploadSession(ctx: Context, req: ApiRequest, env: Env): Promise<ApiResult> {
  if (ctx.caller.status !== 'active') return fail(403, 'not_active', 'Tu cuenta no está activa.');
  const body = bodyOf(req);
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : '';
  const mime = typeof body.mime === 'string' ? body.mime.trim().toLowerCase() : '';
  const size = typeof body.size === 'number' && Number.isInteger(body.size) ? body.size : NaN;
  if (!name) return fail(400, 'bad_request', 'Falta el nombre del archivo.');

  const config = r2OrFail(env);
  if ('status' in config) return config;

  const limits = await readPlanAndUsage(ctx);
  if ('status' in limits) return limits;

  const check = checkUpload(limits.plan, limits.usage, { size, mime });
  if (!check.ok) return fail(check.reason === 'mime' || check.reason === 'empty' ? 400 : 413, check.reason, check.message);

  const key = buildObjectKey(ctx.caller.mediaFolder, randomUUID(), name);
  return {
    status: 200,
    body: {
      key,
      uploadUrl: presignPut(config, { key, mime, size, now: new Date(), expiresSeconds: UPLOAD_URL_SECONDS }),
      expiresIn: UPLOAD_URL_SECONDS,
      headers: { 'Content-Type': mime },
    },
  };
}

const REGISTER_PROBLEM: Record<string, string> = {
  not_active: 'Tu cuenta no está activa.',
  wrong_folder: 'Ese archivo no está en tu carpeta.',
  file_too_large: 'El archivo supera el tamaño máximo de tu plan.',
  too_many_files: 'Has llegado al número máximo de archivos de tu plan.',
  storage_full: 'El archivo no cabe en el espacio que te queda.',
};

async function completeUpload(ctx: Context, req: ApiRequest, env: Env): Promise<ApiResult> {
  if (ctx.caller.status !== 'active') return fail(403, 'not_active', 'Tu cuenta no está activa.');
  const body = bodyOf(req);
  const key = typeof body.key === 'string' ? body.key : '';
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : '';
  if (!keyBelongsTo(ctx.caller.mediaFolder, key)) return fail(403, 'wrong_folder', 'Ese archivo no está en tu carpeta.');
  if (!name) return fail(400, 'bad_request', 'Falta el nombre del archivo.');

  const config = r2OrFail(env);
  if ('status' in config) return config;

  // Tamaño y tipo reales, preguntados a R2: no valen los que diga el navegador
  let head: Response;
  try {
    head = await headObject(config, key);
  } catch (err) {
    return fail(502, 'storage_unreachable', `No se pudo llegar al almacenamiento: ${describe(err)}`);
  }
  if (head.status === 404) return fail(404, 'not_uploaded', 'El archivo no llegó al almacenamiento. Vuelve a subirlo.');
  if (!head.ok) return fail(502, 'storage_error', `El almacenamiento respondió con el código ${head.status}.`);

  const size = Number(head.headers.get('content-length') ?? NaN);
  const mime = (head.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();

  const discard = async (result: ApiResult): Promise<ApiResult> => {
    try {
      await deleteObject(config, key);
    } catch {
      // Si no se pudo borrar, queda un objeto suelto que no cuenta para nadie
    }
    return result;
  };

  if (!isAllowedMime(mime)) return discard(fail(400, 'mime', 'Ese tipo de archivo no se admite. Se ha descartado.'));

  const limits = await readPlanAndUsage(ctx);
  if ('status' in limits) return discard(limits);
  const check = checkUpload(limits.plan, limits.usage, { size, mime });
  if (!check.ok) return discard(fail(413, check.reason, `${check.message} El archivo se ha descartado.`));

  // El registro vuelve a comprobar los límites dentro de la base de datos, con la cuenta bloqueada
  const registered = await ctx.db.rpc('register_media_object', {
    p_profile: ctx.caller.id,
    p_key: key,
    p_name: name,
    p_mime: mime,
    p_size: size,
  });
  if (registered.error) {
    return discard(fail(502, 'register_failed', `No se pudo registrar el archivo: ${registered.error.message}`));
  }
  const outcome = registered.data as { result?: string; file?: unknown } | null;
  if (outcome?.result !== 'ok') {
    const code = outcome?.result ?? 'register_failed';
    return discard(fail(413, code, `${REGISTER_PROBLEM[code] ?? 'No se pudo registrar el archivo.'} El archivo se ha descartado.`));
  }
  return { status: 200, body: { file: outcome.file ?? null } };
}

async function deleteMedia(ctx: Context, req: ApiRequest, env: Env): Promise<ApiResult> {
  const id = bodyOf(req).id;
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return fail(400, 'bad_request', 'Falta el archivo que hay que borrar.');

  const found = await ctx.db.from('media_files').select('id, profile_id, provider, object_key').eq('id', id).maybeSingle();
  if (found.error) return fail(502, 'file_read', `No se pudo leer el archivo: ${found.error.message}`);
  if (!found.data) return fail(404, 'not_found', 'Ese archivo ya no existe.');

  const owner = found.data.profile_id === ctx.caller.id && ctx.caller.status === 'active';
  if (!owner && !isAdmin(ctx.caller)) return fail(403, 'not_yours', 'Ese archivo no es tuyo.');

  if (found.data.provider === 'r2' && typeof found.data.object_key === 'string') {
    const config = r2OrFail(env);
    if ('status' in config) return config;
    try {
      const res = await deleteObject(config, found.data.object_key);
      if (!res.ok && res.status !== 404) {
        return fail(502, 'storage_error', `El almacenamiento respondió con el código ${res.status} al borrar.`);
      }
    } catch (err) {
      return fail(502, 'storage_unreachable', `No se pudo llegar al almacenamiento: ${describe(err)}`);
    }
  }

  const removed = await ctx.db.from('media_files').delete().eq('id', id);
  if (removed.error) return fail(502, 'row_delete', `El archivo se borró, pero no su registro: ${removed.error.message}`);
  return { status: 200, body: { deleted: id } };
}

// ---------- Entrada ----------

export async function handleApi(route: ApiRoute, req: ApiRequest, env: Env = process.env): Promise<ApiResult> {
  if (req.method.toUpperCase() !== ROUTE_METHOD[route]) {
    return fail(405, 'method', `Esta ruta solo admite ${ROUTE_METHOD[route]}.`);
  }
  try {
    const ctx = await identify(req, env);
    if (isResult(ctx)) return ctx;
    switch (route) {
      case 'storage/status':
        return await storageStatus(ctx, env);
      case 'storage/test':
        return await storageTest(ctx, req, env);
      case 'media/upload-session':
        return await uploadSession(ctx, req, env);
      case 'media/complete':
        return await completeUpload(ctx, req, env);
      case 'media/delete':
        return await deleteMedia(ctx, req, env);
    }
  } catch (err) {
    console.error(`[Lalo almacenamiento] ${route}`, err);
    return fail(500, 'server_error', 'El servidor tuvo un error inesperado.');
  }
}

export interface NodeLikeRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}
export interface NodeLikeResponse {
  setHeader(name: string, value: string): unknown;
  status(code: number): { json(body: unknown): unknown };
}

/** Adaptador para Vercel y para Express: los dos entregan (req, res) con esta forma. */
export function nodeHandler(route: ApiRoute) {
  return async (req: NodeLikeRequest, res: NodeLikeResponse): Promise<void> => {
    const result = await handleApi(route, { method: req.method ?? 'GET', headers: req.headers, body: req.body });
    res.setHeader('Cache-Control', 'no-store');
    res.status(result.status).json(result.body);
  };
}
