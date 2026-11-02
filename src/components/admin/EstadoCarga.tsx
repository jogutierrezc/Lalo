/**
 * src/components/admin/EstadoCarga.tsx
 *
 * Estados de una pantalla que lee del servidor: cargando, error (borde
 * discontinuo + icono + texto, con «Reintentar») y «pendiente de conexión»
 * (el servidor aún no tiene lo necesario). El vacío lo pinta cada pantalla.
 */

import React from 'react';
import { AlertTriangle, PlugZap } from 'lucide-react';
import { Boton } from '../tally-ui';
import type { LoadState } from '../../pages/admin/useAdminBilling';
import '../../styles/admin-tally.css';

interface Props {
  state: LoadState<unknown>;
  /** Qué se está leyendo: «la bandeja de pagos», «la facturación». */
  what: string;
  /** Texto de «pendiente de conexión» que explica qué falta. */
  pendingText: string;
  onRetry: () => void;
}

/** Devuelve el panel del estado, o null si hay datos (`ready`). */
export const EstadoCarga: React.FC<Props> = ({ state, what, pendingText, onRetry }) => {
  if (state.status === 'ready') return null;
  if (state.status === 'loading') {
    return (
      <p className="atl-estado" role="status" data-estado="cargando">
        Leyendo {what}.
      </p>
    );
  }
  if (state.status === 'pending') {
    return (
      <div className="atl-estado" role="status" data-estado="pendiente">
        <PlugZap size={20} aria-hidden="true" />
        <div>
          <b>Pendiente de conexión</b>
          <p>{pendingText}</p>
        </div>
        <Boton pequeno onClick={onRetry}>
          Reintentar
        </Boton>
      </div>
    );
  }
  return (
    <div className="atl-estado" role="alert" data-estado="error">
      <AlertTriangle size={20} aria-hidden="true" />
      <div>
        <b>No se pudo leer {what}</b>
        <p>{state.message}</p>
      </div>
      <Boton pequeno onClick={onRetry}>
        Reintentar
      </Boton>
    </div>
  );
};
