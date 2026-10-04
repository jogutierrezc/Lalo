/**
 * src/components/estudio/EditorCanvas.tsx
 *
 * Lienzo del editor: pinta la escena con SceneView y, encima, una caja
 * invisible por capa para elegirla, moverla y estirarla.
 *
 * - El puntero queda capturado mientras dura el gesto y nada se mueve hasta que
 *   recorre unos píxeles. Un gesto entero es un solo paso de deshacer.
 * - Imanes: bordes y centro del lienzo, bordes y centros de las otras capas y,
 *   si no hay nada cerca, la cuadrícula. Con Alt se apagan. Las líneas rosas
 *   marcan con qué se ha alineado la capa.
 * - Mayús al estirar mantiene la proporción, igual que el candado de la capa.
 * - Teclado con el lienzo enfocado: flechas (1 px; con Mayús, 10), Supr,
 *   Ctrl+D, Ctrl+C, Ctrl+V y Escape. Deshacer y rehacer los atiende la página.
 */

import React, { useRef, useState } from 'react';
import { MIN_SIZE, STAGE_H, STAGE_W, StudioLayer, StudioScene } from '../../types/studio';
import { HANDLES, Handle, Rect, keepOnStage, resizeRect, roundRect, snapMove, snapResize } from '../../utils/studioGeometry';
import type { EditorPrefs } from './editorPrefs';
import { SceneData, SceneHandle, SceneView } from './SceneView';

/** Píxeles de pantalla que debe recorrer el puntero para que empiece el gesto. */
const START_DISTANCE = 4;
/** Distancia del imán, en píxeles de pantalla. */
const SNAP_SCREEN_PX = 7;

interface Drag {
  id: string;
  handle: Handle | null;
  scale: number;
  px: number;
  py: number;
  orig: Rect;
  keepRatio: boolean;
  moved: boolean;
  tag: string;
}

interface EditorCanvasProps {
  scene: StudioScene;
  selectedId: string | null;
  prefs: EditorPrefs;
  data: SceneData;
  sceneRef: React.RefObject<SceneHandle | null>;
  onSelect: (id: string | null) => void;
  /** Cambia la caja de una capa. Los cambios con la misma etiqueta son un solo paso de deshacer. */
  onRect: (id: string, rect: Rect, tag: string) => void;
  onStepEnd: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onCopy: () => void;
  onPaste: () => void;
}

const pct = (value: number, total: number) => `${(value / total) * 100}%`;
let gesture = 0;

export const EditorCanvas: React.FC<EditorCanvasProps> = ({
  scene,
  selectedId,
  prefs,
  data,
  sceneRef,
  onSelect,
  onRect,
  onStepEnd,
  onRemove,
  onDuplicate,
  onCopy,
  onPaste,
}) => {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const selected = scene.layers.find((layer) => layer.id === selectedId) || null;

  const snapOptions = (id: string, scale: number, off: boolean) => ({
    stageW: STAGE_W,
    stageH: STAGE_H,
    others: scene.layers.filter((layer) => layer.id !== id && !layer.hidden),
    layers: prefs.snapLayers && !off,
    grid: prefs.snapGrid && !off ? prefs.gridSize : 0,
    threshold: off ? 0 : SNAP_SCREEN_PX * scale,
  });

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const stage = stageRef.current;
    if (!stage) return;
    stage.focus({ preventScroll: true });
    const target = event.target as HTMLElement;
    const hit = target.closest<HTMLElement>('[data-layer]');
    if (!hit) {
      onSelect(null);
      return;
    }
    const layer = scene.layers.find((item) => item.id === hit.dataset.layer);
    if (!layer) return;
    if (layer.id !== selectedId) onSelect(layer.id);
    if (layer.locked) return;
    gesture += 1;
    dragRef.current = {
      id: layer.id,
      handle: (target.dataset.h as Handle | undefined) || null,
      scale: STAGE_W / stage.getBoundingClientRect().width,
      px: event.clientX,
      py: event.clientY,
      orig: { x: layer.x, y: layer.y, w: layer.w, h: layer.h },
      keepRatio: layer.keepRatio,
      moved: false,
      tag: `gesto-${gesture}`,
    };
    stage.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const sx = event.clientX - drag.px;
    const sy = event.clientY - drag.py;
    if (!drag.moved) {
      if (Math.abs(sx) + Math.abs(sy) < START_DISTANCE) return;
      drag.moved = true;
    }
    const dx = sx * drag.scale;
    const dy = sy * drag.scale;
    const options = snapOptions(drag.id, drag.scale, event.altKey);

    if (!drag.handle) {
      const snapped = snapMove({ ...drag.orig, x: drag.orig.x + dx, y: drag.orig.y + dy }, options);
      setGuides({ v: snapped.guidesV, h: snapped.guidesH });
      onRect(drag.id, roundRect(keepOnStage(snapped, STAGE_W, STAGE_H)), drag.tag);
      return;
    }
    const keepRatio = drag.keepRatio || event.shiftKey;
    const sized = resizeRect(drag.orig, drag.handle, dx, dy, { min: MIN_SIZE, keepRatio });
    if (keepRatio) {
      // Con proporción fija el imán deformaría la capa: no se aplica
      setGuides({ v: [], h: [] });
      onRect(drag.id, roundRect(sized), drag.tag);
      return;
    }
    const snapped = snapResize(sized, drag.handle, options, MIN_SIZE);
    setGuides({ v: snapped.guidesV, h: snapped.guidesH });
    onRect(drag.id, roundRect(snapped), drag.tag);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (stageRef.current?.hasPointerCapture(event.pointerId)) stageRef.current.releasePointerCapture(event.pointerId);
    setGuides({ v: [], h: [] });
    if (drag.moved) onStepEnd();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const ctrl = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (ctrl && key === 'v') {
      event.preventDefault();
      onPaste();
      return;
    }
    if (!selected) return;
    const step = event.shiftKey ? 10 : 1;
    const move = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] }[key];
    if (move) {
      event.preventDefault();
      if (selected.locked) return;
      const rect = keepOnStage({ x: selected.x + move[0], y: selected.y + move[1], w: selected.w, h: selected.h }, STAGE_W, STAGE_H);
      onRect(selected.id, rect, `teclas-${selected.id}`);
    } else if (key === 'delete' || key === 'backspace') {
      event.preventDefault();
      onRemove();
    } else if (ctrl && key === 'd') {
      event.preventDefault();
      onDuplicate();
    } else if (ctrl && key === 'c') {
      event.preventDefault();
      onCopy();
    } else if (key === 'escape') {
      onSelect(null);
    }
  };

  const onKeyUp = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Una tanda de flechas es un solo paso de deshacer
    if (event.key.startsWith('Arrow')) onStepEnd();
  };

  const width = prefs.zoom === 'fit' ? undefined : prefs.zoom === '50' ? STAGE_W / 2 : STAGE_W;
  const total = scene.layers.length;
  const hitStyle = (layer: StudioLayer, index: number): React.CSSProperties => ({
    left: pct(layer.x, STAGE_W),
    top: pct(layer.y, STAGE_H),
    width: pct(layer.w, STAGE_W),
    height: pct(layer.h, STAGE_H),
    zIndex: layer.id === selectedId ? total + 1 : total - index,
  });

  return (
    <div className="st-scroll">
      <div
        ref={stageRef}
        className="st-stage"
        data-bg={prefs.bg}
        style={{ width, backgroundImage: prefs.bg === 'image' && prefs.bgImage ? `url("${prefs.bgImage}")` : undefined }}
        tabIndex={0}
        role="application"
        aria-label="Lienzo de 1920 por 1080. Con una capa elegida, las flechas la mueven un píxel; con Mayús, diez."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={onStepEnd}
      >
        <SceneView ref={sceneRef} scene={scene} mode="edit" data={data} />
        {prefs.grid && (
          <div className="st-grid" style={{ backgroundSize: `${pct(prefs.gridSize, STAGE_W)} ${pct(prefs.gridSize, STAGE_H)}` }} />
        )}
        {prefs.safe && <div className="st-safe" />}
        <div className="st-hits">
          {scene.layers.map((layer, index) =>
            layer.hidden ? null : (
              <div
                key={layer.id}
                className="st-hit"
                data-layer={layer.id}
                data-sel={layer.id === selectedId ? '' : undefined}
                data-lock={layer.locked ? '' : undefined}
                style={hitStyle(layer, index)}
              >
                {layer.id === selectedId &&
                  !layer.locked &&
                  HANDLES.map((handle) => <i key={handle} className="st-hd" data-h={handle} />)}
              </div>
            )
          )}
        </div>
        {guides.v.map((x) => (
          <i key={`v${x}`} className="st-gd" data-d="v" style={{ left: `min(${pct(x, STAGE_W)}, calc(100% - 1px))` }} />
        ))}
        {guides.h.map((y) => (
          <i key={`h${y}`} className="st-gd" data-d="h" style={{ top: `min(${pct(y, STAGE_H)}, calc(100% - 1px))` }} />
        ))}
      </div>
    </div>
  );
};
