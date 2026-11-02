/**
 * src/components/premios/VentanaPestanas.tsx
 *
 * Armazón común de las herramientas de «Alertas y premios» (Alertas,
 * Recompensas, Power-ups y Mascotas) cuando se muestran como ventana con
 * pestañas:
 *
 *   barra fija (SuiteNav: Guía, Actualizar OBS, Copiar URL, guardado)
 *   pestañas accesibles (kit tally-ui)
 *   [ riel opcional | contenido de la pestaña | panel fijo (monitor y «Probar») ]
 *
 * El panel fijo y el riel se ven en todas las pestañas. El contenido cambia
 * con un fundido corto (expo.out, 200 ms) que se omite con «reducir
 * movimiento». Los estilos Tally están en src/styles/premios-tally.css.
 */

import React, { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { Tabs, type TabItem } from '../tally-ui';
import { reduced } from '../../utils/alertMotion';
import '../../styles/premios-tally.css';

gsap.registerPlugin(useGSAP);

export interface VentanaPestanasProps {
  /** Nombre accesible del grupo de pestañas, p. ej. «Secciones de Alertas». */
  label: string;
  /** Prefijo de ids; debe coincidir con el que se pase a `TabPanel`. */
  idBase: string;
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** Barra fija encima de las pestañas (normalmente `<SuiteNav />`). */
  nav: React.ReactNode;
  /** Columna izquierda persistente (p. ej. la lista de eventos). */
  rail?: React.ReactNode;
  /** Panel fijo a la derecha: monitor, «Probar» y copiar URL. */
  dock: React.ReactNode;
  /** Estilo en línea del contenedor (variables como `--acc`). */
  style?: React.CSSProperties;
  /** Elementos que viven fuera del armazón (modales, guía). */
  after?: React.ReactNode;
  children: React.ReactNode;
}

export const VentanaPestanas: React.FC<VentanaPestanasProps> = ({
  label,
  idBase,
  tabs,
  value,
  onChange,
  nav,
  rail,
  dock,
  style,
  after,
  children,
}) => {
  const mainRef = useRef<HTMLDivElement | null>(null);
  const first = useRef(true);

  // Fundido corto al cambiar de pestaña (no en el primer montaje)
  useGSAP(
    () => {
      const el = mainRef.current;
      if (!el) return;
      if (first.current) {
        first.current = false;
        return;
      }
      if (reduced()) return;
      gsap.fromTo(
        el,
        { opacity: 0, y: 6 },
        { opacity: 1, y: 0, duration: 0.2, ease: 'expo.out', clearProps: 'opacity,transform' }
      );
    },
    { scope: mainRef, dependencies: [value] }
  );

  return (
    <div className="ptl cab" style={style}>
      <div className="ptl-head">
        <div className="ptl-nav">{nav}</div>
        <Tabs label={label} tabs={tabs} value={value} onChange={onChange} idBase={idBase} />
      </div>
      <div className="ptl-body" data-rail={rail ? '' : undefined}>
        {rail && <aside className="ptl-rail">{rail}</aside>}
        <div className="ptl-main" ref={mainRef}>
          {children}
        </div>
        <aside className="ptl-dock" aria-label="Vista previa y pruebas">
          {dock}
        </aside>
      </div>
      {after}
    </div>
  );
};
