/**
 * src/components/done/renderers/types.ts
 *
 * API común de los tres tipos de personaje de Done (svg, lux y glb): la misma para el overlay de
 * OBS, la vista previa de la ventana y las tarjetas de la galería.
 */

import type { DoneEmotion, DoneGesture } from '../../../lib/doneTypes';

export interface ActorApi {
  /** Cambia la cara/emoción del personaje. */
  setEmotion(emotion: DoneEmotion): void;
  /** Hace un gesto; se resuelve cuando termina (o tras un seguro de tiempo). */
  gesture(gesture: DoneGesture): Promise<void>;
  /** Empieza o termina de hablar (tally encendido, labios). */
  setSpeaking(on: boolean): void;
  /** Volumen de la voz, de 0 a 1, para la boca. */
  setMouth(level: number): void;
  /** Cara de «pensando» mientras llega la respuesta. */
  setThinking(on: boolean): void;
  dispose(): void;
}
