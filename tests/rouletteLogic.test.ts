/**
 * tests/rouletteLogic.test.ts
 *
 * Reglas de la ruleta: qué la gira (puntos o bits), el comando que la abre por
 * su nombre, la cola, el mismo canje por dos caminos, la migración de los
 * ajustes antiguos y una sola petición de voz por resultado.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_ROULETTE_SETTINGS,
  RouletteSettings,
  decodeRouletteSettings,
  encodeRouletteSettings,
  normalizeRouletteCommand,
  normalizeRouletteSettings,
} from '../src/types/roulette';
import { emptyGate } from '../src/utils/rewardsLogic';
import {
  IncomingTrigger,
  ROULETTE_QUEUE_MAX,
  SeenTrigger,
  admitSpin,
  buildSpin,
  canUseRouletteCommands,
  commitSpinGate,
  createAnnouncer,
  foldName,
  isDuplicateTrigger,
  judgeTrigger,
  matchRouletteName,
  matchesTrigger,
  parseActivityCommand,
  rememberTrigger,
  resolveActive,
  spinAnnouncement,
  takeNextSpin,
  triggerFromChat,
  triggerFromEvent,
  winnerAnnouncement,
} from '../src/utils/rouletteLogic';
import { parseTwitchEvent } from '../src/utils/twitchEvents';

const REWARD = '9f3c1a2b-0000-4000-8000-abcdefabcdef';
const points: RouletteSettings = { ...DEFAULT_ROULETTE_SETTINGS, triggerKind: 'points', twitchRewardId: REWARD, active: true };
const bits: RouletteSettings = { ...DEFAULT_ROULETTE_SETTINGS, triggerKind: 'bits', bitsMode: 'exact', bitsMin: 100, active: true };

const redeem = (over: Partial<IncomingTrigger> = {}): IncomingTrigger => ({
  kind: 'points',
  rewardId: REWARD,
  user: 'Mar_ia',
  username: 'mar_ia',
  role: 'viewer',
  via: 'chat',
  ...over,
});
const cheer = (amount: number, over: Partial<IncomingTrigger> = {}): IncomingTrigger => ({
  kind: 'bits',
  bits: amount,
  user: 'Mar_ia',
  username: 'mar_ia',
  role: 'viewer',
  via: 'chat',
  ...over,
});
const open = (now = 1000) => ({ active: true, activeSegments: 6, gate: emptyGate(), now });

describe('qué gira la ruleta', () => {
  it('con puntos, solo el canje de la recompensa enlazada', () => {
    expect(matchesTrigger(points, redeem())).toBe(true);
    expect(matchesTrigger(points, redeem({ rewardId: REWARD.toUpperCase() }))).toBe(true);
    expect(matchesTrigger(points, redeem({ rewardId: 'otra' }))).toBe(false);
    expect(matchesTrigger(points, cheer(100))).toBe(false);
  });

  it('sin recompensa enlazada, ningún canje la gira', () => {
    expect(matchesTrigger({ ...points, twitchRewardId: '' }, redeem({ rewardId: '' }))).toBe(false);
    expect(matchesTrigger({ ...points, twitchRewardId: '' }, redeem())).toBe(false);
  });

  it('con bits exactos, solo esa cantidad', () => {
    expect(matchesTrigger(bits, cheer(100))).toBe(true);
    expect(matchesTrigger(bits, cheer(99))).toBe(false);
    expect(matchesTrigger(bits, cheer(101))).toBe(false);
    expect(matchesTrigger(bits, redeem())).toBe(false);
  });

  it('con un rango de bits, con y sin tope', () => {
    const range: RouletteSettings = { ...bits, bitsMode: 'range', bitsMin: 50, bitsMax: 200 };
    expect(matchesTrigger(range, cheer(50))).toBe(true);
    expect(matchesTrigger(range, cheer(200))).toBe(true);
    expect(matchesTrigger(range, cheer(201))).toBe(false);
    expect(matchesTrigger({ ...range, bitsMax: null }, cheer(5000))).toBe(true);
    expect(matchesTrigger(range, cheer(49))).toBe(false);
  });

  it('lee de las etiquetas del chat el cheer y el canje con texto', () => {
    expect(triggerFromChat({ username: 'mar_ia', 'display-name': 'Mar_ia', bits: '100' }, 'sub')).toMatchObject({
      kind: 'bits',
      bits: 100,
      user: 'Mar_ia',
      role: 'sub',
      via: 'chat',
    });
    expect(triggerFromChat({ username: 'mar_ia', 'custom-reward-id': REWARD.toUpperCase() }, 'viewer')).toMatchObject({
      kind: 'points',
      rewardId: REWARD,
      via: 'chat',
    });
    expect(triggerFromChat({ username: 'mar_ia' }, 'viewer')).toBeNull();
  });

  it('un mensaje normal, aunque diga !ruleta o !spin, no gira nada', () => {
    expect(triggerFromChat({ username: 'mar_ia', 'display-name': 'Mar_ia' }, 'viewer')).toBeNull();
    expect(parseActivityCommand('!spin', points)).toBeNull();
    expect(parseActivityCommand('!wheel', points)).toBeNull();
  });
});

describe('permiso, espera y ruleta cerrada', () => {
  it('abierta y con la regla cumplida, gira y dice por qué', () => {
    expect(judgeTrigger(points, redeem(), open())).toEqual({ ok: true, why: 'Canje de puntos' });
    expect(judgeTrigger(bits, cheer(100), open())).toEqual({ ok: true, why: 'Cheer de 100 bits' });
  });

  it('cerrada, ni los puntos ni los bits la giran', () => {
    const closed = { ...open(), active: false };
    expect(judgeTrigger(points, redeem(), closed)).toMatchObject({ ok: false, reason: 'closed' });
    expect(judgeTrigger(bits, cheer(100), closed)).toMatchObject({ ok: false, reason: 'closed' });
    // Una prueba del panel tampoco se salta que esté cerrada
    expect(judgeTrigger(points, redeem({ via: 'test' }), closed)).toMatchObject({ ok: false, reason: 'closed' });
  });

  it('lo que no coincide se ignora sin mensaje, esté abierta o no', () => {
    expect(judgeTrigger(bits, cheer(5), open())).toEqual({ ok: false, reason: 'no_match', message: '' });
  });

  it('respeta quién puede girarla, con las mismas reglas de las recompensas', () => {
    const subs: RouletteSettings = { ...points, audience: 'sub' };
    expect(judgeTrigger(subs, redeem({ role: 'viewer' }), open())).toMatchObject({ ok: false, reason: 'not_allowed' });
    expect(judgeTrigger(subs, redeem({ role: 'sub' }), open()).ok).toBe(true);
    expect(judgeTrigger(subs, redeem({ role: 'mod' }), open()).ok).toBe(true);
    const vips: RouletteSettings = { ...points, audience: 'vip' };
    expect(judgeTrigger(vips, redeem({ role: 'sub' }), open())).toMatchObject({ ok: false, reason: 'not_allowed' });
    expect(judgeTrigger(vips, redeem({ role: 'broadcaster' }), open()).ok).toBe(true);
  });

  it('la espera descarta el giro que llega antes de tiempo y no se alarga con los descartados', () => {
    const rule: RouletteSettings = { ...bits, cooldownSeconds: 30 };
    let gate = emptyGate();
    expect(judgeTrigger(rule, cheer(100), { ...open(0), gate }).ok).toBe(true);
    gate = commitSpinGate(gate, rule, 'mar_ia', 0);
    expect(judgeTrigger(rule, cheer(100, { username: 'otro', user: 'Otro' }), { ...open(10000), gate })).toMatchObject({
      ok: false,
      reason: 'cooldown',
    });
    expect(judgeTrigger(rule, cheer(100), { ...open(30000), gate }).ok).toBe(true);
  });

  it('una prueba no mira el permiso ni la espera', () => {
    const rule: RouletteSettings = { ...points, audience: 'vip', cooldownSeconds: 600 };
    const gate = commitSpinGate(emptyGate(), rule, 'mar_ia', 0);
    expect(judgeTrigger(rule, redeem({ via: 'test' }), { ...open(1000), gate }).ok).toBe(true);
  });

  it('sin segmentos encendidos no gira', () => {
    expect(judgeTrigger(points, redeem(), { ...open(), activeSegments: 0 })).toMatchObject({ ok: false, reason: 'no_segments' });
  });
});

describe('canal de eventos y chat: un canje, un giro', () => {
  const event = (payload: Record<string, unknown>, test = false) => parseTwitchEvent('points', { user: 'Mar_ia', login: 'mar_ia', ...payload }, test)!;

  it('del canal de eventos solo entran los canjes sin texto', () => {
    const noText = triggerFromEvent(event({ rewardId: REWARD, text: '' }), { pointsViaChannel: true });
    expect(noText).toMatchObject({ kind: 'points', rewardId: REWARD, username: 'mar_ia', via: 'events', role: 'viewer' });
    // El canje con texto ya llega por el chat: aquí se deja pasar de largo
    expect(triggerFromEvent(event({ rewardId: REWARD, text: 'hola' }), { pointsViaChannel: true })).toBeNull();
  });

  it('con «canjes por el canal de eventos» apagado no entra ninguno', () => {
    expect(triggerFromEvent(event({ rewardId: REWARD, text: '' }), { pointsViaChannel: false })).toBeNull();
  });

  it('los cheers reales del canal de eventos se ignoran: ya llegan por el chat', () => {
    const cheerEvent = parseTwitchEvent('bits', { type: 'cheer', bits: 100, user: 'Mar_ia', login: 'mar_ia' })!;
    expect(triggerFromEvent(cheerEvent, { pointsViaChannel: true })).toBeNull();
    const testCheer = parseTwitchEvent('bits', { type: 'cheer', bits: 100, user: 'Mar_ia', login: 'mar_ia' }, true)!;
    expect(triggerFromEvent(testCheer, { pointsViaChannel: true })).toMatchObject({ kind: 'bits', bits: 100, via: 'test' });
  });

  it('el mismo canje por el otro camino, poco después, no cuenta otra vez', () => {
    let seen: SeenTrigger[] = [];
    const byChat = redeem({ via: 'chat' });
    const byEvents = redeem({ via: 'events' });
    expect(isDuplicateTrigger(seen, byChat, 0)).toBe(false);
    seen = rememberTrigger(seen, byChat, 0);
    expect(isDuplicateTrigger(seen, byEvents, 4000)).toBe(true);
    // Otro espectador, u otro canje del mismo por el mismo camino, sí cuentan
    expect(isDuplicateTrigger(seen, redeem({ via: 'events', username: 'otro' }), 4000)).toBe(false);
    expect(isDuplicateTrigger(seen, byChat, 4000)).toBe(false);
    // Pasado el margen ya es un canje nuevo
    expect(isDuplicateTrigger(seen, byEvents, 20000)).toBe(false);
  });

  it('la memoria de canjes olvida los caducados', () => {
    let seen = rememberTrigger([], redeem(), 0);
    seen = rememberTrigger(seen, redeem({ username: 'otro' }), 20000);
    expect(seen).toHaveLength(1);
    expect(seen[0].key).toContain('otro');
  });
});

describe('comando que abre y cierra la ruleta por su nombre', () => {
  const list = [{ name: 'Castigos' }, { name: 'Premios' }, { name: 'Castillo médico' }];

  it('perdona mayúsculas, acentos y signos', () => {
    expect(foldName('  CASTILLO   Médico! ')).toBe('castillo medico');
    expect(matchRouletteName(list, 'PREMIOS')).toEqual({ kind: 'one', item: list[1] });
    expect(matchRouletteName(list, 'castillo medico')).toEqual({ kind: 'one', item: list[2] });
  });

  it('vale un comienzo que solo encaje con una', () => {
    expect(matchRouletteName(list, 'pre')).toEqual({ kind: 'one', item: list[1] });
    expect(matchRouletteName(list, 'castig')).toEqual({ kind: 'one', item: list[0] });
  });

  it('un comienzo que vale para varias es ambiguo y no elige', () => {
    const found = matchRouletteName(list, 'cast');
    expect(found.kind).toBe('ambiguous');
  });

  it('el nombre exacto gana aunque sea el comienzo de otro', () => {
    const two = [{ name: 'reto' }, { name: 'retos duros' }];
    expect(matchRouletteName(two, 'Reto')).toEqual({ kind: 'one', item: two[0] });
  });

  it('un nombre que no existe no encuentra nada', () => {
    expect(matchRouletteName(list, 'bingo')).toEqual({ kind: 'none' });
    expect(matchRouletteName([], 'castigos')).toEqual({ kind: 'none' });
  });

  it('sin nombre solo acierta si hay una única ruleta', () => {
    expect(matchRouletteName([{ name: 'castigos' }], '')).toEqual({ kind: 'one', item: { name: 'castigos' } });
    expect(matchRouletteName(list, '').kind).toBe('ambiguous');
  });

  it('lee el comando de abrir y el de cerrar, con el nombre detrás', () => {
    const commands = { openCommand: '!ruleta', closeCommand: '!cerrarruleta' };
    expect(parseActivityCommand('!ruleta castigos', commands)).toEqual({ action: 'open', query: 'castigos' });
    expect(parseActivityCommand('  !RULETA   Castillo  médico ', commands)).toEqual({ action: 'open', query: 'Castillo médico' });
    expect(parseActivityCommand('!cerrarruleta', commands)).toEqual({ action: 'close', query: '' });
    expect(parseActivityCommand('hola !ruleta castigos', commands)).toBeNull();
    expect(parseActivityCommand('!ruletas', commands)).toBeNull();
  });

  it('solo el streamer y los moderadores', () => {
    expect(canUseRouletteCommands('broadcaster')).toBe(true);
    expect(canUseRouletteCommands('mod')).toBe(true);
    expect(canUseRouletteCommands('vip')).toBe(false);
    expect(canUseRouletteCommands('sub')).toBe(false);
    expect(canUseRouletteCommands('viewer')).toBe(false);
  });

  it('entre el panel y el chat manda el cambio más reciente', () => {
    expect(resolveActive({ active: false, activeAt: 0 }, null)).toBe(false);
    expect(resolveActive({ active: false, activeAt: 100 }, { active: true, at: 200 })).toBe(true);
    expect(resolveActive({ active: false, activeAt: 300 }, { active: true, at: 200 })).toBe(false);
    expect(resolveActive({ active: true, activeAt: 300 }, { active: false, at: 400 })).toBe(false);
  });
});

describe('cola de giros', () => {
  it('con la rueda libre gira ya; ocupada, espera; llena, se descarta', () => {
    expect(admitSpin(0, false)).toBe('start');
    expect(admitSpin(0, true)).toBe('wait');
    expect(admitSpin(ROULETTE_QUEUE_MAX - 1, true)).toBe('wait');
    expect(admitSpin(ROULETTE_QUEUE_MAX, true)).toBe('full');
    // Si ya hay gente esperando, el nuevo no se cuela aunque la rueda acabe de quedar libre
    expect(admitSpin(2, false)).toBe('wait');
  });

  it('salen de uno en uno y por orden de llegada', () => {
    let queue = ['a', 'b', 'c'];
    const order: string[] = [];
    for (;;) {
      const { next, rest } = takeNextSpin(queue);
      if (next === null) break;
      order.push(next);
      queue = rest;
    }
    expect(order).toEqual(['a', 'b', 'c']);
    expect(takeNextSpin([])).toEqual({ next: null, rest: [] });
  });

  it('cada giro lleva quién lo disparó y con qué', () => {
    const spin = buildSpin(points, { id: 's1', user: 'Mar_ia', why: 'Canje de puntos', baseRotation: 0, random: () => 0.5 })!;
    expect(spin.user).toBe('Mar_ia');
    expect(spin.why).toBe('Canje de puntos');
    expect(spin.winnerSegment).toBe(points.segments.filter((s) => s.enabled)[spin.winnerIndex]);
    expect(spin.finalRotation).toBeGreaterThan(5 * 360);
  });

  it('el giro cae en un segmento encendido y nunca fuera de la lista', () => {
    const some: RouletteSettings = { ...points, segments: points.segments.map((s, i) => ({ ...s, enabled: i % 2 === 0 })) };
    const last = buildSpin(some, { id: 's2', user: 'x', baseRotation: 725, random: () => 0.999999 })!;
    expect(last.winnerSegment.enabled).toBe(true);
    expect(last.winnerIndex).toBe(last.totalActiveSegments - 1);
    expect(last.startRotation).toBe(5);
    expect(buildSpin({ ...points, segments: points.segments.map((s) => ({ ...s, enabled: false })) }, { id: 's3', user: 'x', baseRotation: 0 })).toBeNull();
  });
});

describe('migración de los ajustes guardados', () => {
  it('los ajustes antiguos pierden el comando de giro y avisan una vez', () => {
    const old = {
      channel: 'jagc',
      title: 'MI RULETA',
      segments: DEFAULT_ROULETTE_SETTINGS.segments,
      triggerRewardName: 'Girar Ruleta de Castigos',
      triggerCommand: '!girar',
      ttsAnnounceWinner: false,
    };
    const next = normalizeRouletteSettings(old);
    expect(next.title).toBe('MI RULETA');
    expect(next.ttsAnnounceWinner).toBe(false);
    expect(next.spinNotice).toBe(true);
    // El comando guardado pasa a abrir la ruleta; ya no la gira nadie con él
    expect(next.openCommand).toBe('!girar');
    expect(next.active).toBe(false);
    expect(next.triggerKind).toBe('points');
    expect(next.twitchRewardId).toBe('');
    expect('triggerCommand' in next).toBe(false);
    expect('triggerRewardName' in next).toBe(false);
  });

  it('el aviso no vuelve una vez guardado y cerrado', () => {
    const migrated = normalizeRouletteSettings({ triggerCommand: '!ruleta', segments: [] });
    expect(migrated.spinNotice).toBe(true);
    expect(normalizeRouletteSettings(JSON.parse(JSON.stringify(migrated))).spinNotice).toBe(true);
    expect(normalizeRouletteSettings({ ...migrated, spinNotice: false }).spinNotice).toBe(false);
  });

  it('unos ajustes nuevos no muestran el aviso', () => {
    expect(DEFAULT_ROULETTE_SETTINGS.spinNotice).toBe(false);
    expect(normalizeRouletteSettings({ title: 'X' }).spinNotice).toBe(false);
  });

  it('corrige valores imposibles sin romper nada', () => {
    const fixed = normalizeRouletteSettings({
      triggerKind: 'bits',
      bitsMode: 'range',
      bitsMin: 500,
      bitsMax: 20,
      cooldownSeconds: -5,
      audience: 'reyes',
      openCommand: 'abrir ruleta',
      closeCommand: '!ABRIR',
      name: '   ',
      twitchRewardId: REWARD.toUpperCase(),
    });
    expect(fixed.bitsMin).toBe(500);
    expect(fixed.bitsMax).toBe(500);
    expect(fixed.cooldownSeconds).toBe(0);
    expect(fixed.audience).toBe('all');
    expect(fixed.openCommand).toBe('!abrir');
    // Abrir y cerrar no pueden ser el mismo comando
    expect(fixed.closeCommand).not.toBe(fixed.openCommand);
    expect(fixed.name).toBe('castigos');
    expect(fixed.twitchRewardId).toBe(REWARD);
    expect(normalizeRouletteSettings(null)).toEqual(DEFAULT_ROULETTE_SETTINGS);
  });

  it('los comandos se guardan en minúsculas, con «!» y sin espacios', () => {
    expect(normalizeRouletteCommand('Ruleta', '!x')).toBe('!ruleta');
    expect(normalizeRouletteCommand('!!Fin Ruleta', '!x')).toBe('!fin');
    expect(normalizeRouletteCommand('  ', '!x')).toBe('!x');
    expect(normalizeRouletteCommand(42, '!x')).toBe('!x');
  });

  it('los ajustes viajan enteros en la URL de OBS cuando no hay nube', () => {
    const sent: RouletteSettings = { ...bits, name: 'Premios', cooldownSeconds: 20, activeAt: 1234 };
    expect(decodeRouletteSettings(encodeRouletteSettings(sent))).toEqual(sent);
    expect(decodeRouletteSettings('no-es-valido')).toBeNull();
    expect(decodeRouletteSettings(null)).toBeNull();
  });
});

describe('voz: una sola petición por resultado', () => {
  const winner = DEFAULT_ROULETTE_SETTINGS.segments[0];

  it('el resultado de un giro se pide una vez aunque el fin del giro llegue repetido', () => {
    const speak = vi.fn();
    const announcer = createAnnouncer(speak);
    const text = winnerAnnouncement(winner, 'Mar_ia');
    expect(announcer.say('spin-1', 'winner', text)).toBe(true);
    expect(announcer.say('spin-1', 'winner', text)).toBe(false);
    expect(announcer.say('spin-1', 'winner', text)).toBe(false);
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledWith(text);
  });

  it('un giro entero pide dos frases como mucho: el arranque y el resultado', () => {
    const speak = vi.fn();
    const announcer = createAnnouncer(speak);
    announcer.say('spin-1', 'spin', spinAnnouncement('Mar_ia', 'RULETA'));
    announcer.say('spin-1', 'spin', spinAnnouncement('Mar_ia', 'RULETA'));
    announcer.say('spin-1', 'winner', winnerAnnouncement(winner, 'Mar_ia'));
    announcer.say('spin-1', 'winner', winnerAnnouncement(winner, 'Mar_ia'));
    expect(speak).toHaveBeenCalledTimes(2);
    announcer.say('spin-2', 'winner', winnerAnnouncement(winner, 'Otro'));
    expect(speak).toHaveBeenCalledTimes(3);
  });

  it('con dos fuentes abiertas solo habla la que lleva el mando', () => {
    const speak = vi.fn();
    const leader = createAnnouncer(speak, () => true);
    const follower = createAnnouncer(speak, () => false);
    const text = winnerAnnouncement(winner, 'Mar_ia');
    // Las dos fuentes dibujan el mismo giro y las dos avisan de su final
    follower.say('spin-1', 'winner', text);
    leader.say('spin-1', 'winner', text);
    follower.say('spin-1', 'winner', text);
    expect(speak).toHaveBeenCalledTimes(1);
  });

  it('las frases nombran a quien giró y lo que salió', () => {
    expect(spinAnnouncement('Mar_ia', 'RULETA')).toContain('Mar_ia');
    expect(spinAnnouncement('Streamer', 'RULETA DE RETOS')).toContain('RULETA DE RETOS');
    expect(winnerAnnouncement(winner, 'Mar_ia')).toContain(winner.text);
    expect(winnerAnnouncement(winner, 'Mar_ia')).toContain('@Mar_ia');
    expect(winnerAnnouncement(winner, 'Streamer')).not.toContain('@');
  });
});

describe('el módulo de voz de la ruleta no abre un segundo camino', () => {
  it('no usa la voz del navegador y el widget no pide audio por su cuenta', async () => {
    const { readFileSync } = await import('node:fs');
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
    const audio = read('../src/utils/rouletteAudio.ts');
    expect(audio).not.toMatch(/speechSynthesis|SpeechSynthesisUtterance/);
    const layer = read('../src/components/roulette/RouletteLayer.tsx');
    expect(layer).not.toMatch(/speechSynthesis|\/api\/tts|rouletteAudio/);
    // En el widget la ruleta solo habla por la cola de voz del sistema
    const widget = read('../src/pages/Widget.tsx');
    expect(widget).not.toMatch(/rouletteAudio|speakRoulette(Spin|Winner|TtsCue)/);
    expect(widget).toMatch(/speakRoulette = useCallback\(\(text: string\) => enqueueManualMessage\(text, 'Ruleta', true\)/);
    // Y el chat ya no gira la rueda con un comando
    expect(read('../src/hooks/useTwitchChat.ts')).not.toMatch(/ROULETTE_SPIN|!spin|!wheel/);
  });
});
