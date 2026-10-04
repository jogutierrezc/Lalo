/**
 * src/components/recorrido/Narrador.tsx
 *
 * «Teemo te explica»: el texto del paso siempre a la vista y un botón para
 * escucharlo con la voz de Teemo. Nunca suena solo. Si el audio falla, se dice
 * y el texto sigue ahí.
 */

import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { reduced } from '../../utils/alertMotion';
import { useReproductor } from './useReproductor';

gsap.registerPlugin(useGSAP);

interface NarradorProps {
  /** Nombre del paso: con él se busca el audio ya generado. */
  paso: string;
  /** Lo que dice Teemo. */
  texto: string;
}

export const Narrador: React.FC<NarradorProps> = ({ paso, texto }) => {
  const { estado, error, sonar, detener } = useReproductor();
  const ondaRef = useRef<HTMLSpanElement | null>(null);

  // Al cambiar de paso, Teemo calla
  useEffect(() => detener, [paso, detener]);

  // Onda mientras suena
  useGSAP(
    () => {
      if (estado !== 'sonando' || reduced() || !ondaRef.current) return;
      gsap.to(ondaRef.current.children, {
        scaleY: () => gsap.utils.random(0.35, 1),
        duration: 0.16,
        repeat: -1,
        repeatRefresh: true,
        ease: 'sine.inOut',
        stagger: 0.04,
      });
    },
    { dependencies: [estado], scope: ondaRef, revertOnUpdate: true }
  );

  const ocupado = estado !== 'reposo';

  return (
    <div className="rec-teemo">
      <div className="rec-teemo-cab">
        <span className="rec-teemo-av" aria-hidden="true">
          T
        </span>
        <div>
          <b>Teemo te explica</b>
          <span role="status">
            {estado === 'cargando' ? 'Preparando la voz' : estado === 'sonando' ? 'Hablando' : 'Voz por defecto de Lalo'}
          </span>
        </div>
      </div>
      <p>{texto}</p>
      {error && (
        <p className="cab-error" role="alert">
          {error} El texto de arriba dice lo mismo.
        </p>
      )}
      <div className="rec-teemo-pie">
        <button
          type="button"
          className="cab-btn2 cab-btn-sm"
          aria-label={ocupado ? 'Detener la explicación de Teemo' : 'Escuchar la explicación de Teemo'}
          onClick={() => (ocupado ? detener() : sonar({ paso, texto }))}
        >
          {ocupado ? 'Detener' : 'Escuchar'}
        </button>
        <span ref={ondaRef} className="rec-onda" data-activa={estado === 'sonando'} aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  );
};
