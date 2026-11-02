/**
 * src/components/voz-ia/VentanaPestanas.tsx
 *
 * Estructura común de las ventanas de «Voz e IA» (Voz del chat, Mi AI y Bot):
 *   1. barra fija de la herramienta arriba (SuiteNav: guía, Actualizar OBS,
 *      Copiar URL y estado de guardado);
 *   2. pestañas accesibles del kit de Tally (flechas, Inicio y Fin);
 *   3. cuerpo con el formulario de la pestaña a la izquierda y, a la derecha,
 *      un panel fijo (monitor o «Probar») visible en todas las pestañas;
 *   4. pie opcional pegado abajo (el «Guardar ajustes» manual de Mi AI).
 *
 * En ventanas estrechas el panel fijo pasa debajo del formulario. El cambio de
 * pestaña entra con un fundido corto (GSAP, expo.out, 200 ms) que respeta
 * «reducir movimiento».
 */

import React, { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { TabPanel, Tabs, type TabItem } from '../tally-ui';
import { reduced } from '../../utils/alertMotion';
import '../../styles/voz-ia-tally.css';

gsap.registerPlugin(useGSAP);

interface VentanaPestanasProps {
  /** Barra fija de la herramienta (normalmente `<SuiteNav …/>`). */
  bar: React.ReactNode;
  /** Nombre accesible de la lista de pestañas. */
  label: string;
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** Prefijo de los ids de pestañas y paneles. */
  idBase: string;
  /** Panel fijo de la derecha (monitor o «Probar»); visible en todas las pestañas que lo reciben. */
  aside?: React.ReactNode;
  /** Pie pegado abajo de la columna del formulario. */
  footer?: React.ReactNode;
  /** Estilos de la raíz (por ejemplo, el color de la alerta de Voz del chat). */
  style?: React.CSSProperties;
  children: React.ReactNode;
}

export const VentanaPestanas: React.FC<VentanaPestanasProps> = ({ bar, label, tabs, value, onChange, idBase, aside, footer, style, children }) => {
  const mainRef = useRef<HTMLDivElement | null>(null);
  const first = useRef(true);

  // Fundido al cambiar de pestaña; la primera vez no se anima
  useGSAP(
    () => {
      if (first.current) {
        first.current = false;
        return;
      }
      const el = mainRef.current?.querySelector<HTMLElement>('.tui-tabpanel');
      if (!el || reduced()) return;
      gsap.fromTo(el, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.2, ease: 'expo.out', clearProps: 'transform,opacity' });
    },
    { dependencies: [value], scope: mainRef }
  );

  return (
    <div className="cab vt-root" style={style}>
      <div className="vt-bar">{bar}</div>
      <Tabs label={label} tabs={tabs} value={value} onChange={onChange} idBase={idBase} />
      <div className="vt-body" data-aside={aside ? '' : undefined}>
        <div className="vt-main" ref={mainRef}>
          <TabPanel idBase={idBase} id={value} value={value}>
            <div className="vt-panel">{children}</div>
          </TabPanel>
          {footer && <div className="vt-foot">{footer}</div>}
        </div>
        {aside && <aside className="vt-aside">{aside}</aside>}
      </div>
    </div>
  );
};
