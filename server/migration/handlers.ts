/**
 * server/migration/handlers.ts
 *
 * Exportar los datos del proyecto Supabase actual a un archivo .sql e importarlos en
 * otro proyecto. Solo administrador. Rutas (grupo «migrate» de api/integraciones.ts):
 *
 *   GET  /api/migrate/plan     tablas que hay y cuántas filas tiene cada una
 *   POST /api/migrate/export   {table, offset, limit?} o {auth: true, page}: devuelve sentencias SQL
 *   POST /api/migrate/import   {ref, token, statements}: las ejecuta en el proyecto destino
 *
 * Exportar lee con la clave de servicio, página a página (Vercel no devuelve respuestas de
 * más de 4,5 MB). Importar manda cada lote a la API de gestión de Supabase
 * (POST https://api.supabase.com/v1/projects/{ref}/database/query), que ejecuta SQL con un
 * token de acceso personal del dueño del proyecto destino. El token solo vive en esa petición:
 * no se guarda, no se escribe en el registro y no se devuelve.
 *
 * Lo que se importa se revisa línea a línea con checkStatement (sqlDump.ts): solo INSERT de
 * datos de Tally Studio, el DELETE (sin WHERE) que vacía cada tabla antes de cargarla y el
 * reajuste de secuencias.
 *
 * SIN PROBAR contra Supabase reales (ni el OpenAPI de PostgREST, ni la API de gestión).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { fail, isFail, defaultDeps, type Deps, type IntegrationRequest, type IntegrationResult } from '../integrations/http.js';
import type { Env } from '../integrations/store.js';
import {
  authStatements,
  batchSql,
  checkStatement,
  deleteStatement,
  insertStatements,
  setvalStatement,
  tablesFromOpenApi,
  type AuthUserLike,
  type TableInfo,
} from './sqlDump.js';

export const MIGRATION_ACTIONS = ['plan', 'export', 'import'] as const;
export type MigrationAction = (typeof MIGRATION_ACTIONS)[number];

const MANAGEMENT_API = 'https://api.supabase.com';
const PROJECT_REF = /^[a-z]{20}$/;
const ACCESS_TOKEN = /^[A-Za-z0-9_-]{20,200}$/;
const MAX_IMPORT_STATEMENTS = 500;
const MAX_IMPORT_CHARS = 3_500_000;
/** Tope de lo que devuelve una página de exportación (Vercel corta en 4,5 MB). */
const MAX_EXPORT_CHARS = 3_000_000;
const DEFAULT_PAGE = 250;

export interface MigrationDeps extends Deps {
  client: (env: Env) => SupabaseClient | null;
}

export const defaultMigrationDeps: MigrationDeps = {
  ...defaultDeps,
  client: (env) => {
    const url = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '').trim();
    const key = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
    return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  },
};

const supabaseUrl = (env: Env) => (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');

function bodyOf(req: IntegrationRequest): Record<string, unknown> {
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

const asInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Tablas de `public`, según el OpenAPI que publica PostgREST (solo lo ve la clave de servicio). */
async function readTables(env: Env, deps: MigrationDeps): Promise<TableInfo[] | IntegrationResult> {
  const key = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  let res: Response;
  try {
    res = await deps.fetch(`${supabaseUrl(env)}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' },
    });
  } catch {
    return fail(502, 'db_unreachable', 'No se pudo hablar con Supabase para leer la lista de tablas.');
  }
  if (!res.ok) return fail(502, 'schema_read', `Supabase no entregó la lista de tablas (código ${res.status}).`);
  const tables = tablesFromOpenApi(await res.json().catch(() => null));
  if (tables.length === 0) {
    return fail(502, 'schema_empty', 'Supabase no devolvió ninguna tabla. Comprueba que las migraciones están aplicadas.');
  }
  return tables;
}

async function admin(req: IntegrationRequest, env: Env, deps: MigrationDeps): Promise<IntegrationResult | null> {
  const caller = await deps.auth(req, env);
  if (isFail(caller)) return caller;
  return caller.role === 'admin' ? null : fail(403, 'not_admin', 'Solo para administradores.');
}

// ---------- plan ----------

async function plan(req: IntegrationRequest, env: Env, deps: MigrationDeps, db: SupabaseClient): Promise<IntegrationResult> {
  if (req.method.toUpperCase() !== 'GET') return fail(405, 'method', 'Esta ruta solo admite GET.');
  const tables = await readTables(env, deps);
  if (!Array.isArray(tables)) return tables;
  const counted = await Promise.all(
    tables.map(async (t) => {
      const { count, error } = await db.from(t.name).select('*', { count: 'exact', head: true });
      return { name: t.name, rows: error ? null : (count ?? 0), columns: t.columns.length };
    })
  );
  const users = await db.auth.admin.listUsers({ page: 1, perPage: 1 }).catch(() => null);
  const total = (users?.data as { total?: number } | undefined)?.total;
  return {
    status: 200,
    body: {
      source: new URL(supabaseUrl(env)).host,
      tables: counted,
      authUsers: typeof total === 'number' ? total : null,
    },
  };
}

// ---------- export ----------

async function exportPage(req: IntegrationRequest, env: Env, deps: MigrationDeps, db: SupabaseClient): Promise<IntegrationResult> {
  if (req.method.toUpperCase() !== 'POST') return fail(405, 'method', 'Esta ruta solo admite POST.');
  const body = bodyOf(req);

  if (body.auth === true) {
    const perPage = asInt(body.perPage, 100, 1, 200);
    const page = asInt(body.page, 1, 1, 100_000);
    const { data, error } = await db.auth.admin.listUsers({ page, perPage });
    if (error) return fail(502, 'auth_read', 'No se pudieron leer las cuentas de acceso de Supabase.');
    const users = data.users as unknown as AuthUserLike[];
    return { status: 200, body: { statements: authStatements(users), consumed: users.length, done: users.length < perPage } };
  }

  const name = typeof body.table === 'string' ? body.table : '';
  const tables = await readTables(env, deps);
  if (!Array.isArray(tables)) return tables;
  const table = tables.find((t) => t.name === name);
  if (!table) return fail(400, 'bad_table', 'Esa tabla no existe en este proyecto.');

  const offset = asInt(body.offset, 0, 0, 100_000_000);
  const limit = asInt(body.limit, DEFAULT_PAGE, 1, 500);
  const orderBy = table.pk.length > 0 ? table.pk : [table.columns[0].name];
  let query = db.from(table.name).select(table.columns.map((c) => c.name).join(','));
  for (const column of orderBy) query = query.order(column, { ascending: true });
  const { data, error } = await query.range(offset, offset + limit - 1);
  if (error) return fail(502, 'table_read', `No se pudo leer la tabla ${table.name}.`);

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  // La primera página de cada tabla la vacía en el destino (ver deleteStatement)
  const statements: string[] = offset === 0 ? [deleteStatement(table)] : [];
  let chars = 0;
  let consumed = 0;
  for (const row of rows) {
    const [statement] = insertStatements(table, [row]);
    if (consumed > 0 && chars + statement.length > MAX_EXPORT_CHARS) break;
    statements.push(statement);
    chars += statement.length + 1;
    consumed++;
  }
  const done = consumed === rows.length && rows.length < limit;
  if (done) {
    const setval = setvalStatement(table);
    if (setval) statements.push(setval);
  }
  return { status: 200, body: { statements, consumed, done } };
}

// ---------- import ----------

/** Referencia del proyecto de esta app (la primera parte del host de SUPABASE_URL). */
const sourceRef = (env: Env): string => {
  try {
    return new URL(supabaseUrl(env)).hostname.split('.')[0];
  } catch {
    return '';
  }
};

async function importBatch(req: IntegrationRequest, env: Env, deps: MigrationDeps): Promise<IntegrationResult> {
  if (req.method.toUpperCase() !== 'POST') return fail(405, 'method', 'Esta ruta solo admite POST.');
  const body = bodyOf(req);
  const ref = typeof body.ref === 'string' ? body.ref.trim().toLowerCase() : '';
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!PROJECT_REF.test(ref)) return fail(400, 'bad_ref', 'La referencia del proyecto destino son 20 letras minúsculas (está en la dirección del panel de Supabase).');
  if (!ACCESS_TOKEN.test(token)) return fail(400, 'bad_token', 'El token de acceso no tiene el formato esperado. Se crea en supabase.com/dashboard/account/tokens.');
  if (ref === sourceRef(env)) return fail(400, 'same_project', 'El destino es el mismo proyecto que este. Elige el proyecto nuevo.');

  const statements = Array.isArray(body.statements) ? body.statements : [];
  if (statements.length > MAX_IMPORT_STATEMENTS) return fail(400, 'too_many', `Cada envío admite hasta ${MAX_IMPORT_STATEMENTS} sentencias.`);
  let chars = 0;
  for (const s of statements) {
    if (typeof s !== 'string') return fail(400, 'bad_statement', 'Hay una sentencia que no es texto.');
    const why = checkStatement(s);
    if (why) return fail(400, 'bad_statement', `Sentencia rechazada: ${why}.`);
    chars += s.length + 1;
  }
  if (chars > MAX_IMPORT_CHARS) return fail(413, 'too_large', 'El envío es demasiado grande.');

  // Sin sentencias solo se comprueba que el token y el proyecto responden
  const query = statements.length === 0 ? 'SELECT 1 AS ok;' : batchSql(statements as string[]);
  let res: Response;
  try {
    res = await deps.fetch(`${MANAGEMENT_API}/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
  } catch {
    return fail(502, 'target_unreachable', 'No se pudo conectar con la API de Supabase.');
  }
  if (res.status === 401) return fail(401, 'target_token', 'Supabase no aceptó el token de acceso.');
  if (res.status === 403) return fail(403, 'target_forbidden', 'Ese token no tiene permiso sobre el proyecto destino.');
  if (res.status === 404) return fail(404, 'target_not_found', 'Supabase no encuentra ese proyecto. Revisa la referencia.');
  if (res.status === 429) return fail(429, 'target_rate', 'Supabase pide ir más despacio. Espera un minuto y reintenta.');
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
    return fail(502, 'target_error', `El proyecto destino rechazó el lote (código ${res.status}). ${detail}`.trim());
  }
  return { status: 200, body: { applied: statements.length } };
}

// ---------- entrada ----------

export async function handleMigration(
  action: MigrationAction,
  req: IntegrationRequest,
  env: Env = process.env,
  overrides: Partial<MigrationDeps> = {}
): Promise<IntegrationResult> {
  const deps: MigrationDeps = { ...defaultMigrationDeps, ...overrides };
  try {
    const denied = await admin(req, env, deps);
    if (denied) return denied;
    if (action === 'import') return await importBatch(req, env, deps);
    const db = deps.client(env);
    if (!db) return fail(503, 'server_not_configured', 'Al servidor le falta configuración de Supabase.');
    return action === 'plan' ? await plan(req, env, deps, db) : await exportPage(req, env, deps, db);
  } catch (err) {
    console.error(`[Tally Studio migrar] ${action}`, err instanceof Error ? err.message : 'error');
    return fail(500, 'server_error', 'El servidor tuvo un error inesperado.');
  }
}
