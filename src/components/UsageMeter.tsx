/**
 * src/components/UsageMeter.tsx
 *
 * Barra de uso frente a un límite. Cambia de tono al pasar del 85% y al llegar
 * al tope; el estado también va en texto para lectores de pantalla.
 */

import React from 'react';

export const UsageMeter: React.FC<{ used: number; limit: number; label: string }> = ({ used, limit, label }) => {
  const ratio = limit > 0 ? Math.min(1, used / limit) : 0;
  const level = limit > 0 && used >= limit ? 'full' : ratio >= 0.85 ? 'high' : undefined;
  return (
    <div
      className="cab-meter"
      data-level={level}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
    >
      <i style={{ transform: `scaleX(${ratio})` }} />
    </div>
  );
};
