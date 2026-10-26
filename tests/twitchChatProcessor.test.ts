/**
 * tests/twitchChatProcessor.test.ts
 *
 * El bot de chat en la nube: del mensaje de EventSub a la respuesta. Base de datos, Mi AI,
 * limitador y fetch son falsos; nada de esto se ha probado contra Twitch ni Supabase reales.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetClipState } from '../server/twitch/clips';
import { createChatProcessor, fillResponse, hasPermission, type ChatLux, type ChatProcessorDeps } from '../server/twitch/chatProcessor';
import { createDbLimiter, type LimiterRpc } from '../server/twitch/chatLimiter';
import { createMemoryLimiter, type SendLimiter } from '../server/twitch/chatSend';
import { DEFAULT_BOT_SETTINGS, type BotCommand, type BotDb, type BotSettings } from '../server/twitch/botDb';
import { DEFAULT_LUX_SETTINGS, type LuxSettings } from '../server/lux/settings';
import type { ChatMessageEvent } from '../server/twitch/eventsub';

const BOT = '999';
const env = { TWITCH_CLIENT_ID: 'cid', TWITCH_CLIENT_SECRET: 'csecret', TWITCH_BOT_USER_ID: BOT };
const PROFILE_A = '11111111-1111-1111-1111-111111111111';
const PROFILE_B = '22222222-2222-2222-2222-222222222222';
const CHANNELS: Record<string, string> = { '100': PROFILE_A, '200': PROFILE_B };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** fetch falso: token siempre bien; cada envío al chat se anota. */
function fakeFetch(chat: () => Response = () => json({ data: [{ message_id: 'm1', is_sent: true }] })) {
  const sent: Array<{ broadcaster_id: string; sender_id: string; message: string; reply_parent_message_id?: string }> = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith('https://id.twitch.tv/oauth2/token')) return json({ access_token: 'TOK', expires_in: 3600 });
    sent.push(JSON.parse(String(init?.body)));
    return chat();
  });
  return { fetch: impl as unknown as typeof fetch, sent };
}

function fakeDb(data: { settings?: Record<string, BotSettings>; commands?: Record<string, BotCommand[]> }) {
  const cooldowns = new Map<string, number>();
  const takes: string[] = [];
  let clock = 0;
  const db: BotDb = {
    settings: async (id) => data.settings?.[id] ?? null,
    commands: async (id) => data.commands?.[id] ?? [],
    takeCooldown: async (id, viewer, key, seconds) => {
      const k = `${id}:${viewer}:${key}`;
      takes.push(k);
      const until = cooldowns.get(k) ?? 0;
      if (until > clock) return { ok: false, waitSeconds: until - clock };
      cooldowns.set(k, clock + seconds);
      return { ok: true };
    },
    saveSettings: vi.fn(),
    saveCommand: vi.fn(),
    deleteCommand: vi.fn(),
    lastSpontaneous: vi.fn(),
    markSpontaneous: vi.fn(),
  } as unknown as BotDb;
  return { db, takes, tick: (s: number) => (clock += s) };
}

const command = (name: string, response: string, permission: BotCommand['permission'] = 'all', enabled = true): BotCommand => ({
  id: `${name}-id`,
  name,
  response,
  permission,
  enabled,
  position: 0,
});

const on = (prefix = '!'): BotSettings => ({ ...DEFAULT_BOT_SETTINGS, enabled: true, prefix });

let counter = 0;
const message = (text: string, extra: Partial<ChatMessageEvent> = {}): ChatMessageEvent => ({
  messageId: `msg${++counter}`,
  broadcasterId: '100',
  broadcasterLogin: 'canalA',
  chatterId: '555',
  chatterLogin: 'ana',
  chatterName: 'Ana',
  text,
  isBroadcaster: false,
  isMod: false,
  isSub: false,
  isVip: false,
  ...extra,
});

function fakeLux(overrides: Partial<ChatLux> & { settings?: LuxSettings | null } = {}) {
  const asks: Array<{ profileId: string; viewer: string; message: string }> = [];
  const switches: Array<{ profileId: string; on: boolean }> = [];
  const lux: ChatLux = {
    settings: async () => (overrides.settings === undefined ? { ...DEFAULT_LUX_SETTINGS } : overrides.settings),
    ask:
      overrides.ask ??
      (async (profileId, input) => {
        asks.push({ profileId, viewer: input.viewer, message: input.message });
        const wait = await input.takeCooldown();
        return wait.ok ? { status: 200, body: { reply: `respuesta a ${input.message}` } } : { status: 200, body: { skipped: 'cooldown', waitSeconds: wait.waitSeconds } };
      }),
    setEnabled:
      overrides.setEnabled ??
      (async (profileId, value) => {
        switches.push({ profileId, on: value });
        return value;
      }),
  };
  return { lux, asks, switches };
}

interface Setup {
  settings?: Record<string, BotSettings>;
  commands?: Record<string, BotCommand[]>;
  limiter?: SendLimiter;
  lux?: ReturnType<typeof fakeLux>;
  chat?: () => Response;
  deps?: Partial<ChatProcessorDeps>;
}

function setup(options: Setup = {}) {
  const store = fakeDb({ settings: options.settings ?? { [PROFILE_A]: on(), [PROFILE_B]: on() }, commands: options.commands });
  const net = fakeFetch(options.chat);
  const lux = options.lux ?? fakeLux();
  const handler = createChatProcessor({
    db: () => store.db,
    profileId: async (id) => CHANNELS[id] ?? null,
    limiter: () => options.limiter ?? createMemoryLimiter(),
    lux: lux.lux,
    fetch: net.fetch,
    sleep: async () => undefined,
    ...options.deps,
  });
  return { handler, store, net, lux };
}

beforeEach(() => {
  resetClipState();
  vi.restoreAllMocks();
});

describe('antiabuso: cooldown por espectador y deduplicación', () => {
  it('un espectador no puede repetir un comando personalizado dentro de 5 s (no se responde) y otro sí', async () => {
    const { handler, net, store } = setup({ commands: { [PROFILE_A]: [command('hola', 'hi')] } });
    await handler(message('!hola'), env);
    await handler(message('!hola'), env);
    expect(net.sent).toHaveLength(1);
    await handler(message('!hola', { chatterId: '556', chatterLogin: 'beto', chatterName: 'Beto' }), env);
    expect(net.sent).toHaveLength(2);
    store.tick(6);
    await handler(message('!hola'), env);
    expect(net.sent).toHaveLength(3);
    expect(store.takes).toContain(`${PROFILE_A}:ana:cmd:hola`);
  });

  it('el cooldown es por comando: dos comandos distintos seguidos sí contestan', async () => {
    const { handler, net } = setup({ commands: { [PROFILE_A]: [command('uno', '1'), command('dos', '2')] } });
    await handler(message('!uno'), env);
    await handler(message('!dos'), env);
    expect(net.sent).toHaveLength(2);
  });

  it('un comando sin permiso no gasta el cooldown del espectador', async () => {
    const { handler, net, store } = setup({ commands: { [PROFILE_A]: [command('mod', 'x', 'mod')] } });
    await handler(message('!mod'), env);
    expect(store.takes.filter((item) => item.includes('cmd:mod'))).toEqual([]);
    expect(net.sent).toHaveLength(0);
  });

  it('!lux a secas: el aviso solo sale una vez dentro del cooldown', async () => {
    const { handler, net } = setup();
    await handler(message('!lux'), env);
    await handler(message('!lux'), env);
    expect(net.sent).toHaveLength(1);
  });

  it('aviso de permisos de !luxon/!luxoff: una vez por espectador y cooldown', async () => {
    const { handler, net, lux } = setup();
    await handler(message('!luxon'), env);
    await handler(message('!luxoff'), env);
    expect(net.sent).toHaveLength(1);
    expect(net.sent[0].message).toContain('solo el canal o los moderadores');
    expect(lux.switches).toEqual([]);
  });

  it('el mismo Message-Id solo se atiende una vez (deduplicación en base de datos)', async () => {
    const { handler, net, store } = setup({ commands: { [PROFILE_A]: [command('hola', 'hi')] } });
    const event = message('!hola');
    await handler(event, env);
    store.tick(6);
    await handler({ ...event }, env);
    expect(net.sent).toHaveLength(1);
    expect(store.takes[0]).toBe(`${PROFILE_A}:dedupe:m:${event.messageId}`);
  });
});

describe('comandos personalizados', () => {
  it('responde con {user} y {channel}', async () => {
    const { handler, net } = setup({ commands: { [PROFILE_A]: [command('hola', 'Hola {user}, bienvenido a {channel}. {user}!')] } });
    await handler(message('!hola'), env);
    expect(net.sent).toHaveLength(1);
    expect(net.sent[0]).toMatchObject({ broadcaster_id: '100', sender_id: BOT, message: 'Hola Ana, bienvenido a canalA. Ana!' });
  });

  it('no distingue mayúsculas y admite texto detrás', async () => {
    const { handler, net, store } = setup({ commands: { [PROFILE_A]: [command('redes', 'Sigueme')] } });
    await handler(message('!REDES por favor'), env);
    store.tick(6);
    await handler(message('!Redes'), env);
    expect(net.sent).toHaveLength(2);
  });

  it('no responde a comandos apagados ni inexistentes, ni a texto sin prefijo', async () => {
    const { handler, net } = setup({ commands: { [PROFILE_A]: [command('off', 'x', 'all', false), command('hola', 'hi')] } });
    await handler(message('!off'), env);
    await handler(message('!nada'), env);
    await handler(message('hola'), env);
    await handler(message('x !hola'), env);
    expect(net.sent).toHaveLength(0);
  });

  it('sin prefijo no confunde un comando con otro que lo contiene', async () => {
    const { handler, net } = setup({ commands: { [PROFILE_A]: [command('hola', 'hi')] } });
    await handler(message('!holas'), env);
    expect(net.sent).toHaveLength(0);
  });

  it.each([
    ['all', {}, true],
    ['sub', {}, false],
    ['sub', { isSub: true }, true],
    ['sub', { isMod: true }, true],
    ['sub', { isBroadcaster: true }, true],
    ['sub', { isVip: true }, false],
    ['mod', { isSub: true }, false],
    ['mod', { isMod: true }, true],
    ['mod', { isBroadcaster: true }, true],
    ['mod', { isVip: true }, false],
    ['broadcaster', { isMod: true }, false],
    ['broadcaster', { isSub: true, isVip: true }, false],
    ['broadcaster', { isBroadcaster: true }, true],
  ] as const)('permiso %s con %j -> %s', async (permission, who, allowed) => {
    const { handler, net } = setup({ commands: { [PROFILE_A]: [command('cmd', 'ok', permission)] } });
    await handler(message('!cmd', who), env);
    expect(net.sent).toHaveLength(allowed ? 1 : 0);
  });

  it('un permiso desconocido cierra el comando', () => {
    expect(hasPermission('otro' as never, { isSub: true, isMod: true, isBroadcaster: true })).toBe(false);
  });

  it('fillResponse cambia todas las apariciones', () => {
    expect(fillResponse('{user}{user} en {channel}', 'a', 'b')).toBe('aa en b');
  });

  it('no responde con «responder a»: igual que channel.send del script', async () => {
    const { handler, net } = setup({ commands: { [PROFILE_A]: [command('hola', 'hi')] } });
    await handler(message('!hola', { replyParent: { messageId: 'p', userId: '1', userLogin: 'x', userName: 'X', text: 'y' } }), env);
    expect(net.sent[0].reply_parent_message_id).toBeUndefined();
  });
});

describe('bot apagado, prefijo y aislamiento', () => {
  it('con el bot apagado no hace nada, ni comandos ni Mi AI', async () => {
    const lux = fakeLux();
    const { handler, net } = setup({
      settings: { [PROFILE_A]: { ...on(), enabled: false } },
      commands: { [PROFILE_A]: [command('hola', 'hi')] },
      lux,
    });
    await handler(message('!hola'), env);
    await handler(message('!lux hola'), env);
    expect(net.sent).toHaveLength(0);
    expect(lux.asks).toHaveLength(0);
  });

  it('sin ajustes guardados ni perfil no hace nada', async () => {
    const { handler, net } = setup({ settings: {} });
    await handler(message('!hola'), env);
    await handler(message('!hola', { broadcasterId: '300' }), env);
    expect(net.sent).toHaveLength(0);
  });

  it('usa el prefijo del streamer', async () => {
    const { handler, net } = setup({
      settings: { [PROFILE_A]: on('?') },
      commands: { [PROFILE_A]: [command('hola', 'hi')] },
    });
    await handler(message('!hola'), env);
    expect(net.sent).toHaveLength(0);
    await handler(message('?hola'), env);
    expect(net.sent).toHaveLength(1);
  });

  it('no mezcla streamers: cada canal usa sus comandos y escribe en su sala', async () => {
    const { handler, net } = setup({
      commands: { [PROFILE_A]: [command('hola', 'de A')], [PROFILE_B]: [command('hola', 'de B'), command('solob', 'solo B')] },
    });
    await handler(message('!hola'), env);
    await handler(message('!hola', { broadcasterId: '200', broadcasterLogin: 'canalB' }), env);
    await handler(message('!solob'), env);
    expect(net.sent.map((item) => [item.broadcaster_id, item.message])).toEqual([
      ['100', 'de A'],
      ['200', 'de B'],
    ]);
  });

  it('el modo «streamer» está reservado: no responde con la cuenta global', async () => {
    const { handler, net } = setup({
      settings: { [PROFILE_A]: { ...on(), senderMode: 'streamer' } },
      commands: { [PROFILE_A]: [command('hola', 'hi')] },
    });
    await handler(message('!hola'), env);
    expect(net.sent).toHaveLength(0);
  });
});

describe('mensajes del propio bot (sin bucle)', () => {
  it('ignora lo que escribe la cuenta del bot, aunque sea un comando', async () => {
    const lux = fakeLux();
    const { handler, net, store } = setup({ commands: { [PROFILE_A]: [command('hola', '!hola')] }, lux });
    await handler(message('!hola', { chatterId: BOT, chatterLogin: 'lalo' }), env);
    await handler(message('!lux hola', { chatterId: BOT, chatterLogin: 'lalo' }), env);
    expect(net.sent).toHaveLength(0);
    expect(lux.asks).toHaveLength(0);
    expect(store.takes).toHaveLength(0);
  });

  it('sin TWITCH_BOT_USER_ID no escribe nada', async () => {
    const { handler, net } = setup({ commands: { [PROFILE_A]: [command('hola', 'hi')] } });
    await handler(message('!hola'), { ...env, TWITCH_BOT_USER_ID: '' });
    expect(net.sent).toHaveLength(0);
  });

  it('una respuesta que empieza por el prefijo no provoca otra respuesta', async () => {
    const { handler, net } = setup({ commands: { [PROFILE_A]: [command('hola', '!hola')] } });
    await handler(message('!hola'), env);
    expect(net.sent).toHaveLength(1);
    // El eco de ese mensaje llega con el id del bot
    await handler(message('hola', { chatterId: BOT }), env);
    expect(net.sent).toHaveLength(1);
  });
});

describe('Mi AI en el chat', () => {
  it('!lux pregunta como el perfil del canal y responde', async () => {
    const lux = fakeLux();
    const { handler, net } = setup({ lux });
    await handler(message('!lux ¿qué tal?'), env);
    expect(lux.asks).toEqual([{ profileId: PROFILE_A, viewer: 'ana', message: '¿qué tal?' }]);
    expect(net.sent[0].message).toBe('respuesta a ¿qué tal?');
  });

  it('usa la palabra y el alias del streamer', async () => {
    const lux = fakeLux({ settings: { ...DEFAULT_LUX_SETTINGS, chatWord: 'maya', chatAlias: true } });
    const { handler, net } = setup({ lux });
    await handler(message('!MAYA hola'), env);
    await handler(message('!lux dos', { chatterId: '556', chatterLogin: 'beto' }), env);
    expect(lux.asks.map((item) => item.message)).toEqual(['hola', 'dos']);
    expect(net.sent).toHaveLength(2);

    const noAlias = fakeLux({ settings: { ...DEFAULT_LUX_SETTINGS, chatWord: 'maya', chatAlias: false } });
    const second = setup({ lux: noAlias });
    await second.handler(message('!lux dos'), env);
    expect(noAlias.asks).toHaveLength(0);
  });

  it('sin mensaje después de la palabra pide que escriba algo', async () => {
    const lux = fakeLux();
    const { handler, net } = setup({ lux });
    await handler(message('!lux'), env);
    expect(lux.asks).toHaveLength(0);
    expect(net.sent[0].message).toBe('@Ana escribe tu mensaje después de !lux.');
  });

  it('cooldown por espectador persistente: el segundo mensaje no responde y otro espectador sí', async () => {
    const lux = fakeLux();
    const { handler, net, store } = setup({ lux });
    await handler(message('!lux uno'), env);
    await handler(message('!lux dos'), env);
    expect(net.sent).toHaveLength(1);
    await handler(message('!lux tres', { chatterId: '556', chatterLogin: 'beto', chatterName: 'Beto' }), env);
    expect(net.sent).toHaveLength(2);
    store.tick(6);
    await handler(message('!lux cuatro'), env);
    expect(net.sent).toHaveLength(3);
    expect(store.takes).toContain(`${PROFILE_A}:ana:lux`);
  });

  it('el cooldown es por streamer: el mismo espectador en otro canal puede preguntar', async () => {
    const { handler, net } = setup();
    await handler(message('!lux uno'), env);
    await handler(message('!lux uno', { broadcasterId: '200', broadcasterLogin: 'canalB' }), env);
    expect(net.sent.map((item) => item.broadcaster_id)).toEqual(['100', '200']);
  });

  it('si Mi AI no responde (apagada, sin clave, error) no escribe nada', async () => {
    const lux = fakeLux({ ask: async () => ({ status: 200, body: { skipped: 'chat_off' } }) });
    const failing = fakeLux({ ask: async () => ({ status: 503, body: { error: 'no_key' } }) });
    const a = setup({ lux });
    const b = setup({ lux: failing });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await a.handler(message('!lux hola'), env);
    await b.handler(message('!lux hola'), env);
    expect(a.net.sent).toHaveLength(0);
    expect(b.net.sent).toHaveLength(0);
  });

  it('!luxon y !luxoff: el canal y los moderadores pueden', async () => {
    const lux = fakeLux();
    const { handler, net } = setup({ lux });
    await handler(message('!luxoff', { isMod: true }), env);
    await handler(message('!LUXON', { isBroadcaster: true }), env);
    expect(lux.switches).toEqual([
      { profileId: PROFILE_A, on: false },
      { profileId: PROFILE_A, on: true },
    ]);
    expect(net.sent.map((item) => item.message)).toEqual(['MI AI dejará de responder en el chat.', 'MI AI responderá en el chat.']);
  });

  it.each([{}, { isSub: true }, { isVip: true }])('!luxoff no cambia nada para %j', async (who) => {
    const lux = fakeLux();
    const { handler, net } = setup({ lux });
    await handler(message('!luxoff', who), env);
    expect(lux.switches).toHaveLength(0);
    expect(net.sent[0].message).toBe('@Ana solo el canal o los moderadores pueden hacerlo.');
  });

  it('si no se pudo guardar el cambio no anuncia nada', async () => {
    const lux = fakeLux({ setEnabled: async () => null });
    const { handler, net } = setup({ lux });
    await handler(message('!luxon', { isMod: true }), env);
    expect(net.sent).toHaveLength(0);
  });

  it('Mi AI gana a un comando con el mismo nombre', async () => {
    const lux = fakeLux();
    const { handler, net } = setup({ lux, commands: { [PROFILE_A]: [command('lux', 'comando')] } });
    await handler(message('!lux hola'), env);
    expect(net.sent).toHaveLength(1);
    expect(net.sent[0].message).toBe('respuesta a hola');
  });

  it('sin ajustes de Mi AI, los comandos siguen funcionando', async () => {
    const { handler, net } = setup({ lux: fakeLux({ settings: null }), commands: { [PROFILE_A]: [command('hola', 'hi')] } });
    await handler(message('!hola'), env);
    await handler(message('!lux x'), env);
    expect(net.sent.map((item) => item.message)).toEqual(['hi']);
  });
});

describe('limitador y fallos de envío', () => {
  /** Función SQL falsa con la misma lógica que 0040: 1/s por canal y N cada 30 s por cuenta. */
  function fakeRpc(now: () => number): LimiterRpc & { calls: Array<Record<string, unknown>> } {
    const rows: Array<{ bot: string; channel: string; at: number }> = [];
    const calls: Array<Record<string, unknown>> = [];
    return {
      calls,
      async rpc(fn, args) {
        calls.push({ fn, ...args });
        const t = now();
        const bot = String(args.p_bot_id);
        const channel = String(args.p_channel_id);
        const max = Number(args.p_account_max);
        const mine = rows.filter((row) => row.bot === bot && row.at > t - 30_000);
        const last = Math.max(0, ...rows.filter((row) => row.bot === bot && row.channel === channel).map((row) => row.at));
        const inChannel = rows.filter((row) => row.bot === bot && row.channel === channel && row.at > t - 30_000);
        const cmax = Number(args.p_channel_max);
        const capWait = inChannel.length >= cmax ? [...inChannel].sort((a, b) => b.at - a.at)[cmax - 1].at + 30_000 - t : 0;
        const channelWait = Math.max(capWait, last > t - 1000 ? last + 1000 - t : 0);
        const accountWait = mine.length >= max ? [...mine].sort((a, b) => b.at - a.at)[max - 1].at + 30_000 - t : 0;
        if (channelWait > 0 || accountWait > 0) {
          return { data: accountWait > channelWait ? { ok: false, waitMs: accountWait, scope: 'account' } : { ok: false, waitMs: channelWait, scope: 'channel' }, error: null };
        }
        rows.push({ bot, channel, at: t });
        return { data: { ok: true }, error: null };
      },
    };
  }

  it('el limitador persistente corta al pasar de 20 mensajes en 30 s por cuenta, repartidos en canales', async () => {
    let t = 1_000_000;
    const rpc = fakeRpc(() => t);
    const limiter = createDbLimiter(rpc);
    const results = [];
    for (let i = 0; i < 21; i++) {
      results.push(await limiter.take(BOT, String(1000 + i), t));
    }
    expect(results.slice(0, 20).every((item) => item.ok)).toBe(true);
    expect(results[20]).toMatchObject({ ok: false, scope: 'account' });
    t += 30_001;
    expect(await limiter.take(BOT, '1000', t)).toEqual({ ok: true });
  });

  it('el limitador persistente aplica 1 mensaje por segundo por canal', async () => {
    let t = 5_000;
    const limiter = createDbLimiter(fakeRpc(() => t));
    expect(await limiter.take(BOT, '100', t)).toEqual({ ok: true });
    expect(await limiter.take(BOT, '100', t)).toMatchObject({ ok: false, scope: 'channel' });
    expect(await limiter.take(BOT, '200', t)).toEqual({ ok: true });
    t += 1001;
    expect(await limiter.take(BOT, '100', t)).toEqual({ ok: true });
  });

  it('el limitador persistente topa un solo canal a 6 mensajes en 30 s y deja pasar a los demás', async () => {
    let t = 1_000_000;
    const limiter = createDbLimiter(fakeRpc(() => t));
    for (let i = 0; i < 6; i++) {
      expect(await limiter.take(BOT, '100', t)).toEqual({ ok: true });
      t += 1100;
    }
    expect(await limiter.take(BOT, '100', t)).toMatchObject({ ok: false, scope: 'channel' });
    expect(await limiter.take(BOT, '200', t)).toEqual({ ok: true });
  });

  it('pasa a la función SQL la cuenta, el canal y el tope', async () => {
    const rpc = fakeRpc(() => 1);
    await createDbLimiter(rpc, { accountMax: 100 }).take(BOT, '100', 1);
    expect(rpc.calls[0]).toEqual({ fn: 'take_twitch_bot_send', p_bot_id: BOT, p_channel_id: '100', p_account_max: 100, p_channel_max: 6 });
  });

  it('si la base de datos falla, el limitador no deja enviar (y no filtra el mensaje de error)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = createDbLimiter({ rpc: async () => ({ data: null, error: { code: '42883', message: 'secreto-interno' } }) });
    expect(await broken.take(BOT, '100', 1)).toMatchObject({ ok: false, scope: 'account' });
    const thrown = createDbLimiter({ rpc: async () => { throw new Error('secreto-interno'); } });
    expect(await thrown.take(BOT, '100', 1)).toMatchObject({ ok: false });
    expect(JSON.stringify(spy.mock.calls)).not.toContain('secreto-interno');
  });

  it('el procesador no envía si el limitador no deja, y no lanza', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const closed: SendLimiter = { take: async () => ({ ok: false, waitMs: 20_000, scope: 'account' }) };
    const { handler, net } = setup({ limiter: closed, commands: { [PROFILE_A]: [command('hola', 'hi')] } });
    await expect(handler(message('!hola'), env)).resolves.toBeUndefined();
    expect(net.sent).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith('[Lalo bot] mensaje no enviado: rate_limited');
  });

  it.each([401, 403, 429, 500])('un fallo %i de Twitch no lanza ni filtra el token', async (status) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { handler } = setup({ chat: () => json({ message: 'no' }, status), commands: { [PROFILE_A]: [command('hola', 'hi')] } });
    await expect(handler(message('!hola'), env)).resolves.toBeUndefined();
    expect(JSON.stringify([...warn.mock.calls, ...err.mock.calls])).not.toContain('TOK');
  });

  it('una excepción de la base de datos o de Mi AI no sube al receptor', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const lux = fakeLux({ ask: async () => { throw new Error('boom'); } });
    const a = setup({ lux });
    await expect(a.handler(message('!lux hola'), env)).resolves.toBeUndefined();

    const b = createChatProcessor({
      db: () => ({ settings: async () => { throw new Error('db caída'); } }) as unknown as BotDb,
      profileId: async () => PROFILE_A,
    });
    await expect(b(message('!hola'), env)).resolves.toBeUndefined();

    const c = createChatProcessor({ profileId: async () => { throw new Error('perfil'); }, db: () => fakeDb({}).db });
    await expect(c(message('!hola'), env)).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
  });

  it('una excepción del fetch no sube al receptor', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handler = createChatProcessor({
      db: () => fakeDb({ settings: { [PROFILE_A]: on() }, commands: { [PROFILE_A]: [command('hola', 'hi')] } }).db,
      profileId: async () => PROFILE_A,
      limiter: () => createMemoryLimiter(),
      lux: fakeLux().lux,
      fetch: (async () => { throw new Error('red caída'); }) as unknown as typeof fetch,
    });
    await expect(handler(message('!hola'), env)).resolves.toBeUndefined();
  });
});

describe('salida de la IA: sin enlaces ni menciones', () => {
  const luxReplying = (reply: string) => fakeLux({ ask: async () => ({ status: 200, body: { reply } }) });

  it('quita enlaces y arrobas ajenas, y conserva la @ inicial del espectador', async () => {
    const { handler, net } = setup({ lux: luxReplying('@ana mira https://estafa.example.com y saluda a @luis') });
    await handler(message('!lux hola'), env);
    expect(net.sent).toHaveLength(1);
    expect(net.sent[0].message).toBe('@ana mira y saluda a luis');
  });

  it('si no queda nada tras el filtro, no escribe', async () => {
    const { handler, net } = setup({ lux: luxReplying('www.spam.com') });
    await handler(message('!lux hola'), env);
    expect(net.sent).toHaveLength(0);
  });
});
