/**
 * tests/twitchBotPort.test.ts
 *
 * El adaptador de la escucha del chat (BotChatPort) sobre subscriptions.ts, con un fetch falso que
 * hace de Twitch (EventSub). Nada de esto se ha probado contra Twitch real.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetClipState } from '../server/twitch/clips';
import { EVENT_TYPES } from '../server/twitch/eventsub';
import { createSubscriptionChatPort, translateStatus } from '../server/twitch/botChatPort';
import { handleBot, resetBotState, type BotCaller } from '../server/twitch/botHandlers';
import { handleIntegration } from '../server/integrations/handlers';
import { DEFAULT_BOT_SETTINGS, type BotDb, type BotSettings } from '../server/twitch/botDb';

const CALLBACK = 'https://lalo.example.com/api/twitch/eventsub';
const BOT = '999';
const env = {
  TWITCH_CLIENT_ID: 'cid',
  TWITCH_CLIENT_SECRET: 'csecret',
  TWITCH_EVENTSUB_SECRET: 'un-secreto-largo-1234',
  TWITCH_EVENTSUB_CALLBACK: CALLBACK,
  TWITCH_BOT_USER_ID: BOT,
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface FakeSub {
  id: string;
  type: string;
  status: string;
  broadcaster?: string;
  user?: string;
  callback?: string;
}

const subItem = (sub: FakeSub) => ({
  id: sub.id,
  type: sub.type,
  version: '1',
  status: sub.status,
  condition: { broadcaster_user_id: sub.broadcaster ?? '100', ...(sub.type === EVENT_TYPES.chat ? { user_id: sub.user ?? BOT } : {}) },
  transport: { method: 'webhook', callback: sub.callback ?? CALLBACK },
  created_at: '2026-10-25T10:00:00Z',
});

/** Twitch falso: token, lista, alta y baja de suscripciones. */
function fakeTwitch(initial: FakeSub[], options: { createStatus?: number; listStatus?: number; deleteStatus?: number } = {}) {
  const subs = [...initial];
  const log: string[] = [];
  const creates: Array<Record<string, unknown>> = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (target.startsWith('https://id.twitch.tv/oauth2/token')) return json({ access_token: 'TOK', expires_in: 3600 });
    if (method === 'GET') {
      log.push('GET');
      if (options.listStatus) return json({}, options.listStatus);
      return json({ data: subs.map(subItem) });
    }
    if (method === 'POST') {
      const body = JSON.parse(String(init?.body));
      creates.push(body);
      log.push('POST');
      if (options.createStatus && options.createStatus !== 202) return json({}, options.createStatus);
      subs.push({ id: `nueva${subs.length}`, type: body.type, status: 'webhook_callback_verification_pending', broadcaster: body.condition.broadcaster_user_id, user: body.condition.user_id });
      return json({ data: [] }, 202);
    }
    if (method === 'DELETE') {
      const id = new URL(target).searchParams.get('id');
      log.push(`DELETE ${id}`);
      if (options.deleteStatus && options.deleteStatus !== 204) return new Response(null, { status: options.deleteStatus });
      const index = subs.findIndex((sub) => sub.id === id);
      if (index >= 0) subs.splice(index, 1);
      return new Response(null, { status: 204 });
    }
    return json({}, 500);
  });
  return { fetch: impl as unknown as typeof fetch, subs, log, creates, impl };
}

const chat = (status: string, extra: Partial<FakeSub> = {}): FakeSub => ({ id: `chat-${status}`, type: EVENT_TYPES.chat, status, ...extra });

const portWith = (twitch: ReturnType<typeof fakeTwitch>, overrides: Partial<typeof env> = {}) =>
  createSubscriptionChatPort({ env: { ...env, ...overrides }, fetch: twitch.fetch });

beforeEach(() => {
  resetClipState();
  resetBotState();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('traducción de estados de Twitch', () => {
  it('enabled, pending, ausente y el resto', () => {
    expect(translateStatus({ status: 'enabled' })).toBe('enabled');
    expect(translateStatus({ status: 'webhook_callback_verification_pending' })).toBe('pending');
    expect(translateStatus(undefined)).toBe('missing');
    for (const status of ['authorization_revoked', 'notification_failures_exceeded', 'webhook_callback_verification_failed', 'user_removed', 'version_removed']) {
      expect(translateStatus({ status })).toBe('error');
    }
  });
});

describe('status', () => {
  it('lee la suscripción de chat del canal y la traduce', async () => {
    expect(await portWith(fakeTwitch([chat('enabled')])).status('100')).toBe('enabled');
    expect(await portWith(fakeTwitch([chat('webhook_callback_verification_pending')])).status('100')).toBe('pending');
    expect(await portWith(fakeTwitch([])).status('100')).toBe('missing');
    expect(await portWith(fakeTwitch([chat('authorization_revoked')])).status('100')).toBe('error');
  });

  it('ignora lo que no es de este canal, de esta dirección, de la cuenta Lalo ni del tipo chat', async () => {
    const twitch = fakeTwitch([
      chat('enabled', { id: 'otro-canal', broadcaster: '200' }),
      chat('enabled', { id: 'otra-direccion', callback: 'https://otro.example.com/x' }),
      chat('enabled', { id: 'otro-bot', user: '777' }),
      { id: 'bits', type: EVENT_TYPES.bits, status: 'enabled' },
    ]);
    expect(await portWith(twitch).status('100')).toBe('missing');
  });

  it('si hay una caída y una viva, vale la viva', async () => {
    const twitch = fakeTwitch([chat('authorization_revoked', { id: 'a' }), chat('enabled', { id: 'b' })]);
    expect(await portWith(twitch).status('100')).toBe('enabled');
  });

  it('si Twitch falla o no responde, «error»; sin configuración del servidor, «unavailable»', async () => {
    expect(await portWith(fakeTwitch([], { listStatus: 500 })).status('100')).toBe('error');
    const broken = createSubscriptionChatPort({ env, fetch: (async () => Promise.reject(new Error('red'))) as unknown as typeof fetch });
    expect(await broken.status('100')).toBe('error');
    const twitch = fakeTwitch([chat('enabled')]);
    expect(await portWith(twitch, { TWITCH_EVENTSUB_SECRET: '' }).status('100')).toBe('unavailable');
    expect(await portWith(twitch, { TWITCH_EVENTSUB_CALLBACK: '' }).status('100')).toBe('unavailable');
    expect(twitch.impl).not.toHaveBeenCalled();
  });
});

describe('subscribe', () => {
  it('da de alta channel.chat.message con el canal y la cuenta Lalo en la condición', async () => {
    const twitch = fakeTwitch([]);
    expect(await portWith(twitch).subscribe('100')).toEqual({ outcome: 'created', detail: '' });
    expect(twitch.creates).toEqual([
      {
        type: 'channel.chat.message',
        version: '1',
        condition: { broadcaster_user_id: '100', user_id: BOT },
        transport: { method: 'webhook', callback: CALLBACK, secret: env.TWITCH_EVENTSUB_SECRET },
      },
    ]);
  });

  it('es idempotente: si ya está viva (o a punto), no crea otra', async () => {
    for (const status of ['enabled', 'webhook_callback_verification_pending']) {
      const twitch = fakeTwitch([chat(status)]);
      expect(await portWith(twitch).subscribe('100')).toEqual({ outcome: 'already', detail: '' });
      expect(twitch.creates).toHaveLength(0);
    }
  });

  it('una caída se borra antes de volver a crear', async () => {
    const twitch = fakeTwitch([chat('authorization_revoked', { id: 'caida' })]);
    expect((await portWith(twitch).subscribe('100')).outcome).toBe('created');
    expect(twitch.log).toEqual(['GET', 'DELETE caida', 'POST']);
  });

  it('403 de Twitch: no_permission (falta channel:bot o la autorización de Lalo)', async () => {
    const result = await portWith(fakeTwitch([], { createStatus: 403 })).subscribe('100');
    expect(result.outcome).toBe('no_permission');
    expect(result.detail).toContain('channel:bot');
  });

  it('otros fallos: error, sin lanzar; sin TWITCH_BOT_USER_ID o sin configuración: skipped', async () => {
    expect((await portWith(fakeTwitch([], { createStatus: 500 })).subscribe('100')).outcome).toBe('error');
    expect((await portWith(fakeTwitch([], { listStatus: 500 })).subscribe('100')).outcome).toBe('error');
    const twitch = fakeTwitch([]);
    expect((await portWith(twitch, { TWITCH_BOT_USER_ID: '' }).subscribe('100')).outcome).toBe('skipped');
    expect((await portWith(twitch, { TWITCH_EVENTSUB_SECRET: '' }).subscribe('100')).outcome).toBe('skipped');
    expect(twitch.creates).toHaveLength(0);
  });
});

describe('unsubscribe', () => {
  it('borra solo las de chat de ese canal y devuelve true', async () => {
    const twitch = fakeTwitch([
      chat('enabled', { id: 'c1' }),
      chat('authorization_revoked', { id: 'c2' }),
      chat('enabled', { id: 'ajena', broadcaster: '200' }),
      { id: 'bits', type: EVENT_TYPES.bits, status: 'enabled' },
    ]);
    expect(await portWith(twitch).unsubscribe('100')).toBe(true);
    expect(twitch.log).toEqual(['GET', 'DELETE c1', 'DELETE c2']);
    expect(twitch.subs.map((sub) => sub.id)).toEqual(['ajena', 'bits']);
  });

  it('sin ninguna, es true; si Twitch no deja borrar, false; sin configuración, false', async () => {
    expect(await portWith(fakeTwitch([])).unsubscribe('100')).toBe(true);
    expect(await portWith(fakeTwitch([chat('enabled')], { deleteStatus: 500 })).unsubscribe('100')).toBe(false);
    expect(await portWith(fakeTwitch([], { listStatus: 500 })).unsubscribe('100')).toBe(false);
    expect(await portWith(fakeTwitch([chat('enabled')]), { TWITCH_EVENTSUB_CALLBACK: '' }).unsubscribe('100')).toBe(false);
  });

  it('un 404 al borrar (ya no existía) cuenta como borrada', async () => {
    expect(await portWith(fakeTwitch([chat('enabled')], { deleteStatus: 404 })).unsubscribe('100')).toBe(true);
  });
});

describe('conexión con el panel (sin dependencias circulares)', () => {
  const caller: BotCaller = { profileId: 'p1', twitchUserId: '100', twitchLogin: 'canala' };
  const store = (settings: BotSettings): BotDb =>
    ({
      settings: async () => settings,
      commands: async () => [],
      saveSettings: async (_id: string, patch: Partial<BotSettings>) => ({ ...settings, ...patch }),
      takeCooldown: async () => ({ ok: true }),
    }) as unknown as BotDb;

  it('importar las integraciones conecta el puerto: el panel ve el estado real de Twitch', async () => {
    const twitch = fakeTwitch([chat('enabled')]);
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    vi.stubGlobal('fetch', twitch.fetch);
    // Sin pasar chat en los overrides: el que usa es el conectado por server/integrations/handlers.ts
    const res = await handleBot({ method: 'GET', headers: {}, body: undefined }, process.env, {
      who: async () => caller,
      // Con el bot apagado no se pregunta a Twitch: el estado real solo se ve con el bot encendido
      db: () => store({ ...DEFAULT_BOT_SETTINGS, enabled: true }),
    });
    expect(res.body.connection).toMatchObject({ chat: 'enabled' });
  });

  it('connect desde el panel da de alta la suscripción y enciende el bot', async () => {
    const twitch = fakeTwitch([]);
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    vi.stubGlobal('fetch', twitch.fetch);
    const res = await handleBot({ method: 'POST', headers: {}, body: { action: 'connect' } }, process.env, {
      who: async () => caller,
      db: () => store(DEFAULT_BOT_SETTINGS),
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ outcome: 'created', settings: { enabled: true } });
    expect(twitch.creates[0]).toMatchObject({ type: 'channel.chat.message' });
  });

  it('la ruta de integraciones sigue resolviendo twitch-bot/bot (el módulo se carga sin ciclos)', async () => {
    const res = await handleIntegration('twitch-bot', 'bot', { method: 'PUT', headers: {}, query: {} }, {});
    expect(res.status).toBe(405);
  });
});
