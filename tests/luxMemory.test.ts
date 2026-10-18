/**
 * tests/luxMemory.test.ts
 *
 * Memoria de Lux: reglas de los recuerdos (tipos, límites, caducidad), filtro de
 * lo que nunca se guarda del chat, lectura del resumen del modelo, la ruta
 * /api/lux/memory (solo el dueño escribe) y el resumen del chat (C2).
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { handleLux } from '../server/lux/handlers';
import {
  ADMIN_UPLOAD_MAX_BYTES,
  MEMORY_CONTENT_MAX,
  MEMORY_SAVED_MAX,
  MEMORY_TTL_MS,
  expiresAtFor,
  normalizeMemoryEdit,
  normalizeNewMemory,
  screenMemory,
  splitIntoMemories,
} from '../server/lux/memory';
import { buildDigestMessages, keepDigestItems, normalizeDigestLines, parseDigest } from '../server/lux/digest';
import { DEFAULT_LUX_SETTINGS, normalizeLuxSettings, rowFromSettings, settingsFromRow } from '../server/lux/settings';
import type { LuxDb, LuxMemoryItem, LuxProfile } from '../server/lux/luxDb';
import { fail, type IntegrationRequest } from '../server/integrations/http';

const VALID_KEY = 'nvapi-abcdefghijklmnop1234';
const WIDGET_KEY = 'clave-obs-de-prueba-1234567890';
const NOW = Date.UTC(2026, 9, 18, 12);
const DAY = 24 * 60 * 60 * 1000;

const envWithVault = () => ({ INTEGRATIONS_ENC_KEY: randomBytes(32).toString('base64url') });
const request = (method: string, body?: unknown): IntegrationRequest => ({ method, headers: {}, query: {}, body });
const asUser = (id: string, role = 'streamer') => async () => ({ id, role, status: 'active' });
const notLoggedIn = async () => fail(401, 'no_session', 'Hay que iniciar sesión.');

/** Almacén en memoria con la misma forma que el de Supabase: cada operación filtra por el dueño. */
type Stored = LuxMemoryItem & { profileId: string };

function fakeDb(seed: { profiles?: LuxProfile[]; widgetKeys?: Record<string, string>; memories?: Stored[] } = {}) {
  const profiles = new Map((seed.profiles ?? []).map((p) => [p.id, p]));
  const keys = new Map(Object.entries(seed.widgetKeys ?? {}));
  const settings = new Map<string, string>();
  const rows = new Map<string, Record<string, unknown>>();
  const replies: unknown[] = [];
  const pruned: Array<{ owner: string; nowIso: string }> = [];
  // El dueño va aparte de la fila que ve el streamer (profileId no forma parte de LuxMemoryItem).
  const memories: Stored[] = (seed.memories ?? []).map((m) => ({ ...m }));

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
    async memories() {
      return [];
    },
    async insertReply(row) {
      replies.push(row);
    },
    async settingsRow(id) {
      return rows.get(id) ?? null;
    },
    async saveSettingsRow(row) {
      rows.set(String(row.profile_id), row);
    },
    async memoryList(owner) {
      return memories
        .filter((m) => m.profileId === owner)
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt))
        .slice(0, MEMORY_SAVED_MAX)
        .map(({ profileId: _owner, ...item }) => item);
    },
    async memoryGet(owner, id) {
      const found = memories.find((m) => m.profileId === owner && m.id === id);
      if (!found) return null;
      const { profileId: _owner, ...item } = found;
      return item;
    },
    async memoryInsert(owner, rowsIn) {
      for (const row of rowsIn) {
        memories.push({
          id: randomUUID(),
          profileId: owner,
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
    async memoryUpdate(owner, id, patch) {
      const found = memories.find((m) => m.profileId === owner && m.id === id);
      if (!found) return false;
      if (patch.content !== undefined) found.content = patch.content;
      if (patch.pinned !== undefined) found.pinned = patch.pinned;
      if (patch.expiresAt !== undefined) found.expiresAt = patch.expiresAt;
      return true;
    },
    async memoryDelete(owner, id) {
      const index = memories.findIndex((m) => m.profileId === owner && m.id === id);
      if (index < 0) return false;
      memories.splice(index, 1);
      return true;
    },
    async memoryPrune(owner, nowIso) {
      pruned.push({ owner, nowIso });
      for (let i = memories.length - 1; i >= 0; i--) {
        const m = memories[i];
        if (m.profileId === owner && !m.pinned && m.expiresAt !== null && m.expiresAt < nowIso) memories.splice(i, 1);
      }
    },
  };
  return { db, memories, pruned, replies, settings, rows };
}

function fakeFetch(content: string) {
  const bodies: string[] = [];
  const fn = (async (_url: unknown, init?: RequestInit) => {
    bodies.push(String(init?.body ?? ''));
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fn, bodies };
}

const streamer: LuxProfile = { id: 'p1', role: 'streamer', luxEnabled: true };
const other: LuxProfile = { id: 'p2', role: 'streamer', luxEnabled: true };

const mem = (over: Partial<LuxMemoryItem> & { profileId: string }): LuxMemoryItem & { profileId: string } => ({
  id: randomUUID(),
  kind: 'fact',
  subject: null,
  content: 'Juega a Valorant',
  pinned: false,
  source: 'manual',
  createdAt: new Date(NOW - 2 * DAY).toISOString(),
  expiresAt: null,
  ...over,
});

describe('reglas de los recuerdos', () => {
  it('a mano solo se aceptan dato (fact) y estilo (style)', () => {
    expect(normalizeNewMemory({ kind: 'fact', content: ' Juega a Valorant ' })).toEqual({ ok: true, value: { kind: 'fact', content: 'Juega a Valorant' } });
    expect(normalizeNewMemory({ kind: 'style', content: 'Dice «vamos equipo»' }).ok).toBe(true);
    expect(normalizeNewMemory({ kind: 'viewer', content: 'Ana' })).toMatchObject({ ok: false, field: 'kind' });
    expect(normalizeNewMemory({ kind: 'event', content: 'Torneo' })).toMatchObject({ ok: false, field: 'kind' });
  });

  it('el texto va de 1 a 300 caracteres', () => {
    expect(normalizeNewMemory({ kind: 'fact', content: '   ' })).toMatchObject({ ok: false, field: 'content' });
    expect(normalizeNewMemory({ kind: 'fact', content: 'a'.repeat(MEMORY_CONTENT_MAX) }).ok).toBe(true);
    expect(normalizeNewMemory({ kind: 'fact', content: 'a'.repeat(MEMORY_CONTENT_MAX + 1) })).toMatchObject({ ok: false, field: 'content' });
    expect(normalizeNewMemory({ kind: 'fact', content: 42 })).toMatchObject({ ok: false, field: 'content' });
  });

  it('una edición cambia el texto o el fijado, y al menos uno', () => {
    expect(normalizeMemoryEdit({ pinned: true })).toEqual({ ok: true, value: { pinned: true } });
    expect(normalizeMemoryEdit({ content: 'nuevo' })).toEqual({ ok: true, value: { content: 'nuevo' } });
    expect(normalizeMemoryEdit({})).toMatchObject({ ok: false });
    expect(normalizeMemoryEdit({ pinned: 'sí' })).toMatchObject({ ok: false, field: 'pinned' });
  });

  it('solo los recuerdos del chat caducan, a los 30 días, y fijarlos lo quita', () => {
    expect(expiresAtFor('fact', false, NOW)).toBeNull();
    expect(expiresAtFor('style', false, NOW)).toBeNull();
    expect(expiresAtFor('viewer', true, NOW)).toBeNull();
    expect(expiresAtFor('event', false, NOW)).toBe(new Date(NOW + MEMORY_TTL_MS).toISOString());
    expect(MEMORY_TTL_MS).toBe(30 * DAY);
  });
});

describe('filtro de lo que nunca se guarda del chat (C3)', () => {
  it.each([
    ['enlace', 'mira https://ejemplo.com en el canal', 'enlace'],
    ['correo', 'escríbele a juan@correo.es', 'correo'],
    ['teléfono', 'mi móvil es 600 123 456', 'teléfono'],
    ['dirección', 'vive en la calle Mayor 12', 'dirección'],
    ['salud', 'comentó que tiene diabetes', 'salud'],
    ['religión', 'va a misa, es católico', 'religión'],
    ['política', 'dice que vota a Vox', 'política'],
    ['orientación', 'comentó que es gay', 'orientación'],
    ['insulto', 'eres un idiota', 'insulto'],
  ])('descarta %s', (_name, text, reason) => {
    expect(screenMemory(text)).toBe(reason);
  });

  it('deja pasar recuerdos normales', () => {
    expect(screenMemory('Juega sobre todo a Valorant los martes')).toBeNull();
    expect(screenMemory('Ana llega la primera a los directos')).toBeNull();
    expect(screenMemory('Torneo de Valorant el 3 de noviembre')).toBeNull();
  });
});

describe('lectura del resumen del modelo', () => {
  it('acepta el array aunque venga con texto o bloque de código alrededor', () => {
    const text = '```json\n[{"kind":"viewer","subject":"Ana","content":"Llega la primera a los directos"}]\n```';
    expect(parseDigest(text)).toEqual([{ kind: 'viewer', subject: 'Ana', content: 'Llega la primera a los directos' }]);
    expect(parseDigest('Aquí tienes: [{"kind":"event","content":"Torneo el 3 de noviembre"}] ¡suerte!')).toEqual([
      { kind: 'event', subject: null, content: 'Torneo el 3 de noviembre' },
    ]);
  });

  it('descarta lo que no encaja y nunca devuelve más de 5', () => {
    expect(parseDigest('[{"kind":"fact","content":"x"},{"kind":"viewer"}]')).toEqual([]);
    expect(parseDigest('no es json')).toEqual([]);
    expect(parseDigest('[')).toEqual([]);
    const seven = Array.from({ length: 7 }, (_, i) => ({ kind: 'viewer', content: `recuerdo ${i}` }));
    expect(parseDigest(JSON.stringify(seven))).toHaveLength(5);
  });

  it('quita los propuestos que tocan algo prohibido, también en el nombre', () => {
    const items = parseDigest(
      JSON.stringify([
        { kind: 'viewer', subject: 'Ana', content: 'Mira https://ejemplo.com' },
        { kind: 'viewer', subject: 'Ana', content: 'Tiene diabetes' },
        { kind: 'viewer', subject: 'Ana', content: 'tu jugada es una mierda' },
        { kind: 'viewer', subject: 'Ana', content: 'Llega la primera a los directos' },
      ])
    );
    expect(keepDigestItems(items).map((i) => i.content)).toEqual(['Llega la primera a los directos']);
  });

  it('los mensajes del chat: sin comandos, sin vacíos, los últimos 200 y autor por defecto', () => {
    const lines = normalizeDigestLines([
      { viewer: 'ana', text: 'hola' },
      { viewer: 'luis', text: '!lux qué hora es' },
      { text: 'sin autor' },
      { viewer: 'x', text: '   ' },
    ]);
    expect(lines).toEqual([
      { viewer: 'ana', text: 'hola' },
      { viewer: 'Espectador', text: 'sin autor' },
    ]);
    const many = Array.from({ length: 250 }, (_, i) => ({ viewer: 'a', text: `m${i}` }));
    const kept = normalizeDigestLines(many);
    expect(kept).toHaveLength(200);
    expect(kept[199].text).toBe('m249');
  });

  it('el aviso al modelo prohíbe copiar mensajes y los datos prohibidos', () => {
    const [system, user] = buildDigestMessages([{ viewer: 'ana', text: 'hola' }], ['Juega a Valorant']);
    expect(system.content).toContain('no copies mensajes');
    expect(system.content).toContain('enlaces, correos, teléfonos');
    expect(system.content).toContain('Juega a Valorant');
    expect(user.content).toBe('ana: hola');
  });
});

describe('ajustes: aprender del chat (C1), apagado por defecto', () => {
  it('por defecto está apagado y se valida como sí o no', () => {
    expect(DEFAULT_LUX_SETTINGS.chatLearning).toBe(false);
    expect(settingsFromRow(null).chatLearning).toBe(false);
    expect(normalizeLuxSettings({ chatLearning: 'sí' })).toMatchObject({ ok: false, field: 'chatLearning' });
    expect(normalizeLuxSettings({ chatLearning: true })).toMatchObject({ ok: true, value: { chatLearning: true } });
  });

  it('se lee de chat_learning y se guarda en esa columna', () => {
    expect(settingsFromRow({ chat_learning: true }).chatLearning).toBe(true);
    expect(settingsFromRow({ chat_learning: 'raro' }).chatLearning).toBe(false);
    expect(rowFromSettings('p1', { ...DEFAULT_LUX_SETTINGS, chatLearning: true }).chat_learning).toBe(true);
  });
});

describe('ruta /api/lux/memory', () => {
  it('sin sesión no hay acceso', async () => {
    const { db } = fakeDb({ profiles: [streamer] });
    const res = await handleLux('memory', request('GET'), envWithVault(), { auth: notLoggedIn, db: () => db });
    expect(res.status).toBe(401);
  });

  it('una cuenta sin Lux no puede usar la memoria', async () => {
    const { db } = fakeDb({ profiles: [{ id: 'p3', role: 'streamer', luxEnabled: false }] });
    const res = await handleLux('memory', request('GET'), envWithVault(), { auth: asUser('p3'), db: () => db });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('lux_disabled');
  });

  it('crea un dato o un estilo y no caduca', async () => {
    const { db, memories } = fakeDb({ profiles: [streamer] });
    const deps = { auth: asUser('p1'), db: () => db, now: () => NOW };
    const res = await handleLux('memory', request('POST', { op: 'create', kind: 'style', content: 'Digo «vamos equipo»' }), envWithVault(), deps);
    expect(res.status).toBe(200);
    expect(memories).toHaveLength(1);
    expect(memories[0]).toMatchObject({ kind: 'style', source: 'manual', pinned: false, expiresAt: null, profileId: 'p1' });
  });

  it('rechaza un tipo que no se escribe a mano y un texto de más de 300 caracteres', async () => {
    const { db, memories } = fakeDb({ profiles: [streamer] });
    const deps = { auth: asUser('p1'), db: () => db, now: () => NOW };
    const badKind = await handleLux('memory', request('POST', { op: 'create', kind: 'viewer', content: 'Ana' }), envWithVault(), deps);
    expect(badKind).toMatchObject({ status: 400, body: { code: 'bad_memory', field: 'kind' } });
    const long = await handleLux('memory', request('POST', { op: 'create', kind: 'fact', content: 'a'.repeat(301) }), envWithVault(), deps);
    expect(long).toMatchObject({ status: 400, body: { field: 'content' } });
    expect(memories).toHaveLength(0);
  });

  it('con 100 guardados no admite más', async () => {
    const seed = Array.from({ length: MEMORY_SAVED_MAX }, () => mem({ profileId: 'p1' }));
    const { db, memories } = fakeDb({ profiles: [streamer], memories: seed });
    const res = await handleLux('memory', request('POST', { op: 'create', kind: 'fact', content: 'uno más' }), envWithVault(), {
      auth: asUser('p1'),
      db: () => db,
      now: () => NOW,
    });
    expect(res).toMatchObject({ status: 409, body: { code: 'memory_full' } });
    expect(memories).toHaveLength(MEMORY_SAVED_MAX);
  });

  it('el dueño sale de la sesión: el id de perfil del cuerpo se ignora', async () => {
    const { db, memories } = fakeDb({ profiles: [streamer, other] });
    await handleLux('memory', request('POST', { op: 'create', kind: 'fact', content: 'x', profile_id: 'p2' }), envWithVault(), {
      auth: asUser('p1'),
      db: () => db,
      now: () => NOW,
    });
    expect(memories.map((m) => m.profileId)).toEqual(['p1']);
  });

  it('no se puede editar ni borrar el recuerdo de otro streamer', async () => {
    const theirs = mem({ profileId: 'p2', content: 'de otro' });
    const { db, memories } = fakeDb({ profiles: [streamer, other], memories: [theirs] });
    const deps = { auth: asUser('p1'), db: () => db, now: () => NOW };
    const edit = await handleLux('memory', request('POST', { op: 'update', id: theirs.id, content: 'cambiado' }), envWithVault(), deps);
    const del = await handleLux('memory', request('POST', { op: 'delete', id: theirs.id }), envWithVault(), deps);
    expect(edit.status).toBe(404);
    expect(del.status).toBe(404);
    expect(memories[0].content).toBe('de otro');
  });

  it('edita el texto, fija, y borra los suyos', async () => {
    const mine = mem({ profileId: 'p1' });
    const { db, memories } = fakeDb({ profiles: [streamer], memories: [mine] });
    const deps = { auth: asUser('p1'), db: () => db, now: () => NOW };
    expect((await handleLux('memory', request('POST', { op: 'update', id: mine.id, content: 'nuevo' }), envWithVault(), deps)).status).toBe(200);
    expect((await handleLux('memory', request('POST', { op: 'update', id: mine.id, pinned: true }), envWithVault(), deps)).status).toBe(200);
    expect(memories[0]).toMatchObject({ content: 'nuevo', pinned: true });
    expect((await handleLux('memory', request('POST', { op: 'delete', id: mine.id }), envWithVault(), deps)).status).toBe(200);
    expect(memories).toHaveLength(0);
  });

  it('desfijar un recuerdo del chat le da 30 días desde ahora; fijarlo los quita', async () => {
    const learned = mem({ profileId: 'p1', kind: 'event', source: 'chat', pinned: true, expiresAt: null, content: 'Torneo el 3 de noviembre' });
    const { db, memories } = fakeDb({ profiles: [streamer], memories: [learned] });
    const deps = { auth: asUser('p1'), db: () => db, now: () => NOW };
    await handleLux('memory', request('POST', { op: 'update', id: learned.id, pinned: false }), envWithVault(), deps);
    expect(memories[0].expiresAt).toBe(new Date(NOW + MEMORY_TTL_MS).toISOString());
    await handleLux('memory', request('POST', { op: 'update', id: learned.id, pinned: true }), envWithVault(), deps);
    expect(memories[0].expiresAt).toBeNull();
  });

  it('la lista borra antes lo caducado, cuenta lo que se usa y avisa si la memoria está apagada', async () => {
    const expired = mem({ profileId: 'p1', kind: 'viewer', source: 'chat', expiresAt: new Date(NOW - DAY).toISOString() });
    const seed = [expired, ...Array.from({ length: 25 }, () => mem({ profileId: 'p1' }))];
    const { db, pruned } = fakeDb({ profiles: [streamer], memories: seed });
    const res = await handleLux('memory', request('GET'), envWithVault(), { auth: asUser('p1'), db: () => db, now: () => NOW });
    expect(res.status).toBe(200);
    expect(pruned).toEqual([{ owner: 'p1', nowIso: new Date(NOW).toISOString() }]);
    expect(res.body.saved).toBe(25);
    expect(res.body.usedInReply).toBe(20);
    expect(res.body.usedMax).toBe(20);
    expect((res.body.memories as LuxMemoryItem[]).some((m) => m.id === expired.id)).toBe(false);
  });

  it('con la memoria apagada en Ajustes, ninguno se cuenta como usado', async () => {
    const { db, rows } = fakeDb({ profiles: [streamer], memories: [mem({ profileId: 'p1' })] });
    rows.set('p1', rowFromSettings('p1', { ...DEFAULT_LUX_SETTINGS, memoryEnabled: false }));
    const res = await handleLux('memory', request('GET'), envWithVault(), { auth: asUser('p1'), db: () => db, now: () => NOW });
    expect(res.body.usedInReply).toBe(0);
    expect(res.body.memoryEnabled).toBe(false);
  });

  it('una operación desconocida no hace nada', async () => {
    const { db, memories } = fakeDb({ profiles: [streamer] });
    const res = await handleLux('memory', request('POST', { op: 'vaciar' }), envWithVault(), { auth: asUser('p1'), db: () => db, now: () => NOW });
    expect(res.status).toBe(400);
    expect(memories).toHaveLength(0);
  });
});

describe('resumen del chat (C2): ruta /api/lux/chat con command digest', () => {
  async function setup(learning: boolean, memories: Stored[] = []) {
    const env = envWithVault();
    const fake = fakeDb({ profiles: [streamer], widgetKeys: { [WIDGET_KEY]: 'p1' }, memories });
    await handleLux('key', request('POST', { apiKey: VALID_KEY }), env, { auth: asUser('a1', 'admin'), db: () => fake.db });
    await handleLux('config', request('POST', { chatLearning: learning }), env, { auth: asUser('p1'), db: () => fake.db });
    return { env, fake };
  }
  const lines = [
    { viewer: 'ana', text: 'llegó otra vez la primera, qué crack' },
    { viewer: 'luis', text: 'el torneo es el 3 de noviembre' },
  ];

  it('con el aprendizaje apagado no se llama al modelo y se dice por qué', async () => {
    const { env, fake } = await setup(false);
    const model = fakeFetch('[]');
    const res = await handleLux('chat', request('POST', { k: WIDGET_KEY, command: 'digest', messages: lines }), env, {
      db: () => fake.db,
      fetch: model.fn,
      now: () => NOW,
    });
    expect(res.body).toEqual({ skipped: 'learning_off' });
    expect(model.bodies).toHaveLength(0);
  });

  it('learn_status dice si el bot puede mandar el chat ahora', async () => {
    const on = await setup(true);
    const ready = await handleLux('chat', request('POST', { k: WIDGET_KEY, command: 'learn_status' }), on.env, { db: () => on.fake.db, now: () => NOW });
    expect(ready.body).toEqual({ learning: true, ready: true, waitSeconds: 0 });
    const off = await setup(false);
    const notLearning = await handleLux('chat', request('POST', { k: WIDGET_KEY, command: 'learn_status' }), off.env, { db: () => off.fake.db, now: () => NOW });
    expect(notLearning.body).toMatchObject({ learning: false, ready: false });
  });

  it('guarda como mucho lo que sale del modelo, marcado del chat y con caducidad, sin mensajes crudos', async () => {
    const { env, fake } = await setup(true);
    const model = fakeFetch(
      JSON.stringify([
        { kind: 'viewer', subject: 'Ana', content: 'Siempre llega la primera a los directos' },
        { kind: 'event', subject: null, content: 'Torneo de Valorant el 3 de noviembre' },
      ])
    );
    const res = await handleLux('chat', request('POST', { k: WIDGET_KEY, command: 'digest', messages: lines }), env, {
      db: () => fake.db,
      fetch: model.fn,
      now: () => NOW,
    });
    expect(res.body).toEqual({ learned: 2, discarded: 0 });
    expect(fake.memories).toHaveLength(2);
    for (const m of fake.memories) {
      expect(m).toMatchObject({ source: 'chat', pinned: false, profileId: 'p1' });
      expect(m.expiresAt).toBe(new Date(NOW + MEMORY_TTL_MS).toISOString());
      expect(lines.some((line) => line.text === m.content)).toBe(false);
    }
    expect(fake.replies).toHaveLength(0);
    // Los mensajes solo viajan al modelo: no quedan en ningún ajuste ni en la base de datos.
    expect([...fake.settings.values()].join('\n')).not.toContain('qué crack');
    expect(model.bodies[0]).toContain('llegó otra vez la primera');
  });

  it('descarta lo que toca enlaces o insultos, y cuenta lo descartado', async () => {
    const { env, fake } = await setup(true);
    const model = fakeFetch(
      JSON.stringify([
        { kind: 'viewer', subject: 'Luis', content: 'Pasa su web: https://ejemplo.com' },
        { kind: 'viewer', subject: 'Luis', content: 'tu jugada es una mierda' },
        { kind: 'viewer', subject: 'Ana', content: 'Llega la primera a los directos' },
      ])
    );
    const res = await handleLux('chat', request('POST', { k: WIDGET_KEY, command: 'digest', messages: lines }), env, {
      db: () => fake.db,
      fetch: model.fn,
      now: () => NOW,
    });
    expect(res.body).toEqual({ learned: 1, discarded: 2 });
    expect(fake.memories.map((m) => m.content)).toEqual(['Llega la primera a los directos']);
  });

  it('no repite un resumen antes de 20 minutos', async () => {
    const { env, fake } = await setup(true);
    const model = fakeFetch('[]');
    const deps = { db: () => fake.db, fetch: model.fn, now: () => NOW };
    await handleLux('chat', request('POST', { k: WIDGET_KEY, command: 'digest', messages: lines }), env, deps);
    const again = await handleLux('chat', request('POST', { k: WIDGET_KEY, command: 'digest', messages: lines }), env, {
      ...deps,
      now: () => NOW + 5 * 60_000,
    });
    expect(again.body).toMatchObject({ skipped: 'too_soon' });
    expect(model.bodies).toHaveLength(1);
  });

  it('sin mensajes de verdad (solo comandos) no hay resumen', async () => {
    const { env, fake } = await setup(true);
    const res = await handleLux('chat', request('POST', { k: WIDGET_KEY, command: 'digest', messages: [{ viewer: 'ana', text: '!lux hola' }] }), env, {
      db: () => fake.db,
      fetch: fakeFetch('[]').fn,
      now: () => NOW,
    });
    expect(res.body).toEqual({ skipped: 'no_chat' });
  });

  it('con 100 guardados el resumen no añade nada', async () => {
    const full = Array.from({ length: MEMORY_SAVED_MAX }, () => mem({ profileId: 'p1' }));
    const { env, fake } = await setup(true, full);
    const res = await handleLux('chat', request('POST', { k: WIDGET_KEY, command: 'digest', messages: lines }), env, {
      db: () => fake.db,
      fetch: fakeFetch('[]').fn,
      now: () => NOW,
    });
    expect(res.body).toEqual({ skipped: 'memory_full' });
    expect(fake.memories).toHaveLength(MEMORY_SAVED_MAX);
  });

  it('con una clave de OBS que no es de nadie, no entra', async () => {
    const { env, fake } = await setup(true);
    const res = await handleLux('chat', request('POST', { k: 'otra', command: 'digest', messages: lines }), env, { db: () => fake.db, now: () => NOW });
    expect(res.status).toBe(401);
  });
});

describe('memoria del administrador (ficha de la cuenta)', () => {
  const admin = () => asUser('a1', 'admin');
  const adminRoute = (body: unknown, db: LuxDb, now = NOW) =>
    handleLux('admin-memory', request('POST', body), envWithVault(), { auth: admin(), db: () => db, now: () => now });
  const fromAdmin = (over: Partial<LuxMemoryItem> & { profileId: string }) => mem({ source: 'admin', ...over });

  it('un streamer no puede editar, fijar ni borrar lo que puso el administrador', async () => {
    const theirs = fromAdmin({ profileId: 'p1', content: 'Juega a Valorant' });
    const { db, memories } = fakeDb({ profiles: [streamer], memories: [theirs] });
    const deps = { auth: asUser('p1'), db: () => db, now: () => NOW };
    const edit = await handleLux('memory', request('POST', { op: 'update', id: theirs.id, content: 'cambiado' }), envWithVault(), deps);
    const pin = await handleLux('memory', request('POST', { op: 'update', id: theirs.id, pinned: true }), envWithVault(), deps);
    const del = await handleLux('memory', request('POST', { op: 'delete', id: theirs.id }), envWithVault(), deps);
    expect(edit).toMatchObject({ status: 403, body: { code: 'admin_memory' } });
    expect(pin).toMatchObject({ status: 403, body: { code: 'admin_memory' } });
    expect(del).toMatchObject({ status: 403, body: { code: 'admin_memory' } });
    expect(memories).toHaveLength(1);
    expect(memories[0]).toMatchObject({ content: 'Juega a Valorant', pinned: false });
  });

  it('el administrador solo edita o borra sus recuerdos, nunca los de la cuenta', async () => {
    const own = fromAdmin({ profileId: 'p1', content: 'Dato del admin' });
    const chat = mem({ profileId: 'p1', kind: 'event', source: 'chat', content: 'Torneo el 3 de noviembre' });
    const { db, memories } = fakeDb({ profiles: [streamer], memories: [own, chat] });
    expect((await adminRoute({ op: 'update', profile: 'p1', id: chat.id, content: 'x' }, db)).status).toBe(404);
    expect((await adminRoute({ op: 'delete', profile: 'p1', id: chat.id }, db)).status).toBe(404);
    expect((await adminRoute({ op: 'update', profile: 'p1', id: own.id, content: 'Dato corregido' }, db)).status).toBe(200);
    expect(memories.find((m) => m.id === own.id)?.content).toBe('Dato corregido');
    expect((await adminRoute({ op: 'delete', profile: 'p1', id: own.id }, db)).status).toBe(200);
    expect(memories.map((m) => m.id)).toEqual([chat.id]);
  });

  it('quien no es administrador no entra a la ruta del administrador, ni sin sesión', async () => {
    const { db, memories } = fakeDb({ profiles: [streamer] });
    const asStreamer = await handleLux('admin-memory', request('POST', { op: 'save', profile: 'p1', kind: 'fact', items: ['x'] }), envWithVault(), {
      auth: asUser('p1'),
      db: () => db,
      now: () => NOW,
    });
    expect(asStreamer).toMatchObject({ status: 403, body: { code: 'not_admin' } });
    const anon = await handleLux('admin-memory', request('POST', { op: 'list', profile: 'p1' }), envWithVault(), { auth: notLoggedIn, db: () => db });
    expect(anon.status).toBe(401);
    expect(memories).toHaveLength(0);
  });

  it('la carga respeta el cupo de 100: si no caben, no se guarda nada', async () => {
    const seed = Array.from({ length: MEMORY_SAVED_MAX - 2 }, () => mem({ profileId: 'p1' }));
    const { db, memories } = fakeDb({ profiles: [streamer], memories: seed });
    const over = await adminRoute({ op: 'save', profile: 'p1', kind: 'fact', items: ['uno', 'dos', 'tres'] }, db);
    expect(over).toMatchObject({ status: 409, body: { code: 'memory_full', room: 2 } });
    expect(memories).toHaveLength(MEMORY_SAVED_MAX - 2);
    const fits = await adminRoute({ op: 'save', profile: 'p1', kind: 'fact', items: ['uno', 'dos'] }, db);
    expect(fits.status).toBe(200);
    expect(memories).toHaveLength(MEMORY_SAVED_MAX);
  });

  it('con la cuenta llena, el texto subido dice cuántos huecos quedan', async () => {
    const seed = Array.from({ length: 90 }, () => mem({ profileId: 'p1' }));
    const { db } = fakeDb({ profiles: [streamer], memories: seed });
    const res = await adminRoute({ op: 'split', profile: 'p1', text: 'Juega a Valorant.' }, db);
    expect(res.body).toMatchObject({ saved: 90, savedMax: MEMORY_SAVED_MAX, room: 10 });
  });

  it('cada recuerdo que se guarda pasa los límites y el filtro, y se rechaza entero si uno falla', async () => {
    const { db, memories } = fakeDb({ profiles: [streamer] });
    const long = await adminRoute({ op: 'save', profile: 'p1', kind: 'fact', items: ['bien', 'a'.repeat(MEMORY_CONTENT_MAX + 1)] }, db);
    expect(long).toMatchObject({ status: 400, body: { code: 'bad_memory', index: 1 } });
    const insult = await adminRoute({ op: 'save', profile: 'p1', kind: 'style', items: ['eres un idiota'] }, db);
    expect(insult.status).toBe(400);
    expect(String(insult.body.error)).toContain('insulto');
    const viewer = await adminRoute({ op: 'save', profile: 'p1', kind: 'viewer', items: ['Ana'] }, db);
    expect(viewer).toMatchObject({ status: 400, body: { field: 'kind' } });
    expect(memories).toHaveLength(0);
  });

  it('lo guardado lleva la etiqueta de administrador y no caduca', async () => {
    const { db, memories } = fakeDb({ profiles: [streamer] });
    const res = await adminRoute({ op: 'save', profile: 'p1', kind: 'fact', items: ['Juega a Valorant los martes'] }, db);
    expect(res.status).toBe(200);
    expect(memories[0]).toMatchObject({ source: 'admin', pinned: false, expiresAt: null, profileId: 'p1' });
    // Lo ve el streamer con su etiqueta, sin poder tocarlo.
    const seen = await handleLux('memory', request('GET'), envWithVault(), { auth: asUser('p1'), db: () => db, now: () => NOW });
    expect((seen.body.memories as LuxMemoryItem[])[0].source).toBe('admin');
  });

  it('no caduca nunca, sea cual sea su tipo; lo del chat sí caduca', () => {
    expect(expiresAtFor('viewer', false, NOW, 'admin')).toBeNull();
    expect(expiresAtFor('event', false, NOW, 'admin')).toBeNull();
    expect(expiresAtFor('event', false, NOW, 'chat')).toBe(new Date(NOW + MEMORY_TTL_MS).toISOString());
  });

  it('la lista del administrador muestra a la cuenta; la carga de archivo se corta a 50 KB en el servidor', async () => {
    const { db, memories } = fakeDb({ profiles: [streamer, other] });
    const notFound = await adminRoute({ op: 'list', profile: 'nadie' }, db);
    expect(notFound).toMatchObject({ status: 404, body: { code: 'profile_not_found' } });
    const empty = await adminRoute({ op: 'list', profile: '' }, db);
    expect(empty).toMatchObject({ status: 400, body: { code: 'bad_profile' } });
    const unknown = await adminRoute({ op: 'list', profile: '00000000-0000-4000-8000-000000000000' }, db);
    expect(unknown.status).toBe(404);
    const big = await adminRoute({ op: 'split', profile: 'p1', text: 'a '.repeat(ADMIN_UPLOAD_MAX_BYTES / 2 + 10) }, db);
    expect(big).toMatchObject({ status: 400, body: { code: 'file_too_big' } });
    const ok = await adminRoute({ op: 'split', profile: 'p1', text: 'Juega a Valorant.\n\neres un idiota' }, db);
    expect(ok.status).toBe(200);
    expect(ok.body.chunks).toEqual([
      { content: 'Juega a Valorant.', blocked: null },
      { content: 'eres un idiota', blocked: 'insulto' },
    ]);
    expect(memories).toHaveLength(0);
  });
});

describe('troceado de un texto en recuerdos de 300 caracteres', () => {
  it('nunca pasa de 300 y no pierde palabras', () => {
    const text = Array.from({ length: 40 }, (_, i) => `Frase número ${i} sobre el canal y sus directos del martes.`).join(' ');
    const chunks = splitIntoMemories(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThan(0);
      expect(chunk.length).toBeLessThanOrEqual(MEMORY_CONTENT_MAX);
    }
    expect(chunks.join(' ').split(/\s+/)).toEqual(text.split(/\s+/));
  });

  it('párrafos y viñetas no se mezclan; las líneas partidas a mano sí se unen', () => {
    expect(splitIntoMemories('Juega a Valorant.\n\nVive en Madrid.')).toEqual(['Juega a Valorant.', 'Vive en Madrid.']);
    expect(splitIntoMemories('- Juega a Valorant\n- Vive en Madrid')).toEqual(['Juega a Valorant', 'Vive en Madrid']);
    expect(splitIntoMemories('Juega a\nValorant los martes.')).toEqual(['Juega a Valorant los martes.']);
  });

  it('una palabra pegada más larga que el límite se corta a la fuerza', () => {
    expect(splitIntoMemories('x'.repeat(700)).map((c) => c.length)).toEqual([300, 300, 100]);
  });

  it('un texto vacío no da recuerdos', () => {
    expect(splitIntoMemories('   \n\n  ')).toEqual([]);
  });
});
