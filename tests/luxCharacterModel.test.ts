/**
 * tests/luxCharacterModel.test.ts
 *
 * Modelo 3D de un personaje desde el panel del administrador (migración 0034):
 *   - solo el administrador sube o quita (el rol sale de la sesión, no del cuerpo);
 *   - el archivo se valida antes de subir (.glb y hasta 50 MB);
 *   - la clave la pone el servidor y solo se confirma la que se pidió;
 *   - al reemplazar, el archivo anterior se borra; si el borrado falla, queda anotado
 *     y se reintenta en la siguiente operación;
 *   - el aviso de Riot Games sale con su texto exacto cuando corresponde y no sale si no.
 *
 * R2 real, Supabase real y el navegador no se prueban aquí: el acceso a R2 es falso.
 */

import { describe, expect, it } from 'vitest';
import { handleLux } from '../server/lux/handlers';
import {
  RIOT_NOTICE,
  characterView,
  licenseNoticeFor,
  overlayView,
  type LuxCharacter,
} from '../server/lux/characters';
import {
  MODEL_MAX_BYTES,
  MODEL_MESSAGES,
  checkModelFile,
  defaultModelFiles,
  type ModelFiles,
} from '../server/lux/characterModel';
import { isModelKey } from '../server/lux/mascotaModel';
import type { LuxCharacterModelPatch, LuxDb, LuxProfile } from '../server/lux/luxDb';
import type { IntegrationRequest } from '../server/integrations/http';

const ADMIN = '00000000-0000-4000-8000-0000000000a0';
const OWNER = '00000000-0000-4000-8000-0000000000a1';
const CHAR_ID = '00000000-0000-4000-8000-0000000000c1';
const OLD_KEY = 'lux-models/0123456789abcdef0123456789abcdef.glb';
const NEW_KEY = 'lux-models/fedcba9876543210fedcba9876543210.glb';
const OTHER_KEY = 'lux-models/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.glb';
const ENV = { R2_ACCOUNT_ID: 'acc', R2_ACCESS_KEY_ID: 'key', R2_SECRET_ACCESS_KEY: 'secret', R2_BUCKET: 'publico', R2_PUBLIC_BASE_URL: 'https://x.example', R2_MODELS_BUCKET: 'privado' };
const MB = 1024 * 1024;

interface Harness {
  db: LuxDb;
  patches: LuxCharacterModelPatch[];
  character: LuxCharacter;
}

/**
 * Base de datos falsa con un personaje Mascota 2. Por defecto su dueña es la cuenta
 * admin (en producción, jagc es admin y dueño), así que el admin lo ve en el catálogo.
 */
function harness(overrides: Partial<LuxCharacter> = {}): Harness {
  const patches: LuxCharacterModelPatch[] = [];
  const state: { character: LuxCharacter } = {
    character: {
      id: CHAR_ID,
      name: 'Mascota 2',
      avatar: 'glb:warwick',
      color: '#f59e0b',
      gestures: ['wave'],
      model: null,
      isDefault: false,
      ownerProfileId: ADMIN,
      modelKey: OLD_KEY,
      modelOrigin: 'riot',
      modelFile: { name: 'warwick.glb', bytes: 9 * MB, uploadedAt: '2026-10-18T10:00:00.000Z' },
      modelPendingKey: null,
      modelStaleKeys: [],
      ...overrides,
    },
  };
  const db = {
    async characters() {
      return [state.character];
    },
    async setCharacterModel(_id: string, patch: LuxCharacterModelPatch) {
      patches.push(patch);
      const c = state.character;
      state.character = {
        ...c,
        ...(patch.modelKey !== undefined ? { modelKey: patch.modelKey } : {}),
        ...(patch.modelOrigin !== undefined ? { modelOrigin: patch.modelOrigin } : {}),
        ...(patch.modelPendingKey !== undefined ? { modelPendingKey: patch.modelPendingKey } : {}),
        ...(patch.modelStaleKeys !== undefined ? { modelStaleKeys: patch.modelStaleKeys } : {}),
      };
    },
    async saveCharacter() {
      return CHAR_ID;
    },
    async deleteCharacter() {
      return true;
    },
    async makeDefaultCharacter() {
      return undefined;
    },
    async assignCharacter() {
      return undefined;
    },
    async profile(id: string): Promise<LuxProfile | null> {
      return { id, role: id === ADMIN ? 'admin' : 'streamer', luxEnabled: true };
    },
    async setting() {
      return null;
    },
  } as unknown as LuxDb;
  return { db, patches, character: state.character };
}

/** Cuentas de prueba: la sesión indica el rol; el cuerpo nunca lo cambia. */
const auth = async (req: IntegrationRequest) => {
  const who = String(req.headers['x-test-user'] ?? '');
  if (who === 'admin') return { id: ADMIN, role: 'admin', status: 'active' };
  return { id: OWNER, role: 'streamer', status: 'active' };
};

/** Acceso a R2 falso que registra lo que se borra y deja controlar el borrado y el tamaño. */
function fakeFiles(options: { bytes?: number | 'missing' | 'error' | 'not_configured'; removeOk?: boolean; uploadUrl?: string | null } = {}) {
  const removed: string[] = [];
  const headed: string[] = [];
  let removeOk = options.removeOk ?? true;
  const files: ModelFiles = {
    uploadUrl(_env, key) {
      return options.uploadUrl === undefined ? `https://r2.example/privado/${key}?X-Amz-Expires=900` : options.uploadUrl;
    },
    async head(_env, key) {
      headed.push(key);
      if (options.bytes === undefined) return { bytes: 10 * MB };
      if (typeof options.bytes === 'number') return { bytes: options.bytes };
      return options.bytes;
    },
    async remove(_env, key) {
      removed.push(key);
      return removeOk;
    },
  };
  return {
    files,
    removed,
    headed,
    allowRemove() {
      removeOk = true;
    },
  };
}

function req(user: 'admin' | 'owner', body: Record<string, unknown>): IntegrationRequest {
  return { method: 'POST', headers: { 'x-test-user': user }, query: {}, body };
}

function run(h: Harness, files: ModelFiles, user: 'admin' | 'owner', body: Record<string, unknown>) {
  return handleLux('character-model', req(user, body), ENV, { db: () => h.db, auth, modelFiles: files, now: () => Date.parse('2026-10-18T12:00:00Z') });
}

describe('solo el administrador sube o quita el modelo', () => {
  it('la cuenta dueña (streamer) recibe 403 al pedir subida, confirmar o quitar', async () => {
    const h = harness();
    const f = fakeFiles();
    const pide = await run(h, f.files, 'owner', { op: 'presign', characterId: CHAR_ID, name: 'nuevo.glb', size: 5 * MB });
    expect(pide.status).toBe(403);
    expect(pide.body).toMatchObject({ code: 'not_admin' });
    const confirma = await run(h, f.files, 'owner', { op: 'complete', characterId: CHAR_ID, key: NEW_KEY, origin: 'propio' });
    expect(confirma.status).toBe(403);
    const quita = await run(h, f.files, 'owner', { op: 'remove', characterId: CHAR_ID });
    expect(quita.status).toBe(403);
    // Nada se escribe ni se borra.
    expect(h.patches).toEqual([]);
    expect(f.removed).toEqual([]);
  });

  it('un rol «admin» dentro del cuerpo no cuenta: manda la sesión', async () => {
    const h = harness();
    const f = fakeFiles();
    const res = await run(h, f.files, 'owner', { op: 'remove', characterId: CHAR_ID, role: 'admin' });
    expect(res.status).toBe(403);
    expect(h.patches).toEqual([]);
  });

  it('el administrador sí puede pedir subida y quitar', async () => {
    const h = harness();
    const f = fakeFiles();
    const pide = await run(h, f.files, 'admin', { op: 'presign', characterId: CHAR_ID, name: 'nuevo.glb', size: 5 * MB });
    expect(pide.status).toBe(200);
    const quita = await run(h, f.files, 'admin', { op: 'remove', characterId: CHAR_ID });
    expect(quita.status).toBe(200);
  });
});

describe('validación del archivo antes de subir', () => {
  it('acepta .glb en cualquier mayúscula y hasta 50 MB', () => {
    expect(checkModelFile({ name: 'warwick.glb', size: 1 })).toEqual({ ok: true });
    expect(checkModelFile({ name: 'WARWICK.GLB', size: MODEL_MAX_BYTES })).toEqual({ ok: true });
  });

  it('rechaza lo que no es .glb, con el mensaje del diseño', () => {
    expect(checkModelFile({ name: 'modelo.fbx', size: MB })).toEqual({ ok: false, message: 'El archivo no es un .glb.' });
    expect(checkModelFile({ name: 'modelo.glb.zip', size: MB })).toEqual({ ok: false, message: 'El archivo no es un .glb.' });
  });

  it('rechaza más de 50 MB y archivos vacíos', () => {
    expect(checkModelFile({ name: 'a.glb', size: MODEL_MAX_BYTES + 1 })).toEqual({ ok: false, message: 'El archivo pesa más de 50 MB.' });
    expect(checkModelFile({ name: 'a.glb', size: 0 })).toEqual({ ok: false, message: 'El archivo está vacío.' });
    expect(checkModelFile({ name: 'a.glb', size: 1.5 })).toMatchObject({ ok: false });
  });

  it('el servidor no pide autorización para un archivo que no es .glb ni para uno de 50 MB o más', async () => {
    const h = harness();
    const f = fakeFiles();
    const tipo = await run(h, f.files, 'admin', { op: 'presign', characterId: CHAR_ID, name: 'mal.png', size: MB });
    expect(tipo.status).toBe(400);
    expect(tipo.body).toMatchObject({ code: 'bad_file', error: 'El archivo no es un .glb.' });
    expect(tipo.body).not.toHaveProperty('uploadUrl');
    const grande = await run(h, f.files, 'admin', { op: 'presign', characterId: CHAR_ID, name: 'grande.glb', size: 60 * MB });
    expect(grande.status).toBe(400);
    expect(grande.body).toMatchObject({ error: 'El archivo pesa más de 50 MB.' });
    expect(h.patches).toEqual([]);
  });

  it('la autorización de subida lleva una clave del servidor con la forma correcta y caduca a 900 s', async () => {
    const h = harness();
    const f = fakeFiles();
    const res = await run(h, f.files, 'admin', { op: 'presign', characterId: CHAR_ID, name: 'nuevo.glb', size: 5 * MB });
    expect(res.status).toBe(200);
    const body = res.body as { key: string; expiresIn: number; headers: Record<string, string> };
    expect(isModelKey(body.key)).toBe(true);
    expect(body.expiresIn).toBe(900);
    expect(body.headers).toEqual({ 'Content-Type': 'model/gltf-binary' });
    expect(h.patches.at(-1)).toMatchObject({ modelPendingKey: body.key });
  });

  it('una confirmación con una clave que no se pidió se rechaza', async () => {
    const h = harness({ modelPendingKey: NEW_KEY });
    const f = fakeFiles();
    const res = await run(h, f.files, 'admin', { op: 'complete', characterId: CHAR_ID, key: OTHER_KEY, origin: 'propio' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: MODEL_MESSAGES.notRequested });
    expect(f.headed).toEqual([]);
  });
});

describe('reemplazo: el modelo anterior se borra', () => {
  it('al confirmar el nuevo, la fila apunta al nuevo y el anterior se borra de R2', async () => {
    const h = harness({ modelPendingKey: NEW_KEY });
    const f = fakeFiles();
    const res = await run(h, f.files, 'admin', { op: 'complete', characterId: CHAR_ID, key: NEW_KEY, name: 'nuevo.glb', origin: 'propio' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, modelFile: { name: 'nuevo.glb', bytes: 10 * MB } });
    expect(h.patches[0]).toMatchObject({ modelKey: NEW_KEY, modelOrigin: 'propio', modelPendingKey: null, modelFileName: 'nuevo.glb', modelFileBytes: 10 * MB });
    expect(f.removed).toEqual([OLD_KEY]);
  });

  it('si el borrado del anterior falla, queda anotado y se reintenta en la siguiente operación', async () => {
    const h = harness({ modelPendingKey: NEW_KEY });
    const f = fakeFiles({ removeOk: false });
    const res = await run(h, f.files, 'admin', { op: 'complete', characterId: CHAR_ID, key: NEW_KEY, name: 'nuevo.glb', origin: 'propio' });
    expect(res.status).toBe(200);
    expect(h.patches.at(-1)).toMatchObject({ modelStaleKeys: [OLD_KEY] });

    // Siguiente operación: el reintento borra el anterior y la lista queda vacía.
    f.allowRemove();
    const otra = await run(h, f.files, 'admin', { op: 'remove', characterId: CHAR_ID });
    expect(otra.status).toBe(200);
    expect(f.removed.filter((key) => key === OLD_KEY).length).toBeGreaterThanOrEqual(2);
    expect(h.patches.at(-1)).toMatchObject({ modelStaleKeys: [] });
  });

  it('una subida que no se confirma se da por abandonada y su archivo se borra en el siguiente intento', async () => {
    const h = harness({ modelPendingKey: OTHER_KEY });
    const f = fakeFiles();
    await run(h, f.files, 'admin', { op: 'presign', characterId: CHAR_ID, name: 'otro.glb', size: MB });
    expect(f.removed).toContain(OTHER_KEY);
  });

  it('un archivo de 50 MB o más, o que no existe en R2, no se guarda', async () => {
    const h = harness({ modelPendingKey: NEW_KEY });
    const f = fakeFiles({ bytes: 60 * MB });
    const grande = await run(h, f.files, 'admin', { op: 'complete', characterId: CHAR_ID, key: NEW_KEY, origin: 'propio' });
    expect(grande.status).toBe(400);
    expect(grande.body).toMatchObject({ error: 'El archivo pesa más de 50 MB.' });
    expect(h.patches.some((p) => p.modelKey === NEW_KEY)).toBe(false);

    // Tras el rechazo la subida pendiente ya no existe: otra confirmación con esa clave se rechaza.
    const tras = await run(h, f.files, 'admin', { op: 'complete', characterId: CHAR_ID, key: NEW_KEY, origin: 'propio' });
    expect(tras.body).toMatchObject({ error: MODEL_MESSAGES.notRequested });

    const h2 = harness({ modelPendingKey: NEW_KEY });
    const faltante = fakeFiles({ bytes: 'missing' });
    const nope = await run(h2, faltante.files, 'admin', { op: 'complete', characterId: CHAR_ID, key: NEW_KEY, origin: 'propio' });
    expect(nope.status).toBe(502);
    expect(nope.body).toMatchObject({ error: 'No se pudo subir. Vuelve a intentarlo.' });
  });
});

describe('errores claros', () => {
  it('sin bucket privado: «El almacenamiento de modelos no está configurado», sin detalles técnicos', async () => {
    const h = harness();
    const f = fakeFiles({ uploadUrl: null });
    const res = await run(h, f.files, 'admin', { op: 'presign', characterId: CHAR_ID, name: 'nuevo.glb', size: MB });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('El almacenamiento de modelos no está configurado');
    // Sin detalles técnicos: ni nombres de variables ni listas de faltantes llegan al panel.
    expect(res.body).not.toHaveProperty('missing');
    expect(String(res.body.error)).not.toMatch(/R2_|bucket|cloudflare/i);
  });

  it('si R2 no responde al confirmar: «No se pudo subir. Vuelve a intentarlo.»', async () => {
    const h = harness({ modelPendingKey: NEW_KEY });
    const f = fakeFiles({ bytes: 'error' });
    const res = await run(h, f.files, 'admin', { op: 'complete', characterId: CHAR_ID, key: NEW_KEY, origin: 'propio' });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('No se pudo subir. Vuelve a intentarlo.');
  });

  it('la confirmación exige el origen: Riot Games o propio', async () => {
    const h = harness({ modelPendingKey: NEW_KEY });
    const f = fakeFiles();
    const res = await run(h, f.files, 'admin', { op: 'complete', characterId: CHAR_ID, key: NEW_KEY });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(MODEL_MESSAGES.origin);
  });
});

describe('aviso de licencia de Riot Games', () => {
  it('el texto es exacto', () => {
    expect(RIOT_NOTICE).toBe('was created under Riot Games\'s "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project.');
  });

  it('aparece con modelo de Riot que tiene archivo: en la ficha, en el panel y en el overlay', () => {
    const c = harness().character;
    expect(licenseNoticeFor(c)).toBe(RIOT_NOTICE);
    expect(characterView(c).licenseNotice).toBe(RIOT_NOTICE);
    expect(overlayView(c).licenseNotice).toBe(RIOT_NOTICE);
  });

  it('no aparece con un modelo propio', () => {
    const c = harness({ modelOrigin: 'propio' }).character;
    expect(licenseNoticeFor(c)).toBeNull();
    expect(characterView(c).licenseNotice).toBeNull();
    expect(overlayView(c).licenseNotice).toBeNull();
  });

  it('no aparece sin modelo, ni con el dibujo de Lux, aunque la marca diga Riot', () => {
    expect(licenseNoticeFor(harness({ modelKey: null }).character)).toBeNull();
    expect(licenseNoticeFor(harness({ avatar: 'lux', ownerProfileId: null }).character)).toBeNull();
  });

  it('lo ve el streamer dueño en su panel', async () => {
    const h = harness({ ownerProfileId: OWNER });
    const res = await handleLux('character', { method: 'GET', headers: { 'x-test-user': 'owner' }, query: {}, body: undefined }, ENV, {
      db: () => h.db,
      auth,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ character: { name: 'Mascota 2', licenseNotice: RIOT_NOTICE } });
  });

  it('la vista del personaje nunca lleva las claves de R2', () => {
    const c = harness({ modelPendingKey: NEW_KEY, modelStaleKeys: [OTHER_KEY] }).character;
    const json = JSON.stringify(characterView(c));
    expect(json).not.toContain(OLD_KEY);
    expect(json).not.toContain(NEW_KEY);
    expect(json).not.toContain(OTHER_KEY);
  });
});

describe('acceso real a R2 (sin red): firma y bucket privado', () => {
  it('la URL de subida va al bucket privado y caduca a 900 s', () => {
    const url = defaultModelFiles.uploadUrl(ENV, NEW_KEY, 5 * MB, new Date('2026-10-18T12:00:00Z'));
    expect(url).toContain('/privado/');
    expect(url).not.toContain('/publico/');
    expect(url).toContain('X-Amz-Expires=900');
  });

  it('sin bucket privado no hay URL de subida', () => {
    const sin = { ...ENV, R2_MODELS_BUCKET: undefined };
    expect(defaultModelFiles.uploadUrl(sin, NEW_KEY, MB)).toBeNull();
  });
});
