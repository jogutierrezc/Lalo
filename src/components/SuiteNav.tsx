/**
 * src/components/SuiteNav.tsx
 *
 * Barra de la herramienta dentro del cascarón único (src/components/shell/AppShell.tsx).
 *
 * La barra lateral, el título, el canal y las fuentes de OBS ahora los pinta el
 * cascarón una sola vez. Cada página sigue montando <SuiteNav> con sus datos y
 * este componente solo dibuja lo que es de la página:
 *   - «Guía», si la página tiene recorrido;
 *   - «Actualizar OBS» y «Copiar URL» de la fuente de esa herramienta;
 *   - el estado de guardado (o el aviso de la sincronización con la nube).
 * `live` ya no se usa aquí: el cascarón decide cuándo mostrar «Canal en directo».
 */

import React from 'react';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { ObsSyncNotice } from './ObsSyncNotice';
import { layerParamsForWidget, useCloudSyncMessage, useObsActions } from './shell/obsActions';
import { useShellTool } from './shell/ShellContext';
import { toolById } from '../lib/tools';
import type { ToolId } from '../lib/tools';

export type SuiteApp = ToolId | 'catalogo' | 'control' | 'integraciones' | 'cuenta' | 'nube' | 'admin';

export { layerParamsForWidget };

interface SuiteNavProps {
  currentApp: SuiteApp;
  channel?: string;
  saved?: boolean;
  onOpenTour?: () => void;
  tourAvailable?: boolean;
  /** Lo decide el cascarón; se acepta para no tocar a las páginas. */
  live?: boolean;
}

export const SuiteNav: React.FC<SuiteNavProps> = ({ currentApp, channel, saved, onOpenTour, tourAvailable = false }) => {
  const windowTool = useShellTool();
  const toolId = windowTool ?? currentApp;
  const tool = toolById(toolId);
  const obs = useObsActions(channel, tool ? tool.id : null);
  const syncMessage = useCloudSyncMessage();
  const widgetApp = tool?.widgetApp;

  const showTour = tourAvailable && !!onOpenTour;
  // Sin nada que mostrar (por ejemplo Mi cuenta), la barra no ocupa sitio
  if (!tool && !showTour && saved === undefined) return null;

  return (
    <div className="shell-embed-bar" data-tour="obs-sync">
      {tool && (
        <>
          <button
            type="button"
            className="cab-btn2 cab-btn-sm"
            onClick={obs.triggerObsSync}
            disabled={obs.syncState === 'busy'}
            title="Envía los ajustes actuales a las fuentes de OBS y copia la URL"
          >
            {obs.syncState === 'done' ? (
              <Check className="h-4 w-4" />
            ) : (
              <RefreshCw className={`h-4 w-4 ${obs.syncState === 'busy' ? 'animate-spin' : ''}`} />
            )}
            <span>{obs.syncState === 'busy' ? 'Enviando' : obs.syncState === 'done' ? 'OBS actualizado' : 'Actualizar OBS'}</span>
          </button>
          {widgetApp && (
            <button type="button" className="cab-btn cab-btn-sm" onClick={() => obs.copy(widgetApp)} title="Copia la URL de la fuente de esta herramienta">
              {obs.copiedKey === widgetApp ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              <span>{obs.copiedKey === widgetApp ? 'Copiada' : 'Copiar URL'}</span>
            </button>
          )}
        </>
      )}

      {showTour && (
        <button type="button" className="cab-btn2 cab-btn-sm" onClick={onOpenTour}>
          Guía
        </button>
      )}

      {saved !== undefined && (
        <span className="shell-saved" role="status">
          {!saved ? 'Guardando' : syncMessage || (obs.cloud.enabled ? 'Guardado en la nube' : 'Guardado')}
        </span>
      )}

      {obs.notice && <ObsSyncNotice appType={obs.notice.appType} url={obs.notice.url} onDismiss={obs.clearNotice} />}
    </div>
  );
};
