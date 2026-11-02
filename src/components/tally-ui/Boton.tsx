/**
 * src/components/tally-ui/Boton.tsx
 *
 * Botón de Tally. `principal` es rojo (la acción principal de la pantalla),
 * `secundario` es de contorno y `error` usa borde discontinuo con el texto
 * claro: los errores nunca van en rojo sólido.
 */

import React from 'react';

export type VarianteBoton = 'principal' | 'secundario' | 'error';

interface BotonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBoton;
  pequeno?: boolean;
}

export const Boton = React.forwardRef<HTMLButtonElement, BotonProps>(
  ({ variante = 'secundario', pequeno, className, type = 'button', ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      className={`tui-btn${className ? ` ${className}` : ''}`}
      data-variante={variante}
      data-sm={pequeno ? '' : undefined}
      {...rest}
    />
  )
);
Boton.displayName = 'Boton';
