/**
 * src/components/estudio/Inspector.tsx
 *
 * Columna derecha del editor: los ajustes de la capa elegida. Nombre, posición
 * y tamaño, alineación con el lienzo, orden, opacidad, lo propio de su tipo,
 * movimiento de entrada y salida, y las acciones (duplicar, copiar, borrar).
 */

import React, { useId } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  Lock,
  LockOpen,
} from 'lucide-react';
import { ANIMS, AnimId, MIN_SIZE, STAGE_H, STAGE_W, STUDIO_LIMITS, StudioLayer, isLaloLayer, typeInfo } from '../../types/studio';
import type { AlignTo } from '../../utils/studioGeometry';
import type { ZMove } from '../../utils/studioScenes';
import { LayerChange, NumField, RangeField, SelectField, TypeFields } from './InspectorFields';

interface InspectorProps {
  layer: StudioLayer | null;
  index: number;
  total: number;
  onChange: LayerChange;
  onDone: () => void;
  onAlign: (to: AlignTo) => void;
  onOrder: (move: ZMove) => void;
  onPlay: (kind: 'enter' | 'exit') => void;
  onTest: () => void;
  onDuplicate: () => void;
  onCopy: () => void;
  onRemove: () => void;
}

const ALIGN_BUTTONS: { to: AlignTo; label: string; icon: React.ComponentType }[] = [
  { to: 'left', label: 'Pegar a la izquierda', icon: AlignStartVertical },
  { to: 'hcenter', label: 'Centrar en horizontal', icon: AlignCenterVertical },
  { to: 'right', label: 'Pegar a la derecha', icon: AlignEndVertical },
  { to: 'top', label: 'Pegar arriba', icon: AlignStartHorizontal },
  { to: 'vmiddle', label: 'Centrar en vertical', icon: AlignCenterHorizontal },
  { to: 'bottom', label: 'Pegar abajo', icon: AlignEndHorizontal },
];

const L = STUDIO_LIMITS;

export const Inspector: React.FC<InspectorProps> = ({
  layer,
  index,
  total,
  onChange,
  onDone,
  onAlign,
  onOrder,
  onPlay,
  onTest,
  onDuplicate,
  onCopy,
  onRemove,
}) => {
  const uid = useId();
  if (!layer) {
    return <div className="st-empty">Elige una capa en el lienzo o en la lista para ver sus ajustes.</div>;
  }
  const info = typeInfo(layer.type);
  const locked = layer.locked;

  // Con el candado de proporción, cambiar una medida arrastra la otra
  const setSize = (key: 'w' | 'h', value: number) => {
    if (!layer.keepRatio || layer.w <= 0 || layer.h <= 0) {
      onChange({ [key]: value }, `num-${key}`);
      return;
    }
    const ratio = layer.w / layer.h;
    const w = key === 'w' ? value : Math.round(value * ratio);
    const h = key === 'h' ? value : Math.round(value / ratio);
    onChange({ w: Math.max(MIN_SIZE, w), h: Math.max(MIN_SIZE, h) }, `num-${key}`);
  };

  return (
    <>
      <div className="st-fld">
        <label className="cab-label" htmlFor={`${uid}-name`}>
          Nombre
        </label>
        <input
          id={`${uid}-name`}
          className="cab-inp st-inp"
          maxLength={L.name}
          value={layer.name}
          onChange={(e) => onChange({ name: e.target.value }, 'nombre')}
          onBlur={() => {
            if (!layer.name.trim()) onChange({ name: info.name }, 'nombre');
            onDone();
          }}
        />
      </div>

      <div className="st-grp">
        <span className="cab-label">Posición y tamaño</span>
        <div className="st-g2">
          <NumField label="X" value={layer.x} min={-STAGE_W} max={STAGE_W} disabled={locked} onChange={(x) => onChange({ x }, 'num-x')} onDone={onDone} />
          <NumField label="Y" value={layer.y} min={-STAGE_H} max={STAGE_H} disabled={locked} onChange={(y) => onChange({ y }, 'num-y')} onDone={onDone} />
          <NumField label="Ancho" value={layer.w} min={MIN_SIZE} max={STAGE_W * 2} disabled={locked} onChange={(w) => setSize('w', w)} onDone={onDone} />
          <NumField label="Alto" value={layer.h} min={MIN_SIZE} max={STAGE_H * 2} disabled={locked} onChange={(h) => setSize('h', h)} onDone={onDone} />
        </div>
        <button
          type="button"
          className="cab-btn2 st-btn"
          aria-pressed={layer.keepRatio}
          onClick={() => onChange({ keepRatio: !layer.keepRatio })}
          title="También puedes mantener pulsada Mayús al estirar"
        >
          {layer.keepRatio ? <Lock /> : <LockOpen />}
          Mantener proporción
        </button>
        <div className="st-row" role="group" aria-label="Alinear con el lienzo">
          {ALIGN_BUTTONS.map(({ to, label, icon: Icon }) => (
            <button key={to} type="button" className="cab-icon" aria-label={label} title={label} disabled={locked} onClick={() => onAlign(to)}>
              <Icon />
            </button>
          ))}
        </div>
      </div>

      <div className="st-grp">
        <span className="cab-label">Orden</span>
        <div className="st-row">
          <button type="button" className="cab-btn2 st-btn" disabled={index === 0} onClick={() => onOrder('front')}>
            Al frente
          </button>
          <button type="button" className="cab-btn2 st-btn" disabled={index === 0} onClick={() => onOrder('forward')}>
            Adelante
          </button>
          <button type="button" className="cab-btn2 st-btn" disabled={index === total - 1} onClick={() => onOrder('backward')}>
            Atrás
          </button>
          <button type="button" className="cab-btn2 st-btn" disabled={index === total - 1} onClick={() => onOrder('back')}>
            Al fondo
          </button>
        </div>
      </div>

      <RangeField
        label="Opacidad"
        value={layer.opacity}
        min={L.opacity.min}
        max={L.opacity.max}
        format={(value) => `${value}%`}
        onChange={(opacity) => onChange({ opacity }, 'opacidad')}
        onDone={onDone}
      />

      <TypeFields layer={layer} onChange={onChange} onDone={onDone} onTest={onTest} />

      {isLaloLayer(layer.type) && info.page && (
        <p className="cab-hint">
          Los ajustes propios de esta capa (textos, diseño, sonidos) siguen en su página. Aquí solo se coloca.{' '}
          <a className="studio-link" href={info.page.href}>
            Abrir {info.page.label}
          </a>
        </p>
      )}

      <div className="st-grp">
        <span className="cab-label">Movimiento</span>
        <div className="st-g2">
          <SelectField<AnimId> label="Entrada" value={layer.enter} options={ANIMS} onChange={(enter) => onChange({ enter })} />
          <SelectField<AnimId> label="Salida" value={layer.exit} options={ANIMS} onChange={(exit) => onChange({ exit })} />
        </div>
        <RangeField
          label="Retraso"
          value={layer.delay}
          min={L.delay.min}
          max={L.delay.max}
          step={0.05}
          format={(value) => `${value.toFixed(2)} s`}
          onChange={(delay) => onChange({ delay }, 'retraso')}
          onDone={onDone}
        />
        <RangeField
          label="Duración"
          value={layer.duration}
          min={L.duration.min}
          max={L.duration.max}
          step={0.05}
          format={(value) => `${value.toFixed(2)} s`}
          onChange={(duration) => onChange({ duration }, 'duracion')}
          onDone={onDone}
        />
        <div className="st-row">
          <button type="button" className="cab-btn2 st-btn" onClick={() => onPlay('enter')}>
            Ver entrada
          </button>
          <button type="button" className="cab-btn2 st-btn" onClick={() => onPlay('exit')}>
            Ver salida
          </button>
        </div>
        <p className="cab-hint">La entrada se ve al cargar la escena en OBS; la salida, al ocultar la capa.</p>
      </div>

      <div className="st-row">
        <button type="button" className="cab-btn2 st-btn" onClick={onDuplicate}>
          Duplicar
        </button>
        <button type="button" className="cab-btn2 st-btn" onClick={onCopy}>
          Copiar
        </button>
        <button type="button" className="cab-btn2 st-btn st-danger" onClick={onRemove}>
          Borrar
        </button>
      </div>
    </>
  );
};
