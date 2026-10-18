/**
 * tests/luxSettings.test.ts
 *
 * Ajustes de Lux AI: validación, guardado por la ruta config y que la
 * personalidad, el idioma, la longitud y la memoria llegan al modelo.
 */

import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { handleLux } from '../server/lux/handlers';
import { DEFAULT_LUX_SETTINGS, normalizeLuxSettings, settingsFromRow } from '../server/lux/settings';
import type { LuxDb, LuxMemoryRow, LuxProfile, LuxReplyRow } from '../server/lux/luxDb';
import type { IntegrationRequest } from '../server/integrations/http';

const VALID_KEY = 'nvapi-abcdefghijklmnop1234';

function memoryDb(seed: { profiles?: LuxProfile[]; memories?: LuxMemoryRow[] } = {}) {
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
  return { db, rows, replies };
}

function fakeFetch(content: string) {
  const calls: { init: RequestInit }[] = [];
  const fn = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push({ init: init ?? {} });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const request = (method: string, body?: unknown): IntegrationRequest => ({ method, headers: {}, query: {}, body });
const asRole = (role: string, id = 'p1') => async () => ({ id, role, status: 'active' });
const streamer = { id: 'p1', role: 'streamer', luxEnabled: true };
const envWithVault = () => ({ INTEGRATIONS_ENC_KEY: randomBytes(32).toString('base64url') });

describe('validación de ajustes', () => {
  it('acepta valores dentro de rango y limpia la personalidad', () => {
    const check = normalizeLuxSettings({ personality: '  Simpática y directa  ', replyMax: 120, language: 'en', memoryEnabled: false, obsSize: 55 });
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.value).toMatchObject({ personality: 'Simpática y directa', replyMax: 120, language: 'en', memoryEnabled: false, obsSize: 55 });
    }
  });

  it('rechaza cada campo fuera de rango con el campo señalado', () => {
    expect(normalizeLuxSettings({ replyMax: 10 })).toMatchObject({ ok: false, field: 'replyMax' });
    expect(normalizeLuxSettings({ replyMax: 120.5 })).toMatchObject({ ok: false, field: 'replyMax' });
    expect(normalizeLuxSettings({ language: 'fr' })).toMatchObject({ ok: false, field: 'language' });
    expect(normalizeLuxSettings({ memoryEnabled: 'sí' })).toMatchObject({ ok: false, field: 'memoryEnabled' });
    expect(normalizeLuxSettings({ obsSize: 5 })).toMatchObject({ ok: false, field: 'obsSize' });
    expect(normalizeLuxSettings({ personality: 'a'.repeat(601) })).toMatchObject({ ok: false, field: 'personality' });
  });

  it('un formulario parcial no pisa los demás ajustes', () => {
    const check = normalizeLuxSettings({ replyMax: 90 }, { ...DEFAULT_LUX_SETTINGS, personality: 'Tranquila' });
    expect(check.ok && check.value.personality).toBe('Tranquila');
    expect(check.ok && check.value.replyMax).toBe(90);
  });

  it('una fila rara de la base de datos cae a los valores por defecto', () => {
    expect(settingsFromRow(null)).toEqual(DEFAULT_LUX_SETTINGS);
    expect(settingsFromRow({ reply_max: 'mucho' })).toEqual(DEFAULT_LUX_SETTINGS);
  });

  it('un campo malo no arrastra a los demás: una voz rara deja la personalidad', () => {
    const value = settingsFromRow({ personality: 'Tranquila', reply_max: 150, voice_reference_id: '../x', voice_engine: 'fish' });
    expect(value.personality).toBe('Tranquila');
    expect(value.replyMax).toBe(150);
    expect(value.voiceReferenceId).toBeNull();
    expect(value.voiceEngine).toBeNull();
  });
});

describe('ruta config', () => {
  it('un streamer sin Lux no puede leer ni guardar ajustes', async () => {
    const { db } = memoryDb({ profiles: [{ ...streamer, luxEnabled: false }] });
    const res = await handleLux('config', request('GET'), envWithVault(), { auth: asRole('streamer'), db: () => db });
    expect(res.status).toBe(403);
  });

  it('guarda los ajustes y los devuelve validados', async () => {
    const { db, rows } = memoryDb({ profiles: [streamer] });
    const deps = { auth: asRole('streamer'), db: () => db };
    const saved = await handleLux('config', request('POST', { personality: 'Pícara', replyMax: 150 }), envWithVault(), deps);
    expect(saved.status).toBe(200);
    expect(saved.body.settings).toMatchObject({ personality: 'Pícara', replyMax: 150, language: 'es' });
    expect(rows.get('p1')).toMatchObject({ personality: 'Pícara', reply_max: 150 });

    const read = await handleLux('config', request('GET'), envWithVault(), deps);
    expect(read.body.settings).toMatchObject({ personality: 'Pícara', replyMax: 150 });
  });

  it('un valor inválido devuelve 400 con el campo y no guarda nada', async () => {
    const { db, rows } = memoryDb({ profiles: [streamer] });
    const res = await handleLux('config', request('POST', { replyMax: 5 }), envWithVault(), { auth: asRole('streamer'), db: () => db });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('replyMax');
    expect(rows.size).toBe(0);
  });
});

describe('los ajustes llegan al modelo', () => {
  it('personalidad, idioma y longitud van en el mensaje del sistema', async () => {
    const env = envWithVault();
    const { db } = memoryDb({ profiles: [streamer] });
    await handleLux('key', request('POST', { apiKey: VALID_KEY }), env, { auth: asRole('admin', 'admin'), db: () => db });
    await handleLux('config', request('POST', { personality: 'Tímida', language: 'en', replyMax: 80 }), env, { auth: asRole('streamer'), db: () => db });

    const { fn, calls } = fakeFetch('Hi there');
    const res = await handleLux('reply', request('POST', { message: 'hola' }), env, { auth: asRole('streamer'), db: () => db, fetch: fn });
    expect(res.status).toBe(200);
    const system = JSON.parse(String(calls[0].init.body)).messages[0].content as string;
    expect(system).toContain('Tímida');
    expect(system).toContain('inglés');
    expect(system).toContain('80 caracteres');
  });

  it('con la memoria desactivada, no se envían recuerdos', async () => {
    const env = envWithVault();
    const { db } = memoryDb({
      profiles: [streamer],
      memories: [{ kind: 'fact', subject: null, content: 'SECRETO_DE_MEMORIA' }],
    });
    await handleLux('key', request('POST', { apiKey: VALID_KEY }), env, { auth: asRole('admin', 'admin'), db: () => db });
    await handleLux('config', request('POST', { memoryEnabled: false }), env, { auth: asRole('streamer'), db: () => db });

    const { fn, calls } = fakeFetch('ok');
    await handleLux('reply', request('POST', { message: 'hola' }), env, { auth: asRole('streamer'), db: () => db, fetch: fn });
    expect(JSON.stringify(JSON.parse(String(calls[0].init.body)).messages)).not.toContain('SECRETO_DE_MEMORIA');
  });
});
