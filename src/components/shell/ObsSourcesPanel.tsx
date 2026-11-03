/**
 * src/components/shell/ObsSourcesPanel.tsx
 *
 * Panel «Fuentes de navegador» de la barra superior: la lista única de fuentes
 * de OBS (src/lib/tools.ts), con abrir en una pestaña y copiar la URL.
 */

import React from 'react';
import { Check, Copy, ExternalLink, X } from 'lucide-react';
import { OBS_SOURCES } from '../../lib/tools';
import type { useObsActions } from './obsActions';

interface Props {
  obs: ReturnType<typeof useObsActions>;
  onClose: () => void;
  onOpenStudio: () => void;
}

export const ObsSourcesPanel: React.FC<Props> = ({ obs, onClose, onOpenStudio }) => (
  <>
    <div className="fixed inset-0 z-40" onClick={onClose} />
    <div className="shell-pop cab" role="dialog" aria-label="Fuentes de navegador para OBS">
      <div className="shell-pop-head">
        <h2>Fuentes de navegador</h2>
        <button type="button" className="cab-icon" aria-label="Cerrar" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="cab-hint">Pega una URL como fuente de navegador en OBS, a 1920 × 1080. Usa «Todo en uno» o una fuente por capa.</p>

      <ul className="cab-rows shell-sources">
        {OBS_SOURCES.map((source) => (
          <li key={source.app} className="cab-row">
            <div className="min-w-0">
              <p className="shell-source-name">{source.name}</p>
              <p className="cab-hint">{source.note}</p>
            </div>
            <div className="cab-row-actions">
              <a
                className="cab-icon"
                href={obs.getWidgetUrl(source.app)}
                target="_blank"
                rel="noreferrer"
                aria-label={`Abrir ${source.name} en una pestaña`}
                title="Abrir en una pestaña"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
              <button type="button" className="cab-btn2 cab-btn-sm" onClick={() => obs.copy(source.app)}>
                {obs.copiedKey === source.app ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span>{obs.copiedKey === source.app ? 'Copiada' : 'Copiar URL'}</span>
              </button>
            </div>
          </li>
        ))}
      </ul>

      <p className="cab-hint">
        ¿Quieres colocar las capas a tu gusto? En{' '}
        <button type="button" className="studio-link" onClick={onOpenStudio}>
          Studio
        </button>{' '}
        montas escenas y cada una tiene su propia URL.
      </p>

      <p className="cab-note">
        ¿Cambiaste voz, reglas o diseño? «Actualizar OBS» envía los cambios a las fuentes ya pegadas, sin cortar el directo. En OBS conviene
        activar «Actualizar el navegador al activar escena».
      </p>
    </div>
  </>
);
