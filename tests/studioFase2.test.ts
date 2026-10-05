/**
 * tests/studioFase2.test.ts
 *
 * Cajas de Studio de la fase 2 (Ko-fi, Recompensa y Aviso de Power-up): qué
 * pieza enseña cada caja, las muestras del editor, qué hace cada una con lo que
 * le llega, que ninguna acción ocurra dos veces en la misma fuente y que la
 * hoja de estilos respete el contrato de una caja.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  KOFI_BOX_PARTS,
  POWERUP_SAMPLE,
  REWARD_SAMPLE,
  createTurn,
  kofiSampleAlert,
  legacyRewardRequest,
  powerupBoxActions,
  rewardTestAction,
} from '../src/components/estudio/boxes/fase2Logic';
import { FASE2_BOXES } from '../src/components/estudio/boxes/fase2';
import { PHASE_BOXES } from '../src/components/estudio/boxes';
import { NOTICE_APPS, NOTICE_QUEUE_MAX, VOICE_APPS, enqueueNotice, voiceAllowed } from '../src/components/powerups/noticeRules';
import { DEFAULT_KOFI_SETTINGS, KOFI_DESIGNS } from '../src/types/kofi';
import { DEFAULT_POWERUPS_SETTINGS, type PowerupRule, type PowerupsSettings } from '../src/types/powerups';
import { PRESET_REWARDS } from '../src/types/rewards';
import { LAYER_TYPES, MIN_SIZE, STAGE_H, STAGE_W, isLaloLayer } from '../src/types/studio';
import { MAX_REWARD_SECONDS } from '../src/utils/rewardsLogic';
import { parseTwitchEvent, type TwitchEvent } from '../src/utils/twitchEvents';

const FASE2 = ['kofi', 'kofigoal', 'kofirecent', 'reward', 'powerup'] as const;

const withRule = (id: string, rule: Partial<PowerupRule>, extra: Partial<PowerupsSettings> = {}): PowerupsSettings => ({
  ...DEFAULT_POWERUPS_SETTINGS,
  ...extra,
  rules: { [id]: { action: 'none', rewardId: '', template: '', ...rule } },
});

const powerup = (text = ''): TwitchEvent => {
  const event = parseTwitchEvent('powerup', { id: 'lluvia', title: 'Lluvia', bits: 100, user: 'Ana', login: 'ana', text });
  if (!event) throw new Error('evento de prueba no válido');
  return event;
};

describe('fase 2: las cajas', () => {
  it('registra sus cinco tipos y no pisa los de las otras fases', () => {
    expect(Object.keys(FASE2_BOXES).sort()).toEqual([...FASE2].sort());
    FASE2.forEach((type) => {
      expect(typeof FASE2_BOXES[type]).toBe('function');
      expect(PHASE_BOXES[type]).toBe(FASE2_BOXES[type]);
      expect(isLaloLayer(type)).toBe(true);
    });
  });

  it('ya se pueden añadir desde el editor', () => {
    const panel = readFileSync('src/components/estudio/SidePanel.tsx', 'utf8');
    const soon = panel.slice(panel.indexOf('export const SOON'), panel.indexOf('interface SidePanelProps'));
    FASE2.forEach((type) => expect(soon).not.toMatch(new RegExp(`\\b${type}:`)));
  });

  it('nacen con un tamaño que cabe en el lienzo', () => {
    FASE2.forEach((type) => {
      const info = LAYER_TYPES.find((item) => item.id === type);
      expect(info).toBeDefined();
      expect(info!.w).toBeGreaterThanOrEqual(MIN_SIZE);
      expect(info!.h).toBeGreaterThanOrEqual(MIN_SIZE);
      expect(info!.w).toBeLessThanOrEqual(STAGE_W);
      expect(info!.h).toBeLessThanOrEqual(STAGE_H);
    });
  });
});

describe('fase 2: Ko-fi', () => {
  it('cada caja enseña una sola pieza', () => {
    expect(KOFI_BOX_PARTS.kofi).toEqual({ alerts: true, goal: false, recent: false });
    expect(KOFI_BOX_PARTS.kofigoal).toEqual({ alerts: false, goal: true, recent: false });
    expect(KOFI_BOX_PARTS.kofirecent).toEqual({ alerts: false, goal: false, recent: true });
  });

  it('la alerta de muestra pasa por las reglas del streamer y no caduca', () => {
    const fixed = kofiSampleAlert(DEFAULT_KOFI_SETTINGS, true);
    expect(fixed.kind).toBe('don');
    expect(fixed.title).toContain('TioGalleta');
    expect(fixed.amount).toBe(25);
    expect(fixed.currency).toBe(DEFAULT_KOFI_SETTINGS.goal.currency);
    expect(fixed.message).not.toBe('');
    expect(fixed.hold).toBe(Infinity);
    expect(fixed.still).toBe(true);
    // Ni sonido ni voz: la muestra no trae nada que hacer al aparecer
    expect(fixed.onShow).toBeUndefined();
    // La prueba del editor es la misma alerta, con su entrada
    expect(kofiSampleAlert(DEFAULT_KOFI_SETTINGS, false)).toEqual({ ...fixed, still: false });
  });

  it('la muestra respeta la moneda de la meta y un aviso privado no enseña mensaje', () => {
    const settings = { ...DEFAULT_KOFI_SETTINGS, goal: { ...DEFAULT_KOFI_SETTINGS.goal, currency: 'USD' } };
    expect(kofiSampleAlert(settings, true).currency).toBe('USD');
    const priv = kofiSampleAlert(settings, true, 'priv');
    expect(priv.message).toBe('');
    expect(priv.title).toContain('Alguien');
  });
});

describe('fase 2: aviso de Power-up', () => {
  it('pinta el aviso de la regla «Aviso en pantalla»', () => {
    const { plates, voices } = powerupBoxActions(powerup(), withRule('lluvia', { action: 'plate' }));
    expect(plates).toHaveLength(1);
    expect(plates[0].tag).toBe('Power-up · 100 bits');
    expect(plates[0].text).toBe('Ana usó Lluvia');
    expect(voices).toHaveLength(0);
  });

  it('entrega la frase de la regla «La voz lee un mensaje»', () => {
    const { plates, voices } = powerupBoxActions(powerup('hola a todos'), withRule('lluvia', { action: 'voice' }));
    expect(plates).toHaveLength(0);
    expect(voices).toHaveLength(1);
    expect(voices[0].text).toBe('Ana usó Lluvia. hola a todos');
    expect(voices[0].viewerText).toBe('hola a todos');
  });

  it('no toca las recompensas ni las metas del evento: las lanza TwitchEventLayer', () => {
    expect(powerupBoxActions(powerup(), withRule('lluvia', { action: 'video', rewardId: 'reward-boom' }))).toEqual({ plates: [], voices: [] });
    const cheer = parseTwitchEvent('bits', { type: 'cheer', bits: 50, user: 'Ana', goals: [{ id: 'm1', current: 150 }] });
    expect(cheer).not.toBeNull();
    expect(powerupBoxActions(cheer!, DEFAULT_POWERUPS_SETTINGS)).toEqual({ plates: [], voices: [] });
    const points = parseTwitchEvent('points', { rewardId: 'abc', title: 'Agua', cost: 100, user: 'Ana' });
    expect(powerupBoxActions(points!, DEFAULT_POWERUPS_SETTINGS)).toEqual({ plates: [], voices: [] });
  });

  it('con los Power-ups apagados no hace nada', () => {
    expect(powerupBoxActions(powerup(), withRule('lluvia', { action: 'plate' }, { enabled: false }))).toEqual({ plates: [], voices: [] });
  });

  it('la voz pasa por los bloqueos del chat', () => {
    const action = { login: 'ana', viewerText: 'vaya tontería' };
    expect(voiceAllowed(action, [], [])).toBe(true);
    expect(voiceAllowed(action, ['ana'], [])).toBe(false);
    expect(voiceAllowed(action, ['otro'], ['tontería'])).toBe(false);
    expect(voiceAllowed({ login: '', viewerText: '' }, ['ana'], ['tontería'])).toBe(true);
  });

  it('en una escena la fuente no pinta el aviso ni lee la voz: lo hace la caja, una sola vez', () => {
    expect(NOTICE_APPS).not.toContain('scene');
    expect(VOICE_APPS).not.toContain('scene');
    // Las fuentes sueltas siguen como estaban
    expect(NOTICE_APPS).toEqual(['all', 'rewards', 'recompensas']);
    expect(VOICE_APPS).toEqual(['', 'tts', 'all']);
  });

  it('la cola descarta lo que no cabe', () => {
    let queue = Array.from({ length: NOTICE_QUEUE_MAX - 1 }, (_, id) => ({ id, ...POWERUP_SAMPLE }));
    queue = enqueueNotice(queue, { id: 90, ...POWERUP_SAMPLE });
    expect(queue).toHaveLength(NOTICE_QUEUE_MAX);
    expect(enqueueNotice(queue, { id: 91, ...POWERUP_SAMPLE })).toEqual(queue);
  });
});

describe('fase 2: recompensa', () => {
  it('una prueba del panel vacía la caja, lanza la recompensa del editor o no hace nada', () => {
    expect(rewardTestAction({ user: '', why: '', clear: true })).toEqual({ clear: true });
    expect(rewardTestAction({ user: 'mar_ia', why: 'Prueba' })).toBeNull();
    const action = rewardTestAction({ reward: PRESET_REWARDS[0], user: 'mar_ia', why: 'Prueba', amount: '250', unit: 'puntos' });
    expect(action).toMatchObject({ request: { user: 'mar_ia', why: 'Prueba', amount: '250', unit: 'puntos' } });
    expect(action && 'request' in action && action.request.reward.id).toBe(PRESET_REWARDS[0].id);
    // Una prueba suena: no va marcada como muestra silenciosa
    expect(action && 'request' in action && action.request.silent).toBeUndefined();
  });

  it('el aviso antiguo entra en la caja con su placa y sin sonido', () => {
    const request = legacyRewardRequest({
      id: 'r1',
      user: 'EspectadorPro',
      rewardName: 'Lluvia de confeti',
      noticeText: 'EspectadorPro desató una lluvia de confeti',
      position: 'fullscreen',
      screenShake: true,
      accentColor: '#f59e0b',
      soundType: 'arcade-chime',
      duration: 5,
    });
    expect(request.silent).toBe(true);
    expect(request.reward.soundType).toBe('none');
    expect(request.reward.name).toBe('Lluvia de confeti');
    expect(request.reward.showPlate).toBe(true);
    expect(request.reward.accentColor).toBe('#f59e0b');
    expect(request.reward.screenShake).toBe(true);
    expect(request.user).toBe('EspectadorPro desató una lluvia de confeti');
    expect(request.holdSeconds).toBe(5);
    // «Pantalla completa» se conserva: dentro de Studio la pantalla de la capa es su caja
    expect(request.reward.position).toBe('fullscreen');
  });

  it('el aviso antiguo con vídeo y sin texto no pinta placa, y su tiempo tiene tope', () => {
    const request = legacyRewardRequest({ id: 'r2', user: 'Ana', rewardName: 'Baile', noticeText: '', videoUrl: 'https://lalo.test/baile.webm', duration: 500 });
    expect(request.reward.showPlate).toBe(false);
    expect(request.reward.videoUrl).toBe('https://lalo.test/baile.webm');
    expect(request.holdSeconds).toBe(MAX_REWARD_SECONDS);
    const bare = legacyRewardRequest({ id: 'r3', user: 'Ana', rewardName: 'Baile', noticeText: '' });
    expect(bare.reward.showPlate).toBe(true);
    expect(bare.user).toBe('Canjeado por Ana');
    expect(bare.holdSeconds).toBe(6);
  });

  it('la placa de muestra trae todos sus textos', () => {
    expect(Object.values(REWARD_SAMPLE).every((text) => text.length > 0)).toBe(true);
  });
});

describe('fase 2: dos cajas del mismo tipo', () => {
  it('lleva el turno la primera, y al quitarla pasa a la siguiente', () => {
    const turn = createTurn<string>();
    expect(turn.lead()).toBeUndefined();
    expect(turn.leads('a')).toBe(false);
    const leaveA = turn.join('a', 'A');
    const leaveB = turn.join('b', 'B');
    expect(turn.size()).toBe(2);
    expect(turn.leads('a')).toBe(true);
    expect(turn.leads('b')).toBe(false);
    expect(turn.lead()).toBe('A');
    leaveA();
    expect(turn.leads('b')).toBe(true);
    expect(turn.lead()).toBe('B');
    leaveB();
    expect(turn.size()).toBe(0);
  });

  it('una caja que se vuelve a montar no se apunta dos veces ni la borra su salida anterior', () => {
    const turn = createTurn<string>();
    const leaveOld = turn.join('a', 'vieja');
    turn.join('a', 'nueva');
    expect(turn.size()).toBe(1);
    expect(turn.lead()).toBe('nueva');
    leaveOld();
    expect(turn.size()).toBe(1);
    expect(turn.lead()).toBe('nueva');
  });
});

describe('fase 2: hoja de estilos', () => {
  const css = readFileSync('src/styles/estudio-fase2.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('todo se mide con la caja: sin position: fixed y sin vw ni vh', () => {
    expect(css).not.toMatch(/position:\s*fixed/);
    expect(css).not.toMatch(/\d(vw|vh)\b/);
    expect(css).toMatch(/cqw/);
  });

  it('no mueve nada: el movimiento lo ponen las capas', () => {
    expect(css).not.toMatch(/transition|animation|@keyframes/);
  });

  it('cada regla vive dentro de una escena', () => {
    const selectors = css
      .split('}')
      .map((rule) => rule.split('{')[0].trim())
      .filter(Boolean)
      .flatMap((group) => group.split(',').map((selector) => selector.trim()));
    expect(selectors.length).toBeGreaterThan(0);
    selectors.forEach((selector) => expect(selector.startsWith('.es-cv')).toBe(true));
  });

  it('cada diseño de alerta de Ko-fi tiene su medida', () => {
    KOFI_DESIGNS.filter((design) => design.id !== 'recibo').forEach((design) => expect(css).toContain(`[data-design='${design.id}']`));
  });
});
