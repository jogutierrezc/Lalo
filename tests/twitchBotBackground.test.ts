/**
 * tests/twitchBotBackground.test.ts
 *
 * El trabajo de fondo del bot de chat en la nube: la cola de mensajes del panel y los saludos, y el
 * aprendizaje del chat con los comentarios espontáneos. Bases, Mi AI, limitador y fetch son falsos;
 * nada de esto se ha probado contra Twitch ni Supabase reales.
 */

import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetClipState } from '../server/twitch/clips';
import {
  LUX_IGNORE,
  MIN_DIGEST_LINES,
  OUTBOX_GAP_MS,
  STATUS_TTL_MS,
  createChatBackground,
  pushOutboxNow,
  storableLine,
  type BackgroundLux,
  type BackgroundDeps,
} from '../server/twitch/botBackground';
import type { BufferedLine, ChatLinesDb } from '../server/twitch/botChatLines';
import { createChatProcessor, type ChatLux } from '../server/twitch/chatProcessor';
import { LuxCooldown } from '../server/lux/chatCommands';
import { createMemoryLimiter, type SendLimiter } from '../server/twitch/chatSend';
import { DEFAULT_BOT_SETTINGS, type BotDb, type BotSettings } from '../server/twitch/botDb';
import { handleLux, luxDigestForProfile, luxOutboxForProfile, luxProactiveStatusForProfile, luxSpontaneousForProfile } from '../server/lux/handlers';
import { DEFAULT_LUX_SETTINGS, rowFromSettings, type LuxSettings } from '../server/lux/settings';
import { OUTBOX_RECLAIM_MS, outboxClaimable, type LuxDb, type LuxOutboxItem, type LuxOutboxRow, type LuxProfile, type LuxSpeechRow } from '../server/lux/luxDb';
import type { LuxProactiveStatus } from '../server/lux/handlers';
import type { ChatMessageEvent } from '../server/twitch/eventsub';
import type { IntegrationRequest } from '../server/integrations/http';

const BOT = '999';
const env = { TWITCH_CLIENT_ID: 'cid', TWITCH_CLIENT_SECRET: 'csecret', TWITCH_BOT_USER_ID: BOT };
const PROFILE = 'p1';
const T0 = Date.parse('2026-10-25T12:00:00Z');

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** fetch falso: token siempre bien; cada envío al chat se anota. */
function fakeFetch(chat: () => Response = () => json({ data: [{ message_id: 'm1', is_sent: true }] })) {
  const sent: Array<{ broadcaster_id: string; sender_id: string; message: string }> = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith('https://id.twitch.tv/oauth2/token')) return json({ access_token: 'TOK', expires_in: 3600 });
    sent.push(JSON.parse(String(init?.body)));
    return chat();
  });
  return { fetch: impl as unknown as typeof fetch, sent };
}

const openLimiter: SendLimiter = { take: async () => ({ ok: true }) };

let counter = 0;
const message = (text: string, extra: Partial<ChatMessageEvent> = {}): ChatMessageEvent => ({
  messageId: `msg${++counter}`,
  broadcasterId: '100',
  broadcasterLogin: 'canala',
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

/** Búfer de líneas en memoria con el mismo contrato que botChatLines.ts. */
function memoryLines() {
  const rows: Array<BufferedLine & { profileId: string; spont: boolean; used: boolean }> = [];
  let next = 1;
  const db: ChatLinesDb = {
    async push(profileId, viewer, text, spont) {
      rows.push({ id: next++, profileId, viewer, text, spont, used: false });
      // El tope por streamer de la función SQL
      const mine = rows.filter((row) => row.profileId === profileId);
      while (mine.length > 200) rows.splice(rows.indexOf(mine.shift()!), 1);
    },
    async all(profileId) {
      return rows.filter((row) => row.profileId === profileId).map(({ id, viewer, text }) => ({ id, viewer, text }));
    },
    async pendingSpontaneous(profileId, limit) {
      return rows
        .filter((row) => row.profileId === profileId && row.spont && !row.used)
        .slice(-limit)
        .map(({ id, viewer, text }) => ({ id, viewer, text }));
    },
    async markSpontaneousUsed(profileId, ids) {
      for (const row of rows) if (row.profileId === profileId && ids.includes(row.id)) row.used = true;
    },
    async clear(profileId, maxId, options = {}) {
      for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i];
        if (row.profileId !== profileId) continue;
        if (maxId !== undefined && row.id > maxId) continue;
        if (maxId !== undefined && options.keepPendingComments && row.spont && !row.used) continue;
        rows.splice(i, 1);
      }
    },
  };
  return { db, rows };
}

/** BotDb mínima: solo takeCooldown, con el mismo contrato (atómico, por clave) y un reloj propio. */
function memoryCooldowns(now: () => number) {
  const until = new Map<string, number>();
  const takes: string[] = [];
  const db = {
    async takeCooldown(profileId: string, viewer: string, key: string, seconds: number) {
      const k = `${profileId}|${viewer}|${key}`;
      takes.push(k);
      const at = until.get(k) ?? 0;
      if (at > now()) return { ok: false as const, waitSeconds: Math.ceil((at - now()) / 1000) };
      until.set(k, now() + seconds * 1000);
      return { ok: true as const };
    },
  } as unknown as BotDb;
  return { db, takes, until };
}

const statusOf = (patch: Partial<LuxProactiveStatus> & { spontaneous?: Partial<LuxProactiveStatus['spontaneous']> } = {}): LuxProactiveStatus => ({
  allowed: true,
  learning: false,
  digestReady: false,
  ...patch,
  spontaneous: { enabled: false, waitSeconds: 0, minMessages: 3, ...patch.spontaneous },
});

function fakeBackgroundLux(overrides: Partial<BackgroundLux> & { status?: LuxProactiveStatus | null } = {}) {
  const calls = { status: 0, digest: [] as Array<Array<{ viewer: string; text: string }>>, spontaneous: [] as Array<Array<{ viewer: string; text: string }>>, outbox: 0 };
  const lux: BackgroundLux = {
    status: async () => {
      calls.status++;
      return overrides.status === undefined ? statusOf() : overrides.status;
    },
    digest:
      overrides.digest ??
      (async (_id, lines) => {
        calls.digest.push(lines);
        return { status: 200, body: { learned: 1, discarded: 0 } };
      }),
    spontaneous:
      overrides.spontaneous ??
      (async (_id, lines) => {
        calls.spontaneous.push(lines);
        return { status: 200, body: { reply: 'Qué buen debate' } };
      }),
    outbox:
      overrides.outbox ??
      (async (_id, send) => {
        calls.outbox++;
        void send;
        return { sent: 0, failed: 0 };
      }),
  };
  return { lux, calls };
}

function background(options: { lux?: BackgroundLux; lines?: ChatLinesDb; deps?: Partial<BackgroundDeps>; clock?: { now: number } } = {}) {
  const net = fakeFetch();
  const clock = options.clock ?? { now: T0 };
  const lines = options.lines ? { db: options.lines } : memoryLines();
  const made = fakeBackgroundLux();
  const cooldowns = memoryCooldowns(() => clock.now);
  const instance = createChatBackground({
    lux: options.lux ?? made.lux,
    db: () => cooldowns.db,
    lines: () => lines.db,
    limiter: () => openLimiter,
    fetch: net.fetch,
    now: () => clock.now,
    sleep: async () => undefined,
    ...options.deps,
  });
  const input = (event: ChatMessageEvent, prefix = '!') => ({ event, env, profileId: PROFILE, prefix, botUserId: BOT });
  return { instance, net, clock, input, lines: lines as ReturnType<typeof memoryLines>, made, cooldowns };
}

beforeEach(() => {
  resetClipState();
  vi.restoreAllMocks();
});

// ---------- Líneas que se guardan ----------

describe('qué líneas del chat se guardan', () => {
  it('no guarda comandos, ni el prefijo del streamer ni «!», y recorta a 300', () => {
    expect(storableLine('hola a todos', '!')).toBe('hola a todos');
    expect(storableLine('!lux hola', '!')).toBeNull();
    expect(storableLine('?clip', '?')).toBeNull();
    expect(storableLine('!sorteo', '?')).toBeNull();
    expect(storableLine('   ', '!')).toBeNull();
    expect(storableLine('a'.repeat(500), '!')).toHaveLength(300);
  });

  it('la lista de bots ignorados es la del script de Python', () => {
    expect(LUX_IGNORE).toEqual(['nightbot', 'streamelements', 'streamlabs', 'moobot', 'fossabot', 'wizebot']);
  });
});

// ---------- Aprender y comentar ----------

describe('aprendizaje del chat y comentarios espontáneos', () => {
  it('con aprendizaje o comentarios activos guarda la línea; los bots solo para el resumen', async () => {
    const made = fakeBackgroundLux({ status: statusOf({ learning: true }) });
    const { instance, input, lines } = background({ lux: made.lux });
    await instance.afterMessage(input(message('buen directo')));
    await instance.afterMessage(input(message('canción del día', { chatterLogin: 'Nightbot', chatterName: 'Nightbot' })));
    await instance.afterMessage(input(message('!hola')));
    expect(lines.rows.map((row) => [row.viewer, row.text, row.spont])).toEqual([
      ['ana', 'buen directo', true],
      ['Nightbot', 'canción del día', false],
    ]);
  });

  it('sin aprendizaje ni comentarios no guarda nada y borra lo que hubiera de antes', async () => {
    const made = fakeBackgroundLux({ status: statusOf() });
    const { instance, input, lines } = background({ lux: made.lux });
    lines.rows.push({ id: 99, profileId: PROFILE, viewer: 'x', text: 'viejo', spont: true, used: false });
    await instance.afterMessage(input(message('hola')));
    expect(lines.rows).toHaveLength(0);
  });

  it('resume cuando toca, con las líneas guardadas, y las borra después', async () => {
    const made = fakeBackgroundLux({ status: statusOf({ learning: true, digestReady: true }) });
    const { instance, input, lines, clock } = background({ lux: made.lux });
    for (let i = 0; i < MIN_DIGEST_LINES + 2; i++) lines.rows.push({ id: i + 1, profileId: PROFILE, viewer: `v${i}`, text: `mensaje ${i}`, spont: true, used: false });
    await instance.afterMessage(input(message('otro más')));
    expect(made.calls.digest).toHaveLength(1);
    expect(made.calls.digest[0]).toHaveLength(MIN_DIGEST_LINES + 3);
    expect(made.calls.digest[0][0]).toEqual({ viewer: 'v0', text: 'mensaje 0' });
    expect(lines.rows).toHaveLength(0);
    void clock;
  });

  it('con pocas líneas no resume ni gasta el turno; si el servidor dice too_soon, las conserva', async () => {
    const few = fakeBackgroundLux({ status: statusOf({ learning: true, digestReady: true }) });
    const a = background({ lux: few.lux });
    await a.instance.afterMessage(a.input(message('uno')));
    expect(few.calls.digest).toHaveLength(0);
    expect(a.lines.rows).toHaveLength(1);

    const soon = fakeBackgroundLux({ status: statusOf({ learning: true, digestReady: true }), digest: async () => ({ status: 200, body: { skipped: 'too_soon', waitSeconds: 60 } }) });
    const b = background({ lux: soon.lux });
    for (let i = 0; i < MIN_DIGEST_LINES; i++) b.lines.rows.push({ id: i + 1, profileId: PROFILE, viewer: 'v', text: `m${i}`, spont: true, used: false });
    await b.instance.afterMessage(b.input(message('otra')));
    expect(b.lines.rows.length).toBe(MIN_DIGEST_LINES + 1);
  });

  it('un fallo al resumir también borra las líneas (como el script, que vacía antes de enviar)', async () => {
    const made = fakeBackgroundLux({ status: statusOf({ learning: true, digestReady: true }), digest: async () => ({ status: 503, body: { error: 'no_key' } }) });
    const { instance, input, lines } = background({ lux: made.lux });
    for (let i = 0; i < MIN_DIGEST_LINES; i++) lines.rows.push({ id: i + 1, profileId: PROFILE, viewer: 'v', text: `m${i}`, spont: true, used: false });
    await instance.afterMessage(input(message('otra')));
    expect(lines.rows).toHaveLength(0);
  });

  it('comenta cuando hay actividad: lo envía por el chat, y esas líneas no cuentan en el siguiente', async () => {
    const made = fakeBackgroundLux({ status: statusOf({ spontaneous: { enabled: true, waitSeconds: 0, minMessages: 5 } }) });
    const { instance, input, lines, net } = background({ lux: made.lux });
    for (let i = 0; i < 5; i++) lines.rows.push({ id: i + 1, profileId: PROFILE, viewer: `v${i}`, text: `m${i}`, spont: true, used: false });
    await instance.afterMessage(input(message('sexta línea')));
    expect(made.calls.spontaneous).toHaveLength(1);
    expect(made.calls.spontaneous[0]).toHaveLength(6);
    expect(net.sent).toEqual([{ broadcaster_id: '100', sender_id: BOT, message: 'Qué buen debate' }]);
    expect(lines.rows.every((row) => row.used)).toBe(true);
    expect(await lines.db.pendingSpontaneous(PROFILE, 40)).toEqual([]);
  });

  it('no comenta con menos líneas que el mínimo del streamer ni con menos de 3, ni si todavía no toca', async () => {
    const few = fakeBackgroundLux({ status: statusOf({ spontaneous: { enabled: true, waitSeconds: 0, minMessages: 10 } }) });
    const a = background({ lux: few.lux });
    for (let i = 0; i < 8; i++) a.lines.rows.push({ id: i + 1, profileId: PROFILE, viewer: 'v', text: `m${i}`, spont: true, used: false });
    await a.instance.afterMessage(a.input(message('una más')));
    expect(few.calls.spontaneous).toHaveLength(0);

    const early = fakeBackgroundLux({ status: statusOf({ spontaneous: { enabled: true, waitSeconds: 300, minMessages: 3 } }) });
    const b = background({ lux: early.lux });
    for (let i = 0; i < 8; i++) b.lines.rows.push({ id: i + 1, profileId: PROFILE, viewer: 'v', text: `m${i}`, spont: true, used: false });
    await b.instance.afterMessage(b.input(message('una más')));
    expect(early.calls.spontaneous).toHaveLength(0);
  });

  it('los mensajes de bots conocidos no cuentan para comentar', async () => {
    const made = fakeBackgroundLux({ status: statusOf({ spontaneous: { enabled: true, waitSeconds: 0, minMessages: 3 } }) });
    const { instance, input, lines } = background({ lux: made.lux });
    for (let i = 0; i < 6; i++) await lines.db.push(PROFILE, 'streamelements', `anuncio ${i}`, false);
    await instance.afterMessage(input(message('hola', { chatterLogin: 'streamelements' })));
    expect(made.calls.spontaneous).toHaveLength(0);
  });

  it('si el servidor no devuelve comentario (too_soon, IA caída) no escribe ni marca las líneas', async () => {
    const made = fakeBackgroundLux({
      status: statusOf({ spontaneous: { enabled: true, waitSeconds: 0, minMessages: 3 } }),
      spontaneous: async () => ({ status: 200, body: { skipped: 'too_soon', waitSeconds: 100 } }),
    });
    const { instance, input, lines, net } = background({ lux: made.lux });
    for (let i = 0; i < 4; i++) lines.rows.push({ id: i + 1, profileId: PROFILE, viewer: 'v', text: `m${i}`, spont: true, used: false });
    await instance.afterMessage(input(message('otra')));
    expect(net.sent).toHaveLength(0);
    expect(lines.rows.some((row) => row.used)).toBe(false);
  });

  it('el estado del perfil se lee una vez por ventana y las decisiones solo al renovarlo', async () => {
    const made = fakeBackgroundLux({ status: statusOf({ learning: true }) });
    const { instance, input, clock } = background({ lux: made.lux });
    await instance.afterMessage(input(message('a')));
    await instance.afterMessage(input(message('b')));
    clock.now += STATUS_TTL_MS - 1;
    await instance.afterMessage(input(message('c')));
    expect(made.calls.status).toBe(1);
    clock.now += 2;
    await instance.afterMessage(input(message('d')));
    expect(made.calls.status).toBe(2);
  });

  it('sin base de líneas, sin estado o con errores, no lanza y no escribe', async () => {
    const none = background({ lux: fakeBackgroundLux({ status: null }).lux });
    await expect(none.instance.afterMessage(none.input(message('hola')))).resolves.toBeUndefined();
    expect(none.lines.rows).toHaveLength(0);

    const broken: ChatLinesDb = { ...memoryLines().db, push: async () => Promise.reject(new Error('boom con texto secreto')) };
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const made = fakeBackgroundLux({ status: statusOf({ learning: true }) });
    const bad = background({ lux: made.lux, lines: broken });
    await expect(bad.instance.afterMessage(bad.input(message('hola')))).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();

    const noLines = createChatBackground({ lux: made.lux, lines: () => null, limiter: () => openLimiter });
    await expect(noLines.afterMessage({ event: message('hola'), env, profileId: PROFILE, prefix: '!', botUserId: BOT })).resolves.toBeUndefined();
  });

  it('un mensaje de la propia cuenta del bot no se guarda', async () => {
    const made = fakeBackgroundLux({ status: statusOf({ learning: true }) });
    const { instance, input, lines } = background({ lux: made.lux });
    await instance.afterMessage(input(message('hola', { chatterId: BOT })));
    expect(lines.rows).toHaveLength(0);
  });
});

// ---------- Cola de mensajes con cada mensaje del chat ----------

describe('red de seguridad de la cola, con cada mensaje', () => {
  it('vacía la cola enviando por el chat y no más de una vez cada pocos segundos', async () => {
    const outbox = vi.fn(async (_id: string, send: (text: string) => Promise<boolean>) => {
      const ok = await send('mensaje del panel');
      return { sent: ok ? 1 : 0, failed: ok ? 0 : 1 };
    });
    const made = fakeBackgroundLux({ outbox });
    const { instance, input, clock, net } = background({ lux: made.lux });
    await instance.afterMessage(input(message('a')));
    await instance.afterMessage(input(message('b')));
    expect(outbox).toHaveBeenCalledTimes(1);
    expect(net.sent).toEqual([{ broadcaster_id: '100', sender_id: BOT, message: 'mensaje del panel' }]);
    clock.now += OUTBOX_GAP_MS;
    await instance.afterMessage(input(message('c')));
    expect(outbox).toHaveBeenCalledTimes(2);
  });

  it('si Twitch rechaza el envío, send devuelve false (el mensaje quedará como fallido)', async () => {
    let result: boolean | null = null;
    const made = fakeBackgroundLux({
      outbox: async (_id, send) => {
        result = await send('hola');
        return { sent: 0, failed: 1 };
      },
    });
    const net = fakeFetch(() => json({}, 403));
    const { instance, input } = background({ lux: made.lux, deps: { fetch: net.fetch } });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await instance.afterMessage(input(message('a')));
    expect(result).toBe(false);
  });
});

// ---------- Procesador: el trabajo de fondo se engancha ----------

describe('chatProcessor llama al trabajo de fondo', () => {
  const on: BotSettings = { ...DEFAULT_BOT_SETTINGS, enabled: true };
  function setup(settings: BotSettings | null, extra: Partial<Parameters<typeof createChatProcessor>[0]> = {}) {
    const afterMessage = vi.fn(async () => undefined);
    const db = { settings: async () => settings, commands: async () => [], takeCooldown: async () => ({ ok: true }) } as unknown as BotDb;
    const lux: ChatLux = { settings: async () => null, ask: async () => ({ status: 200, body: {} }), setEnabled: async () => true };
    const handler = createChatProcessor({
      db: () => db,
      profileId: async () => PROFILE,
      limiter: () => openLimiter,
      lux,
      fetch: fakeFetch().fetch,
      background: { afterMessage },
      ...extra,
    });
    return { handler, afterMessage };
  }

  it('después de cada mensaje de un canal con el bot encendido, comando o no', async () => {
    const { handler, afterMessage } = setup(on);
    await handler(message('charla normal'), env);
    await handler(message('!comando'), env);
    expect(afterMessage).toHaveBeenCalledTimes(2);
    expect(afterMessage).toHaveBeenCalledWith(expect.objectContaining({ profileId: PROFILE, prefix: '!', botUserId: BOT }));
  });

  it('no con el bot apagado, ni de modo «streamer», ni con un mensaje del propio bot', async () => {
    const off = setup({ ...on, enabled: false });
    await off.handler(message('hola'), env);
    const streamer = setup({ ...on, senderMode: 'streamer' });
    await streamer.handler(message('hola'), env);
    const own = setup(on);
    await own.handler(message('hola', { chatterId: BOT }), env);
    const none = setup(null);
    await none.handler(message('hola'), env);
    expect(off.afterMessage).not.toHaveBeenCalled();
    expect(streamer.afterMessage).not.toHaveBeenCalled();
    expect(own.afterMessage).not.toHaveBeenCalled();
    expect(none.afterMessage).not.toHaveBeenCalled();
  });

  it('aunque falle la respuesta, el trabajo de fondo sigue; y si falla el fondo, el procesador no lanza', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { handler, afterMessage } = setup(on, { lux: { settings: async () => Promise.reject(new Error('x')), ask: vi.fn(), setEnabled: vi.fn() } });
    await handler(message('!lux hola'), env);
    expect(afterMessage).toHaveBeenCalledTimes(1);
    const failing = setup(on, { background: { afterMessage: async () => Promise.reject(new Error('fondo')) } });
    await expect(failing.handler(message('hola'), env)).resolves.toBeUndefined();
  });
});

// ---------- Mi AI: funciones del servidor sin HTTP ----------

const streamerProfile: LuxProfile = { id: PROFILE, role: 'streamer', luxEnabled: true };

function memoryLuxDb(profile: LuxProfile = streamerProfile, now: () => number = () => T0) {
  const settings = new Map<string, string>();
  const rows = new Map<string, Record<string, unknown>>();
  const speech: LuxSpeechRow[] = [];
  const outbox: LuxOutboxItem[] = [];
  let nextId = 1;
  const db: LuxDb = {
    async setting(key) {
      return settings.get(key) ?? null;
    },
    async putSetting(key, value) {
      if (value === null) settings.delete(key);
      else settings.set(key, value);
    },
    async profile(id) {
      return id === profile.id ? profile : null;
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
      speech.push(row);
    },
    async outboxInsert(row: LuxOutboxRow) {
      const id = nextId++;
      outbox.push({ id, text: row.text, speak: row.speak, emotion: row.emotion, mode: row.mode, status: 'pending', createdAt: new Date(now()).toISOString(), claimedAt: null, sentAt: null });
      return id;
    },
    async outboxList(_profileId, limit) {
      return [...outbox].reverse().slice(0, limit);
    },
    async outboxClaim(_profileId, limit, nowIso) {
      const taken = outbox.filter((item) => item.status === 'pending').slice(0, limit);
      for (const item of taken) {
        item.status = 'claimed';
        item.claimedAt = nowIso;
      }
      return taken.map((item) => ({ ...item }));
    },
    async outboxRelease(_profileId, id) {
      const item = outbox.find((entry) => entry.id === id && entry.status === 'claimed');
      if (!item) return false;
      item.status = 'pending';
      item.claimedAt = null;
      return true;
    },
    async outboxFinish(_profileId, id, ok, nowIso) {
      const item = outbox.find((entry) => entry.id === id && entry.status === 'claimed');
      if (!item) return false;
      item.status = ok ? 'sent' : 'failed';
      item.sentAt = nowIso;
      return true;
    },
  };
  const configure = (patch: Partial<LuxSettings>) => rows.set(profile.id, rowFromSettings(profile.id, { ...DEFAULT_LUX_SETTINGS, ...patch }));
  const queue = (text: string, speak = false) => db.outboxInsert!({ profile_id: profile.id, text, speak, emotion: 'normal', mode: 'literal' });
  return { db, settings, speech, outbox, configure, queue };
}

describe('luxOutboxForProfile: la cola enviada por el servidor', () => {
  it('envía lo pendiente y lo marca como enviado o fallido según el resultado', async () => {
    const made = memoryLuxDb();
    await made.queue('uno');
    await made.queue('dos');
    const send = vi.fn(async (text: string) => text === 'uno');
    const result = await luxOutboxForProfile(PROFILE, send, {}, { db: () => made.db, now: () => T0 });
    expect(result).toEqual({ sent: 1, failed: 1 });
    expect(send.mock.calls.map((call) => call[0])).toEqual(['uno', 'dos']);
    expect(made.outbox.map((item) => item.status)).toEqual(['sent', 'failed']);
  });

  it('no envía dos veces el mismo mensaje y deja la voz para OBS cuando se pidió', async () => {
    const made = memoryLuxDb();
    await made.queue('con voz', true);
    const send = vi.fn(async () => true);
    await luxOutboxForProfile(PROFILE, send, {}, { db: () => made.db, now: () => T0 });
    await luxOutboxForProfile(PROFILE, send, {}, { db: () => made.db, now: () => T0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(made.speech).toHaveLength(1);
  });

  it('un send que lanza deja el mensaje como fallido y sigue con el siguiente', async () => {
    const made = memoryLuxDb();
    await made.queue('a');
    await made.queue('b');
    const send = vi.fn(async (text: string) => {
      if (text === 'a') throw new Error('red');
      return true;
    });
    expect(await luxOutboxForProfile(PROFILE, send, {}, { db: () => made.db, now: () => T0 })).toEqual({ sent: 1, failed: 1 });
    expect(made.outbox.map((item) => item.status)).toEqual(['failed', 'sent']);
  });

  it('sin Mi AI en la cuenta, sin perfil o sin base de datos no envía nada ni lanza', async () => {
    const off = memoryLuxDb({ id: PROFILE, role: 'streamer', luxEnabled: false });
    await off.queue('hola');
    const send = vi.fn(async () => true);
    expect(await luxOutboxForProfile(PROFILE, send, {}, { db: () => off.db })).toEqual({ sent: 0, failed: 0 });
    expect(await luxOutboxForProfile('otro', send, {}, { db: () => off.db })).toEqual({ sent: 0, failed: 0 });
    expect(await luxOutboxForProfile(PROFILE, send, {}, { db: () => null })).toEqual({ sent: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(off.outbox[0].status).toBe('pending');
  });

  it('un saludo de seguidor que aún no está listo (el grupo se calma 15 s) no sale todavía', async () => {
    const made = memoryLuxDb();
    made.configure({ eventFollow: true });
    made.settings.set(`lux_event_follow:${PROFILE}`, JSON.stringify({ first: T0, last: T0, count: 1, names: ['nuevo'] }));
    const send = vi.fn(async () => true);
    await luxOutboxForProfile(PROFILE, send, {}, { db: () => made.db, now: () => T0 + 5_000 });
    expect(send).not.toHaveBeenCalled();
    expect(made.settings.get(`lux_event_follow:${PROFILE}`)).toBeTruthy();
  });
});

describe('luxProactiveStatusForProfile y las acciones sin HTTP', () => {
  it('resume ajustes e intervalos: aprendizaje, turno del resumen y comentarios', async () => {
    const made = memoryLuxDb();
    made.configure({ chatLearning: true, spontaneousEveryMin: 15, spontaneousMinMessages: 5 });
    const now = () => T0;
    expect(await luxProactiveStatusForProfile(PROFILE, {}, { db: () => made.db, now })).toEqual({
      allowed: true,
      learning: true,
      digestReady: true,
      spontaneous: { enabled: true, waitSeconds: 0, minMessages: 5 },
    });
    made.settings.set(`lux_spontaneous:${PROFILE}`, String(T0 - 5 * 60_000));
    made.settings.set(`lux_digest:${PROFILE}`, String(T0 - 60_000));
    const waiting = await luxProactiveStatusForProfile(PROFILE, {}, { db: () => made.db, now });
    expect(waiting?.spontaneous.waitSeconds).toBe(600);
    expect(waiting?.digestReady).toBe(false);
  });

  it('apagado en los ajustes, o sin Lux en la cuenta, nada está habilitado; sin base de datos, null', async () => {
    const made = memoryLuxDb();
    made.configure({ chatLearning: false, spontaneousEnabled: false });
    expect(await luxProactiveStatusForProfile(PROFILE, {}, { db: () => made.db })).toMatchObject({ learning: false, spontaneous: { enabled: false } });
    const noLux = memoryLuxDb({ id: PROFILE, role: 'streamer', luxEnabled: false });
    noLux.configure({ chatLearning: true });
    expect(await luxProactiveStatusForProfile(PROFILE, {}, { db: () => noLux.db })).toMatchObject({ allowed: false, learning: false, spontaneous: { enabled: false } });
    expect(await luxProactiveStatusForProfile(PROFILE, {}, { db: () => null })).toBeNull();
  });

  it('luxSpontaneousForProfile hace el mismo comentario que la ruta, con su intervalo', async () => {
    const vault = { INTEGRATIONS_ENC_KEY: randomBytes(32).toString('base64url') };
    const made = memoryLuxDb();
    made.configure({});
    await handleLux('key', { method: 'POST', headers: {}, query: {}, body: { apiKey: 'nvapi-abcdefghijklmnop1234' } } as IntegrationRequest, vault, {
      auth: async () => ({ id: 'a1', role: 'admin', status: 'active' }),
      db: () => made.db,
    });
    const calls: unknown[] = [];
    const ai = (async (_url: unknown, init?: { body?: unknown }) => {
      calls.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Qué buen ambiente [alegre]' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const lines = Array.from({ length: 10 }, (_, i) => ({ viewer: `v${i}`, text: `mensaje ${i}` }));
    const deps = { db: () => made.db, fetch: ai, now: () => T0 };
    const first = await luxSpontaneousForProfile(PROFILE, lines, vault, deps);
    expect(first.body).toMatchObject({ reply: 'Qué buen ambiente', emotion: 'alegre' });
    expect(made.speech).toHaveLength(1);
    const second = await luxSpontaneousForProfile(PROFILE, lines, vault, deps);
    expect(second.body).toMatchObject({ skipped: 'too_soon' });
    expect(calls).toHaveLength(1);
  });

  it('luxDigestForProfile respeta el ajuste de aprender del chat', async () => {
    const made = memoryLuxDb();
    made.configure({ chatLearning: false });
    const res = await luxDigestForProfile(PROFILE, [{ viewer: 'a', text: 'hola' }], {}, { db: () => made.db, now: () => T0 });
    expect(res.body).toEqual({ skipped: 'learning_off' });
  });
});

// ---------- (a) Enviar en cuanto se encola ----------

describe('pushOutboxNow: enviar ya, solo con el bot en la nube', () => {
  function pushDeps(settings: BotSettings | null, outbox = vi.fn(async (_id: string, send: (t: string) => Promise<boolean>) => ({ sent: (await send('hola')) ? 1 : 0, failed: 0 }))) {
    const net = fakeFetch();
    const db = { settings: async () => settings } as unknown as BotDb;
    const made = fakeBackgroundLux({ outbox });
    return {
      outbox,
      net,
      deps: { db: () => db, twitchUserId: async () => '100', limiter: () => openLimiter, lux: made.lux, fetch: net.fetch, sleep: async () => undefined } satisfies BackgroundDeps,
    };
  }

  it('con el bot en la nube encendido envía la cola al canal del streamer', async () => {
    const { deps, net, outbox } = pushDeps({ ...DEFAULT_BOT_SETTINGS, enabled: true });
    await pushOutboxNow(PROFILE, env, deps);
    expect(outbox).toHaveBeenCalledTimes(1);
    expect(net.sent).toEqual([{ broadcaster_id: '100', sender_id: BOT, message: 'hola' }]);
  });

  it('apagado, modo «streamer», sin ajustes o sin cuenta de bot: no toca la cola (sigue siendo del bot de Python)', async () => {
    for (const settings of [{ ...DEFAULT_BOT_SETTINGS, enabled: false }, { ...DEFAULT_BOT_SETTINGS, enabled: true, senderMode: 'streamer' as const }, null]) {
      const { deps, outbox } = pushDeps(settings);
      await pushOutboxNow(PROFILE, env, deps);
      expect(outbox).not.toHaveBeenCalled();
    }
    const { deps, outbox } = pushDeps({ ...DEFAULT_BOT_SETTINGS, enabled: true });
    await pushOutboxNow(PROFILE, { ...env, TWITCH_BOT_USER_ID: '' }, deps);
    expect(outbox).not.toHaveBeenCalled();
  });

  it('un canal sin id de Twitch o un fallo de la base no lanza', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const noChannel = pushDeps({ ...DEFAULT_BOT_SETTINGS, enabled: true });
    await expect(pushOutboxNow(PROFILE, env, { ...noChannel.deps, twitchUserId: async () => null })).resolves.toBeUndefined();
    expect(noChannel.outbox).not.toHaveBeenCalled();
    await expect(pushOutboxNow(PROFILE, env, { ...noChannel.deps, db: () => ({ settings: async () => Promise.reject(new Error('caída')) }) as unknown as BotDb })).resolves.toBeUndefined();
  });

  it('el limitador sigue mandando: sin hueco, el mensaje no sale', async () => {
    const closed: SendLimiter = { take: async () => ({ ok: false, waitMs: 20_000, scope: 'account' }) };
    const { deps, net } = pushDeps({ ...DEFAULT_BOT_SETTINGS, enabled: true });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await pushOutboxNow(PROFILE, env, { ...deps, limiter: () => closed });
    expect(net.sent).toHaveLength(0);
    void createMemoryLimiter;
  });
});

describe('el panel dispara el envío al encolar (ruta say)', () => {
  const post = (body: unknown): IntegrationRequest => ({ method: 'POST', headers: {}, query: {}, body });
  const asStreamer = async () => ({ id: PROFILE, role: 'streamer', status: 'active' });

  it('llama a afterEnqueue con el perfil, tras guardar el mensaje', async () => {
    const made = memoryLuxDb();
    const afterEnqueue = vi.fn(async () => undefined);
    const res = await handleLux('say', post({ mode: 'literal', text: 'Hola chat' }), {}, { auth: asStreamer, db: () => made.db, afterEnqueue, now: () => T0, sayCooldown: new LuxCooldown() });
    expect(res.status).toBe(200);
    expect(made.outbox[0].text).toBe('Hola chat');
    expect(afterEnqueue).toHaveBeenCalledWith(PROFILE, {});
  });

  it('si afterEnqueue falla, el panel recibe igualmente su respuesta', async () => {
    const made = memoryLuxDb();
    const afterEnqueue = vi.fn(async () => Promise.reject(new Error('Twitch caído')));
    const res = await handleLux('say', post({ mode: 'literal', text: 'Hola chat' }), {}, { auth: asStreamer, db: () => made.db, afterEnqueue, now: () => T0, sayCooldown: new LuxCooldown() });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: 'queued' });
  });

  it('un mensaje rechazado (vacío) no dispara el envío', async () => {
    const made = memoryLuxDb();
    const afterEnqueue = vi.fn(async () => undefined);
    const res = await handleLux('say', post({ mode: 'literal', text: '   ' }), {}, { auth: asStreamer, db: () => made.db, afterEnqueue, now: () => T0, sayCooldown: new LuxCooldown() });
    expect(res.status).toBe(400);
    expect(afterEnqueue).not.toHaveBeenCalled();
  });
});

// ---------- Endurecimiento: candados, borrado parcial, cola y salida de la IA ----------

describe('candados entre instancias y borrado parcial de líneas', () => {
  it('el resumen toma un candado en la base de datos y, si no lo concede, no llama a la IA', async () => {
    const made = fakeBackgroundLux({ status: statusOf({ learning: true, digestReady: true }) });
    const { instance, input, lines, cooldowns } = background({ lux: made.lux });
    for (let i = 0; i < MIN_DIGEST_LINES; i++) lines.rows.push({ id: i + 1, profileId: PROFILE, viewer: 'v', text: `m${i}`, spont: true, used: false });
    // Otra instancia ya lo tiene
    cooldowns.until.set(`${PROFILE}|_|digest`, T0 + 60_000);
    await instance.afterMessage(input(message('otra')));
    expect(made.calls.digest).toHaveLength(0);
    expect(lines.rows).toHaveLength(MIN_DIGEST_LINES + 1);
    expect(cooldowns.takes).toContain(`${PROFILE}|_|digest`);
  });

  it('el comentario espontáneo también toma su candado', async () => {
    const made = fakeBackgroundLux({ status: statusOf({ spontaneous: { enabled: true, waitSeconds: 0, minMessages: 3 } }) });
    const { instance, input, lines, cooldowns, net } = background({ lux: made.lux });
    for (let i = 0; i < 5; i++) lines.rows.push({ id: i + 1, profileId: PROFILE, viewer: 'v', text: `m${i}`, spont: true, used: false });
    cooldowns.until.set(`${PROFILE}|_|spont`, T0 + 30_000);
    await instance.afterMessage(input(message('sexta')));
    expect(made.calls.spontaneous).toHaveLength(0);
    expect(net.sent).toHaveLength(0);
  });

  it('sin base de datos para el candado no se llama a la IA (mejor callar que duplicar)', async () => {
    const made = fakeBackgroundLux({ status: statusOf({ learning: true, digestReady: true }) });
    const { instance, input, lines } = background({ lux: made.lux, deps: { db: () => null } });
    for (let i = 0; i < MIN_DIGEST_LINES; i++) lines.rows.push({ id: i + 1, profileId: PROFILE, viewer: 'v', text: `m${i}`, spont: true, used: false });
    await instance.afterMessage(input(message('otra')));
    expect(made.calls.digest).toHaveLength(0);
  });

  it('tras resumir borra solo hasta el id leído: lo que llegó mientras la IA pensaba se queda', async () => {
    let arrive: (() => void) | null = null;
    const made = fakeBackgroundLux({
      status: statusOf({ learning: true, digestReady: true }),
      digest: async () => {
        arrive?.();
        return { status: 200, body: { learned: 1 } };
      },
    });
    const { instance, input, lines } = background({ lux: made.lux });
    for (let i = 0; i < MIN_DIGEST_LINES; i++) lines.rows.push({ id: i + 1, profileId: PROFILE, viewer: 'v', text: `m${i}`, spont: true, used: false });
    arrive = () => {
      lines.rows.push({ id: 500, profileId: PROFILE, viewer: 'tarde', text: 'llegó durante el resumen', spont: true, used: false });
    };
    await instance.afterMessage(input(message('otra')));
    expect(lines.rows.map((row) => row.id)).toEqual([500]);
  });

  it('con los comentarios activos conserva las líneas que el comentario aún no ha contado; con ellos apagados las borra', async () => {
    const lineSet = (rows: ReturnType<typeof memoryLines>['rows']) => {
      for (let i = 0; i < MIN_DIGEST_LINES; i++) rows.push({ id: i + 1, profileId: PROFILE, viewer: 'v', text: `m${i}`, spont: i % 2 === 0, used: i === 0 });
    };
    // Comentarios activos pero aún no toca (waitSeconds > 0): solo se resume
    const on = fakeBackgroundLux({ status: statusOf({ learning: true, digestReady: true, spontaneous: { enabled: true, waitSeconds: 600, minMessages: 3 } }) });
    const a = background({ lux: on.lux });
    lineSet(a.lines.rows);
    await a.instance.afterMessage(a.input(message('otra')));
    // Quedan las spont=true y sin usar (ids pares-1: 3, 5, 7, 9 -> i = 2, 4, 6, 8) y la línea nueva
    expect(a.lines.rows.filter((row) => row.viewer === 'v').map((row) => row.id)).toEqual([3, 5, 7, 9]);

    const off = fakeBackgroundLux({ status: statusOf({ learning: true, digestReady: true }) });
    const b = background({ lux: off.lux });
    lineSet(b.lines.rows);
    await b.instance.afterMessage(b.input(message('otra')));
    expect(b.lines.rows.filter((row) => row.viewer === 'v')).toEqual([]);
  });
});

describe('salida de la IA y cola perdida', () => {
  it('el comentario espontáneo sale sin enlaces ni menciones', async () => {
    const made = fakeBackgroundLux({
      status: statusOf({ spontaneous: { enabled: true, waitSeconds: 0, minMessages: 3 } }),
      spontaneous: async () => ({ status: 200, body: { reply: 'Mirad www.estafa.com y @todos, qué buen directo https://x.tv/y' } }),
    });
    const { instance, input, lines, net } = background({ lux: made.lux });
    for (let i = 0; i < 5; i++) lines.rows.push({ id: i + 1, profileId: PROFILE, viewer: 'v', text: `m${i}`, spont: true, used: false });
    await instance.afterMessage(input(message('sexta')));
    expect(net.sent).toHaveLength(1);
    expect(net.sent[0].message).toBe('Mirad y todos, qué buen directo');
  });

  it('si el comentario queda vacío tras el filtro no se envía nada', async () => {
    const made = fakeBackgroundLux({
      status: statusOf({ spontaneous: { enabled: true, waitSeconds: 0, minMessages: 3 } }),
      spontaneous: async () => ({ status: 200, body: { reply: 'https://spam.example.com' } }),
    });
    const { instance, input, lines, net } = background({ lux: made.lux });
    for (let i = 0; i < 5; i++) lines.rows.push({ id: i + 1, profileId: PROFILE, viewer: 'v', text: `m${i}`, spont: true, used: false });
    await instance.afterMessage(input(message('sexta')));
    expect(net.sent).toHaveLength(0);
  });

  it('pushOutboxNow: un envío limitado (rate_limited sin nada enviado) pide reintento; uno fallido no', async () => {
    let outcomes: Array<boolean | 'retry'> = [];
    const lux = fakeBackgroundLux({
      outbox: async (_id, send) => {
        outcomes.push(await send('uno'));
        return { sent: 0, failed: 0 };
      },
    }).lux;
    const settings = (): Promise<BotSettings> => Promise.resolve({ ...DEFAULT_BOT_SETTINGS, enabled: true });
    const base = {
      lux,
      db: () => ({ settings }) as unknown as BotDb,
      twitchUserId: async () => '100',
      sleep: async () => undefined,
      now: () => T0,
    };
    const closed: SendLimiter = { take: async () => ({ ok: false, waitMs: 20_000, scope: 'account' }) };
    await pushOutboxNow(PROFILE, env, { ...base, limiter: () => closed, fetch: fakeFetch().fetch });
    const forbidden = fakeFetch(() => json({}, 403));
    await pushOutboxNow(PROFILE, env, { ...base, limiter: () => openLimiter, fetch: forbidden.fetch });
    const ok = fakeFetch();
    await pushOutboxNow(PROFILE, env, { ...base, limiter: () => openLimiter, fetch: ok.fetch });
    expect(outcomes).toEqual(['retry', false, true]);
  });

  it('luxOutboxForProfile: un «retry» devuelve el mensaje a pending (sin contarlo ni dar voz) y sale en el siguiente turno', async () => {
    const made = memoryLuxDb();
    await made.queue('con voz', true);
    let first = true;
    const send = vi.fn(async () => {
      if (first) {
        first = false;
        return 'retry' as const;
      }
      return true;
    });
    const one = await luxOutboxForProfile(PROFILE, send, {}, { db: () => made.db, now: () => T0 });
    expect(one).toEqual({ sent: 0, failed: 0 });
    expect(made.outbox[0].status).toBe('pending');
    expect(made.speech).toHaveLength(0);
    const two = await luxOutboxForProfile(PROFILE, send, {}, { db: () => made.db, now: () => T0 + 5_000 });
    expect(two).toEqual({ sent: 1, failed: 0 });
    expect(made.outbox[0].status).toBe('sent');
    expect(made.speech).toHaveLength(1);
  });

  it('los «claimed» de hace más de 2 minutos se reclaman de nuevo (filtro de luxDb.outboxClaim)', () => {
    const filter = outboxClaimable('2026-10-25T12:00:00.000Z');
    expect(filter).toBe('status.eq.pending,and(status.eq.claimed,claimed_at.lt.2026-10-25T11:58:00.000Z)');
    expect(OUTBOX_RECLAIM_MS).toBe(120_000);
  });
});
