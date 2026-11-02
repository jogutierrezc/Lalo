/**
 * src/components/shell/views.tsx
 *
 * Vistas propias del cascarón:
 *   - Herramientas: lanzador agrupado; cada mosaico abre su ventana interna.
 *   - Conexiones: Ko-fi, Alertas de juego y Ahora suena (ventanas), la tarjeta
 *     «Más integraciones» y la galería de servicios conectados (Integraciones).
 *   - Plan y pagos: días restantes, historial y la página de la cuenta completa
 *     (Mi plan y su ventana de pago, Tu espacio, Tu cuenta, Panel de fundador).
 * Inicio y En vivo siguen siendo Catalog y Control, ahora dentro del cascarón.
 */

import React, { Suspense, lazy } from 'react';
import { Plug } from 'lucide-react';
import { connectionTools, toolsByGroup, type ToolDef } from '../../lib/tools';
import { useToolStatus } from '../inicio/useToolStatus';
import { PaymentHistory } from '../billing/PaymentHistory';
import { usePayments } from '../../lib/usePayments';
import { useToast } from '../tally-ui';
import { PlanCard } from './PlanCard';
import { MAX_WINDOWS, useWindows } from './windowStore';

const Integraciones = lazy(() => import('../../pages/Integraciones').then((m) => ({ default: m.Integraciones })));
const Account = lazy(() => import('../../pages/Account').then((m) => ({ default: m.Account })));

/** Abre la ventana de una herramienta; si ya hay MAX_WINDOWS abiertas, avisa. */
export function useOpenTool() {
  const windows = useWindows();
  const toast = useToast();
  return (id: string, opener?: HTMLElement | null) => {
    if (!windows.open(id, opener)) toast(`Cierra una ventana para abrir otra (máximo ${MAX_WINDOWS}).`);
  };
}

const Tile: React.FC<{ tool: ToolDef; status?: { text: string; empty: boolean }; onOpen: (e: HTMLElement) => void }> = ({ tool, status, onOpen }) => {
  const Icon = tool.icon;
  const kind = tool.isNew ? 'new' : status ? (status.empty ? 'todo' : 'ok') : 'none';
  return (
    <button type="button" className="tally-tile" data-tool={tool.id} onClick={(e) => onOpen(e.currentTarget)}>
      <span className="tally-tile-ic">
        <Icon className="h-5 w-5" />
      </span>
      <b>{tool.name}</b>
      <span className="tally-tile-st" data-kind={kind}>
        <i aria-hidden="true" />
        {tool.isNew ? 'Nuevo' : status ? status.text : 'Abrir'}
      </span>
    </button>
  );
};

export const ToolsView: React.FC = () => {
  const status = useToolStatus();
  const open = useOpenTool();
  return (
    <div className="tally-page">
      <p className="tally-lede">
        Abre una herramienta y configúrala en una ventana. Puedes tener hasta {MAX_WINDOWS} abiertas y moverte entre ellas desde la barra de abajo.
      </p>
      {toolsByGroup().map(({ group, tools }) => (
        <section key={group} aria-label={group}>
          <h2 className="tally-grp">{group}</h2>
          <div className="tally-tiles">
            {tools.map((tool) => (
              <Tile key={tool.id} tool={tool} status={status[tool.id]} onOpen={(el) => open(tool.id, el)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};

export const ConexionesView: React.FC = () => {
  const status = useToolStatus();
  const open = useOpenTool();
  return (
    <div className="tally-page">
      <section aria-label="Conexiones">
        <h2 className="tally-grp">Conexiones</h2>
        <div className="tally-tiles">
          {connectionTools().map((tool) => (
            <Tile key={tool.id} tool={tool} status={status[tool.id]} onOpen={(el) => open(tool.id, el)} />
          ))}
          <div className="tally-tile" data-soon="" aria-label="Más integraciones, próximamente">
            <span className="tally-tile-ic">
              <Plug className="h-5 w-5" />
            </span>
            <b>Más integraciones</b>
            <span className="tally-tile-st" data-kind="soon">
              <i aria-hidden="true" />
              Próximamente
            </span>
          </div>
        </div>
      </section>
      <Suspense fallback={null}>
        <Integraciones />
      </Suspense>
    </div>
  );
};

export const PlanView: React.FC = () => {
  const payments = usePayments();
  return (
    <div className="tally-page">
      <div className="tally-grid2">
        <PlanCard showCta={false} />
        <PaymentHistory rows={payments.rows} state={payments.state} />
      </div>
      <Suspense fallback={null}>
        <Account />
      </Suspense>
    </div>
  );
};
