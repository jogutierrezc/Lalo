/**
 * src/pages/AceptacionGate.tsx
 *
 * Aceptación de los términos para cuentas que ya estaban activas y para el
 * administrador: la ven una vez antes de su panel o su consola, y otra vez cada
 * vez que sube la versión de algún documento. Sin aceptar no se entra; sí se
 * puede cerrar sesión. Las cuentas nuevas la ven como un paso de la bienvenida
 * (src/pages/Bienvenida.tsx).
 */

import React from 'react';
import { useCloudSession } from '../hooks/useCloudSession';
import type { Aceptacion as EstadoAceptacion } from '../hooks/useAceptacion';
import { Aceptacion } from '../components/legal/Aceptacion';
import { MarcoRecorrido } from '../components/recorrido/piezas';

/** Mientras se lee qué aceptó la cuenta. */
export const AceptacionCargando: React.FC = () => (
  <MarcoRecorrido
    pulso="aceptacion-cargando"
    lateral={
      <div>
        <p className="cab-label">Lalo Stream Suite</p>
        <h1>Tu directo, tu mesa de control</h1>
      </div>
    }
  >
    <div className="acc-step">
      <p className="cab-hint" role="status">
        Comprobando tu cuenta.
      </p>
    </div>
  </MarcoRecorrido>
);

export const AceptacionGate: React.FC<{ aceptacion: EstadoAceptacion }> = ({ aceptacion }) => {
  const { session, profile, signOut } = useCloudSession();
  const quien = profile?.display_name || profile?.twitch_login || session?.user.email || 'tu cuenta';

  return (
    <MarcoRecorrido
      pulso="aceptacion"
      lateral={
        <>
          <div>
            <p className="cab-label">Lalo Stream Suite</p>
            <h1>{aceptacion.renovacion ? 'Hay términos nuevos' : 'Términos y políticas'}</h1>
          </div>
          <ul>
            <li>
              <b>Una sola vez.</b> Se guarda en tu cuenta qué versión aceptaste y cuándo.
            </li>
            <li>
              <b>Si cambian, te avisamos.</b> Te diremos qué documento cambió.
            </li>
            <li>
              <b>Has entrado como {quien}.</b> Sin aceptar no se abre {profile?.role === 'admin' ? 'la consola' : 'el panel'}.
            </li>
          </ul>
        </>
      }
    >
      <div className="acc-step lg-acc">
        <Aceptacion aceptacion={aceptacion} onHecho={() => {}} />
        <div className="acc-links">
          <button type="button" className="studio-link" onClick={signOut}>
            Cerrar sesión
          </button>
        </div>
      </div>
    </MarcoRecorrido>
  );
};
