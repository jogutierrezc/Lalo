import { describe, expect, it, vi } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

import {
  DUMP_MAGIC,
  authStatements,
  batchSql,
  batchStatements,
  checkStatement,
  deleteStatement,
  insertStatements,
  parseDump,
  setvalStatement,
  sqlString,
  sqlValue,
  tablesFromOpenApi,
  type TableInfo,
} from '../server/migration/sqlDump';
import { handleMigration, type MigrationDeps } from '../server/migration/handlers';

const OPENAPI = {
  definitions: {
    plans: {
      properties: {
        id: { format: 'text', description: 'Note:\nThis is a Primary Key.<pk/>' },
        name: { format: 'text' },
        limits: { format: 'jsonb' },
        tags: { format: 'text[]' },
        price: { format: 'numeric' },
        active: { format: 'boolean' },
      },
    },
    twitch_events: {
      properties: { id: { format: 'bigint', description: '<pk/>' }, kind: { format: 'text' } },
    },
    'bad-name': { properties: { a: { format: 'text' } } },
  },
};

const plans = (): TableInfo => tablesFromOpenApi(OPENAPI).find((t) => t.name === 'plans')!;

describe('literales SQL', () => {
  it('escapa comillas, barras y saltos de línea en una sola línea', () => {
    const lit = sqlString("it's a\\b\nc\td");
    expect(lit).toBe("E'it''s a\\\\b\\nc\\td'");
    expect(lit).not.toContain('\n');
  });

  it('no deja pasar el carácter nulo ni controles', () => {
    expect(sqlString('a\u0000b\u0001')).toBe("E'ab\\x01'");
  });

  it('formatea cada tipo', () => {
    expect(sqlValue(null, 'text')).toBe('NULL');
    expect(sqlValue(true, 'boolean')).toBe('true');
    expect(sqlValue(12.5, 'numeric')).toBe('12.5');
    expect(sqlValue({ a: "x'y" }, 'jsonb')).toBe(`E'{"a":"x''y"}'::jsonb`);
    expect(sqlValue(['a', 'b"c'], 'text[]')).toBe(`E'{"a","b\\\\"c"}'`);
    expect(sqlValue([1, 2], 'jsonb')).toBe(`E'[1,2]'::jsonb`);
  });
});

describe('esquema desde PostgREST', () => {
  it('lee tablas, tipos y clave primaria, y descarta nombres raros', () => {
    const tables = tablesFromOpenApi(OPENAPI);
    expect(tables.map((t) => t.name)).toEqual(['plans', 'twitch_events']);
    expect(plans().pk).toEqual(['id']);
    expect(plans().columns.find((c) => c.name === 'tags')?.type).toBe('text[]');
  });
});

describe('INSERT de exportación', () => {
  it('hace upsert por clave primaria y una línea por fila', () => {
    const [sql] = insertStatements(plans(), [{ id: 'free', name: "Gratis 'x'", limits: { a: 1 }, tags: ['t'], price: 0, active: true }]);
    expect(sql).toMatch(/^INSERT INTO public\."plans" \("id", "name", "limits", "tags", "price", "active"\) OVERRIDING SYSTEM VALUE VALUES /);
    expect(sql).toContain('ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name"');
    expect(sql.endsWith(';')).toBe(true);
    expect(sql).not.toContain('\n');
    expect(checkStatement(sql)).toBeNull();
  });

  it('una fila con texto hostil sigue siendo una sentencia válida', () => {
    const [sql] = insertStatements(plans(), [{ id: "x'); DROP TABLE plans; --", name: 'a;\nDROP TABLE b;', limits: null, tags: null, price: null, active: null }]);
    expect(checkStatement(sql)).toBeNull();
  });

  it('reajusta la secuencia solo en tablas con id entero', () => {
    const tables = tablesFromOpenApi(OPENAPI);
    expect(setvalStatement(tables.find((t) => t.name === 'twitch_events')!)).toMatch(/^SELECT setval\(pg_get_serial_sequence\('public\.twitch_events', 'id'\)/);
    expect(setvalStatement(plans())).toBeNull();
    expect(checkStatement(setvalStatement(tables.find((t) => t.name === 'twitch_events')!)!)).toBeNull();
  });
});

describe('cuentas de acceso', () => {
  const user = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'a@b.co',
    created_at: '2026-01-01T00:00:00Z',
    app_metadata: { provider: 'twitch' },
    user_metadata: { name: "O'Neil" },
    identities: [{ identity_id: '22222222-2222-4222-8222-222222222222', id: '999', provider: 'twitch', identity_data: { sub: '999' } }],
  };

  it('copia usuario e identidad con sentencias válidas', () => {
    const out = authStatements([user]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatch(/^INSERT INTO auth\.users /);
    expect(out[1]).toMatch(/^INSERT INTO auth\.identities /);
    out.forEach((s) => expect(checkStatement(s)).toBeNull());
  });

  it('ignora ids que no son uuid', () => {
    expect(authStatements([{ ...user, id: "x'; drop" }])).toEqual([]);
  });
});

describe('validación de lo que se importa', () => {
  it.each([
    ['DROP TABLE public."plans";'],
    ['INSERT INTO public."plans" ("id") VALUES (E\'a\'); DROP TABLE x;'],
    ['INSERT INTO public."plans" ("id") VALUES (E\'a\') -- y'],
    ['INSERT INTO public."plans" ("id") VALUES ($$a$$);'],
    ['INSERT INTO public."plans" ("id") VALUES (E\'a);'],
    ['INSERT INTO public."plans" ("id") VALUES (E\'a\')'],
    ['INSERT INTO pg_catalog.pg_class (a) VALUES (1);'],
    ['INSERT INTO storage.objects (a) VALUES (1);'],
  ])('rechaza %s', (line) => {
    expect(checkStatement(line)).not.toBeNull();
  });

  it('acepta el DELETE de tabla completa que emite la exportación', () => {
    expect(checkStatement(deleteStatement(plans()))).toBeNull();
  });

  it('acepta un punto y coma dentro de un texto', () => {
    expect(checkStatement(`INSERT INTO public."plans" ("id") VALUES (E'a; b -- c $x');`)).toBeNull();
  });

  it('rechaza archivos sin la marca de formato y señala la línea mala', () => {
    expect(parseDump('INSERT INTO public."plans" ("id") VALUES (1);').problem).toMatch(/no es una exportación/);
    const bad = `${DUMP_MAGIC}\n-- hola\nINSERT INTO public."plans" ("id") VALUES (E'a');\nDROP TABLE x;\n`;
    expect(parseDump(bad).problem).toMatch(/Línea 4/);
    const ok = parseDump(`${DUMP_MAGIC}\n-- hola\n\nINSERT INTO public."plans" ("id") VALUES (E'a');\n`);
    expect(ok.problem).toBeNull();
    expect(ok.statements).toHaveLength(1);
  });
});

describe('lotes', () => {
  it('parte por cantidad y por tamaño sin perder sentencias', () => {
    const all = Array.from({ length: 450 }, (_, i) => `INSERT INTO public."t" ("a") VALUES (${i});`);
    const batches = batchStatements(all, 900_000, 200);
    expect(batches.map((b) => b.length)).toEqual([200, 200, 50]);
    expect(batches.flat()).toEqual(all);
    expect(batchStatements(['a'.repeat(60), 'b'.repeat(60)], 100, 200)).toHaveLength(2);
  });

  it('cada lote va en una transacción sin disparadores', () => {
    const sql = batchSql(['X;']);
    expect(sql).toBe('BEGIN;\nSET LOCAL session_replication_role = replica;\nX;\nCOMMIT;');
  });
});

// ---------- Rutas ----------

const IMPORT_LINE = `INSERT INTO public."plans" ("id") OVERRIDING SYSTEM VALUE VALUES (E'free') ON CONFLICT ("id") DO NOTHING;`;
const REF = 'abcdefghijklmnopqrst';
const TOKEN = 'sbp_' + 'a'.repeat(40);
const ENV = { SUPABASE_URL: 'https://zzzzzzzzzzzzzzzzzzzz.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srv' };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function deps(role: string, fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, client: unknown = null): Partial<MigrationDeps> {
  return {
    auth: async () => ({ id: 'u1', role, status: 'active' }),
    fetch: fetchImpl as typeof fetch,
    client: () => client as never,
  };
}

const post = (body: unknown) => ({ method: 'POST', headers: {}, query: {}, body });

describe('POST /api/migrate/import', () => {
  it('solo el administrador', async () => {
    const res = await handleMigration('import', post({ ref: REF, token: TOKEN, statements: [IMPORT_LINE] }), ENV, deps('streamer', async () => json(200, [])));
    expect(res.status).toBe(403);
  });

  it('rechaza referencia o token mal formados y el mismo proyecto', async () => {
    const f = vi.fn(async () => json(200, []));
    const d = deps('admin', f);
    expect((await handleMigration('import', post({ ref: 'x', token: TOKEN, statements: [] }), ENV, d)).body.code).toBe('bad_ref');
    expect((await handleMigration('import', post({ ref: REF, token: 'corto', statements: [] }), ENV, d)).body.code).toBe('bad_token');
    expect((await handleMigration('import', post({ ref: 'zzzzzzzzzzzzzzzzzzzz', token: TOKEN, statements: [] }), ENV, d)).body.code).toBe('same_project');
    expect(f).not.toHaveBeenCalled();
  });

  it('no manda nada a Supabase si una sentencia no es de datos', async () => {
    const f = vi.fn(async () => json(200, []));
    const res = await handleMigration('import', post({ ref: REF, token: TOKEN, statements: [IMPORT_LINE, 'DROP TABLE public."plans";'] }), ENV, deps('admin', f));
    expect(res.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });

  it('envía el lote a la API de gestión con el token y sin devolverlo', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => json(201, []));
    const res = await handleMigration('import', post({ ref: REF, token: TOKEN, statements: [IMPORT_LINE] }), ENV, deps('admin', f));
    expect(res).toMatchObject({ status: 200, body: { applied: 1 } });
    expect(JSON.stringify(res)).not.toContain(TOKEN);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(`https://api.supabase.com/v1/projects/${REF}/database/query`);
    expect((init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(init!.body)).query).toBe(batchSql([IMPORT_LINE]));
  });

  it('sin sentencias solo comprueba la conexión', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => json(201, [{ ok: 1 }]));
    const res = await handleMigration('import', post({ ref: REF, token: TOKEN, statements: [] }), ENV, deps('admin', f));
    expect(res.body.applied).toBe(0);
    expect(JSON.parse(String(f.mock.calls[0][1]!.body)).query).toBe('SELECT 1 AS ok;');
  });

  it('traduce los errores de la API', async () => {
    const run = (status: number) =>
      handleMigration('import', post({ ref: REF, token: TOKEN, statements: [] }), ENV, deps('admin', async () => json(status, { message: 'x' })));
    expect((await run(401)).body.code).toBe('target_token');
    expect((await run(404)).body.code).toBe('target_not_found');
    expect((await run(500)).body.code).toBe('target_error');
  });
});

describe('POST /api/migrate/export', () => {
  function fakeClient(rows: Record<string, unknown>[]) {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.order = () => chain;
    chain.range = async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null });
    return { from: () => chain, auth: { admin: { listUsers: async () => ({ data: { users: [] }, error: null }) } } };
  }
  const openapi = async () => json(200, OPENAPI);

  it('exporta una página y cierra con done=true', async () => {
    const res = await handleMigration('export', post({ table: 'plans', offset: 0 }), ENV, deps('admin', openapi, fakeClient([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }])));
    expect(res.status).toBe(200);
    const body = res.body as { statements: string[]; consumed: number; done: boolean };
    expect(body.statements).toHaveLength(3); // DELETE inicial + 2 filas
    expect(body.statements[0]).toBe('DELETE FROM public."plans";');
    expect(body.consumed).toBe(2);
    expect(body.done).toBe(true);
    body.statements.forEach((s) => expect(checkStatement(s)).toBeNull());
  });

  it('pagina: con tantas filas como el límite aún no ha terminado', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ id: String(i), name: 'n' }));
    const res = await handleMigration('export', post({ table: 'plans', offset: 0, limit: 2 }), ENV, deps('admin', openapi, fakeClient(rows)));
    expect(res.body).toMatchObject({ consumed: 2, done: false });
  });

  it('añade el reajuste de secuencia al terminar una tabla con id entero', async () => {
    const res = await handleMigration('export', post({ table: 'twitch_events', offset: 0 }), ENV, deps('admin', openapi, fakeClient([{ id: 1, kind: 'x' }])));
    const statements = (res.body as { statements: string[] }).statements;
    expect(statements).toHaveLength(3); // DELETE, fila, setval
    expect(statements[2]).toMatch(/^SELECT setval/);
  });

  it('rechaza una tabla que no existe y a quien no es administrador', async () => {
    expect((await handleMigration('export', post({ table: 'pg_authid', offset: 0 }), ENV, deps('admin', openapi, fakeClient([])))).status).toBe(400);
    expect((await handleMigration('export', post({ table: 'plans', offset: 0 }), ENV, deps('streamer', openapi, fakeClient([])))).status).toBe(403);
  });
});
