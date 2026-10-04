/**
 * tests/integrationsLayers.test.ts
 *
 * Capas de integraciones: cuándo se muestra y se oculta «Ahora suena», qué pasa
 * entre dos lecturas del servidor, sus ajustes (guardados y en la URL), los
 * comandos del chat, y las reglas de las alertas de Ko-fi (mínimo, nivel,
 * alerta grande, cola, privacidad, meta por moneda).
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KOFI_RULES,
  KOFI_QUEUE_MAX,
  decideKofi,
  enqueueKofi,
  fillKofiTemplate,
  kofiGoalAdd,
  kofiMoney,
  parseStoredKofiEvent,
  pushKofiRecent,
  readKofiRecent,
  readKofiRules,
  type KofiEvent,
} from '../server/integrations/kofiRules';
import { pickAccent } from '../src/components/integraciones/coverAccent';
import { kofiSettingsForWidget, musicSettingsForWidget } from '../src/components/integraciones/widgetSettings';
import { MODULE_STORAGE_KEYS } from '../src/lib/cloudConfig';
import { CONFIG_MODULES } from '../src/lib/cloudTypes';
import { DEFAULT_KOFI_SETTINGS, decodeKofiSettings, encodeKofiSettings, kofiRuleSet, normalizeKofiSettings } from '../src/types/kofi';
import { DEFAULT_MUSIC_SETTINGS, decodeMusicSettings, encodeMusicSettings, normalizeMusicSettings, parseMusicCommand } from '../src/types/music';
import { KOFI_SAMPLES, kofiSamplePayload } from '../src/utils/kofiSamples';
import {
  MUSIC_IDLE,
  SAMPLE_TRACKS,
  formatClock,
  hideAfterMs,
  inputsFromReading,
  musicStep,
  parseNowResponse,
  progressRatio,
  type MusicInput,
  type MusicRules,
  type MusicState,
} from '../src/utils/musicRules';
import { buildSuiteWidgetUrl } from '../src/utils/widgetUrl';

const CAMBIO: MusicRules = { show: 'cambio', pause: 'atenuar' };
const run = (rules: MusicRules, inputs: MusicInput[], from: MusicState = MUSIC_IDLE) =>
  inputs.reduce((acc, input) => musicStep(acc.state, input, rules), { state: from, effects: [] } as ReturnType<typeof musicStep>);

describe('ahora suena: cuándo se muestra', () => {
  it('al cambiar de canción entra y arma la retirada; la siguiente hace la transición sin salir', () => {
    const first = musicStep(MUSIC_IDLE, { type: 'song', trackId: 'a' }, CAMBIO);
    expect(first.state).toEqual({ music: true, playing: true, vis: true, trackId: 'a' });
    expect(first.effects).toEqual(['render', 'enter', 'arm']);
    const second = musicStep(first.state, { type: 'song', trackId: 'b' }, CAMBIO);
    expect(second.effects).toEqual(['swap', 'arm']);
    expect(hideAfterMs('cambio', 8)).toBe(8000);
    expect(hideAfterMs('siempre', 8)).toBeNull();
    expect(hideAfterMs('oculto', 8)).toBeNull();
  });

  it('pasados los segundos se retira y vuelve con la canción siguiente', () => {
    const gone = run(CAMBIO, [{ type: 'song', trackId: 'a' }, { type: 'timeout' }]);
    expect(gone.state.vis).toBe(false);
    expect(gone.effects).toEqual(['disarm', 'leave']);
    expect(musicStep(gone.state, { type: 'song', trackId: 'b' }, CAMBIO).effects).toEqual(['render', 'enter', 'arm']);
  });

  it('en «Oculta» no aparece sola: solo con el botón o el comando, y se queda', () => {
    const rules: MusicRules = { show: 'oculto', pause: 'atenuar' };
    const song = musicStep(MUSIC_IDLE, { type: 'song', trackId: 'a' }, rules);
    expect(song.state.vis).toBe(false);
    expect(song.effects).toEqual(['render']);
    const shown = musicStep(song.state, { type: 'live', action: 'show' }, rules);
    expect(shown.state.vis).toBe(true);
    expect(shown.effects).toEqual(['enter', 'arm']);
    expect(musicStep(shown.state, { type: 'live', action: 'hide' }, rules).effects).toEqual(['disarm', 'leave']);
  });

  it('en pausa se atenúa o se oculta, según el ajuste', () => {
    const dim = run(CAMBIO, [{ type: 'song', trackId: 'a' }, { type: 'pause' }]);
    expect(dim.state).toMatchObject({ vis: true, playing: false });
    expect(dim.effects).toEqual([]);
    const hide: MusicRules = { show: 'siempre', pause: 'ocultar' };
    const hidden = run(hide, [{ type: 'song', trackId: 'a' }, { type: 'pause' }]);
    expect(hidden.state.vis).toBe(false);
    // En pausa y con «se oculta», pedir mostrarla explica por qué no sale
    expect(musicStep(hidden.state, { type: 'live', action: 'show' }, hide).refused).toBe('paused');
    expect(musicStep(hidden.state, { type: 'resume' }, hide).state.vis).toBe(true);
  });

  it('si deja de sonar se retira, y sin música no hay nada que mostrar', () => {
    const stopped = run({ show: 'siempre', pause: 'atenuar' }, [{ type: 'song', trackId: 'a' }, { type: 'stop' }]);
    expect(stopped.state).toMatchObject({ music: false, vis: false });
    expect(stopped.effects).toContain('leave');
    expect(musicStep(stopped.state, { type: 'live', action: 'show' }, CAMBIO).refused).toBe('no_music');
    expect(musicStep(MUSIC_IDLE, { type: 'pause' }, CAMBIO).effects).toEqual([]);
    expect(musicStep(MUSIC_IDLE, { type: 'resume' }, CAMBIO).state.vis).toBe(false);
  });

  it('una canción que llega en pausa no hace aparecer la capa', () => {
    const paused = musicStep(MUSIC_IDLE, { type: 'song', trackId: 'a', playing: false }, CAMBIO);
    expect(paused.state).toEqual({ music: true, playing: false, vis: false, trackId: 'a' });
    expect(paused.effects).toEqual(['render']);
  });

  it('cambiar los ajustes con la capa montada', () => {
    const on = musicStep(MUSIC_IDLE, { type: 'song', trackId: 'a' }, CAMBIO).state;
    expect(musicStep(on, { type: 'rules', changed: 'show' }, { show: 'oculto', pause: 'atenuar' }).state.vis).toBe(false);
    const paused = { ...on, playing: false };
    expect(musicStep(paused, { type: 'rules', changed: 'pause' }, { show: 'cambio', pause: 'ocultar' }).effects).toContain('leave');
    expect(musicStep(on, { type: 'preview' }, CAMBIO).effects).toEqual(['enter', 'arm']);
    expect(musicStep(MUSIC_IDLE, { type: 'preview' }, CAMBIO).refused).toBe('no_music');
  });
});

describe('ahora suena: lecturas del servidor', () => {
  const track = SAMPLE_TRACKS[0];
  it('de una lectura a la siguiente', () => {
    expect(inputsFromReading(MUSIC_IDLE, { track: null, playing: false })).toEqual([]);
    expect(inputsFromReading(MUSIC_IDLE, { track, playing: true })).toEqual([{ type: 'song', trackId: track.id, playing: true }]);
    const playing: MusicState = { music: true, playing: true, vis: true, trackId: track.id };
    expect(inputsFromReading(playing, { track, playing: true })).toEqual([]);
    expect(inputsFromReading(playing, { track, playing: false })).toEqual([{ type: 'pause' }]);
    expect(inputsFromReading({ ...playing, playing: false }, { track, playing: true })).toEqual([{ type: 'resume' }]);
    expect(inputsFromReading(playing, { track: SAMPLE_TRACKS[1], playing: true })[0]).toMatchObject({ type: 'song', trackId: SAMPLE_TRACKS[1].id });
    expect(inputsFromReading(playing, { track: null, playing: false })).toEqual([{ type: 'stop' }]);
  });

  it('entiende la respuesta: canción, anuncio, sin conectar, archivo local', () => {
    const body = { status: 'ok', kind: 'track', playing: true, progressMs: 10_000, ageMs: 2_000, track: { id: 'x', title: 'T', artists: 'A', album: 'B', art: 'https://i.scdn.co/x', durationMs: 60_000, explicit: true, local: false, url: 'https://open.spotify.com/x' } };
    const now = parseNowResponse(body);
    expect(now.progressMs).toBe(12_000);
    expect(now.reading.track).toMatchObject({ id: 'x', title: 'T', art: 'https://i.scdn.co/x', explicit: true });
    // En pausa el tiempo no avanza con la edad de la lectura
    expect(parseNowResponse({ ...body, playing: false }).progressMs).toBe(10_000);
    expect(parseNowResponse({ ...body, kind: 'ad' }).reading.track).toBeNull();
    expect(parseNowResponse({ status: 'not_connected' })).toMatchObject({ status: 'not_connected', reading: { track: null } });
    expect(parseNowResponse({ ...body, status: 'rate_limited' }).reading.track?.title).toBe('T');
    expect(parseNowResponse({ ...body, track: { ...body.track, local: true } }).reading.track?.art).toBeNull();
    expect(parseNowResponse({ ...body, track: { ...body.track, art: 'http://x/y' } }).reading.track?.art).toBeNull();
    expect(parseNowResponse(null).status).toBe('error');
  });

  it('reloj y barra', () => {
    expect(formatClock(62_000)).toBe('1:02');
    expect(formatClock(-5)).toBe('0:00');
    expect(progressRatio(30, 60)).toBe(0.5);
    expect(progressRatio(90, 60)).toBe(1);
    expect(progressRatio(10, 0)).toBe(0);
  });

  it('el acento sale del tono vivo que más pesa en la portada', () => {
    const pixels = [...Array(10).fill([200, 30, 30, 255]), ...Array(3).fill([30, 30, 200, 255]), ...Array(20).fill([128, 128, 128, 255])].flat();
    expect(pickAccent(pixels)).toBe('#eb2323');
    expect(pickAccent([128, 128, 128, 255])).toBeNull();
  });
});

describe('ahora suena: ajustes y comandos', () => {
  it('sin nada guardado devuelve los valores por defecto y sanea lo raro', () => {
    expect(normalizeMusicSettings(null)).toEqual(DEFAULT_MUSIC_SETTINGS);
    const odd = normalizeMusicSettings({ design: 'otro', secs: 999, size: 5, pos: 'zz', color: 'rojo', commands: { show: 'Cancion Nueva', hide: '!cancion' } });
    expect(odd).toMatchObject({ design: 'ficha', secs: 30, size: 70, pos: 'bl', color: '#b68cff' });
    expect(odd.commands.show).not.toBe(odd.commands.hide);
  });

  it('va y vuelve por la URL, sin la orden en directo', () => {
    const settings = normalizeMusicSettings({ design: 'disco', show: 'siempre', secs: 12, pause: 'ocultar', pos: 'tr', size: 120, album: true, accent: 'fixed', color: '#00ff88', live: { action: 'show', at: 5 } });
    const back = decodeMusicSettings(encodeMusicSettings(settings));
    expect(back).toEqual({ ...settings, live: { action: null, at: 0 } });
    expect(decodeMusicSettings('%%%')).toBeNull();
    expect(decodeMusicSettings(null)).toBeNull();
  });

  it('la fuente usa la URL si la nube no entregó nada, y el parámetro design manda', () => {
    const ms = encodeMusicSettings(normalizeMusicSettings({ design: 'franja' }));
    const get = (params: Record<string, string>) => (key: string) => params[key] ?? null;
    expect(musicSettingsForWidget(get({ ms }), DEFAULT_MUSIC_SETTINGS, false).design).toBe('franja');
    expect(musicSettingsForWidget(get({ ms }), DEFAULT_MUSIC_SETTINGS, true).design).toBe('ficha');
    expect(musicSettingsForWidget(get({ ms, design: 'Portada' }), DEFAULT_MUSIC_SETTINGS, false).design).toBe('portada');
    expect(musicSettingsForWidget(get({ design: 'nada' }), DEFAULT_MUSIC_SETTINGS, false).design).toBe('ficha');
  });

  it('comandos: solo la primera palabra, sin distinguir mayúsculas', () => {
    const commands = DEFAULT_MUSIC_SETTINGS.commands;
    expect(parseMusicCommand('!cancion', commands)).toBe('show');
    expect(parseMusicCommand('  !CANCION por favor', commands)).toBe('show');
    expect(parseMusicCommand('!ocultarcancion', commands)).toBe('hide');
    expect(parseMusicCommand('pon !cancion', commands)).toBeNull();
    expect(parseMusicCommand('!cancionero', commands)).toBeNull();
    expect(parseMusicCommand('!musica', { show: '!musica', hide: '!fuera' })).toBe('show');
  });

  it('los módulos y las fuentes existen', () => {
    expect(CONFIG_MODULES).toContain('music');
    expect(CONFIG_MODULES).toContain('kofi');
    expect(MODULE_STORAGE_KEYS.music).toBe('lalo_music_settings');
    expect(MODULE_STORAGE_KEYS.kofi).toBe('lalo_kofi_settings');
    expect(buildSuiteWidgetUrl('https://lalo.test', 'music', 'canal', undefined, { demo: '1', design: 'disco' })).toBe(
      'https://lalo.test/#widget?app=music&channel=canal&demo=1&design=disco'
    );
    expect(buildSuiteWidgetUrl('https://lalo.test', 'kofigoal', 'canal', undefined, { k: 'abc' })).toBe('https://lalo.test/#widget?app=kofigoal&channel=canal&k=abc');
  });
});

const RULES = kofiRuleSet(DEFAULT_KOFI_SETTINGS);
const event = (patch: Partial<KofiEvent> = {}): KofiEvent => ({ kind: 'don', name: 'Vera', message: 'Hola', amount: 5, currency: 'EUR', tier: '', isPublic: true, ...patch });

describe('ko-fi: reglas de las alertas', () => {
  it('una donación normal: alerta, voz y meta', () => {
    expect(decideKofi(event(), RULES, 6, false)).toEqual({ skip: null, alert: true, big: false, hold: 6, title: 'Gracias, Vera', message: 'Hola', voice: true, goalAdd: 5 });
  });

  it('por debajo del mínimo no cuenta para nada', () => {
    const decision = decideKofi(event({ amount: 0.5 }), RULES, 6, false);
    expect(decision).toMatchObject({ skip: 'min', alert: false, voice: false, goalAdd: 0 });
  });

  it('alerta grande desde el umbral: más tiempo en pantalla', () => {
    expect(decideKofi(event({ amount: 19.99 }), RULES, 6, false)).toMatchObject({ big: false, hold: 6 });
    expect(decideKofi(event({ amount: 20 }), RULES, 6, false)).toMatchObject({ big: true, hold: 9 });
    // Solo las donaciones tienen alerta grande
    expect(decideKofi(event({ kind: 'com', amount: 400 }), RULES, 6, false).big).toBe(false);
  });

  it('filtro por nivel en las membresías', () => {
    const rules = readKofiRules({ events: { mem: { tier: ' oro ' } } });
    expect(decideKofi(event({ kind: 'mem', tier: 'Oro' }), rules, 6, false).skip).toBeNull();
    expect(decideKofi(event({ kind: 'mem', tier: 'Plata' }), rules, 6, false)).toMatchObject({ skip: 'tier', alert: false, goalAdd: 0 });
    expect(decideKofi(event({ kind: 'mem', tier: 'Oro' }), rules, 6, false).title).toBe('Vera se une a Oro');
  });

  it('con la alerta apagada sigue contando para la meta y los últimos apoyos', () => {
    const rules = readKofiRules({ events: { don: { on: false } } });
    expect(decideKofi(event(), rules, 6, false)).toMatchObject({ skip: null, alert: false, voice: false, goalAdd: 5 });
  });

  it('privado o con palabra bloqueada: ni se ve ni se lee', () => {
    const stored = parseStoredKofiEvent({ ev: 'don', name: 'Nombre real', msg: 'Texto', amount: 5, currency: 'EUR', pub: false });
    expect(stored).toMatchObject({ name: 'Alguien', message: '', isPublic: false });
    expect(decideKofi(stored as KofiEvent, RULES, 6, false)).toMatchObject({ title: 'Gracias, Alguien', message: '', voice: false, alert: true });
    expect(decideKofi(event(), RULES, 6, true)).toMatchObject({ message: '', voice: false, alert: true });
    // Sin mensaje no hay nada que leer
    expect(decideKofi(event({ message: '' }), RULES, 6, false).voice).toBe(false);
    // La voz apagada para ese tipo
    expect(decideKofi(event({ kind: 'ren' }), RULES, 6, false).voice).toBe(false);
  });

  it('la meta solo suma en su moneda y solo los tipos que suman', () => {
    expect(kofiGoalAdd(event({ amount: 7 }), RULES)).toBe(7);
    expect(kofiGoalAdd(event({ amount: 7, currency: 'USD' }), RULES)).toBe(0);
    expect(kofiGoalAdd(event({ kind: 'shop', amount: 12 }), RULES)).toBe(0);
    const usd = readKofiRules({ goal: { currency: 'usd' }, events: { shop: { meta: true } } });
    expect(usd.goalCurrency).toBe('USD');
    expect(kofiGoalAdd(event({ kind: 'shop', amount: 12, currency: 'USD' }), usd)).toBe(12);
    expect([3, 25, 5].reduce((sum, amount) => sum + kofiGoalAdd(event({ amount }), RULES), 64)).toBe(97);
  });

  it('la cola tiene tope y los últimos apoyos son una lista corta', () => {
    let queue: number[] = [];
    for (let i = 0; i < KOFI_QUEUE_MAX + 4; i += 1) queue = enqueueKofi(queue, i);
    expect(queue).toHaveLength(KOFI_QUEUE_MAX);
    expect(queue[0]).toBe(0);
    let recent = readKofiRecent([{ name: 'A', amount: 1, currency: 'EUR', kind: 'don' }, { name: 'B', kind: 'otro' }, 'x']);
    expect(recent).toHaveLength(1);
    for (let i = 0; i < 8; i += 1) recent = pushKofiRecent(recent, { name: `N${i}`, amount: i, currency: 'EUR', kind: 'don' });
    expect(recent).toHaveLength(5);
    expect(recent[0].name).toBe('N7');
  });

  it('texto y cantidades', () => {
    expect(fillKofiTemplate('{nombre} dio {cantidad} {moneda} {otra}', { nombre: 'Ana', cantidad: '3,00', moneda: 'EUR', mensaje: '', nivel: '' })).toBe('Ana dio 3,00 EUR {otra}');
    expect(kofiMoney(12.5)).toBe('12,50');
    expect(kofiMoney(3)).toBe('3,00');
    expect(decideKofi(event(), readKofiRules({ events: { don: { tpl: '' } } }), 6, false).title).toBe('Vera');
  });

  it('las pruebas del panel tienen la forma de un aviso real', () => {
    for (const id of Object.keys(KOFI_SAMPLES) as (keyof typeof KOFI_SAMPLES)[]) {
      expect(parseStoredKofiEvent(kofiSamplePayload(id, 'EUR'))).not.toBeNull();
    }
    expect(parseStoredKofiEvent(kofiSamplePayload('bad', 'EUR'))?.blockedSample).toBe(true);
    // Un aviso real no puede marcarse como bloqueado de prueba
    expect(parseStoredKofiEvent({ ev: 'don', name: 'x', amount: 1, pub: true, blk: true })?.blockedSample).toBe(false);
    expect(parseStoredKofiEvent({ ev: 'otra' })).toBeNull();
    expect(parseStoredKofiEvent({ ev: 'don', amount: 3, pub: true, raised: 67 })?.raised).toBe(67);
  });
});

describe('ko-fi: ajustes', () => {
  it('valores por defecto y saneado', () => {
    expect(normalizeKofiSettings(null)).toEqual(DEFAULT_KOFI_SETTINGS);
    expect(DEFAULT_KOFI_SETTINGS.events).toEqual(DEFAULT_KOFI_RULES);
    const odd = normalizeKofiSettings({ design: 'x', hold: 99, size: 1, goal: { target: -5, currency: 'euros', layout: 'otra' }, events: { don: { min: -3, big: 0, snd: 'ruido' } } });
    expect(odd).toMatchObject({ design: 'recibo', hold: 15, size: 70, goal: { target: 1, currency: 'EUR', layout: 'barra' } });
    expect(odd.events.don).toMatchObject({ min: 0, big: 1, snd: 'arcade-chime' });
  });

  it('van y vuelven por la URL, sin los sonidos incrustados', () => {
    const settings = normalizeKofiSettings({
      design: 'cartel',
      pos: 'bc',
      color: '#00ff88',
      showAmount: false,
      goal: { on: false, layout: 'deposito', title: 'Cámara', target: 500, currency: 'usd' },
      recent: { layout: 'cinta' },
      events: { mem: { tier: 'Oro', tpl: 'Hola {nombre}' }, don: { snd: 'custom', sndUrl: 'https://cdn.test/a.mp3' } },
    });
    expect(decodeKofiSettings(encodeKofiSettings(settings))).toEqual(settings);
    const local = normalizeKofiSettings({ events: { don: { snd: 'custom', sndUrl: `data:audio/mpeg;base64,${'A'.repeat(4000)}` } } });
    expect(encodeKofiSettings(local).length).toBeLessThan(3000);
    expect(decodeKofiSettings('no')).toBeNull();
  });

  it('design en la URL elige la alerta o la disposición, según la fuente', () => {
    const get = (params: Record<string, string>) => (key: string) => params[key] ?? null;
    expect(kofiSettingsForWidget(get({ design: 'sello' }), 'kofi', DEFAULT_KOFI_SETTINGS, false).design).toBe('sello');
    expect(kofiSettingsForWidget(get({ design: 'deposito' }), 'kofigoal', DEFAULT_KOFI_SETTINGS, false).goal.layout).toBe('deposito');
    expect(kofiSettingsForWidget(get({ design: 'cinta' }), 'kofirecent', DEFAULT_KOFI_SETTINGS, false).recent.layout).toBe('cinta');
    expect(kofiSettingsForWidget(get({ design: 'cinta' }), 'kofigoal', DEFAULT_KOFI_SETTINGS, false).goal.layout).toBe('barra');
    const kf = encodeKofiSettings(normalizeKofiSettings({ design: 'burbuja' }));
    expect(kofiSettingsForWidget(get({ kf }), 'kofi', DEFAULT_KOFI_SETTINGS, false).design).toBe('burbuja');
    expect(kofiSettingsForWidget(get({ kf }), 'kofi', DEFAULT_KOFI_SETTINGS, true).design).toBe('recibo');
  });
});
