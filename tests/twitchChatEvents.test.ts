/**
 * tests/twitchChatEvents.test.ts
 *
 * Suscripción a los mensajes del chat (channel.chat.message) y su lectura:
 * normalización con insignias, formas mal formadas, condición {broadcaster_user_id, user_id},
 * omisión si falta TWITCH_BOT_USER_ID, error 403, mensajes del propio bot y descarte por antigüedad.
 * Todo con datos de ejemplo: nada se ha probado contra Twitch real.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  EVENT_TYPES,
  computeSignature,
  createDeduper,
  handleEventsub,
  isOwnBotMessage,
  normalizeChatMessage,
  type ChatMessageEvent,
} from '../server/twitch/eventsub';
import { WANTED, conditionFor, createOne, ownSubscriptions, readEventsConfig, summarize } from '../server/twitch/subscriptions';

const CHAT = {
  broadcaster_user_id: '1337',
  broadcaster_user_login: 'streamer',
  broadcaster_user_name: 'Streamer',
  chatter_user_id: '4242',
  chatter_user_login: 'espectador',
  chatter_user_name: 'Espectador',
  message_id: 'cc106a89-1814-919d-454c-f4f2f970aae7',
  message: { text: '!hola Lalo', fragments: [{ type: 'text', text: '!hola Lalo' }] },
  message_type: 'text',
  badges: [{ set_id: 'moderator', id: '1', info: '' }],
  reply: null,
};

describe('normalizeChatMessage', () => {
  it('reduce el mensaje y deriva los roles de las insignias', () => {
    const chat = normalizeChatMessage({
      ...CHAT,
      badges: [
        { set_id: 'broadcaster', id: '1', info: '' },
        { set_id: 'moderator', id: '1', info: '' },
        { set_id: 'founder', id: '0', info: '3' },
        { set_id: 'vip', id: '1', info: '' },
      ],
    });
    expect(chat).toEqual({
      messageId: CHAT.message_id,
      broadcasterId: '1337',
      broadcasterLogin: 'streamer',
      chatterId: '4242',
      chatterLogin: 'espectador',
      chatterName: 'Espectador',
      text: '!hola Lalo',
      isBroadcaster: true,
      isMod: true,
      isSub: true,
      isVip: true,
    });
  });

  it('sin insignias no hay roles, y limpia los caracteres de control', () => {
    const chat = normalizeChatMessage({ ...CHAT, badges: [], message: { text: 'hola\u0000\nmundo' } });
    expect(chat).toMatchObject({ isBroadcaster: false, isMod: false, isSub: false, isVip: false, text: 'hola  mundo' });
    expect(chat?.replyParent).toBeUndefined();
    expect(normalizeChatMessage({ ...CHAT, badges: undefined })).toMatchObject({ isMod: false });
  });

  it('incluye el mensaje al que responde', () => {
    const chat = normalizeChatMessage({
      ...CHAT,
      reply: {
        parent_message_id: 'padre-1',
        parent_message_body: 'hola a todos',
        parent_user_id: '99',
        parent_user_login: 'otro',
        parent_user_name: 'Otro',
        thread_message_id: 'padre-1',
      },
    });
    expect(chat?.replyParent).toEqual({ messageId: 'padre-1', userId: '99', userLogin: 'otro', userName: 'Otro', text: 'hola a todos' });
    // Una respuesta mal formada no tira el mensaje
    expect(normalizeChatMessage({ ...CHAT, reply: { parent_message_id: '<x>' } })?.replyParent).toBeUndefined();
  });

  it('descarta las formas mal formadas', () => {
    expect(normalizeChatMessage(null)).toBeNull();
    expect(normalizeChatMessage([])).toBeNull();
    expect(normalizeChatMessage({ ...CHAT, broadcaster_user_id: '1337; drop' })).toBeNull();
    expect(normalizeChatMessage({ ...CHAT, chatter_user_id: undefined })).toBeNull();
    expect(normalizeChatMessage({ ...CHAT, message_id: 'no válido!' })).toBeNull();
    expect(normalizeChatMessage({ ...CHAT, message: null })).toBeNull();
    expect(normalizeChatMessage({ ...CHAT, message: { text: '   ' } })).toBeNull();
  });
});

describe('isOwnBotMessage', () => {
  const event = { chatterId: '555' } as ChatMessageEvent;
  it('reconoce los mensajes de la cuenta Lalo', () => {
    expect(isOwnBotMessage(event, '555')).toBe(true);
    expect(isOwnBotMessage(event, '556')).toBe(false);
  });
  it('sin id del bot configurado nunca coincide', () => {
    expect(isOwnBotMessage({ chatterId: '' } as ChatMessageEvent, '')).toBe(false);
  });
});

describe('suscripción channel.chat.message', () => {
  const chatWanted = WANTED.find((item) => item.type === EVENT_TYPES.chat)!;
  const callback = 'https://laloplay.vercel.app/api/twitch/eventsub';
  const env = {
    VITE_TWITCH_CLIENT_ID: 'abc',
    TWITCH_CLIENT_SECRET: 'def',
    TWITCH_EVENTSUB_SECRET: 's3cRe7-de-prueba',
    TWITCH_EVENTSUB_CALLBACK: callback,
  };

  it('está en la lista con versión 1 y el permiso channel:bot del streamer', () => {
    expect(chatWanted).toMatchObject({ version: '1', scope: 'channel:bot' });
  });

  it('la condición lleva el canal y la cuenta Lalo', () => {
    expect(conditionFor(chatWanted, '1337', '555')).toEqual({ broadcaster_user_id: '1337', user_id: '555' });
    // Los demás tipos no cambian
    expect(conditionFor(WANTED.find((item) => item.type === EVENT_TYPES.online)!, '1337', '555')).toEqual({ broadcaster_user_id: '1337' });
  });

  it('lee TWITCH_BOT_USER_ID y lo ignora si no es numérico', () => {
    expect(readEventsConfig({ ...env, TWITCH_BOT_USER_ID: ' 555 ' }).config?.botUserId).toBe('555');
    expect(readEventsConfig(env).config?.botUserId).toBe('');
    expect(readEventsConfig({ ...env, TWITCH_BOT_USER_ID: 'lalo_bot' }).config?.botUserId).toBe('');
    // Su ausencia no apaga el canal de eventos
    expect(readEventsConfig(env).missing).toEqual([]);
  });

  const config = (botUserId: string) => readEventsConfig({ ...env, TWITCH_BOT_USER_ID: botUserId }).config!;
  const fakeFetch = (status: number) => {
    const calls: { url: string; body: unknown }[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      calls.push({ url: target, body: init?.body && target.includes('helix') ? JSON.parse(String(init.body)) : undefined });
      if (target.includes('oauth2/token')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
      return new Response('{}', { status });
    }) as unknown as typeof fetch;
    return { fetcher, calls };
  };

  it('envía la condición con user_id al crearla', async () => {
    const { fetcher, calls } = fakeFetch(202);
    const result = await createOne(chatWanted, '1337', config('555'), { fetch: fetcher, now: () => 1 });
    expect(result.outcome).toBe('created');
    const post = calls.find((call) => call.url.includes('helix/eventsub/subscriptions'));
    expect(post?.body).toMatchObject({
      type: 'channel.chat.message',
      version: '1',
      condition: { broadcaster_user_id: '1337', user_id: '555' },
      transport: { method: 'webhook', callback },
    });
  });

  it('se omite sin TWITCH_BOT_USER_ID y no llama a Twitch', async () => {
    const { fetcher, calls } = fakeFetch(202);
    const result = await createOne(chatWanted, '1337', config(''), { fetch: fetcher, now: () => 1 });
    expect(result.outcome).toBe('skipped');
    expect(result.detail).toContain('TWITCH_BOT_USER_ID');
    expect(calls).toHaveLength(0);
  });

  it('mapea el 403 a no_permission y dice qué falta', async () => {
    const { fetcher } = fakeFetch(403);
    const result = await createOne(chatWanted, '1337', config('555'), { fetch: fetcher, now: () => 1 });
    expect(result.outcome).toBe('no_permission');
    expect(result.detail).toContain('channel:bot');
    expect(result.detail).toContain('Lalo');
  });

  it('modo streamer: user_id es el propio streamer y no hace falta TWITCH_BOT_USER_ID', async () => {
    const { fetcher, calls } = fakeFetch(202);
    const result = await createOne(chatWanted, '1337', config(''), { fetch: fetcher, now: () => 1 }, '1337');
    expect(result.outcome).toBe('created');
    const post = calls.find((call) => call.url.includes('helix/eventsub/subscriptions'));
    expect(post?.body).toMatchObject({ type: 'channel.chat.message', condition: { broadcaster_user_id: '1337', user_id: '1337' } });
  });

  it('modo streamer: el 403 pide los tres permisos del streamer y no nombra channel:bot ni a Lalo', async () => {
    const result = await createOne(chatWanted, '1337', config('555'), { fetch: fakeFetch(403).fetcher, now: () => 1 }, '1337');
    expect(result.outcome).toBe('no_permission');
    for (const scope of ['user:read:chat', 'user:write:chat', 'user:bot']) expect(result.detail).toContain(scope);
    expect(result.detail).not.toContain('channel:bot');
    expect(result.detail).not.toContain('Lalo');
  });

  it('ownSubscriptions filtra por el user_id del modo y devuelve quién lee el chat', () => {
    const item = (user: string) => ({
      id: user,
      type: EVENT_TYPES.chat,
      version: '1',
      status: 'enabled',
      condition: { broadcaster_user_id: '1337', user_id: user },
      transport: { method: 'webhook', callback },
      created_at: '2026-10-25T10:00:00Z',
    });
    const both = [item('1337'), item('555')];
    expect(ownSubscriptions(both, '1337', callback, '1337').map((sub) => sub.userId)).toEqual(['1337']);
    expect(ownSubscriptions(both, '1337', callback, '555').map((sub) => sub.userId)).toEqual(['555']);
    expect(ownSubscriptions(both, '1337', callback, '').map((sub) => sub.userId)).toEqual(['1337', '555']);
  });

  it('409 es que ya existía y otro código es error', async () => {
    expect((await createOne(chatWanted, '1337', config('555'), { fetch: fakeFetch(409).fetcher, now: () => 1 })).outcome).toBe('already');
    expect((await createOne(chatWanted, '1337', config('555'), { fetch: fakeFetch(500).fetcher, now: () => 1 })).outcome).toBe('error');
  });

  it('ownSubscriptions solo acepta la del canal, con user_id y esta dirección', () => {
    const item = (condition: Record<string, string>, cb = callback) => ({
      id: 'a',
      type: EVENT_TYPES.chat,
      version: '1',
      status: 'enabled',
      condition,
      transport: { method: 'webhook', callback: cb },
      created_at: '2026-10-25T10:00:00Z',
    });
    const good = item({ broadcaster_user_id: '1337', user_id: '555' });
    expect(ownSubscriptions([good], '1337', callback, '555')).toHaveLength(1);
    // Sin saber cuál es el bot, vale cualquiera con user_id (para poder quitarla)
    expect(ownSubscriptions([good], '1337', callback)).toHaveLength(1);
    expect(ownSubscriptions([item({ broadcaster_user_id: '1337', user_id: '999' })], '1337', callback, '555')).toHaveLength(0);
    expect(ownSubscriptions([item({ broadcaster_user_id: '1337' })], '1337', callback, '555')).toHaveLength(0);
    expect(ownSubscriptions([item({ broadcaster_user_id: '2', user_id: '555' })], '1337', callback, '555')).toHaveLength(0);
    expect(ownSubscriptions([item({ broadcaster_user_id: '1337', user_id: '555' }, 'https://otro.example/x')], '1337', callback, '555')).toHaveLength(0);
  });

  it('el estado del panel de eventos NO trae fila para el chat (lo gestiona el bot), ni viva ni caída', () => {
    expect(summarize([]).some((row) => row.type === EVENT_TYPES.chat)).toBe(false);
    const chatLive = [{ id: 'c1', type: EVENT_TYPES.chat, status: 'enabled', createdAt: null }];
    expect(summarize(chatLive).some((row) => row.type === EVENT_TYPES.chat)).toBe(false);
  });
});

describe('el receptor y los mensajes del chat', () => {
  const secret = 's3cRe7-de-prueba';
  const env = { TWITCH_EVENTSUB_SECRET: secret };
  const stamp = '2026-10-25T12:00:00.000000000Z';
  const now = () => Date.parse('2026-10-25T12:00:05Z');

  const body = (event: unknown = CHAT, broadcaster = '1337') =>
    JSON.stringify({
      subscription: { type: EVENT_TYPES.chat, version: '1', status: 'enabled', condition: { broadcaster_user_id: broadcaster, user_id: '555' } },
      event,
    });

  const send = (
    raw: string,
    deps: Parameters<typeof handleEventsub>[2],
    options: { id?: string; timestamp?: string } = {}
  ) => {
    const id = options.id ?? 'msg-1';
    const timestamp = options.timestamp ?? stamp;
    const headers: Record<string, string> = {
      'twitch-eventsub-message-id': id,
      'twitch-eventsub-message-timestamp': timestamp,
      'twitch-eventsub-message-signature': computeSignature(secret, id, timestamp, raw),
      'twitch-eventsub-message-type': 'notification',
    };
    return handleEventsub({ method: 'POST', header: (name) => headers[name.toLowerCase()] ?? '', rawBody: raw }, env, {
      now,
      deduper: createDeduper(),
      ...deps,
    });
  };

  it('entrega el mensaje al enganche y no lo guarda como evento', async () => {
    const ingest = vi.fn(async () => 'ok' as const);
    const received: ChatMessageEvent[] = [];
    const result = await send(body(), { ingest, onChatMessage: (chat) => void received.push(chat) });
    expect(result).toMatchObject({ status: 200, contentType: 'application/json' });
    expect(ingest).not.toHaveBeenCalled();
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ text: '!hola Lalo', chatterId: '4242', isMod: true });
  });

  it('sin enganche responde 200 y no guarda nada', async () => {
    const ingest = vi.fn(async () => 'ok' as const);
    expect((await send(body(), { ingest })).status).toBe(200);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('un reintento con el mismo Message-Id no se procesa dos veces', async () => {
    const onChatMessage = vi.fn();
    const deduper = createDeduper();
    await send(body(), { onChatMessage, deduper });
    const again = await send(body(), { onChatMessage, deduper });
    expect(JSON.parse(again.body)).toEqual({ status: 'duplicate' });
    expect(onChatMessage).toHaveBeenCalledTimes(1);
  });

  it('descarta con 200 un mensaje de más de diez minutos', async () => {
    const onChatMessage = vi.fn();
    const result = await send(body(), { onChatMessage }, { timestamp: '2026-10-25T11:49:00.000000000Z' });
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ status: 'stale' });
    expect(onChatMessage).not.toHaveBeenCalled();
  });

  it('ignora lo mal formado o de otro canal', async () => {
    const onChatMessage = vi.fn();
    expect(JSON.parse((await send(body({ ...CHAT, message: null }), { onChatMessage }, { id: 'a' })).body)).toEqual({ status: 'ignored' });
    expect(JSON.parse((await send(body(CHAT, '999'), { onChatMessage }, { id: 'b' })).body)).toEqual({ status: 'ignored' });
    expect(onChatMessage).not.toHaveBeenCalled();
  });

  it('un fallo del procesador no hace que Twitch reintente', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await send(body(), {
      onChatMessage: async () => {
        throw new Error('fallo de prueba');
      },
    });
    expect(result.status).toBe(200);
    spy.mockRestore();
  });
});
