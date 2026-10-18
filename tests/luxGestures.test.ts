/**
 * tests/luxGestures.test.ts
 *
 * Gestos que el espectador pide a Lux (baila, gira, saluda) y la voz de TTS del
 * streamer que recibe el overlay para el !s del chat.
 */

import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { detectGestureRequest, gestureFor } from '../server/lux/intent';
import { handleLux } from '../server/lux/handlers';
import type { LuxDb, LuxProfile } from '../server/lux/luxDb';
import type { IntegrationRequest } from '../server/integrations/http';

const WIDGET_KEY = 'clave-obs-de-prueba-1234567890';

describe('peticiones de movimiento', () => {
  it.each([
    ['!lux baila por favor', 'dance'],
    ['¿puedes bailar?', 'dance'],
    ['gira una vuelta', 'spin'],
    ['saluda a tu chat', 'wave'],
    ['wave at chat', 'wave'],
    ['qué tal el directo', null],
  ])('"%s" → %s', (message, expected) => {
    expect(detectGestureRequest(message)).toBe(expected);
  });

  it('la petición del espectador gana al gesto de la intención', () => {
    expect(gestureFor('gracias, baila', 'agradecimiento')).toBe('dance');
    expect(gestureFor('gracias', 'agradecimiento')).toBe('bow');
  });
});

describe('voz de TTS para el overlay', () => {
  it('el arranque del overlay recibe la voz de TTS del streamer', async () => {
    const streamer: LuxProfile = { id: 'p1', role: 'streamer', luxEnabled: true };
    const db = {
      async profileByWidgetKey(key: string) {
        return key === WIDGET_KEY ? streamer : null;
      },
      async latestSpeechId() {
        return 7;
      },
      async speechSince() {
        return [];
      },
      async settingsRow() {
        return null;
      },
      async ttsVoice() {
        return { referenceId: 'voz_tts', engine: 'fish' };
      },
    } as unknown as LuxDb;
    const req: IntegrationRequest = { method: 'GET', headers: {}, query: { k: WIDGET_KEY }, body: undefined };
    const res = await handleLux('speech', req, { INTEGRATIONS_ENC_KEY: randomBytes(32).toString('base64url') }, { db: () => db });
    expect(res.body).toMatchObject({ items: [], last: 7, tts: { referenceId: 'voz_tts', engine: 'fish' }, volume: 100 });
  });
});

describe('todos los gestos desde el chat', () => {
  it.each([
    ['!lux demacia', 'ult'],
    ['!lux chispa!', 'ult'],
    ['saluda a tu chat', 'wave'],
    ['haz una reverencia', 'bow'],
    ['canta', 'sing'],
    ['!lux cantar', 'sing'],
    ['salta', 'jump'],
    ['muestra orgullo', 'pride'],
    ['tengo dudas', 'shrug'],
    ['da una vuelta', 'spin'],
    ['alza los brazos', 'arms_up'],
    ['levanta los brazos', 'arms_up'],
    ['baila', 'dance'],
  ])('"%s" → %s', (message, expected) => {
    expect(detectGestureRequest(message)).toBe(expected);
  });
});
