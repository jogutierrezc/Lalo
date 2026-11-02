/**
 * src/components/done/CharacterView.tsx
 *
 * Dibuja el personaje de Done según su tipo: «svg» (la mascota del diseño, con GSAP), «lux»
 * (Lux procedural en Three.js) o «glb» (un modelo de la biblioteca, movido por los clips de Lux).
 * Expone la misma API de actor a los tres (emoción, gesto, hablar, boca, pensar). Si el 3D no
 * carga (sin red al CDN, modelo caído), muestra la mascota de Done y avisa por onFallback.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { DoneEmotion } from '../../lib/doneTypes';
import { SVG_PALETTES, type CharacterSpec } from './doneLogic';
import { createSvgActor } from './renderers/svgCharacter';
import type { ActorApi } from './renderers/types';

export interface CharacterViewProps {
  spec: CharacterSpec;
  /** Clave de OBS: sin ella no se puede pedir el GLB. */
  widgetKey?: string;
  reducedMotion: boolean;
  /** Se llama una vez cuando el 3D no pudo cargar y se muestra la mascota SVG. */
  onFallback?: (reason: string) => void;
  /** El personaje ya está dibujado y acepta emociones y gestos. */
  onReady?: () => void;
  className?: string;
}

const defaultPalette = SVG_PALETTES.done;

export const CharacterView = forwardRef<ActorApi, CharacterViewProps>(function CharacterView(
  { spec, widgetKey, reducedMotion, onFallback, onReady, className },
  ref
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const actorRef = useRef<ActorApi | null>(null);
  const memory = useRef<{ emotion: DoneEmotion; speaking: boolean; thinking: boolean }>({ emotion: 'normal', speaking: false, thinking: false });
  const fallbackRef = useRef(onFallback);
  fallbackRef.current = onFallback;
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  // La API que ve el padre es estable: reenvía al actor actual y recuerda el estado para el siguiente.
  useImperativeHandle(
    ref,
    (): ActorApi => ({
      setEmotion(emotion) {
        memory.current.emotion = emotion;
        actorRef.current?.setEmotion(emotion);
      },
      gesture: (gesture) => actorRef.current?.gesture(gesture) ?? Promise.resolve(),
      setSpeaking(on) {
        memory.current.speaking = on;
        actorRef.current?.setSpeaking(on);
      },
      setMouth: (level) => actorRef.current?.setMouth(level),
      setThinking(on) {
        memory.current.thinking = on;
        actorRef.current?.setThinking(on);
      },
      dispose: () => undefined,
    }),
    []
  );

  const modelId = spec.modelId;
  const palette = spec.palette;
  const gesturesKey = spec.allowedGestures ? spec.allowedGestures.join(',') : '*';

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let actor: ActorApi | null = null;
    let canvas: HTMLCanvasElement | null = null;

    const adopt = (next: ActorApi) => {
      actor = next;
      actorRef.current = next;
      const m = memory.current;
      next.setEmotion(m.emotion);
      if (m.thinking) next.setThinking(true);
      if (m.speaking) next.setSpeaking(true);
      readyRef.current?.();
    };

    const mountSvg = (p = palette ?? defaultPalette) => {
      host.innerHTML = '';
      host.dataset.kind = 'svg';
      adopt(createSvgActor(host, p, { reduced: reducedMotion }));
    };

    const fail = (reason: string) => {
      if (cancelled) return;
      if (canvas) canvas.remove();
      canvas = null;
      mountSvg(defaultPalette);
      fallbackRef.current?.(reason);
    };

    if (spec.kind === 'svg') {
      mountSvg();
    } else {
      host.innerHTML = '';
      host.dataset.kind = spec.kind;
      canvas = document.createElement('canvas');
      canvas.className = 'done-canvas';
      host.appendChild(canvas);
      const built = canvas;
      const allowed = spec.allowedGestures;
      const load =
        spec.kind === 'lux'
          ? import('./renderers/luxRenderer').then((m) => m.createLuxActor({ canvas: built, reduceMotion: reducedMotion, allowedGestures: allowed }))
          : widgetKey && modelId
            ? import('./renderers/glbRenderer').then((m) => m.createGlbActor({ canvas: built, modelId, widgetKey, reduceMotion: reducedMotion, allowedGestures: allowed }))
            : Promise.reject(new Error('Falta la clave de OBS para cargar el modelo.'));
      load.then(
        (created) => {
          if (cancelled) {
            created.dispose();
            return;
          }
          adopt(created);
        },
        (error: unknown) => fail(error instanceof Error ? error.message : 'No se pudo cargar el modelo 3D.')
      );
    }

    return () => {
      cancelled = true;
      actorRef.current = null;
      actor?.dispose();
      host.innerHTML = '';
    };
    // El personaje se vuelve a montar solo si cambia de verdad (tipo, modelo, paleta o gestos).
  }, [spec.id, spec.kind, modelId, palette?.body, palette?.head, palette?.accent, palette?.screen, gesturesKey, widgetKey, reducedMotion]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={hostRef} className={`done-char${className ? ` ${className}` : ''}`} data-kind={spec.kind} role="img" aria-label={`Personaje ${spec.name}`} />;
});
