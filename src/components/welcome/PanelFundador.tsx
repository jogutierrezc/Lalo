/**
 * src/components/welcome/PanelFundador.tsx
 *
 * Tarjeta de Mi cuenta con el emblema de Creador Fundador, el estado del
 * regalo del plan Creadores Iniciales y el botón «Ver bienvenida», que repite
 * la bienvenida de la app. Quien no es fundador solo ve «Ver bienvenida».
 */

import React from 'react';
import { esFundador, fechaCorta, fechaVencimiento, nombreEmblema, numeroFundador, textoMeses, textoRegalo } from '../../lib/fundadores';
import { useCloudSession } from '../../hooks/useCloudSession';
import { InsigniaFundador } from './InsigniaFundador';
import { verBienvenida } from './bienvenidaEvento';
import { useRegaloFundador } from './useRegaloFundador';
import '../../styles/bienvenida-tally.css';

export const PanelFundador: React.FC = () => {
  const { profile } = useCloudSession();
  const { config, estado, activar } = useRegaloFundador();
  const numero = numeroFundador(profile);
  const regalo = textoRegalo(estado);

  return (
    <section className="cab-mod">
      <h2>{esFundador(profile) ? 'Creador Fundador' : 'Bienvenida'}</h2>
      {numero !== null && (
        <div className="bt-panel-fila">
          <InsigniaFundador numero={numero} tamano={112} className="bt-panel-insignia" />
          <div className="grid gap-1">
            <b>{nombreEmblema(numero)}</b>
            <span className="cab-hint">Eres de los primeros en Tally Studio. Gracias por confiar en nosotros.</span>
          </div>
        </div>
      )}
      {numero !== null && estado !== 'oculto' && (
        <div className="cab-field">
          <span className="cab-label">Regalo de fundador · Plan {config.planNombre}</span>
          <span>
            {textoMeses(config.meses)} de TTS con voces, sin costo
            {estado === 'disponible' ? ` (vence el ${fechaCorta(fechaVencimiento(new Date(), config.meses))} si lo activas hoy)` : ''}.
          </span>
          <div>
            <button type="button" className="cab-btn" disabled={!regalo.habilitado} onClick={activar}>
              {regalo.boton}
            </button>
          </div>
          {regalo.aviso && (
            <span className="cab-hint" role="status">
              {regalo.aviso}
            </span>
          )}
        </div>
      )}
      <div>
        <button type="button" className="cab-btn2" onClick={verBienvenida}>
          Ver bienvenida
        </button>
      </div>
    </section>
  );
};
