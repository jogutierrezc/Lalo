/**
 * src/components/tally-ui/Rango.tsx
 *
 * Control deslizante con etiqueta y valor visible.
 */

import React, { useId } from 'react';

interface RangoProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}

export const Rango: React.FC<RangoProps> = ({ label, value, min = 0, max = 100, step = 1, onChange, format }) => {
  const id = useId();
  return (
    <div className="tui-rango">
      <label htmlFor={id}>
        <span>{label}</span>
        <output htmlFor={id}>{format ? format(value) : value}</output>
      </label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
};
