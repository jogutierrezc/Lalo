/**
 * src/utils/studioMotion.ts
 *
 * Entradas y salidas de las capas de una escena. Catálogo corto: aparecer,
 * subir, entrar de lado, cortina y crecer. Solo se animan transform, opacity y
 * clip-path. Con movimiento reducido todo se queda en un fundido, sin
 * desplazamientos.
 */

import gsap from 'gsap';
import type { AnimId } from '../types/studio';
import { reduced } from './alertMotion';

export interface LayerMotion {
  delay?: number;
  duration: number;
  /** La capa está en la mitad izquierda del lienzo: «entrar de lado» viene de ese lado. */
  fromLeft: boolean;
}

type Vars = Record<string, string | number>;

/** Estado oculto y estado en reposo de cada animación. Función pura, para poder probarla. */
export function layerStates(anim: AnimId, fromLeft: boolean, still: boolean): { hidden: Vars; shown: Vars } | null {
  if (anim === 'none') return null;
  if (still) return { hidden: { opacity: 0 }, shown: { opacity: 1 } };
  switch (anim) {
    case 'up':
      return { hidden: { opacity: 0, y: '1.2em' }, shown: { opacity: 1, y: 0 } };
    case 'side':
      return { hidden: { opacity: 0, x: fromLeft ? '-2.5em' : '2.5em' }, shown: { opacity: 1, x: 0 } };
    case 'wipe':
      return { hidden: { clipPath: 'inset(0 100% 0 0)' }, shown: { clipPath: 'inset(0 0% 0 0)' } };
    case 'pop':
      return { hidden: { opacity: 0, scale: 0.92 }, shown: { opacity: 1, scale: 1 } };
    default:
      return { hidden: { opacity: 0 }, shown: { opacity: 1 } };
  }
}

/** La salida dura menos que la entrada. */
export const exitSeconds = (duration: number) => Math.max(0.12, Math.round(duration * 45) / 100);

const CLEAR = 'transform,opacity,clipPath';

export function killLayer(el: HTMLElement): void {
  gsap.killTweensOf(el);
  gsap.set(el, { clearProps: CLEAR });
}

export function layerEnter(el: HTMLElement, anim: AnimId, o: LayerMotion): gsap.core.Tween | null {
  killLayer(el);
  const states = layerStates(anim, o.fromLeft, reduced());
  if (!states) return null;
  return gsap.fromTo(el, states.hidden, {
    ...states.shown,
    duration: o.duration,
    delay: o.delay || 0,
    ease: 'expo.out',
    clearProps: CLEAR,
  });
}

/** Salida. `onDone` se llama siempre, también si la animación es «ninguna». */
export function layerExit(el: HTMLElement, anim: AnimId, o: LayerMotion, onDone: () => void): gsap.core.Tween | null {
  gsap.killTweensOf(el);
  const states = layerStates(anim, o.fromLeft, reduced());
  if (!states) {
    onDone();
    return null;
  }
  return gsap.fromTo(el, states.shown, { ...states.hidden, duration: exitSeconds(o.duration), ease: 'power2.out', onComplete: onDone });
}
