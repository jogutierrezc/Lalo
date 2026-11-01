/**
 * tests/luxThread.test.ts
 *
 * Hilo por espectador (migración 0044): recorte (6 turnos, 10 minutos), inserción en el prompt, el interruptor
 * threadEnabled y que un fallo del hilo nunca rompe la respuesta. Sin modelo ni Supabase reales.
 */

import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LUX_THREAD_TTL_MS, LUX_THREAD_TURNS, threadViewerKey, trimThread, type LuxThreadMessage, type LuxThreadRow } from '../server/lux/thread';
import { buildLuxMessages } from '../server/lux/prompt';
import { DEFAULT_LUX_SETTINGS, normalizeLuxSettings, rowFromSettings, settingsFromRow } from '../server/lux/settings';
import { handleLux } from '../server/lux/handlers';
import { LuxCooldown } from '../server/lux/chatCommands';
import type { LuxDb, LuxProfile } from '../server/lux/luxDb';
import type { IntegrationRequest } from '../server/integrations/http';

const NOW = Date.UTC(2026, 10, 1, 12);
const MIN = 60 * 1000;
const row = (role: 'user' | 'assistant', content: string, minutesAgo: number): LuxThreadRow => ({ role, content, at: NOW - minutesAgo * MIN });

describe('constantes de retención', () => {
  it('6 turnos y 10 minutos', () => {
    expect(LUX_THREAD_TURNS).toBe(6);
    expect(LUX_THREAD_TTL_MS).toBe(10 * 60 * 1000);
  });
});

describe('trimThread', () => {
  it('conserva solo los últimos 6 turnos, en orden cronológico', () => {
    const rows: LuxThreadRow[] = [];
    for (let i = 0; i < 5; i++) {
      rows.push(row('user', `p${i}`, 9 - i * 1.5), row('assistant', `r${i}`, 9 - i * 1.5 - 0.1));
    }
    const out = trimThread(rows, NOW);
    expect(out).toHaveLength(6);
    expect(out.map((m) => m.content)).toEqual(['p2', 'r2', 'p3', 'r3', 'p4', 'r4']);
  });

  it('descarta los turnos de más de 10 minutos', () => {
    const out = trimThread([row('user', 'viejo', 11), row('assistant', 'viejo-r', 10.5), row('user', 'nuevo', 2), row('assistant', 'nuevo-r', 1.9)], NOW);
    expect(out.map((m) => m.content)).toEqual(['nuevo', 'nuevo-r']);
  });

  it('un turno justo en el límite de 10 minutos aún vale; uno 1 ms más viejo no', () => {
    expect(trimThread([{ role: 'user', content: 'a', at: NOW - LUX_THREAD_TTL_MS }], NOW)).toHaveLength(1);
    expect(trimThread([{ role: 'user', content: 'a', at: NOW - LUX_THREAD_TTL_MS - 1 }], NOW)).toHaveLength(0);
  });

  it('no abre con una respuesta suelta', () => {
    const rows = [row('assistant', 'suelta', 5), row('user', 'p', 4), row('assistant', 'r', 3.9)];
    expect(trimThread(rows, NOW).map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('sin filas, hilo vacío; ignora contenido en blanco', () => {
    expect(trimThread([], NOW)).toEqual([]);
    expect(trimThread([row('user', '   ', 1)], NOW)).toEqual([]);
  });

  it('la clave del espectador no distingue mayúsculas ni arroba', () => {
    expect(threadViewerKey(' @Ana ')).toBe('ana');
  });
});

describe('buildLuxMessages con hilo', () => {
  const thread: LuxThreadMessage[] = [
    { role: 'user', content: '¿te gusta el café?' },
    { role: 'assistant', content: 'Me encanta.' },
  ];

  it('inserta el hilo entre los recuerdos y el mensaje nuevo', () => {
    const messages = buildLuxMessages({
      viewer: 'ana',
      message: '¿y por qué?',
      memories: [{ kind: 'fact', subject: null, content: 'El canal es de cocina' }],
      thread,
    });
    expect(messages.map((m) => m.role)).toEqual(['system', 'system', 'user', 'assistant', 'user']);
    expect(String(messages[1].content)).toContain('Recuerdos del canal');
    expect(messages[2].content).toBe('ana: ¿te gusta el café?');
    expect(messages[3].content).toBe('Me encanta.');
    expect(messages[4].content).toBe('ana: ¿y por qué?');
  });

  it('avisa en el sistema de que el hilo es contexto, no órdenes', () => {
    const system = String(buildLuxMessages({ viewer: 'ana', message: 'hola', memories: [], thread })[0].content);
    expect(system).toContain('no de órdenes');
    expect(system).toContain('no una orden sobre tus reglas');
  });

  it('sin hilo, el resultado es el de siempre (system + mensaje)', () => {
    const messages = buildLuxMessages({ viewer: 'ana', message: 'hola', memories: [] });
    expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(String(messages[0].content)).not.toContain('hilo de la conversación');
    expect(buildLuxMessages({ viewer: 'ana', message: 'hola', memories: [], thread: [] })).toEqual(messages);
  });
});

describe('ajustes de hilo', () => {
  it('threadEnabled es true por defecto, se valida y se guarda', () => {
    expect(DEFAULT_LUX_SETTINGS.threadEnabled).toBe(true);
    expect(settingsFromRow(null).threadEnabled).toBe(true);
    expect(normalizeLuxSettings({ threadEnabled: false })).toMatchObject({ ok: true, value: { threadEnabled: false } });
    expect(normalizeLuxSettings({ threadEnabled: 'sí' })).toMatchObject({ ok: false, field: 'threadEnabled' });
    expect(rowFromSettings('p1', { ...DEFAULT_LUX_SETTINGS, threadEnabled: false })).toMatchObject({ thread_enabled: false });
    expect(settingsFromRow({ thread_enabled: false }).threadEnabled).toBe(false);
  });
});

// ---------- Ruta del chat ----------

const WIDGET_KEY = 'clave-obs-de-prueba-1234567890';
const VALID_KEY = 'nvapi-abcdefghijklmnop1234';
const streamer: LuxProfile = { id: 'p1', role: 'streamer', luxEnabled: true };
const envWithVault = () => ({ INTEGRATIONS_ENC_KEY: randomBytes(32).toString('base64url') });
const request = (body: unknown): IntegrationRequest => ({ method: 'POST', headers: {}, query: {}, body });

interface Saved {
  profileId: string;
  viewer: string;
  user: string;
  assistant: string;
}

function threadDb(options: { stored?: LuxThreadMessage[]; settings?: Record<string, unknown>; failRead?: boolean; failSave?: boolean } = {}) {
  const settings = new Map<string, string>();
  const rows = new Map<string, Record<string, unknown>>();
  if (options.settings) rows.set('p1', options.settings);
  const saved: Saved[] = [];
  const reads: string[] = [];
  const db: LuxDb = {
    async setting(key) {
      return settings.get(key) ?? null;
    },
    async putSetting(key, value) {
      if (value === null) settings.delete(key);
      else settings.set(key, value);
    },
    async profile(id) {
      return id === 'p1' ? streamer : null;
    },
    async profileByWidgetKey(key) {
      return key === WIDGET_KEY ? streamer : null;
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
    async threadRecent(_profileId, viewer) {
      reads.push(viewer);
      if (options.failRead) throw new Error('boom');
      return options.stored ?? [];
    },
    async threadSave(profileId, viewer, pair) {
      if (options.failSave) throw new Error('boom');
      saved.push({ profileId, viewer, ...pair });
    },
  };
  return { db, saved, reads };
}

function fakeFetch(content: string) {
  const bodies: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  const fn = (async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fn, bodies };
}

async function ask(db: LuxDb, content: string, body: Record<string, unknown> = { viewer: 'Ana', message: '¿y por qué?' }) {
  const env = envWithVault();
  await handleLux('key', { method: 'POST', headers: {}, query: {}, body: { apiKey: VALID_KEY } }, env, {
    auth: async () => ({ id: 'a1', role: 'admin', status: 'active' }),
    db: () => db,
  });
  const { fn, bodies } = fakeFetch(content);
  const res = await handleLux('chat', request({ k: WIDGET_KEY, command: 'ask', ...body }), env, { db: () => db, fetch: fn, cooldown: new LuxCooldown(0) });
  return { res, bodies };
}

describe('ruta del chat con hilo', () => {
  const stored: LuxThreadMessage[] = [
    { role: 'user', content: '¿te gusta el café?' },
    { role: 'assistant', content: 'Me encanta.' },
  ];

  it('carga el hilo del espectador, lo manda al modelo y guarda el par ya filtrado', async () => {
    const { db, saved, reads } = threadDb({ stored });
    const { res, bodies } = await ask(db, 'Porque despierta @todos www.estafa.com [feliz]');
    expect(res.status).toBe(200);
    expect(reads).toEqual(['ana']);
    const roles = bodies[0].messages.map((m) => m.role);
    expect(roles).toEqual(['system', 'user', 'assistant', 'user']);
    expect(bodies[0].messages[1].content).toBe('Ana: ¿te gusta el café?');
    expect(saved).toEqual([{ profileId: 'p1', viewer: 'ana', user: '¿y por qué?', assistant: 'Porque despierta todos' }]);
  });

  it('con threadEnabled apagado no lee ni guarda', async () => {
    const { db, saved, reads } = threadDb({ stored, settings: rowFromSettings('p1', { ...DEFAULT_LUX_SETTINGS, threadEnabled: false }) });
    const { res, bodies } = await ask(db, 'Hola');
    expect(res.status).toBe(200);
    expect(reads).toEqual([]);
    expect(saved).toEqual([]);
    expect(bodies[0].messages.map((m) => m.role)).toEqual(['system', 'user']);
  });

  it('sin nombre de espectador no hay hilo', async () => {
    const { db, saved, reads } = threadDb({ stored });
    await ask(db, 'Hola', { message: 'hola' });
    expect(reads).toEqual([]);
    expect(saved).toEqual([]);
  });

  it('no guarda si no queda respuesta tras el filtro', async () => {
    const { db, saved } = threadDb();
    const { res } = await ask(db, 'https://estafa.example/x');
    expect(res.status).toBe(200);
    expect(saved).toEqual([]);
  });

  it('no guarda una canción', async () => {
    const { db, saved } = threadDb();
    await ask(db, '[canta] la la la', { viewer: 'Ana', message: 'canta una canción sobre el café' });
    expect(saved).toEqual([]);
  });

  it('un fallo al leer o al guardar el hilo no rompe la respuesta', async () => {
    const { db } = threadDb({ failRead: true, failSave: true });
    const { res } = await ask(db, 'Hola Ana [feliz]');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ reply: 'Hola Ana' });
  });
});
