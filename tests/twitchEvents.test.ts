/**
 * tests/twitchEvents.test.ts
 *
 * Canal de eventos de Twitch y Power-ups: firma del aviso, ventana de tiempo,
 * mensajes repetidos, reducción de cada tipo de evento (con los ejemplos de la
 * documentación de Twitch), permisos, de Power-up a acción, Bits a las metas
 * sin contar dos veces y etiquetas del chat para los efectos de mensaje.
 */

import { describe, expect, it } from 'vitest';
import {
  EVENT_TYPES,
  MAX_AGE_MS,
  computeSignature,
  createDeduper,
  handleEventsub,
  normalizeEvent,
  timestampFresh,
  validSecret,
  verifySignature,
  type NormalizedEvent,
} from '../server/twitch/eventsub';
import { WANTED, callbackUrl, ownSubscriptions, readEventsConfig, summarize } from '../server/twitch/subscriptions';
import {
  addBitsToGoals,
  applyGoalTotals,
  fillTemplate,
  missingScopes,
  parseCustomPowerups,
  parseTwitchEvent,
  planActions,
  scopeState,
  subscriptionStatusText,
} from '../src/utils/twitchEvents';
import { DEFAULT_POWERUPS_SETTINGS, normalizePowerupsSettings, type PowerupsSettings } from '../src/types/powerups';
import { readPowerupTags, splitMessage, toDisplayMessage, demoMessage, emoteUrl } from '../src/utils/chatFeed';
import { CONFIG_MODULES } from '../src/lib/cloudTypes';
import { MODULE_STORAGE_KEYS } from '../src/lib/cloudConfig';
import { TWITCH_SCOPES } from '../src/lib/cloud';

// ---------- Ejemplos de la documentación de Twitch ----------
// https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/ (leídos el 2026-10-04)

const BITS_CHEER = {
  user_id: '1234',
  user_login: 'cool_user',
  user_name: 'Cool_User',
  broadcaster_user_id: '1337',
  broadcaster_user_login: 'cooler_user',
  broadcaster_user_name: 'Cooler_User',
  bits: 2,
  type: 'cheer',
  power_up: null,
  custom_power_up: null,
  message: {
    text: 'cheer1 hi cheer1',
    fragments: [
      { type: 'cheermote', text: 'cheer1', cheermote: { prefix: 'cheer', bits: 1, tier: 1 }, emote: null },
      { type: 'text', text: ' hi ', cheermote: null, emote: null },
      { type: 'cheermote', text: 'cheer1', cheermote: { prefix: 'cheer', bits: 1, tier: 1 }, emote: null },
    ],
  },
};

const POWERUP_REDEMPTION = {
  id: '17fa2df1-ad76-4804-bfa5-a40ef63efe63',
  broadcaster_user_id: '1337',
  broadcaster_user_login: 'cool_user',
  broadcaster_user_name: 'Cool_User',
  user_id: '9001',
  user_login: 'cooler_user',
  user_name: 'Cooler_User',
  user_input: 'pogchamp',
  status: 'unfulfilled',
  custom_power_up: { id: '92af127c-7326-4483-a52b-b0da0be61c01', title: 'title', bits: 100, prompt: 'Power-up prompt' },
  redeemed_at: '2026-05-01T17:16:03.17106713Z',
};

const POINTS_REDEMPTION = {
  id: '17fa2df1-ad76-4804-bfa5-a40ef63efe63',
  broadcaster_user_id: '1337',
  broadcaster_user_login: 'cool_user',
  broadcaster_user_name: 'Cool_User',
  user_id: '9001',
  user_login: 'cooler_user',
  user_name: 'Cooler_User',
  user_input: 'pogchamp',
  status: 'unfulfilled',
  reward: { id: '92AF127C-7326-4483-a52b-b0da0be61c01', title: 'title', cost: 100, prompt: 'reward prompt' },
  redeemed_at: '2020-07-15T17:16:03.17106713Z',
};

describe('firma del aviso', () => {
  it('coincide con un vector conocido de HMAC-SHA256 (RFC 4231, caso 2)', () => {
    // Clave «Jefe», mensaje «what do ya want for nothing?», partido en id + fecha + cuerpo
    expect(computeSignature('Jefe', 'what do ya ', 'want for ', 'nothing?')).toBe(
      'sha256=5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843'
    );
  });

  it('coincide con un vector calculado aparte para un aviso de Twitch', () => {
    const id = 'e76c6bd4-55c9-4987-8304-da1588d8988b';
    const at = '2026-10-04T10:11:12.123456789Z';
    const body = '{"challenge":"pogchamp-kappa-360noscope-vohiyo","subscription":{"type":"channel.bits.use"}}';
    const signature = 'sha256=cf26f47b5e1cc7b80b033fbae7dfe80960892282622da480d3d4034e794c3cee';
    expect(computeSignature('lalo-secreto-de-prueba', id, at, body)).toBe(signature);
    expect(verifySignature('lalo-secreto-de-prueba', id, at, body, signature)).toBe(true);
    // El cuerpo en bytes da lo mismo que en texto
    expect(verifySignature('lalo-secreto-de-prueba', id, at, Buffer.from(body, 'utf8'), signature)).toBe(true);
  });

  it('rechaza cualquier cambio en el cuerpo, la fecha, el id, el secreto o la firma', () => {
    const args = ['secreto-de-diez', 'id-1', '2026-10-04T10:00:00Z', '{"a":1}'] as const;
    const good = computeSignature(...args);
    expect(verifySignature(...args, good)).toBe(true);
    expect(verifySignature(args[0], args[1], args[2], '{"a": 1}', good)).toBe(false);
    expect(verifySignature(args[0], args[1], '2026-10-04T10:00:01Z', args[3], good)).toBe(false);
    expect(verifySignature(args[0], 'id-2', args[2], args[3], good)).toBe(false);
    expect(verifySignature('otro-secreto-x', args[1], args[2], args[3], good)).toBe(false);
    expect(verifySignature(...args, good.slice(0, -1))).toBe(false);
    expect(verifySignature(...args, '')).toBe(false);
    expect(verifySignature('', args[1], args[2], args[3], good)).toBe(false);
  });

  it('exige un secreto de 10 a 100 caracteres sin espacios', () => {
    expect(validSecret('corto')).toBe(false);
    expect(validSecret('con espacio dentro')).toBe(false);
    expect(validSecret('x'.repeat(101))).toBe(false);
    expect(validSecret('s3cRe7-de-prueba')).toBe(true);
  });
});

describe('ventana de tiempo y repetidos', () => {
  const now = Date.parse('2026-10-04T12:00:00Z');

  it('acepta fechas con nanosegundos dentro de los diez minutos', () => {
    expect(timestampFresh('2026-10-04T11:59:30.634234626Z', now)).toBe(true);
    expect(timestampFresh(new Date(now - MAX_AGE_MS + 1000).toISOString(), now)).toBe(true);
  });

  it('descarta lo viejo, lo que viene del futuro y lo que no es una fecha', () => {
    expect(timestampFresh(new Date(now - MAX_AGE_MS - 1000).toISOString(), now)).toBe(false);
    expect(timestampFresh('2026-10-04T12:10:00Z', now)).toBe(false);
    expect(timestampFresh('ayer', now)).toBe(false);
    expect(timestampFresh('', now)).toBe(false);
  });

  it('recuerda los ids vistos, los olvida al caducar y no crece sin límite', () => {
    const deduper = createDeduper(3, 1000);
    expect(deduper.seen('a', 0)).toBe(false);
    expect(deduper.seen('a', 10)).toBe(true);
    expect(deduper.seen('b', 20)).toBe(false);
    expect(deduper.seen('c', 30)).toBe(false);
    expect(deduper.seen('d', 40)).toBe(false);
    expect(deduper.size()).toBe(3);
    // «a» salió por el tope; pasado el tiempo, todos caducan
    expect(deduper.seen('b', 2000)).toBe(false);
    deduper.forget('b');
    expect(deduper.seen('b', 2001)).toBe(false);
  });
});

describe('de cada aviso de Twitch a lo que guarda Lalo', () => {
  it('channel.bits.use: un cheer', () => {
    expect(normalizeEvent(EVENT_TYPES.bits, BITS_CHEER)).toEqual({
      kind: 'bits',
      broadcasterId: '1337',
      bits: 2,
      payload: { type: 'cheer', bits: 2, user: 'Cool_User', login: 'cool_user', text: 'cheer1 hi cheer1' },
    });
  });

  it('channel.bits.use: un Power-up de serie y uno personalizado', () => {
    const builtin = normalizeEvent(EVENT_TYPES.bits, {
      ...BITS_CHEER,
      bits: 30,
      type: 'power_up',
      power_up: { type: 'message_effect', emote: null, message_effect_id: 'cosmic-abyss' },
    });
    expect(builtin?.bits).toBe(30);
    expect(builtin?.payload.powerUp).toEqual({ type: 'message_effect', emoteId: '', emoteName: '', effectId: 'cosmic-abyss' });

    const giant = normalizeEvent(EVENT_TYPES.bits, {
      ...BITS_CHEER,
      type: 'power_up',
      power_up: { type: 'gigantify_an_emote', emote: { id: '425618', name: 'LUL' }, message_effect_id: null },
    });
    expect(giant?.payload.powerUp).toEqual({ type: 'gigantify_an_emote', emoteId: '425618', emoteName: 'LUL', effectId: '' });

    const custom = normalizeEvent(EVENT_TYPES.bits, {
      ...BITS_CHEER,
      bits: 100,
      type: 'custom_power_up',
      message: null,
      custom_power_up: { title: 'Bocina', reward_id: '92af127c-7326-4483-a52b-b0da0be61c01' },
    });
    expect(custom?.payload).toEqual({
      type: 'custom_power_up',
      bits: 100,
      user: 'Cool_User',
      login: 'cool_user',
      custom: { id: '92af127c-7326-4483-a52b-b0da0be61c01', title: 'Bocina' },
    });
  });

  it('channel.custom_power_up_redemption.add: trae el texto del espectador y no cuenta Bits otra vez', () => {
    expect(normalizeEvent(EVENT_TYPES.powerup, POWERUP_REDEMPTION)).toEqual({
      kind: 'powerup',
      broadcasterId: '1337',
      bits: 0,
      payload: {
        id: '92af127c-7326-4483-a52b-b0da0be61c01',
        title: 'title',
        bits: 100,
        text: 'pogchamp',
        user: 'Cooler_User',
        login: 'cooler_user',
      },
    });
  });

  it('channel.channel_points_custom_reward_redemption.add: el id de la recompensa en minúsculas', () => {
    const event = normalizeEvent(EVENT_TYPES.points, POINTS_REDEMPTION);
    expect(event?.kind).toBe('points');
    expect(event?.bits).toBe(0);
    expect(event?.payload).toMatchObject({ rewardId: '92af127c-7326-4483-a52b-b0da0be61c01', title: 'title', cost: 100, text: 'pogchamp' });
  });

  it('no guarda ids de espectadores y recorta lo que llega de más', () => {
    const event = normalizeEvent(EVENT_TYPES.bits, { ...BITS_CHEER, user_name: 'x'.repeat(200), message: { text: `hola\u0000\n${'y'.repeat(900)}` } });
    expect(JSON.stringify(event?.payload)).not.toContain('1234');
    expect((event?.payload.user as string).length).toBe(40);
    expect((event?.payload.text as string).length).toBe(500);
    expect(event?.payload.text).not.toMatch(/[\u0000-\u001f]/);
  });

  it('descarta tipos desconocidos y eventos mal formados', () => {
    expect(normalizeEvent('channel.follow', BITS_CHEER)).toBeNull();
    expect(normalizeEvent(EVENT_TYPES.bits, null)).toBeNull();
    expect(normalizeEvent(EVENT_TYPES.bits, { ...BITS_CHEER, broadcaster_user_id: '1337; drop' })).toBeNull();
    expect(normalizeEvent(EVENT_TYPES.bits, { ...BITS_CHEER, bits: -5 })).toBeNull();
    expect(normalizeEvent(EVENT_TYPES.bits, { ...BITS_CHEER, type: 'otra_cosa' })).toBeNull();
    expect(normalizeEvent(EVENT_TYPES.powerup, { ...POWERUP_REDEMPTION, custom_power_up: { id: '<script>' } })).toBeNull();
    expect(normalizeEvent(EVENT_TYPES.points, { ...POINTS_REDEMPTION, reward: null })).toBeNull();
  });
});

describe('atención del aviso completo', () => {
  const secret = 's3cRe7-de-prueba';
  const env = { TWITCH_EVENTSUB_SECRET: secret };
  const at = '2026-10-04T12:00:00.000000000Z';
  const now = () => Date.parse('2026-10-04T12:00:05Z');

  const send = (
    body: string,
    options: { type?: string; id?: string; signature?: string; timestamp?: string; method?: string } = {},
    stored: { id: string; event: NormalizedEvent }[] = [],
    deduper = createDeduper()
  ) => {
    const id = options.id ?? 'msg-1';
    const timestamp = options.timestamp ?? at;
    const headers: Record<string, string> = {
      'twitch-eventsub-message-id': id,
      'twitch-eventsub-message-timestamp': timestamp,
      'twitch-eventsub-message-signature': options.signature ?? computeSignature(secret, id, timestamp, body),
      'twitch-eventsub-message-type': options.type ?? 'notification',
    };
    return handleEventsub({ method: options.method ?? 'POST', header: (name) => headers[name.toLowerCase()] ?? '', rawBody: body }, env, {
      now,
      deduper,
      ingest: async (messageId, event) => {
        stored.push({ id: messageId, event });
        return 'ok';
      },
    });
  };

  const notification = (type: string, event: unknown, broadcaster = '1337') =>
    JSON.stringify({ subscription: { type, version: '1', status: 'enabled', condition: { broadcaster_user_id: broadcaster } }, event });

  it('responde a la verificación con el reto tal cual, en texto', async () => {
    const result = await send(JSON.stringify({ challenge: 'pogchamp-kappa', subscription: { type: EVENT_TYPES.bits } }), {
      type: 'webhook_callback_verification',
    });
    expect(result).toEqual({ status: 200, body: 'pogchamp-kappa', contentType: 'text/plain' });
  });

  it('guarda un aviso firmado y no guarda dos veces el mismo mensaje', async () => {
    const stored: { id: string; event: NormalizedEvent }[] = [];
    const deduper = createDeduper();
    const body = notification(EVENT_TYPES.bits, BITS_CHEER);
    expect((await send(body, {}, stored, deduper)).status).toBe(200);
    expect(JSON.parse((await send(body, {}, stored, deduper)).body)).toEqual({ status: 'duplicate' });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: 'msg-1', event: { kind: 'bits', broadcasterId: '1337', bits: 2 } });
  });

  it('sin firma válida no mira el contenido ni guarda nada', async () => {
    const stored: { id: string; event: NormalizedEvent }[] = [];
    const body = notification(EVENT_TYPES.bits, BITS_CHEER);
    expect((await send(body, { signature: 'sha256=00' }, stored)).status).toBe(403);
    expect((await send(body, { signature: '' }, stored)).status).toBe(403);
    // Firma de otro cuerpo: alguien cambia el canal de destino
    const forged = notification(EVENT_TYPES.bits, { ...BITS_CHEER, broadcaster_user_id: '999' }, '999');
    expect((await send(forged, { signature: computeSignature(secret, 'msg-1', at, body) }, stored)).status).toBe(403);
    expect(stored).toHaveLength(0);
  });

  it('un mensaje viejo se da por recibido sin guardarlo', async () => {
    const stored: { id: string; event: NormalizedEvent }[] = [];
    const result = await send(notification(EVENT_TYPES.bits, BITS_CHEER), { timestamp: '2026-10-04T11:40:00Z' }, stored);
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ status: 'stale' });
    expect(stored).toHaveLength(0);
  });

  it('ignora un evento de un canal distinto al de la suscripción', async () => {
    const stored: { id: string; event: NormalizedEvent }[] = [];
    const result = await send(notification(EVENT_TYPES.bits, BITS_CHEER, '4242'), {}, stored);
    expect(JSON.parse(result.body)).toEqual({ status: 'ignored' });
    expect(stored).toHaveLength(0);
  });

  it('acepta la revocación y rechaza lo que no es POST, lo que no trae cuerpo y un servidor sin secreto', async () => {
    const revoked = await send(JSON.stringify({ subscription: { type: EVENT_TYPES.bits, status: 'authorization_revoked' } }), { type: 'revocation' });
    expect(revoked.status).toBe(200);
    expect((await send('{}', { method: 'GET' })).status).toBe(405);
    const noBody = await handleEventsub({ method: 'POST', header: () => '', rawBody: null }, env);
    expect(noBody.status).toBe(400);
    const noSecret = await handleEventsub({ method: 'POST', header: () => '', rawBody: '{}' }, {});
    expect(noSecret.status).toBe(503);
  });

  it('si no se pudo guardar, responde 500 y deja que Twitch lo reintente', async () => {
    const deduper = createDeduper();
    const body = notification(EVENT_TYPES.powerup, POWERUP_REDEMPTION);
    const headers: Record<string, string> = {
      'twitch-eventsub-message-id': 'msg-9',
      'twitch-eventsub-message-timestamp': at,
      'twitch-eventsub-message-signature': computeSignature(secret, 'msg-9', at, body),
      'twitch-eventsub-message-type': 'notification',
    };
    let attempts = 0;
    const call = () =>
      handleEventsub({ method: 'POST', header: (name) => headers[name.toLowerCase()] ?? '', rawBody: body }, env, {
        now,
        deduper,
        ingest: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error('base de datos caída');
          return 'ok';
        },
      });
    expect((await call()).status).toBe(500);
    expect((await call()).status).toBe(200);
    expect(attempts).toBe(2);
  });
});

describe('suscripciones', () => {
  it('pide los tres tipos con su permiso', () => {
    expect(WANTED.map((item) => `${item.type}@${item.version}:${item.scope}`)).toEqual([
      'channel.bits.use@1:bits:read',
      'channel.custom_power_up_redemption.add@1:bits:read',
      'channel.channel_points_custom_reward_redemption.add@1:channel:read:redemptions',
    ]);
  });

  it('la dirección de avisos sale del servidor y solo vale con https', () => {
    expect(callbackUrl({ TWITCH_EVENTSUB_CALLBACK: 'https://laloplay.vercel.app/api/twitch/eventsub' })).toBe('https://laloplay.vercel.app/api/twitch/eventsub');
    expect(callbackUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'laloplay.vercel.app' })).toBe('https://laloplay.vercel.app/api/twitch/eventsub');
    expect(callbackUrl({ TWITCH_EVENTSUB_CALLBACK: 'http://localhost:3001/api/twitch/eventsub' })).toBe('');
    expect(callbackUrl({})).toBe('');
  });

  it('dice qué variables faltan, sin enseñar ningún valor', () => {
    expect(readEventsConfig({}).missing).toEqual(['VITE_TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'TWITCH_EVENTSUB_SECRET', 'TWITCH_EVENTSUB_CALLBACK']);
    const full = readEventsConfig({
      VITE_TWITCH_CLIENT_ID: 'abc',
      TWITCH_CLIENT_SECRET: 'def',
      TWITCH_EVENTSUB_SECRET: 's3cRe7-de-prueba',
      TWITCH_EVENTSUB_CALLBACK: 'https://laloplay.vercel.app/api/twitch/eventsub',
    });
    expect(full.missing).toEqual([]);
    expect(full.config?.callback).toBe('https://laloplay.vercel.app/api/twitch/eventsub');
  });

  it('de la lista de Twitch solo cuenta las de este canal y esta dirección', () => {
    const callback = 'https://laloplay.vercel.app/api/twitch/eventsub';
    const row = (type: string, status: string, broadcaster = '1337', url = callback) => ({
      id: `${type}-${status}-${broadcaster}`,
      type,
      status,
      condition: { broadcaster_user_id: broadcaster },
      transport: { method: 'webhook', callback: url },
      created_at: '2026-10-04T10:00:00Z',
    });
    const found = ownSubscriptions(
      [
        row(EVENT_TYPES.bits, 'authorization_revoked'),
        row(EVENT_TYPES.bits, 'enabled'),
        row(EVENT_TYPES.powerup, 'enabled', '999'),
        row(EVENT_TYPES.points, 'enabled', '1337', 'https://otro.example/api'),
        row('channel.follow', 'enabled'),
        'basura',
      ],
      '1337',
      callback
    );
    expect(found.map((item) => item.status)).toEqual(['authorization_revoked', 'enabled']);
    expect(summarize(found)).toEqual([
      { type: EVENT_TYPES.bits, status: 'enabled', createdAt: '2026-10-04T10:00:00Z' },
      { type: EVENT_TYPES.powerup, status: 'missing', createdAt: null },
      { type: EVENT_TYPES.points, status: 'missing', createdAt: null },
    ]);
  });

  it('explica cada estado en palabras llanas', () => {
    expect(subscriptionStatusText('enabled')).toEqual({ text: 'Funcionando', good: true });
    expect(subscriptionStatusText('webhook_callback_verification_pending').good).toBe(true);
    expect(subscriptionStatusText('authorization_revoked').good).toBe(false);
    expect(subscriptionStatusText('missing').text).toBe('Apagada');
    expect(subscriptionStatusText('algo_nuevo').text).toContain('algo_nuevo');
  });
});

describe('permisos', () => {
  it('la entrada con Twitch pide los dos permisos nuevos', () => {
    expect(TWITCH_SCOPES).toContain('bits:read');
    expect(TWITCH_SCOPES).toContain('channel:read:redemptions');
  });

  it('detecta qué falta, y distingue «falta» de «no se sabe»', () => {
    expect(missingScopes(null)).toBeNull();
    expect(scopeState(null)).toBe('unknown');
    const old = ['moderator:read:followers', 'user:write:chat', 'channel:bot'];
    expect(missingScopes(old)).toEqual(['bits:read', 'channel:read:redemptions']);
    expect(scopeState(old)).toBe('missing');
    expect(missingScopes([...old, 'bits:read'])).toEqual(['channel:read:redemptions']);
    expect(scopeState([...TWITCH_SCOPES])).toBe('ok');
    // Gestionar canjes incluye leerlos
    expect(missingScopes(['bits:read', 'channel:manage:redemptions'])).toEqual([]);
  });
});

describe('lista de Power-ups de Twitch', () => {
  it('lee el ejemplo de Get Custom Power-up', () => {
    const list = parseCustomPowerups([
      {
        broadcaster_id: '274637212',
        id: '92af127c-7326-4483-a52b-b0da0be61c02',
        image: null,
        background_color: '#00FF00',
        is_enabled: true,
        bits: 100,
        title: 'game analysis',
        prompt: '',
        is_user_input_required: false,
        is_paused: false,
        is_in_stock: true,
      },
      { id: 'con espacios', title: 'malo' },
      'basura',
    ]);
    expect(list).toEqual([
      {
        id: '92af127c-7326-4483-a52b-b0da0be61c02',
        title: 'game analysis',
        prompt: '',
        bits: 100,
        inputRequired: false,
        enabled: true,
        paused: false,
        inStock: true,
      },
    ]);
    expect(parseCustomPowerups(undefined)).toEqual([]);
    expect(parseCustomPowerups(Array.from({ length: 80 }, (_, i) => ({ id: `p${i}`, title: 't', bits: 1 })))).toHaveLength(50);
  });
});

describe('de Power-up a acción', () => {
  const settings = (rules: PowerupsSettings['rules'], patch: Partial<PowerupsSettings> = {}): PowerupsSettings => ({
    ...DEFAULT_POWERUPS_SETTINGS,
    rules,
    ...patch,
  });
  const redemption = (text = '') => parseTwitchEvent('powerup', { id: 'c1', title: 'Bocina', bits: 50, user: 'Pau_RL', login: 'pau_rl', text })!;

  it('por defecto no hace nada', () => {
    expect(planActions(redemption(), DEFAULT_POWERUPS_SETTINGS)).toEqual([]);
    expect(normalizePowerupsSettings({ rules: { c1: { action: 'explotar' } } }).rules.c1.action).toBe('none');
  });

  it('sonido y vídeo lanzan la recompensa elegida por la puerta común, con el texto del espectador', () => {
    const [action] = planActions(redemption('pon algo'), settings({ c1: { action: 'sound', rewardId: 'reward-boom', template: '' } }));
    expect(action).toEqual({
      do: 'reward',
      input: {
        source: 'powerup',
        rewardId: 'reward-boom',
        user: 'Pau_RL',
        username: 'pau_rl',
        bits: 50,
        text: 'pon algo',
        label: 'Power-up · Bocina',
      },
    });
    // Sin recompensa elegida no hay nada que lanzar
    expect(planActions(redemption(), settings({ c1: { action: 'video', rewardId: '', template: '' } }))).toEqual([]);
  });

  it('una prueba del panel no aplica esperas ni límites', () => {
    const test = parseTwitchEvent('powerup', { id: 'c1', title: 'Bocina', bits: 50, user: 'pau', login: 'pau', text: '', test: true })!;
    const [action] = planActions(test, settings({ c1: { action: 'sound', rewardId: 'r', template: '' } }));
    expect(action).toMatchObject({ do: 'reward', input: { source: 'test' } });
  });

  it('aviso y voz rellenan la plantilla', () => {
    expect(planActions(redemption(), settings({ c1: { action: 'plate', rewardId: '', template: '' } }))).toEqual([
      { do: 'plate', tag: 'Power-up · 50 bits', text: 'Pau_RL usó Bocina', user: 'Pau_RL' },
    ]);
    expect(planActions(redemption('pon algo de los ochenta'), settings({ c1: { action: 'voice', rewardId: '', template: '{user} pide: {message}' } }))).toEqual([
      { do: 'voice', text: 'Pau_RL pide: pon algo de los ochenta', user: 'Pau_RL', login: 'pau_rl', viewerText: 'pon algo de los ochenta' },
    ]);
    expect(fillTemplate('{user} usó {powerup}. {message}', { user: 'ana', powerup: 'Susto', bits: 5, message: '' })).toBe('ana usó Susto');
    expect(fillTemplate('{user}: «{message}» ({bits})', { user: 'ana', powerup: 'x', bits: 5, message: 'hola' })).toBe('ana: «hola» (5)');
  });

  it('los de serie llegan como gasto de Bits y usan su propia regla', () => {
    const event = parseTwitchEvent('bits', {
      type: 'power_up',
      bits: 30,
      user: 'mar',
      login: 'mar',
      powerUp: { type: 'celebration', emoteId: '25', emoteName: 'Kappa', effectId: '' },
    })!;
    expect(event).toMatchObject({ kind: 'bits', builtin: 'celebration', emoteId: '25' });
    expect(planActions(event, DEFAULT_POWERUPS_SETTINGS)).toEqual([]);
    expect(planActions(event, settings({ celebration: { action: 'plate', rewardId: '', template: '' } }))).toEqual([
      { do: 'plate', tag: 'Power-up · 30 bits', text: 'mar usó Celebración en pantalla', user: 'mar' },
    ]);
  });

  it('un Power-up personalizado solo actúa una vez: con el canje, no con el gasto de Bits', () => {
    const rules = { c1: { action: 'plate' as const, rewardId: '', template: '' } };
    const spend = parseTwitchEvent('bits', { type: 'custom_power_up', bits: 50, user: 'pau', login: 'pau', custom: { id: 'c1', title: 'Bocina' } })!;
    expect(planActions(spend, settings(rules))).toEqual([]);
    expect(planActions(redemption(), settings(rules))).toHaveLength(1);
  });

  it('un cheer no lanza recompensas aquí: ya lo hace el chat', () => {
    const cheer = parseTwitchEvent('bits', { type: 'cheer', bits: 100, user: 'pau', login: 'pau', text: 'cheer100' })!;
    expect(planActions(cheer, settings({}))).toEqual([]);
  });

  it('con «Reaccionar a los Power-ups» apagado no hace nada', () => {
    expect(planActions(redemption(), settings({ c1: { action: 'plate', rewardId: '', template: '' } }, { enabled: false }))).toEqual([]);
  });

  it('canjes de puntos: solo los que no traen texto, y solo si está encendido', () => {
    const noText = parseTwitchEvent('points', { rewardId: 'ABC-1', title: 'Hidratarse', cost: 100, user: 'ana', login: 'ana', text: '' })!;
    expect(planActions(noText, DEFAULT_POWERUPS_SETTINGS)).toEqual([
      { do: 'reward', input: { source: 'points', twitchRewardId: 'abc-1', user: 'ana', username: 'ana' } },
    ]);
    const withText = parseTwitchEvent('points', { rewardId: 'abc-1', title: 'x', cost: 1, user: 'ana', login: 'ana', text: 'hola' })!;
    expect(planActions(withText, DEFAULT_POWERUPS_SETTINGS)).toEqual([]);
    expect(planActions(noText, settings({}, { pointsViaChannel: false }))).toEqual([]);
  });

  it('descarta eventos con forma rara', () => {
    expect(parseTwitchEvent('bits', { type: 'cheer', bits: 0, user: 'a' })).toBeNull();
    expect(parseTwitchEvent('powerup', { id: 'con espacios' })).toBeNull();
    expect(parseTwitchEvent('otro', {})).toBeNull();
    expect(parseTwitchEvent('bits', 'texto')).toBeNull();
  });
});

describe('Bits a las metas', () => {
  const goals = [
    { id: 'g-bits', type: 'bits', current: 1200 },
    { id: 'g-off', type: 'bits', current: 10, countBits: false },
    { id: 'g-hidden', type: 'bits', current: 5, enabled: false },
    { id: 'g-subs', type: 'subs', current: 3 },
  ];

  it('suma a las metas de bits encendidas, y solo a las que no lo tienen apagado', () => {
    expect(addBitsToGoals(goals, 100).map((goal) => goal.current)).toEqual([1300, 10, 5, 3]);
    expect(addBitsToGoals(goals, 0)).toEqual(goals);
    expect(addBitsToGoals(goals, 2.5)).toEqual(goals);
  });

  it('el evento trae el total nuevo: aplicarlo dos veces no cuenta dos veces', () => {
    const event = parseTwitchEvent('bits', { type: 'cheer', bits: 100, user: 'pau', login: 'pau', goals: [{ id: 'g-bits', current: 1300 }] })!;
    expect(planActions(event, DEFAULT_POWERUPS_SETTINGS)).toEqual([{ do: 'goals', goals: [{ id: 'g-bits', current: 1300 }], bits: 100, user: 'pau' }]);
    const totals = event.kind === 'bits' ? event.goals : [];
    const once = applyGoalTotals(goals, totals);
    const twice = applyGoalTotals(once, totals);
    expect(once.map((goal) => goal.current)).toEqual([1300, 10, 5, 3]);
    expect(twice).toEqual(once);
  });

  it('los Power-ups también cuentan, pero una sola vez: los Bits van en channel.bits.use y no en el canje', () => {
    const spend = normalizeEvent(EVENT_TYPES.bits, { ...BITS_CHEER, bits: 100, type: 'custom_power_up', message: null });
    const redemption = normalizeEvent(EVENT_TYPES.powerup, POWERUP_REDEMPTION);
    expect((spend?.bits ?? 0) + (redemption?.bits ?? 0)).toBe(100);
  });

  it('las pruebas del panel nunca traen totales de metas que aplicar', () => {
    const test = parseTwitchEvent('bits', { type: 'cheer', bits: 100, user: 'pau', login: 'pau', test: true })!;
    expect(planActions(test, DEFAULT_POWERUPS_SETTINGS)).toEqual([]);
  });
});

describe('efectos de mensaje en el chat', () => {
  it('lee de las etiquetas el efecto y el emote gigante', () => {
    expect(readPowerupTags({ 'msg-id': 'animated-message', 'animation-id': 'simmer' })).toEqual({ effect: 'simmer', giant: false });
    expect(readPowerupTags({ 'msg-id': 'animated-message', 'animation-id': 'Rainbow-Eclipse' })).toEqual({ effect: 'rainbow-eclipse', giant: false });
    expect(readPowerupTags({ 'msg-id': 'animated-message', 'animation-id': 'cosmic-abyss' })).toEqual({ effect: 'cosmic-abyss', giant: false });
    // Un efecto que Twitch añada más adelante se pinta con el estilo general
    expect(readPowerupTags({ 'msg-id': 'animated-message', 'animation-id': 'nuevo-efecto' })).toEqual({ effect: 'generic', giant: false });
    expect(readPowerupTags({ 'msg-id': 'animated-message' })).toEqual({ effect: 'generic', giant: false });
    expect(readPowerupTags({ 'msg-id': 'gigantified-emote-message' })).toEqual({ effect: null, giant: true });
    expect(readPowerupTags({ 'msg-id': 'highlighted-message' })).toEqual({ effect: null, giant: false });
    expect(readPowerupTags({ 'animation-id': 'simmer' })).toEqual({ effect: null, giant: false });
    expect(readPowerupTags({})).toEqual({ effect: null, giant: false });
  });

  it('el mensaje que pinta la capa lleva el efecto', () => {
    const effect = toDisplayMessage({ username: 'pau', 'msg-id': 'animated-message', 'animation-id': 'cosmic-abyss' }, 'hola', 'canal', { id: '1' });
    expect(effect).toMatchObject({ effect: 'cosmic-abyss', giant: false, highlighted: false });
    const giant = toDisplayMessage({ username: 'pau', 'msg-id': 'gigantified-emote-message', emotes: { '425618': ['5-7'] } }, 'hola LUL', 'canal', { id: '2' });
    expect(giant).toMatchObject({ effect: null, giant: true });
    expect(splitMessage(giant.text, giant.emotes).map((segment) => segment.kind)).toEqual(['text', 'emote']);
    expect(toDisplayMessage({ username: 'pau' }, 'hola', 'canal', { id: '3' })).toMatchObject({ effect: null, giant: false });
  });

  it('hay mensajes de muestra para el estudio y el emote gigante se pide en grande', () => {
    expect(demoMessage('effect').effect).not.toBeNull();
    const giant = demoMessage('giant');
    expect(giant.giant).toBe(true);
    expect(giant.emotes).toHaveLength(1);
    expect(emoteUrl('25', 'dark', 'default', '3.0')).toMatch(/\/3\.0$/);
    expect(emoteUrl('25')).toMatch(/\/2\.0$/);
  });
});

describe('módulo sincronizado', () => {
  it('«powerups» viaja a la nube con su clave', () => {
    expect(CONFIG_MODULES).toContain('powerups');
    expect(MODULE_STORAGE_KEYS.powerups).toBe('lalo_powerups_settings');
  });

  it('los ajustes guardados se limpian al leerlos', () => {
    const clean = normalizePowerupsSettings({
      enabled: 'sí',
      rules: { 'c-1': { action: 'voice', template: 'x'.repeat(500) }, 'id con espacios': { action: 'plate' } },
      cached: [{ id: 'c-1', title: 'Bocina', bits: 50.4, inputRequired: true }, { id: '' }],
      scopes: ['bits:read', 7],
      channelActive: true,
    });
    expect(clean.enabled).toBe(true);
    expect(Object.keys(clean.rules)).toEqual(['c-1']);
    expect(clean.rules['c-1'].template).toHaveLength(160);
    expect(clean.cached).toEqual([{ id: 'c-1', title: 'Bocina', prompt: '', bits: 50, inputRequired: true, enabled: true, paused: false, inStock: true }]);
    expect(clean.scopes).toEqual(['bits:read']);
    expect(clean.channelActive).toBe(true);
    expect(normalizePowerupsSettings(null)).toEqual(DEFAULT_POWERUPS_SETTINGS);
  });
});
