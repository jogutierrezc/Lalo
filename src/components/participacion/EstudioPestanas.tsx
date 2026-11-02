/**
 * src/components/participacion/EstudioPestanas.tsx
 *
 * Armazón común de los estudios de Participación (Metas, Ruleta, Batallas y
 * Torneos) dentro de su ventana:
 *
 * - Arriba, fija: la barra de la suite (`nav`) y las pestañas.
 * - Debajo: los paneles de las pestañas a la izquierda y, a la derecha, un
 *   panel fijo (`fijo`: monitor y botones de prueba) visible en todas las pestañas.
 * - Los paneles inactivos se quedan montados y ocultos (`hidden`): no se pierde
 *   estado ni se desmontan los campos de archivo, y las pruebas y las guías
 *   encuentran todas las opciones.
 */

import React, { useEffect } from 'react';
import { Tabs, type TabItem } from '../tally-ui';
import '../../styles/participacion-tally.css';

/** Pestaña con una insignia numérica opcional (p. ej. solicitudes pendientes). */
export interface PestanaItem {
  id: string;
  label: string;
  insignia?: { texto: string; aria: string };
}

interface Props {
  /** Nombre accesible de la lista de pestañas, p. ej. «Secciones de Metas». */
  etiqueta: string;
  /** Prefijo estable de los ids de pestañas y paneles. */
  idBase: string;
  pestanas: PestanaItem[];
  activa: string;
  onCambio: (id: string) => void;
  /** Barra superior de la suite (SuiteNav). */
  nav: React.ReactNode;
  /** Columna izquierda opcional que se queda fija en todas las pestañas. */
  riel?: React.ReactNode;
  /** Panel fijo de la derecha (monitor y pruebas). */
  fijo?: React.ReactNode;
  /** Avisos encima de los paneles (confirmaciones que valen para todas las pestañas). */
  encima?: React.ReactNode;
  /** Sitio para modales y guía; se pinta al final. */
  extras?: React.ReactNode;
  /** Los paneles de las pestañas (`PanelPestana`). */
  children: React.ReactNode;
}

/**
 * El kit pinta `label` tal cual; con insignia se le pasa un nodo (la insignia
 * lleva su propio aria-label). El tipo de `TabItem` pide texto, de ahí el cast.
 */
const aItemsDelKit = (pestanas: PestanaItem[]): TabItem[] =>
  pestanas.map((pestana) =>
    pestana.insignia
      ? {
          id: pestana.id,
          label: (
            <>
              {pestana.label}
              <b className="pa-chip" aria-label={pestana.insignia.aria}>
                {pestana.insignia.texto}
              </b>
            </>
          ) as unknown as string,
        }
      : { id: pestana.id, label: pestana.label }
  );

export const EstudioPestanas: React.FC<Props> = ({
  etiqueta,
  idBase,
  pestanas,
  activa,
  onCambio,
  nav,
  riel,
  fijo,
  encima,
  extras,
  children,
}) => (
  <div className="pa-estudio">
    <div className="pa-cabecera">
      {nav}
      <Tabs label={etiqueta} tabs={aItemsDelKit(pestanas)} value={activa} onChange={onCambio} idBase={idBase} />
    </div>
    <div className="pa-cuerpo" data-riel={riel ? '' : undefined} data-fijo={fijo ? '' : undefined}>
      {riel && <div className="pa-riel">{riel}</div>}
      <div className="pa-centro">
        {encima}
        {children}
      </div>
      {fijo && <aside className="pa-fijo">{fijo}</aside>}
    </div>
    {extras}
  </div>
);

interface PanelProps {
  idBase: string;
  id: string;
  activa: string;
  children: React.ReactNode;
}

/** Panel de una pestaña: queda montado y se oculta cuando no es la activa. */
export const PanelPestana: React.FC<PanelProps> = ({ idBase, id, activa, children }) => (
  <div
    role="tabpanel"
    id={`${idBase}-panel-${id}`}
    aria-labelledby={`${idBase}-tab-${id}`}
    className="pa-panel"
    hidden={id !== activa}
  >
    {children}
  </div>
);

/**
 * Se pinta dentro del cuerpo de un paso de la guía: al aparecer el paso, cambia
 * a la pestaña que contiene el elemento resaltado y lo acerca a la vista. No
 * pinta nada.
 */
export const CambiaPestana: React.FC<{ pestana: string; onCambio: (id: string) => void; objetivo?: string }> = ({
  pestana,
  onCambio,
  objetivo,
}) => {
  useEffect(() => {
    onCambio(pestana);
    if (!objetivo || typeof window === 'undefined') return;
    // Con la pestaña ya visible, el marco de la guía se recoloca solo
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-tour="${objetivo}"]`)?.scrollIntoView?.({ block: 'center' });
    });
    return () => window.cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pestana, objetivo]);
  return null;
};

/** Texto de un paso de la guía con cambio de pestaña previo. */
export function pasoEnPestana(
  texto: React.ReactNode,
  pestana: string,
  onCambio: (id: string) => void,
  objetivo?: string
): React.ReactNode {
  return (
    <>
      <CambiaPestana pestana={pestana} onCambio={onCambio} objetivo={objetivo} />
      {texto}
    </>
  );
}
