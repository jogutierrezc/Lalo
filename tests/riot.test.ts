/**
 * tests/riot.test.ts
 *
 * Servidor de Riot Games con `fetch` simulado (nada de esto toca a Riot de
 * verdad): el Riot ID, la tabla de servidores, lo que se lee de cada respuesta
 * (solo el participante del streamer, y sin dar por hecho ningún campo), la
 * foto con su memoria de 45 s, la espera del 429, el PUUID que hay que volver a
 * resolver tras un cambio de clave, las rutas del panel y de la capa, y que la
 * clave de Riot y el PUUID no salen nunca en una respuesta ni en el registro.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleIntegration } from '../server/integrations/handlers';
import type { Deps, IntegrationRequest } from '../server/integrations/http';
import {
  RIOT_CACHE_MS,
  RIOT_PLATFORMS,
  parseRiotId,
  platformOf,
  readChampions,
  readLive,
  readMastery,
  readMatch,
  readRank,
  readRiotMeta,
  resetRiotMemory,
  riotGet,
  riotRetryAfter,
} from '../server/integrations/riot';
import { resetRiotRoutes } from '../server/integrations/riotRoutes';
import { MigrationMissingError, type AccountRow, type Store } from '../server/integrations/store';

const RIOT_KEY = 'RGAPI-clave-secreta-de-prueba-0000';
const PROFILE = '11111111-2222-3333-4444-555555555555';
const WIDGET_KEY = 'w'.repeat(40);
const PUUID = 'p'.repeat(60);
const NEW_PUUID = 'n'.repeat(60);
const RIVAL = 'r'.repeat(60);

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', RIOT_API_KEY: RIOT_KEY };

function memoryStore() {
  const rows = new Map<string, AccountRow>();
  const state = { missing: false, upsertError: '' };
  const id = (profileId: string, provider: string) => `${profileId}:${provider}`;
  const guard = () => {
    if (state.missing) throw new MigrationMissingError();
  };
  const store: Store = {
    profileByWidgetKey: async (key) => (key === WIDGET_KEY ? PROFILE : null),
    profileActive: async (profileId) => profileId === PROFILE,
    get: async (profileId, provider) => (guard(), rows.get(id(profileId, provider)) ?? null),
    byHook: async () => null,
    upsert: async (profileId, provider, patch) => {
      guard();
      if (state.upsertError) throw new Error(state.upsertError);
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
    config: async () => null,
    ingestKofi: async () => 'ok',
  };
  return { store, rows, state };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

// ---------- Respuestas de Riot de ejemplo (formas escritas de memoria) ----------

const CHAMPIONS = { data: { Ahri: { key: '103', name: 'Ahri' }, MonkeyKing: { key: '62', name: 'Wukong' } } };
const LEAGUE = [
  { queueType: 'RANKED_FLEX_SR', tier: 'SILVER', rank: 'I', leaguePoints: 3, wins: 1, losses: 2 },
  { queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: 'II', leaguePoints: 12, wins: 48, losses: 41 },
];
const participant = (puuid: string, patch: Record<string, unknown> = {}) => ({
  puuid,
  championId: 103,
  championName: 'Ahri',
  win: true,
  kills: 9,
  deaths: 2,
  assists: 11,
  pentaKills: 0,
  gameEndedInEarlySurrender: false,
  ...patch,
});
const MATCH = {
  metadata: { matchId: 'LA1_1001' },
  info: {
    gameDuration: 1860,
    queueId: 420,
    participants: [participant(RIVAL, { championId: 62, championName: 'MonkeyKing', win: false, kills: 20, deaths: 20, assists: 20, riotIdGameName: 'RivalSecreto' }), participant(PUUID)],
  },
};
const SPECTATOR = {
  gameId: 777,
  gameQueueConfigId: 420,
  participants: [{ puuid: RIVAL, championId: 62, riotId: 'RivalSecreto#XXX' }, { puuid: PUUID, championId: 103 }],
};
const MASTERY = [{ championId: 103, championLevel: 7, championPoints: 152300 }, { championId: 62, championLevel: 4, championPoints: 20000 }, 'basura', null];

type Route = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;

/** Riot simulado: cuenta, liga, partida en curso, lista de partidas, detalle y maestría. `over` manda primero. */
function riotFetch(over: Route = () => undefined) {
  return (url: string, init?: RequestInit): Response | Promise<Response> => {
    const custom = over(url, init);
    if (custom) return custom;
    if (url.includes('ddragon.leagueoflegends.com/api/versions.json')) return json(['15.20.1', '15.19.1']);
    if (url.includes('ddragon.leagueoflegends.com/cdn/')) return json(CHAMPIONS);
    if (url.includes('/riot/account/v1/accounts/by-riot-id/')) return json({ puuid: PUUID, gameName: 'Lalo', tagLine: 'LAN' });
    if (url.includes('/lol/league/v4/entries/by-puuid/')) return json(LEAGUE);
    if (url.includes('/lol/spectator/v5/active-games/by-summoner/')) return json({ status: { status_code: 404 } }, 404);
    if (url.includes('/ids?')) return json(['LA1_1001']);
    if (url.includes('/lol/match/v5/matches/LA1_')) return json(MATCH);
    if (url.includes('/lol/champion-mastery/v4/')) return json(MASTERY);
    return json({}, 500);
  };
}

function setup(fetchImpl: (url: string, init?: RequestInit) => Response | Promise<Response> = riotFetch()) {
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
  const call = (part: string, req: Partial<IntegrationRequest> = {}, env: Record<string, string | undefined> = ENV) =>
    handleIntegration('riot', part, { method: 'GET', headers: {}, query: {}, body: undefined, ...req }, env, deps);
  const link = (riotId = 'Lalo#LAN', platform = 'la1') => call('link', { method: 'POST', body: { riotId, platform } });
  const photo = () => call('state', { query: { k: WIDGET_KEY } });
  /** Llamadas a la API de Riot (sin Data Dragon). */
  const riotCalls = () => calls.filter((item) => item.url.includes('api.riotgames.com'));
  return { ...memory, clock, calls, riotCalls, call, link, photo, deps };
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetRiotMemory();
  resetRiotRoutes();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
});

/** Nada de lo dicho (respuestas o registro) lleva la clave de Riot. */
function expectNoKey(...things: unknown[]) {
  const said = JSON.stringify(things) + JSON.stringify(errorSpy.mock.calls.map((args) => args.map(String)));
  expect(said).not.toContain(RIOT_KEY);
  expect(said).not.toContain('RGAPI');
}

describe('riot: Riot ID y servidores', () => {
  it('parte nombre y etiqueta por la última almohadilla', () => {
    expect(parseRiotId('Lalo#LAN')).toEqual({ gameName: 'Lalo', tagLine: 'LAN' });
    expect(parseRiotId('  El  Gran Lalo #1234 ')).toEqual({ gameName: 'El Gran Lalo', tagLine: '1234' });
    expect(parseRiotId('Niño#ÑÑÑ')).toEqual({ gameName: 'Niño', tagLine: 'ÑÑÑ' });
  });

  it('rechaza lo que no es un Riot ID', () => {
    for (const bad of ['', 'Lalo', '#LAN', 'Lalo#', 'ab#LAN', 'Lalo#LA', 'Lalo#DEMASIADO', 'Lalo#L N', 'a'.repeat(17) + '#LAN', 'La/lo#LAN', 'La?lo#LAN', null, 42, {}]) {
      expect(parseRiotId(bad)).toBeNull();
    }
    expect(parseRiotId('x'.repeat(200) + '#LAN')).toBeNull();
  });

  it('cada servidor tiene su región de cuenta y de partidas', () => {
    expect(platformOf('la1')).toMatchObject({ account: 'americas', match: 'americas' });
    expect(platformOf('la2')?.match).toBe('americas');
    expect(platformOf('euw1')).toMatchObject({ account: 'europe', match: 'europe' });
    expect(platformOf('kr')).toMatchObject({ account: 'asia', match: 'asia' });
    expect(platformOf('oc1')).toMatchObject({ account: 'asia', match: 'sea' });
    expect(platformOf('marte')).toBeNull();
    expect(platformOf(undefined)).toBeNull();
    // account-v1 no existe en «sea»
    expect(RIOT_PLATFORMS.every((item) => ['americas', 'europe', 'asia'].includes(item.account))).toBe(true);
    expect(new Set(RIOT_PLATFORMS.map((item) => item.id)).size).toBe(RIOT_PLATFORMS.length);
  });

  it('lo guardado solo vale si está completo', () => {
    expect(readRiotMeta({ platform: 'la1', puuid: PUUID, gameName: 'Lalo', tagLine: 'LAN' })).toEqual({ platform: 'la1', puuid: PUUID, gameName: 'Lalo', tagLine: 'LAN' });
    expect(readRiotMeta({ platform: 'marte', puuid: PUUID, gameName: 'Lalo', tagLine: 'LAN' })).toBeNull();
    expect(readRiotMeta({ platform: 'la1', puuid: 'corto', gameName: 'Lalo', tagLine: 'LAN' })).toBeNull();
    expect(readRiotMeta({ platform: 'la1', puuid: PUUID })).toBeNull();
    expect(readRiotMeta(null)).toBeNull();
    expect(readRiotMeta('x')).toBeNull();
  });
});

describe('riot: lo que se lee de cada respuesta', () => {
  const champions = readChampions(CHAMPIONS);

  it('saca los nombres de campeón por id y tolera cualquier forma', () => {
    expect(champions.get(103)).toBe('Ahri');
    expect(champions.get(62)).toBe('Wukong');
    expect(readChampions(null).size).toBe(0);
    expect(readChampions({ data: { X: { key: 'no', name: 'X' }, Y: 7, Z: { key: '5' } } }).size).toBe(0);
  });

  it('el rango es el de solo/dúo; sin él, o con una liga desconocida, no hay rango', () => {
    expect(readRank(LEAGUE)).toEqual({ tier: 'GOLD', division: 'II', lp: 12, wins: 48, losses: 41 });
    expect(readRank([LEAGUE[0]])).toBeNull();
    expect(readRank([])).toBeNull();
    expect(readRank({})).toBeNull();
    expect(readRank([{ queueType: 'RANKED_SOLO_5x5', tier: 'WOOD', rank: 'I' }])).toBeNull();
    // Campos ausentes o de otro tipo no rompen
    expect(readRank([{ queueType: 'RANKED_SOLO_5x5', tier: 'master', leaguePoints: '300', wins: null }])).toEqual({ tier: 'MASTER', division: 'I', lp: 0, wins: 0, losses: 0 });
  });

  it('de una partida terminada solo se lee al streamer', () => {
    const last = readMatch(MATCH, 'LA1_1001', PUUID, champions);
    expect(last).toEqual({
      matchId: 'LA1_1001',
      win: true,
      remake: false,
      ranked: true,
      champion: 'Ahri',
      queue: 'Clasificatoria solo/dúo',
      durationSec: 1860,
      kills: 9,
      deaths: 2,
      assists: 11,
      pentaKills: 0,
    });
    const said = JSON.stringify(last);
    expect(said).not.toContain('Wukong');
    expect(said).not.toContain('MonkeyKing');
    expect(said).not.toContain('RivalSecreto');
    expect(said).not.toContain(RIVAL);
    expect(said).not.toContain(PUUID);
  });

  it('una partida sin el streamer, o con otra forma, no vale', () => {
    expect(readMatch(MATCH, 'LA1_1001', 'otro'.repeat(10), champions)).toBeNull();
    expect(readMatch({}, 'LA1_1001', PUUID, champions)).toBeNull();
    expect(readMatch({ info: { participants: 'x' } }, 'LA1_1001', PUUID, champions)).toBeNull();
    expect(readMatch(null, 'LA1_1001', PUUID, champions)).toBeNull();
  });

  it('una partida con campos ausentes sale con ceros, y la duración antigua en milisegundos se convierte', () => {
    const last = readMatch({ info: { gameDuration: 1_800_000, participants: [{ puuid: PUUID }] } }, 'LA1_7', PUUID, champions);
    expect(last).toMatchObject({ win: false, remake: false, ranked: false, champion: '', queue: 'Partida', durationSec: 1800, kills: 0, deaths: 0, assists: 0, pentaKills: 0 });
    // Sin Data Dragon se usa el nombre que trae la partida
    expect(readMatch(MATCH, 'LA1_1001', PUUID, new Map())?.champion).toBe('Ahri');
  });

  it('de la partida en curso solo se lee el campeón del streamer', () => {
    const live = readLive(SPECTATOR, PUUID, champions);
    expect(live).toEqual({ gameId: '777', champion: 'Ahri', queue: 'Clasificatoria solo/dúo' });
    expect(JSON.stringify(live)).not.toContain('Rival');
    expect(readLive({}, PUUID, champions)).toBeNull();
    expect(readLive({ gameId: 5 }, PUUID, champions)).toEqual({ gameId: '5', champion: '', queue: 'Partida' });
  });

  it('la maestría descarta lo que no es una entrada', () => {
    expect(readMastery(MASTERY, champions)).toEqual([
      { championId: 103, champion: 'Ahri', level: 7, points: 152300 },
      { championId: 62, champion: 'Wukong', level: 4, points: 20000 },
    ]);
    expect(readMastery(null, champions)).toEqual([]);
  });

  it('la espera del 429 se acota', () => {
    expect(riotRetryAfter('7')).toBe(7);
    expect(riotRetryAfter('9999')).toBe(120);
    expect(riotRetryAfter(null)).toBe(10);
    expect(riotRetryAfter('pronto')).toBe(10);
  });

  it('una petición manda la clave en la cabecera, nunca en la dirección, y no lanza', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const ok = await riotGet('https://la1.api.riotgames.com/x', RIOT_KEY, (async (url: string, init?: RequestInit) => {
      seen.push({ url, headers: init?.headers as Record<string, string> });
      return json({ a: 1 });
    }) as typeof fetch);
    expect(ok).toEqual({ kind: 'ok', json: { a: 1 } });
    expect(seen[0].headers['X-Riot-Token']).toBe(RIOT_KEY);
    expect(seen[0].url).not.toContain(RIOT_KEY);

    const boom = await riotGet('https://la1.api.riotgames.com/x', RIOT_KEY, (async () => {
      throw new Error(`fallo de red con ${RIOT_KEY}`);
    }) as typeof fetch);
    expect(boom).toEqual({ kind: 'error' });
    expect(await riotGet('u', RIOT_KEY, (async () => json(null, 404)) as typeof fetch)).toEqual({ kind: 'not_found' });
    expect(await riotGet('u', RIOT_KEY, (async () => json({}, 400)) as typeof fetch)).toEqual({ kind: 'bad_request' });
    expect(await riotGet('u', RIOT_KEY, (async () => json({}, 403)) as typeof fetch)).toEqual({ kind: 'forbidden' });
    expect(await riotGet('u', RIOT_KEY, (async () => json({}, 429, { 'retry-after': '3' })) as typeof fetch)).toEqual({ kind: 'limited', retryAfterSec: 3 });
    expect(await riotGet('u', RIOT_KEY, (async () => new Response('no es json', { status: 200 })) as typeof fetch)).toEqual({ kind: 'error' });
  });
});

describe('riot: panel', () => {
  it('sin clave en el servidor, el estado dice qué falta y nadie puede vincular', async () => {
    const t = setup();
    const env = { ...ENV, RIOT_API_KEY: '  ' };
    const status = await t.call('status', {}, env);
    expect(status.body).toMatchObject({ configured: false, missing: ['RIOT_API_KEY'] });
    const link = await t.call('link', { method: 'POST', body: { riotId: 'Lalo#LAN', platform: 'la1' } }, env);
    expect(link.status).toBe(503);
    expect(link.body.code).toBe('not_configured');
    expect(t.riotCalls()).toHaveLength(0);
  });

  it('cada ruta solo admite su método, y una acción desconocida no existe', async () => {
    const t = setup();
    expect((await t.call('link')).status).toBe(405);
    expect((await t.call('unlink')).status).toBe(405);
    expect((await t.call('status', { method: 'POST' })).status).toBe(405);
    expect((await t.call('borrar')).status).toBe(404);
  });

  it('sin sesión no se entra', async () => {
    const t = setup();
    const denied = await handleIntegration('riot', 'status', { method: 'GET', headers: {}, query: {}, body: undefined }, ENV, {
      ...t.deps,
      auth: async () => ({ status: 401, body: { error: 'Hay que iniciar sesión.', code: 'no_session' } }),
    });
    expect(denied.status).toBe(401);
  });

  it('un Riot ID o un servidor que no valen no llegan a Riot', async () => {
    const t = setup();
    const badId = await t.link('SinEtiqueta');
    expect(badId.status).toBe(400);
    expect(badId.body.code).toBe('bad_riot_id');
    const badPlatform = await t.link('Lalo#LAN', 'marte');
    expect(badPlatform.status).toBe(400);
    expect(badPlatform.body.code).toBe('bad_platform');
    expect((await t.call('link', { method: 'POST', body: 'texto' })).status).toBe(400);
    expect(t.calls).toHaveLength(0);
  });

  it('vincula: resuelve la cuenta en la región del servidor y guarda servidor, PUUID y Riot ID', async () => {
    const t = setup(riotFetch((url) => (url.includes('/riot/account/') ? json({ puuid: PUUID, gameName: 'LALO', tagLine: 'lan' }) : undefined)));
    const result = await t.link('lalo#LAN', 'euw1');
    expect(result.status).toBe(200);
    // El nombre queda como lo escribe Riot
    expect(result.body).toMatchObject({ state: 'linked', riotId: 'LALO#lan', platform: 'euw1' });
    expect(t.calls[0].url).toBe('https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/lalo/LAN');
    expect((t.calls[0].init?.headers as Record<string, string>)['X-Riot-Token']).toBe(RIOT_KEY);
    const row = t.rows.get(`${PROFILE}:riot`);
    expect(row?.meta).toEqual({ platform: 'euw1', puuid: PUUID, gameName: 'LALO', tagLine: 'lan' });
    expect(row?.secret_enc).toBeNull();
    expect(row?.account_name).toBe('LALO#lan');
    // Ni el PUUID ni la clave vuelven al navegador
    expect(JSON.stringify(result.body)).not.toContain(PUUID);
    expectNoKey(result);

    const status = await t.call('status');
    expect(status.body).toMatchObject({ configured: true, state: 'linked', riotId: 'LALO#lan', platform: 'euw1' });
    expect(JSON.stringify(status.body)).not.toContain(PUUID);
    expect((status.body.platforms as unknown[]).length).toBe(RIOT_PLATFORMS.length);
  });

  it('el nombre con espacios y acentos viaja codificado en la dirección', async () => {
    const t = setup();
    await t.link('El Niño#LAN');
    expect(t.calls[0].url).toContain('/by-riot-id/El%20Ni%C3%B1o/LAN');
  });

  it('cuenta no encontrada, clave caducada, espera y caída de Riot: cada una con su mensaje y sin guardar nada', async () => {
    for (const [status, code, http] of [[404, 'riot_not_found', 404], [403, 'riot_key', 502], [401, 'riot_key', 502], [429, 'riot_limited', 429], [500, 'riot_error', 502]] as const) {
      resetRiotRoutes();
      const t = setup(() => json({ status: { message: `detalle interno ${RIOT_KEY}` } }, status));
      const result = await t.link();
      expect(result.status).toBe(http);
      expect(result.body.code).toBe(code);
      expect(t.rows.size).toBe(0);
      expectNoKey(result);
    }
  });

  it('una cuenta sin PUUID válido no se guarda', async () => {
    const t = setup(() => json({ gameName: 'Lalo', tagLine: 'LAN' }));
    const result = await t.link();
    expect(result.body.code).toBe('riot_error');
    expect(t.rows.size).toBe(0);
  });

  it('si fetch lanza con la clave en el mensaje, la clave no sale ni en la respuesta ni en el registro', async () => {
    const t = setup(() => {
      throw new Error(`connect ECONNREFUSED https://americas.api.riotgames.com/?api_key=${RIOT_KEY}`);
    });
    const result = await t.link();
    expect(result.status).toBe(502);
    expectNoKey(result);
  });

  it('desvincula: borra la fila', async () => {
    const t = setup();
    await t.link();
    expect(t.rows.size).toBe(1);
    const result = await t.call('unlink', { method: 'POST' });
    expect(result.body).toEqual({ state: 'none' });
    expect(t.rows.size).toBe(0);
    expect((await t.call('status')).body).toMatchObject({ state: 'none', riotId: '' });
  });

  it('sin la migración 0015 lo dice con su número, no con el de la 0013', async () => {
    const t = setup();
    t.state.missing = true;
    for (const result of [await t.call('status'), await t.link()]) {
      expect(result.status).toBe(503);
      expect(result.body.code).toBe('migration_missing');
      expect(String(result.body.error)).toContain('0015');
      expect(String(result.body.error)).not.toContain('0013');
    }
    // El check de `provider` de 0013 rechaza «riot», o PostgREST no conoce la columna `meta`
    for (const error of ['Supabase: 23514', 'Supabase: PGRST204']) {
      resetRiotRoutes();
      const other = setup();
      other.state.upsertError = error;
      const result = await other.link();
      expect(result.body.code).toBe('migration_missing');
      expect(String(result.body.error)).toContain('0015');
    }
  });

  it('otro fallo de la base es un error del servidor, sin detalles', async () => {
    const t = setup();
    t.state.upsertError = `Supabase: 500 ${RIOT_KEY}`;
    const result = await t.link();
    expect(result.status).toBe(502);
    expect(result.body.code).toBe('server_error');
    expect(JSON.stringify(result.body)).not.toContain(RIOT_KEY);
  });

  it('el administrador ve si hay clave y cuántas cuentas hay vinculadas, nunca la clave', async () => {
    const t = setup();
    await t.link();
    const admin = await handleIntegration('integrations', 'status', { method: 'GET', headers: {}, query: {}, body: undefined }, ENV, {
      ...t.deps,
      auth: async () => ({ id: PROFILE, role: 'admin', status: 'active' }),
    });
    // Riot no guarda secreto: sus cuentas no cuentan como plazas con secreto, pero sí como vinculadas
    expect(admin.body.riot).toEqual({ configured: true, linked: 1 });
    expectNoKey(admin);
    const without = await handleIntegration('integrations', 'status', { method: 'GET', headers: {}, query: {}, body: undefined }, { ...ENV, RIOT_API_KEY: undefined }, {
      ...t.deps,
      auth: async () => ({ id: PROFILE, role: 'admin', status: 'active' }),
    });
    expect(without.body.riot).toMatchObject({ configured: false });
  });
});

describe('riot: la foto para la capa de OBS', () => {
  it('la clave de widget tiene que tener buena forma y existir', async () => {
    const t = setup();
    expect((await t.call('state')).status).toBe(400);
    expect((await t.call('state', { query: { k: 'corta' } })).body.code).toBe('bad_key');
    expect((await t.call('state', { query: { k: 'x'.repeat(40) } })).status).toBe(404);
    expect(t.riotCalls()).toHaveLength(0);
  });

  it('sin clave de Riot en el servidor dice «not_configured» y no pregunta a nadie', async () => {
    const t = setup();
    const result = await t.call('state', { query: { k: WIDGET_KEY } }, { ...ENV, RIOT_API_KEY: '' });
    expect(result.body).toEqual({ status: 'not_configured' });
    expect(t.calls).toHaveLength(0);
  });

  it('sin cuenta vinculada dice «not_linked» y no pregunta a Riot', async () => {
    const t = setup();
    const result = await t.photo();
    expect(result.body).toMatchObject({ status: 'not_linked', rank: null, live: null, last: null, mastery: [] });
    expect(t.riotCalls()).toHaveLength(0);
  });

  it('arma la foto con rango, última partida y maestría, por los servidores correctos', async () => {
    const t = setup();
    await t.link('Lalo#LAN', 'la1');
    t.calls.length = 0;
    const result = await t.photo();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      status: 'ok',
      riotId: 'Lalo#LAN',
      rank: { tier: 'GOLD', division: 'II', lp: 12, wins: 48, losses: 41 },
      live: null,
      last: { matchId: 'LA1_1001', win: true, champion: 'Ahri', kills: 9, deaths: 2, assists: 11 },
    });
    expect((result.body.mastery as unknown[]).length).toBe(2);
    const urls = t.riotCalls().map((item) => item.url);
    expect(urls).toContain(`https://la1.api.riotgames.com/lol/league/v4/entries/by-puuid/${PUUID}`);
    expect(urls).toContain(`https://la1.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${PUUID}`);
    expect(urls).toContain(`https://americas.api.riotgames.com/lol/match/v5/matches/by-puuid/${PUUID}/ids?start=0&count=1`);
    expect(urls).toContain('https://americas.api.riotgames.com/lol/match/v5/matches/LA1_1001');
    expect(urls.some((url) => url.startsWith('https://la1.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/'))).toBe(true);
    // Todas con la clave en la cabecera y ninguna en la dirección
    t.riotCalls().forEach((item) => {
      expect((item.init?.headers as Record<string, string>)['X-Riot-Token']).toBe(RIOT_KEY);
      expect(item.url).not.toContain(RIOT_KEY);
    });
    // Data Dragon no recibe la clave
    t.calls.filter((item) => item.url.includes('ddragon')).forEach((item) => expect(JSON.stringify(item.init?.headers)).not.toContain(RIOT_KEY));
  });

  it('la foto no lleva la clave, ni el PUUID, ni nada de los demás jugadores', async () => {
    const t = setup(riotFetch((url) => (url.includes('/lol/spectator/') ? json(SPECTATOR) : undefined)));
    await t.link();
    const result = await t.photo();
    expect(result.body.live).toEqual({ gameId: '777', champion: 'Ahri', queue: 'Clasificatoria solo/dúo' });
    const said = JSON.stringify(result);
    expectNoKey(result);
    expect(said).not.toContain(PUUID);
    expect(said).not.toContain(RIVAL);
    expect(said).not.toContain('RivalSecreto');
    expect(said).not.toContain('"kills":20');
  });

  it('varias fuentes comparten la misma foto durante 45 s, y dos a la vez esperan la misma', async () => {
    const t = setup();
    await t.link();
    t.calls.length = 0;
    const [a, b] = await Promise.all([t.photo(), t.photo()]);
    expect(a.body.status).toBe('ok');
    expect(b.body.last).toEqual(a.body.last);
    const first = t.riotCalls().length;
    expect(first).toBe(5);
    t.clock.now += RIOT_CACHE_MS - 1000;
    const later = await t.photo();
    expect(t.riotCalls().length).toBe(first);
    expect(later.body.ageMs).toBe(RIOT_CACHE_MS - 1000);
  });

  it('pasados los 45 s vuelve a preguntar, pero el detalle de la misma partida no se pide otra vez', async () => {
    const t = setup();
    await t.link();
    t.calls.length = 0;
    await t.photo();
    t.clock.now += RIOT_CACHE_MS + 1;
    await t.photo();
    expect(t.riotCalls().length).toBe(9);
    expect(t.riotCalls().filter((item) => item.url.endsWith('/matches/LA1_1001'))).toHaveLength(1);
    // Data Dragon tampoco se vuelve a pedir
    expect(t.calls.filter((item) => item.url.includes('ddragon'))).toHaveLength(2);
  });

  it('con 429 respeta Retry-After: no pregunta a Riot mientras dura y conserva la última foto', async () => {
    let limited = false;
    const t = setup(riotFetch((url) => (limited && url.includes('/lol/league/') ? json({}, 429, { 'retry-after': '30' }) : undefined)));
    await t.link();
    const good = await t.photo();
    expect(good.body.status).toBe('ok');
    limited = true;
    t.clock.now += RIOT_CACHE_MS + 1;
    const blocked = await t.photo();
    expect(blocked.body.status).toBe('limited');
    // Lo último que se supo sigue ahí; la capa no lo compara porque el estado no es «ok»
    expect(blocked.body.rank).toEqual(good.body.rank);
    const asked = t.riotCalls().length;
    t.clock.now += 20_000;
    expect((await t.photo()).body.status).toBe('limited');
    expect(t.riotCalls().length).toBe(asked);
    // Pasada la espera, vuelve a preguntar
    limited = false;
    t.clock.now += 11_000;
    expect((await t.photo()).body.status).toBe('ok');
    expect(t.riotCalls().length).toBeGreaterThan(asked);
  });

  it('PUUID rechazado tras un cambio de clave: lo vuelve a resolver desde el Riot ID guardado', async () => {
    const t = setup(
      riotFetch((url) => {
        if (url.includes('/riot/account/')) return json({ puuid: NEW_PUUID, gameName: 'Lalo', tagLine: 'LAN' });
        // El PUUID viejo ya no descifra con la clave nueva
        if (url.includes(PUUID)) return json({ status: { message: 'Bad Request - Exception decrypting' } }, 400);
        if (url.includes('/lol/match/v5/matches/LA1_')) return json({ ...MATCH, info: { ...MATCH.info, participants: [participant(NEW_PUUID)] } });
        return undefined;
      })
    );
    t.rows.set(`${PROFILE}:riot`, {
      profile_id: PROFILE,
      provider: 'riot',
      secret_enc: null,
      hook_hash: null,
      hook_enc: null,
      account_name: 'Lalo#LAN',
      status: 'connected',
      connected_at: new Date(0).toISOString(),
      last_event_at: null,
      last_error: null,
      last_error_at: null,
      goal_raised: 0,
      recent: [],
      meta: { platform: 'la1', puuid: PUUID, gameName: 'Lalo', tagLine: 'LAN' },
    });
    const result = await t.photo();
    expect(result.body.status).toBe('ok');
    expect(result.body.last).toMatchObject({ matchId: 'LA1_1001', kills: 9 });
    expect((t.rows.get(`${PROFILE}:riot`)?.meta as { puuid: string }).puuid).toBe(NEW_PUUID);
    expect(t.riotCalls().filter((item) => item.url.includes('/riot/account/'))).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(NEW_PUUID);
  });

  it('si al volver a resolver Riot ya no conoce la cuenta, queda en error y no entra en bucle', async () => {
    const t = setup(riotFetch((url) => (url.includes('/riot/account/') ? json({}, 404) : url.includes(PUUID) ? json({}, 400) : undefined)));
    t.rows.set(`${PROFILE}:riot`, { ...({} as AccountRow), profile_id: PROFILE, provider: 'riot', meta: { platform: 'la1', puuid: PUUID, gameName: 'Lalo', tagLine: 'LAN' } });
    const result = await t.photo();
    expect(result.body.status).toBe('error');
    expect(t.riotCalls().filter((item) => item.url.includes('/riot/account/'))).toHaveLength(1);
  });

  it('clave del servidor caducada: «key_invalid», sin datos inventados', async () => {
    const t = setup();
    await t.link();
    const dead = setup(() => json({ status: { message: 'Forbidden' } }, 403));
    dead.rows.set(`${PROFILE}:riot`, t.rows.get(`${PROFILE}:riot`) as AccountRow);
    resetRiotMemory();
    const result = await dead.photo();
    expect(result.body).toMatchObject({ status: 'key_invalid', rank: null, last: null });
    expectNoKey(result);
  });

  it('si falla la liga o la lista de partidas no hay foto; si falla solo la maestría, sí', async () => {
    const broken = setup(riotFetch((url) => (url.includes('/ids?') ? json({}, 500) : undefined)));
    await broken.link();
    expect((await broken.photo()).body.status).toBe('error');

    resetRiotMemory();
    resetRiotRoutes();
    const partial = setup(riotFetch((url) => (url.includes('/lol/champion-mastery/') ? json({}, 500) : undefined)));
    await partial.link();
    expect((await partial.photo()).body).toMatchObject({ status: 'ok', mastery: [] });
  });

  it('un fallo de spectator que no es 404 no se toma por «no está en partida»', async () => {
    const t = setup(riotFetch((url) => (url.includes('/lol/spectator/') ? json({}, 503) : undefined)));
    await t.link();
    expect((await t.photo()).body.status).toBe('error');
  });

  it('una cuenta sin partidas da una foto válida sin última partida', async () => {
    const t = setup(riotFetch((url) => (url.includes('/ids?') ? json([]) : url.includes('/lol/league/') ? json([]) : undefined)));
    await t.link();
    expect((await t.photo()).body).toMatchObject({ status: 'ok', rank: null, last: null });
  });

  it('respuestas con formas inesperadas no rompen la ruta', async () => {
    const t = setup(
      riotFetch((url) => {
        if (url.includes('/lol/league/')) return json({ no: 'es una lista' });
        if (url.includes('/ids?')) return json([{ raro: true }, 7]);
        if (url.includes('/lol/champion-mastery/')) return json('texto');
        if (url.includes('ddragon')) return json(null, 500);
        return undefined;
      })
    );
    await t.link();
    const result = await t.photo();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ status: 'ok', rank: null, last: null, mastery: [] });
  });

  it('el detalle de una partida que aún no existe se espera a la siguiente lectura', async () => {
    let ready = false;
    const t = setup(riotFetch((url) => (!ready && url.includes('/matches/LA1_') ? json({}, 404) : undefined)));
    await t.link();
    expect((await t.photo()).body.status).toBe('error');
    ready = true;
    t.clock.now += RIOT_CACHE_MS + 1;
    expect((await t.photo()).body).toMatchObject({ status: 'ok', last: { matchId: 'LA1_1001' } });
  });

  it('demasiadas consultas con la misma clave se frenan', async () => {
    const t = setup();
    let last = await t.photo();
    for (let i = 0; i < 40; i += 1) last = await t.photo();
    expect(last.status).toBe(429);
    expect(last.body.code).toBe('busy');
  });

  it('al desvincular se olvida la foto guardada', async () => {
    const t = setup();
    await t.link();
    expect((await t.photo()).body.status).toBe('ok');
    await t.call('unlink', { method: 'POST' });
    expect((await t.photo()).body.status).toBe('not_linked');
  });
});
