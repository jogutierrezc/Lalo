/**
 * tests/luxSong.test.ts
 *
 * Canciones de Lux: reconocimiento de "canta", formato [canta] por verso, y que
 * solo con voz de ElevenLabs la canción llega al overlay para cantarse.
 */

import { randomBytes } from 'node:crypto';
import { encryptSecret } from '../server/integrations/crypto';
import { describe, expect, it } from 'vitest';
import { handleLux } from '../server/lux/handlers';
import { LUX_SONG_MAX, detectSongRequest, normalizeSong, songForChat } from '../server/lux/song';
import { toElevenTags } from '../server/elevenlabs';
import type { LuxDb, LuxProfile, LuxSpeechRow } from '../server/lux/luxDb';
import type { IntegrationRequest } from '../server/integrations/http';

const WIDGET_KEY = 'clave-obs-de-prueba-1234567890';
const VAULT = randomBytes(32);

function memoryDb(voiceEngine: 'fish' | 'elevenlabs') {
  const speech: LuxSpeechRow[] = [];
  const profile: LuxProfile = { id: 'p1', role: 'streamer', luxEnabled: true, elevenlabsEnabled: true };
  const settings = new Map<string, string>([['nvidia_api_key_enc', encryptSecret('nvapi-abcdefghijklmnop1234', VAULT)]]);
  const rows = new Map<string, Record<string, unknown>>([
    ['p1', { profile_id: 'p1', voice_reference_id: 'voz_1', voice_engine: voiceEngine, reply_max: 200, language: 'es' }],
  ]);
  const db: LuxDb = {
    async setting(key) {
      return settings.get(key) ?? null;
    },
    async putSetting(key, value) {
      if (value === null) settings.delete(key);
      else settings.set(key, value);
    },
    async profile() {
      return profile;
    },
    async profileByWidgetKey(key) {
      return key === WIDGET_KEY ? profile : null;
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
    async pruneSpeech() {},
  };
  return { db, speech };
}

const LETRA = 'Luz en la grieta del mapa\nTu nombre suena en la torre\n[canta] Coro de la madrugada';
const fakeFetch = () =>
  (async () => new Response(JSON.stringify({ choices: [{ message: { content: LETRA } }] }), { status: 200 })) as unknown as typeof fetch;

const request = (body: unknown): IntegrationRequest => ({ method: 'POST', headers: {}, query: {}, body });
const env = () => ({ INTEGRATIONS_ENC_KEY: VAULT.toString('base64url') });

describe('reconocer el pedido de canción', () => {
  it.each([
    ['canta sobre el café del chat', 'el café del chat'],
    ['canta', 'el chat del directo'],
  ])('"%s"', (message, topic) => {
    expect(detectSongRequest(message)).toBe(topic);
  });

  it('otras palabras que empiezan igual no son un pedido', () => {
    expect(detectSongRequest('cantaré mañana')).toBeNull();
    expect(detectSongRequest('hola lux')).toBeNull();
  });
});

describe('formato de la letra', () => {
  it('cada verso lleva [canta] y no hay dobles', () => {
    const song = normalizeSong(LETRA);
    for (const line of song.split('\n')) expect(line.startsWith('[canta] ')).toBe(true);
    expect(song).not.toContain('[canta] [canta]');
  });

  it('la letra nunca supera el límite', () => {
    expect(normalizeSong('x'.repeat(2000)).length).toBeLessThanOrEqual(LUX_SONG_MAX);
  });

  it('para el chat se quitan las etiquetas', () => {
    expect(songForChat(normalizeSong(LETRA))).not.toContain('[canta]');
  });

  it('[singing] se conserva al pasar por ElevenLabs', () => {
    // El servidor de TTS traduce canta → singing antes de llamar a ElevenLabs; el mapa de ElevenLabs conserva singing.
    expect(toElevenTags('[singing] la la')).toBe('[singing] la la');
  });
});

describe('canción en el chat', () => {
  it('con voz de ElevenLabs, la letra se encola para cantarse con el baile', async () => {
    const { db, speech } = memoryDb('elevenlabs');
    const res = await handleLux('chat', request({ k: WIDGET_KEY, command: 'ask', viewer: 'ana', message: 'canta sobre la torre' }), env(), {
      db: () => db,
      fetch: fakeFetch(),
    });
    expect(res.body).toMatchObject({ song: true, gesture: 'dance' });
    expect(res.body.note).toBeUndefined();
    expect(speech).toHaveLength(1);
    expect(speech[0].text.startsWith('[canta] ')).toBe(true);
    expect(speech[0].gesture).toBe('dance');
  });

  it('con voz de Fish no se encola el canto y se avisa', async () => {
    const { db, speech } = memoryDb('fish');
    const res = await handleLux('chat', request({ k: WIDGET_KEY, command: 'ask', viewer: 'luis', message: 'canta' }), env(), {
      db: () => db,
      fetch: fakeFetch(),
    });
    expect(res.body).toMatchObject({ song: true, note: 'sing_needs_elevenlabs' });
    expect(speech).toHaveLength(0);
  });
});

describe('canción desde el panel', () => {
  it('el panel genera la letra y, con speak y voz de ElevenLabs, la manda a OBS para cantarse', async () => {
    const { db, speech } = memoryDb('elevenlabs');
    const res = await handleLux('reply', request({ message: 'canta sobre el café', speak: true }), env(), {
      auth: async () => ({ id: 'p1', role: 'streamer', status: 'active' }),
      db: () => db,
      fetch: fakeFetch(),
    });
    expect(res.body).toMatchObject({ song: true, gesture: 'dance' });
    expect(String(res.body.reply)).not.toContain('[canta]');
    expect(speech).toHaveLength(1);
    expect(speech[0].text.startsWith('[canta] ')).toBe(true);
  });
});
