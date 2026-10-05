/**
 * tests/integrations.test.ts
 *
 * Servidor de integraciones: cifrado y firma del `state`, lo que se lee de
 * Spotify (canción, pódcast, anuncio, nada, archivo local), la memoria de
 * lecturas y la espera del 429, la conexión completa con Spotify sin que salga
 * ningún permiso hacia el navegador, y el webhook de Ko-fi (cuerpo de
 * formulario, cada tipo, privado, campos ausentes, clave incorrecta, repetido).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { STATE_TTL_MS, decryptSecret, encryptSecret, parseKey, randomId, safeEqual, sha256Hex, signState, verifyState } from '../server/integrations/crypto';
import { handleIntegration, queryOf } from '../server/integrations/handlers';
import type { Deps, IntegrationRequest } from '../server/integrations/http';
import { resetKofiState } from '../server/integrations/kofi';
import { kofiAmount, kofiKindOf, normalizeKofiPayload, parseKofiBody } from '../server/integrations/kofiRules';
import { NOW_CACHE_MS, normalizeNowPlaying, nowForProfile, readSpotifyConfig, redirectUri, resetSpotifyMemory, retryAfterSeconds } from '../server/integrations/spotify';
import { resetSpotifyRoutes } from '../server/integrations/spotifyRoutes';
import { MigrationMissingError, createLimiter, type AccountRow, type KofiIngest, type Store } from '../server/integrations/store';

const KEY_B64 = Buffer.alloc(32, 7).toString('base64');
const KEY = parseKey(KEY_B64) as Buffer;
const PROFILE = '11111111-2222-3333-4444-555555555555';
const WIDGET_KEY = 'w'.repeat(40);

const ENV = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  INTEGRATIONS_ENC_KEY: KEY_B64,
  SPOTIFY_CLIENT_ID: 'client',
  SPOTIFY_CLIENT_SECRET: 'secret-de-prueba',
  SPOTIFY_REDIRECT_URI: 'https://lalo.test/api/spotify/callback',
};

function memoryStore() {
  const rows = new Map<string, AccountRow>();
  const ingested: KofiIngest[] = [];
  const seen = new Set<string>();
  const state = { configs: {} as Record<string, unknown>, missing: false, failIngest: false };
  const id = (profileId: string, provider: string) => `${profileId}:${provider}`;
  const guard = () => {
    if (state.missing) throw new MigrationMissingError();
  };
  const store: Store = {
    profileByWidgetKey: async (key) => (key === WIDGET_KEY ? PROFILE : null),
    profileActive: async (profileId) => profileId === PROFILE,
    get: async (profileId, provider) => (guard(), rows.get(id(profileId, provider)) ?? null),
    byHook: async (hash) => (guard(), [...rows.values()].find((row) => row.provider === 'kofi' && row.hook_hash === hash) ?? null),
    upsert: async (profileId, provider, patch) => {
      guard();
      const base: AccountRow = rows.get(id(profileId, provider)) ?? {
        profile_id: profileId,
        provider,
        secret_enc: null,
        hook_hash: null,
        hook_enc: null,
        account_name: null,
        status: 'connected',
        connected_at: new Date(0).toISOString(),
        last_event_at: null,
        last_error: null,
        last_error_at: null,
        goal_raised: 0,
        recent: [],
      };
      rows.set(id(profileId, provider), { ...base, ...patch });
    },
    remove: async (profileId, provider) => void rows.delete(id(profileId, provider)),
    count: async (provider) => [...rows.values()].filter((row) => row.provider === provider && row.secret_enc).length,
    countLinked: async (provider) => [...rows.values()].filter((row) => row.provider === provider).length,
    config: async (_profileId, module) => state.configs[module] ?? null,
    ingestKofi: async (event) => {
      if (state.failIngest) throw new Error('caída');
      if (seen.has(event.messageId)) return 'duplicate';
      seen.add(event.messageId);
      ingested.push(event);
      const row = rows.get(id(event.profileId, 'kofi'));
      if (row) rows.set(id(event.profileId, 'kofi'), { ...row, last_event_at: new Date(1).toISOString(), goal_raised: row.goal_raised + event.goalAdd });
      return 'ok';
    },
  };
  return { store, rows, ingested, state };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function setup(fetchImpl: (url: string, init?: RequestInit) => Response | Promise<Response> = () => json({}, 500)) {
  const memory = memoryStore();
  const clock = { now: 1_800_000_000_000 };
  const calls: { url: string; init?: RequestInit }[] = [];
  const deps: Partial<Deps> = {
    now: () => clock.now,
    store: () => memory.store,
    auth: async () => ({ id: PROFILE, role: 'streamer', status: 'active' }),
    fetch: (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return fetchImpl(String(url), init);
    }) as typeof fetch,
  };
  const call = (group: string, part: string, req: Partial<IntegrationRequest> = {}, env: Record<string, string | undefined> = ENV) =>
    handleIntegration(group, part, { method: 'GET', headers: {}, query: {}, body: undefined, ...req }, env, deps);
  return { ...memory, clock, calls, call, deps };
}

beforeEach(() => {
  resetSpotifyMemory();
  resetSpotifyRoutes();
  resetKofiState();
});

describe('integraciones: cifrado', () => {
  it('acepta la clave en base64 y en hexadecimal, y rechaza las demás', () => {
    expect(parseKey(KEY_B64)?.length).toBe(32);
    expect(parseKey('ab'.repeat(32))?.length).toBe(32);
    expect(parseKey(Buffer.alloc(32, 1).toString('base64url'))?.length).toBe(32);
    expect(parseKey('corta')).toBeNull();
    expect(parseKey(Buffer.alloc(16).toString('base64'))).toBeNull();
    expect(parseKey(undefined)).toBeNull();
  });

  it('cifra y descifra, y cada cifrado es distinto', () => {
    const a = encryptSecret('permiso-de-renovación', KEY);
    const b = encryptSecret('permiso-de-renovación', KEY);
    expect(a).not.toBe(b);
    expect(a).not.toContain('permiso');
    expect(decryptSecret(a, KEY)).toBe('permiso-de-renovación');
    expect(decryptSecret(b, KEY)).toBe('permiso-de-renovación');
  });

  it('detecta la manipulación, el recorte y otra clave', () => {
    const token = encryptSecret('secreto', KEY);
    const parts = token.split('.');
    const flipped = Buffer.from(parts[3], 'base64url');
    flipped[0] ^= 1;
    expect(decryptSecret([parts[0], parts[1], parts[2], flipped.toString('base64url')].join('.'), KEY)).toBeNull();
    expect(decryptSecret(token.slice(0, -4), KEY)).toBeNull();
    expect(decryptSecret(token, Buffer.alloc(32, 9))).toBeNull();
    expect(decryptSecret('v2.a.b.c', KEY)).toBeNull();
    expect(decryptSecret(null, KEY)).toBeNull();
  });

  it('compara sin depender de la longitud', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(randomId()).toHaveLength(43);
    expect(sha256Hex('x')).toHaveLength(64);
  });
});

describe('integraciones: state de Spotify', () => {
  it('firma, comprueba y caduca', () => {
    const state = signState({ profileId: PROFILE, nonce: 'n1' }, KEY, 1000);
    expect(verifyState(state, KEY, 2000)).toEqual({ profileId: PROFILE, nonce: 'n1' });
    expect(verifyState(state, KEY, 1000 + STATE_TTL_MS + 1)).toBeNull();
  });

  it('rechaza un state manipulado, de otra clave o con otra forma', () => {
    const state = signState({ profileId: PROFILE, nonce: 'n1' }, KEY, 1000);
    const [body, mac] = state.split('.');
    const forged = Buffer.from(JSON.stringify({ p: PROFILE.replace('1', '9'), n: 'n1', e: 9e15 })).toString('base64url');
    expect(verifyState(`${forged}.${mac}`, KEY, 2000)).toBeNull();
    expect(verifyState(`${body}.${mac}x`, KEY, 2000)).toBeNull();
    expect(verifyState(state, Buffer.alloc(32, 3), 2000)).toBeNull();
    expect(verifyState('', KEY, 2000)).toBeNull();
    expect(verifyState(`${body}.${mac}.extra`, KEY, 2000)).toBeNull();
  });
});

describe('integraciones: configuración de Spotify', () => {
  it('dice qué variables faltan', () => {
    expect(readSpotifyConfig({}).missing).toEqual(['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_REDIRECT_URI', 'INTEGRATIONS_ENC_KEY']);
    expect(readSpotifyConfig(ENV).config?.returnTo).toBe('https://lalo.test/#integraciones');
  });

  it('la dirección de vuelta es https, o 127.0.0.1 en local; nunca localhost', () => {
    expect(redirectUri({ SPOTIFY_REDIRECT_URI: 'http://127.0.0.1:3000/api/spotify/callback' })).toBe('http://127.0.0.1:3000/api/spotify/callback');
    expect(redirectUri({ SPOTIFY_REDIRECT_URI: 'http://localhost:3000/api/spotify/callback' })).toBe('');
    expect(redirectUri({ SPOTIFY_REDIRECT_URI: 'https://lalo.test/otra' })).toBe('');
    expect(redirectUri({ VERCEL_PROJECT_PRODUCTION_URL: 'laloplay.vercel.app' })).toBe('https://laloplay.vercel.app/api/spotify/callback');
  });
});

const TRACK = {
  is_playing: true,
  progress_ms: 61000,
  timestamp: 1,
  currently_playing_type: 'track',
  item: {
    id: 'abc',
    name: 'Marea baja',
    duration_ms: 214000,
    explicit: true,
    is_local: false,
    artists: [{ name: 'Los Faroles' }, { name: 'Mila Requena' }],
    external_urls: { spotify: 'https://open.spotify.com/track/abc' },
    album: { name: 'Costa norte', images: [{ url: 'https://i.scdn.co/image/640', width: 640 }, { url: 'https://i.scdn.co/image/300', width: 300 }, { url: 'https://i.scdn.co/image/64', width: 64 }] },
  },
};

describe('integraciones: lo que se lee de Spotify', () => {
  it('una canción', () => {
    expect(normalizeNowPlaying(TRACK)).toEqual({
      kind: 'track',
      playing: true,
      progressMs: 61000,
      track: {
        id: 'abc',
        title: 'Marea baja',
        artists: 'Los Faroles, Mila Requena',
        album: 'Costa norte',
        art: 'https://i.scdn.co/image/300',
        durationMs: 214000,
        explicit: true,
        local: false,
        url: 'https://open.spotify.com/track/abc',
      },
    });
  });

  it('un pódcast: el programa hace de artista', () => {
    const now = normalizeNowPlaying({
      is_playing: true,
      progress_ms: 5,
      currently_playing_type: 'episode',
      item: { id: 'ep', name: 'Episodio 12', duration_ms: 1000, images: [{ url: 'https://i.scdn.co/image/ep', width: 640 }], show: { name: 'El programa' } },
    });
    expect(now.kind).toBe('episode');
    expect(now.track).toMatchObject({ title: 'Episodio 12', artists: 'El programa', album: '', art: 'https://i.scdn.co/image/ep' });
  });

  it('un anuncio, nada sonando y respuestas raras no dan canción', () => {
    expect(normalizeNowPlaying({ is_playing: true, currently_playing_type: 'ad', item: null })).toMatchObject({ kind: 'ad', track: null });
    expect(normalizeNowPlaying({ is_playing: false, currently_playing_type: 'track', item: null })).toMatchObject({ kind: 'none', track: null });
    expect(normalizeNowPlaying(null).track).toBeNull();
    expect(normalizeNowPlaying('texto').track).toBeNull();
    expect(normalizeNowPlaying({ item: { name: '' } }).track).toBeNull();
  });

  it('un archivo local sale sin portada y con un id estable', () => {
    const now = normalizeNowPlaying({
      is_playing: true,
      currently_playing_type: 'track',
      item: { id: null, name: 'Maqueta', is_local: true, artists: [{ name: 'Yo' }], album: { name: '', images: [{ url: 'https://i.scdn.co/x', width: 640 }] }, duration_ms: 1000 },
    });
    expect(now.track).toMatchObject({ art: null, local: true, id: 'Maqueta|Yo', url: null });
  });

  it('descarta portadas y enlaces que no son https', () => {
    const now = normalizeNowPlaying({ ...TRACK, item: { ...TRACK.item, external_urls: { spotify: 'javascript:alert(1)' }, album: { name: 'x', images: [{ url: 'http://inseguro/x', width: 640 }] } } });
    expect(now.track?.art).toBeNull();
    expect(now.track?.url).toBeNull();
  });

  it('lee la espera del 429', () => {
    expect(retryAfterSeconds('12')).toBe(12);
    expect(retryAfterSeconds(null)).toBe(5);
    expect(retryAfterSeconds('9999')).toBe(120);
    expect(retryAfterSeconds('x')).toBe(5);
  });
});

describe('integraciones: memoria de lecturas', () => {
  const config = readSpotifyConfig(ENV).config!;
  const connect = async (t: ReturnType<typeof setup>) => t.store.upsert(PROFILE, 'spotify', { secret_enc: encryptSecret('refresh-1', KEY), status: 'connected' });

  it('varias fuentes comparten una lectura y el permiso de acceso se reutiliza', async () => {
    const t = setup((url) => (url.includes('/api/token') ? json({ access_token: 'acc-1', expires_in: 3600 }) : json(TRACK)));
    await connect(t);
    const deps = { fetch: t.deps.fetch!, now: t.deps.now!, store: t.store };
    const [a, b] = await Promise.all([nowForProfile(PROFILE, config, deps), nowForProfile(PROFILE, config, deps)]);
    expect(a.status).toBe('ok');
    expect(b).toBe(a);
    await nowForProfile(PROFILE, config, deps);
    expect(t.calls.filter((c) => c.url.includes('currently-playing'))).toHaveLength(1);

    t.clock.now += NOW_CACHE_MS + 1;
    await nowForProfile(PROFILE, config, deps);
    expect(t.calls.filter((c) => c.url.includes('currently-playing'))).toHaveLength(2);
    expect(t.calls.filter((c) => c.url.includes('/api/token'))).toHaveLength(1);
  });

  it('con un 429 espera lo que pide Spotify y conserva la última canción', async () => {
    let limited = false;
    const t = setup((url) => {
      if (url.includes('/api/token')) return json({ access_token: 'acc-1', expires_in: 3600 });
      return limited ? json({}, 429, { 'retry-after': '30' }) : json(TRACK);
    });
    await connect(t);
    const deps = { fetch: t.deps.fetch!, now: t.deps.now!, store: t.store };
    await nowForProfile(PROFILE, config, deps);
    limited = true;
    t.clock.now += NOW_CACHE_MS + 1;
    const blocked = await nowForProfile(PROFILE, config, deps);
    expect(blocked.status).toBe('rate_limited');
    expect(blocked.now.track?.title).toBe('Marea baja');
    const before = t.calls.length;
    t.clock.now += 20_000;
    await nowForProfile(PROFILE, config, deps);
    expect(t.calls.length).toBe(before);
    t.clock.now += 11_000;
    limited = false;
    expect((await nowForProfile(PROFILE, config, deps)).status).toBe('ok');
  });

  it('guarda el permiso de renovación nuevo si llega, y marca caducado con invalid_grant', async () => {
    const t = setup((url) => (url.includes('/api/token') ? json({ access_token: 'acc', expires_in: 3600, refresh_token: 'refresh-2' }) : json(null, 204)));
    await connect(t);
    const deps = { fetch: t.deps.fetch!, now: t.deps.now!, store: t.store };
    expect(await nowForProfile(PROFILE, config, deps)).toMatchObject({ status: 'ok', now: { track: null } });
    expect(decryptSecret(t.rows.get(`${PROFILE}:spotify`)?.secret_enc, KEY)).toBe('refresh-2');

    resetSpotifyMemory();
    const dead = setup(() => json({ error: 'invalid_grant' }, 400));
    await connect(dead);
    const result = await nowForProfile(PROFILE, config, { fetch: dead.deps.fetch!, now: dead.deps.now!, store: dead.store });
    expect(result.status).toBe('expired');
    expect(dead.rows.get(`${PROFILE}:spotify`)).toMatchObject({ status: 'expired', secret_enc: null });
  });
});

describe('integraciones: rutas de Spotify', () => {
  it('sin configurar lo dice, sin fallar', async () => {
    const t = setup();
    const status = await t.call('spotify', 'status', {}, { SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'y' });
    expect(status.body).toMatchObject({ configured: false });
    expect(status.body.missing).toContain('INTEGRATIONS_ENC_KEY');
    expect((await t.call('spotify', 'now', { query: { k: WIDGET_KEY } }, {})).body).toEqual({ status: 'not_configured' });
    expect((await t.call('spotify', 'login', {}, {})).status).toBe(503);
  });

  it('sin la migración lo dice en claro', async () => {
    const t = setup();
    t.state.missing = true;
    const res = await t.call('spotify', 'status');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('migration_missing');
  });

  it('conecta: state firmado y ligado a una cookie, y ningún permiso sale hacia el navegador', async () => {
    const t = setup((url) => {
      if (url.includes('/api/token')) return json({ access_token: 'acceso-secreto', expires_in: 3600, refresh_token: 'renovacion-secreta' });
      if (url.endsWith('/v1/me')) return json({ display_name: 'marea.directo' });
      return json(TRACK);
    });
    const login = await t.call('spotify', 'login');
    const url = new URL(String(login.body.url));
    expect(url.origin + url.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(url.searchParams.get('scope')).toBe('user-read-currently-playing');
    expect(url.searchParams.get('redirect_uri')).toBe(ENV.SPOTIFY_REDIRECT_URI);
    const state = url.searchParams.get('state') as string;
    const cookie = String(login.cookies?.[0]).split(';')[0];
    expect(login.cookies?.[0]).toContain('HttpOnly');

    // Sin la cookie del navegador que empezó, la vuelta no vale
    const stolen = await t.call('spotify', 'callback', { query: { code: 'c', state } });
    expect(stolen.redirect).toBe('https://lalo.test/#integraciones?spotify=bad_state');
    expect(t.rows.size).toBe(0);

    const done = await t.call('spotify', 'callback', { query: { code: 'c', state }, headers: { cookie } });
    expect(done.redirect).toBe('https://lalo.test/#integraciones?spotify=connected');
    const row = t.rows.get(`${PROFILE}:spotify`);
    expect(row?.account_name).toBe('marea.directo');
    expect(row?.secret_enc).not.toContain('renovacion-secreta');
    expect(decryptSecret(row?.secret_enc, KEY)).toBe('renovacion-secreta');

    const status = await t.call('spotify', 'status');
    expect(status.body).toMatchObject({ configured: true, state: 'connected', accountName: 'marea.directo', seats: 1, seatsMax: 5 });
    const now = await t.call('spotify', 'now', { query: { k: WIDGET_KEY } });
    expect(now.body).toMatchObject({ status: 'ok', playing: true, track: { title: 'Marea baja' } });
    for (const res of [login, done, status, now]) {
      const text = JSON.stringify(res);
      expect(text).not.toContain('acceso-secreto');
      expect(text).not.toContain('renovacion-secreta');
      expect(text).not.toContain('secret-de-prueba');
    }

    expect((await t.call('spotify', 'disconnect', { method: 'POST' })).status).toBe(200);
    expect(t.rows.size).toBe(0);
    expect((await t.call('spotify', 'now', { query: { k: WIDGET_KEY } })).body.status).toBe('not_connected');
  });

  it('la vuelta rechaza un state falso, el permiso denegado y las cuentas fuera de la lista', async () => {
    const t = setup((url) => (url.includes('/api/token') ? json({ access_token: 'a', expires_in: 3600, refresh_token: 'r' }) : json({}, 403)));
    expect((await t.call('spotify', 'callback', { query: { code: 'c', state: 'falso' } })).redirect).toContain('spotify=bad_state');
    const login = await t.call('spotify', 'login');
    const state = new URL(String(login.body.url)).searchParams.get('state') as string;
    const cookie = String(login.cookies?.[0]).split(';')[0];
    expect((await t.call('spotify', 'callback', { query: { error: 'access_denied', state }, headers: { cookie } })).redirect).toContain('spotify=denied');
    expect((await t.call('spotify', 'callback', { query: { code: 'c', state }, headers: { cookie } })).redirect).toContain('spotify=not_allowed');
    expect(t.rows.size).toBe(0);
    // El destino nunca sale de la petición
    const evil = await t.call('spotify', 'callback', { query: { code: 'c', state: 'x', redirect: 'https://malo.test', return_to: 'https://malo.test' } });
    expect(evil.redirect?.startsWith('https://lalo.test/#integraciones')).toBe(true);
  });

  it('la capa de OBS necesita una clave válida y tiene tope de consultas', async () => {
    const t = setup();
    expect((await t.call('spotify', 'now', { query: { k: 'corta' } })).status).toBe(400);
    expect((await t.call('spotify', 'now', { query: { k: 'x'.repeat(40) } })).status).toBe(404);
    const limiter = createLimiter(2);
    expect([limiter.tooMany('a', 0), limiter.tooMany('a', 1), limiter.tooMany('a', 2), limiter.tooMany('b', 2), limiter.tooMany('a', 60_001)]).toEqual([false, false, true, false, false]);
  });
});

const DONATION = {
  verification_token: 'clave-de-kofi-123',
  message_id: 'msg-1',
  timestamp: '2026-10-04T10:00:00Z',
  type: 'Donation',
  is_public: true,
  from_name: 'Vera Lozano',
  message: 'Para el café de hoy.',
  amount: '3.00',
  currency: 'EUR',
  url: 'https://ko-fi.com/x',
  email: 'vera@ejemplo.test',
  is_subscription_payment: false,
  is_first_subscription_payment: false,
  kofi_transaction_id: 'tx-1',
  tier_name: null,
  shop_items: null,
  shipping: { full_name: 'Vera Lozano', street_address: 'Calle Falsa 1' },
};
const form = (data: unknown) => `data=${encodeURIComponent(JSON.stringify(data))}`;

describe('integraciones: aviso de Ko-fi', () => {
  it('lee el cuerpo llegue como llegue', () => {
    expect(parseKofiBody(form(DONATION))?.message_id).toBe('msg-1');
    expect(parseKofiBody({ data: JSON.stringify(DONATION) })?.message_id).toBe('msg-1');
    expect(parseKofiBody({ data: DONATION })?.message_id).toBe('msg-1');
    expect(parseKofiBody(Buffer.from(form(DONATION)))?.message_id).toBe('msg-1');
    expect(parseKofiBody(JSON.stringify({ data: JSON.stringify(DONATION) }))?.message_id).toBe('msg-1');
    expect(parseKofiBody('data=no-es-json')).toBeNull();
    expect(parseKofiBody('x'.repeat(40_000))).toBeNull();
    expect(parseKofiBody(undefined)).toBeNull();
    expect(parseKofiBody({ otra: 1 })).toBeNull();
  });

  it('cada tipo de aviso', () => {
    expect(kofiKindOf('Donation', false, false)).toBe('don');
    expect(kofiKindOf('Subscription', true, true)).toBe('mem');
    expect(kofiKindOf('Subscription', true, false)).toBe('ren');
    expect(kofiKindOf('Donation', 'true', 'false')).toBe('ren');
    expect(kofiKindOf('Shop Order', false, false)).toBe('shop');
    expect(kofiKindOf('Commission', false, false)).toBe('com');
    expect(kofiKindOf(undefined, undefined, undefined)).toBe('don');
    expect(kofiAmount('12,5')).toBe(12.5);
    expect(kofiAmount('-3')).toBe(0);
    expect(kofiAmount(undefined)).toBe(0);
  });

  it('se queda con lo mínimo: sin correo, sin dirección de envío', () => {
    const payload = normalizeKofiPayload(DONATION);
    expect(payload?.event).toEqual({ kind: 'don', name: 'Vera Lozano', message: 'Para el café de hoy.', amount: 3, currency: 'EUR', tier: '', isPublic: true });
    const text = JSON.stringify(payload?.event);
    expect(text).not.toContain('ejemplo.test');
    expect(text).not.toContain('Calle Falsa');
    expect(text).not.toContain('tx-1');
  });

  it('privado: «Alguien» y sin mensaje; sin el dato, también', () => {
    expect(normalizeKofiPayload({ ...DONATION, is_public: false })?.event).toMatchObject({ name: 'Alguien', message: '', isPublic: false });
    const { is_public: _omit, ...rest } = DONATION;
    expect(normalizeKofiPayload(rest)?.event).toMatchObject({ name: 'Alguien', message: '' });
  });

  it('tolera campos ausentes y rechaza lo que no tiene clave o identificador', () => {
    expect(normalizeKofiPayload({ verification_token: 't', message_id: 'm', is_public: true })?.event).toEqual({
      kind: 'don',
      name: 'Alguien',
      message: '',
      amount: 0,
      currency: '',
      tier: '',
      isPublic: true,
    });
    expect(normalizeKofiPayload({ message_id: 'm' })).toBeNull();
    expect(normalizeKofiPayload({ verification_token: 't' })).toBeNull();
    expect(normalizeKofiPayload({ verification_token: 't', message_id: 'con espacios' })).toBeNull();
    expect(normalizeKofiPayload(null)).toBeNull();
  });
});

describe('integraciones: rutas de Ko-fi', () => {
  const connect = async (t: ReturnType<typeof setup>) => {
    const created = await t.call('kofi', 'connect', { method: 'POST' });
    const path = String(created.body.path);
    await t.call('kofi', 'token', { method: 'POST', body: { token: DONATION.verification_token } });
    return path.replace('/api/kofi/', '');
  };
  const hook = (t: ReturnType<typeof setup>, id: string, data: unknown) => t.call('kofi', id, { method: 'POST', body: form(data) });

  it('estados: sin conectar, con dirección, esperando y conectado', async () => {
    const t = setup();
    expect((await t.call('kofi', 'status')).body).toMatchObject({ configured: true, state: 'none', path: '' });
    const created = await t.call('kofi', 'connect', { method: 'POST' });
    expect(created.body.state).toBe('address');
    expect(String(created.body.path)).toMatch(/^\/api\/kofi\/[A-Za-z0-9_-]{43}$/);
    // Pedirla otra vez no la cambia
    expect((await t.call('kofi', 'connect', { method: 'POST' })).body.path).toBe(created.body.path);
    expect((await t.call('kofi', 'token', { method: 'POST', body: { token: 'x' } })).status).toBe(400);
    expect((await t.call('kofi', 'token', { method: 'POST', body: { token: DONATION.verification_token } })).body.state).toBe('waiting');

    const row = t.rows.get(`${PROFILE}:kofi`);
    expect(row?.secret_enc).not.toContain(DONATION.verification_token);
    expect(row?.hook_hash).toHaveLength(64);
    expect(JSON.stringify(row)).not.toContain(String(created.body.path).slice(10));

    const id = String(created.body.path).replace('/api/kofi/', '');
    expect((await hook(t, id, DONATION)).body).toEqual({ ok: true });
    expect((await t.call('kofi', 'status')).body).toMatchObject({ state: 'connected', raised: 3 });

    const again = await t.call('kofi', 'regenerate', { method: 'POST' });
    expect(again.body.path).not.toBe(created.body.path);
    expect(again.body.state).toBe('waiting');
    // La dirección anterior ya no sirve
    await hook(t, id, { ...DONATION, message_id: 'msg-viejo' });
    expect(t.ingested).toHaveLength(1);

    expect((await t.call('kofi', 'disconnect', { method: 'POST' })).body.state).toBe('none');
    expect(t.rows.size).toBe(0);
  });

  it('guarda el aviso reducido, suma a la meta en su moneda y no repite', async () => {
    const t = setup();
    const id = await connect(t);
    await hook(t, id, DONATION);
    expect(t.ingested[0]).toEqual({
      profileId: PROFILE,
      messageId: 'msg-1',
      payload: { ev: 'don', name: 'Vera Lozano', msg: 'Para el café de hoy.', amount: 3, currency: 'EUR', tier: '', pub: true },
      goalAdd: 3,
      recent: { name: 'Vera Lozano', amount: 3, currency: 'EUR', kind: 'don' },
    });
    // Ko-fi reintenta con el mismo identificador
    expect((await hook(t, id, DONATION)).body).toEqual({ ok: true });
    expect(t.ingested).toHaveLength(1);

    // Otra moneda: se anota sin sumar. Pedido de tienda: no suma. Por debajo del mínimo: ni cuenta
    await hook(t, id, { ...DONATION, message_id: 'm2', currency: 'USD' });
    await hook(t, id, { ...DONATION, message_id: 'm3', type: 'Shop Order', amount: '12' });
    await hook(t, id, { ...DONATION, message_id: 'm4', amount: '0.50' });
    expect(t.ingested.slice(1).map((item) => [item.goalAdd, Object.keys(item.recent).length > 0])).toEqual([
      [0, true],
      [0, true],
      [0, false],
    ]);
  });

  it('respeta lo que el streamer ajustó: qué tipos suman y la moneda de la meta', async () => {
    const t = setup();
    t.state.configs.kofi = { goal: { currency: 'usd' }, events: { don: { meta: false }, shop: { meta: true } } };
    const id = await connect(t);
    await hook(t, id, { ...DONATION, currency: 'USD' });
    await hook(t, id, { ...DONATION, message_id: 'm2', type: 'Shop Order', amount: '12', currency: 'USD' });
    expect(t.ingested.map((item) => item.goalAdd)).toEqual([0, 12]);
  });

  it('una clave incorrecta o una dirección desconocida reciben la misma respuesta y no guardan nada', async () => {
    const t = setup();
    const id = await connect(t);
    const good = await hook(t, id, DONATION);
    const badToken = await hook(t, id, { ...DONATION, message_id: 'm2', verification_token: 'otra-clave' });
    const unknown = await hook(t, randomId(32), { ...DONATION, message_id: 'm3' });
    const malformedId = await hook(t, 'corto', { ...DONATION, message_id: 'm4' });
    for (const res of [badToken, unknown, malformedId]) expect({ status: res.status, body: res.body }).toEqual({ status: good.status, body: good.body });
    expect(t.ingested).toHaveLength(1);
    // A su dueño sí se le cuenta que llegó un aviso con otra clave
    expect((await t.call('kofi', 'status')).body.badTokenAt).toBeTruthy();
    // Nunca se devuelven datos del aviso
    expect(JSON.stringify(good)).not.toContain('Vera');
  });

  it('cuerpos ilegibles, métodos y fallos de guardado', async () => {
    const t = setup();
    const id = await connect(t);
    expect((await t.call('kofi', id, { method: 'GET' })).status).toBe(405);
    expect((await t.call('kofi', id, { method: 'POST', body: 'nada' })).status).toBe(400);
    expect((await t.call('kofi', id, { method: 'POST', body: form(DONATION), headers: { 'content-length': '999999' } })).status).toBe(413);
    expect((await t.call('kofi', id, { method: 'POST', body: form(DONATION) }, {})).status).toBe(503);
    // Con la clave correcta y la base caída, Ko-fi debe reintentar
    t.state.failIngest = true;
    expect((await hook(t, id, DONATION)).status).toBe(500);
    t.state.failIngest = false;
    expect((await hook(t, id, DONATION)).status).toBe(200);
    expect(t.ingested).toHaveLength(1);
  });

  it('sin configurar y sin migración lo dice en claro', async () => {
    const t = setup();
    expect((await t.call('kofi', 'status', {}, { SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'y' })).body).toEqual({ configured: false, missing: ['INTEGRATIONS_ENC_KEY'] });
    t.state.missing = true;
    expect((await t.call('kofi', 'connect', { method: 'POST' })).body.code).toBe('migration_missing');
  });
});

describe('integraciones: enrutado', () => {
  it('estado del servidor solo para el administrador, sin valores de variables', async () => {
    const t = setup();
    expect((await t.call('integrations', 'status')).status).toBe(403);
    const admin = await handleIntegration('integrations', 'status', { method: 'GET', headers: {}, query: {}, body: undefined }, { ...ENV, FISH_AUDIO_API_KEY: 'clave-fish' }, {
      ...t.deps,
      auth: async () => ({ id: PROFILE, role: 'admin', status: 'active' }),
    });
    expect(admin.body).toMatchObject({ migration: 'ok', fish: { configured: true }, spotify: { missing: [], redirectUri: ENV.SPOTIFY_REDIRECT_URI } });
    expect(JSON.stringify(admin.body)).not.toContain('clave-fish');
    expect(JSON.stringify(admin.body)).not.toContain('secret-de-prueba');
  });

  it('rutas desconocidas y parámetros de la dirección', async () => {
    const t = setup();
    expect((await t.call('spotify', 'otra')).status).toBe(404);
    expect((await t.call('otro', 'status')).status).toBe(404);
    expect(queryOf({ url: '/api/spotify/now?k=abc&x=1', query: { g: 'spotify', k: ['zzz'] } })).toEqual({ k: 'zzz', x: '1', g: 'spotify' });
  });
});
