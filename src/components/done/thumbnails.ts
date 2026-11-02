/**
 * src/components/done/thumbnails.ts
 *
 * Pósters de la galería de personajes. Un GLB o Lux en 3D no puede tener un contexto WebGL por
 * tarjeta (con decenas de modelos el navegador pierde contextos). Se renderizan de uno en uno en
 * un canvas compartido oculto, se guarda la imagen y se libera el modelo. Cada tarjeta pide su
 * póster solo cuando entra en pantalla (carga perezosa) y la imagen queda en caché por personaje.
 */

import type { DoneGesture } from '../../lib/doneTypes';
import type { CharacterSpec } from './doneLogic';

const POSTER_SIZE = 256;
const POSTER_TIMEOUT_MS = 15000;
/** Lo que se espera tras cargar para que el modelo ya esté en su pose de reposo. */
const SETTLE_MS = 350;

const cache = new Map<string, Promise<string | null>>();
const canvases: Partial<Record<'glb' | 'lux', HTMLCanvasElement>> = {};
let chain: Promise<unknown> = Promise.resolve();

/** Un canvas oculto por tipo, dentro del documento (hace falta para que mida su tamaño). */
function sharedCanvas(kind: 'glb' | 'lux'): HTMLCanvasElement {
  let canvas = canvases[kind];
  if (canvas) return canvas;
  canvas = document.createElement('canvas');
  Object.assign(canvas.style, { position: 'fixed', left: '-10000px', top: '0', width: `${POSTER_SIZE}px`, height: `${POSTER_SIZE}px`, pointerEvents: 'none' });
  canvas.setAttribute('aria-hidden', 'true');
  // Sin esto, toDataURL devuelve una imagen en blanco después de pintar.
  const original = canvas.getContext.bind(canvas) as (type: string, attributes?: unknown) => unknown;
  (canvas as unknown as { getContext: unknown }).getContext = (type: string, attributes?: Record<string, unknown>) =>
    original(type, type.startsWith('webgl') ? { ...attributes, preserveDrawingBuffer: true } : attributes);
  document.body.appendChild(canvas);
  canvases[kind] = canvas;
  return canvas;
}

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

async function render(spec: CharacterSpec, widgetKey: string): Promise<string | null> {
  const noGestures: DoneGesture[] | null = null;
  if (spec.kind === 'lux') {
    const { createLuxActor } = await import('./renderers/luxRenderer');
    const canvas = sharedCanvas('lux');
    const actor = await createLuxActor({ canvas, reduceMotion: true, allowedGestures: noGestures, fps: 5 });
    try {
      await wait(SETTLE_MS);
      actor.proc.renderOnce();
      return canvas.toDataURL('image/webp', 0.85);
    } finally {
      actor.dispose();
    }
  }
  if (spec.kind === 'glb' && spec.modelId) {
    const { createGlbActor } = await import('./renderers/glbRenderer');
    const canvas = sharedCanvas('glb');
    const actor = await createGlbActor({ canvas, modelId: spec.modelId, widgetKey, reduceMotion: true, allowedGestures: noGestures });
    try {
      await wait(SETTLE_MS * 2);
      return canvas.toDataURL('image/webp', 0.85);
    } finally {
      actor.dispose();
    }
  }
  return null;
}

/**
 * Póster de un personaje 3D, o null si no se pudo (sin red, modelo caído). Las peticiones se
 * ejecutan en fila; el resultado se guarda para no volver a renderizar el mismo personaje.
 */
export function posterFor(spec: CharacterSpec, widgetKey: string): Promise<string | null> {
  if (spec.kind === 'svg') return Promise.resolve(null);
  const key = `${spec.id}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const job = chain.then(() =>
    Promise.race([render(spec, widgetKey).catch(() => null), wait(POSTER_TIMEOUT_MS).then(() => null)])
  );
  chain = job.catch(() => null);
  // Un fallo no se guarda: la siguiente vez que la tarjeta entre en pantalla se reintenta.
  const guarded = job.then((value) => {
    if (value === null) cache.delete(key);
    return value;
  });
  cache.set(key, guarded);
  return guarded;
}

/** Vacía la caché (pruebas). */
export function clearPosters(): void {
  cache.clear();
}
