/**
 * src/components/done/renderers/luxRenderer.ts
 *
 * Personaje «lux» de Done: Lux procedural (Three.js), extraído del overlay de Lux a
 * public/lux/proc/luxProcedural.js. Este archivo adapta su API a la de Done.
 */

import type { DoneEmotion, DoneGesture } from '../../../lib/doneTypes';
import { LUX_PROCEDURAL_MODULE, importPublic, loadThree, type LuxProceduralApi, type LuxProceduralModule } from './load3d';
import type { ActorApi } from './types';

/** Segundos aproximados de cada gesto de Lux (la suma de las fases de su línea de tiempo). */
export const LUX_GESTURE_SECONDS: Record<DoneGesture, number> = {
  wave: 2.1,
  spin: 1.9,
  dance: 4.5,
  jump: 1.2,
  sing: 2.7,
  bow: 1.3,
  ult: 1.6,
  pride: 1.3,
  nod: 1.0,
  shrug: 1.1,
  arms_up: 2.3,
};

export interface LuxActorOptions {
  canvas: HTMLCanvasElement;
  reduceMotion: boolean;
  allowedGestures: DoneGesture[] | null;
  /** Fotogramas por segundo máximos (0 = los del navegador). */
  fps?: number;
}

export async function createLuxActor(options: LuxActorOptions): Promise<ActorApi & { proc: LuxProceduralApi }> {
  await loadThree();
  const mod = await importPublic<LuxProceduralModule>(LUX_PROCEDURAL_MODULE);
  const proc = mod.createLuxProcedural({ canvas: options.canvas, reduceMotion: options.reduceMotion });
  proc.setAllowedGestures(options.allowedGestures);
  proc.resize();
  proc.start(options.fps ?? 0);

  let emotion: DoneEmotion = 'normal';
  let open = false;
  return {
    proc,
    setEmotion(next) {
      emotion = next;
      proc.setEmotion(next);
    },
    gesture(gesture) {
      if (options.reduceMotion) return Promise.resolve();
      proc.gesture(gesture);
      return new Promise<void>((resolve) => window.setTimeout(resolve, LUX_GESTURE_SECONDS[gesture] * 1000));
    },
    setSpeaking(on) {
      if (!on && open) {
        open = false;
        proc.setMouthOpen(false, emotion);
      }
    },
    setMouth(level) {
      const next = level > 0.04;
      if (next !== open) {
        open = next;
        proc.setMouthOpen(next, emotion);
      }
    },
    setThinking: () => undefined,
    resize: () => proc.resize(),
    dispose: () => proc.dispose(),
  };
}
