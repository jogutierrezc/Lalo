/**
 * src/components/legal/Aceptacion.tsx
 *
 * «Antes de empezar»: cuatro puntos en claro, dos casillas obligatorias con
 * enlaces a los documentos y el botón de aceptar. Lo usan el paso de la
 * bienvenida y la pantalla que ven una vez las cuentas que ya existían.
 *
 * Los enlaces abren la página legal en otra pestaña, así no se pierde el paso.
 * Va dentro del marco de la bienvenida (mundo oscuro de la aurora).
 */

import React, { useId, useState } from 'react';
import { TituloPaso } from '../recorrido/piezas';
import { documento } from '../../legal';
import { hrefLegal } from '../../legal/logica';
import type { DocId } from '../../legal/tipos';
import type { Aceptacion as EstadoAceptacion } from '../../hooks/useAceptacion';
import '../../styles/legal.css';

const PUNTOS: { titulo: string; texto: string }[] = [
  {
    titulo: 'Las voces son sintéticas',
    texto: 'Se generan con inteligencia artificial. No son grabaciones de personas ni están afiliadas a ninguna marca.',
  },
  { titulo: 'Lo que creas es tuyo', texto: 'Nos das permiso solo para guardarlo y emitirlo en tus capas.' },
  { titulo: 'Hay usos prohibidos', texto: 'Nada de odio, fraude, suplantación ni atribuir un audio a una persona real.' },
  { titulo: 'El servicio puede cambiar', texto: 'Se ofrece según disponibilidad; algunas funciones dependen de terceros.' },
];

/** Enlace a un documento, en otra pestaña. */
const Doc: React.FC<{ id: DocId; children: React.ReactNode }> = ({ id, children }) => (
  <a className="studio-link" href={hrefLegal(id)} target="_blank" rel="noopener">
    {children}
    <span className="sr-only"> (se abre en otra pestaña)</span>
  </a>
);

interface AceptacionProps {
  aceptacion: EstadoAceptacion;
  /** Se llama cuando la aceptación quedó guardada o recordada y se puede seguir. */
  onHecho: () => void;
  /** Texto del botón cuando todo está marcado. */
  accion?: string;
}

export const Aceptacion: React.FC<AceptacionProps> = ({ aceptacion, onHecho, accion = 'Aceptar y continuar' }) => {
  const uid = useId();
  const [terminos, setTerminos] = useState(false);
  const [voces, setVoces] = useState(false);
  const [busy, setBusy] = useState(false);
  // La nube no pudo guardarlo: se avisa y el botón pasa a «Continuar»
  const [aviso, setAviso] = useState<string | null>(null);

  const listo = terminos && voces;
  const { pendientes, renovacion } = aceptacion;

  const aceptar = async () => {
    if (aviso) {
      aceptacion.seguir();
      onHecho();
      return;
    }
    if (!listo) return;
    setBusy(true);
    const fallo = await aceptacion.aceptar();
    setBusy(false);
    if (fallo) {
      setAviso(fallo);
      return;
    }
    onHecho();
  };

  return (
    <>
      <TituloPaso>{renovacion ? 'Los términos cambiaron' : 'Antes de empezar'}</TituloPaso>
      <p className="cab-hint">
        {renovacion
          ? 'Hay una versión nueva de estos documentos. Para seguir usando Lalo hace falta aceptarla.'
          : 'Cuatro cosas que conviene saber, en claro. El texto completo está en los enlaces.'}
      </p>

      {renovacion && pendientes.length > 0 && (
        <div className="rec-caja">
          <b>Qué cambió</b>
          <ul className="lg-cambios">
            {pendientes.map((id) => (
              <li key={id}>
                <Doc id={id}>{documento(id).titulo}</Doc>
                <span className="cab-mono"> versión {documento(id).version}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ol className="lg-pts">
        {PUNTOS.map((punto) => (
          <li key={punto.titulo}>
            <span>
              <b>{punto.titulo}</b>
              {punto.texto}
            </span>
          </li>
        ))}
      </ol>

      <div className="lg-ck">
        <input
          id={`${uid}-terminos`}
          type="checkbox"
          checked={terminos}
          disabled={busy || aviso !== null}
          onChange={(e) => setTerminos(e.target.checked)}
        />
        <label htmlFor={`${uid}-terminos`}>
          He leído y acepto los <Doc id="terminos">Términos de servicio</Doc> y la <Doc id="contenido">Política de contenido</Doc>.
        </label>
      </div>
      <div className="lg-ck">
        <input
          id={`${uid}-voces`}
          type="checkbox"
          checked={voces}
          disabled={busy || aviso !== null}
          onChange={(e) => setVoces(e.target.checked)}
        />
        <label htmlFor={`${uid}-voces`}>
          Entiendo la <Doc id="voces">Política de voces e inteligencia artificial</Doc> y sus usos prohibidos.
        </label>
      </div>
      <p className="cab-hint">
        Los Términos incluyen también la <Doc id="retirada">Notificación y retirada</Doc>, la{' '}
        <Doc id="privacidad">Privacidad</Doc> y el <Doc id="paises">Marco por país</Doc>.
      </p>

      {aviso && (
        <p className="cab-error" role="alert">
          {aviso}
        </p>
      )}

      <div className="rec-fila">
        <button type="button" className="cab-btn acc-twitch" disabled={busy || (!listo && !aviso)} onClick={aceptar}>
          {busy ? 'Guardando' : aviso ? 'Continuar' : accion}
        </button>
        <span className="cab-hint" role="status">
          {aviso ? 'Aceptado en este navegador.' : listo ? 'Listo para continuar.' : 'Marca las dos casillas para continuar.'}
        </span>
      </div>
    </>
  );
};
