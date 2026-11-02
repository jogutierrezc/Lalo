/**
 * src/components/tally-ui/Pill.tsx
 *
 * Etiqueta de estado. El rojo (`live`) es solo para «en vivo». El estado malo
 * (`bad`) se dibuja con borde discontinuo y punto hueco, además del color.
 */

import React from 'react';

export type TonoPill = 'neutral' | 'live' | 'ok' | 'warn' | 'bad' | 'gift';

interface PillProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: TonoPill;
  /** Muestra el punto de estado. */
  dot?: boolean;
}

export const Pill: React.FC<PillProps> = ({ tone = 'neutral', dot, className, children, ...rest }) => (
  <span className={`tui-pill${className ? ` ${className}` : ''}`} data-tone={tone} {...rest}>
    {dot && <i aria-hidden="true" />}
    {children}
  </span>
);
