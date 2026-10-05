/**
 * src/components/estudio/boxes/fase1Logic.ts
 *
 * Lo que las cajas de la fase 1 (Mascota, Alerta de juego, Ahora suena) deciden
 * sin pintar nada: a qué asa va cada señal de la escena, quién anuncia una
 * alerta de juego, por dónde recorta la caja a la mascota y cómo se ajusta
 * «Ahora suena» a su caja. Funciones puras, para poder probarlas sin navegador.
 */

import type { GameSettings } from '../../../types/game';
import type { MusicDesign, MusicSettings } from '../../../types/music';
import type { PetEnter, PetPos } from '../../../types/pets';
import { STAGE_H, STAGE_W, type StudioLayer } from '../../../types/studio';
import type { AlertPosition } from '../../../utils/appearance';
import { SAMPLE_CUES } from '../../../utils/petsLogic';
import type { MusicWidgetLayerHandle } from '../../integraciones/MusicWidgetLayer';
import type { PetLayerHandle } from '../../mascotas/PetLayer';
import type { SceneSignal } from './types';

// ---------- Mascota ----------

/** Reparte una señal de la escena a la mascota, igual que el widget hace con la fuente suelta. */
export function routePetSignal(pet: Pick<PetLayerHandle, 'event' | 'chat' | 'raid' | 'voice' | 'test'>, signal: SceneSignal): void {
  if (signal.kind === 'twitch') pet.event(signal.event);
  else if (signal.kind === 'chat') pet.chat(signal.tags, signal.message);
  else if (signal.kind === 'raid') pet.raid(signal.channel, signal.viewers);
  else if (signal.kind === 'voice') pet.voice(signal.event);
  else if (signal.kind === 'bus' && signal.message.type === 'PETS_TEST') pet.test(SAMPLE_CUES[signal.message.trigger]);
}

/** Lo que sobresale de la caja sin recortarse: de sobra para un bocadillo largo o unas chispas. */
const OPEN = '-400%';

/**
 * Por dónde recorta la caja a la mascota: solo por el borde del que asoma o por el que se desliza,
 * para que entre «desde detrás» de la caja. Por los demás lados el bocadillo y las chispas pueden
 * salirse. Devuelve el `clip-path`, o undefined si no hay nada que recortar («Aparece»).
 */
export function petClip(pos: PetPos, enter: PetEnter): string | undefined {
  const edge = enter === 'asoma' || enter === 'salta';
  const side = enter === 'desliza';
  if (!edge && !side) return undefined;
  const top = edge && pos[0] === 't' ? '0' : OPEN;
  const bottom = edge && pos[0] === 'b' ? '0' : OPEN;
  const left = side && pos[1] === 'l' ? '0' : OPEN;
  const right = side && pos[1] === 'r' ? '0' : OPEN;
  return `inset(${top} ${right} ${bottom} ${left})`;
}

// ---------- Alerta de juego ----------

/**
 * Quién dice una alerta de juego y con qué voz. `pet`: se le ofrece primero a la mascota de la misma
 * escena; si no hay o no la acepta, la lee la voz con `voiceId` (vacío: la de la Voz del chat).
 * null: nadie la anuncia.
 */
export function gameVoice(
  game: Pick<GameSettings, 'announcer' | 'voiceSource' | 'voiceId'>,
  petVoiceId: string
): { pet: boolean; voiceId: string } | null {
  if (game.announcer === 'nadie') return null;
  const voiceId = game.voiceSource === 'pet' ? petVoiceId : game.voiceSource === 'catalogue' ? game.voiceId : '';
  return { pet: game.announcer === 'mascota', voiceId };
}

// ---------- Ahora suena ----------

/** Reparte una señal a «Ahora suena». true si era su comando de moderación. */
export function routeMusicSignal(music: Pick<MusicWidgetLayerHandle, 'command'> | null, signal: SceneSignal): boolean {
  if (!music || signal.kind !== 'staff') return false;
  return music.command(signal.message, signal.sender);
}

/**
 * El borde del lienzo que la caja tiene más cerca, con las seis posiciones de las capas: la pieza
 * entra desde ahí y se arrima a ese lado de la caja.
 */
export function boxEdge(layer: Pick<StudioLayer, 'x' | 'y' | 'w' | 'h'>): AlertPosition {
  const cx = (layer.x + layer.w / 2) / STAGE_W;
  const cy = (layer.y + layer.h / 2) / STAGE_H;
  const side = cx < 1 / 3 ? 'l' : cx > 2 / 3 ? 'r' : 'c';
  return `${cy < 0.5 ? 't' : 'b'}${side}` as AlertPosition;
}

/** Ajustes de «Ahora suena» dentro de una caja: el tamaño lo pone la caja y la posición, el sitio de la caja. */
export function musicInBox(settings: MusicSettings, pos: AlertPosition): MusicSettings {
  return { ...settings, size: 100, pos };
}

/** Ancho y alto de cada diseño, en em de la pieza (los de ahora-suena.css, con un pequeño margen). */
const MUSIC_FIT: Record<MusicDesign, { w: number; h: number }> = {
  ficha: { w: 25, h: 4.9 },
  franja: { w: 46, h: 5.8 },
  columna: { w: 13.5, h: 21.4 },
  disco: { w: 31, h: 8.3 },
  // Su ancho depende del título: con 30 em caben los habituales y el resto se desliza
  linea: { w: 30, h: 2.6 },
  portada: { w: 42, h: 16 },
};

/**
 * Entre cuánto se reparten el ancho y el alto de la caja para sacar el tamaño de letra de la pieza:
 * el diseño elegido cabe entero en la caja, a lo ancho y a lo alto.
 */
export function musicFit(settings: Pick<MusicSettings, 'design' | 'art' | 'album'>): { w: number; h: number } {
  const base = MUSIC_FIT[settings.design];
  if (settings.design !== 'columna') return base;
  // «Columna» apila la portada y las líneas: sin portada o con álbum cambia de alto
  const h = base.h - (settings.art ? 0 : 12.6) + (settings.album ? 1.2 : 0);
  return { w: base.w, h: Math.round(h * 10) / 10 };
}
