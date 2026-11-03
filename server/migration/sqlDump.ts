/**
 * server/migration/sqlDump.ts
 *
 * Formato del archivo .sql de exportación/importación de datos y sus reglas.
 * Todo son funciones puras: las usan el servidor (exportar y validar lo que se
 * importa) y el navegador (leer el archivo y partirlo en lotes).
 *
 * Formato: una sentencia por línea, siempre una de estas:
 *   INSERT INTO public.<tabla> (...) OVERRIDING SYSTEM VALUE VALUES (...) ON CONFLICT (...) DO UPDATE ...;
 *   INSERT INTO auth.users (...) ... ON CONFLICT (id) DO NOTHING;
 *   INSERT INTO auth.identities (...) ... ON CONFLICT (provider_id, provider) DO NOTHING;
 *   SELECT setval(pg_get_serial_sequence('public.<tabla>', 'id'), ...) FROM public.<tabla>;
 *   DELETE FROM public."<tabla>";   (solo sin WHERE, al empezar cada tabla: ver deleteStatement)
 * Los textos van como E'...' con \n, \\ y '' escapados, así que ninguna sentencia
 * ocupa más de una línea. Las líneas que empiezan por «--» son comentarios.
 *
 * El importador SOLO acepta ese formato (checkStatement): una línea que no lo
 * cumple se rechaza entera. Así el archivo no puede colar otra cosa (DROP, otra
 * sentencia detrás de un «;», comentarios que cambien el sentido, $$...$$).
 */

export const DUMP_MAGIC = '-- tally-studio-dump v1';

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

export interface ColumnInfo {
  name: string;
  /** Tipo tal como lo describe PostgREST (format): uuid, text, jsonb, text[], timestamp with time zone... */
  type: string;
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  /** Columnas de la clave primaria, en orden. */
  pk: string[];
}

const isIdent = (name: string) => IDENT.test(name);
const q = (name: string): string => {
  if (!isIdent(name)) throw new Error(`Nombre no permitido: ${name}`);
  return `"${name}"`;
};

// ---------- Valores ----------

/** Texto como literal E'...': una sola línea, sin depender de standard_conforming_strings. */
export function sqlString(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0) continue; // el carácter nulo no existe en un texto de PostgreSQL
    if (ch === "'") out += "''";
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, '0')}`;
    else out += ch;
  }
  return `E'${out}'`;
}

function arrayElement(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  const text = typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

const isArrayType = (type: string) => type.endsWith('[]') || type.startsWith('_');

/** Literal SQL de un valor según el tipo de su columna. */
export function sqlValue(value: unknown, type: string): string {
  if (value === null || value === undefined) return 'NULL';
  if (isArrayType(type)) {
    if (!Array.isArray(value)) return 'NULL';
    return `${sqlString(`{${value.map(arrayElement).join(',')}}`)}`;
  }
  if (type === 'json' || type === 'jsonb') return `${sqlString(JSON.stringify(value))}::${type}`;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'object') return `${sqlString(JSON.stringify(value))}::jsonb`;
  return sqlString(String(value));
}

// ---------- Sentencias ----------

/** Una sentencia INSERT por fila. Con clave primaria, si la fila ya existe se actualiza (gana lo exportado). */
export function insertStatements(table: TableInfo, rows: Record<string, unknown>[]): string[] {
  if (rows.length === 0) return [];
  const cols = table.columns;
  const names = cols.map((c) => q(c.name)).join(', ');
  const nonPk = cols.filter((c) => !table.pk.includes(c.name));
  const conflict =
    table.pk.length === 0
      ? ' ON CONFLICT DO NOTHING'
      : nonPk.length === 0
        ? ` ON CONFLICT (${table.pk.map(q).join(', ')}) DO NOTHING`
        : ` ON CONFLICT (${table.pk.map(q).join(', ')}) DO UPDATE SET ${nonPk.map((c) => `${q(c.name)} = EXCLUDED.${q(c.name)}`).join(', ')}`;
  return rows.map(
    (row) =>
      `INSERT INTO public.${q(table.name)} (${names}) OVERRIDING SYSTEM VALUE VALUES (${cols
        .map((c) => sqlValue(row[c.name], c.type))
        .join(', ')})${conflict};`
  );
}

/**
 * Vacía la tabla en el destino antes de cargarla. Las migraciones siembran filas (planes, el personaje Lux por
 * defecto...) con ids que no coinciden con los del origen y chocarían con sus restricciones únicas: tras
 * importar, cada tabla exportada queda como en el origen.
 */
export const deleteStatement = (table: TableInfo): string => `DELETE FROM public.${q(table.name)};`;

const INTEGER_TYPES = ['integer', 'bigint', 'smallint', 'int4', 'int8', 'int2'];

/** Reajusta la secuencia de la columna `id` si la tabla la tiene (identity o serial). null si no aplica. */
export function setvalStatement(table: TableInfo): string | null {
  const id = table.columns.find((c) => c.name === 'id');
  if (!id || !INTEGER_TYPES.includes(id.type) || table.pk.length !== 1 || table.pk[0] !== 'id') return null;
  const t = q(table.name);
  return `SELECT setval(pg_get_serial_sequence('public.${table.name}', 'id'), COALESCE(MAX("id"), 1), MAX("id") IS NOT NULL) FROM public.${t};`;
}

// ---------- Esquema (OpenAPI de PostgREST) ----------

interface OpenApiProperty {
  format?: string;
  type?: string;
  description?: string;
}
interface OpenApiDoc {
  definitions?: Record<string, { properties?: Record<string, OpenApiProperty> }>;
}

/** Tablas de `public` con sus columnas y claves primarias, a partir del OpenAPI que publica PostgREST. */
export function tablesFromOpenApi(doc: unknown): TableInfo[] {
  const defs = (doc as OpenApiDoc | null)?.definitions ?? {};
  const tables: TableInfo[] = [];
  for (const [name, def] of Object.entries(defs)) {
    if (!isIdent(name)) continue;
    const props = def.properties ?? {};
    const columns: ColumnInfo[] = [];
    const pk: string[] = [];
    for (const [col, prop] of Object.entries(props)) {
      if (!isIdent(col)) continue;
      columns.push({ name: col, type: (prop.format ?? prop.type ?? 'text').toLowerCase() });
      if ((prop.description ?? '').includes('<pk')) pk.push(col);
    }
    if (columns.length > 0) tables.push({ name, columns, pk });
  }
  return tables.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- Usuarios de Supabase Auth ----------

export interface AuthUserLike {
  id: string;
  email?: string | null;
  phone?: string | null;
  created_at?: string;
  updated_at?: string | null;
  last_sign_in_at?: string | null;
  email_confirmed_at?: string | null;
  app_metadata?: Record<string, unknown> | null;
  user_metadata?: Record<string, unknown> | null;
  identities?: {
    identity_id?: string;
    id?: string;
    user_id?: string;
    identity_data?: Record<string, unknown> | null;
    provider?: string;
    created_at?: string;
    updated_at?: string | null;
    last_sign_in_at?: string | null;
  }[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Cuentas de acceso. La contraseña no se exporta (Supabase no la entrega): quien entra con correo y
 * clave tendrá que restablecerla. Quien entra con Twitch conserva su cuenta: se copian también sus identidades.
 */
export function authStatements(users: AuthUserLike[]): string[] {
  const out: string[] = [];
  for (const user of users) {
    if (!UUID.test(user.id)) continue;
    const ts = (v: string | null | undefined) => (v ? sqlString(v) : 'NULL');
    out.push(
      `INSERT INTO auth.users (id, instance_id, aud, role, email, email_confirmed_at, phone, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, last_sign_in_at) VALUES (${[
        sqlString(user.id),
        sqlString(ZERO_UUID),
        sqlString('authenticated'),
        sqlString('authenticated'),
        user.email ? sqlString(user.email) : 'NULL',
        ts(user.email_confirmed_at ?? (user.email ? user.created_at : null)),
        user.phone ? sqlString(user.phone) : 'NULL',
        `${sqlString(JSON.stringify(user.app_metadata ?? {}))}::jsonb`,
        `${sqlString(JSON.stringify(user.user_metadata ?? {}))}::jsonb`,
        user.created_at ? sqlString(user.created_at) : 'now()',
        user.updated_at ? sqlString(user.updated_at) : 'now()',
        ts(user.last_sign_in_at),
      ].join(', ')}) ON CONFLICT (id) DO NOTHING;`
    );
    for (const identity of user.identities ?? []) {
      if (!identity.provider || !identity.id) continue;
      const identityId = identity.identity_id && UUID.test(identity.identity_id) ? sqlString(identity.identity_id) : 'gen_random_uuid()';
      out.push(
        `INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at) VALUES (${[
          identityId,
          sqlString(identity.id),
          sqlString(user.id),
          `${sqlString(JSON.stringify(identity.identity_data ?? {}))}::jsonb`,
          sqlString(identity.provider),
          ts(identity.last_sign_in_at),
          identity.created_at ? sqlString(identity.created_at) : 'now()',
          identity.updated_at ? sqlString(identity.updated_at) : 'now()',
        ].join(', ')}) ON CONFLICT (provider_id, provider) DO NOTHING;`
      );
    }
  }
  return out;
}

// ---------- Validar lo que se importa ----------

const ALLOWED_START = [
  /^INSERT INTO public\."[a-z_][a-z0-9_]*" \(/,
  /^INSERT INTO auth\.users \(/,
  /^INSERT INTO auth\.identities \(/,
  /^DELETE FROM public\."[a-z_][a-z0-9_]*";$/,
  /^SELECT setval\(pg_get_serial_sequence\('public\.[a-z_][a-z0-9_]*', 'id'\), /,
];

/** Longitud máxima de una sentencia. Una fila normal pesa mucho menos; esto frena archivos manipulados. */
export const MAX_STATEMENT_CHARS = 500_000;

/**
 * null si la línea es una sentencia permitida; si no, el motivo. Recorre la línea respetando los textos entre
 * comillas: fuera de ellos no puede haber «;» salvo el último carácter, ni comentarios, ni «$».
 */
export function checkStatement(line: string): string | null {
  if (line.length > MAX_STATEMENT_CHARS) return 'una sentencia es demasiado larga';
  if (!ALLOWED_START.some((re) => re.test(line))) return 'empieza por algo que no es un INSERT de datos de Tally Studio';
  if (!line.endsWith(';')) return 'no termina en «;»';
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "'") {
      const escape = i > 0 && (line[i - 1] === 'E' || line[i - 1] === 'e') && (i < 2 || !/[A-Za-z0-9_]/.test(line[i - 2]));
      i++;
      for (;;) {
        if (i >= line.length) return 'un texto entre comillas no se cierra';
        if (escape && line[i] === '\\') {
          i += 2;
          continue;
        }
        if (line[i] === "'") {
          if (line[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === ';' && i !== line.length - 1) return 'hay más de una sentencia en la misma línea';
    if (ch === '$') return 'contiene «$» fuera de un texto';
    if (ch === '-' && line[i + 1] === '-') return 'contiene un comentario dentro de la sentencia';
    if (ch === '/' && line[i + 1] === '*') return 'contiene un comentario dentro de la sentencia';
    i++;
  }
  return null;
}

export interface ParsedDump {
  statements: string[];
  /** Primer problema encontrado, con su número de línea, o null. */
  problem: string | null;
}

/** Lee el texto de un archivo de exportación. Debe empezar con la marca del formato. */
export function parseDump(text: string): ParsedDump {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (!lines.some((l) => l.trim() === DUMP_MAGIC)) {
    return { statements: [], problem: 'Este archivo no es una exportación de Tally Studio (falta la marca de formato).' };
  }
  const statements: string[] = [];
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (!line.trim() || line.startsWith('--')) continue;
    const why = checkStatement(line);
    if (why) return { statements: [], problem: `Línea ${n + 1} rechazada: ${why}.` };
    statements.push(line);
  }
  return { statements, problem: null };
}

/** Agrupa sentencias en lotes que caben en una petición (Vercel no admite cuerpos de más de 4,5 MB). */
export function batchStatements(statements: string[], maxBytes = 900_000, maxCount = 200): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const s of statements) {
    const bytes = s.length + 1;
    if (current.length > 0 && (size + bytes > maxBytes || current.length >= maxCount)) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(s);
    size += bytes;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** Texto SQL de un lote: sin disparadores ni comprobaciones de claves foráneas, todo o nada. */
export function batchSql(statements: string[]): string {
  return `BEGIN;\nSET LOCAL session_replication_role = replica;\n${statements.join('\n')}\nCOMMIT;`;
}

export function dumpHeader(info: { source: string; when: string; tables: string[]; authUsers: boolean }): string[] {
  return [
    DUMP_MAGIC,
    `-- Exportación de datos de Tally Studio · ${info.when}`,
    `-- Origen: ${info.source}`,
    `-- Tablas: ${info.tables.join(', ') || '(ninguna)'}${info.authUsers ? ' + cuentas de acceso (auth)' : ''}`,
    '-- Contiene datos privados y secretos cifrados. Trátalo como una contraseña.',
    '-- Importar: consola de administrador > Migrar datos. Antes hay que aplicar supabase/baseline/0001_lalo_baseline.sql en el proyecto destino.',
  ];
}
