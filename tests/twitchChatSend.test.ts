/**
 * tests/twitchChatSend.test.ts
 *
 * Envío al chat de Twitch desde el servidor: partición igual que split_message de Python,
 * limpieza de / y . iniciales, limitador (canal y cuenta), renovación única del token en
 * 401, errores tipados y que ningún token se filtre al resultado ni a los logs.
 * El fetch es falso: nada de esto se ha probado contra Twitch real.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetClipState } from '../server/twitch/clips';
import {
  createMemoryLimiter,
  prepareChatParts,
  sendChatMessage,
  splitChatMessage,
  type SendLimiter,
} from '../server/twitch/chatSend';

const TOKEN = 'SECRETTOKEN123';
const SECRET = 'csecret-xyz';
const env = { TWITCH_CLIENT_ID: 'cid', TWITCH_CLIENT_SECRET: SECRET };

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const okMessage = (id: string) => json({ data: [{ message_id: id, is_sent: true }] });

interface Call {
  url: string;
  init: RequestInit;
}

/** fetch falso: el token siempre sale bien; cada envío consume la siguiente respuesta. */
function fakeFetch(chat: Array<() => Response | Promise<Response>>) {
  const posts: Call[] = [];
  const tokens: Call[] = [];
  let next = 0;
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    if (target.startsWith('https://id.twitch.tv/oauth2/token')) {
      tokens.push({ url: target, init: init ?? {} });
      return json({ access_token: TOKEN, expires_in: 3600 });
    }
    posts.push({ url: target, init: init ?? {} });
    const answer = chat[Math.min(next++, chat.length - 1)];
    return answer();
  });
  return { fetch: impl as unknown as typeof fetch, posts, tokens };
}

const bodyOf = (call: Call) => JSON.parse(String(call.init.body)) as Record<string, string>;
const sleep = vi.fn(async () => {});
const allow: SendLimiter = { take: async () => ({ ok: true }) };

const base = (extra: Partial<Parameters<typeof sendChatMessage>[0]> & { fetch: typeof fetch }) => ({
  env,
  botUserId: 'bot1',
  broadcasterId: 'canal1',
  text: 'hola',
  limiter: allow,
  now: () => 1_000_000,
  sleep,
  ...extra,
});

beforeEach(() => {
  resetClipState();
  sleep.mockClear();
});

describe('splitChatMessage (misma lógica que split_message de Python)', () => {
  it('un texto corto queda en un solo trozo y colapsa los espacios', () => {
    expect(splitChatMessage('  hola   mundo \n qué tal ')).toEqual(['hola mundo qué tal']);
  });

  it('un texto vacío no da trozos', () => {
    expect(splitChatMessage('   ')).toEqual([]);
  });

  it('corta en el último fin de frase o espacio que cabe', () => {
    expect(splitChatMessage('Hola mundo. Esto es una prueba larga', 20)).toEqual(['Hola mundo.', 'Esto es una prueba', 'larga']);
  });

  it('con el límite exacto no corta', () => {
    expect(splitChatMessage('a'.repeat(20), 20)).toEqual(['a'.repeat(20)]);
  });

  it('sin separadores corta en seco', () => {
    expect(splitChatMessage('x'.repeat(25), 10)).toEqual(['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)]);
  });

  it('ignora un separador en el primer tercio y corta en seco', () => {
    expect(splitChatMessage('ab cdefghijklmnopqrstuvwxyz', 12)).toEqual(['ab cdefghijk', 'lmnopqrstuvw', 'xyz']);
  });

  it('prefiere el separador de frase sobre el espacio', () => {
    expect(splitChatMessage('uno dos tres. cuatro cinco seis', 25)).toEqual(['uno dos tres.', 'cuatro cinco seis']);
  });

  it('con el límite por defecto ningún trozo pasa de 500', () => {
    const parts = splitChatMessage('palabra '.repeat(200));
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(500);
  });

  it('no parte un emoji por la mitad al cortar en seco', () => {
    const parts = splitChatMessage('😀'.repeat(6), 5);
    for (const part of parts) expect(part).toMatch(/^(😀)+$/);
  });
});

describe('prepareChatParts', () => {
  it('quita las / . y espacios iniciales de cada trozo', () => {
    expect(prepareChatParts('/ban alguien')).toEqual(['ban alguien']);
    expect(prepareChatParts('.timeout x')).toEqual(['timeout x']);
    expect(prepareChatParts('./. hola')).toEqual(['hola']);
  });

  it('descarta los trozos que se quedan vacíos', () => {
    expect(prepareChatParts('/// ...')).toEqual([]);
  });
});

describe('createMemoryLimiter', () => {
  it('canal: 1 mensaje por segundo', async () => {
    const limiter = createMemoryLimiter();
    expect(await limiter.take('b', 'c', 1000)).toEqual({ ok: true });
    expect(await limiter.take('b', 'c', 1400)).toEqual({ ok: false, waitMs: 600, scope: 'channel' });
    expect(await limiter.take('b', 'otro', 1400)).toEqual({ ok: true });
    expect(await limiter.take('b', 'c', 2000)).toEqual({ ok: true });
  });

  it('canal: como mucho 6 mensajes en 30 s aunque pasen más de 1 segundo entre ellos', async () => {
    const limiter = createMemoryLimiter();
    for (let i = 0; i < 6; i++) expect(await limiter.take('b', 'c', 1000 + i * 1100)).toEqual({ ok: true });
    expect(await limiter.take('b', 'c', 8000)).toMatchObject({ ok: false, scope: 'channel' });
    expect(await limiter.take('b', 'otro', 8000)).toEqual({ ok: true });
    expect(await limiter.take('b', 'c', 31_100)).toEqual({ ok: true });
  });

  it('cuenta: 20 cada 30 s sumando los canales', async () => {
    const limiter = createMemoryLimiter();
    for (let i = 0; i < 20; i++) expect(await limiter.take('b', `c${i}`, 1000)).toEqual({ ok: true });
    expect(await limiter.take('b', 'nuevo', 11_000)).toEqual({ ok: false, waitMs: 20_000, scope: 'account' });
    expect(await limiter.take('b', 'nuevo', 31_000)).toEqual({ ok: true });
  });

  it('un rechazo no cuenta como envío', async () => {
    const limiter = createMemoryLimiter();
    await limiter.take('b', 'c', 1000);
    await limiter.take('b', 'c', 1100);
    expect(await limiter.take('b', 'c', 2000)).toEqual({ ok: true });
  });

  it('moderador: 100 cada 30 s', async () => {
    const limiter = createMemoryLimiter({ moderator: true });
    for (let i = 0; i < 100; i++) expect(await limiter.take('b', `c${i}`, 1000)).toEqual({ ok: true });
    expect(await limiter.take('b', 'nuevo', 1000)).toMatchObject({ ok: false, scope: 'account' });
  });

  it('las cuentas no se mezclan', async () => {
    const limiter = createMemoryLimiter();
    for (let i = 0; i < 20; i++) await limiter.take('b1', `c${i}`, 1000);
    expect(await limiter.take('b2', 'c', 1000)).toEqual({ ok: true });
  });
});

describe('sendChatMessage', () => {
  it('manda un mensaje con el token de aplicación y devuelve el message_id', async () => {
    const f = fakeFetch([() => okMessage('m1')]);
    const result = await sendChatMessage(base({ fetch: f.fetch, replyTo: 'padre' }));
    expect(result).toEqual({ status: 'sent', messageId: 'm1', messageIds: ['m1'], remaining: [] });
    expect(f.posts).toHaveLength(1);
    expect(f.posts[0].url).toBe('https://api.twitch.tv/helix/chat/messages');
    expect(f.posts[0].init.method).toBe('POST');
    const headers = f.posts[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers['Client-Id']).toBe('cid');
    expect(bodyOf(f.posts[0])).toEqual({ broadcaster_id: 'canal1', sender_id: 'bot1', message: 'hola', reply_parent_message_id: 'padre' });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('sin replyTo no manda reply_parent_message_id', async () => {
    const f = fakeFetch([() => okMessage('m1')]);
    await sendChatMessage(base({ fetch: f.fetch }));
    expect(bodyOf(f.posts[0])).not.toHaveProperty('reply_parent_message_id');
  });

  it('quita la / inicial antes de mandar', async () => {
    const f = fakeFetch([() => okMessage('m1')]);
    await sendChatMessage(base({ fetch: f.fetch, text: '/ban alguien' }));
    expect(bodyOf(f.posts[0]).message).toBe('ban alguien');
  });

  it('parte un texto largo, pausa 1.2 s entre trozos y responde solo en el primero', async () => {
    const f = fakeFetch([() => okMessage('m1'), () => okMessage('m2'), () => okMessage('m3')]);
    const text = 'palabra '.repeat(150); // 1200 caracteres: tres trozos
    const result = await sendChatMessage(base({ fetch: f.fetch, text, replyTo: 'padre' }));
    expect(result).toMatchObject({ status: 'sent', messageId: 'm1', messageIds: ['m1', 'm2', 'm3'], remaining: [] });
    expect(f.posts).toHaveLength(3);
    for (const post of f.posts) expect(bodyOf(post).message.length).toBeLessThanOrEqual(500);
    expect(bodyOf(f.posts[0]).reply_parent_message_id).toBe('padre');
    expect(bodyOf(f.posts[1])).not.toHaveProperty('reply_parent_message_id');
    expect(sleep.mock.calls.map((call) => (call as unknown[])[0])).toEqual([1200, 1200]);
  });

  it('la pausa entre trozos es configurable', async () => {
    const f = fakeFetch([() => okMessage('m1')]);
    await sendChatMessage(base({ fetch: f.fetch, text: 'a'.repeat(600), pauseMs: 5 }));
    expect(sleep).toHaveBeenCalledWith(5);
  });

  it('en 401 renueva el token una sola vez y reintenta', async () => {
    const f = fakeFetch([() => json({}, 401), () => okMessage('m1')]);
    const result = await sendChatMessage(base({ fetch: f.fetch }));
    expect(result.status).toBe('sent');
    expect(f.tokens).toHaveLength(2);
    expect(f.posts).toHaveLength(2);
  });

  it('si el 401 persiste tras renovar, auth_failed sin más reintentos', async () => {
    const f = fakeFetch([() => json({}, 401)]);
    const result = await sendChatMessage(base({ fetch: f.fetch }));
    expect(result).toEqual({ status: 'auth_failed', messageIds: [], remaining: ['hola'] });
    expect(f.tokens).toHaveLength(2);
    expect(f.posts).toHaveLength(2);
  });

  it('si Twitch rechaza el Client Secret, auth_failed', async () => {
    const fetchFn = vi.fn(async () => json({}, 401)) as unknown as typeof fetch;
    const result = await sendChatMessage(base({ fetch: fetchFn }));
    expect(result.status).toBe('auth_failed');
  });

  it('403 es no_permission', async () => {
    const f = fakeFetch([() => json({ message: 'no' }, 403)]);
    expect(await sendChatMessage(base({ fetch: f.fetch }))).toEqual({ status: 'no_permission', messageIds: [], remaining: ['hola'] });
  });

  it('429 es rate_limited y usa Ratelimit-Reset', async () => {
    const f = fakeFetch([() => json({}, 429, { 'Ratelimit-Reset': '1005' })]);
    const result = await sendChatMessage(base({ fetch: f.fetch, now: () => 1_000_000 }));
    expect(result).toMatchObject({ status: 'rate_limited', scope: 'twitch', waitMs: 5000, remaining: ['hola'] });
  });

  it('429 sin cabecera espera 1 s', async () => {
    const f = fakeFetch([() => json({}, 429)]);
    expect(await sendChatMessage(base({ fetch: f.fetch }))).toMatchObject({ status: 'rate_limited', waitMs: 1000 });
  });

  it('422 es too_long', async () => {
    const f = fakeFetch([() => json({}, 422)]);
    expect((await sendChatMessage(base({ fetch: f.fetch }))).status).toBe('too_long');
  });

  it('otros códigos son error tipado', async () => {
    const f = fakeFetch([() => json({}, 500)]);
    expect(await sendChatMessage(base({ fetch: f.fetch }))).toMatchObject({ status: 'error', reason: 'twitch_500' });
  });

  it('is_sent false con drop_reason es dropped y no cuenta como pendiente', async () => {
    const f = fakeFetch([() => json({ data: [{ message_id: '', is_sent: false, drop_reason: { code: 'automod_held', message: 'retenido' } }] })]);
    const result = await sendChatMessage(base({ fetch: f.fetch }));
    expect(result).toEqual({ status: 'dropped', dropReason: { code: 'automod_held', message: 'retenido' }, messageIds: [], remaining: [] });
  });

  it('cualquier drop_reason se trata igual, incluso uno desconocido o ausente', async () => {
    const a = fakeFetch([() => json({ data: [{ is_sent: false, drop_reason: { code: 'otra_cosa', message: 'x' } }] })]);
    expect(await sendChatMessage(base({ fetch: a.fetch }))).toMatchObject({ status: 'dropped', dropReason: { code: 'otra_cosa' } });
    resetClipState();
    const b = fakeFetch([() => json({ data: [{ is_sent: false }] })]);
    expect(await sendChatMessage(base({ fetch: b.fetch }))).toMatchObject({ status: 'dropped', dropReason: { code: 'unknown' } });
  });

  it('una respuesta sin datos es error', async () => {
    const f = fakeFetch([() => json({})]);
    expect(await sendChatMessage(base({ fetch: f.fetch }))).toMatchObject({ status: 'error', reason: 'bad_response' });
  });

  it('si falla el segundo trozo, dice qué salió y qué quedó', async () => {
    const f = fakeFetch([() => okMessage('m1'), () => json({}, 403)]);
    const result = await sendChatMessage(base({ fetch: f.fetch, text: 'a'.repeat(600) }));
    expect(result.status).toBe('no_permission');
    expect(result.messageIds).toEqual(['m1']);
    expect(result.remaining).toEqual(['a'.repeat(100)]);
  });

  it('un texto vacío tras limpiar no llama a Twitch ni al limitador', async () => {
    const f = fakeFetch([() => okMessage('m1')]);
    const take = vi.fn(async () => ({ ok: true as const }));
    const result = await sendChatMessage(base({ fetch: f.fetch, text: '/// ...', limiter: { take } }));
    expect(result).toEqual({ status: 'empty', messageIds: [], remaining: [] });
    expect(f.fetch).not.toHaveBeenCalled();
    expect(take).not.toHaveBeenCalled();
  });

  it('faltan variables del servidor: error not_configured sin llamar a Twitch', async () => {
    const f = fakeFetch([() => okMessage('m1')]);
    const result = await sendChatMessage(base({ fetch: f.fetch, env: {} }));
    expect(result).toMatchObject({ status: 'error', reason: 'not_configured' });
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it('límite de canal: espera lo justo y, si sigue cerrado, rate_limited sin enviar', async () => {
    const f = fakeFetch([() => okMessage('m1')]);
    const limiter = createMemoryLimiter();
    const first = await sendChatMessage(base({ fetch: f.fetch, limiter }));
    expect(first.status).toBe('sent');
    // El reloj no avanza (la espera es falsa), así que el segundo intento sigue cerrado
    const second = await sendChatMessage(base({ fetch: f.fetch, limiter }));
    expect(second).toEqual({ status: 'rate_limited', waitMs: 1000, scope: 'channel', messageIds: [], remaining: ['hola'] });
    expect(sleep).toHaveBeenCalledWith(1000);
    expect(f.posts).toHaveLength(1);
  });

  it('si la espera al limitador basta, envía', async () => {
    const f = fakeFetch([() => okMessage('m1'), () => okMessage('m2')]);
    const limiter = createMemoryLimiter();
    let clock = 1_000_000;
    const advancing = vi.fn(async (ms: number) => {
      clock += ms;
    });
    const common = { fetch: f.fetch, limiter, now: () => clock, sleep: advancing };
    expect((await sendChatMessage(base(common))).status).toBe('sent');
    expect((await sendChatMessage(base(common))).status).toBe('sent');
    expect(advancing).toHaveBeenCalledWith(1000);
    expect(f.posts).toHaveLength(2);
  });

  it('límite de cuenta: descarta sin esperar a los 30 s', async () => {
    const f = fakeFetch([() => okMessage('m')]);
    const limiter = createMemoryLimiter();
    for (let i = 0; i < 20; i++) {
      const sent = await sendChatMessage(base({ fetch: f.fetch, limiter, broadcasterId: `canal${i}` }));
      expect(sent.status).toBe('sent');
    }
    sleep.mockClear();
    const result = await sendChatMessage(base({ fetch: f.fetch, limiter, broadcasterId: 'canal-nuevo' }));
    expect(result).toEqual({ status: 'rate_limited', waitMs: 30_000, scope: 'account', messageIds: [], remaining: ['hola'] });
    expect(sleep).not.toHaveBeenCalled();
    expect(f.posts).toHaveLength(20);
  });

  it('si el limitador corta a mitad, devuelve lo enviado y lo pendiente', async () => {
    const f = fakeFetch([() => okMessage('m1')]);
    let calls = 0;
    const limiter: SendLimiter = {
      take: async () => (++calls === 1 ? { ok: true } : { ok: false, waitMs: 20_000, scope: 'account' }),
    };
    const result = await sendChatMessage(base({ fetch: f.fetch, limiter, text: 'a'.repeat(600) }));
    expect(result).toEqual({
      status: 'rate_limited',
      waitMs: 20_000,
      scope: 'account',
      messageIds: ['m1'],
      remaining: ['a'.repeat(100)],
    });
  });

  it('nunca lanza si el fetch falla y no filtra el token', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('oauth2/token')) return json({ access_token: TOKEN, expires_in: 3600 });
      throw new Error(`boom ${TOKEN} ${SECRET}`);
    }) as unknown as typeof fetch;
    const result = await sendChatMessage(base({ fetch: fetchFn }));
    expect(result).toMatchObject({ status: 'error', reason: 'network' });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('ni los resultados ni la consola contienen el token o el secreto', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => {}));
    const answers = [() => okMessage('m1'), () => json({}, 403), () => json({}, 429), () => json({}, 500), () => json({}, 401)];
    for (const answer of answers) {
      resetClipState();
      const f = fakeFetch([answer]);
      const result = await sendChatMessage(base({ fetch: f.fetch }));
      expect(JSON.stringify(result)).not.toContain(TOKEN);
      expect(JSON.stringify(result)).not.toContain(SECRET);
    }
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN);
      expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET);
      spy.mockRestore();
    }
  });
});
