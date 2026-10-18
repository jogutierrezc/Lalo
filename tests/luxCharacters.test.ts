/**
 * tests/luxCharacters.test.ts
 *
 * Personajes de Mi AI (antes Lux AI): catálogo solo del administrador, asignación
 * de un personaje a cada streamer, memoria por personaje, modelo por personaje con
 * fallback al por defecto, tope mensual del plan y el personaje que recibe el overlay.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { handleLux } from '../server/lux/handlers';
import { LUX_GESTURES, normalizeCharacterInput, pickCharacter, type LuxCharacter } from '../server/lux/characters';
import { MODEL_CONFIG_SETTING, monthOf, parseModelConfig, pickModel } from '../server/lux/models';
import type { LuxCharacterWrite, LuxDb, LuxMemoryItem, LuxMemoryWrite, LuxProfile } from '../server/lux/luxDb';
import type { IntegrationRequest } from '../server/integrations/http';

const NOW = Date.UTC(2026, 9, 18, 12);
const MONTH = monthOf(NOW);
const DEFAULT_MODEL = 'stepfun-ai/step-5-preview';
const GEMMA = 'google/gemma-4-31b-it';
const KEY = 'nvapi-abcdefghijklmnop1234';
const WIDGET_KEY = 'clave-obs-de-prueba-1234567890';
/** Ids con forma de UUID, como en Supabase (el servidor valida el formato). */
const P1 = '00000000-0000-4000-8000-000000000001';
const A1 = '00000000-0000-4000-8000-000000000002';
const LUX_ID = '00000000-0000-4000-8000-0000000000c1';

const envWithVault = () => ({ INTEGRATIONS_ENC_KEY: randomBytes(32).toString('base64url') });
const request = (method: string, body?: unknown, query: Record<string, string> = {}): IntegrationRequest => ({ method, headers: {}, query, body });
const user = (id: string, role = 'streamer') => async () => ({ id, role, status: 'active' });

type Mem = LuxMemoryItem & { profileId: string; characterId: string };

/** Base de datos en memoria con la forma de Supabase: personajes, planes, consumo, memoria y ajustes. */
function fakeWorld(seed: {
  profiles: LuxProfile[];
  plans?: Record<string, number>;
  widgetKeys?: Record<string, string>;
}) {
  const profiles = new Map(seed.profiles.map((p) => [p.id, { ...p }]));
  const characters: LuxCharacter[] = [
    { id: LUX_ID, name: 'Lux', avatar: 'lux', color: '#f59e0b', gestures: [...LUX_GESTURES], model: null, isDefault: true },
  ];
  const memories: Mem[] = [];
  const settings = new Map<string, string>();
  const rows = new Map<string, Record<string, unknown>>();
  const replies: Array<{ model: string }> = [];
  const speech: unknown[] = [];
  const usage = new Map<string, number>();
  const plans = new Map(Object.entries(seed.plans ?? {}));
  const keys = new Map(Object.entries(seed.widgetKeys ?? {}));

  const db: LuxDb = {
    async setting(key) {
      return settings.get(key) ?? null;
    },
    async putSetting(key, value) {
      if (value === null) settings.delete(key);
      else settings.set(key, value);
    },
    async profile(id) {
      return profiles.get(id) ?? null;
    },
    async profileByWidgetKey(key) {
      const id = keys.get(key);
      return id ? (profiles.get(id) ?? null) : null;
    },
    async memories(owner, characterId, limit) {
      return memories
        .filter((m) => m.profileId === owner && m.characterId === characterId)
        .slice(0, limit)
        .map((m) => ({ kind: m.kind, subject: m.subject, content: m.content }));
    },
    async insertReply(row) {
      replies.push({ model: row.model });
    },
    async settingsRow(id) {
      return rows.get(id) ?? null;
    },
    async saveSettingsRow(row) {
      rows.set(String(row.profile_id), row);
    },
    async insertSpeech(row) {
      speech.push(row);
    },
    async speechSince() {
      return [];
    },
    async latestSpeechId() {
      return 0;
    },
    async pruneSpeech() {},
    async ttsVoice() {
      return { referenceId: null, engine: null };
    },

    async characters() {
      return characters.map((c) => ({ ...c, gestures: [...c.gestures] }));
    },
    async saveCharacter(row: LuxCharacterWrite) {
      if (row.id) {
        const found = characters.find((c) => c.id === row.id);
        if (!found) throw new Error('character_not_found');
        Object.assign(found, { name: row.name, avatar: row.avatar, color: row.color, gestures: row.gestures, model: row.model });
        return found.id;
      }
      const id = randomUUID();
      characters.push({ id, name: row.name, avatar: row.avatar, color: row.color, gestures: row.gestures, model: row.model, isDefault: false });
      return id;
    },
    async deleteCharacter(id) {
      const index = characters.findIndex((c) => c.id === id && !c.isDefault);
      if (index < 0) return false;
      characters.splice(index, 1);
      // Como la base de datos (ON DELETE SET NULL): las cuentas vuelven al por defecto.
      for (const p of profiles.values()) if (p.luxCharacterId === id) p.luxCharacterId = null;
      for (let i = memories.length - 1; i >= 0; i--) if (memories[i].characterId === id) memories.splice(i, 1);
      return true;
    },
    async makeDefaultCharacter(id) {
      for (const c of characters) c.isDefault = c.id === id;
    },
    async assignCharacter(profileId, characterId) {
      const p = profiles.get(profileId);
      if (p) p.luxCharacterId = characterId;
    },
    async planBudget(planId) {
      return plans.has(planId) ? (plans.get(planId) ?? 0) : null;
    },
    async usageThisMonth(profileId, month) {
      return usage.get(`${profileId}:${month}`) ?? 0;
    },
    async addUsage(profileId, month, credits) {
      const key = `${profileId}:${month}`;
      usage.set(key, (usage.get(key) ?? 0) + credits);
    },

    async memoryList(owner, characterId) {
      return memories
        .filter((m) => m.profileId === owner && m.characterId === characterId)
        .map(({ profileId: _p, characterId: _c, ...item }) => item);
    },
    async memoryGet(owner, characterId, id) {
      const found = memories.find((m) => m.profileId === owner && m.characterId === characterId && m.id === id);
      if (!found) return null;
      const { profileId: _p, characterId: _c, ...item } = found;
      return item;
    },
    async memoryInsert(owner, rowsIn: LuxMemoryWrite[]) {
      for (const row of rowsIn) {
        memories.push({
          id: randomUUID(),
          profileId: owner,
          characterId: row.characterId,
          kind: row.kind,
          subject: row.subject,
          content: row.content,
          pinned: row.pinned,
          source: row.source,
          createdAt: new Date(NOW).toISOString(),
          expiresAt: row.expiresAt,
        });
      }
    },
    async memoryUpdate(owner, characterId, id, patch) {
      const found = memories.find((m) => m.profileId === owner && m.characterId === characterId && m.id === id);
      if (!found) return false;
      if (patch.content !== undefined) found.content = patch.content;
      if (patch.pinned !== undefined) found.pinned = patch.pinned;
      if (patch.expiresAt !== undefined) found.expiresAt = patch.expiresAt;
      return true;
    },
    async memoryDelete(owner, characterId, id) {
      const index = memories.findIndex((m) => m.profileId === owner && m.characterId === characterId && m.id === id);
      if (index < 0) return false;
      memories.splice(index, 1);
      return true;
    },
    async memoryPrune() {},
  };

  return { db, profiles, characters, memories, replies, speech, settings, usage, plans };
}

function fakeFetch(content: string) {
  const bodies: Array<{ model: string }> = [];
  const fn = (async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as { model: string });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fn, bodies };
}

const streamer = (id: string, extra: Partial<LuxProfile> = {}): LuxProfile => ({
  id,
  role: 'streamer',
  luxEnabled: true,
  planId: 'basico',
  luxCharacterId: null,
  ...extra,
});
const admin = (id = A1): LuxProfile => ({ id, role: 'admin', luxEnabled: false, planId: 'basico', luxCharacterId: null });

/** Deps de una llamada: quién hace la petición, la base de datos y el reloj fijo. */
const as = (w: ReturnType<typeof fakeWorld>, id: string, role = 'streamer', extra: Record<string, unknown> = {}) => ({
  auth: user(id, role),
  db: () => w.db,
  now: () => NOW,
  ...extra,
});

/** Guarda la clave de NVIDIA (cifrada) como lo hace el panel del administrador. */
async function withKey(w: ReturnType<typeof fakeWorld>, env: Record<string, string>) {
  const res = await handleLux('key', request('POST', { apiKey: KEY }), env, as(w, A1, 'admin'));
  expect(res.status).toBe(200);
}

async function createCharacter(w: ReturnType<typeof fakeWorld>, env: Record<string, string>, body: Record<string, unknown>): Promise<string> {
  const res = await handleLux('characters', request('POST', { op: 'create', ...body }), env, as(w, A1, 'admin'));
  expect(res.status).toBe(200);
  return String(res.body.id);
}

describe('catálogo de personajes: solo el administrador', () => {
  it('el streamer recibe 403 al listar, crear, borrar, asignar o cambiar modelos', async () => {
    const env = envWithVault();
    const w = fakeWorld({ profiles: [streamer(P1), admin()] });
    const s = as(w, P1);

    const results = [
      await handleLux('characters', request('GET'), env, s),
      await handleLux('characters', request('GET', undefined, { profile: P1 }), env, s),
      await handleLux('characters', request('POST', { op: 'create', name: 'Pirata' }), env, s),
      await handleLux('characters', request('POST', { op: 'delete', id: randomUUID() }), env, s),
      await handleLux('characters', request('POST', { op: 'assign', profile: P1, characterId: null }), env, s),
      await handleLux('models', request('GET'), env, s),
      await handleLux('models', request('POST', { provider: 'nvidia', model: GEMMA, cost: 5 }), env, s),
    ];
    for (const res of results) {
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('not_admin');
    }
    expect(w.characters).toHaveLength(1);
    expect(w.profiles.get(P1)?.luxCharacterId).toBeNull();
  });

  it('el administrador crea un personaje con avatar por defecto; valida el color y los gestos', async () => {
    const env = envWithVault();
    const w = fakeWorld({ profiles: [streamer(P1), admin()] });
    const id = await createCharacter(w, env, { name: 'Sombra', color: '#22AAFF', gestures: ['wave', 'bow', 'wave'] });

    const list = await handleLux('characters', request('GET'), env, as(w, A1, 'admin'));
    const created = (list.body.characters as LuxCharacter[]).find((c) => c.id === id);
    expect(created).toMatchObject({ name: 'Sombra', avatar: 'lux', color: '#22aaff', gestures: ['wave', 'bow'], model: null, isDefault: false });

    const badColor = await handleLux('characters', request('POST', { op: 'create', name: 'X', color: 'rojo' }), env, as(w, A1, 'admin'));
    expect(badColor.status).toBe(400);
    expect(badColor.body.field).toBe('color');
    const badGesture = await handleLux('characters', request('POST', { op: 'create', name: 'X', gestures: ['moonwalk'] }), env, as(w, A1, 'admin'));
    expect(badGesture.status).toBe(400);
    expect(badGesture.body.field).toBe('gestures');
  });

  it('el personaje por defecto no se borra; otro sí, y las cuentas que lo tenían vuelven al por defecto', async () => {
    const env = envWithVault();
    const w = fakeWorld({ profiles: [streamer(P1, { luxCharacterId: LUX_ID }), admin()] });
    const id = await createCharacter(w, env, { name: 'Sombra' });
    const a = as(w, A1, 'admin');

    expect((await handleLux('characters', request('POST', { op: 'delete', id: LUX_ID }), env, a)).status).toBe(409);
    expect((await handleLux('characters', request('POST', { op: 'default', id }), env, a)).status).toBe(200);
    expect(w.characters.find((c) => c.id === LUX_ID)?.isDefault).toBe(false);
    expect((await handleLux('characters', request('POST', { op: 'delete', id: LUX_ID }), env, a)).status).toBe(200);
    expect(w.characters.map((c) => c.id)).toEqual([id]);
  });
});

describe('asignación de personaje por streamer', () => {
  it('el administrador asigna un personaje y la respuesta y el panel usan ese personaje', async () => {
    const env = envWithVault();
    const w = fakeWorld({ profiles: [streamer(P1), admin()] });
    await withKey(w, env);
    const id = await createCharacter(w, env, { name: 'Sombra' });
    const assign = await handleLux('characters', request('POST', { op: 'assign', profile: P1, characterId: id }), env, as(w, A1, 'admin'));
    expect(assign.status).toBe(200);

    const { fn } = fakeFetch('Hola');
    const reply = await handleLux('reply', request('POST', { message: 'hola' }), env, as(w, P1, 'streamer', { fetch: fn }));
    expect(reply.status).toBe(200);
    expect(reply.body.character).toBe('Sombra');

    const view = await handleLux('character', request('GET'), env, as(w, P1));
    expect(view.body.character).toMatchObject({ id, name: 'Sombra' });
  });

  it('la memoria es del personaje: al cambiar de personaje no se mezcla con la del anterior', async () => {
    const env = envWithVault();
    const w = fakeWorld({ profiles: [streamer(P1), admin()] });
    const sombra = await createCharacter(w, env, { name: 'Sombra' });
    const s = as(w, P1);

    await handleLux('memory', request('POST', { op: 'create', kind: 'fact', content: 'Le gusta el café' }), env, s);
    await handleLux('characters', request('POST', { op: 'assign', profile: P1, characterId: sombra }), env, as(w, A1, 'admin'));

    const empty = await handleLux('memory', request('GET'), env, s);
    expect(empty.body.memories).toEqual([]);
    await handleLux('memory', request('POST', { op: 'create', kind: 'fact', content: 'Se llama Ana' }), env, s);
    expect(((await handleLux('memory', request('GET'), env, s)).body.memories as LuxMemoryItem[]).map((m) => m.content)).toEqual(['Se llama Ana']);

    await handleLux('characters', request('POST', { op: 'assign', profile: P1, characterId: null }), env, as(w, A1, 'admin'));
    const back = await handleLux('memory', request('GET'), env, s);
    expect((back.body.memories as LuxMemoryItem[]).map((m) => m.content)).toEqual(['Le gusta el café']);
  });

  it('el overlay recibe el color, el avatar y los gestos del personaje activo', async () => {
    const env = envWithVault();
    const w = fakeWorld({ profiles: [streamer(P1)], widgetKeys: { [WIDGET_KEY]: P1 } });
    const id = await createCharacter(w, env, { name: 'Sombra', color: '#22aaff', gestures: ['wave'] });
    await handleLux('characters', request('POST', { op: 'assign', profile: P1, characterId: id }), env, as(w, A1, 'admin'));

    const res = await handleLux('speech', request('GET', undefined, { k: WIDGET_KEY }), env, { db: () => w.db, now: () => NOW });
    expect(res.status).toBe(200);
    expect(res.body.character).toEqual({ avatar: 'lux', licenseNotice: null, color: '#22aaff', gestures: ['wave'] });
  });
});

describe('modelo por personaje', () => {
  it('cada personaje usa su modelo; sin modelo propio, el modelo por defecto del proveedor', async () => {
    const env = envWithVault();
    const w = fakeWorld({ profiles: [streamer(P1), admin()] });
    await withKey(w, env);
    const id = await createCharacter(w, env, { name: 'Sombra', model: GEMMA });
    const { fn, bodies } = fakeFetch('ok');
    const s = as(w, P1, 'streamer', { fetch: fn });

    await handleLux('characters', request('POST', { op: 'assign', profile: P1, characterId: id }), env, as(w, A1, 'admin'));
    expect((await handleLux('reply', request('POST', { message: 'hola' }), env, s)).body.model).toBe(GEMMA);
    await handleLux('characters', request('POST', { op: 'assign', profile: P1, characterId: null }), env, as(w, A1, 'admin'));
    expect((await handleLux('reply', request('POST', { message: 'hola' }), env, s)).body.model).toBe(DEFAULT_MODEL);
    expect(bodies.map((b) => b.model)).toEqual([GEMMA, DEFAULT_MODEL]);
  });

  it('deshabilitar un modelo pasa a sus personajes al modelo por defecto', async () => {
    const env = envWithVault();
    const w = fakeWorld({ profiles: [streamer(P1), admin()] });
    await withKey(w, env);
    const id = await createCharacter(w, env, { name: 'Sombra', model: GEMMA });
    await handleLux('characters', request('POST', { op: 'assign', profile: P1, characterId: id }), env, as(w, A1, 'admin'));

    const off = await handleLux('models', request('POST', { provider: 'nvidia', model: GEMMA, enabled: false }), env, as(w, A1, 'admin'));
    expect(off.status).toBe(200);
    expect(off.body.movedCharacters).toBe(1);
    expect(w.characters.find((c) => c.id === id)?.model).toBeNull();

    const { fn, bodies } = fakeFetch('ok');
    const reply = await handleLux('reply', request('POST', { message: 'hola' }), env, as(w, P1, 'streamer', { fetch: fn }));
    expect(bodies[0].model).toBe(DEFAULT_MODEL);
    expect(reply.body.modelNote).toBeNull();
  });

  it('si un modelo deshabilitado sigue en un personaje, la respuesta usa el por defecto y lo dice', async () => {
    const env = envWithVault();
    const w = fakeWorld({ profiles: [streamer(P1)] });
    await withKey(w, env);
    const id = await createCharacter(w, env, { name: 'Sombra', model: GEMMA });
    await handleLux('characters', request('POST', { op: 'assign', profile: P1, characterId: id }), env, as(w, A1, 'admin'));
    w.settings.set(MODEL_CONFIG_SETTING, JSON.stringify({ nvidia: { [GEMMA]: { enabled: false } } }));

    const { fn, bodies } = fakeFetch('ok');
    const reply = await handleLux('reply', request('POST', { message: 'hola' }), env, as(w, P1, 'streamer', { fetch: fn }));
    expect(bodies[0].model).toBe(DEFAULT_MODEL);
    expect(reply.body.modelNote).toBe('disabled');
  });

  it('el modelo por defecto no se puede deshabilitar ni cobrar, y no se elige un modelo de otro proveedor', async () => {
    const env = envWithVault();
    const w = fakeWorld({ profiles: [streamer(P1)] });
    const a = as(w, A1, 'admin');

    expect((await handleLux('models', request('POST', { provider: 'nvidia', model: DEFAULT_MODEL, enabled: false }), env, a)).body.code).toBe('default_model');
    expect((await handleLux('models', request('POST', { provider: 'nvidia', model: DEFAULT_MODEL, cost: 3 }), env, a)).body.code).toBe('default_model');
    expect((await handleLux('models', request('POST', { provider: 'nvidia', model: 'otro/modelo', cost: 1 }), env, a)).status).toBe(400);
    expect((await handleLux('models', request('POST', { provider: 'mistral', model: GEMMA, cost: 1 }), env, a)).status).toBe(400);
    expect((await handleLux('models', request('POST', { provider: 'nvidia', model: GEMMA, cost: 3 }), env, a)).status).toBe(200);
    // Cambiar el por defecto a uno de pago tampoco vale.
    expect((await handleLux('model', request('POST', { provider: 'nvidia', model: GEMMA }), env, a)).body.code).toBe('default_model');
  });

  it('el catálogo de la lista muestra habilitado y coste de cada modelo', async () => {
    const env = envWithVault();
    const w = fakeWorld({ profiles: [streamer(P1)] });
    await handleLux('models', request('POST', { provider: 'nvidia', model: GEMMA, cost: 4 }), env, as(w, A1, 'admin'));
    const res = await handleLux('models', request('GET'), env, as(w, A1, 'admin'));
    const nvidia = (res.body.providers as Array<{ id: string; models: Array<{ id: string; cost: number; enabled: boolean; isDefault: boolean }> }>).find(
      (p) => p.id === 'nvidia'
    );
    expect(nvidia?.models.find((m) => m.id === GEMMA)).toMatchObject({ cost: 4, enabled: true, isDefault: false });
    expect(nvidia?.models.find((m) => m.id === DEFAULT_MODEL)).toMatchObject({ cost: 0, enabled: true, isDefault: true });
  });
});

describe('tope mensual del plan', () => {
  it('si el modelo de pago superaría el tope, el personaje vuelve al por defecto y el panel lo avisa', async () => {
    const env = envWithVault();
    const w = fakeWorld({ profiles: [streamer(P1), admin()], plans: { basico: 10 } });
    await withKey(w, env);
    await handleLux('models', request('POST', { provider: 'nvidia', model: GEMMA, cost: 5 }), env, as(w, A1, 'admin'));
    const id = await createCharacter(w, env, { name: 'Sombra', model: GEMMA });
    await handleLux('characters', request('POST', { op: 'assign', profile: P1, characterId: id }), env, as(w, A1, 'admin'));
    w.usage.set(`${P1}:${MONTH}`, 8);

    const { fn, bodies } = fakeFetch('ok');
    const reply = await handleLux('reply', request('POST', { message: 'hola' }), env, as(w, P1, 'streamer', { fetch: fn }));
    expect(bodies[0].model).toBe(DEFAULT_MODEL);
    expect(reply.body.modelNote).toBe('budget');
    expect(w.usage.get(`${P1}:${MONTH}`)).toBe(8);

    const view = await handleLux('character', request('GET'), env, as(w, P1));
    expect(view.body.modelNote).toBe('budget');
    expect(view.body.usage).toEqual({ credits: 8, budget: 10 });
  });

  it('dentro del tope usa el modelo de pago y suma su coste al consumo del mes', async () => {
    const env = envWithVault();
    const w = fakeWorld({ profiles: [streamer(P1), admin()], plans: { basico: 10 } });
    await withKey(w, env);
    await handleLux('models', request('POST', { provider: 'nvidia', model: GEMMA, cost: 5 }), env, as(w, A1, 'admin'));
    const id = await createCharacter(w, env, { name: 'Sombra', model: GEMMA });
    await handleLux('characters', request('POST', { op: 'assign', profile: P1, characterId: id }), env, as(w, A1, 'admin'));

    const { fn, bodies } = fakeFetch('ok');
    const reply = await handleLux('reply', request('POST', { message: 'hola' }), env, as(w, P1, 'streamer', { fetch: fn }));
    expect(bodies[0].model).toBe(GEMMA);
    expect(reply.body.modelNote).toBeNull();
    expect(w.usage.get(`${P1}:${MONTH}`)).toBe(5);
  });

  it('un plan sin tope de créditos para modelos de pago cae al por defecto (cero por defecto)', async () => {
    const env = envWithVault();
    const w = fakeWorld({ profiles: [streamer(P1, { planId: 'sin-plan' })] });
    await withKey(w, env);
    await handleLux('models', request('POST', { provider: 'nvidia', model: GEMMA, cost: 1 }), env, as(w, A1, 'admin'));
    const id = await createCharacter(w, env, { name: 'Sombra', model: GEMMA });
    await handleLux('characters', request('POST', { op: 'assign', profile: P1, characterId: id }), env, as(w, A1, 'admin'));

    const { fn, bodies } = fakeFetch('ok');
    const reply = await handleLux('reply', request('POST', { message: 'hola' }), env, as(w, P1, 'streamer', { fetch: fn }));
    expect(bodies[0].model).toBe(DEFAULT_MODEL);
    expect(reply.body.modelNote).toBe('budget');
  });
});

describe('reglas puras de personajes y modelos', () => {
  it('pickModel usa el por defecto sin modelo propio, y cae al por defecto por deshabilitado o por tope', () => {
    const base = { provider: 'nvidia' as const, defaultModel: DEFAULT_MODEL, spent: 0, budget: 10 };
    expect(pickModel({ ...base, wanted: null, config: {} })).toEqual({ model: DEFAULT_MODEL, cost: 0, fellBack: null });
    expect(pickModel({ ...base, wanted: GEMMA, config: {} })).toEqual({ model: GEMMA, cost: 0, fellBack: null });
    expect(pickModel({ ...base, wanted: GEMMA, config: { nvidia: { [GEMMA]: { enabled: false } } } }).fellBack).toBe('disabled');
    expect(pickModel({ ...base, wanted: 'mistral-x', config: {} }).fellBack).toBe('disabled');
    expect(pickModel({ ...base, wanted: GEMMA, config: { nvidia: { [GEMMA]: { cost: 4 } } }, spent: 7 }).fellBack).toBe('budget');
    expect(pickModel({ ...base, wanted: GEMMA, config: { nvidia: { [GEMMA]: { cost: 4 } } }, spent: 6 })).toEqual({ model: GEMMA, cost: 4, fellBack: null });
    // Sin tope (null) un modelo de pago siempre se usa; uno gratis nunca se bloquea.
    expect(pickModel({ ...base, wanted: GEMMA, config: { nvidia: { [GEMMA]: { cost: 4 } } }, budget: null, spent: 999 }).fellBack).toBeNull();
    expect(pickModel({ ...base, budget: 0, wanted: GEMMA, config: {} }).fellBack).toBeNull();
  });

  it('un catálogo roto no tira nada y cuenta como sin configurar', () => {
    expect(parseModelConfig('no es json')).toEqual({});
    expect(parseModelConfig('[1,2]')).toEqual({});
    expect(parseModelConfig(null)).toEqual({});
  });

  it('normalizeCharacterInput valida nombre, avatar, color, gestos y modelo', () => {
    expect(normalizeCharacterInput({ name: '   ' })).toMatchObject({ ok: false, field: 'name' });
    expect(normalizeCharacterInput({ name: 'A'.repeat(41) })).toMatchObject({ ok: false, field: 'name' });
    expect(normalizeCharacterInput({ name: 'X', avatar: 'robot' })).toMatchObject({ ok: false, field: 'avatar' });
    expect(normalizeCharacterInput({ name: 'X', color: '#abc' })).toMatchObject({ ok: false, field: 'color' });
    expect(normalizeCharacterInput({ name: 'X', model: '' })).toMatchObject({ ok: false, field: 'model' });
    const ok = normalizeCharacterInput({ name: '  Ana ', gestures: ['wave', 'wave'], model: null });
    expect(ok).toMatchObject({ ok: true, value: { name: 'Ana', avatar: 'lux', color: '#f59e0b', gestures: ['wave'], model: null } });
  });

  it('pickCharacter cae al por defecto cuando la cuenta no tiene personaje o el suyo ya no existe', () => {
    const list: LuxCharacter[] = [
      { id: 'a', name: 'Lux', avatar: 'lux', color: '#f59e0b', gestures: [], model: null, isDefault: true },
      { id: 'b', name: 'Sombra', avatar: 'lux', color: '#000000', gestures: [], model: null, isDefault: false },
    ];
    expect(pickCharacter(list, 'b').name).toBe('Sombra');
    expect(pickCharacter(list, null).name).toBe('Lux');
    expect(pickCharacter(list, 'borrado').name).toBe('Lux');
    expect(pickCharacter([], null).name).toBe('Lux');
  });
});
