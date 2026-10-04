/**
 * src/components/studio/StudioKit.tsx
 *
 * Piezas comunes de la plantilla de estudio (lista, editor y monitor), para que
 * todos los módulos usen el mismo campo, el mismo interruptor y el mismo aviso
 * de deshacer.
 */

import React, { useEffect, useId, useState } from 'react';

/** Campo con etiqueta arriba y ayuda debajo. Con `htmlFor` la etiqueta enfoca el control. */
export const Field: React.FC<{
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}> = ({ label, htmlFor, hint, children }) => (
  <div className="cab-field">
    {htmlFor ? (
      <label className="cab-label" htmlFor={htmlFor}>
        {label}
      </label>
    ) : (
      <span className="cab-label">{label}</span>
    )}
    {children}
    {hint && <span className="cab-hint">{hint}</span>}
  </div>
);

/** Interruptor del sistema (.cab-tog) con su etiqueta. */
export const Toggle: React.FC<{
  label: React.ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}> = ({ label, checked, onChange, disabled }) => {
  const id = useId();
  return (
    <div className="flex items-center gap-3">
      <input
        id={id}
        type="checkbox"
        className="cab-tog"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label htmlFor={id}>{label}</label>
    </div>
  );
};

/** Deslizador con su valor a la derecha (.cab-range). */
export const Range: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}> = ({ label, value, min, max, step = 1, format, onChange }) => (
  <div className="cab-range">
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      onChange={(e) => onChange(Number(e.target.value))}
    />
    <output>{format(value)}</output>
  </div>
);

/**
 * Guarda lo que había antes de una acción destructiva y lo ofrece durante unos
 * segundos. `offer` lo llama quien borra; `UndoNote` pinta el aviso.
 */
export function useUndo<T>(seconds = 8) {
  const [pending, setPending] = useState<{ label: string; snapshot: T } | null>(null);

  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setPending(null), seconds * 1000);
    return () => clearTimeout(timer);
  }, [pending, seconds]);

  return {
    pending,
    offer: (label: string, snapshot: T) => setPending({ label, snapshot }),
    clear: () => setPending(null),
  };
}

export const UndoNote: React.FC<{ label: string; onUndo: () => void }> = ({ label, onUndo }) => (
  <p className="cab-note" role="status">
    {label}{' '}
    <button type="button" className="studio-link" onClick={onUndo}>
      Deshacer
    </button>
  </p>
);
