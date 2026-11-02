/**
 * src/components/tally-ui/Card.tsx
 *
 * Tarjeta de Tally: panel onyx con borde fino y título opcional.
 */

import React from 'react';

interface CardProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  title?: React.ReactNode;
  /** Contenido a la derecha del título (una etiqueta, un enlace...). */
  aside?: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({ title, aside, className, children, ...rest }) => (
  <section className={`tui-card${className ? ` ${className}` : ''}`} {...rest}>
    {(title || aside) && (
      <h3 className="tui-card-h">
        <span>{title}</span>
        {aside}
      </h3>
    )}
    {children}
  </section>
);
