/**
 * tests/twitchSubscriptionsPanel.test.ts
 *
 * El panel de eventos (/api/twitch/subscriptions, Power-ups y seguidores) NO debe tocar la escucha del
 * chat del bot: ni mostrarla, ni crearla, ni quitarla. Eso es solo de botChatPort / «Bot en la nube».
 * Supabase (sesión y perfil) y Twitch son falsos; nada se ha probado contra los reales.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@supabase/supabase-js', () => {
  const profile = { id: 'p1', role: 'streamer', status: 'active', plan_id: null, media_folder: 'f', twitch_user_id: '100' };
  const table = () => {
    const chain: Record<string, unknown> = {};
    for (const name of ['select', 'eq']) chain[name] = () => chain;
    chain.maybeSingle = async () => ({ data: profile, error: null });
    return chain;
  };
  return {
    createClient: () => ({
      auth: { getUser: async () => ({ data: { user: { id: 'p1' } }, error: null }) },
      from: () => table(),
    }),
  };
});

import { resetClipState } from '../server/twitch/clips';
import { EVENT_TYPES } from '../server/twitch/eventsub';
import { WANTED, handleSubscriptions, resetSubscriptionState, summarize } from '../server/twitch/subscriptions';

const CALLBACK = 'https://lalo.example.com/api/twitch/eventsub';
const BOT = '999';
const env = {
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'k',
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
}

const versionOf = (type: string) => WANTED.find((entry) => entry.type === type)!.version;

function fakeTwitch(initial: FakeSub[]) {
  const subs = [...initial];
  const log: string[] = [];
  const creates: string[] = [];
  const impl = async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (target.startsWith('https://id.twitch.tv/oauth2/token')) return json({ access_token: 'TOK', expires_in: 3600 });
    if (method === 'GET') {
      return json({
        data: subs.map((sub) => ({
          id: sub.id,
          type: sub.type,
          version: versionOf(sub.type),
          status: sub.status,
          condition: {
            broadcaster_user_id: '100',
            ...(sub.type === EVENT_TYPES.chat ? { user_id: BOT } : {}),
            ...(sub.type === EVENT_TYPES.follow ? { moderator_user_id: '100' } : {}),
          },
          transport: { method: 'webhook', callback: CALLBACK },
          created_at: '2026-10-25T10:00:00Z',
        })),
      });
    }
    if (method === 'POST') {
      const body = JSON.parse(String(init?.body));
      creates.push(body.type);
      log.push(`POST ${body.type}`);
      subs.push({ id: `n${subs.length}`, type: body.type, status: 'webhook_callback_verification_pending' });
      return json({ data: [] }, 202);
    }
    if (method === 'DELETE') {
      const id = new URL(target).searchParams.get('id');
      log.push(`DELETE ${id}`);
      const index = subs.findIndex((sub) => sub.id === id);
      if (index >= 0) subs.splice(index, 1);
      return new Response(null, { status: 204 });
    }
    return json({}, 500);
  };
  return { fetch: impl as unknown as typeof fetch, subs, log, creates };
}

const request = (method: string, body?: Record<string, unknown>) => ({ method, headers: { authorization: 'Bearer t' }, body });

beforeEach(() => {
  resetClipState();
  resetSubscriptionState();
});

describe('el panel de eventos ignora el chat del bot', () => {
  it('GET no muestra una fila para el chat (viva o no) y sí las demás', async () => {
    const twitch = fakeTwitch([
      { id: 'chat1', type: EVENT_TYPES.chat, status: 'enabled' },
      { id: 'bits1', type: EVENT_TYPES.bits, status: 'enabled' },
    ]);
    const res = await handleSubscriptions(request('GET'), env, { fetch: twitch.fetch, now: () => 1 });
    expect(res.status).toBe(200);
    const rows = res.body.subscriptions as Array<{ type: string; status: string }>;
    expect(rows.some((row) => row.type === EVENT_TYPES.chat)).toBe(false);
    expect(rows.find((row) => row.type === EVENT_TYPES.bits)?.status).toBe('enabled');
    expect(rows.map((row) => row.type)).toEqual(WANTED.filter((entry) => !entry.bot).map((entry) => entry.type));
  });

  it('delete quita las del panel pero NO la escucha del chat', async () => {
    const twitch = fakeTwitch([
      { id: 'chat1', type: EVENT_TYPES.chat, status: 'enabled' },
      { id: 'bits1', type: EVENT_TYPES.bits, status: 'enabled' },
    ]);
    const res = await handleSubscriptions(request('POST', { action: 'delete' }), env, { fetch: twitch.fetch, now: () => 1 });
    expect(res.status).toBe(200);
    expect(twitch.log).toEqual(['DELETE bits1']);
    expect(twitch.subs.map((sub) => sub.id)).toEqual(['chat1']);
    expect((res.body.results as Array<{ type: string }>).some((item) => item.type === EVENT_TYPES.chat)).toBe(false);
  });

  it('create da de alta las del panel y no crea la del chat', async () => {
    const twitch = fakeTwitch([]);
    const res = await handleSubscriptions(request('POST', { action: 'create' }), env, { fetch: twitch.fetch, now: () => 1 });
    expect(res.status).toBe(200);
    expect(twitch.creates).not.toContain(EVENT_TYPES.chat);
    expect(twitch.creates.length).toBe(WANTED.filter((entry) => !entry.bot).length);
  });

  it('summarize no trae el chat aunque la lista lo traiga', () => {
    const rows = summarize([{ id: 'c', type: EVENT_TYPES.chat, status: 'enabled', createdAt: null }]);
    expect(rows.some((row) => row.type === EVENT_TYPES.chat)).toBe(false);
  });
});
