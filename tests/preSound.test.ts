/**
 * tests/preSound.test.ts
 *
 * «Sonido antes de la voz»: normalización de los ajustes, cuándo suena, cuánto
 * espera la voz y el viaje de ida y vuelta por la URL de OBS.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRE_SOUND,
  PRE_SOUND_CAP_MS,
  PRE_SOUND_QUIET_MS,
  PRE_SOUNDS,
  PreSoundSettings,
  normalizePreSound,
  planPreSound,
  preSoundFromParams,
  preSoundToQuery,
  preSoundUrlTravels,
  shouldPlayPreSound,
  synthDurationMs,
} from '../src/utils/preSound';

const on: PreSoundSettings = { ...DEFAULT_PRE_SOUND, enabled: true };
const ctx = { lastSpokenAt: 0, now: 1_000_000 };
const reader = (query: Record<string, string>) => (key: string) => (key in query ? query[key] : null);

describe('normalizePreSound', () => {
  it('sin nada guardado queda apagado y con los valores por defecto', () => {
    expect(normalizePreSound(undefined)).toEqual(DEFAULT_PRE_SOUND);
    expect(normalizePreSound('texto')).toEqual(DEFAULT_PRE_SOUND);
  });

  it('descarta lo que no vale y limita el volumen', () => {
    const result = normalizePreSound({ enabled: 'sí', soundType: 'none', volume: 7, when: 'nunca' });
    expect(result.enabled).toBe(false);
    expect(result.soundType).toBe(DEFAULT_PRE_SOUND.soundType);
    expect(result.volume).toBe(1);
    expect(result.when).toBe('all');
    expect(normalizePreSound({ volume: -3 }).volume).toBe(0);
    expect(normalizePreSound({ volume: 'x' }).volume).toBe(DEFAULT_PRE_SOUND.volume);
  });

  it('conserva un archivo propio válido y borra su nombre si no hay archivo', () => {
    const kept = normalizePreSound({ enabled: true, customUrl: 'https://cdn.example/aviso.mp3', customName: 'aviso.mp3', customMediaId: 'm1' });
    expect(kept.customUrl).toBe('https://cdn.example/aviso.mp3');
    expect(kept.customName).toBe('aviso.mp3');
    const dropped = normalizePreSound({ customUrl: 'javascript:alert(1)', customName: 'malo', customMediaId: 'm2' });
    expect(dropped).toMatchObject({ customUrl: '', customName: '', customMediaId: '' });
  });
});

describe('shouldPlayPreSound', () => {
  it('apagado o con el volumen a cero no suena', () => {
    expect(shouldPlayPreSound(DEFAULT_PRE_SOUND, { ...ctx, trigger: 'command' })).toBe(false);
    expect(shouldPlayPreSound({ ...on, volume: 0 }, { ...ctx, trigger: 'command' })).toBe(false);
  });

  it('en «cada mensaje» suena con cualquier mensaje del chat y con la prueba del panel', () => {
    ['command', 'chat', 'reward', 'bits', 'highlight', 'test'].forEach((trigger) => {
      expect(shouldPlayPreSound(on, { ...ctx, trigger })).toBe(true);
    });
  });

  it('no se pone encima de una alerta que ya trae su sonido', () => {
    expect(shouldPlayPreSound(on, { ...ctx, trigger: 'test', hasOwnSound: true })).toBe(false);
  });

  it('las frases de otras capas (ruleta, raid, Power-ups) no lo llevan', () => {
    expect(shouldPlayPreSound(on, { ...ctx, trigger: 'test', system: true })).toBe(false);
  });

  it('en «solo texto» no suena', () => {
    expect(shouldPlayPreSound(on, { ...ctx, trigger: 'command', textOnly: true })).toBe(false);
  });

  it('en «de pago o destacados» solo suena con puntos, bits o destacados', () => {
    const paid = { ...on, when: 'paid' as const };
    expect(shouldPlayPreSound(paid, { ...ctx, trigger: 'reward' })).toBe(true);
    expect(shouldPlayPreSound(paid, { ...ctx, trigger: 'bits' })).toBe(true);
    expect(shouldPlayPreSound(paid, { ...ctx, trigger: 'highlight' })).toBe(true);
    expect(shouldPlayPreSound(paid, { ...ctx, trigger: 'command' })).toBe(false);
    expect(shouldPlayPreSound(paid, { ...ctx, trigger: 'chat' })).toBe(false);
    expect(shouldPlayPreSound(paid, { ...ctx })).toBe(false);
  });

  it('en «tras un silencio» suena el primero y el que llega después de un minuto callada', () => {
    const quiet = { ...on, when: 'quiet' as const };
    expect(shouldPlayPreSound(quiet, { trigger: 'command', lastSpokenAt: 0, now: 5000 })).toBe(true);
    expect(shouldPlayPreSound(quiet, { trigger: 'command', lastSpokenAt: 10_000, now: 10_000 + PRE_SOUND_QUIET_MS - 1 })).toBe(false);
    expect(shouldPlayPreSound(quiet, { trigger: 'command', lastSpokenAt: 10_000, now: 10_000 + PRE_SOUND_QUIET_MS })).toBe(true);
  });
});

describe('planPreSound', () => {
  it('un sonido corto se oye entero antes de la voz', () => {
    expect(planPreSound(600)).toEqual({ waitMs: 600, fadeUnder: false });
    expect(planPreSound(PRE_SOUND_CAP_MS)).toEqual({ waitMs: PRE_SOUND_CAP_MS, fadeUnder: false });
  });

  it('uno más largo que el tope no retrasa la voz: se apaga debajo de ella', () => {
    expect(planPreSound(8000)).toEqual({ waitMs: PRE_SOUND_CAP_MS, fadeUnder: true });
  });

  it('con la duración desconocida se espera el tope como mucho', () => {
    [null, undefined, NaN, Infinity, 0].forEach((value) => {
      expect(planPreSound(value)).toEqual({ waitMs: PRE_SOUND_CAP_MS, fadeUnder: true });
    });
  });

  it('todos los sonidos de serie caben antes del tope', () => {
    PRE_SOUNDS.forEach((sound) => {
      expect(synthDurationMs(sound.id)).toBe(sound.ms);
      expect(planPreSound(sound.ms).fadeUnder).toBe(false);
    });
  });
});

describe('el sonido en la URL de OBS', () => {
  it('apagado va como ps=0 y una URL antigua, sin él, no dice nada', () => {
    expect(preSoundToQuery(DEFAULT_PRE_SOUND)).toEqual({ ps: '0' });
    expect(preSoundToQuery(undefined)).toEqual({ ps: '0' });
    expect(preSoundFromParams(reader({ ps: '0' }))).toEqual(DEFAULT_PRE_SOUND);
    expect(preSoundFromParams(reader({}))).toBeNull();
  });

  it('va y vuelve con el sonido de serie, el volumen y cuándo suena', () => {
    PRE_SOUNDS.forEach((sound) => {
      (['all', 'paid', 'quiet'] as const).forEach((when) => {
        const settings: PreSoundSettings = { ...on, soundType: sound.id, volume: 0.35, when };
        expect(preSoundFromParams(reader(preSoundToQuery(settings)))).toEqual(settings);
      });
    });
  });

  it('un archivo subido a la nube viaja; el nombre y el id no hacen falta en OBS', () => {
    const settings: PreSoundSettings = { ...on, customUrl: 'https://cdn.example/u/aviso.mp3', customName: 'aviso.mp3', customMediaId: 'm1' };
    const back = preSoundFromParams(reader(preSoundToQuery(settings)));
    expect(back?.customUrl).toBe('https://cdn.example/u/aviso.mp3');
    expect(back?.enabled).toBe(true);
  });

  it('un archivo incrustado no viaja: en OBS queda el sonido de serie', () => {
    const settings: PreSoundSettings = { ...on, soundType: 'synth-bell', customUrl: `data:audio/mpeg;base64,${'A'.repeat(5000)}` };
    const query = preSoundToQuery(settings);
    expect(query.psu).toBeUndefined();
    expect(preSoundFromParams(reader(query))).toMatchObject({ enabled: true, soundType: 'synth-bell', customUrl: '' });
    expect(preSoundUrlTravels(settings.customUrl)).toBe(false);
    expect(preSoundUrlTravels('blob:https://lalo/1')).toBe(false);
    expect(preSoundUrlTravels('r2:u/1/aviso.mp3')).toBe(true);
  });

  it('una URL manipulada no cuela un archivo que no sea una dirección', () => {
    expect(preSoundFromParams(reader({ ps: '1', psu: 'javascript:alert(1)', psv: '99', psw: 'x', pst: 'none' }))).toEqual({
      ...DEFAULT_PRE_SOUND,
      enabled: true,
      volume: 1,
    });
  });
});
