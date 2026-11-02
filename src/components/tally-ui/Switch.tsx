/**
 * src/components/tally-ui/Switch.tsx
 *
 * Interruptor accesible (role="switch"). Se activa con clic, Espacio o Intro.
 */

import React from 'react';

interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  id?: string;
}

export const Switch: React.FC<SwitchProps> = ({ checked, onChange, label, disabled, id }) => (
  <button
    id={id}
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    className="tui-switch"
    onClick={() => onChange(!checked)}
  />
);
