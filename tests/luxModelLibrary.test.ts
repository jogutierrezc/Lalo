/**
 * tests/luxModelLibrary.test.ts
 *
 * Biblioteca de modelos de Mi AI (migración 0035):
 *   - el creador ve la biblioteca compartida (Riot y aprobados) y sus propios modelos, en cualquier estado;
 *   - el creador no aprueba (403); el administrador confirma la licencia antes de publicar;
 *   - el aviso de Riot Games sale con su texto exacto en la biblioteca y no sale en los modelos de creador;
 *   - la cuota del plan bloquea la subida número 3 en Básico;
 *   - el creador solo elige modelos que ve; un modelo privado de otro no se puede elegir.
 *
 * R2 real, Supabase real y el navegador no se prueban aquí: el acceso a R2 y la base son falsos.
 */

import { describe, expect, it } from 'vitest';
import { handleLux } from '../server/lux/handlers';
import { RIOT_NOTICE, type LuxCharacter } from '../server/lux/characters';
import type { ModelFiles } from '../server/lux/characterModel';
import type { LuxLibraryPatch, LuxLibraryRow, LuxDb, LuxProfile } from '../server/lux/luxDb';
import type { IntegrationRequest } from '../server/integrations/http';

const ADMIN = '00000000-0000-4000-8000-0000000000a0';
const CREATOR = '00000000-0000-4000-8000-0000000000a1';
const OTHER = '00000000-0000-4000-8000-0000000000a2';
const NO_LUX = '00000000-0000-4000-8000-0000000000a3';
const RIOT_CHAR = '00000000-0000-4000-8000-0000000000c1';
const RIOT_KEY = 'lux-models/11111111111111111111111111111111.glb';
const MB = 1024 * 1024;
const ENV = { R2_MODELS_BUCKET: 'privado' };
const NOW = Date.parse('2026-10-18T12:00:00Z');

/** Clave con el formato del servidor: 32 hex. */
const keyOf = (n: number): string => `lux-models/${n.toString(16).padStart(32, '0')}.glb`;
const idOf = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

interface Store {
  db: LuxDb;
  rows: LuxLibraryRow[];
  profiles: Record<string, LuxProfile>;
}

/** Base falsa: cuentas (admin, creador en Básico, otro creador en Básico y una sin Mi AI), un personaje de Riot y el catálogo de planes. */
function store(): Store {
  const rows: LuxLibraryRow[] = [];
  let seq = 1;
  const profiles: Record<string, LuxProfile> = {
    [ADMIN]: { id: ADMIN, role: 'admin', luxEnabled: true, planId: null, luxModelId: null },
    [CREATOR]: { id: CREATOR, role: 'streamer', luxEnabled: true, planId: 'basico', luxModelId: null },
    [OTHER]: { id: OTHER, role: 'streamer', luxEnabled: true, planId: 'basico', luxModelId: null },
    [NO_LUX]: { id: NO_LUX, role: 'streamer', luxEnabled: false, planId: 'basico', luxModelId: null },
  };
  const characters: LuxCharacter[] = [
    {
      id: RIOT_CHAR,
      name: 'Mascota 2',
      avatar: 'glb:warwick',
      color: '#f59e0b',
      gestures: ['wave'],
      model: null,
      isDefault: false,
      ownerProfileId: ADMIN,
      modelKey: RIOT_KEY,
      modelOrigin: 'riot',
      modelFile: { name: 'warwick.glb', bytes: 9 * MB, uploadedAt: '2026-10-18T10:00:00.000Z' },
      modelPendingKey: null,
      modelStaleKeys: [],
    },
  ];
  const plans: Record<string, number | null> = { basico: 2, plus: 10 };

  const db = {
    async profile(id: string) {
      return profiles[id] ?? null;
    },
    async characters() {
      return characters;
    },
    async streamers() {
      return [
        { id: CREATOR, label: 'Creador' },
        { id: OTHER, label: 'Otro' },
      ];
    },
    async libraryModels() {
      return rows.map((row) => ({ ...row, staleKeys: [...row.staleKeys] }));
    },
    async libraryInsert(row: { ownerProfileId: string; name: string; pendingKey: string }) {
      const id = idOf(seq++);
      rows.push({
        id,
        name: row.name,
        source: 'creador',
        ownerProfileId: row.ownerProfileId,
        fileName: null,
        bytes: null,
        uploadedAt: null,
        reviewStatus: 'privado',
        licenseConfirmed: false,
        modelKey: null,
        pendingKey: row.pendingKey,
        staleKeys: [],
      });
      return id;
    },
    async libraryUpdate(id: string, patch: LuxLibraryPatch) {
      const row = rows.find((item) => item.id === id);
      if (!row) return false;
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.fileName !== undefined) row.fileName = patch.fileName;
      if (patch.bytes !== undefined) row.bytes = patch.bytes;
      if (patch.uploadedAt !== undefined) row.uploadedAt = patch.uploadedAt;
      if (patch.modelKey !== undefined) row.modelKey = patch.modelKey;
      if (patch.pendingKey !== undefined) row.pendingKey = patch.pendingKey;
      if (patch.staleKeys !== undefined) row.staleKeys = patch.staleKeys;
      if (patch.reviewStatus !== undefined) row.reviewStatus = patch.reviewStatus;
      if (patch.licenseConfirmed !== undefined) row.licenseConfirmed = patch.licenseConfirmed;
      return true;
    },
    async libraryDelete(id: string) {
      const at = rows.findIndex((item) => item.id === id);
      if (at >= 0) rows.splice(at, 1);
    },
    async setProfileModel(profileId: string, modelId: string | null) {
      profiles[profileId] = { ...profiles[profileId], luxModelId: modelId };
    },
    async planModelLimit(planId: string) {
      return planId in plans ? plans[planId] : null;
    },
  } as unknown as LuxDb;
  return { db, rows, profiles };
}

/** Cuentas de prueba: el usuario de la sesión decide el rol. El cuerpo nunca lo cambia. */
const auth = async (req: IntegrationRequest) => {
  const who = String(req.headers['x-test-user'] ?? '');
  if (who === 'admin') return { id: ADMIN, role: 'admin', status: 'active' };
  if (who === 'other') return { id: OTHER, role: 'streamer', status: 'active' };
  if (who === 'nolux') return { id: NO_LUX, role: 'streamer', status: 'active' };
  return { id: CREATOR, role: 'streamer', status: 'active' };
};

/** R2 falso: sube siempre; el tamaño y el borrado se controlan desde la prueba. */
function fakeFiles(options: { bytes?: number; removeOk?: boolean } = {}) {
  const removed: string[] = [];
  const state = { removeOk: options.removeOk ?? true, bytes: options.bytes ?? 10 * MB };
  const files: ModelFiles = {
    uploadUrl(_env, key) {
      return `https://r2.example/privado/${key}?X-Amz-Expires=900`;
    },
    async head() {
      return { bytes: state.bytes };
    },
    async remove(_env, key) {
      removed.push(key);
      return state.removeOk;
    },
  };
  return { files, removed, state };
}

type User = 'admin' | 'creator' | 'other' | 'nolux';

function call(s: Store, files: ModelFiles, user: User, body: Record<string, unknown>, method = 'POST') {
  const req: IntegrationRequest = { method, headers: { 'x-test-user': user }, query: {}, body };
  return handleLux('model-library', req, ENV, { db: () => s.db, auth, modelFiles: files, now: () => NOW });
}

/** Sube un modelo propio de principio a fin (presign + confirmación). Devuelve el id. */
async function upload(s: Store, files: ModelFiles, user: User, name: string): Promise<string> {
  const pide = await call(s, files, user, { op: 'presign', name, size: 5 * MB });
  expect(pide.status).toBe(200);
  const id = String(pide.body.id);
  const key = String(pide.body.key);
  const done = await call(s, files, user, { op: 'complete', id, key, name });
  expect(done.status).toBe(200);
  return id;
}

describe('qué ve cada cuenta', () => {
  it('el creador ve la biblioteca compartida y sus propios modelos, pero no los privados de otro', async () => {
    const s = store();
    const f = fakeFiles();
    const mio = await upload(s, f.files, 'creator', 'mio.glb');
    const ajeno = await upload(s, f.files, 'other', 'ajeno.glb');
    // El modelo ajeno sigue privado: no aparece en la biblioteca del creador.
    const vista = await call(s, f.files, 'creator', {}, 'GET');
    expect(vista.status).toBe(200);
    const library = vista.body.library as Array<{ id: string }>;
    const mine = vista.body.mine as Array<{ id: string }>;
    expect(library.map((m) => m.id)).toEqual([RIOT_CHAR]);
    expect(mine.map((m) => m.id)).toEqual([mio]);
    expect(library.some((m) => m.id === ajeno)).toBe(false);
  });

  it('cuando el administrador aprueba un modelo, todos los creadores lo ven en la biblioteca', async () => {
    const s = store();
    const f = fakeFiles();
    const id = await upload(s, f.files, 'other', 'compartido.glb');
    expect((await call(s, f.files, 'creator', {}, 'GET')).body.library).toHaveLength(1);
    await call(s, f.files, 'other', { op: 'submit', id });
    const ok = await call(s, f.files, 'admin', { op: 'approve', id, licenseConfirmed: true });
    expect(ok.status).toBe(200);
    const library = (await call(s, f.files, 'creator', {}, 'GET')).body.library as Array<{ id: string }>;
    expect(library.map((m) => m.id)).toContain(id);
  });

  it('una cuenta sin Mi AI recibe 403 y no ve nada', async () => {
    const s = store();
    const res = await call(s, fakeFiles().files, 'nolux', {}, 'GET');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'lux_disabled' });
  });

  it('el administrador ve la cola de revisión; el creador no', async () => {
    const s = store();
    const f = fakeFiles();
    await upload(s, f.files, 'creator', 'pendiente.glb');
    const admin = await call(s, f.files, 'admin', {}, 'GET');
    expect(admin.body.review).toHaveLength(1);
    const creator = await call(s, f.files, 'creator', {}, 'GET');
    expect(creator.body.review).toBeUndefined();
  });
});

describe('quién aprueba', () => {
  it('el creador no puede aprobar su modelo: 403 y el modelo sigue privado', async () => {
    const s = store();
    const f = fakeFiles();
    const id = await upload(s, f.files, 'creator', 'mio.glb');
    const res = await call(s, f.files, 'creator', { op: 'approve', id, licenseConfirmed: true });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'not_admin' });
    expect(s.rows.find((row) => row.id === id)?.reviewStatus).toBe('privado');
  });

  it('el administrador no publica sin confirmar la licencia', async () => {
    const s = store();
    const f = fakeFiles();
    const id = await upload(s, f.files, 'creator', 'mio.glb');
    await call(s, f.files, 'creator', { op: 'submit', id });
    const sin = await call(s, f.files, 'admin', { op: 'approve', id });
    expect(sin.status).toBe(400);
    expect(sin.body).toMatchObject({ code: 'license_required' });
    const conNo = await call(s, f.files, 'admin', { op: 'approve', id, licenseConfirmed: 'si' });
    expect(conNo.status).toBe(400);
    expect(s.rows.find((row) => row.id === id)?.reviewStatus).toBe('pendiente');
  });

  it('el rol que manda es el de la sesión: un «admin» en el cuerpo no aprueba', async () => {
    const s = store();
    const f = fakeFiles();
    const id = await upload(s, f.files, 'creator', 'mio.glb');
    const res = await call(s, f.files, 'creator', { op: 'approve', id, licenseConfirmed: true, role: 'admin' });
    expect(res.status).toBe(403);
  });
});

describe('aviso de Riot Games', () => {
  it('sale con su texto exacto en la biblioteca y no sale en los modelos de creador', async () => {
    const s = store();
    const f = fakeFiles();
    await upload(s, f.files, 'creator', 'mio.glb');
    const vista = await call(s, f.files, 'creator', {}, 'GET');
    const library = vista.body.library as Array<{ id: string; licenseNotice: string | null }>;
    expect(library.find((m) => m.id === RIOT_CHAR)?.licenseNotice).toBe(RIOT_NOTICE);
    const mine = vista.body.mine as Array<{ licenseNotice: string | null }>;
    expect(mine[0].licenseNotice).toBeNull();
  });

  it('la clave del archivo nunca sale en la respuesta', async () => {
    const s = store();
    const f = fakeFiles();
    await upload(s, f.files, 'creator', 'mio.glb');
    const text = JSON.stringify(await call(s, f.files, 'creator', {}, 'GET'));
    expect(text).not.toContain('lux-models/');
    expect(text).not.toContain(RIOT_KEY);
  });
});

describe('cuota del plan', () => {
  it('en Básico (2 modelos) la subida número 3 se bloquea', async () => {
    const s = store();
    const f = fakeFiles();
    await upload(s, f.files, 'creator', 'uno.glb');
    await upload(s, f.files, 'creator', 'dos.glb');
    const tercera = await call(s, f.files, 'creator', { op: 'presign', name: 'tres.glb', size: MB });
    expect(tercera.status).toBe(409);
    expect(tercera.body).toMatchObject({ code: 'quota_reached' });
    expect(String(tercera.body.error)).toContain('2 modelos');
    const vista = await call(s, f.files, 'creator', {}, 'GET');
    expect(vista.body).toMatchObject({ limit: 2, used: 2, left: 0 });
  });

  it('quitar un modelo libera cuota', async () => {
    const s = store();
    const f = fakeFiles();
    const uno = await upload(s, f.files, 'creator', 'uno.glb');
    await upload(s, f.files, 'creator', 'dos.glb');
    expect((await call(s, f.files, 'creator', { op: 'remove', id: uno })).status).toBe(200);
    const otra = await call(s, f.files, 'creator', { op: 'presign', name: 'tres.glb', size: MB });
    expect(otra.status).toBe(200);
  });

  it('un plan sin valor de modelos propios no permite ninguno', async () => {
    const s = store();
    s.profiles[CREATOR] = { ...s.profiles[CREATOR], planId: null };
    const res = await call(s, fakeFiles().files, 'creator', { op: 'presign', name: 'uno.glb', size: MB });
    expect(res.status).toBe(409);
    expect(String(res.body.error)).toContain('no incluye');
  });

  it('un archivo que pesa más de 50 MB o no es .glb se rechaza antes de pedir la subida', async () => {
    const s = store();
    const f = fakeFiles();
    expect((await call(s, f.files, 'creator', { op: 'presign', name: 'grande.glb', size: 51 * MB })).status).toBe(400);
    expect((await call(s, f.files, 'creator', { op: 'presign', name: 'modelo.fbx', size: MB })).status).toBe(400);
    expect(s.rows).toHaveLength(0);
  });

  it('si R2 dice que el archivo pesa más de 50 MB, se borra y no cuenta', async () => {
    const s = store();
    const f = fakeFiles({ bytes: 60 * MB });
    const pide = await call(s, f.files, 'creator', { op: 'presign', name: 'grande.glb', size: 5 * MB });
    const done = await call(s, f.files, 'creator', { op: 'complete', id: pide.body.id, key: pide.body.key, name: 'grande.glb' });
    expect(done.status).toBe(400);
    expect(f.removed).toEqual([pide.body.key]);
    expect(s.rows).toHaveLength(0);
  });
});

describe('elegir el modelo de su personaje', () => {
  it('el creador elige un modelo de Riot o uno aprobado, y uno suyo', async () => {
    const s = store();
    const f = fakeFiles();
    const mio = await upload(s, f.files, 'creator', 'mio.glb');
    expect((await call(s, f.files, 'creator', { op: 'choose', modelId: RIOT_CHAR })).status).toBe(200);
    expect((await call(s, f.files, 'creator', {}, 'GET')).body.chosen).toBe(RIOT_CHAR);
    expect((await call(s, f.files, 'creator', { op: 'choose', modelId: mio })).status).toBe(200);
    expect((await call(s, f.files, 'creator', {}, 'GET')).body.chosen).toBe(mio);
  });

  it('no puede elegir un modelo privado de otra cuenta', async () => {
    const s = store();
    const f = fakeFiles();
    const ajeno = await upload(s, f.files, 'other', 'ajeno.glb');
    const res = await call(s, f.files, 'creator', { op: 'choose', modelId: ajeno });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'model_not_found' });
    expect(s.profiles[CREATOR].luxModelId).toBeNull();
  });

  it('un modelo que deja de ser visible no cuenta como elegido', async () => {
    const s = store();
    const f = fakeFiles();
    const ajeno = await upload(s, f.files, 'other', 'ajeno.glb');
    await call(s, f.files, 'other', { op: 'submit', id: ajeno });
    await call(s, f.files, 'admin', { op: 'approve', id: ajeno, licenseConfirmed: true });
    expect((await call(s, f.files, 'creator', { op: 'choose', modelId: ajeno })).status).toBe(200);
    await call(s, f.files, 'admin', { op: 'reject', id: ajeno });
    expect((await call(s, f.files, 'creator', {}, 'GET')).body.chosen).toBeNull();
  });

  it('elegir null quita la elección', async () => {
    const s = store();
    const f = fakeFiles();
    await call(s, f.files, 'creator', { op: 'choose', modelId: RIOT_CHAR });
    expect((await call(s, f.files, 'creator', { op: 'choose', modelId: null })).status).toBe(200);
    expect(s.profiles[CREATOR].luxModelId).toBeNull();
  });
});

describe('flujo de subida y revisión', () => {
  it('confirmar exige la clave que pidió el servidor para ese modelo', async () => {
    const s = store();
    const f = fakeFiles();
    const pide = await call(s, f.files, 'creator', { op: 'presign', name: 'uno.glb', size: MB });
    const otra = await call(s, f.files, 'creator', { op: 'complete', id: pide.body.id, key: keyOf(999), name: 'uno.glb' });
    expect(otra.status).toBe(400);
    expect(otra.body).toMatchObject({ code: 'not_requested' });
  });

  it('nadie confirma ni envía el modelo de otra cuenta', async () => {
    const s = store();
    const f = fakeFiles();
    const pide = await call(s, f.files, 'creator', { op: 'presign', name: 'uno.glb', size: MB });
    const ajena = await call(s, f.files, 'other', { op: 'complete', id: pide.body.id, key: pide.body.key, name: 'uno.glb' });
    expect(ajena.status).toBe(404);
    const envio = await call(s, f.files, 'other', { op: 'submit', id: pide.body.id });
    expect(envio.status).toBe(404);
  });

  it('enviar a revisión pasa de privado a pendiente, y solo con archivo', async () => {
    const s = store();
    const f = fakeFiles();
    const pide = await call(s, f.files, 'creator', { op: 'presign', name: 'uno.glb', size: MB });
    const sinArchivo = await call(s, f.files, 'creator', { op: 'submit', id: pide.body.id });
    expect(sinArchivo.status).toBe(409);
    await call(s, f.files, 'creator', { op: 'complete', id: pide.body.id, key: pide.body.key, name: 'uno.glb' });
    expect((await call(s, f.files, 'creator', { op: 'submit', id: pide.body.id })).status).toBe(200);
    expect(s.rows[0].reviewStatus).toBe('pendiente');
  });

  it('aprobar confirma la licencia y pone el modelo como aprobado', async () => {
    const s = store();
    const f = fakeFiles();
    const id = await upload(s, f.files, 'creator', 'mio.glb');
    await call(s, f.files, 'creator', { op: 'submit', id });
    await call(s, f.files, 'admin', { op: 'approve', id, licenseConfirmed: true });
    const row = s.rows.find((item) => item.id === id);
    expect(row).toMatchObject({ reviewStatus: 'aprobado', licenseConfirmed: true });
  });

  it('si R2 no deja borrar, el modelo queda anotado para reintentar y no vuelve a verse', async () => {
    const s = store();
    const f = fakeFiles({ removeOk: false });
    const id = await upload(s, f.files, 'creator', 'mio.glb');
    const quita = await call(s, f.files, 'creator', { op: 'remove', id });
    expect(quita.status).toBe(200);
    const row = s.rows.find((item) => item.id === id);
    expect(row?.modelKey).toBeNull();
    expect(row?.staleKeys.length).toBe(1);
    expect((await call(s, f.files, 'creator', {}, 'GET')).body.mine).toEqual([]);
  });

  it('el aviso de Riot va con el modelo de Riot en la biblioteca del creador', async () => {
    const s = store();
    const res = await call(s, fakeFiles().files, 'creator', {}, 'GET');
    expect((res.body.library as Array<{ licenseNotice: string | null }>)[0].licenseNotice).toBe(RIOT_NOTICE);
  });
});
