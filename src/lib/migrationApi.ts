/**
 * src/lib/migrationApi.ts
 *
 * Lado del navegador de «Migrar datos» (consola de administrador): exportar los datos de
 * Supabase a un archivo .sql e importarlos en otro proyecto. El servidor hace el trabajo
 * con sus claves (server/migration/handlers.ts); aquí solo se piden páginas, se arma el
 * archivo y se manda por lotes. Nada de esto toca el almacenamiento de archivos (R2): los
 * archivos se quedan donde están y los registros apuntan a ellos.
 */

import { supabase } from './supabase';
import { noServerMessage } from './serverMessage';
import { DUMP_MAGIC, batchStatements, dumpHeader, parseDump } from '../../server/migration/sqlDump';

export class MigrationApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function call<T>(path: string, method: 'GET' | 'POST', body?: unknown, signal?: AbortSignal): Promise<T> {
  if (!supabase) throw new MigrationApiError('La nube no está configurada en este despliegue.', 'cloud_off', 0);
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new MigrationApiError('Hay que iniciar sesión.', 'no_session', 401);
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      signal,
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw new MigrationApiError('Cancelado.', 'aborted', 0);
    throw new MigrationApiError('No se pudo conectar con el servidor de Tally Studio. Revisa tu conexión.', 'offline', 0);
  }
  const parsed: unknown = (res.headers.get('content-type') ?? '').includes('application/json') ? await res.json().catch(() => null) : null;
  if (!parsed || typeof parsed !== 'object') throw new MigrationApiError(noServerMessage(), 'no_server', res.status);
  if (!res.ok) {
    const info = parsed as { error?: string; code?: string };
    throw new MigrationApiError(info.error || `El servidor respondió con el código ${res.status}.`, info.code || 'error', res.status);
  }
  return parsed as T;
}

// ---------- Plan ----------

export interface MigrationTable {
  name: string;
  /** null si no se pudo contar. */
  rows: number | null;
  columns: number;
}
export interface MigrationPlan {
  source: string;
  tables: MigrationTable[];
  authUsers: number | null;
}

export const fetchMigrationPlan = () => call<MigrationPlan>('/api/migrate/plan', 'GET');

// ---------- Exportar ----------

export interface ExportProgress {
  /** Qué se está leyendo ahora: nombre de tabla o «cuentas de acceso». */
  step: string;
  doneSteps: number;
  totalSteps: number;
  statements: number;
}

export interface ExportResult {
  text: string;
  statements: number;
  tables: number;
  filename: string;
}

interface Page {
  statements: string[];
  consumed: number;
  done: boolean;
}

export async function exportData(opts: {
  source: string;
  tables: string[];
  includeAuth: boolean;
  signal?: AbortSignal;
  onProgress?: (p: ExportProgress) => void;
}): Promise<ExportResult> {
  const lines: string[] = [];
  const steps = [...(opts.includeAuth ? ['auth'] : []), ...opts.tables];
  let doneSteps = 0;
  const report = (step: string) => opts.onProgress?.({ step, doneSteps, totalSteps: steps.length, statements: lines.length });

  for (const step of steps) {
    const isAuth = step === 'auth';
    const label = isAuth ? 'cuentas de acceso' : step;
    let cursor = isAuth ? 1 : 0;
    report(label);
    for (;;) {
      const page = await call<Page>(
        '/api/migrate/export',
        'POST',
        isAuth ? { auth: true, page: cursor } : { table: step, offset: cursor },
        opts.signal
      );
      lines.push(...page.statements);
      cursor = isAuth ? cursor + 1 : cursor + Math.max(1, page.consumed);
      report(label);
      if (page.done) break;
    }
    doneSteps++;
    report(label);
  }

  const when = new Date().toISOString();
  const text =
    [...dumpHeader({ source: opts.source, when, tables: opts.tables, authUsers: opts.includeAuth }), ...lines].join('\n') + '\n';
  return { text, statements: lines.length, tables: opts.tables.length, filename: `tally-datos-${when.slice(0, 10)}.sql` };
}

/** Descarga un texto como archivo desde el navegador. */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/sql;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---------- Importar ----------

export interface ImportTarget {
  ref: string;
  token: string;
}

export interface ImportProgress {
  batch: number;
  totalBatches: number;
  applied: number;
  totalStatements: number;
}

/** Comprueba que el token y la referencia del proyecto destino responden, sin escribir nada. */
export const checkImportTarget = (target: ImportTarget, signal?: AbortSignal) =>
  call<{ applied: number }>('/api/migrate/import', 'POST', { ...target, statements: [] }, signal);

/** Lee un archivo .sql de exportación y dice cuántas sentencias trae, o por qué no sirve. */
export function readDump(text: string): { statements: string[]; problem: string | null; hasMagic: boolean } {
  const parsed = parseDump(text);
  return { ...parsed, hasMagic: text.includes(DUMP_MAGIC) };
}

export async function importData(opts: {
  statements: string[];
  target: ImportTarget;
  signal?: AbortSignal;
  onProgress?: (p: ImportProgress) => void;
}): Promise<{ applied: number }> {
  const batches = batchStatements(opts.statements);
  let applied = 0;
  opts.onProgress?.({ batch: 0, totalBatches: batches.length, applied, totalStatements: opts.statements.length });
  for (let i = 0; i < batches.length; i++) {
    const res = await call<{ applied: number }>('/api/migrate/import', 'POST', { ...opts.target, statements: batches[i] }, opts.signal);
    applied += res.applied;
    opts.onProgress?.({ batch: i + 1, totalBatches: batches.length, applied, totalStatements: opts.statements.length });
  }
  return { applied };
}
