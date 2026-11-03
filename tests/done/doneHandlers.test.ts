/**
 * Pruebas mínimas de Done con base simulada: ask feliz, comando inválido, cooldown, fallo de IA con aviso,
 * gesto no permitido, clave de lectura y que ninguna respuesta exponga claves.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { handleDone } from '../../server/done/handlers';
import type { DoneDb, DoneOutboxItem } from '../../server/done/doneDb';
import { parseGesture } from '../../server/done/gestures';
import { parseDoneOutput } from '../../server/done/prompt';
import { deriveReadKey } from '../../server/done/readKey';
import { saveApiKey } from '../../server/lux/keyVault';
import { LuxCooldown } from '../../server/lux/chatCommands';
import { NoticeGate } from '../../server/chat/sharedRules';
import type { LuxDb, LuxProfile } from '../../server/lux/luxDb';
import type { IntegrationRequest } from '../../server/integrations/http';
import { DONE_DEFAULTS } from '../../src/lib/doneTypes';
import { validateDoneSettings } from '../../src/lib/doneSettings';

const WIDGET_KEY = 'clave-obs-de-prueba-1234567890';
const AI_KEY = 'nvapi-abcdefghijklmnop1234';
const streamer: LuxProfile = { id: '11111111-1111-4111-8111-111111111111', role: 'streamer', luxEnabled: true };
const other: LuxProfile = { id: '22222222-2222-4222-8222-222222222222', role: 'streamer', luxEnabled: true };

function fakes() {
  const settings = new Map<string, string>();
  const profiles = new Map([streamer, other].map((p) => [p.id, p]));
  const widgets = new Map([
    [WIDGET_KEY, streamer.id],
    ['otra-clave-obs-0987654321', other.id],
  ]);
  const speech: Array<{ profile_id: string; text: string; gesture: string | null; emotion: string }> = [];
  const replies: unknown[] = [];
  const lux = {
    async setting(key: string) {
      return settings.get(key) ?? null;
    },
    async putSetting(key: string, value: string | null) {
      if (value === null) settings.delete(key);
      else settings.set(key, value);
    },
    async profile(id: string) {
      return profiles.get(id) ?? null;
    },
    async profileByWidgetKey(key: string) {
      const id = widgets.get(key);
      return id ? (profiles.get(id) ?? null) : null;
    },
    async memories() {
      return [];
    },
    async insertReply() {},
    async settingsRow() {
      return null;
    },
    async saveSettingsRow() {},
  } as unknown as LuxDb;
  const done: DoneDb = {
    async settingsRow() {
      return null;
    },
    async saveSettingsRow() {},
    async doneEnabled() {
      return true;
    },
    async widgetKeyOf(id) {
      for (const [key, owner] of widgets) if (owner === id) return key;
      return null;
    },
    async insertReply(row) {
      replies.push(row);
    },
    async insertSpeech(row) {
      speech.push({ profile_id: row.profile_id, text: row.text, gesture: row.gesture, emotion: row.emotion });
    },
    async speechSince(profileId) {
      return speech
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => row.profile_id === profileId)
        .map(({ row, index }) => ({ id: String(index + 1), text: row.text, emotion: row.emotion as 'normal', gesture: null, viewer: null, kind: 'chat' as const, createdAt: '2026-01-01T00:00:00Z' }));
    },
    async latestSpeechId() {
      return speech.length;
    },
    async pruneSpeech() {},
    async memories() {
      return [];
    },
    async memoryList() {
      return [];
    },
    async memoryGet() {
      return null;
    },
    async memoryInsert() {},
    async memoryUpdate() {
      return false;
    },
    async memoryDelete() {
      return false;
    },
    async memoryPrune() {},
    async threadRecent() {
      return [];
    },
    async threadSave() {},
    async outboxInsert() {
      return 1;
    },
    async outboxList() {
      return [];
    },
    async outboxClaim() {
      return [] as DoneOutboxItem[];
    },
    async eventsClaim() {
      return [] as DoneOutboxItem[];
    },
    async outboxFinish() {
      return true;
    },
    async outboxRelease() {
      return true;
    },
    async outboxPrune() {},
  };
  return { lux, done, speech, replies };
}

const env = () => ({ INTEGRATIONS_ENC_KEY: randomBytes(32).toString('base64url') });
const post = (body: unknown): IntegrationRequest => ({ method: 'POST', headers: {}, query: {}, body });
const get = (query: Record<string, string>): IntegrationRequest => ({ method: 'GET', headers: {}, query, body: undefined });
const aiReply = (content: string) =>
  (async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })) as unknown as typeof fetch;
const aiDown = (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch;

async function setup(fetchImpl: typeof fetch) {
  const f = fakes();
  const e = env();
  await saveApiKey(e, f.lux, AI_KEY);
  const overrides = {
    lux: () => f.lux,
    done: () => f.done,
    fetch: fetchImpl,
    cooldown: new LuxCooldown(5000),
    waitNotices: new NoticeGate(),
    failureNotices: new NoticeGate(),
    now: () => 1_000_000,
  };
  return { f, e, overrides };
}

describe('ask', () => {
  it('responde, quita las etiquetas y encola la voz con su emoción y gesto', async () => {
    const { f, e, overrides } = await setup(aiReply('¡Hola, Ana! [feliz] {wave}'));
    const res = await handleDone('chat', post({ k: WIDGET_KEY, command: 'ask', viewer: 'ana', message: 'hola', source: 'bot' }), e, overrides);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ reply: '¡Hola, Ana!', emotion: 'feliz', gesture: 'wave' });
    expect(f.speech).toHaveLength(1);
    expect(f.speech[0]).toMatchObject({ text: '¡Hola, Ana!', gesture: 'wave', emotion: 'feliz' });
  });

  it('el cooldown corta la segunda pregunta y avisa una sola vez', async () => {
    const { e, overrides } = await setup(aiReply('Hola [normal]'));
    const body = { k: WIDGET_KEY, command: 'ask', viewer: 'ana', message: 'hola', source: 'bot' };
    await handleDone('chat', post(body), e, overrides);
    const second = await handleDone('chat', post(body), e, overrides);
    expect(second.body).toMatchObject({ skipped: 'cooldown' });
    expect(String(second.body.notice)).toContain('espera');
    const third = await handleDone('chat', post(body), e, overrides);
    expect(third.body.notice).toBeUndefined();
  });

  it('si la IA falla, devuelve un aviso corto para el chat (una vez por minuto)', async () => {
    const { e, overrides } = await setup(aiDown);
    const first = await handleDone('chat', post({ k: WIDGET_KEY, command: 'ask', viewer: 'a', message: 'hola', source: 'bot' }), e, { ...overrides, cooldown: new LuxCooldown(0) });
    expect(first.body).toMatchObject({ failed: 'ai_failed', notice: 'Done no pudo responder ahora, intenta de nuevo.' });
    const second = await handleDone('chat', post({ k: WIDGET_KEY, command: 'ask', viewer: 'b', message: 'hola', source: 'bot' }), e, { ...overrides, cooldown: new LuxCooldown(0) });
    expect(second.body.notice).toBeUndefined();
  });

  it('un comando que no existe y una clave mala se rechazan', async () => {
    const { e, overrides } = await setup(aiReply('x'));
    expect((await handleDone('chat', post({ k: WIDGET_KEY, command: 'zzz' }), e, overrides)).status).toBe(400);
    expect((await handleDone('chat', post({ k: 'mala', command: 'ask', message: 'hola' }), e, overrides)).status).toBe(401);
  });
});

describe('gestos y filtro', () => {
  it('descarta un gesto que el personaje no puede hacer y siempre quita las llaves', () => {
    expect(parseGesture('Vale {dance}', ['wave'])).toEqual({ text: 'Vale', gesture: null });
    expect(parseGesture('Vale {cheer}', ['arms_up'])).toEqual({ text: 'Vale', gesture: 'arms_up' });
  });

  it('el filtro quita enlaces y menciones', () => {
    const out = parseDoneOutput('Mira https://malo.com @todos hola [feliz] {wave}', ['wave'], 200);
    expect(out.text).not.toMatch(/https?:|@|malo\.com/);
    expect(out.gesture).toBe('wave');
  });
});

describe('ajustes', () => {
  it('rechaza comandos reservados y rangos malos', () => {
    expect(validateDoneSettings({ commandWord: 'doneon' }).ok).toBe(false);
    expect(validateDoneSettings({ commandWord: 's' }).ok).toBe(false);
    expect(validateDoneSettings({ commandWord: 'Mi Done' }).ok).toBe(false);
    expect(validateDoneSettings({ replyMax: 10 }).ok).toBe(false);
    expect(validateDoneSettings({ textStyle: 'no-existe' }).ok).toBe(false);
    expect(validateDoneSettings({ commandWord: 'Asistente', replyMax: 200 }, DONE_DEFAULTS)).toMatchObject({ ok: true });
  });

  it('acepta los personajes del contrato', () => {
    for (const id of ['lux', 'svg:done', 'svg:cam', 'glb:abc-123', null]) expect(validateDoneSettings({ characterId: id }).ok).toBe(true);
    expect(validateDoneSettings({ characterId: 'svg:otro' }).ok).toBe(false);
  });
});

describe('clave de lectura del overlay', () => {
  it('vale para speech; la clave de OBS, una falsa o la de otro creador no', async () => {
    const { e, overrides } = await setup(aiReply('x'));
    const readKey = deriveReadKey(streamer.id, WIDGET_KEY);
    const ok = await handleDone('speech', get({ k: readKey }), e, overrides);
    expect(ok.status).toBe(200);
    expect(ok.body).toHaveProperty('items');
    expect(ok.body).toHaveProperty('character');
    expect((await handleDone('speech', get({ k: WIDGET_KEY }), e, overrides)).status).toBe(401);
    expect((await handleDone('speech', get({ k: `${readKey.slice(0, -2)}xx` }), e, overrides)).status).toBe(401);
    expect((await handleDone('speech', get({ k: deriveReadKey(streamer.id, 'otra-widget-key') }), e, overrides)).status).toBe(401);
  });

  it('en chat solo permite preguntar; no enciende ni apaga', async () => {
    const { e, overrides } = await setup(aiReply('x'));
    const readKey = deriveReadKey(streamer.id, WIDGET_KEY);
    const res = await handleDone('chat', post({ k: readKey, command: 'off', privileged: true }), e, overrides);
    expect(res.status).toBe(403);
  });

  it('ninguna respuesta expone la clave de OBS ni la de la IA', async () => {
    const { e, overrides } = await setup(aiReply('Hola [feliz]'));
    const readKey = deriveReadKey(streamer.id, WIDGET_KEY);
    const bodies = [
      await handleDone('chat', post({ k: WIDGET_KEY, command: 'ask', viewer: 'ana', message: 'hola', source: 'bot' }), e, overrides),
      await handleDone('speech', get({ k: readKey }), e, overrides),
      await handleDone('release', get({}), e, overrides),
    ].map((res) => JSON.stringify(res.body));
    for (const text of bodies) {
      expect(text).not.toContain(WIDGET_KEY);
      expect(text).not.toContain(AI_KEY);
    }
  });
});
