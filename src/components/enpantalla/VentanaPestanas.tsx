/**
 * src/components/enpantalla/VentanaPestanas.tsx
 *
 * Interior de una ventana con pestañas: la barra de la herramienta (SuiteNav)
 * queda fija arriba, después las pestañas, y debajo el formulario de la
 * pestaña activa a la izquierda y un panel fijo (monitor y pruebas) a la
 * derecha, visible en todas las pestañas.
 *
 * Todas las pestañas permanecen montadas y las inactivas van con `hidden`:
 * así ningún ajuste ni estado se pierde al cambiar, y la guía puede mostrar
 * una pestaña antes de medir el módulo que marca (ver `pasosConPestana`).
 */

import React, { useLayoutEffect } from 'react';
import { Tabs, type TabItem } from '../tally-ui';
import type { TourStep } from '../GuidedTour';
import '../../styles/enpantalla-tally.css';

interface VentanaPestanasProps {
  /** Prefijo único de la herramienta; enlaza pestañas y paneles. */
  idBase: string;
  etiqueta: string;
  /** Barra fija de la herramienta (SuiteNav). */
  barra: React.ReactNode;
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** Contenido de cada pestaña, por id. */
  paneles: Record<string, React.ReactNode>;
  /** Panel fijo de la derecha; sin él, la pestaña ocupa todo el ancho. */
  fijo?: React.ReactNode;
  fijoEtiqueta?: string;
  /** Clase extra para el cuerpo (p. ej. Studio). */
  className?: string;
  /** Con la guía abierta se deja sitio abajo para su consola. */
  guiaAbierta?: boolean;
  /** Guía u otros elementos que van fuera del cuerpo. */
  children?: React.ReactNode;
}

export const VentanaPestanas: React.FC<VentanaPestanasProps> = ({
  idBase,
  etiqueta,
  barra,
  tabs,
  value,
  onChange,
  paneles,
  fijo,
  fijoEtiqueta = 'Monitor y pruebas',
  className,
  guiaAbierta,
  children,
}) => (
  <div className={`ept${className ? ` ${className}` : ''}`} data-guia={guiaAbierta ? '' : undefined}>
    <div className="ept-top">{barra}</div>
    <Tabs label={etiqueta} tabs={tabs} value={value} onChange={onChange} idBase={idBase} />
    <div className="ept-body" data-solo={fijo ? undefined : ''}>
      <div className="ept-main">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tabpanel"
            id={`${idBase}-panel-${tab.id}`}
            aria-labelledby={`${idBase}-tab-${tab.id}`}
            className="ept-panel"
            hidden={tab.id !== value}
            data-ept-grupo={idBase}
            data-ept-tab={tab.id}
          >
            {paneles[tab.id]}
          </div>
        ))}
      </div>
      {fijo && (
        <aside className="ept-fixed" aria-label={fijoEtiqueta}>
          {fijo}
        </aside>
      )}
    </div>
    {children}
  </div>
);

/**
 * Dentro del cuerpo de un paso de la guía: muestra la pestaña indicada antes de
 * que la guía mida el módulo. Los efectos de los hijos corren antes que los del
 * padre (la guía), así que se enseña el panel en el DOM al instante y después
 * se avisa al estado para que React quede de acuerdo.
 */
export const CambiaPestana: React.FC<{ grupo: string; tab: string; onTab: (tab: string) => void }> = ({ grupo, tab, onTab }) => {
  useLayoutEffect(() => {
    document.querySelectorAll<HTMLElement>(`[data-ept-grupo="${grupo}"]`).forEach((panel) => {
      panel.hidden = panel.dataset.eptTab !== tab;
    });
    onTab(tab);
    // Solo cuando el paso se monta
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grupo, tab]);
  return null;
};

/**
 * Añade a cada paso con `target` el cambio a la pestaña que contiene ese
 * módulo. Los objetivos que no están en el mapa (el panel fijo o los pasos de
 * bienvenida) no cambian de pestaña.
 */
export function pasosConPestana(
  steps: TourStep[],
  tabDe: Record<string, string>,
  grupo: string,
  onTab: (tab: string) => void
): TourStep[] {
  return steps.map((step) => {
    const tab = step.target ? tabDe[step.target] : undefined;
    if (!tab) return step;
    return {
      ...step,
      body: (
        <>
          {step.body}
          <CambiaPestana grupo={grupo} tab={tab} onTab={onTab} />
        </>
      ),
    };
  });
}
