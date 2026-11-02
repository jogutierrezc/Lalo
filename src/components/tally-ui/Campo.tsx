/**
 * src/components/tally-ui/Campo.tsx
 *
 * Campo de formulario: etiqueta, ayuda y error. El error se muestra con borde
 * discontinuo, icono y texto (nunca solo con color).
 */

import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface CampoProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
}

export const Campo: React.FC<CampoProps> = ({ label, htmlFor, hint, error, children }) => (
  <div className="tui-campo">
    <label className="tui-campo-l" htmlFor={htmlFor}>
      {label}
    </label>
    {children}
    {hint && !error && <p className="tui-campo-h">{hint}</p>}
    {error && (
      <p className="tui-campo-e" role="alert">
        <AlertTriangle aria-hidden="true" />
        {error}
      </p>
    )}
  </div>
);
