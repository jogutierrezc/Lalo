/**
 * tests/raid.test.ts
 *
 * Saludo de raid: ajustes validados, comandos de moderación, enlaces de cortos,
 * permisos, tamaño mínimo, espera, cola, duración en pantalla y la validación y
 * las respuestas de la ruta /api/twitch/clip (con Twitch simulado).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_RAID_COMMANDS,
  DEFAULT_RAID_SETTINGS,
  decodeRaidSettings,
  encodeRaidSettings,
  normalizeCommandName,
  normalizeRaidSettings,
} from '../src/types/raid';
import {
  CLIP_MARGIN_SECONDS,
  GreetingRequest,
  RAID_QUEUE_MAX,
  SOLO_SECONDS,
  canUseRaidCommands,
  clipEmbedUrl,
  clipLookupUrl,
  clipSeconds,
  cooldownLeft,
  displaySeconds,
  enqueueGreeting,
  normalizeLogin,
  parseClipRef,
  parseRaidCommand,
  raidPasses,
  readClipResponse,
  sampleGreeting,
  welcomeText,
} from '../src/utils/raidLogic';
import { LOOKUPS_PER_MINUTE, handleClipRequest, readTwitchConfig, resetClipState, validateClipQuery } from '../server/twitch/clips';
import { buildSuiteWidgetUrl } from '../src/utils/widgetUrl';
import { CONFIG_MODULES } from '../src/lib/cloudTypes';
import { MODULE_STORAGE_KEYS } from '../src/lib/cloudConfig';

describe('raid: ajustes', () => {
  it('sin nada guardado devuelve los valores por defecto', () => {
    expect(normalizeRaidSettings(null)).toEqual(DEFAULT_RAID_SETTINGS);
    expect(normalizeRaidSettings('basura')).toEqual(DEFAULT_RAID_SETTINGS);
    expect(DEFAULT_RAID_SETTINGS.minViewers).toBe(5);
    expect(DEFAULT_RAID_SETTINGS.maxClipSeconds).toBe(12);
    expect(DEFAULT_RAID_SETTINGS.clipDays).toBe(30);
    expect(DEFAULT_RAID_SETTINGS.frame).toBe('cabina');
  });

  it('recorta lo que se sale y descarta lo manipulado', () => {
    const result = normalizeRaidSettings({
      enabled: 'si',
      minViewers: -4,
      maxClipSeconds: 90,
      clipDays: 9999,
      frame: 'subido',
      voiceTemplate: '   ',
      cooldownSec: 'x',
      commands: { so: 'hola mundo', clip: '<script>', cut: '' },
    });
    expect(result.enabled).toBe(true);
    expect(result.minViewers).toBe(1);
    expect(result.maxClipSeconds).toBe(30);
    expect(result.clipDays).toBe(365);
    expect(result.frame).toBe('cabina');
    expect(result.voiceTemplate).toBe(DEFAULT_RAID_SETTINGS.voiceTemplate);
    expect(result.cooldownSec).toBe(DEFAULT_RAID_SETTINGS.cooldownSec);
    expect(result.commands).toEqual(DEFAULT_RAID_COMMANDS);
    expect(normalizeRaidSettings({ maxClipSeconds: 2 }).maxClipSeconds).toBe(5);
  });

  it('acepta nombres de comando propios y les pone el signo de exclamación', () => {
    expect(normalizeCommandName('Saludo', '!so')).toBe('!saludo');
    expect(normalizeCommandName('!ver_corto', '!clip')).toBe('!ver_corto');
    expect(normalizeCommandName('!!', '!so')).toBe('!so');
    expect(normalizeCommandName('un-nombre-larguisimo-de-verdad', '!so')).toBe('!so');
    expect(normalizeRaidSettings({ commands: { so: 'shoutout', clip: 'corto', cut: 'fuera' } }).commands).toEqual({
      so: '!shoutout',
      clip: '!corto',
      cut: '!fuera',
    });
  });

  it('no deja dos comandos con el mismo nombre', () => {
    const { commands } = normalizeRaidSettings({ commands: { so: '!x', clip: '!x', cut: '!x' } });
    expect(new Set(Object.values(commands)).size).toBe(3);
    expect(commands.so).toBe('!x');
  });

  it('viaja en la URL de OBS y vuelve igual', () => {
    const settings = { ...DEFAULT_RAID_SETTINGS, frame: 'comic' as const, minViewers: 20 };
    expect(decodeRaidSettings(encodeRaidSettings(settings))).toEqual(settings);
    expect(decodeRaidSettings('%%%')).toBeNull();
    expect(decodeRaidSettings(null)).toBeNull();
  });

  it('está conectado a la nube y tiene su fuente de OBS', () => {
    expect(CONFIG_MODULES).toContain('raid');
    expect(MODULE_STORAGE_KEYS.raid).toBe('lalo_raid_settings');
    const url = buildSuiteWidgetUrl('https://lalo.test', 'raid', 'laloplay_', undefined, { demo: '1' });
    expect(url).toBe('https://lalo.test/#widget?app=raid&channel=laloplay_&demo=1');
  });
});

describe('raid: enlaces e identificadores de cortos', () => {
  it('lee las dos formas de enlace y el id suelto', () => {
    expect(parseClipRef('https://clips.twitch.tv/IncredulousAbstemiousFennelImGlitch')).toBe('IncredulousAbstemiousFennelImGlitch');
    expect(parseClipRef('clips.twitch.tv/TameSlug-abc_DEF123')).toBe('TameSlug-abc_DEF123');
    expect(parseClipRef('https://www.twitch.tv/caro_tv/clip/SaltoImposible-x1Y2?filter=clips&range=7d')).toBe('SaltoImposible-x1Y2');
    expect(parseClipRef('https://m.twitch.tv/caro_tv/clip/SaltoImposible')).toBe('SaltoImposible');
    expect(parseClipRef('SaltoImposible-x1Y2')).toBe('SaltoImposible-x1Y2');
  });

  it('rechaza lo que no es un corto de Twitch', () => {
    expect(parseClipRef('')).toBeNull();
    expect(parseClipRef('https://evil.example/clips.twitch.tv/Abcd')).toBeNull();
    expect(parseClipRef('https://clips.twitch.tv.evil.example/Abcd')).toBeNull();
    expect(parseClipRef('https://www.twitch.tv/caro_tv')).toBeNull();
    expect(parseClipRef('https://www.twitch.tv/caro_tv/videos/123456')).toBeNull();
    expect(parseClipRef('https://clips.twitch.tv/embed?clip=Abcd')).toBeNull();
    expect(parseClipRef('https://clips.twitch.tv/Ab<script>')).toBeNull();
    expect(parseClipRef('abc')).toBeNull();
    expect(parseClipRef('javascript:alert(1)')).toBeNull();
    expect(parseClipRef('youtube.com')).toBeNull();
  });

  it('arma la dirección del reproductor oficial con el dominio de la página', () => {
    expect(clipEmbedUrl('SaltoImposible-x1Y2', 'lalo.example')).toBe(
      'https://clips.twitch.tv/embed?clip=SaltoImposible-x1Y2&parent=lalo.example&autoplay=true&muted=false'
    );
    expect(clipEmbedUrl('Abcd', 'localhost', true)).toContain('muted=true');
  });

  it('arma la consulta al servidor', () => {
    expect(clipLookupUrl({ login: 'Pau_RL' }, 30)).toBe('/api/twitch/clip?login=pau_rl&days=30');
    expect(clipLookupUrl({ clipId: 'SaltoImposible' }, 30)).toBe('/api/twitch/clip?id=SaltoImposible');
    expect(clipLookupUrl({ login: 'no vale' }, 30)).toBeNull();
    expect(clipLookupUrl({}, 30)).toBeNull();
  });
});

describe('raid: comandos de moderación', () => {
  const commands = DEFAULT_RAID_COMMANDS;

  it('entiende !so, !clip y !cortar', () => {
    expect(parseRaidCommand('!so pau_rl', commands)).toEqual({ kind: 'so', login: 'pau_rl' });
    expect(parseRaidCommand('  !SO   @Pau_RL ', commands)).toEqual({ kind: 'so', login: 'pau_rl' });
    expect(parseRaidCommand('!clip https://clips.twitch.tv/SaltoImposible', commands)).toEqual({ kind: 'clip', clipId: 'SaltoImposible' });
    expect(parseRaidCommand('!clip SaltoImposible-x1', commands)).toEqual({ kind: 'clip', clipId: 'SaltoImposible-x1' });
    expect(parseRaidCommand('!cortar', commands)).toEqual({ kind: 'cut' });
  });

  it('no hace nada con argumentos que faltan, sobran o no valen', () => {
    expect(parseRaidCommand('!so', commands)).toBeNull();
    expect(parseRaidCommand('!so pau rl', commands)).toBeNull();
    expect(parseRaidCommand('!so https://twitch.tv/pau_rl', commands)).toBeNull();
    expect(parseRaidCommand('!so nombre_demasiado_largo_para_twitch', commands)).toBeNull();
    expect(parseRaidCommand('!clip', commands)).toBeNull();
    expect(parseRaidCommand('!clip https://example.com/video', commands)).toBeNull();
    expect(parseRaidCommand('!cortar ya', commands)).toBeNull();
    expect(parseRaidCommand('!sorteo', commands)).toBeNull();
    expect(parseRaidCommand('hola !so pau_rl', commands)).toBeNull();
    expect(parseRaidCommand('', commands)).toBeNull();
  });

  it('usa los nombres que haya elegido el streamer', () => {
    const custom = { so: '!saludo', clip: '!corto', cut: '!fuera' };
    expect(parseRaidCommand('!saludo pau_rl', custom)).toEqual({ kind: 'so', login: 'pau_rl' });
    expect(parseRaidCommand('!fuera', custom)).toEqual({ kind: 'cut' });
    expect(parseRaidCommand('!so pau_rl', custom)).toBeNull();
  });

  it('solo el streamer y los moderadores pueden mandar', () => {
    expect(canUseRaidCommands('broadcaster')).toBe(true);
    expect(canUseRaidCommands('mod')).toBe(true);
    expect(canUseRaidCommands('vip')).toBe(false);
    expect(canUseRaidCommands('sub')).toBe(false);
    expect(canUseRaidCommands('viewer')).toBe(false);
  });

  it('valida el usuario de Twitch', () => {
    expect(normalizeLogin('@Pau_RL')).toBe('pau_rl');
    expect(normalizeLogin('#canal')).toBe('canal');
    expect(normalizeLogin('con espacio')).toBe('');
    expect(normalizeLogin('a'.repeat(26))).toBe('');
    expect(normalizeLogin('ñandú')).toBe('');
    expect(normalizeLogin(undefined)).toBe('');
  });
});

describe('raid: tamaño mínimo, espera y cola', () => {
  it('solo saluda raids con gente suficiente y con la capa encendida', () => {
    expect(raidPasses(5, { enabled: true, minViewers: 5 })).toBe(true);
    expect(raidPasses(4, { enabled: true, minViewers: 5 })).toBe(false);
    expect(raidPasses(500, { enabled: false, minViewers: 5 })).toBe(false);
    expect(raidPasses(Number.NaN, { enabled: true, minViewers: 1 })).toBe(false);
  });

  it('cuenta la espera de cada comando', () => {
    expect(cooldownLeft(undefined, 10_000, 30)).toBe(0);
    expect(cooldownLeft(10_000, 10_000, 30)).toBe(30);
    expect(cooldownLeft(10_000, 25_500, 30)).toBe(15);
    expect(cooldownLeft(10_000, 40_000, 30)).toBe(0);
    expect(cooldownLeft(10_000, 10_001, 0)).toBe(0);
  });

  it('el segundo saludo espera detrás del primero', () => {
    const a: GreetingRequest = { id: 'a', kind: 'raid', channel: 'uno', login: 'uno', viewers: 9 };
    const b: GreetingRequest = { id: 'b', kind: 'so', channel: 'dos', login: 'dos' };
    const first = enqueueGreeting([], a);
    const second = enqueueGreeting(first.queue, b);
    expect(second.accepted).toBe(true);
    expect(second.queue.map((item) => item.id)).toEqual(['a', 'b']);
    // La cola recibida no cambia
    expect(first.queue).toHaveLength(1);
  });

  it('no repite un saludo que ya espera y descarta lo que no cabe', () => {
    const so = (id: string, login: string): GreetingRequest => ({ id, kind: 'so', channel: login, login });
    const one = enqueueGreeting([], so('a', 'pau_rl'));
    expect(enqueueGreeting(one.queue, so('b', 'PAU_RL')).accepted).toBe(false);
    expect(enqueueGreeting(one.queue, { id: 'c', kind: 'raid', channel: 'pau_rl', login: 'pau_rl', viewers: 8 }).accepted).toBe(true);

    let queue: GreetingRequest[] = [];
    for (let i = 0; i < RAID_QUEUE_MAX; i += 1) queue = enqueueGreeting(queue, so(`s${i}`, `canal${i}`)).queue;
    expect(queue).toHaveLength(RAID_QUEUE_MAX);
    const full = enqueueGreeting(queue, so('z', 'otro'));
    expect(full.accepted).toBe(false);
    expect(full.queue).toHaveLength(RAID_QUEUE_MAX);

    const clip = enqueueGreeting([], { id: 'k1', kind: 'clip', clipId: 'SaltoImposible' });
    expect(enqueueGreeting(clip.queue, { id: 'k2', kind: 'clip', clipId: 'SaltoImposible' }).accepted).toBe(false);
    expect(enqueueGreeting(clip.queue, { id: 'k3', kind: 'clip', clipId: 'OtroCorto' }).accepted).toBe(true);
  });
});

describe('raid: tiempos y textos', () => {
  it('muestra el corto lo que dure, sin pasar del máximo', () => {
    expect(clipSeconds(8.2, 12)).toBe(9);
    expect(clipSeconds(18, 12)).toBe(12);
    expect(clipSeconds(60, 30)).toBe(30);
    expect(clipSeconds(0, 12)).toBe(0);
    expect(clipSeconds(Number.NaN, 12)).toBe(0);
  });

  it('retira el saludo al acabar el corto más un margen, o tras unos segundos si va solo', () => {
    expect(displaySeconds(18, 12)).toBeCloseTo(12 + CLIP_MARGIN_SECONDS);
    expect(displaySeconds(9, 12)).toBeCloseTo(9 + CLIP_MARGIN_SECONDS);
    expect(displaySeconds(null, 12)).toBe(SOLO_SECONDS);
    expect(displaySeconds(0, 12)).toBe(SOLO_SECONDS);
  });

  it('escribe la bienvenida con el canal y las personas', () => {
    expect(welcomeText('Gracias {canal}, hola a las {personas} personas', 'Streamer_Host', 48)).toBe(
      'Gracias Streamer Host, hola a las 48 personas'
    );
    expect(welcomeText('{canal} y {canal}', 'ana', 3)).toBe('ana y ana');
    expect(welcomeText('Hola', 'ana', 3)).toBe('Hola');
  });

  it('las muestras del estudio no necesitan al servidor', () => {
    expect(sampleGreeting('raid', 'nota').sample?.clip?.duration).toBe(18);
    expect(sampleGreeting('raid', 'nota').viewers).toBe(48);
    expect(sampleGreeting('none', 'nota').sample).toEqual({ state: 'none' });
    expect(sampleGreeting('so', 'nota').kind).toBe('so');
    expect(sampleGreeting('clip', 'nota').sample?.note).toBe('nota');
  });
});

describe('raid: respuesta del servidor leída por la capa', () => {
  it('lee un corto y limpia lo que no encaja', () => {
    const found = readClipResponse({
      status: 'ok',
      broadcaster: 'Pau_RL',
      clip: { id: 'SaltoImposible', title: 'Uno', duration: 14.5, creator: 'ana', thumbnail: 'http://sin-https/x.jpg', views: 33.4, broadcaster: 'Pau_RL', game: '' },
    });
    expect(found.state).toBe('ok');
    expect(found.clip).toMatchObject({ id: 'SaltoImposible', duration: 14.5, thumbnail: '', views: 33, game: null });
    expect(found.broadcaster).toBe('Pau_RL');
  });

  it('distingue sin cortos, sin configurar y error', () => {
    expect(readClipResponse({ status: 'no_clips', broadcaster: 'luz88' })).toMatchObject({ state: 'none', broadcaster: 'luz88' });
    expect(readClipResponse({ status: 'not_configured', missing: ['TWITCH_CLIENT_SECRET', 7] })).toMatchObject({
      state: 'not_configured',
      missing: ['TWITCH_CLIENT_SECRET'],
    });
    expect(readClipResponse({ status: 'twitch_error', error: 'Fallo' })).toMatchObject({ state: 'error', error: 'Fallo' });
    expect(readClipResponse(null).state).toBe('error');
    expect(readClipResponse({ status: 'ok', clip: { id: '<img>' } }).state).toBe('error');
  });
});

describe('raid: validación de /api/twitch/clip', () => {
  it('acepta un canal con sus días o un id de corto', () => {
    expect(validateClipQuery({ login: 'Pau_RL' })).toEqual({ ok: true, mode: 'login', login: 'pau_rl', days: 30 });
    expect(validateClipQuery({ login: 'pau_rl', days: '7' })).toEqual({ ok: true, mode: 'login', login: 'pau_rl', days: 7 });
    expect(validateClipQuery({ id: 'SaltoImposible-x1Y2' })).toEqual({ ok: true, mode: 'id', id: 'SaltoImposible-x1Y2' });
    expect(validateClipQuery({ check: '1' })).toEqual({ ok: true, mode: 'check' });
    // Express entrega un arreglo si el parámetro se repite: cuenta el primero
    expect(validateClipQuery({ login: ['pau_rl', 'otro'] })).toMatchObject({ ok: true, login: 'pau_rl' });
  });

  it('rechaza todo lo demás', () => {
    const bad = [
      {},
      { login: '' },
      { login: 'con espacio' },
      { login: 'a'.repeat(26) },
      { login: 'pau-rl' },
      { login: '../users' },
      { login: 'pau_rl', days: '0' },
      { login: 'pau_rl', days: '366' },
      { login: 'pau_rl', days: '7d' },
      { login: 'pau_rl', days: '-1' },
      { id: 'abc' },
      { id: 'Salto Imposible' },
      { id: 'Salto&broadcaster_id=1' },
      { id: 'x'.repeat(121) },
      { id: 'SaltoImposible', login: 'pau_rl' },
      { login: { a: 1 } },
    ];
    bad.forEach((query) => expect(validateClipQuery(query as Record<string, unknown>).ok, JSON.stringify(query)).toBe(false));
  });

  it('dice qué variable falta', () => {
    expect(readTwitchConfig({}).missing).toEqual(['VITE_TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET']);
    expect(readTwitchConfig({ VITE_TWITCH_CLIENT_ID: 'abc' }).missing).toEqual(['TWITCH_CLIENT_SECRET']);
    expect(readTwitchConfig({ TWITCH_CLIENT_ID: 'abc', TWITCH_CLIENT_SECRET: ' s ' })).toEqual({ clientId: 'abc', clientSecret: 's', missing: [] });
  });
});

describe('raid: /api/twitch/clip con Twitch simulado', () => {
  const env = { VITE_TWITCH_CLIENT_ID: 'cliente', TWITCH_CLIENT_SECRET: 'secreto' };
  const NOW = Date.parse('2026-10-03T12:00:00Z');

  interface Fake {
    calls: { url: string; init?: RequestInit }[];
    fetch: typeof fetch;
  }

  /** Twitch de mentira: cada ruta responde lo que diga `routes`. */
  function fakeTwitch(routes: Record<string, (url: URL) => { status?: number; body: unknown }>): Fake {
    const calls: Fake['calls'] = [];
    const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ url: url.toString(), init });
      const key = Object.keys(routes).find((path) => url.pathname.endsWith(path));
      const { status = 200, body } = key ? routes[key](url) : { status: 404, body: {} };
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    return { calls, fetch: fake };
  }

  const tokenRoute = () => ({ body: { access_token: 'tok', expires_in: 5000, token_type: 'bearer' } });
  const clip = (id: string, views: number) => ({
    id,
    title: `Título ${id}`,
    duration: 21.5,
    creator_name: 'ana',
    thumbnail_url: `https://static-cdn.jtvnw.net/${id}.jpg`,
    view_count: views,
    broadcaster_name: 'Pau_RL',
    game_id: '509658',
  });

  beforeEach(() => resetClipState());

  it('sin secreto responde «no configurado» y no llama a Twitch', async () => {
    const twitch = fakeTwitch({});
    const result = await handleClipRequest({ login: 'pau_rl' }, { VITE_TWITCH_CLIENT_ID: 'cliente' }, { fetch: twitch.fetch, now: () => NOW });
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ status: 'not_configured', missing: ['TWITCH_CLIENT_SECRET'] });
    expect(twitch.calls).toHaveLength(0);
    expect((await handleClipRequest({ check: '1' }, {}, { fetch: twitch.fetch, now: () => NOW })).status).toBe(503);
    expect((await handleClipRequest({ check: '1' }, env, { fetch: twitch.fetch, now: () => NOW })).body).toEqual({ status: 'ok', configured: true });
    expect(twitch.calls).toHaveLength(0);
  });

  it('una consulta mal escrita no llega a Twitch', async () => {
    const twitch = fakeTwitch({});
    const result = await handleClipRequest({ login: 'no vale' }, env, { fetch: twitch.fetch, now: () => NOW });
    expect(result.status).toBe(400);
    expect(result.body.status).toBe('bad_request');
    expect(twitch.calls).toHaveLength(0);
  });

  it('devuelve el corto más visto de los últimos días, con el juego', async () => {
    const twitch = fakeTwitch({
      '/oauth2/token': tokenRoute,
      '/helix/users': () => ({ body: { data: [{ id: '42', login: 'pau_rl', display_name: 'Pau_RL' }] } }),
      '/helix/clips': () => ({ body: { data: [clip('Segundo', 10), clip('Primero', 900)] } }),
      '/helix/games': () => ({ body: { data: [{ id: '509658', name: 'Just Chatting' }] } }),
    });
    const result = await handleClipRequest({ login: 'pau_rl', days: '7' }, env, { fetch: twitch.fetch, now: () => NOW });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      status: 'ok',
      broadcaster: 'Pau_RL',
      clip: { id: 'Primero', views: 900, duration: 21.5, creator: 'ana', game: 'Just Chatting', broadcaster: 'Pau_RL' },
    });

    const token = twitch.calls[0];
    expect(token.url).toBe('https://id.twitch.tv/oauth2/token');
    expect(token.init?.method).toBe('POST');
    expect(String(token.init?.body)).toBe('client_id=cliente&client_secret=secreto&grant_type=client_credentials');

    const clipsCall = new URL(twitch.calls.find((call) => call.url.includes('/helix/clips'))!.url);
    expect(clipsCall.searchParams.get('broadcaster_id')).toBe('42');
    expect(clipsCall.searchParams.get('started_at')).toBe('2026-09-26T12:00:00.000Z');
    expect(clipsCall.searchParams.get('ended_at')).toBe('2026-10-03T12:00:00.000Z');
    const headers = twitch.calls[1].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
    expect(headers['Client-Id']).toBe('cliente');
    // El secreto nunca sale en la respuesta
    expect(JSON.stringify(result.body)).not.toContain('secreto');
  });

  it('guarda el permiso y las respuestas: la segunda consulta no vuelve a Twitch', async () => {
    const twitch = fakeTwitch({
      '/oauth2/token': tokenRoute,
      '/helix/users': (url) => ({ body: { data: [{ id: '42', login: url.searchParams.get('login'), display_name: 'Canal' }] } }),
      '/helix/clips': () => ({ body: { data: [clip('Primero', 900)] } }),
      '/helix/games': () => ({ body: { data: [] } }),
    });
    const deps = { fetch: twitch.fetch, now: () => NOW };
    await handleClipRequest({ login: 'pau_rl' }, env, deps);
    const after = twitch.calls.length;
    await handleClipRequest({ login: 'pau_rl' }, env, deps);
    expect(twitch.calls).toHaveLength(after);
    // Otro canal: nueva búsqueda, mismo permiso
    await handleClipRequest({ login: 'otro' }, env, deps);
    expect(twitch.calls.filter((call) => call.url.includes('oauth2/token'))).toHaveLength(1);
  });

  it('si no hay cortos recientes busca el más visto de siempre', async () => {
    const twitch = fakeTwitch({
      '/oauth2/token': tokenRoute,
      '/helix/users': () => ({ body: { data: [{ id: '42', login: 'pau_rl', display_name: 'Pau_RL' }] } }),
      '/helix/clips': (url) => ({ body: { data: url.searchParams.has('started_at') ? [] : [clip('Antiguo', 5)] } }),
      '/helix/games': () => ({ status: 500, body: {} }),
    });
    const result = await handleClipRequest({ login: 'pau_rl' }, env, { fetch: twitch.fetch, now: () => NOW });
    expect(result.body).toMatchObject({ status: 'ok', clip: { id: 'Antiguo', game: null } });
  });

  it('distingue canal sin cortos, canal que no existe y corto que no existe', async () => {
    const twitch = fakeTwitch({
      '/oauth2/token': tokenRoute,
      '/helix/users': (url) => ({
        body: { data: url.searchParams.get('login') === 'luz88' ? [{ id: '7', login: 'luz88', display_name: 'Luz88' }] : [] },
      }),
      '/helix/clips': () => ({ body: { data: [] } }),
    });
    const deps = { fetch: twitch.fetch, now: () => NOW };
    expect((await handleClipRequest({ login: 'luz88' }, env, deps)).body).toEqual({ status: 'no_clips', broadcaster: 'Luz88' });
    const missing = await handleClipRequest({ login: 'nadie' }, env, deps);
    expect(missing.status).toBe(404);
    expect(missing.body.status).toBe('not_found');
    const gone = await handleClipRequest({ id: 'CortoBorrado' }, env, deps);
    expect(gone.status).toBe(404);
  });

  it('pide un corto concreto por su id', async () => {
    const twitch = fakeTwitch({
      '/oauth2/token': tokenRoute,
      '/helix/clips': (url) => ({ body: { data: [clip(url.searchParams.get('id') || '', 12)] } }),
      '/helix/games': () => ({ body: { data: [{ name: 'Celeste' }] } }),
    });
    const result = await handleClipRequest({ id: 'SaltoImposible' }, env, { fetch: twitch.fetch, now: () => NOW });
    expect(result.body).toMatchObject({ status: 'ok', clip: { id: 'SaltoImposible', game: 'Celeste' }, broadcaster: 'Pau_RL' });
    expect(twitch.calls.some((call) => call.url.includes('/helix/users'))).toBe(false);
  });

  it('con el permiso caducado pide otro una sola vez', async () => {
    let tokens = 0;
    let clipCalls = 0;
    const twitch = fakeTwitch({
      '/oauth2/token': () => {
        tokens += 1;
        return { body: { access_token: `tok${tokens}`, expires_in: 5000 } };
      },
      '/helix/clips': () => {
        clipCalls += 1;
        return clipCalls === 1 ? { status: 401, body: {} } : { body: { data: [clip('SaltoImposible', 1)] } };
      },
      '/helix/games': () => ({ body: { data: [] } }),
    });
    const result = await handleClipRequest({ id: 'SaltoImposible' }, env, { fetch: twitch.fetch, now: () => NOW });
    expect(result.status).toBe(200);
    expect(tokens).toBe(2);
  });

  it('explica el fallo cuando Twitch rechaza el secreto o no responde', async () => {
    const rejected = fakeTwitch({ '/oauth2/token': () => ({ status: 403, body: { message: 'invalid client secret' } }) });
    const first = await handleClipRequest({ login: 'pau_rl' }, env, { fetch: rejected.fetch, now: () => NOW });
    expect(first.status).toBe(502);
    expect(first.body).toMatchObject({ status: 'twitch_error', error: 'Twitch rechazó el Client ID o el Client Secret del servidor.' });

    resetClipState();
    const down = {
      fetch: (async () => {
        throw new Error('sin red');
      }) as typeof fetch,
      now: () => NOW,
    };
    const second = await handleClipRequest({ login: 'pau_rl' }, env, down);
    expect(second.body).toMatchObject({ status: 'twitch_error', error: 'No se pudo consultar a Twitch.' });
  });

  it('limita las búsquedas nuevas por minuto', async () => {
    const twitch = fakeTwitch({
      '/oauth2/token': tokenRoute,
      '/helix/users': () => ({ body: { data: [] } }),
    });
    const deps = { fetch: twitch.fetch, now: () => NOW };
    for (let i = 0; i < LOOKUPS_PER_MINUTE; i += 1) {
      expect((await handleClipRequest({ login: `canal${i}` }, env, deps)).status).toBe(404);
    }
    const blocked = await handleClipRequest({ login: 'uno_mas' }, env, deps);
    expect(blocked.status).toBe(429);
    // Pasado el minuto vuelve a atender
    const later = await handleClipRequest({ login: 'uno_mas' }, env, { fetch: twitch.fetch, now: () => NOW + 61_000 });
    expect(later.status).toBe(404);
  });
});
