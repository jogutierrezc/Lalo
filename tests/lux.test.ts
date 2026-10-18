/**
 * tests/lux.test.ts
 *
 * Módulo de Lux: cliente de NVIDIA, claves cifradas, modelo elegido por el
 * administrador y flujo de respuesta. La base de datos es una memoria y la red
 * es un fetch falso: no se llama a NVIDIA ni a Supabase.
 */

import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { handleLux } from '../server/lux/handlers';
import { DEFAULT_LUX_MODEL, NVIDIA_BASE_URL, codeForStatus, nvidiaChat, parseChatText, stripThinking } from '../server/lux/nvidia';
import { SETTING_KEY, SETTING_MODEL, isNvidiaKey } from '../server/lux/keyVault';
import type { LuxDb, LuxMemoryRow, LuxProfile, LuxReplyRow } from '../server/lux/luxDb';
import type { IntegrationRequest } from '../server/integrations/http';

const VALID_KEY = 'nvapi-abcdefghijklmnop1234';

function memoryDb(seed: { profiles?: LuxProfile[]; memories?: LuxMemoryRow[]; settings?: Record<string, string> } = {}) {
  const settings = new Map(Object.entries(seed.settings ?? {}));
  const profiles = new Map((seed.profiles ?? []).map((p) => [p.id, p]));
  const replies: LuxReplyRow[] = [];
  const rows = new Map<string, Record<string, unknown>>();
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
    async memories() {
      return seed.memories ?? [];
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
  };
  return { db, settings, replies };
}

function fakeFetch(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const chat = (content: string) => ({ choices: [{ message: { content } }] });
const request = (method: string, body?: unknown): IntegrationRequest => ({ method, headers: {}, query: {}, body });
const envWithVault = () => ({ INTEGRATIONS_ENC_KEY: randomBytes(32).toString('base64url') });
const asRole = (role: string, id = 'u1') => async () => ({ id, role, status: 'active' });

describe('cliente de NVIDIA', () => {
  it('envía la clave en la cabecera, el modelo y el mensaje, y devuelve el texto', async () => {
    const { fn, calls } = fakeFetch(chat('Hola, soy Lux'));
    const text = await nvidiaChat({ apiKey: VALID_KEY, model: DEFAULT_LUX_MODEL, messages: [{ role: 'user', content: 'hola' }], fetch: fn });
    expect(text).toBe('Hola, soy Lux');
    expect(calls[0].url).toBe(`${NVIDIA_BASE_URL}/chat/completions`);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${VALID_KEY}`);
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent.model).toBe(DEFAULT_LUX_MODEL);
    expect(sent.stream).toBe(false);
  });

  it('quita el razonamiento que algunos modelos dejan en el texto', () => {
    expect(stripThinking('<think>pensando</think>Hola')).toBe('Hola');
    expect(parseChatText(chat('<think>x</think>  '))).toBeNull();
  });

  it('traduce los códigos HTTP a fallos previsibles', () => {
    expect(codeForStatus(401)).toBe('unauthorized');
    expect(codeForStatus(403)).toBe('unauthorized');
    expect(codeForStatus(404)).toBe('model_unavailable');
    expect(codeForStatus(429)).toBe('rate_limited');
    expect(codeForStatus(500)).toBe('upstream');
  });

  it('sin clave no llama a la red', async () => {
    const { fn, calls } = fakeFetch(chat('x'));
    await expect(nvidiaChat({ apiKey: '', model: DEFAULT_LUX_MODEL, messages: [], fetch: fn })).rejects.toMatchObject({ code: 'no_key' });
    expect(calls).toHaveLength(0);
  });
});

describe('claves', () => {
  it('reconoce el formato de las claves de NVIDIA', () => {
    expect(isNvidiaKey(VALID_KEY)).toBe(true);
    expect(isNvidiaKey('sk-otra-cosa')).toBe(false);
  });

  it('solo el administrador puede guardar la clave, y se guarda cifrada', async () => {
    const env = envWithVault();
    const { db, settings } = memoryDb();
    const denied = await handleLux('key', request('POST', { apiKey: VALID_KEY }), env, { auth: asRole('streamer'), db: () => db });
    expect(denied.status).toBe(403);

    const saved = await handleLux('key', request('POST', { apiKey: VALID_KEY }), env, { auth: asRole('admin'), db: () => db });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ configured: true });
    const stored = settings.get(SETTING_KEY) ?? '';
    expect(stored.startsWith('v1.')).toBe(true);
    expect(stored).not.toContain(VALID_KEY);
  });

  it('una petición sin apiKey no borra la clave guardada', async () => {
    const env = envWithVault();
    const { db, settings } = memoryDb();
    await handleLux('key', request('POST', { apiKey: VALID_KEY }), env, { auth: asRole('admin'), db: () => db });
    const before = settings.get(SETTING_KEY);
    const res = await handleLux('key', request('POST', {}), env, { auth: asRole('admin'), db: () => db });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('missing_key');
    expect(settings.get(SETTING_KEY)).toBe(before);
  });

  it('rechaza una clave con formato incorrecto', async () => {
    const { db } = memoryDb();
    const res = await handleLux('key', request('POST', { apiKey: 'no-es-nvidia' }), envWithVault(), { auth: asRole('admin'), db: () => db });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('bad_key');
  });

  it('no guarda la clave si el servidor no tiene INTEGRATIONS_ENC_KEY', async () => {
    const { db } = memoryDb();
    const res = await handleLux('key', request('POST', { apiKey: VALID_KEY }), {}, { auth: asRole('admin'), db: () => db });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('no_vault');
  });

  it('el estado no devuelve la clave', async () => {
    const env = envWithVault();
    const { db } = memoryDb();
    await handleLux('key', request('POST', { apiKey: VALID_KEY }), env, { auth: asRole('admin'), db: () => db });
    const res = await handleLux('status', request('GET'), env, { auth: asRole('admin'), db: () => db });
    expect(res.body.configured).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(VALID_KEY);
  });
});

describe('modelo', () => {
  it('acepta los dos modelos de la lista y rechaza cualquier otro', async () => {
    const env = envWithVault();
    const { db, settings } = memoryDb();
    const deps = { auth: asRole('admin'), db: () => db };

    const bad = await handleLux('model', request('POST', { model: 'otro/modelo' }), env, deps);
    expect(bad.status).toBe(400);

    const gemma = await handleLux('model', request('POST', { model: 'google/gemma-4-31b-it' }), env, deps);
    expect(gemma.status).toBe(200);
    expect(settings.get(SETTING_MODEL)).toBe('google/gemma-4-31b-it');

    const status = await handleLux('status', request('GET'), env, deps);
    expect(status.body.model).toBe('google/gemma-4-31b-it');
    expect((status.body.models as { id: string }[]).map((m) => m.id)).toContain(DEFAULT_LUX_MODEL);
  });
});

describe('respuesta de Lux', () => {
  const streamer = { id: 'p1', role: 'streamer', luxEnabled: true };
  const memory: LuxMemoryRow = { kind: 'fact', subject: null, content: 'El canal se llama LaloPlay' };

  it('rechaza a un streamer sin Lux activado', async () => {
    const env = envWithVault();
    const { db } = memoryDb({ profiles: [{ ...streamer, luxEnabled: false }] });
    const res = await handleLux('reply', request('POST', { message: 'hola' }), env, { auth: asRole('streamer', 'p1'), db: () => db });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('lux_disabled');
  });

  it('responde con la clave y el modelo guardados, usa las memorias y registra la respuesta', async () => {
    const env = envWithVault();
    const { db, replies } = memoryDb({
      profiles: [streamer],
      memories: [memory],
      settings: { [SETTING_MODEL]: 'google/gemma-4-31b-it' },
    });
    // La clave se guarda de verdad, cifrada, con el mismo flujo que el panel.
    await handleLux('key', request('POST', { apiKey: VALID_KEY }), env, { auth: asRole('admin', 'admin'), db: () => db });

    const { fn, calls } = fakeFetch(chat('¡Bienvenidos al directo!'));
    const res = await handleLux('reply', request('POST', { message: '¿qué tal?', viewer: 'vale' }), env, {
      auth: asRole('streamer', 'p1'),
      db: () => db,
      fetch: fn,
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ reply: '¡Bienvenidos al directo!', emotion: 'normal', model: 'google/gemma-4-31b-it' });
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent.model).toBe('google/gemma-4-31b-it');
    expect(JSON.stringify(sent.messages)).toContain('El canal se llama LaloPlay');
    expect(JSON.stringify(sent.messages)).toContain('vale: ¿qué tal?');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${VALID_KEY}`);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ profile_id: 'p1', viewer: 'vale', reply: '¡Bienvenidos al directo!' });
  });

  it('sin clave guardada no llama a NVIDIA', async () => {
    const env = envWithVault();
    const { db } = memoryDb({ profiles: [streamer] });
    const { fn, calls } = fakeFetch(chat('x'));
    const res = await handleLux('reply', request('POST', { message: 'hola' }), env, { auth: asRole('streamer', 'p1'), db: () => db, fetch: fn });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('no_key');
    expect(calls).toHaveLength(0);
  });

  it('rechaza mensajes vacíos o demasiado largos', async () => {
    const env = envWithVault();
    const { db } = memoryDb({ profiles: [streamer] });
    const deps = { auth: asRole('streamer', 'p1'), db: () => db };
    expect((await handleLux('reply', request('POST', { message: '   ' }), env, deps)).status).toBe(400);
    expect((await handleLux('reply', request('POST', { message: 'a'.repeat(501) }), env, deps)).status).toBe(400);
  });
});
