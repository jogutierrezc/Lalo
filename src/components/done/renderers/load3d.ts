/**
 * src/components/done/renderers/load3d.ts
 *
 * Carga de Three.js r128 y de los módulos 3D de Lux que viven en public/lux/. Done reutiliza los
 * mismos archivos que el overlay de Lux (mascota.js, logic.js y luxProcedural.js): no hay una
 * segunda copia del renderizado de los GLB. Three.js llega del mismo CDN y versión que usa el
 * overlay de Lux, y GSAP es el del paquete de la app (mascota.js lo espera como global).
 */

import gsap from 'gsap';
import { publicModuleUrl } from './publicUrl';

/** Misma URL y versión que public/lux/overlay.html. */
export const THREE_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';

let threePromise: Promise<void> | null = null;

/** Carga Three.js una sola vez. Falla si el CDN no responde: quien llama muestra la mascota SVG. */
export function loadThree(): Promise<void> {
  const w = window as unknown as { THREE?: unknown; gsap?: unknown };
  w.gsap = w.gsap ?? gsap;
  if (w.THREE) return Promise.resolve();
  if (!threePromise) {
    threePromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = THREE_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        threePromise = null;
        script.remove();
        reject(new Error('No se pudo cargar Three.js'));
      };
      document.head.appendChild(script);
    });
  }
  return threePromise;
}

/** Importa un módulo de public/ en tiempo de ejecución (Vite no lo empaqueta: se sirve tal cual). */
export function importPublic<T>(path: string): Promise<T> {
  return import(/* @vite-ignore */ publicModuleUrl(path)) as Promise<T>;
}

export const MASCOTA_MODULE = '/lux/mascota/mascota.js';
export const MASCOTA_LOGIC_MODULE = '/lux/mascota/logic.js';
export const LUX_PROCEDURAL_MODULE = '/lux/proc/luxProcedural.js';

/** Lo que usamos de public/lux/mascota/mascota.js. */
export interface MascotaApi {
  enter(): Promise<void>;
  exit(): Promise<void>;
  setEmotion(id: string): void;
  setGesture(name: string): void;
  setSpeaking(on: boolean): void;
  setMouth(level: number): void;
  resize(): void;
  dispose(): void;
}

export interface MascotaModule {
  createMascota(options: {
    canvas: HTMLCanvasElement;
    modelUrl: string;
    fps60?: boolean;
    reduceMotion?: boolean;
    turn?: number;
    effects?: { shake(): void; flash(): void } | null;
  }): Promise<MascotaApi>;
}

export interface MascotaLogicModule {
  CLIP_SECONDS: Record<string, number>;
  GESTURE_CLIP: Record<string, string>;
}

/** Lo que usamos de public/lux/proc/luxProcedural.js. */
export interface LuxProceduralApi {
  start(fps?: number): void;
  stop(): void;
  renderOnce(): void;
  resize(): void;
  setEmotion(id: string): void;
  setMouthOpen(open: boolean, fallback?: string): void;
  gesture(name: string): void;
  setAllowedGestures(list: string[] | null): void;
  setHairColor(color: string): void;
  dispose(): void;
}

export interface LuxProceduralModule {
  createLuxProcedural(options: { canvas: HTMLCanvasElement; reduceMotion?: boolean }): LuxProceduralApi;
}
