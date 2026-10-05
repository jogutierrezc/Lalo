/**
 * src/components/estudio/SidePanel.tsx
 *
 * Columna izquierda del editor: la escena abierta (nombre, orden, duplicar,
 * borrar), la paleta «Añadir» y la lista de capas. La lista y el lienzo
 * enseñan siempre la misma selección; la primera capa es la que queda delante.
 */

import React, { useId } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Lock, LockOpen } from 'lucide-react';
import { LAYER_TYPES, LayerType, MAX_LAYERS, STUDIO_LIMITS, StudioLayer, StudioScene } from '../../types/studio';
import type { ZMove } from '../../utils/studioScenes';

/** Tipos que aún no se pueden añadir, con el motivo en pocas palabras. */
export const SOON: Partial<Record<LayerType, string>> = {
  // Cada capa sale de esta lista cuando su caja de Studio está hecha (components/estudio/boxes/)
};

interface SidePanelProps {
  scene: StudioScene;
  sceneIndex: number;
  sceneCount: number;
  selectedId: string | null;
  clipboard: StudioLayer | null;
  onRenameScene: (name: string) => void;
  onRenameDone: () => void;
  onMoveScene: (step: -1 | 1) => void;
  onDuplicateScene: () => void;
  onRemoveScene: () => void;
  onAdd: (type: LayerType) => void;
  onPaste: () => void;
  onSelect: (id: string) => void;
  onOrder: (id: string, move: ZMove) => void;
  onToggle: (id: string, key: 'hidden' | 'locked') => void;
}

export const SidePanel: React.FC<SidePanelProps> = ({
  scene,
  sceneIndex,
  sceneCount,
  selectedId,
  clipboard,
  onRenameScene,
  onRenameDone,
  onMoveScene,
  onDuplicateScene,
  onRemoveScene,
  onAdd,
  onPaste,
  onSelect,
  onOrder,
  onToggle,
}) => {
  const uid = useId();
  const full = scene.layers.length >= MAX_LAYERS;
  const last = scene.layers.length - 1;

  return (
    <>
      <div className="st-grp">
        <label className="cab-label" htmlFor={`${uid}-scene`}>
          Escena
        </label>
        <input
          id={`${uid}-scene`}
          className="cab-inp st-inp"
          maxLength={STUDIO_LIMITS.name}
          value={scene.name}
          onChange={(e) => onRenameScene(e.target.value)}
          onBlur={onRenameDone}
        />
        <div className="st-row">
          <button type="button" className="cab-btn2 st-btn" disabled={sceneIndex === 0} onClick={() => onMoveScene(-1)} aria-label="Mover la escena antes">
            Antes
          </button>
          <button
            type="button"
            className="cab-btn2 st-btn"
            disabled={sceneIndex === sceneCount - 1}
            onClick={() => onMoveScene(1)}
            aria-label="Mover la escena después"
          >
            Después
          </button>
          <button type="button" className="cab-btn2 st-btn" onClick={onDuplicateScene}>
            Duplicar
          </button>
          <button type="button" className="cab-btn2 st-btn st-danger" disabled={sceneCount <= 1} onClick={onRemoveScene}>
            Borrar
          </button>
        </div>
      </div>

      <div className="st-grp">
        <span className="cab-label">Añadir</span>
        <div className="st-pal">
          {LAYER_TYPES.map((type) => {
            const soon = SOON[type.id];
            return (
              <button key={type.id} type="button" disabled={full || !!soon} onClick={() => onAdd(type.id)}>
                + {type.name}
                {soon && <small>{soon}</small>}
              </button>
            );
          })}
        </div>
        {clipboard && (
          <button type="button" className="cab-btn2 st-btn" disabled={full} onClick={onPaste}>
            Pegar «{clipboard.name}»
          </button>
        )}
        {full && <p className="cab-hint">Esta escena ya tiene el máximo de {MAX_LAYERS} capas.</p>}
      </div>

      <div className="st-grp">
        <span className="cab-label">Capas (arriba = delante)</span>
        <ul className="st-layers">
          {scene.layers.map((layer, index) => (
            <li key={layer.id} className="st-ly" data-sel={layer.id === selectedId ? '' : undefined} data-hid={layer.hidden ? '' : undefined}>
              <button type="button" className="st-nm" aria-pressed={layer.id === selectedId} onClick={() => onSelect(layer.id)}>
                {layer.name}
              </button>
              <button
                type="button"
                className="st-ic"
                aria-label={`Traer ${layer.name} adelante`}
                title="Adelante"
                disabled={index === 0}
                onClick={() => onOrder(layer.id, 'forward')}
              >
                <ArrowUp />
              </button>
              <button
                type="button"
                className="st-ic"
                aria-label={`Enviar ${layer.name} atrás`}
                title="Atrás"
                disabled={index === last}
                onClick={() => onOrder(layer.id, 'backward')}
              >
                <ArrowDown />
              </button>
              <button
                type="button"
                className="st-ic"
                aria-pressed={!layer.hidden}
                aria-label={`${layer.hidden ? 'Mostrar' : 'Ocultar'} ${layer.name}`}
                title={layer.hidden ? 'Mostrar' : 'Ocultar'}
                onClick={() => onToggle(layer.id, 'hidden')}
              >
                {layer.hidden ? <EyeOff /> : <Eye />}
              </button>
              <button
                type="button"
                className="st-ic"
                aria-pressed={layer.locked}
                aria-label={`${layer.locked ? 'Desbloquear' : 'Bloquear'} ${layer.name}`}
                title={layer.locked ? 'Desbloquear' : 'Bloquear'}
                onClick={() => onToggle(layer.id, 'locked')}
              >
                {layer.locked ? <Lock /> : <LockOpen />}
              </button>
            </li>
          ))}
          {scene.layers.length === 0 && <li className="cab-hint">Sin capas. Añade una arriba.</li>}
        </ul>
      </div>
    </>
  );
};
