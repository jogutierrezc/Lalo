/**
 * tests/luxChat.test.ts
 *
 * Comandos de Lux en el chat: lectura de !lux, !luxon y !luxoff, tiempo de
 * espera por espectador, y la ruta /api/lux/chat autorizada por la clave de OBS.
 */

import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { handleLux } from '../server/lux/handlers';
import { LuxCooldown, parseLuxChat } from '../server/lux/chatCommands';
import type { LuxDb, LuxProfile, LuxReplyRow } from '../server/lux/luxDb';
import type { IntegrationRequest } from '../server/integrations/http';

const WIDGET_KEY = 'clave-obs-de-prueba-1234567890';
const VALID_KEY = 'nvapi-abcdefghijklmnop1234';

function memoryDb(seed: { profiles?: LuxProfile[]; widgetKeys?: Record<string, string> } = {}) {
  const settings = new Map<string, string>();
  const profiles = new Map((seed.profiles ?? []).map((p) => [p.id, p]));
  const keys = new Map(Object.entries(seed.widgetKeys ?? {}));
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
    async profileByWidgetKey(widgetKey) {
      const id = keys.get(widgetKey);
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
  };
  return { db, settings, rows, replies };
}

function fakeFetch(content: string) {
  const fn = (async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })) as unknown as typeof fetch;
  return fn;
}

const request = (body: unknown): IntegrationRequest => ({ method: 'POST', headers: {}, query: {}, body });
const envWithVault = () => ({ INTEGRATIONS_ENC_KEY: randomBytes(32).toString('base64url') });

describe('lectura de comandos', () => {
  it('reconoce !lux con mensaje, !luxon y !luxoff', () => {
    expect(parseLuxChat('!lux ¿qué juego es?')).toEqual({ kind: 'ask', message: '¿qué juego es?' });
    expect(parseLuxChat('!luxon')).toEqual({ kind: 'on' });
    expect(parseLuxChat('!luxoff')).toEqual({ kind: 'off' });
  });

  it('!lux sin mensaje no es una pregunta', () => {
    expect(parseLuxChat('!lux')).toBeNull();
    expect(parseLuxChat('!lux   ')).toBeNull();
  });

  it('otros mensajes no son de Lux, y el prefijo se respeta', () => {
    expect(parseLuxChat('hola lux')).toBeNull();
    expect(parseLuxChat('!luxury brand')).toBeNull();
    expect(parseLuxChat('?lux hola', '?')).toEqual({ kind: 'ask', message: 'hola' });
  });

  it('el mensaje se recorta a 300 caracteres', () => {
    const cmd = parseLuxChat(`!lux ${'a'.repeat(400)}`);
    expect(cmd && cmd.kind === 'ask' && cmd.message.length).toBe(300);
  });
});

describe('tiempo de espera por espectador', () => {
  it('bloquea la misma persona durante la ventana y deja pasar a otra', () => {
    const cooldown = new LuxCooldown(10_000);
    expect(cooldown.take('p1:ana', 0).ok).toBe(true);
    expect(cooldown.take('p1:ana', 4_000)).toEqual({ ok: false, waitSeconds: 6 });
    expect(cooldown.take('p1:luis', 4_000).ok).toBe(true);
    expect(cooldown.take('p1:ana', 10_000).ok).toBe(true);
  });
});

describe('ruta /api/lux/chat', () => {
  const streamer: LuxProfile = { id: 'p1', role: 'streamer', luxEnabled: true };

  it('con clave de OBS válida responde y registra la respuesta', async () => {
    const env = envWithVault();
    const { db, replies } = memoryDb({ profiles: [streamer], widgetKeys: { [WIDGET_KEY]: 'p1' } });
    await handleLux('key', { method: 'POST', headers: {}, query: {}, body: { apiKey: VALID_KEY } }, env, {
      auth: async () => ({ id: 'a1', role: 'admin', status: 'active' }),
      db: () => db,
    });
    const res = await handleLux('chat', request({ k: WIDGET_KEY, command: 'ask', viewer: 'ana', message: 'hola' }), env, {
      db: () => db,
      fetch: fakeFetch('¡Hola, Ana! [feliz]'),
      cooldown: new LuxCooldown(0),
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ reply: '¡Hola, Ana!', emotion: 'feliz', intent: 'neutro' });
    expect(replies).toHaveLength(1);
  });

  it('una clave de OBS que no existe se rechaza', async () => {
    const res = await handleLux('chat', request({ k: 'otra', command: 'ask', message: 'hola' }), envWithVault(), {
      db: () => memoryDb({ profiles: [streamer], widgetKeys: { [WIDGET_KEY]: 'p1' } }).db,
      fetch: fakeFetch('x'),
    });
    expect(res.status).toBe(401);
  });

  it('con Lux desactivado para la cuenta, no responde (sin error en el chat)', async () => {
    const env = envWithVault();
    const { db } = memoryDb({ profiles: [{ ...streamer, luxEnabled: false }], widgetKeys: { [WIDGET_KEY]: 'p1' } });
    const res = await handleLux('chat', request({ k: WIDGET_KEY, command: 'ask', message: 'hola' }), env, { db: () => db, fetch: fakeFetch('x') });
    expect(res.body).toEqual({ skipped: 'lux_disabled' });
  });

  it('un espectador no puede apagar Lux; un moderador sí', async () => {
    const env = envWithVault();
    const { db, rows } = memoryDb({ profiles: [streamer], widgetKeys: { [WIDGET_KEY]: 'p1' } });
    const denied = await handleLux('chat', request({ k: WIDGET_KEY, command: 'off', privileged: false }), env, { db: () => db });
    expect(denied.status).toBe(403);
    expect(rows.size).toBe(0);

    const ok = await handleLux('chat', request({ k: WIDGET_KEY, command: 'off', privileged: true }), env, { db: () => db });
    expect(ok.body).toEqual({ chatEnabled: false });
    expect(rows.get('p1')).toMatchObject({ chat_enabled: false });
  });

  it('con el chat apagado, !lux no responde', async () => {
    const env = envWithVault();
    const { db } = memoryDb({ profiles: [streamer], widgetKeys: { [WIDGET_KEY]: 'p1' } });
    await handleLux('chat', request({ k: WIDGET_KEY, command: 'off', privileged: true }), env, { db: () => db });
    const res = await handleLux('chat', request({ k: WIDGET_KEY, command: 'ask', message: 'hola' }), env, { db: () => db, fetch: fakeFetch('x') });
    expect(res.body).toEqual({ skipped: 'chat_off' });
  });

  it('el mismo espectador espera entre preguntas', async () => {
    const env = envWithVault();
    const { db } = memoryDb({ profiles: [streamer], widgetKeys: { [WIDGET_KEY]: 'p1' } });
    const cooldown = new LuxCooldown(60_000);
    const first = await handleLux('chat', request({ k: WIDGET_KEY, command: 'ask', viewer: 'ana', message: 'hola' }), env, {
      db: () => db,
      fetch: fakeFetch('x'),
      cooldown,
      now: () => 0,
    });
    expect(first.body.skipped).toBeUndefined();
    const second = await handleLux('chat', request({ k: WIDGET_KEY, command: 'ask', viewer: 'ana', message: 'otra' }), env, {
      db: () => db,
      fetch: fakeFetch('x'),
      cooldown,
      now: () => 5_000,
    });
    expect(second.body).toEqual({ skipped: 'cooldown', waitSeconds: 55 });
  });
});
