/**
 * tests/luxRelease.test.ts
 *
 * Versión publicada de Lux: lectura, publicación solo para el administrador, y
 * que el script del bot incluya su versión y el aviso de actualización.
 */

import { describe, expect, it } from 'vitest';
import { handleLux } from '../server/lux/handlers';
import { LUX_BOT_VERSION, NO_RELEASE, nextRelease, parseRelease, RELEASE_SETTING } from '../server/lux/release';
import { buildPythonScript } from '../src/components/bot/pythonScript';
import type { LuxDb } from '../server/lux/luxDb';
import type { IntegrationRequest } from '../server/integrations/http';

function memoryDb() {
  const settings = new Map<string, string>();
  const db = {
    async setting(key: string) {
      return settings.get(key) ?? null;
    },
    async putSetting(key: string, value: string | null) {
      if (value === null) settings.delete(key);
      else settings.set(key, value);
    },
  } as unknown as LuxDb;
  return { db, settings };
}

const request = (method: string, body?: unknown): IntegrationRequest => ({ method, headers: {}, query: {}, body });
const asRole = (role: string) => async () => ({ id: 'u1', role, status: 'active' });

describe('versión publicada', () => {
  it('sin publicar, la versión es la inicial', () => {
    expect(parseRelease(null)).toEqual(NO_RELEASE);
    expect(parseRelease('no es json')).toEqual(NO_RELEASE);
  });

  it('cada publicación sube la versión y guarda la nota', () => {
    const next = nextRelease(parseRelease(null), '  nuevos comandos  ', Date.UTC(2026, 9, 18));
    expect(next.version).toBe(LUX_BOT_VERSION + 1);
    expect(next.note).toBe('nuevos comandos');
    expect(next.at).toBe('2026-10-18T00:00:00.000Z');
  });

  it('una versión guardada menor a la del bot no baja la versión', () => {
    expect(parseRelease('{"version":0,"note":"x"}').version).toBe(LUX_BOT_VERSION);
  });
});

describe('ruta release', () => {
  it('cualquiera puede leer la versión publicada', async () => {
    const { db } = memoryDb();
    const res = await handleLux('release', request('GET'), {}, { db: () => db });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(LUX_BOT_VERSION);
  });

  it('solo el administrador publica, y la lectura siguiente ve la versión nueva', async () => {
    const { db, settings } = memoryDb();
    const denied = await handleLux('release', request('POST', { note: 'x' }), {}, { auth: asRole('streamer'), db: () => db });
    expect(denied.status).toBe(403);
    expect(settings.has(RELEASE_SETTING)).toBe(false);

    const published = await handleLux('release', request('POST', { note: 'nuevos comandos' }), {}, {
      auth: asRole('admin'),
      db: () => db,
      now: () => Date.UTC(2026, 9, 18),
    });
    expect(published.body).toMatchObject({ version: LUX_BOT_VERSION + 1, note: 'nuevos comandos' });

    const read = await handleLux('release', request('GET'), {}, { db: () => db });
    expect(read.body.version).toBe(LUX_BOT_VERSION + 1);
  });
});

describe('script del bot', () => {
  it('incluye su versión y el aviso al arrancar', () => {
    const script = buildPythonScript({
      prefix: '!',
      channel: 'canal',
      botUsername: 'bot',
      welcomeMessage: '',
      commands: [],
    } as never);
    expect(script).toContain(`LUX_BOT_VERSION = ${LUX_BOT_VERSION}`);
    expect(script).toContain('async def check_lux_version():');
    expect(script).toContain('await check_lux_version()');
    expect(script).toContain('.replace("/chat", "/release")');
  });
});
