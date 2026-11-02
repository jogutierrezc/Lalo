/**
 * src/components/enpantalla/kit.tsx
 *
 * Piezas comunes de las ventanas de «En pantalla» y «Conexiones»: tarjeta de
 * módulo, campo con ayuda, interruptor con texto, deslizador, notas y el
 * escenario del monitor. Se apoyan en el kit tally-ui (Card, Switch, Rango,
 * Segmented, Boton) y en la hoja enpantalla-tally.css.
 */

import React, { useId } from 'react';
import { Check, Copy } from 'lucide-react';
import { Boton, Card, Rango, Switch } from '../tally-ui';
import '../../styles/enpantalla-tally.css';

/** Módulo de una pestaña o del panel fijo. `data-tour` marca el paso de la guía. */
export const Modulo: React.FC<
  Omit<React.HTMLAttributes<HTMLElement>, 'title'> & { title?: React.ReactNode; aside?: React.ReactNode }
> = ({ children, ...rest }) => <Card {...rest}>{children}</Card>;

/** Campo con etiqueta arriba y ayuda debajo. Con `htmlFor` la etiqueta enfoca el control. */
export const Ajuste: React.FC<{
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}> = ({ label, htmlFor, hint, children }) => (
  <div className="ept-ajuste">
    {htmlFor ? (
      <label className="ept-l" htmlFor={htmlFor}>
        {label}
      </label>
    ) : (
      <span className="ept-l">{label}</span>
    )}
    {children}
    {hint && <span className="ept-hint">{hint}</span>}
  </div>
);

/** Interruptor con su texto y, si lo hay, su ayuda. */
export const Opcion: React.FC<{
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  hint?: React.ReactNode;
  disabled?: boolean;
}> = ({ label, checked, onChange, hint, disabled }) => {
  const id = useId();
  return (
    <div className="ept-opc">
      <div className="ept-opc-t">
        <label htmlFor={id}>{label}</label>
        {hint && <span className="ept-hint">{hint}</span>}
      </div>
      <Switch label={label} checked={checked} onChange={onChange} disabled={disabled} id={id} />
    </div>
  );
};

/** Deslizador del kit con ayuda opcional. */
export const Deslizador: React.FC<{
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
  hint?: React.ReactNode;
}> = ({ hint, ...range }) => (
  <div className="ept-ajuste">
    <Rango {...range} />
    {hint && <span className="ept-hint">{hint}</span>}
  </div>
);

export const Pista: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({ className, ...rest }) => (
  <p className={`ept-hint${className ? ` ${className}` : ''}`} {...rest} />
);

export const Nota: React.FC<React.HTMLAttributes<HTMLParagraphElement> & { tono?: 'aviso' | 'error' }> = ({ tono, className, ...rest }) => (
  <p className={`ept-nota${className ? ` ${className}` : ''}`} data-tono={tono} {...rest} />
);

/** Escenario 16:9 del monitor. Conserva `cab-stage` porque las capas miden en cqw. */
export const Escenario = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { 'data-bg'?: string }>(
  ({ className, ...rest }, ref) => <div ref={ref} className={`cab-stage ept-stage${className ? ` ${className}` : ''}`} {...rest} />
);
Escenario.displayName = 'Escenario';

/** Botón de copiar con su estado «copiado». */
export const BotonCopiar: React.FC<{
  copiado: boolean;
  texto: string;
  textoCopiado: string;
  onClick: () => void;
  principal?: boolean;
  pequeno?: boolean;
}> = ({ copiado, texto, textoCopiado, onClick, principal, pequeno }) => (
  <Boton variante={principal ? 'principal' : 'secundario'} pequeno={pequeno} onClick={onClick}>
    {copiado ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
    <span>{copiado ? textoCopiado : texto}</span>
  </Boton>
);
