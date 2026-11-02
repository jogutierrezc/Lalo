/**
 * src/components/done/renderers/glbRenderer.ts
 *
 * Personaje «glb» de Done: los modelos GLB de la biblioteca de Lux se mueven con los clips y el
 * mapa de emociones y gestos de public/lux/mascota/ (Idle1_Base, Idle_Var1, Laugh, Taunt,
 * Dance_Loop, Crit). Este archivo solo adapta esa API a la de Done; no duplica la lógica de clips.
 * El modelo llega de /api/lux/mascota-model (R2 privado, con la clave de OBS).
 */

import type { DoneEmotion, DoneGesture } from '../../../lib/doneTypes';
import { doneModelUrl } from '../../../lib/doneClient';
import { MASCOTA_LOGIC_MODULE, MASCOTA_MODULE, importPublic, loadThree, type MascotaApi, type MascotaLogicModule, type MascotaModule } from './load3d';
import type { ActorApi } from './types';

export interface GlbActorOptions {
  canvas: HTMLCanvasElement;
  modelId: string;
  widgetKey: string;
  reduceMotion: boolean;
  /** Gestos permitidos del personaje; null = todos. */
  allowedGestures: DoneGesture[] | null;
  /** Una vista previa de tarjeta no necesita 30 fps: el módulo ya baja a 5 fps en reposo. */
  fps60?: boolean;
}

/** Crea el actor de un GLB. Rechaza si Three.js o el modelo no cargan: quien llama cae a la mascota SVG. */
export async function createGlbActor(options: GlbActorOptions): Promise<ActorApi & { mascota: MascotaApi }> {
  await loadThree();
  const [mod, logic] = await Promise.all([importPublic<MascotaModule>(MASCOTA_MODULE), importPublic<MascotaLogicModule>(MASCOTA_LOGIC_MODULE)]);
  const mascota = await mod.createMascota({
    canvas: options.canvas,
    modelUrl: doneModelUrl(options.widgetKey, options.modelId),
    fps60: options.fps60,
    reduceMotion: options.reduceMotion,
  });
  await mascota.enter();

  const allowed = options.allowedGestures;
  return {
    mascota,
    setEmotion: (emotion: DoneEmotion) => mascota.setEmotion(emotion),
    gesture(gesture) {
      if (options.reduceMotion || (allowed && !allowed.includes(gesture))) return Promise.resolve();
      mascota.setGesture(gesture);
      const clip = logic.GESTURE_CLIP[gesture];
      const seconds = logic.CLIP_SECONDS[clip] || 1.5;
      return new Promise<void>((resolve) => window.setTimeout(resolve, seconds * 1000));
    },
    setSpeaking: (on) => mascota.setSpeaking(on),
    setMouth: (level) => mascota.setMouth(level),
    // El GLB no tiene cara de «pensando»: se queda en reposo (Idle1_Base).
    setThinking: () => undefined,
    dispose: () => mascota.dispose(),
  };
}
