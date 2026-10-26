/**
 * tests/luxProactive.test.ts
 *
 * La IA habla con el nombre del creador y por su cuenta: nombre visible (respaldos),
 * comentarios espontáneos, reacciones a eventos, cola «Decir en el chat» (panel y bot),
 * y el script del bot (versión 6, partición de mensajes largos, compilado en Python).
 */

import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handleLux } from '../server/lux/handlers';
import { LuxCooldown } from '../server/lux/chatCommands';
import { luxDisplayName, validateChatName } from '../server/lux/displayName';
import { PLACEHOLDER_SYSTEM, buildLuxMessages, systemFor } from '../server/lux/prompt';
import { DEFAULT_LUX_SETTINGS, normalizeLuxSettings, rowFromSettings, settingsFromRow, type LuxSettings } from '../server/lux/settings';
import { describeEvents, eventsAllowed, normalizeEvents, outboxState } from '../server/lux/proactive';
import { LUX_BOT_VERSION } from '../server/lux/release';
import { buildPythonScript } from '../src/components/bot/pythonScript';
import type { LuxDb, LuxOutboxItem, LuxOutboxRow, LuxProfile, LuxSpeechRow } from '../server/lux/luxDb';
import type { IntegrationRequest } from '../server/integrations/http';
import type { TwitchIOSettings } from '../src/types/twitchio';

const WIDGET_KEY = 'clave-obs-de-prueba-1234567890';
const VALID_KEY = 'nvapi-abcdefghijklmnop1234';
const streamer: LuxProfile = { id: 'p1', role: 'streamer', luxEnabled: true };

function memoryDb(profiles: LuxProfile[] = [streamer]) {
  const settings = new Map<string, string>();
  const byId = new Map(profiles.map((p) => [p.id, p]));
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
      return byId.get(id) ?? null;
    },
    async profileByWidgetKey(key) {
      return key === WIDGET_KEY ? (profiles[0] ?? null) : null;
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
      outbox.push({ id, text: row.text, speak: row.speak, emotion: row.emotion, mode: row.mode, status: 'pending', createdAt: new Date(clock).toISOString(), claimedAt: null, sentAt: null });
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
    async outboxFinish(_profileId, id, ok, nowIso) {
      const item = outbox.find((entry) => entry.id === id && entry.status === 'claimed');
      if (!item) return false;
      item.status = ok ? 'sent' : 'failed';
      item.sentAt = nowIso;
      return true;
    },
  };
  const configure = (patch: Partial<LuxSettings>) => rows.set('p1', rowFromSettings('p1', { ...DEFAULT_LUX_SETTINGS, ...patch }));
  return { db, settings, rows, speech, outbox, configure };
}

const NOW = Date.parse('2026-10-25T12:00:00Z');
// Cada prueba de la cola vive en su propia hora: el servidor no escribe dos veces seguidas la señal de vida del bot en 15 s.
let clock = NOW;
let clockSeq = 0;

function recordingFetch(content: string, status = 200) {
  const calls: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  const fn = (async (_url: unknown, init?: { body?: unknown }) => {
    calls.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const envWithVault = () => ({ INTEGRATIONS_ENC_KEY: randomBytes(32).toString('base64url') });
const post = (body: unknown): IntegrationRequest => ({ method: 'POST', headers: {}, query: {}, body });
const get = (): IntegrationRequest => ({ method: 'GET', headers: {}, query: {} });
const asStreamer = async () => ({ id: 'p1', role: 'streamer', status: 'active' });

async function withKey(env: Record<string, string>, db: LuxDb) {
  await handleLux('key', post({ apiKey: VALID_KEY }), env, { auth: async () => ({ id: 'a1', role: 'admin', status: 'active' }), db: () => db });
}

const chatLines = (count: number) => Array.from({ length: count }, (_, i) => ({ viewer: `v${i}`, text: `mensaje ${i} sobre el juego` }));

// ---------- Nombre visible ----------

describe('nombre visible de la IA', () => {
  it('usa el nombre del creador; si no, la palabra; si es lux, «MI AI»', () => {
    expect(luxDisplayName('Luna', 'mascota')).toBe('Luna');
    expect(luxDisplayName('', 'mascota')).toBe('Mascota');
    expect(luxDisplayName('   ', 'lux')).toBe('MI AI');
    expect(luxDisplayName('', 'lux')).toBe('MI AI');
    expect(luxDisplayName(undefined, undefined)).toBe('MI AI');
  });

  it('valida de 0 a 30 caracteres y limpia saltos de línea', () => {
    expect(validateChatName('  Luna   Nova ')).toEqual({ ok: true, name: 'Luna Nova' });
    expect(validateChatName('')).toEqual({ ok: true, name: '' });
    expect(validateChatName('a'.repeat(31))).toMatchObject({ ok: false });
    expect(validateChatName('hola\nmundo')).toEqual({ ok: true, name: 'hola mundo' });
  });

  it('la configuración lo guarda y una fila rota cae a vacío', () => {
    expect(normalizeLuxSettings({ chatName: 'Luna' })).toMatchObject({ ok: true, value: { chatName: 'Luna' } });
    expect(normalizeLuxSettings({ chatName: 'x'.repeat(31) })).toMatchObject({ ok: false, field: 'chatName' });
    expect(normalizeLuxSettings({ chatName: 5 })).toMatchObject({ ok: false, field: 'chatName' });
    expect(settingsFromRow({ chat_name: 'x'.repeat(80) }).chatName).toBe('');
    expect(settingsFromRow({ chat_name: null }).chatName).toBe('');
    expect(rowFromSettings('p1', { ...DEFAULT_LUX_SETTINGS, chatName: 'Luna' })).toMatchObject({ chat_name: 'Luna' });
  });

  it('el sistema del modelo se presenta con el nombre y no se llama Lux', () => {
    expect(PLACEHOLDER_SYSTEM.startsWith('Eres MI AI,')).toBe(true);
    expect(systemFor()).toBe(PLACEHOLDER_SYSTEM);
    const system = systemFor('Luna');
    expect(system).toContain('Eres Luna,');
    expect(system).toContain('Nunca digas que te llamas «Lux»');
    expect(systemFor('Lux')).not.toContain('Nunca digas');
    const messages = buildLuxMessages({ viewer: 'ana', message: 'hola', memories: [], name: 'Luna' });
    expect(String(messages[0].content)).toContain('Eres Luna,');
    expect(String(buildLuxMessages({ viewer: 'ana', message: 'hola', memories: [] })[0].content)).toContain('Eres MI AI,');
  });

  it('la respuesta del chat llega al modelo con el nombre elegido', async () => {
    const env = envWithVault();
    const { db, configure } = memoryDb();
    configure({ chatName: 'Luna' });
    await withKey(env, db);
    const { fn, calls } = recordingFetch('Hola [feliz]');
    await handleLux('chat', post({ k: WIDGET_KEY, command: 'ask', viewer: 'ana', message: 'hola' }), env, { db: () => db, fetch: fn, cooldown: new LuxCooldown(0) });
    expect(calls[0].messages[0].content).toContain('Eres Luna,');
  });
});

// ---------- Ajustes nuevos ----------

describe('ajustes de comentarios y eventos', () => {
  it('valores por defecto: todo encendido, cada 15 min y 10 mensajes', () => {
    expect(DEFAULT_LUX_SETTINGS).toMatchObject({
      spontaneousEnabled: true,
      spontaneousEveryMin: 15,
      spontaneousMinMessages: 10,
      eventFollow: true,
      eventSub: true,
      eventRaid: true,
      eventStart: true,
    });
  });

  it('solo admite las opciones del panel', () => {
    for (const minutes of [10, 15, 30, 60]) expect(normalizeLuxSettings({ spontaneousEveryMin: minutes }).ok).toBe(true);
    for (const bad of [5, 20, '15', 15.5]) expect(normalizeLuxSettings({ spontaneousEveryMin: bad })).toMatchObject({ ok: false, field: 'spontaneousEveryMin' });
    for (const count of [3, 5, 10]) expect(normalizeLuxSettings({ spontaneousMinMessages: count }).ok).toBe(true);
    expect(normalizeLuxSettings({ spontaneousMinMessages: 7 })).toMatchObject({ ok: false, field: 'spontaneousMinMessages' });
    expect(normalizeLuxSettings({ eventRaid: 'sí' })).toMatchObject({ ok: false, field: 'eventRaid' });
    expect(normalizeLuxSettings({ spontaneousEnabled: 1 })).toMatchObject({ ok: false, field: 'spontaneousEnabled' });
  });

  it('una fila con datos rotos se queda en los valores seguros, campo por campo', () => {
    const value = settingsFromRow({ spontaneous_every_min: 7, spontaneous_min_messages: 'x', event_sub: 'raro', event_raid: false, chat_word: 'mascota' });
    expect(value).toMatchObject({ spontaneousEveryMin: 15, spontaneousMinMessages: 10, eventSub: true, eventRaid: false, chatWord: 'mascota' });
  });

  it('ida y vuelta por la fila de la base de datos', () => {
    const custom = { ...DEFAULT_LUX_SETTINGS, spontaneousEnabled: false, spontaneousEveryMin: 60, spontaneousMinMessages: 3, eventFollow: false, eventStart: false };
    const row = rowFromSettings('p1', custom);
    expect(row).toMatchObject({ spontaneous_enabled: false, spontaneous_every_min: 60, spontaneous_min_messages: 3, event_follow: false, event_start: false });
    expect(settingsFromRow(row)).toMatchObject(custom);
  });
});

// ---------- Comentarios espontáneos ----------

describe('comando spontaneous', () => {
  async function setup(patch: Partial<LuxSettings> = {}) {
    const env = envWithVault();
    const made = memoryDb();
    made.configure(patch);
    await withKey(env, made.db);
    const ai = recordingFetch('Qué buen debate sobre el juego [alegre]');
    let now = NOW;
    const run = (lines: unknown) =>
      handleLux('chat', post({ k: WIDGET_KEY, command: 'spontaneous', lines }), env, { db: () => made.db, fetch: ai.fn, now: () => now });
    return { ...made, ai, run, advance: (ms: number) => (now += ms) };
  }

  it('sin actividad suficiente no dice nada ni llama a la IA', async () => {
    const { run, ai, speech } = await setup();
    const res = await run(chatLines(9));
    expect(res.body).toMatchObject({ skipped: 'no_activity', needed: 10, seen: 9 });
    expect(ai.calls).toHaveLength(0);
    expect(speech).toHaveLength(0);
  });

  it('los comandos no cuentan como actividad', async () => {
    const { run } = await setup();
    const lines = [...chatLines(6), ...Array.from({ length: 6 }, () => ({ viewer: 'x', text: '!lux hola' }))];
    expect(await run(lines)).toMatchObject({ body: { skipped: 'no_activity', seen: 6 } });
  });

  it('con actividad comenta, usa el nombre y encola la voz para OBS', async () => {
    const { run, ai, speech, configure } = await setup();
    configure({ chatName: 'Luna' });
    const res = await run(chatLines(10));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ reply: 'Qué buen debate sobre el juego', emotion: 'alegre' });
    expect(ai.calls[0].messages[0].content).toContain('Eres Luna,');
    expect(ai.calls[0].messages[0].content).toContain('Nadie te ha preguntado nada');
    expect(ai.calls[0].messages.at(-1)?.content).toContain('mensaje 3 sobre el juego');
    expect(speech).toHaveLength(1);
    expect(speech[0]).toMatchObject({ text: 'Qué buen debate sobre el juego', emotion: 'alegre' });
  });

  it('el servidor impone el intervalo mínimo por perfil, y pasado el tiempo vuelve a comentar', async () => {
    const { run, advance, ai } = await setup({ spontaneousEveryMin: 15 });
    expect((await run(chatLines(10))).body).toHaveProperty('reply');
    advance(5 * 60_000);
    const early = await run(chatLines(10));
    expect(early.body).toMatchObject({ skipped: 'too_soon', waitSeconds: 600 });
    expect(ai.calls).toHaveLength(1);
    advance(10 * 60_000);
    expect((await run(chatLines(10))).body).toHaveProperty('reply');
    expect(ai.calls).toHaveLength(2);
  });

  it('respeta el mínimo de mensajes que eligió el creador', async () => {
    const { run } = await setup({ spontaneousMinMessages: 3 });
    expect((await run(chatLines(3))).body).toHaveProperty('reply');
  });

  it('con !luxoff (chatEnabled apagado) no comenta', async () => {
    const { run, ai } = await setup({ chatEnabled: false });
    expect((await run(chatLines(20))).body).toEqual({ skipped: 'chat_off' });
    expect(ai.calls).toHaveLength(0);
  });

  it('con los comentarios apagados no comenta', async () => {
    const { run } = await setup({ spontaneousEnabled: false });
    expect((await run(chatLines(20))).body).toEqual({ skipped: 'spontaneous_off' });
  });

  it('si la IA falla no devuelve texto y no reintenta en el mismo intervalo', async () => {
    const env = envWithVault();
    const { db } = memoryDb();
    await withKey(env, db);
    const bad = recordingFetch('x', 500);
    const req = () => handleLux('chat', post({ k: WIDGET_KEY, command: 'spontaneous', lines: chatLines(10) }), env, { db: () => db, fetch: bad.fn, now: () => NOW });
    const first = await req();
    expect(first.body).toEqual({ skipped: 'ai_failed' });
    expect((await req()).body).toMatchObject({ skipped: 'too_soon' });
  });
});

// ---------- Eventos ----------

describe('comando event', () => {
  async function setup(patch: Partial<LuxSettings> = {}, content = '¡Gracias por el apoyo! [feliz]', status = 200) {
    const env = envWithVault();
    const made = memoryDb();
    made.configure(patch);
    await withKey(env, made.db);
    const ai = recordingFetch(content, status);
    const run = (events: unknown) =>
      handleLux('chat', post({ k: WIDGET_KEY, command: 'event', events }), env, { db: () => made.db, fetch: ai.fn, now: () => NOW, eventCooldown: new LuxCooldown(0) });
    return { ...made, ai, run };
  }

  it('saluda una suscripción con el nombre de la IA y encola la voz', async () => {
    const { run, ai, speech, configure } = await setup();
    configure({ chatName: 'Luna' });
    const res = await run([{ type: 'sub', user: 'ana', months: 6 }]);
    expect(res.body).toMatchObject({ reply: '¡Gracias por el apoyo!', emotion: 'feliz' });
    expect(ai.calls[0].messages[0].content).toContain('Eres Luna,');
    expect(ai.calls[0].messages.at(-1)?.content).toContain('ana se acaba de resuscribir (6 meses en total)');
    expect(speech[0]).toMatchObject({ gesture: 'wave' });
  });

  it('varios eventos seguidos llegan juntos y salen en un solo saludo', async () => {
    const { run, ai } = await setup();
    const follows = Array.from({ length: 10 }, (_, i) => ({ type: 'follow', user: `seguidor${i}` }));
    const res = await run([...follows, { type: 'raid', user: 'otro', viewers: 40 }]);
    expect(res.body).toHaveProperty('reply');
    expect(ai.calls).toHaveLength(1);
    const prompt = String(ai.calls[0].messages.at(-1)?.content);
    expect(prompt).toContain('10 personas acaban de seguir el canal');
    expect(prompt).toContain('y 5 más');
    expect(prompt).toContain('otro acaba de hacer una raid con 40 espectadores');
  });

  it('un tipo apagado en los ajustes no saluda', async () => {
    const { run, ai } = await setup({ eventRaid: false });
    expect((await run([{ type: 'raid', user: 'otro', viewers: 5 }])).body).toEqual({ skipped: 'event_off' });
    expect(ai.calls).toHaveLength(0);
  });

  it('solo se saludan los tipos encendidos de un grupo mixto', async () => {
    const { run, ai } = await setup({ eventFollow: false });
    await run([{ type: 'follow', user: 'a' }, { type: 'sub', user: 'b' }]);
    const prompt = String(ai.calls[0].messages.at(-1)?.content);
    expect(prompt).toContain('b se acaba de suscribir');
    expect(prompt).not.toContain('seguir');
  });

  it('el evento de inicio del directo funciona cuando llega', async () => {
    const { run, ai } = await setup();
    expect((await run([{ type: 'start' }])).body).toHaveProperty('reply');
    expect(String(ai.calls[0].messages.at(-1)?.content)).toContain('El directo acaba de empezar');
  });

  it('si la IA falla, no devuelve texto (no se escribe nada)', async () => {
    const { run } = await setup({}, 'x', 500);
    const res = await run([{ type: 'sub', user: 'ana' }]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ skipped: 'ai_failed' });
    expect(res.body).not.toHaveProperty('reply');
  });

  it('si la IA devuelve vacío, tampoco hay texto', async () => {
    const { run } = await setup({}, '   [feliz]');
    expect((await run([{ type: 'sub', user: 'ana' }])).body).toEqual({ skipped: 'empty' });
  });

  it('con el chat apagado o sin eventos válidos no hace nada', async () => {
    expect((await (await setup({ chatEnabled: false })).run([{ type: 'sub' }])).body).toEqual({ skipped: 'chat_off' });
    expect((await (await setup()).run([{ type: 'hack' }, 'x', null])).body).toEqual({ skipped: 'event_off' });
  });

  it('el servidor limita la frecuencia de saludos por perfil', async () => {
    const env = envWithVault();
    const { db } = memoryDb();
    await withKey(env, db);
    const ai = recordingFetch('Hola');
    const cooldown = new LuxCooldown(15_000);
    const run = () => handleLux('chat', post({ k: WIDGET_KEY, command: 'event', events: [{ type: 'sub' }] }), env, { db: () => db, fetch: ai.fn, now: () => NOW, eventCooldown: cooldown });
    expect((await run()).body).toHaveProperty('reply');
    expect((await run()).body).toEqual({ skipped: 'cooldown' });
  });

  it('normaliza los eventos que llegan', () => {
    const events = normalizeEvents([{ type: 'raid', user: 'x'.repeat(100), viewers: '12' }, { type: 'nada' }, { type: 'sub', months: -3, gift: true }]);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ viewers: 12 });
    expect(events[0].user).toHaveLength(40);
    expect(events[1]).toMatchObject({ months: null, gift: true });
    expect(describeEvents(events)[0]).toContain('regalar');
    expect(eventsAllowed(events, { eventFollow: true, eventSub: false, eventRaid: true, eventStart: true })).toHaveLength(1);
  });
});

// ---------- Decir en el chat: cola ----------

describe('ruta say y cola del bot', () => {
  async function setup(patch: Partial<LuxSettings> = {}, profile: LuxProfile = streamer) {
    const env = envWithVault();
    const made = memoryDb([profile]);
    made.configure(patch);
    await withKey(env, made.db);
    const ai = recordingFetch('Mañana hay directo a las 8, ¡os espero! [feliz]');
    clockSeq += 1;
    clock = NOW + clockSeq * 3_600_000;
    let now = clock;
    const deps = () => ({ db: () => made.db, auth: asStreamer, fetch: ai.fn, now: () => now, sayCooldown: new LuxCooldown(0) });
    const say = (body: unknown, overrides: object = {}) => handleLux('say', post(body), env, { ...deps(), ...overrides });
    const list = () => handleLux('say', get(), env, deps());
    const bot = (body: unknown) => handleLux('chat', post({ k: WIDGET_KEY, ...(body as object) }), env, deps());
    return { ...made, ai, say, list, bot, advance: (ms: number) => { now += ms; clock = now; return now; } };
  }

  it('texto literal: queda «en cola» y no se dice enviado hasta que el bot lo confirma', async () => {
    const { say, list, bot, advance } = await setup();
    const sent = await say({ text: 'Hola chat', mode: 'literal' });
    expect(sent.body).toMatchObject({ state: 'queued', text: 'Hola chat', mode: 'literal' });
    expect((await list()).body).toMatchObject({ items: [{ text: 'Hola chat', state: 'queued' }] });

    // El bot lo recoge (una sola vez) y aún no confirma
    const picked = await bot({ command: 'outbox' });
    expect(picked.body).toMatchObject({ items: [{ id: 1, text: 'Hola chat' }] });
    expect(((await bot({ command: 'outbox' })).body as { items: unknown[] }).items).toHaveLength(0);
    expect((await list()).body).toMatchObject({ items: [{ state: 'sending' }] });

    advance(2_000);
    expect((await bot({ command: 'outbox_done', id: 1, ok: true })).body).toEqual({ done: true });
    expect((await list()).body).toMatchObject({ items: [{ state: 'sent' }], botOnline: true });
    // Confirmar dos veces no vale
    expect((await bot({ command: 'outbox_done', id: 1, ok: true })).body).toEqual({ done: false });
  });

  it('si el bot no lo recoge en 30 s, el estado avisa; si no confirma, también', async () => {
    const { say, list, bot, advance } = await setup();
    await say({ text: 'Hola', mode: 'literal' });
    advance(31_000);
    expect((await list()).body).toMatchObject({ items: [{ state: 'stalled' }], botOnline: false });
    await bot({ command: 'outbox' });
    expect((await list()).body).toMatchObject({ items: [{ state: 'sending' }] });
    advance(61_000);
    expect((await list()).body).toMatchObject({ items: [{ state: 'unconfirmed' }] });
  });

  it('el bot puede confirmar que no pudo escribir', async () => {
    const { say, list, bot } = await setup();
    await say({ text: 'Hola', mode: 'literal' });
    await bot({ command: 'outbox' });
    await bot({ command: 'outbox_done', id: 1, ok: false });
    expect((await list()).body).toMatchObject({ items: [{ state: 'failed' }] });
  });

  it('que la IA lo redacte: usa la personalidad y el nombre, y guarda el texto ya redactado', async () => {
    const { say, ai, outbox } = await setup({ chatName: 'Luna', personality: 'traviesa' });
    const res = await say({ text: 'avisa del directo de mañana a las 8', mode: 'ai' });
    expect(res.body).toMatchObject({ state: 'queued', text: 'Mañana hay directo a las 8, ¡os espero!', mode: 'ai' });
    expect(ai.calls[0].messages[0].content).toContain('Eres Luna,');
    expect(ai.calls[0].messages[0].content).toContain('traviesa');
    expect(ai.calls[0].messages.at(-1)?.content).toContain('avisa del directo de mañana a las 8');
    expect(outbox[0]).toMatchObject({ mode: 'ai', emotion: 'feliz' });
  });

  it('si la IA no puede redactar, error claro y nada en la cola', async () => {
    const env = envWithVault();
    const made = memoryDb();
    await withKey(env, made.db);
    const bad = recordingFetch('x', 500);
    const res = await handleLux('say', post({ text: 'una idea', mode: 'ai' }), env, { db: () => made.db, auth: asStreamer, fetch: bad.fn, now: () => NOW, sayCooldown: new LuxCooldown(0) });
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ code: 'ai_failed' });
    expect(made.outbox).toHaveLength(0);
  });

  it('valida el texto: vacío, de más de 500, órdenes de Twitch y modo', async () => {
    const { say, outbox } = await setup();
    expect((await say({ text: '   ', mode: 'literal' })).status).toBe(400);
    expect((await say({ text: 'a'.repeat(501), mode: 'literal' })).status).toBe(400);
    expect((await say({ text: 'a'.repeat(500), mode: 'literal' })).status).toBe(200);
    expect((await say({ text: '/ban alguien', mode: 'literal' })).status).toBe(400);
    expect((await say({ text: '.timeout alguien', mode: 'literal' })).status).toBe(400);
    expect((await say({ text: 'x', mode: 'otro' })).status).toBe(400);
    expect((await say({ text: 'x'.repeat(301), mode: 'ai' })).status).toBe(400);
    expect(outbox).toHaveLength(1);
  });

  it('cooldown anti-spam por perfil y tope de pendientes', async () => {
    const { say } = await setup();
    const strict = { sayCooldown: new LuxCooldown(10_000) };
    expect((await say({ text: 'uno', mode: 'literal' }, strict)).status).toBe(200);
    const second = await say({ text: 'dos', mode: 'literal' }, strict);
    expect(second.status).toBe(429);
    expect(second.body).toMatchObject({ code: 'cooldown' });
    for (let i = 0; i < 4; i += 1) await say({ text: `m${i}`, mode: 'literal' });
    expect((await say({ text: 'otro', mode: 'literal' })).body).toMatchObject({ code: 'too_many' });
  });

  it('solo cuentas con Mi AI activada', async () => {
    const { say } = await setup({}, { id: 'p1', role: 'streamer', luxEnabled: false });
    expect((await say({ text: 'hola', mode: 'literal' })).status).toBe(403);
  });

  it('el bot de una cuenta sin Mi AI no recoge nada, y una clave mala se rechaza', async () => {
    const { bot } = await setup({}, { id: 'p1', role: 'streamer', luxEnabled: false });
    expect((await bot({ command: 'outbox' })).body).toMatchObject({ items: [] });
    const env = envWithVault();
    const res = await handleLux('chat', post({ k: 'otra', command: 'outbox' }), env, { db: () => memoryDb().db });
    expect(res.status).toBe(401);
  });

  it('lo que el bot recoge puede oírse en OBS si se pidió', async () => {
    const { say, bot, speech } = await setup();
    await say({ text: 'Hola', mode: 'literal', speak: true });
    await bot({ command: 'outbox' });
    expect(speech).toHaveLength(1);
    expect(speech[0].text).toBe('Hola');
  });

  it('el overlay cede la pregunta al bot cuando hay un bot vivo', async () => {
    const { bot } = await setup();
    const ask = (source: string) => bot({ command: 'ask', viewer: 'ana', message: 'hola', source });
    // Sin señales de vida del bot, el overlay contesta
    expect((await ask('overlay')).body).toHaveProperty('reply');
    // El bot pregunta por su cola: ya hay un bot vivo
    await bot({ command: 'outbox' });
    expect((await ask('overlay')).body).toEqual({ skipped: 'bot_active' });
  });

  it('estados de la cola', () => {
    const created = new Date(NOW).toISOString();
    expect(outboxState({ status: 'pending', createdAt: created, claimedAt: null }, NOW + 5_000)).toBe('queued');
    expect(outboxState({ status: 'pending', createdAt: created, claimedAt: null }, NOW + 31_000)).toBe('stalled');
    expect(outboxState({ status: 'claimed', createdAt: created, claimedAt: created }, NOW + 10_000)).toBe('sending');
    expect(outboxState({ status: 'claimed', createdAt: created, claimedAt: created }, NOW + 90_000)).toBe('unconfirmed');
    expect(outboxState({ status: 'sent', createdAt: created, claimedAt: created }, NOW)).toBe('sent');
  });
});

// ---------- Script del bot ----------

const botSettings = (patch: Partial<TwitchIOSettings> = {}): TwitchIOSettings => ({
  channel: 'mi_canal',
  botUsername: 'MiBot',
  prefix: '!',
  autoConnect: true,
  welcomeMessage: 'Bienvenidos a {channel}',
  commands: [],
  eventsub: { follows: true, subs: true, bits: true, raids: true, channelPoints: true },
  ...patch,
});

const pythonOk = spawnSync('python', ['--version']).status === 0;
const itPython = pythonOk ? it : it.skip;

function compile(script: string): { status: number | null; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), 'lalo-bot-'));
  const file = join(dir, 'bot.py');
  writeFileSync(file, script, 'utf8');
  const result = spawnSync('python', ['-m', 'py_compile', file], { encoding: 'utf8' });
  return { status: result.status, stderr: result.stderr };
}

describe('script del bot, versión 6', () => {
  it('lleva la versión 6 y el nombre visible', () => {
    expect(LUX_BOT_VERSION).toBe(8);
    const script = buildPythonScript(botSettings(), { word: 'mascota', alias: true, name: 'Luna' });
    expect(script).toContain('LUX_BOT_VERSION = 8');
    expect(script).toContain('LUX_NAME = "Luna"');
  });

  it('el nombre cae a la palabra, y a «MI AI» con la palabra por defecto', () => {
    expect(buildPythonScript(botSettings(), { word: 'mascota', alias: true })).toContain('LUX_NAME = "Mascota"');
    expect(buildPythonScript(botSettings())).toContain('LUX_NAME = "MI AI"');
    expect(buildPythonScript(botSettings(), { word: 'lux', alias: true, name: '' })).toContain('LUX_NAME = "MI AI"');
  });

  it('un nombre con comillas o saltos de línea nunca rompe el script', () => {
    const script = buildPythonScript(botSettings(), { word: 'mascota', alias: true, name: 'Lu"na\nimport os' });
    expect(script).not.toMatch(/^import os$/m);
    expect(script).toContain('LUX_NAME = "Lu\\"na import os"');
  });

  it('los textos del chat usan el nombre y no «Lux» fijo; !luxon y !luxoff se mantienen', () => {
    const script = buildPythonScript(botSettings(), { word: 'mascota', alias: true, name: 'Luna' });
    expect(script).toContain('antes de volver a preguntar a " + LUX_NAME');
    expect(script).toContain('LUX_NAME + " responderá en el chat."');
    expect(script).toContain('LUX_NAME + " dejará de responder en el chat."');
    expect(script).toContain('PREFIX + "luxon"');
    expect(script).toContain('PREFIX + "luxoff"');
    expect(script).not.toMatch(/send\([^\n]*Lux/);
    expect(script).not.toContain('preguntar a Lux');
    expect(script).not.toContain('"Lux responderá');
  });

  it('todos los envíos pasan por chat_send', () => {
    const script = buildPythonScript(botSettings({ commands: [{ id: 'c1', name: 'redes', response: 'hola', permission: 'all', enabled: true } as never] }));
    const sends = script.match(/\.send\(/g) ?? [];
    // La única llamada directa a .send( es la de dentro del propio chat_send
    expect(sends).toHaveLength(1);
    expect(script).toContain('await channel.send(part)');
    expect(script).toContain('await chat_send(ctx.channel, fill("hola"');
    expect(script).toContain('chat:edit');
  });

  it('tiene los bucles de comentarios, eventos y cola, y escucha sub y raid por IRC', () => {
    const script = buildPythonScript(botSettings());
    for (const needle of [
      'async def lux_spontaneous_loop',
      'async def lux_event_loop',
      'async def lux_outbox_loop',
      '"command": "spontaneous"',
      '"command": "event"',
      '"command": "outbox"',
      '"command": "outbox_done"',
      'async def event_raw_usernotice',
      '"subgift"',
      '"raid"',
      'spont_lines',
      'lux_lines',
    ]) {
      expect(script, needle).toContain(needle);
    }
    // La ventana de comentarios no toca la del resumen: son dos listas distintas
    expect(script).toContain('del spont_lines[:len(batch)]');
  });

  itPython('compila en Python: por defecto, con comandos personalizados y con nombre y palabra propios', () => {
    const custom = botSettings({
      commands: [
        { id: 'c1', name: 'redes', response: 'Sígueme en {channel}, {user} "ok" \\ y más', permission: 'all', enabled: true },
        { id: 'c2', name: 'mods', response: 'Solo mods', permission: 'mod', enabled: true },
        { id: 'c3', name: 'vip', response: 'Subs', permission: 'sub', enabled: true },
      ] as never,
      welcomeMessage: 'Hola "mundo"',
    });
    const variants = [
      buildPythonScript(botSettings()),
      buildPythonScript(custom),
      buildPythonScript(custom, { word: 'mascota', alias: true, name: 'Luna "Nova"' }),
      buildPythonScript(botSettings({ prefix: '?' }), { word: 'yo2', alias: false, name: 'Ñandú' }),
    ];
    for (const script of variants) {
      const result = compile(script);
      expect(result.stderr, result.stderr).toBe('');
      expect(result.status).toBe(0);
    }
  });

  itPython('split_message parte los textos de más de 500 caracteres sin pasarse', () => {
    const script = buildPythonScript(botSettings());
    const start = script.indexOf('def split_message');
    const end = script.indexOf('def send_error');
    const source = script.slice(start, end);
    const harness = `
CHAT_LIMIT = 500
${source}
long_text = " ".join(["Esta es una frase de prueba bastante larga."] * 40)
parts = split_message(long_text)
assert len(parts) >= 3, len(parts)
assert all(len(part) <= 500 for part in parts), [len(part) for part in parts]
assert " ".join(parts) == " ".join(long_text.split())
assert all(part.endswith(".") for part in parts), parts
assert split_message("corto") == ["corto"]
assert split_message("") == []
blob = "x" * 1200
cut = split_message(blob)
assert [len(part) for part in cut] == [500, 500, 200], [len(part) for part in cut]
exact = "y" * 500
assert split_message(exact) == [exact]
print("ok")
`;
    const result = spawnSync('python', ['-c', harness], { encoding: 'utf8' });
    expect(result.stderr, result.stderr).toBe('');
    expect(result.stdout.trim()).toBe('ok');
  });
});

// ---------- Migración ----------

describe('migración 0037', () => {
  const sql = readFileSync(new URL('../supabase/migrations/0037_lux_proactive.sql', import.meta.url), 'utf8');

  it('añade las columnas y la cola con RLS, y se puede repetir', () => {
    for (const column of [
      'chat_name',
      'spontaneous_enabled',
      'spontaneous_every_min',
      'spontaneous_min_messages',
      'event_follow',
      'event_sub',
      'event_raid',
      'event_start',
    ]) {
      expect(sql).toContain(`add column if not exists ${column}`);
    }
    expect(sql).toContain('create table if not exists public.lux_outbox');
    expect(sql).toContain('alter table public.lux_outbox enable row level security');
    expect(sql).toContain("check (status in ('pending', 'claimed', 'sent', 'failed'))");
    expect(sql).toContain('if not exists (select 1 from pg_constraint');
  });
});
