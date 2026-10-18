/**
 * tests/luxSpeech.test.ts
 *
 * Lo que Lux dice en OBS: el chat y el panel encolan la frase, y el overlay
 * recibe solo lo nuevo con su clave de OBS.
 */

import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { handleLux } from '../server/lux/handlers';
import type { LuxDb, LuxProfile, LuxSpeechItem, LuxSpeechRow } from '../server/lux/luxDb';
import type { IntegrationRequest } from '../server/integrations/http';

const WIDGET_KEY = 'clave-obs-de-prueba-1234567890';

function memoryDb(seed: { profiles?: LuxProfile[] } = {}) {
  const speech: Array<LuxSpeechRow & { id: number }> = [];
  const profiles = new Map((seed.profiles ?? []).map((p) => [p.id, p]));
  const settings = new Map<string, string>();
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
    async profileByWidgetKey(key) {
      return key === WIDGET_KEY ? (profiles.get('p1') ?? null) : null;
    },
    async memories() {
      return [];
    },
    async insertReply() {},
    async settingsRow(id) {
      return rows.get(id) ?? null;
    },
    async saveSettingsRow(row) {
      rows.set(String(row.profile_id), row);
    },
    async insertSpeech(row) {
      speech.push({ ...row, id: speech.length + 1 });
    },
    async speechSince(profileId, afterId) {
      return speech
        .filter((row) => row.profile_id === profileId && row.id > afterId)
        .map((row): LuxSpeechItem => ({
          id: row.id,
          text: row.text,
          emotion: row.emotion,
          gesture: row.gesture,
          voice: { referenceId: row.voice_reference_id, engine: row.voice_engine },
        }));
    },
    async latestSpeechId(profileId) {
      return speech.filter((row) => row.profile_id === profileId).reduce((max, row) => Math.max(max, row.id), 0);
    },
    async pruneSpeech() {},
  };
  return { db, speech };
}

const fakeFetch = (content: string) =>
  (async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })) as unknown as typeof fetch;

const request = (body: unknown): IntegrationRequest => ({ method: 'POST', headers: {}, query: {}, body });
const getRequest = (query: Record<string, string>): IntegrationRequest => ({ method: 'GET', headers: {}, query, body: undefined });
const envWithVault = () => ({ INTEGRATIONS_ENC_KEY: randomBytes(32).toString('base64url') });
const asAdmin = async () => ({ id: 'a1', role: 'admin', status: 'active' });

describe('frases para OBS', () => {
  const streamer: LuxProfile = { id: 'p1', role: 'streamer', luxEnabled: true };

  it('una respuesta del chat se encola para el overlay', async () => {
    const env = envWithVault();
    const { db, speech } = memoryDb({ profiles: [streamer] });
    await handleLux('key', request({ apiKey: 'nvapi-abcdefghijklmnop1234' }), env, { auth: asAdmin, db: () => db });
    await handleLux('chat', request({ k: WIDGET_KEY, command: 'ask', viewer: 'ana', message: 'hola' }), env, {
      db: () => db,
      fetch: fakeFetch('¡Hola! [feliz]'),
    });
    expect(speech).toHaveLength(1);
    expect(speech[0]).toMatchObject({ text: '¡Hola!', emotion: 'feliz', gesture: 'idle' });
  });

  it('desde el panel solo se encola si se pide con speak', async () => {
    const env = envWithVault();
    const { db, speech } = memoryDb({ profiles: [streamer] });
    await handleLux('key', request({ apiKey: 'nvapi-abcdefghijklmnop1234' }), env, { auth: asAdmin, db: () => db });
    const deps = { auth: async () => ({ id: 'p1', role: 'streamer', status: 'active' }), db: () => db, fetch: fakeFetch('Hola') };
    await handleLux('reply', request({ message: 'hola' }), env, deps);
    expect(speech).toHaveLength(0);
    await handleLux('reply', request({ message: 'hola', speak: true }), env, deps);
    expect(speech).toHaveLength(1);
  });

  it('el overlay primero fija el punto de partida y luego recibe solo lo nuevo', async () => {
    const env = envWithVault();
    const { db, speech } = memoryDb({ profiles: [streamer] });
    speech.push({ id: 1, profile_id: 'p1', text: 'vieja', emotion: 'normal', gesture: 'idle', voice_reference_id: null, voice_engine: null });

    const start = await handleLux('speech', getRequest({ k: WIDGET_KEY }), env, { db: () => db });
    expect(start.body).toEqual({ items: [], last: 1 });

    speech.push({ id: 2, profile_id: 'p1', text: 'nueva', emotion: 'feliz', gesture: 'bow', voice_reference_id: 'voz', voice_engine: 'fish' });
    const next = await handleLux('speech', getRequest({ k: WIDGET_KEY, after: '1' }), env, { db: () => db });
    expect(next.body.items).toEqual([{ id: 2, text: 'nueva', emotion: 'feliz', gesture: 'bow', voice: { referenceId: 'voz', engine: 'fish' } }]);
    expect(next.body.last).toBe(2);
  });

  it('una clave de OBS falsa no recibe nada', async () => {
    const { db } = memoryDb({ profiles: [streamer] });
    const res = await handleLux('speech', getRequest({ k: 'otra', after: '0' }), envWithVault(), { db: () => db });
    expect(res.status).toBe(401);
  });

  it('un after que no es un número se rechaza', async () => {
    const { db } = memoryDb({ profiles: [streamer] });
    const res = await handleLux('speech', getRequest({ k: WIDGET_KEY, after: 'abc' }), envWithVault(), { db: () => db });
    expect(res.status).toBe(400);
  });
});
