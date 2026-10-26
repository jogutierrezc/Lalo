/**
 * tests/luxDelay.test.ts
 *
 * Las respuestas de Lux a un comando del chat llevan 30 segundos de retraso
 * (play_after); las del panel no.
 */

import { randomBytes } from 'node:crypto';
import { encryptSecret } from '../server/integrations/crypto';

const VAULT = randomBytes(32);
import { describe, expect, it } from 'vitest';
import { handleLux, LUX_REPLY_DELAY_MS } from '../server/lux/handlers';
import type { LuxDb, LuxProfile, LuxSpeechRow } from '../server/lux/luxDb';

const KEY = 'clave-obs-de-prueba-1234567890';

function db(profile: LuxProfile, speech: LuxSpeechRow[]) {
  return {
    async setting(k: string) { return k === 'nvidia_api_key_enc' ? encryptSecret('nvapi-abcdefghijklmnop1234', VAULT) : null; },
    async putSetting() {},
    async profile() { return profile; },
    async profileByWidgetKey(k: string) { return k === KEY ? profile : null; },
    async memories() { return []; },
    async insertReply() {},
    async settingsRow() { return null; },
    async saveSettingsRow() {},
    async insertSpeech(row: LuxSpeechRow) { speech.push(row); },
    async pruneSpeech() {},
  } as unknown as LuxDb;
}

describe('sin retraso en las respuestas', () => {
  it('el retraso es 0', () => {
    expect(LUX_REPLY_DELAY_MS).toBe(0);
  });

  it('una respuesta a un comando del chat puede sonar de inmediato (sin play_after)', async () => {
    const speech: LuxSpeechRow[] = [];
    const profile: LuxProfile = { id: 'p1', role: 'streamer', luxEnabled: true };
    const env = { INTEGRATIONS_ENC_KEY: VAULT.toString('base64url') };
    const fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Hola' } }] }), { status: 200 })) as unknown as typeof globalThis.fetch;
    await handleLux('chat', { method: 'POST', headers: {}, query: {}, body: { k: KEY, command: 'ask', viewer: 'ana', message: 'hola' } }, env, {
      db: () => db(profile, speech),
      fetch,
    });
    expect(speech).toHaveLength(1);
    expect(speech[0]?.play_after ?? null).toBeNull();
  });
});
