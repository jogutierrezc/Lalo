/**
 * tests/studioFase1.test.ts
 *
 * Cajas de Studio de la fase 1 (Mascota, Alerta de juego, Ahora suena): a qué
 * asa va cada señal de la escena, quién anuncia una alerta de juego, por dónde
 * recorta la caja a la mascota, cómo se ajusta «Ahora suena» a su caja, que las
 * tres cajas están registradas y disponibles en el editor, y que su hoja de
 * estilos respeta el contrato (todo dentro de la caja, sin medidas de pantalla).
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { FASE1_BOXES } from '../src/components/estudio/boxes/fase1';
import { boxEdge, gameVoice, musicFit, musicInBox, petClip, routeMusicSignal, routePetSignal } from '../src/components/estudio/boxes/fase1Logic';
import type { SceneSignal } from '../src/components/estudio/boxes/types';
import { SOON } from '../src/components/estudio/SidePanel';
import { DEFAULT_MUSIC_SETTINGS, MUSIC_DESIGNS } from '../src/types/music';
import { PET_ENTERS, PET_POSITIONS } from '../src/types/pets';
import { STAGE_H, STAGE_W, typeInfo } from '../src/types/studio';
import { SAMPLE_CUES } from '../src/utils/petsLogic';
import type { TwitchEvent } from '../src/utils/twitchEvents';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const fakePet = () => ({ event: vi.fn(), chat: vi.fn(), raid: vi.fn(), voice: vi.fn(), test: vi.fn() });
const called = (pet: ReturnType<typeof fakePet>) =>
  Object.entries(pet)
    .filter(([, fn]) => fn.mock.calls.length > 0)
    .map(([name]) => name);

describe('studio fase 1: registro', () => {
  it('las tres cajas están en el mapa de la fase y en el de todas las fases', () => {
    expect(Object.keys(FASE1_BOXES).sort()).toEqual(['game', 'music', 'pet']);
    (['pet', 'game', 'music'] as const).forEach((type) => expect(typeof FASE1_BOXES[type]).toBe('function'));
    // El índice se lee como texto: importarlo arrastraría las cajas de las otras fases
    expect(read('../src/components/estudio/boxes/index.ts')).toContain('...FASE1_BOXES');
  });

  it('ya se pueden añadir desde el editor y nacen con una caja en la que su capa cabe entera', () => {
    (['pet', 'game', 'music'] as const).forEach((type) => expect(SOON[type]).toBeUndefined());
    // Mascota: 19 em de ancho y 12 de alto dan el mismo em (40 px) que la fuente suelta
    const pet = typeInfo('pet');
    expect(pet.w / 19).toBe(40);
    expect(pet.h / 12).toBe(40);
    // Alerta de juego: la placa de 26 em con título de dos líneas cabe a lo ancho y a lo alto
    const game = typeInfo('game');
    expect(Math.abs(game.w / 26.5 - game.h / 11.4)).toBeLessThan(0.5);
    // Ahora suena: el diseño de serie cabe en la caja de serie sin que el alto lo encoja
    const music = typeInfo('music');
    const fit = musicFit(DEFAULT_MUSIC_SETTINGS);
    expect(music.h / fit.h).toBeGreaterThanOrEqual(music.w / fit.w);
  });
});

describe('studio fase 1: mascota', () => {
  it('cada señal de la escena va a la misma asa que usa la fuente suelta', () => {
    const event = { kind: 'points', login: 'pau_rl', text: '', test: false } as unknown as TwitchEvent;
    const tags = { username: 'pau_rl', 'display-name': 'Pau' };
    const voice = { id: 'm1', phase: 'start' as const, seconds: 2 };

    let pet = fakePet();
    routePetSignal(pet, { kind: 'twitch', event });
    expect(pet.event).toHaveBeenCalledWith(event);
    expect(called(pet)).toEqual(['event']);

    pet = fakePet();
    routePetSignal(pet, { kind: 'chat', tags, message: '!mascota hola', role: 'viewer' } as SceneSignal);
    expect(pet.chat).toHaveBeenCalledWith(tags, '!mascota hola');
    expect(called(pet)).toEqual(['chat']);

    pet = fakePet();
    routePetSignal(pet, { kind: 'raid', channel: 'StreamerHost', viewers: 48, login: 'streamerhost' });
    expect(pet.raid).toHaveBeenCalledWith('StreamerHost', 48);
    expect(called(pet)).toEqual(['raid']);

    pet = fakePet();
    routePetSignal(pet, { kind: 'voice', event: voice });
    expect(pet.voice).toHaveBeenCalledWith(voice);
    expect(called(pet)).toEqual(['voice']);
  });

  it('PETS_TEST lanza la prueba con los datos de ejemplo; lo demás del bus y lo ajeno no la tocan', () => {
    const pet = fakePet();
    routePetSignal(pet, { kind: 'bus', message: { type: 'PETS_TEST', trigger: 'bits' } });
    expect(pet.test).toHaveBeenCalledWith(SAMPLE_CUES.bits);
    expect(called(pet)).toEqual(['test']);

    const quiet = fakePet();
    routePetSignal(quiet, { kind: 'bus', message: { type: 'GAME_TEST', alert: 'win' } });
    routePetSignal(quiet, { kind: 'bus', message: { type: 'MUSIC_TEST', action: 'song' } });
    routePetSignal(quiet, { kind: 'staff', message: '!cancion', sender: { name: 'mod', role: 'mod' } });
    routePetSignal(quiet, { kind: 'kofi', payload: {}, test: true });
    expect(called(quiet)).toEqual([]);
  });

  it('la caja solo recorta por el borde del que la mascota asoma o por el que se desliza', () => {
    expect(petClip('bl', 'asoma')).toBe('inset(-400% -400% 0 -400%)');
    expect(petClip('tr', 'asoma')).toBe('inset(0 -400% -400% -400%)');
    // «Salta» cae desde arriba y se va por abajo, como «Asoma»
    expect(petClip('br', 'salta')).toBe(petClip('br', 'asoma'));
    expect(petClip('bl', 'desliza')).toBe('inset(-400% -400% -400% 0)');
    expect(petClip('tr', 'desliza')).toBe('inset(-400% 0 -400% -400%)');
    expect(petClip('bl', 'aparece')).toBeUndefined();
    // Nunca se cierran dos lados a la vez: el bocadillo siempre tiene por dónde crecer
    PET_POSITIONS.forEach(({ id: pos }) =>
      PET_ENTERS.forEach(({ id: enter }) => {
        const clip = petClip(pos, enter);
        if (clip) expect(clip.match(/-400%/g)).toHaveLength(3);
      })
    );
  });
});

describe('studio fase 1: alerta de juego', () => {
  it('«Nadie» no anuncia; «La voz» nunca pasa por la mascota; «La mascota» se le ofrece primero', () => {
    expect(gameVoice({ announcer: 'nadie', voiceSource: 'catalogue', voiceId: 'voz_catalogo' }, 'voz_mascota')).toBeNull();
    expect(gameVoice({ announcer: 'voz', voiceSource: 'chat', voiceId: 'voz_catalogo' }, 'voz_mascota')).toEqual({ pet: false, voiceId: '' });
    expect(gameVoice({ announcer: 'mascota', voiceSource: 'chat', voiceId: '' }, 'voz_mascota')).toEqual({ pet: true, voiceId: '' });
  });

  it('la voz de reserva sale de donde digan los ajustes: la del chat, la de la mascota o una del catálogo', () => {
    expect(gameVoice({ announcer: 'voz', voiceSource: 'pet', voiceId: 'voz_catalogo' }, 'voz_mascota')?.voiceId).toBe('voz_mascota');
    expect(gameVoice({ announcer: 'voz', voiceSource: 'catalogue', voiceId: 'voz_catalogo' }, 'voz_mascota')?.voiceId).toBe('voz_catalogo');
    // Mascota sin voz propia: se queda en la de la Voz del chat
    expect(gameVoice({ announcer: 'mascota', voiceSource: 'pet', voiceId: 'voz_catalogo' }, '')).toEqual({ pet: true, voiceId: '' });
  });
});

describe('studio fase 1: ahora suena', () => {
  it('el comando de moderación llega por la señal staff y devuelve lo que diga la capa', () => {
    const sender = { name: 'mod_ana', role: 'mod' as const };
    const mine = { command: vi.fn(() => true) };
    expect(routeMusicSignal(mine, { kind: 'staff', message: '!cancion', sender })).toBe(true);
    expect(mine.command).toHaveBeenCalledWith('!cancion', sender);

    const other = { command: vi.fn(() => false) };
    expect(routeMusicSignal(other, { kind: 'staff', message: '!ruleta abrir', sender })).toBe(false);
  });

  it('las demás señales no son suyas, y sin capa montada no consume nada', () => {
    const music = { command: vi.fn(() => true) };
    expect(routeMusicSignal(music, { kind: 'raid', channel: 'a', viewers: 1, login: 'a' })).toBe(false);
    expect(routeMusicSignal(music, { kind: 'bus', message: { type: 'MUSIC_TEST', action: 'song' } })).toBe(false);
    expect(music.command).not.toHaveBeenCalled();
    expect(routeMusicSignal(null, { kind: 'staff', message: '!cancion', sender: { name: 'x', role: 'broadcaster' } })).toBe(false);
  });

  it('la pieza entra desde el borde del lienzo que la caja tiene más cerca', () => {
    expect(boxEdge({ x: 40, y: 900, w: 560, h: 120 })).toBe('bl');
    expect(boxEdge({ x: STAGE_W - 600, y: 40, w: 560, h: 120 })).toBe('tr');
    expect(boxEdge({ x: (STAGE_W - 560) / 2, y: 40, w: 560, h: 120 })).toBe('tc');
    expect(boxEdge({ x: (STAGE_W - 560) / 2, y: STAGE_H / 2, w: 560, h: 120 })).toBe('bc');
  });

  it('dentro de la caja el tamaño y la posición de sus ajustes no mandan; lo demás se respeta', () => {
    const saved = { ...DEFAULT_MUSIC_SETTINGS, size: 140, pos: 'tr' as const, design: 'disco' as const, album: true };
    const boxed = musicInBox(saved, 'bl');
    expect(boxed).toEqual({ ...saved, size: 100, pos: 'bl' });
    expect(saved.size).toBe(140);
  });

  it('cada diseño tiene su ancho y su alto, y «Columna» cambia de alto sin portada o con álbum', () => {
    MUSIC_DESIGNS.forEach(({ id }) => {
      const fit = musicFit({ design: id, art: true, album: false });
      expect(fit.w).toBeGreaterThan(0);
      expect(fit.h).toBeGreaterThan(0);
    });
    expect(musicFit({ design: 'ficha', art: true, album: false })).toEqual({ w: 25, h: 4.9 });
    expect(musicFit({ design: 'ficha', art: false, album: true })).toEqual({ w: 25, h: 4.9 });
    const column = musicFit({ design: 'columna', art: true, album: false });
    expect(musicFit({ design: 'columna', art: false, album: false }).h).toBeLessThan(column.h);
    expect(musicFit({ design: 'columna', art: true, album: true }).h).toBeGreaterThan(column.h);
  });
});

describe('studio fase 1: hoja de estilos y capas', () => {
  const css = read('../src/styles/estudio-fase1.css').replace(/\/\*[\s\S]*?\*\//g, '');

  it('todas las reglas viven dentro de una caja de la escena', () => {
    const selectors = [...css.matchAll(/([^{}]+)\{/g)].flatMap((match) => match[1].split(',').map((selector) => selector.trim()));
    expect(selectors.length).toBeGreaterThan(8);
    selectors.forEach((selector) => expect(selector.startsWith('.es-cv .es-box ')).toBe(true));
  });

  it('nada se mide contra la pantalla ni se fija a ella, y no hay transiciones genéricas', () => {
    expect(css).not.toMatch(/\d(vw|vh|vmin|vmax)\b/);
    expect(css).not.toMatch(/position:\s*fixed/);
    expect(css).not.toMatch(/transition:\s*all/);
    expect(css).not.toMatch(/!important/);
  });

  it('las reglas de «Ahora suena» no alcanzan a las capas de Ko-fi, que comparten .itg-screen y .itg-ov', () => {
    const shared = [...css.matchAll(/([^{}]+)\{/g)].flatMap((match) => match[1].split(',')).filter((selector) => /\.itg-|\.np\b/.test(selector));
    expect(shared.length).toBeGreaterThan(0);
    shared.forEach((selector) => expect(selector).toContain(".es-lalo[data-kind='music']"));
  });

  it('la muestra quieta de «Ahora suena» no toca la fuente suelta: sin `still` todo sigue igual', () => {
    const overlay = read('../src/components/integraciones/MusicOverlay.tsx');
    expect(overlay).toContain('still = false');
    const widget = read('../src/components/integraciones/MusicWidgetLayer.tsx');
    expect(widget).not.toContain('still');
  });
});
