/**
 * src/components/estudio/SceneView.tsx
 *
 * Pinta una escena de Studio. Es el mismo componente en el lienzo del editor y
 * en la fuente de navegador de OBS (`#widget?app=scene&scene=...`): lo que se
 * edita es lo que se emite.
 *
 * - La raíz ocupa el hueco 16:9 que le dé su contenedor. Las capas se colocan
 *   en porcentajes de 1920 × 1080 y todo lo demás se mide en em (1em = 32 px
 *   del lienzo), así la escena se ve igual a cualquier tamaño.
 * - Cada capa entra al cargar la escena con su animación; al ocultarla sale con
 *   la suya. Al desmontar no queda ningún movimiento vivo.
 * - Los avisos (chat, alertas, raids) llegan por el asa que expone: quien monta
 *   la escena los reparte, sin abrir otra conexión.
 */

import React, { forwardRef, memo, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import type { ChatOverlayHandle } from '../chat/ChatOverlayView';
import type { RaidLayerHandle } from '../raid/RaidLayer';
import { STAGE_H, STAGE_W, StudioLayer, StudioScene, isLaloLayer } from '../../types/studio';
import type { StreamAlertEvent } from '../../utils/bus';
import { killLayer, layerEnter, layerExit } from '../../utils/studioMotion';
import { BasicElement, SceneMode } from './SceneElements';
import { LaloBox, SceneData, SceneRegistry } from './LaloBoxes';
import '../../styles/chat.css';
import '../../styles/raid.css';
import '../../styles/estudio.css';

export type { SceneData } from './LaloBoxes';

export interface SceneHandle {
  /** Reparte los mensajes del chat entre las capas de chat de la escena. */
  chat: ChatOverlayHandle;
  /** Llega una raid. Devuelve true si alguna capa la saluda. */
  raid: RaidLayerHandle['raid'];
  /** Mensaje del streamer o de un moderador. Devuelve true si era un comando del saludo de raid. */
  raidCommand: RaidLayerHandle['command'];
  /** Llega una alerta: la muestran las capas de alerta de la escena. */
  alert: (alert: StreamAlertEvent) => void;
  /** Prueba de una capa: en la zona aleatoria, la muestra salta a otro sitio. */
  test: (layerId: string) => void;
  /** Repite la entrada o la salida de una capa, o la entrada de todas. */
  play: (layerId: string, kind: 'enter' | 'exit') => void;
  playAll: () => void;
}

interface SceneViewProps {
  scene: StudioScene;
  mode: SceneMode;
  data: SceneData;
  /** Avisos de muestra en OBS (demo=1 en la URL). */
  demo?: boolean;
  /** La voz del streamer lee la bienvenida de una raid. */
  onSpeak?: (text: string) => void;
}

type Player = (kind: 'enter' | 'exit', withDelay: boolean) => void;

interface ShellProps {
  layer: StudioLayer;
  z: number;
  mode: SceneMode;
  data: SceneData;
  registry: SceneRegistry;
  players: Map<string, Player>;
  demo?: boolean;
  onSpeak?: (text: string) => void;
}

const LayerShell = memo(function LayerShell({ layer, z, mode, data, registry, players, demo, onSpeak }: ShellProps) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [gone, setGone] = useState(layer.hidden);
  const firstRef = useRef(true);
  const motion = {
    enter: layer.enter,
    exit: layer.exit,
    delay: layer.delay,
    duration: layer.duration,
    fromLeft: layer.x + layer.w / 2 < STAGE_W / 2,
  };
  const motionRef = useRef(motion);
  motionRef.current = motion;

  // Entra al montarse y al volver a mostrarse; sale al ocultarse
  useLayoutEffect(() => {
    const el = innerRef.current;
    const m = motionRef.current;
    const wasFirst = firstRef.current;
    firstRef.current = false;
    if (!el) return;
    if (layer.hidden) {
      if (wasFirst) return;
      const tween = layerExit(el, m.exit, m, () => setGone(true));
      // Si OBS tiene la fuente oculta y no avanza la animación, la capa se retira igual
      const guard = setTimeout(() => setGone(true), m.duration * 1000 + 400);
      return () => {
        clearTimeout(guard);
        tween?.kill();
      };
    }
    setGone(false);
    const tween = layerEnter(el, m.enter, m);
    // Y si no avanza la entrada, la capa acaba en su sitio de todos modos
    const guard = setTimeout(() => tween?.progress(1), (m.delay + m.duration) * 1000 + 400);
    return () => {
      clearTimeout(guard);
      tween?.kill();
      killLayer(el);
    };
  }, [layer.hidden]);

  // Vista previa de la entrada y la salida desde el editor
  useEffect(() => {
    let back: gsap.core.Tween | null = null;
    players.set(layer.id, (kind, withDelay) => {
      const el = innerRef.current;
      if (!el) return;
      const m = motionRef.current;
      back?.kill();
      if (kind === 'enter') {
        layerEnter(el, m.enter, { ...m, delay: withDelay ? m.delay : 0 });
        return;
      }
      // Tras la salida la capa vuelve a su sitio para seguir editando
      layerExit(el, m.exit, m, () => {
        back = gsap.delayedCall(0.6, () => killLayer(el));
      });
    });
    return () => {
      back?.kill();
      players.delete(layer.id);
    };
  }, [players, layer.id]);

  const style: React.CSSProperties = {
    left: `${(layer.x / STAGE_W) * 100}%`,
    top: `${(layer.y / STAGE_H) * 100}%`,
    width: `${(layer.w / STAGE_W) * 100}%`,
    height: `${(layer.h / STAGE_H) * 100}%`,
    zIndex: z,
    opacity: layer.opacity / 100,
    display: gone && layer.hidden ? 'none' : undefined,
  };

  return (
    <div className="es-box" data-type={layer.type} style={style}>
      <div ref={innerRef} className="es-in">
        {gone && layer.hidden ? null : isLaloLayer(layer.type) ? (
          <LaloBox layer={layer} mode={mode} data={data} registry={registry} demo={demo} onSpeak={onSpeak} />
        ) : (
          <BasicElement layer={layer} mode={mode} />
        )}
      </div>
    </div>
  );
});

export const SceneView = forwardRef<SceneHandle, SceneViewProps>(({ scene, mode, data, demo, onSpeak }, ref) => {
  const registry = useMemo<SceneRegistry>(() => ({ chat: new Map(), raid: new Map(), alert: new Map(), test: new Map() }), []);
  const players = useMemo(() => new Map<string, Player>(), []);

  useImperativeHandle(
    ref,
    () => ({
      chat: {
        push: (message) => registry.chat.forEach((chat) => chat.push(message)),
        remove: (id) => registry.chat.forEach((chat) => chat.remove(id)),
        removeUser: (username) => registry.chat.forEach((chat) => chat.removeUser(username)),
        clear: () => registry.chat.forEach((chat) => chat.clear()),
        removeLast: () => Array.from(registry.chat.values()).map((chat) => chat.removeLast()).some(Boolean),
      },
      raid: (channel, viewers, login) =>
        Array.from(registry.raid.values()).map((raid) => raid.raid(channel, viewers, login)).some(Boolean),
      raidCommand: (message, sender) =>
        Array.from(registry.raid.values()).map((raid) => raid.command(message, sender)).some(Boolean),
      alert: (alert) => registry.alert.forEach((fire) => fire(alert)),
      test: (layerId) => registry.test.get(layerId)?.(),
      play: (layerId, kind) => players.get(layerId)?.(kind, false),
      playAll: () => players.forEach((play) => play('enter', true)),
    }),
    [registry, players]
  );

  const total = scene.layers.length;
  return (
    <div className="es-cv" data-mode={mode} aria-hidden="true">
      {scene.layers.map((layer, index) => (
        <LayerShell
          key={layer.id}
          layer={layer}
          z={total - index}
          mode={mode}
          data={data}
          registry={registry}
          players={players}
          demo={demo}
          onSpeak={onSpeak}
        />
      ))}
    </div>
  );
});

SceneView.displayName = 'SceneView';
