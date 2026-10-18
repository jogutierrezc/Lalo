/**
 * tests/luxProviders.test.ts
 *
 * Proveedores de IA de Lux (NVIDIA y Mistral): cada uno con su clave, su modelo
 * y su URL. Y la regla de la voz de ElevenLabs por cuenta.
 */

import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { handleLux } from '../server/lux/handlers';
import { KEY_SETTING, MODEL_SETTING, PROVIDER_SETTING, isKeyFor } from '../server/lux/keyVault';
import { MISTRAL_BASE_URL, NVIDIA_BASE_URL } from '../server/lux/nvidia';
import type { LuxDb, LuxProfile, LuxReplyRow } from '../server/lux/luxDb';
import type { IntegrationRequest } from '../server/integrations/http';

const MISTRAL_KEY = 'abcdefghijklmnopqrstu1234';

function memoryDb(seed: { profiles?: LuxProfile[] } = {}) {
  const settings = new Map<string, string>();
  const profiles = new Map((seed.profiles ?? []).map((p) => [p.id, p]));
  const rows = new Map<string, Record<string, unknown>>();
  const replies: LuxReplyRow[] = [];
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
  };
  return { db, settings, replies, rows };
}

function fakeFetch(content: string) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const request = (method: string, body?: unknown): IntegrationRequest => ({ method, headers: {}, query: {}, body });
const asRole = (role: string, id = 'p1') => async () => ({ id, role, status: 'active' });
const envWithVault = () => ({ INTEGRATIONS_ENC_KEY: randomBytes(32).toString('base64url') });

describe('formato de las claves por proveedor', () => {
  it('NVIDIA exige nvapi-; Mistral acepta una cadena alfanumérica larga', () => {
    expect(isKeyFor('nvidia', 'nvapi-abcdefghijklmnop1234')).toBe(true);
    expect(isKeyFor('nvidia', MISTRAL_KEY)).toBe(false);
    expect(isKeyFor('mistral', MISTRAL_KEY)).toBe(true);
    expect(isKeyFor('mistral', 'nvapi-abcdefghijklmnop1234')).toBe(false);
  });
});

describe('cambiar de proveedor', () => {
  it('con Mistral activo, la respuesta llama a su URL con su clave y su modelo', async () => {
    const env = envWithVault();
    const { db, settings } = memoryDb({ profiles: [{ id: 'p1', role: 'streamer', luxEnabled: true }] });
    const admin = { auth: asRole('admin', 'a1'), db: () => db };

    expect((await handleLux('key', request('POST', { apiKey: MISTRAL_KEY, provider: 'mistral' }), env, admin)).status).toBe(200);
    expect(settings.has(KEY_SETTING.mistral)).toBe(true);
    expect(settings.get(KEY_SETTING.mistral)).not.toContain(MISTRAL_KEY);

    expect((await handleLux('provider', request('POST', { provider: 'mistral' }), env, admin)).status).toBe(200);
    expect(settings.get(PROVIDER_SETTING)).toBe('mistral');

    const { fn, calls } = fakeFetch('Hola desde Mistral');
    const res = await handleLux('reply', request('POST', { message: 'hola' }), env, { auth: asRole('streamer'), db: () => db, fetch: fn });
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${MISTRAL_BASE_URL}/chat/completions`);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${MISTRAL_KEY}`);
    expect(JSON.parse(String(calls[0].init.body)).model).toBe('ministral-8b-latest');
  });

  it('con NVIDIA activo (por defecto), la respuesta sigue yendo a NVIDIA', async () => {
    const env = envWithVault();
    const { db } = memoryDb({ profiles: [{ id: 'p1', role: 'streamer', luxEnabled: true }] });
    const { fn, calls } = fakeFetch('ok');
    await handleLux('key', request('POST', { apiKey: 'nvapi-abcdefghijklmnop1234' }), env, { auth: asRole('admin', 'a1'), db: () => db });
    await handleLux('reply', request('POST', { message: 'hola' }), env, { auth: asRole('streamer'), db: () => db, fetch: fn });
    expect(calls[0].url).toBe(`${NVIDIA_BASE_URL}/chat/completions`);
  });

  it('un modelo de otro proveedor se rechaza', async () => {
    const env = envWithVault();
    const { db, settings } = memoryDb();
    const res = await handleLux('model', request('POST', { provider: 'mistral', model: 'google/gemma-4-31b-it' }), env, {
      auth: asRole('admin', 'a1'),
      db: () => db,
    });
    expect(res.status).toBe(400);
    expect(settings.has(MODEL_SETTING.mistral)).toBe(false);
  });

  it('una clave con formato de otro proveedor se rechaza', async () => {
    const env = envWithVault();
    const { db } = memoryDb();
    const res = await handleLux('key', request('POST', { apiKey: 'nvapi-abcdefghijklmnop1234', provider: 'mistral' }), env, {
      auth: asRole('admin', 'a1'),
      db: () => db,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('bad_key');
  });

  it('el estado indica qué proveedores tienen clave', async () => {
    const env = envWithVault();
    const { db } = memoryDb();
    await handleLux('key', request('POST', { apiKey: MISTRAL_KEY, provider: 'mistral' }), env, { auth: asRole('admin', 'a1'), db: () => db });
    const res = await handleLux('status', request('GET'), env, { auth: asRole('admin', 'a1'), db: () => db });
    expect(res.body.configuredByProvider).toEqual({ nvidia: false, mistral: true });
    expect((res.body.providers as { id: string }[]).map((p) => p.id)).toEqual(['nvidia', 'mistral']);
  });
});

describe('voz de ElevenLabs por cuenta', () => {
  it('una cuenta sin ElevenLabs no puede guardar una voz de ElevenLabs', async () => {
    const env = envWithVault();
    const { db, rows } = memoryDb({ profiles: [{ id: 'p1', role: 'streamer', luxEnabled: true, elevenlabsEnabled: false }] });
    const res = await handleLux('config', request('POST', { voiceReferenceId: 'voz_123', voiceEngine: 'elevenlabs' }), env, {
      auth: asRole('streamer'),
      db: () => db,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('voice_not_allowed');
    expect(rows.size).toBe(0);
  });

  it('una cuenta con ElevenLabs activado sí la guarda', async () => {
    const env = envWithVault();
    const { db } = memoryDb({ profiles: [{ id: 'p1', role: 'streamer', luxEnabled: true, elevenlabsEnabled: true }] });
    const res = await handleLux('config', request('POST', { voiceReferenceId: 'voz_123', voiceEngine: 'elevenlabs' }), env, {
      auth: asRole('streamer'),
      db: () => db,
    });
    expect(res.status).toBe(200);
  });
});
