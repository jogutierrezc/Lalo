/**
 * tests/luxEffectiveModel.test.ts
 *
 * Modelo 3D efectivo de Mi AI en el overlay de OBS (effectiveModel.ts):
 *   - con un lux_model_id visible, speech manda el avatar «glb:<id>» de ese modelo;
 *   - sin elección, el avatar del personaje; si el elegido no es visible o no existe, cae al del personaje;
 *   - mascota-model sirve el GLB del modelo efectivo y da 404 a otra cuenta o a un id que no es el suyo;
 *   - la clave del archivo nunca sale en una respuesta;
 *   - sin la migración 0035, el error dice qué falta.
 *
 * Supabase, R2 y el navegador no se prueban aquí: la base y el bucket son falsos.
 */

import { describe, expect, it } from 'vitest';
import { handleLux } from '../server/lux/handlers';
import { RIOT_NOTICE, type LuxCharacter } from '../server/lux/characters';
import { effectiveModel, modelIdFromAvatar, overlayViewFor } from '../server/lux/effectiveModel';
import type { LuxDb, LuxLibraryRow, LuxProfile } from '../server/lux/luxDb';
import { MigrationMissingError } from '../server/integrations/store';
import type { IntegrationRequest } from '../server/integrations/http';

const ADMIN = '00000000-0000-4000-8000-0000000000a0';
const CREATOR = '00000000-0000-4000-8000-0000000000a1';
const OTHER = '00000000-0000-4000-8000-0000000000a2';
const CREATOR_KEY = 'clave-obs-creador-1234567890abcdef';
const OTHER_KEY = 'clave-obs-otra-1234567890abcdef';
const APPROVED = '00000000-0000-4000-8000-0000000000e1';
const PRIVATE_OF_OTHER = '00000000-0000-4000-8000-0000000000e2';
const PRIVATE_OF_CREATOR = '00000000-0000-4000-8000-0000000000e3';
const RIOT_CHAR = '00000000-0000-4000-8000-0000000000c1';
const OWN_CHAR = '00000000-0000-4000-8000-0000000000c2';
const APPROVED_KEY = 'lux-models/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.glb';
const PRIVATE_OTHER_KEY = 'lux-models/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.glb';
const PRIVATE_CREATOR_KEY = 'lux-models/cccccccccccccccccccccccccccccccc.glb';
const RIOT_KEY = 'lux-models/11111111111111111111111111111111.glb';
const OWN_KEY = 'lux-models/22222222222222222222222222222222.glb';
const BYTES = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]);
const ALL_KEYS = [APPROVED_KEY, PRIVATE_OTHER_KEY, PRIVATE_CREATOR_KEY, RIOT_KEY, OWN_KEY];

/** Biblioteca de creadores: uno aprobado (de OTHER), uno privado de OTHER y uno privado de CREATOR. */
const libraryRows = (): LuxLibraryRow[] => [
  row(APPROVED, OTHER, 'aprobado', APPROVED_KEY),
  row(PRIVATE_OF_OTHER, OTHER, 'privado', PRIVATE_OTHER_KEY),
  row(PRIVATE_OF_CREATOR, CREATOR, 'privado', PRIVATE_CREATOR_KEY),
];

function row(id: string, owner: string, status: LuxLibraryRow['reviewStatus'], modelKey: string): LuxLibraryRow {
  return {
    id,
    name: `Modelo ${id.slice(-2)}`,
    source: 'creador',
    ownerProfileId: owner,
    fileName: 'modelo.glb',
    bytes: BYTES.length,
    uploadedAt: '2026-10-18T10:00:00.000Z',
    reviewStatus: status,
    licenseConfirmed: status === 'aprobado',
    modelKey,
    pendingKey: null,
    staleKeys: [],
  };
}

/** Personaje de Riot Games (con aviso) y el propio de CREATOR (glb:warwick, sin origen Riot). */
function characters(): LuxCharacter[] {
  return [
    {
      id: RIOT_CHAR,
      name: 'Riot',
      avatar: 'glb:warwick',
      color: '#f59e0b',
      gestures: ['wave'],
      model: null,
      isDefault: false,
      ownerProfileId: ADMIN,
      modelKey: RIOT_KEY,
      modelOrigin: 'riot',
      modelFile: { name: 'warwick.glb', bytes: BYTES.length, uploadedAt: null },
      modelPendingKey: null,
      modelStaleKeys: [],
    },
    {
      id: OWN_CHAR,
      name: 'Mascota propia',
      avatar: 'glb:warwick',
      color: '#22c55e',
      gestures: ['wave'],
      model: null,
      isDefault: false,
      ownerProfileId: CREATOR,
      modelKey: OWN_KEY,
      modelOrigin: 'propio',
      modelFile: { name: 'propia.glb', bytes: BYTES.length, uploadedAt: null },
      modelPendingKey: null,
      modelStaleKeys: [],
    },
    {
      id: 'lux-default',
      name: 'Lux',
      avatar: 'lux',
      color: '#f59e0b',
      gestures: ['wave'],
      model: null,
      isDefault: true,
      ownerProfileId: null,
      modelKey: null,
    },
  ];
}

interface Options {
  /** Cuenta CREATOR con su elección y su personaje asignado. */
  creator?: Partial<LuxProfile>;
  /** Si la base no tiene la biblioteca (migración 0035 sin aplicar). */
  noLibrary?: boolean;
}

function makeDb(options: Options = {}) {
  const profiles: Record<string, LuxProfile & { widgetKey: string }> = {
    [CREATOR_KEY]: { id: CREATOR, role: 'streamer', luxEnabled: true, luxCharacterId: OWN_CHAR, luxModelId: null, widgetKey: CREATOR_KEY, ...options.creator },
    [OTHER_KEY]: { id: OTHER, role: 'streamer', luxEnabled: true, luxCharacterId: null, luxModelId: PRIVATE_OF_CREATOR, widgetKey: OTHER_KEY },
  };
  const db = {
    async profileByWidgetKey(key: string) {
      return profiles[key] ?? null;
    },
    async profile(id: string) {
      return Object.values(profiles).find((p) => p.id === id) ?? null;
    },
    async characters() {
      return characters();
    },
    async speechSince() {
      return [];
    },
    async latestSpeechId() {
      return 0;
    },
    async settingsRow() {
      return null;
    },
    async libraryModels() {
      if (options.noLibrary) throw new MigrationMissingError();
      return libraryRows();
    },
  } as unknown as LuxDb;
  return db;
}

const get = (query: Record<string, string>): IntegrationRequest => ({ method: 'GET', headers: {}, query, body: undefined });

/** Lo que el overlay recibe del personaje en la primera llamada a speech (sin «after»). */
async function overlayCharacter(key: string, options: Options = {}) {
  const db = makeDb(options);
  const res = await handleLux('speech', get({ k: key }), {}, { db: () => db });
  return { res, character: (res.body as { character: { avatar: string; licenseNotice: string | null } }).character };
}

describe('speech: el avatar que recibe el overlay es el del modelo efectivo', () => {
  it('con un lux_model_id visible (aprobado de la biblioteca), manda glb:<id> de ese modelo', async () => {
    const { res, character } = await overlayCharacter(CREATOR_KEY, { creator: { luxCharacterId: null, luxModelId: APPROVED } });
    expect(res.status).toBe(200);
    expect(character.avatar).toBe(`glb:${APPROVED}`);
    expect(character.licenseNotice).toBeNull();
  });

  it('con un modelo de Riot elegido, manda su glb:<id> y el aviso de licencia exacto', async () => {
    const { character } = await overlayCharacter(CREATOR_KEY, { creator: { luxCharacterId: null, luxModelId: RIOT_CHAR } });
    expect(character.avatar).toBe(`glb:${RIOT_CHAR}`);
    expect(character.licenseNotice).toBe(RIOT_NOTICE);
  });

  it('sin elección, manda el avatar del personaje (su modelo propio)', async () => {
    const { character } = await overlayCharacter(CREATOR_KEY);
    expect(character.avatar).toBe('glb:warwick');
  });

  it('si el modelo elegido es privado de otra cuenta, cae al avatar del personaje', async () => {
    const { res, character } = await overlayCharacter(CREATOR_KEY, { creator: { luxCharacterId: null, luxModelId: PRIVATE_OF_OTHER } });
    expect(res.status).toBe(200);
    expect(character.avatar).toBe('lux');
  });

  it('si el modelo elegido ya no existe, cae al avatar del personaje sin romper nada', async () => {
    const { res, character } = await overlayCharacter(CREATOR_KEY, { creator: { luxModelId: '00000000-0000-4000-8000-00000000dead' } });
    expect(res.status).toBe(200);
    expect(character.avatar).toBe('glb:warwick');
  });

  it('la respuesta nunca lleva la clave del archivo', async () => {
    const { res } = await overlayCharacter(CREATOR_KEY, { creator: { luxCharacterId: null, luxModelId: APPROVED } });
    const json = JSON.stringify(res.body);
    for (const key of ALL_KEYS) expect(json).not.toContain(key);
  });

  it('sin la migración 0035, responde 503 con el aviso de migración', async () => {
    const res = await handleLux('speech', get({ k: CREATOR_KEY }), {}, { db: () => makeDb({ creator: { luxModelId: APPROVED }, noLibrary: true }) });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'migration_missing' });
    expect(JSON.stringify(res.body)).toContain('0037');
  });
});

describe('effectiveModel: reglas puras', () => {
  it('el id sale del avatar solo con el formato del overlay', () => {
    expect(modelIdFromAvatar('glb:warwick')).toBe('warwick');
    expect(modelIdFromAvatar('glb:../x')).toBeNull();
    expect(modelIdFromAvatar('lux')).toBeNull();
  });

  it('el modelo propio solo lo usa su dueña (o es de Riot)', () => {
    const own = characters()[1];
    expect(effectiveModel(own, CREATOR, null)?.id).toBe('warwick');
    expect(effectiveModel(own, OTHER, null)).toBeNull();
    expect(effectiveModel(characters()[0], OTHER, null)?.licenseNotice).toBe(RIOT_NOTICE);
  });

  it('overlayViewFor sustituye el avatar solo si hay modelo efectivo', () => {
    const own = characters()[1];
    expect(overlayViewFor(own, null).avatar).toBe('glb:warwick');
    expect(overlayViewFor(own, { id: APPROVED, modelKey: APPROVED_KEY, licenseNotice: null }).avatar).toBe(`glb:${APPROVED}`);
  });
});

describe('mascota-model: sirve el GLB del modelo efectivo, solo a quien le corresponde', () => {
  function serve(key: string, query: Record<string, string> = {}, options: Options = {}) {
    const reads: string[] = [];
    const db = makeDb(options);
    const deps = {
      db: () => db,
      auth: async () => ({ id: CREATOR, role: 'streamer', status: 'active' }),
      modelBytes: async (_env: unknown, read: string) => {
        reads.push(read);
        return { ok: true as const, bytes: BYTES };
      },
    };
    return { reads, run: () => handleLux('mascota-model', get({ k: key, ...query }), {}, deps) };
  }

  it('la cuenta con un modelo aprobado elegido recibe ese archivo', async () => {
    const { reads, run } = serve(CREATOR_KEY, {}, { creator: { luxCharacterId: null, luxModelId: APPROVED } });
    const res = await run();
    expect(res.status).toBe(200);
    expect(res.raw?.body).toEqual(BYTES);
    expect(reads).toEqual([APPROVED_KEY]);
    expect(JSON.stringify(res.body)).not.toContain(APPROVED_KEY);
  });

  it('con ?m= del modelo elegido, sirve el mismo archivo', async () => {
    const { reads, run } = serve(CREATOR_KEY, { m: APPROVED }, { creator: { luxCharacterId: null, luxModelId: APPROVED } });
    expect((await run()).status).toBe(200);
    expect(reads).toEqual([APPROVED_KEY]);
  });

  it('con ?m= de otro modelo, 404 y no lee nada', async () => {
    const { reads, run } = serve(CREATOR_KEY, { m: PRIVATE_OF_OTHER }, { creator: { luxCharacterId: null, luxModelId: APPROVED } });
    const res = await run();
    expect(res.status).toBe(404);
    expect(reads).toEqual([]);
  });

  it('la cuenta que eligió un modelo privado de otra recibe su propio modelo (fallback), no ese archivo', async () => {
    const { reads, run } = serve(CREATOR_KEY, {}, { creator: { luxModelId: PRIVATE_OF_OTHER } });
    expect((await run()).status).toBe(200);
    expect(reads).toEqual([OWN_KEY]);
  });

  it('una cuenta que no ve el modelo privado de otra recibe 404 si pide ese id', async () => {
    const reads: string[] = [];
    const db = makeDb();
    const deps = {
      db: () => db,
      auth: async () => ({ id: OTHER, role: 'streamer', status: 'active' }),
      modelBytes: async (_env: unknown, read: string) => {
        reads.push(read);
        return { ok: true as const, bytes: BYTES };
      },
    };
    // OTHER eligió PRIVATE_OF_CREATOR (de CREATOR, privado): no lo ve, y no tiene personaje propio.
    const res = await handleLux('mascota-model', get({ k: OTHER_KEY, m: PRIVATE_OF_CREATOR }), {}, deps);
    expect(res.status).toBe(404);
    expect(reads).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain(PRIVATE_CREATOR_KEY);
  });

  it('el propio creador sí ve su modelo privado y lo puede elegir', async () => {
    const { reads, run } = serve(CREATOR_KEY, {}, { creator: { luxCharacterId: null, luxModelId: PRIVATE_OF_CREATOR } });
    expect((await run()).status).toBe(200);
    expect(reads).toEqual([PRIVATE_CREATOR_KEY]);
  });

  it('un modelo de Riot elegido lo sirve a cualquier cuenta', async () => {
    // OTHER elige el de Riot (visible para todos): la base falsa lo da con su clave de OBS.
    const db = makeDb();
    const base = db as unknown as { profileByWidgetKey: (key: string) => Promise<LuxProfile | null> };
    base.profileByWidgetKey = async (key: string) =>
      key === OTHER_KEY ? { id: OTHER, role: 'streamer', luxEnabled: true, luxCharacterId: null, luxModelId: RIOT_CHAR } : null;
    const reads: string[] = [];
    const deps = {
      db: () => db,
      auth: async () => ({ id: OTHER, role: 'streamer', status: 'active' }),
      modelBytes: async (_env: unknown, read: string) => {
        reads.push(read);
        return { ok: true as const, bytes: BYTES };
      },
    };
    const res = await handleLux('mascota-model', get({ k: OTHER_KEY }), {}, deps);
    expect(res.status).toBe(200);
    expect(reads).toEqual([RIOT_KEY]);
  });

  it('ninguna respuesta de error lleva la clave del archivo', async () => {
    const { run } = serve('clave-falsa-123456789012');
    const res = await run();
    expect(res.status).toBe(401);
    for (const key of ALL_KEYS) expect(JSON.stringify(res.body)).not.toContain(key);
  });
});
