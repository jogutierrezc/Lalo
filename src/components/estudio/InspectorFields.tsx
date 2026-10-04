/**
 * src/components/estudio/InspectorFields.tsx
 *
 * Campos del inspector de Studio y los ajustes propios de cada tipo de capa:
 * texto, forma, marco de cámara, temporizador y la posición aleatoria de
 * alertas y saludo de raid.
 *
 * Cada campo avisa con una etiqueta de qué está cambiando: mientras se escribe
 * un número o se arrastra un color, todo cuenta como un solo paso de deshacer.
 */

import React, { useId, useState } from 'react';
import { Shuffle } from 'lucide-react';
import { Range, Toggle } from '../studio/StudioKit';
import { CHAT_FONTS, ChatFont } from '../../types/chat';
import {
  DEFAULT_CAM,
  DEFAULT_RANDOM,
  DEFAULT_SHAPE,
  DEFAULT_TEXT,
  DEFAULT_TIMER,
  MIN_SIZE,
  STUDIO_LIMITS,
  StudioLayer,
  TextAlign,
  TextLegibility,
  TimerAtZero,
  TimerFormat,
  TimerMode,
  hasRandom,
} from '../../types/studio';

export type LayerChange = (patch: Partial<StudioLayer>, tag?: string) => void;

const L = STUDIO_LIMITS;

export const NumField: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  onDone: () => void;
}> = ({ label, value, min, max, step = 1, disabled, onChange, onDone }) => {
  const id = useId();
  // Mientras se escribe manda el texto; el modelo recibe el número ya dentro de sus límites
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="st-fld">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="cab-inp st-inp"
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={draft ?? String(value)}
        onFocus={() => setDraft(String(value))}
        onChange={(event) => {
          setDraft(event.target.value);
          const n = parseFloat(event.target.value);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
        onBlur={() => {
          setDraft(null);
          onDone();
        }}
      />
    </div>
  );
};

export const ColorField: React.FC<{ label: string; value: string; onChange: (value: string) => void; onDone: () => void }> = ({
  label,
  value,
  onChange,
  onDone,
}) => {
  const id = useId();
  return (
    <div className="st-fld">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="cab-inp st-color" type="color" value={value} onChange={(e) => onChange(e.target.value)} onBlur={onDone} />
    </div>
  );
};

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { id: T; name: string }[];
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="st-fld">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="cab-inp st-inp" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </div>
  );
}

const WEIGHTS = [
  { id: '400', name: 'Normal' },
  { id: '600', name: 'Media' },
  { id: '700', name: 'Negrita' },
  { id: '800', name: 'Extra negrita' },
] as const;
const ALIGNS: { id: TextAlign; name: string }[] = [
  { id: 'l', name: 'Izquierda' },
  { id: 'c', name: 'Centro' },
  { id: 'r', name: 'Derecha' },
];
const LEGIBILITY: { id: TextLegibility; name: string }[] = [
  { id: 'none', name: 'Nada' },
  { id: 'shadow', name: 'Sombra' },
  { id: 'outline', name: 'Contorno' },
];
const TIMER_MODES: { id: TimerMode; name: string }[] = [
  { id: 'down', name: 'Cuenta atrás' },
  { id: 'up', name: 'Cuenta hacia arriba' },
];
const TIMER_FORMATS: { id: TimerFormat; name: string }[] = [
  { id: 'mmss', name: 'Minutos y segundos (05:00)' },
  { id: 'hmmss', name: 'Con horas (0:05:00)' },
];
const TIMER_ZERO: { id: TimerAtZero; name: string }[] = [
  { id: 'zero', name: 'Se queda en cero' },
  { id: 'text', name: 'Muestra un texto' },
  { id: 'hide', name: 'Desaparece' },
];

interface TypeFieldsProps {
  layer: StudioLayer;
  onChange: LayerChange;
  onDone: () => void;
  onTest: () => void;
}

/** Ajustes propios del tipo de capa elegido. */
export const TypeFields: React.FC<TypeFieldsProps> = ({ layer, onChange, onDone, onTest }) => {
  const uid = useId();

  if (layer.type === 'text') {
    const t = layer.text || DEFAULT_TEXT;
    const set = (patch: Partial<typeof t>, tag?: string) => onChange({ text: { ...t, ...patch } }, tag);
    return (
      <div className="st-grp">
        <span className="cab-label">Texto</span>
        <div className="st-fld">
          <label htmlFor={`${uid}-tx`}>Contenido</label>
          <textarea
            id={`${uid}-tx`}
            className="cab-inp st-inp"
            rows={2}
            maxLength={L.textLength}
            value={t.content}
            onChange={(e) => set({ content: e.target.value }, 'texto')}
            onBlur={onDone}
          />
        </div>
        <div className="st-g2">
          <SelectField<ChatFont> label="Tipografía" value={t.font} options={CHAT_FONTS} onChange={(font) => set({ font })} />
          <SelectField
            label="Grosor"
            value={String(t.weight) as (typeof WEIGHTS)[number]['id']}
            options={WEIGHTS}
            onChange={(weight) => set({ weight: Number(weight) })}
          />
          <NumField label="Tamaño" value={t.size} min={L.textSize.min} max={L.textSize.max} onChange={(size) => set({ size }, 'texto-size')} onDone={onDone} />
          <ColorField label="Color" value={t.color} onChange={(color) => set({ color }, 'texto-color')} onDone={onDone} />
          <SelectField label="Alineación" value={t.align} options={ALIGNS} onChange={(align) => set({ align })} />
          <SelectField label="Para que se lea" value={t.legibility} options={LEGIBILITY} onChange={(legibility) => set({ legibility })} />
        </div>
        <Toggle label="Todo en mayúsculas" checked={t.upper} onChange={(upper) => set({ upper })} />
      </div>
    );
  }

  if (layer.type === 'shape') {
    const s = layer.shape || DEFAULT_SHAPE;
    const set = (patch: Partial<typeof s>, tag?: string) => onChange({ shape: { ...s, ...patch } }, tag);
    return (
      <div className="st-grp">
        <span className="cab-label">Forma</span>
        <Toggle label="Con relleno" checked={s.filled} onChange={(filled) => set({ filled })} />
        <div className="st-g2">
          <ColorField label="Relleno" value={s.fill} onChange={(fill) => set({ fill }, 'forma-fill')} onDone={onDone} />
          <ColorField label="Borde" value={s.border} onChange={(border) => set({ border }, 'forma-border')} onDone={onDone} />
          <NumField label="Grosor del borde" value={s.borderWidth} min={L.borderWidth.min} max={L.borderWidth.max} onChange={(borderWidth) => set({ borderWidth }, 'forma-bw')} onDone={onDone} />
          <NumField label="Redondeo" value={s.radius} min={L.radius.min} max={L.radius.max} onChange={(radius) => set({ radius }, 'forma-r')} onDone={onDone} />
        </div>
      </div>
    );
  }

  if (layer.type === 'cam') {
    const c = layer.cam || DEFAULT_CAM;
    const set = (patch: Partial<typeof c>, tag?: string) => onChange({ cam: { ...c, ...patch } }, tag);
    return (
      <div className="st-grp">
        <span className="cab-label">Marco</span>
        <div className="st-g2">
          <ColorField label="Color" value={c.color} onChange={(color) => set({ color }, 'cam-color')} onDone={onDone} />
          <NumField label="Grosor" value={c.thickness} min={L.thickness.min} max={L.thickness.max} onChange={(thickness) => set({ thickness }, 'cam-th')} onDone={onDone} />
          <NumField label="Redondeo" value={c.radius} min={L.radius.min} max={L.radius.max} onChange={(radius) => set({ radius }, 'cam-r')} onDone={onDone} />
        </div>
        <Toggle label="Con etiqueta" checked={c.label} onChange={(label) => set({ label })} />
        {c.label && (
          <div className="st-fld">
            <label htmlFor={`${uid}-cl`}>Texto de la etiqueta</label>
            <input
              id={`${uid}-cl`}
              className="cab-inp st-inp"
              maxLength={L.name}
              value={c.labelText}
              onChange={(e) => set({ labelText: e.target.value }, 'cam-label')}
              onBlur={onDone}
            />
          </div>
        )}
        <p className="cab-hint">El marco solo dibuja el borde: la cámara es otra fuente de OBS, colocada debajo.</p>
      </div>
    );
  }

  if (layer.type === 'timer') {
    const t = layer.timer || DEFAULT_TIMER;
    const set = (patch: Partial<typeof t>, tag?: string) => onChange({ timer: { ...t, ...patch } }, tag);
    return (
      <div className="st-grp">
        <span className="cab-label">Temporizador</span>
        <SelectField label="Qué cuenta" value={t.mode} options={TIMER_MODES} onChange={(mode) => set({ mode })} />
        <div className="st-g2">
          {t.mode === 'down' && (
            <NumField label="Minutos" value={t.minutes} min={L.minutes.min} max={L.minutes.max} onChange={(minutes) => set({ minutes }, 'timer-min')} onDone={onDone} />
          )}
          <ColorField label="Color" value={t.color} onChange={(color) => set({ color }, 'timer-color')} onDone={onDone} />
        </div>
        <SelectField label="Formato" value={t.format} options={TIMER_FORMATS} onChange={(format) => set({ format })} />
        {t.mode === 'down' && <SelectField label="Al llegar a cero" value={t.atZero} options={TIMER_ZERO} onChange={(atZero) => set({ atZero })} />}
        {t.mode === 'down' && t.atZero === 'text' && (
          <div className="st-fld">
            <label htmlFor={`${uid}-te`}>Texto final</label>
            <input
              id={`${uid}-te`}
              className="cab-inp st-inp"
              maxLength={40}
              value={t.endText}
              onChange={(e) => set({ endText: e.target.value }, 'timer-end')}
              onBlur={onDone}
            />
          </div>
        )}
        <Toggle label="Con placa de fondo" checked={t.plate} onChange={(plate) => set({ plate })} />
        <p className="cab-hint">El reloj arranca cuando OBS carga la escena. Aquí se ve parado en su valor inicial.</p>
      </div>
    );
  }

  if (hasRandom(layer.type)) {
    const r = layer.random || DEFAULT_RANDOM[layer.type];
    const set = (patch: Partial<typeof r>, tag?: string) => onChange({ random: { ...r, ...patch } }, tag);
    return (
      <div className="st-grp">
        <span className="cab-label">Posición aleatoria</span>
        <Toggle label="Cada aviso sale en un sitio distinto" checked={r.enabled} onChange={(enabled) => set({ enabled })} />
        {r.enabled ? (
          <>
            <p className="cab-hint">
              La caja de la capa es ahora la zona. Cada aviso aparece entero dentro de ella, con este tamaño, y nunca dos veces
              seguidas en el mismo sitio.
            </p>
            <div className="st-g2">
              <NumField label="Ancho del aviso" value={Math.min(r.w, layer.w)} min={MIN_SIZE} max={layer.w} onChange={(w) => set({ w }, 'zona-w')} onDone={onDone} />
              <NumField label="Alto del aviso" value={Math.min(r.h, layer.h)} min={MIN_SIZE} max={layer.h} onChange={(h) => set({ h }, 'zona-h')} onDone={onDone} />
            </div>
            <button type="button" className="cab-btn2 st-btn" onClick={onTest}>
              <Shuffle />
              Probar
            </button>
          </>
        ) : (
          <p className="cab-hint">Apagado, el aviso sale siempre en la caja de la capa.</p>
        )}
      </div>
    );
  }

  return null;
};

/** Deslizador con etiqueta visible, para el inspector. */
export const RangeField: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
  onDone: () => void;
}> = ({ label, onDone, ...range }) => (
  <div className="st-fld" onPointerUp={onDone} onKeyUp={onDone} onBlur={onDone}>
    <span>{label}</span>
    <Range label={label} {...range} />
  </div>
);
