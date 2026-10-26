/**
 * tests/twitchBotHandlers.test.ts
 *
 * /api/twitch/bot: sin sesión no se entra, el perfil sale de la sesión (nunca de
 * la petición), cada streamer solo ve y toca lo suyo, los datos se validan y la
 * conexión usa la dependencia inyectada. La base es una memoria que sigue el
 * contrato de BotDb; la validación es la real (validateBotCommand).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BOT_COMMANDS_MAX,
  BOT_CONNECT_COOLDOWN_SECONDS,
  BOT_STATUS_COOLDOWN_SECONDS,
  STATUS_CACHE_MS,
  handleBot,
  resetBotState,
  type BotCaller,
  type BotChatPort,
  type BotChatStatus,
  type BotConnectOutcome,
  type BotDeps,
} from '../server/twitch/botHandlers';
import type { ChatLinesDb } from '../server/twitch/botChatLines';
import {
  BotDbError,
  DEFAULT_BOT_SETTINGS,
  isUuid,
  validateBotCommand,
  validPrefix,
  type BotCommand,
  type BotDb,
  type BotSettings,
} from '../server/twitch/botDb';

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Reloj de la prueba (ms): lo comparten el handler (deps.now) y los cooldowns de la base falsa. */
const clock = { now: 1_000_000 };

function memoryDb(options: { rates?: boolean } = {}): BotDb & { patches: Array<Partial<BotSettings>>; takes: string[] } {
  const settings = new Map<string, BotSettings>();
  const commands = new Map<string, BotCommand[]>();
  const until = new Map<string, number>();
  const patches: Array<Partial<BotSettings>> = [];
  const takes: string[] = [];
  let seq = 0;
  const list = (owner: string) => commands.get(owner) ?? [];
  return {
    patches,
    takes,
    async settings(p) { return settings.get(p) ?? null; },
    async saveSettings(p, patch) {
      patches.push({ ...patch });
      if (patch.prefix !== undefined && !validPrefix(patch.prefix)) throw new BotDbError('prefix');
      const next = { ...DEFAULT_BOT_SETTINGS, ...settings.get(p), ...patch };
      settings.set(p, next);
      return { ...next };
    },
    async commands(p) { return [...list(p)].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)); },
    async saveCommand(p, input, prefix) {
      const w = validateBotCommand(input, prefix);
      const rows = list(p);
      if (rows.some((r) => r.name === w.name && r.id !== w.id)) throw new BotDbError('duplicate');
      if (w.id) {
        const row = rows.find((r) => r.id === w.id);
        if (!row) throw new BotDbError('not_found');
        Object.assign(row, { name: w.name, response: w.response, permission: w.permission, enabled: w.enabled, position: w.position });
        return { ...row };
      }
      const row: BotCommand = { id: uuid(++seq), name: w.name, response: w.response, permission: w.permission, enabled: w.enabled, position: w.position };
      commands.set(p, [...rows, row]);
      return { ...row };
    },
    async deleteCommand(p, id) {
      if (!isUuid(id)) return false;
      const rows = list(p);
      commands.set(p, rows.filter((r) => r.id !== id));
      return rows.some((r) => r.id === id);
    },
    async takeCooldown(p, viewer, key, seconds) {
      const k = `${p}|${viewer}|${key}`;
      takes.push(k);
      if (!options.rates) return { ok: true };
      const at = until.get(k) ?? 0;
      if (at > clock.now) return { ok: false, waitSeconds: Math.ceil((at - clock.now) / 1000) };
      until.set(k, clock.now + seconds * 1000);
      return { ok: true };
    },
  };
}

/** Líneas del chat falsas: solo interesa qué perfiles se borraron. */
function fakeLines() {
  const cleared: string[] = [];
  const lines = { async clear(p: string) { cleared.push(p); } } as unknown as ChatLinesDb;
  return { lines, cleared };
}

interface FakeChat extends BotChatPort {
  calls: string[];
  state: BotChatStatus;
  outcome: BotConnectOutcome;
  removed: boolean;
}

function fakeChat(): FakeChat {
  const chat: FakeChat = {
    calls: [],
    state: 'missing',
    outcome: 'created',
    removed: true,
    async status(id) { chat.calls.push(`status:${id}`); return chat.state; },
    async subscribe(id) {
      chat.calls.push(`subscribe:${id}`);
      if (chat.outcome === 'created' || chat.outcome === 'already') chat.state = 'pending';
      return { outcome: chat.outcome, detail: '' };
    },
    async unsubscribe(id) { chat.calls.push(`unsubscribe:${id}`); if (chat.removed) chat.state = 'missing'; return chat.removed; },
  };
  return chat;
}

const unconnected: BotChatPort = {
  async status() { return 'unavailable'; },
  async subscribe() { return { outcome: 'skipped', detail: 'sin conectar' }; },
  async unsubscribe() { return false; },
};

const ANA: BotCaller = { profileId: 'ana-id', twitchUserId: '111', twitchLogin: 'ana' };
const BEN: BotCaller = { profileId: 'ben-id', twitchUserId: '222', twitchLogin: 'ben' };

// La «sesión» de la prueba: la cabecera dice quién es; el cuerpo nunca lo decide
const session = (req: { headers: Record<string, string | string[] | undefined> }): BotCaller | null => {
  const token = String(req.headers.authorization ?? '');
  return token === 'Bearer ana' ? ANA : token === 'Bearer ben' ? BEN : null;
};

function setup(chat: BotChatPort = fakeChat(), options: { rates?: boolean } = {}) {
  const db = memoryDb(options);
  const { lines, cleared } = fakeLines();
  const deps: Partial<BotDeps> = {
    who: async (req) => session(req) ?? { status: 401, body: { error: 'Hay que iniciar sesión.', code: 'no_session' } },
    db: () => db,
    chat: () => chat,
    lines: () => lines,
    now: () => clock.now,
  };
  const as = (who: 'ana' | 'ben' | null) => async (method: string, body?: Record<string, unknown>) =>
    handleBot({ method, headers: who ? { authorization: `Bearer ${who}` } : {}, body }, {}, deps);
  return { db, chat: chat as FakeChat, as, cleared };
}

beforeEach(() => {
  resetBotState();
  clock.now = 1_000_000;
});

describe('sesión', () => {
  it('sin sesión, 401 en GET y en POST', async () => {
    const { as } = setup();
    expect((await as(null)('GET')).status).toBe(401);
    expect((await as(null)('POST', { action: 'saveCommand', command: { name: 'redes', response: 'hola' } })).status).toBe(401);
  });

  it('con la identificación real y sin cabecera, 401 sin llegar a la base', async () => {
    const res = await handleBot({ method: 'GET', headers: {}, body: undefined }, { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('no_session');
  });

  it('método no admitido, 405', async () => {
    const { as } = setup();
    expect((await as('ana')('DELETE')).status).toBe(405);
  });
});

describe('lectura', () => {
  it('un streamer nuevo recibe ajustes por defecto y ninguna fila', async () => {
    const { as } = setup();
    const res = await as('ana')('GET');
    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({ enabled: false, prefix: '!', senderMode: 'global' });
    expect(res.body.commands).toEqual([]);
    expect(res.body.connection).toEqual({ hasChannel: true, twitchLogin: 'ana', chat: 'missing', enabled: false });
  });

  it('POST status equivale a GET', async () => {
    const { as } = setup();
    expect((await as('ana')('POST', { action: 'status' })).body.connection).toMatchObject({ twitchLogin: 'ana' });
  });

  it('sin la dependencia del chat conectada, el estado es unavailable', async () => {
    const { as } = setup(unconnected);
    await as('ana')('POST', { action: 'saveSettings', settings: { enabled: true } });
    expect((await as('ana')('GET')).body.connection).toMatchObject({ chat: 'unavailable' });
  });

  it('si consultar el chat falla, el estado es error y no se cae', async () => {
    const { as } = setup({ ...unconnected, async status() { throw new Error('x'); } });
    await as('ana')('POST', { action: 'saveSettings', settings: { enabled: true } });
    const res = await as('ana')('GET');
    expect(res.status).toBe(200);
    expect(res.body.connection).toMatchObject({ chat: 'error' });
  });
});

describe('comandos', () => {
  it('crea, cambia y borra', async () => {
    const { as } = setup();
    const created = await as('ana')('POST', { action: 'saveCommand', command: { name: '!Redes', response: ' Sígueme ', permission: 'mod' } });
    expect(created.status).toBe(200);
    const command = created.body.command as BotCommand;
    expect(command).toMatchObject({ name: 'redes', response: 'Sígueme', permission: 'mod', enabled: true });

    const changed = await as('ana')('POST', { action: 'saveCommand', command: { id: command.id, name: 'redes', response: 'Nuevo', enabled: false } });
    expect((changed.body.command as BotCommand).enabled).toBe(false);
    expect(((await as('ana')('GET')).body.commands as BotCommand[]).map((c) => c.response)).toEqual(['Nuevo']);

    expect((await as('ana')('POST', { action: 'deleteCommand', id: command.id })).body.deleted).toBe(true);
    expect((await as('ana')('GET')).body.commands).toEqual([]);
  });

  it('usa el prefijo guardado para limpiar el nombre', async () => {
    const { as } = setup();
    await as('ana')('POST', { action: 'saveSettings', settings: { prefix: '?' } });
    const res = await as('ana')('POST', { action: 'saveCommand', command: { name: '?hola', response: 'x' } });
    expect((res.body.command as BotCommand).name).toBe('hola');
  });

  it('valida: nombre, respuesta, permiso y repetidos', async () => {
    const { as } = setup();
    const send = (command: Record<string, unknown>) => as('ana')('POST', { action: 'saveCommand', command });
    expect((await send({ name: '', response: 'x' })).body.code).toBe('name');
    expect((await send({ name: 'a', response: '   ' })).body.code).toBe('response');
    expect((await send({ name: 'a', response: 'x'.repeat(501) })).body.code).toBe('response');
    expect((await send({ name: 'a', response: 'x', permission: 'admin' })).body.code).toBe('permission');
    expect((await send({ name: 'a', response: 'x' })).status).toBe(200);
    const dup = await send({ name: 'A', response: 'y' });
    expect(dup.status).toBe(400);
    expect(dup.body.code).toBe('duplicate');
    expect((await as('ana')('POST', { action: 'saveCommand' })).body.code).toBe('bad_request');
  });

  it('respeta el tope de comandos por streamer, pero deja cambiar los que hay', async () => {
    const { db, as } = setup();
    for (let i = 0; i < BOT_COMMANDS_MAX; i += 1) await db.saveCommand('ana-id', { name: `c${i}`, response: 'x' });
    const over = await as('ana')('POST', { action: 'saveCommand', command: { name: 'extra', response: 'x' } });
    expect(over.status).toBe(400);
    expect(over.body.code).toBe('limit');
    const first = (await db.commands('ana-id'))[0];
    expect((await as('ana')('POST', { action: 'saveCommand', command: { id: first.id, name: first.name, response: 'otra' } })).status).toBe(200);
  });

  it('borrar sin id, 400', async () => {
    const { as } = setup();
    expect((await as('ana')('POST', { action: 'deleteCommand' })).status).toBe(400);
  });
});

describe('aislamiento entre streamers', () => {
  it('cada uno ve solo lo suyo', async () => {
    const { as } = setup();
    await as('ana')('POST', { action: 'saveCommand', command: { name: 'redes', response: 'de ana' } });
    await as('ben')('POST', { action: 'saveCommand', command: { name: 'redes', response: 'de ben' } });
    expect(((await as('ana')('GET')).body.commands as BotCommand[]).map((c) => c.response)).toEqual(['de ana']);
    expect(((await as('ben')('GET')).body.commands as BotCommand[]).map((c) => c.response)).toEqual(['de ben']);
  });

  it('no se puede cambiar ni borrar el comando de otro aunque se conozca su id', async () => {
    const { as } = setup();
    const id = ((await as('ana')('POST', { action: 'saveCommand', command: { name: 'redes', response: 'de ana' } })).body.command as BotCommand).id;
    const edit = await as('ben')('POST', { action: 'saveCommand', command: { id, name: 'redes', response: 'robado' } });
    expect(edit.status).toBe(404);
    expect(edit.body.code).toBe('not_found');
    expect((await as('ben')('POST', { action: 'deleteCommand', id })).body.deleted).toBe(false);
    expect(((await as('ana')('GET')).body.commands as BotCommand[])[0].response).toBe('de ana');
  });

  it('un perfil o canal enviado en la petición se ignora', async () => {
    const { chat, as } = setup();
    await as('ben')('POST', { action: 'saveCommand', profileId: 'ana-id', command: { name: 'mio', response: 'x', profile_id: 'ana-id', profileId: 'ana-id' } });
    expect((await as('ana')('GET')).body.commands).toEqual([]);
    expect(((await as('ben')('GET')).body.commands as BotCommand[]).length).toBe(1);
    await as('ben')('POST', { action: 'connect', twitchUserId: '111', broadcaster_id: '111' });
    expect(chat.calls.filter((c) => c.startsWith('subscribe'))).toEqual(['subscribe:222']);
  });

  it('los ajustes son por streamer', async () => {
    const { as } = setup();
    await as('ana')('POST', { action: 'saveSettings', settings: { welcomeMessage: 'hola ana' } });
    expect((await as('ben')('GET')).body.settings).toMatchObject({ welcomeMessage: '' });
    expect((await as('ana')('GET')).body.settings).toMatchObject({ welcomeMessage: 'hola ana' });
  });
});

describe('ajustes', () => {
  it('mezcla con lo guardado, valida el prefijo y el saludo, y no deja cambiar senderMode', async () => {
    const { as } = setup();
    await as('ana')('POST', { action: 'saveSettings', settings: { welcomeMessage: ' hola ' } });
    const res = await as('ana')('POST', { action: 'saveSettings', settings: { prefix: '?', senderMode: 'streamer' } });
    expect(res.body.settings).toEqual({ enabled: false, prefix: '?', welcomeMessage: 'hola', senderMode: 'global' });
    expect((await as('ana')('POST', { action: 'saveSettings', settings: { prefix: 'a b' } })).body.code).toBe('prefix');
    expect((await as('ana')('POST', { action: 'saveSettings', settings: { prefix: '' } })).body.code).toBe('prefix');
    expect((await as('ana')('POST', { action: 'saveSettings', settings: { welcomeMessage: 'x'.repeat(501) } })).body.code).toBe('welcome');
  });
});

describe('conexión', () => {
  it('connect da de alta la escucha del canal de la sesión y enciende el bot', async () => {
    const { chat, as } = setup();
    const res = await as('ana')('POST', { action: 'connect' });
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('created');
    expect(res.body.authorize).toBeNull();
    expect(chat.calls).toContain('subscribe:111');
    expect(res.body.settings).toMatchObject({ enabled: true });
    expect(res.body.connection).toEqual({ hasChannel: true, twitchLogin: 'ana', chat: 'pending', enabled: true });
    expect((await as('ben')('GET')).body.settings).toMatchObject({ enabled: false });
  });

  it('sin el permiso del streamer, dice qué pedir y no enciende nada', async () => {
    const { chat, as } = setup();
    chat.outcome = 'no_permission';
    const res = await as('ana')('POST', { action: 'connect' });
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('no_permission');
    expect(res.body.authorize).toEqual({ scopes: ['channel:bot'] });
    expect(res.body.settings).toMatchObject({ enabled: false });
  });

  it('un fallo de Twitch no enciende el bot', async () => {
    const { chat, as } = setup();
    chat.outcome = 'error';
    expect((await as('ana')('POST', { action: 'connect' })).body.settings).toMatchObject({ enabled: false });
  });

  it('con la dependencia sin conectar, 503 y nada encendido', async () => {
    const { as } = setup(unconnected);
    const res = await as('ana')('POST', { action: 'connect' });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('chat_unavailable');
    expect((await as('ana')('GET')).body.settings).toMatchObject({ enabled: false });
  });

  it('disconnect apaga el bot, borra las líneas del chat y quita la escucha; si Twitch no la quita, queda apagado igualmente', async () => {
    const { chat, as, cleared } = setup();
    await as('ana')('POST', { action: 'connect' });
    chat.removed = false;
    const fallo = await as('ana')('POST', { action: 'disconnect' });
    expect(fallo.body.removed).toBe(false);
    // Aunque Twitch no deje quitar la escucha, el bot queda apagado (el procesador ignora los canales apagados) y el panel lo sabe
    expect(fallo.body.settings).toMatchObject({ enabled: false });
    expect(fallo.body.connection).toMatchObject({ enabled: false, chat: 'error' });
    chat.removed = true;
    const ok = await as('ana')('POST', { action: 'disconnect' });
    expect(ok.body.removed).toBe(true);
    expect(ok.body.settings).toMatchObject({ enabled: false });
    expect(ok.body.connection).toMatchObject({ enabled: false, chat: 'missing' });
    expect(chat.calls.filter((c) => c.startsWith('unsubscribe'))).toEqual(['unsubscribe:111', 'unsubscribe:111']);
    expect(cleared).toEqual(['ana-id', 'ana-id']);
  });

  it('una cuenta sin canal de Twitch no puede conectar (409)', async () => {
    const chat = fakeChat();
    const res = await handleBot(
      { method: 'POST', headers: {}, body: { action: 'connect' } },
      {},
      { who: async () => ({ profileId: 'x', twitchUserId: '', twitchLogin: '' }), db: () => memoryDb(), chat: () => chat, now: () => 1 }
    );
    expect(res.status).toBe(409);
    expect(chat.calls).toEqual([]);
  });

  it('limita conectar y desconectar por cuenta con un cooldown en la base de datos (no en memoria)', async () => {
    const { as, db } = setup(fakeChat(), { rates: true });
    expect((await as('ana')('POST', { action: 'connect' })).status).toBe(200);
    expect((await as('ana')('POST', { action: 'disconnect' })).status).toBe(429);
    expect((await as('ben')('POST', { action: 'connect' })).status).toBe(200);
    clock.now += BOT_CONNECT_COOLDOWN_SECONDS * 1000 + 1;
    expect((await as('ana')('POST', { action: 'disconnect' })).status).toBe(200);
    expect(db.takes).toContain('ana-id|_|api_connect');
    // Otra instancia (el estado en memoria se pierde) sigue sujeta al mismo límite
    resetBotState();
    expect((await as('ana')('POST', { action: 'connect' })).status).toBe(429);
  });

  it('GET y status también llevan límite por perfil, respaldado en la base', async () => {
    const { as, db } = setup(fakeChat(), { rates: true });
    expect((await as('ana')('GET')).status).toBe(200);
    expect((await as('ana')('GET')).status).toBe(429);
    expect((await as('ana')('POST', { action: 'status' })).status).toBe(429);
    expect((await as('ben')('GET')).status).toBe(200);
    clock.now += BOT_STATUS_COOLDOWN_SECONDS * 1000 + 1;
    expect((await as('ana')('POST', { action: 'status' })).status).toBe(200);
    expect(db.takes).toContain('ana-id|_|api_status');
  });

  it('con el bot apagado, o sin canal, status no llama a Twitch', async () => {
    const { chat, as } = setup();
    const off = await as('ana')('GET');
    expect(off.body.connection).toMatchObject({ chat: 'missing', enabled: false });
    expect(chat.calls.filter((c) => c.startsWith('status'))).toEqual([]);
    const noChannel = await handleBot(
      { method: 'GET', headers: {}, body: undefined },
      {},
      { who: async () => ({ profileId: 'x', twitchUserId: '', twitchLogin: '' }), db: () => memoryDb(), chat: () => chat, now: () => clock.now }
    );
    expect(noChannel.body).toMatchObject({ connection: { hasChannel: false, chat: 'unavailable' } });
    expect(chat.calls.filter((c) => c.startsWith('status'))).toEqual([]);
  });

  it('el estado de la suscripción se recuerda unos 30 s por instancia', async () => {
    const { chat, as } = setup();
    await as('ana')('POST', { action: 'saveSettings', settings: { enabled: true } });
    chat.state = 'enabled';
    await as('ana')('GET');
    await as('ana')('GET');
    expect(chat.calls.filter((c) => c.startsWith('status'))).toHaveLength(1);
    clock.now += STATUS_CACHE_MS + 1;
    await as('ana')('GET');
    expect(chat.calls.filter((c) => c.startsWith('status'))).toHaveLength(2);
  });
});

describe('privacidad: líneas del chat', () => {
  it('apagar el bot al guardar ajustes borra las líneas; encenderlo o cambiar otra cosa, no', async () => {
    const { as, cleared } = setup();
    await as('ana')('POST', { action: 'saveSettings', settings: { enabled: true } });
    await as('ana')('POST', { action: 'saveSettings', settings: { welcomeMessage: 'hola' } });
    expect(cleared).toEqual([]);
    await as('ana')('POST', { action: 'saveSettings', settings: { enabled: false } });
    expect(cleared).toEqual(['ana-id']);
  });

  it('un fallo al borrar las líneas no tumba el apagado', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = memoryDb();
    const res = await handleBot(
      { method: 'POST', headers: {}, body: { action: 'disconnect' } },
      {},
      {
        who: async () => ANA,
        db: () => db,
        chat: () => fakeChat(),
        lines: () => ({ clear: async () => { throw new Error('boom'); } }) as unknown as ChatLinesDb,
        now: () => clock.now,
      }
    );
    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({ enabled: false });
    spy.mockRestore();
  });
});

describe('actualizaciones parciales (sin pisar cambios concurrentes)', () => {
  it('saveSettings manda a la base solo las columnas que cambian', async () => {
    const { as, db } = setup();
    await as('ana')('POST', { action: 'saveSettings', settings: { welcomeMessage: ' hola ' } });
    await as('ana')('POST', { action: 'saveSettings', settings: { prefix: '?', senderMode: 'streamer', enabled: 'sí' } });
    expect(db.patches).toEqual([{ welcomeMessage: 'hola' }, { prefix: '?' }]);
  });

  it('connect y disconnect tocan solo enabled', async () => {
    const { as, db } = setup();
    await as('ana')('POST', { action: 'connect' });
    clock.now += 10_000;
    await as('ana')('POST', { action: 'disconnect' });
    expect(db.patches).toEqual([{ enabled: true }, { enabled: false }]);
  });
});

describe('validación de ids y posición', () => {
  it('saveCommand con un id que no es UUID da 400 (no 502)', async () => {
    const { as } = setup();
    const res = await as('ana')('POST', { action: 'saveCommand', command: { id: '1; drop table', name: 'a', response: 'x' } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('id');
  });

  it('deleteCommand con un id que no es UUID da 404', async () => {
    const { as } = setup();
    const res = await as('ana')('POST', { action: 'deleteCommand', id: 'no-es-uuid' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('un UUID bien formado pero inexistente: borrar da deleted=false, editar da 404', async () => {
    const { as } = setup();
    expect((await as('ana')('POST', { action: 'deleteCommand', id: uuid(999) })).body.deleted).toBe(false);
    expect((await as('ana')('POST', { action: 'saveCommand', command: { id: uuid(999), name: 'a', response: 'x' } })).status).toBe(404);
  });

  it('isUuid solo acepta UUID', () => {
    expect(isUuid(uuid(1))).toBe(true);
    expect(isUuid('c1')).toBe(false);
    expect(isUuid(5)).toBe(false);
  });
});

describe('errores del servidor', () => {
  it('sin base configurada, 503', async () => {
    const res = await handleBot({ method: 'GET', headers: {}, body: undefined }, {}, { who: async () => ANA, db: () => null });
    expect(res.status).toBe(503);
  });

  it('connect sin la escucha conectada no filtra el detalle (puede nombrar variables del servidor)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const leaky: BotChatPort = { ...unconnected, async subscribe() { return { outcome: 'skipped', detail: 'Falta configurar TWITCH_BOT_USER_ID en el servidor.' }; } };
    const { as } = setup(leaky);
    const res = await as('ana')('POST', { action: 'connect' });
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain('TWITCH_BOT_USER_ID');
    expect(res.body.code).toBe('chat_unavailable');
    spy.mockRestore();
  });

  it('un fallo de la base no filtra detalles', async () => {
    const broken: BotDb = { ...memoryDb(), async settings() { throw new Error('secreto interno'); } };
    const res = await handleBot({ method: 'GET', headers: {}, body: undefined }, {}, { who: async () => ANA, db: () => broken });
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain('secreto');
  });
});
