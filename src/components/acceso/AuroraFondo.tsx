/**
 * src/components/acceso/AuroraFondo.tsx
 *
 * Fondo de la pantalla de acceso: una aurora lenta en los morados de Twitch y,
 * encima, un foco de luz que sigue al puntero y da un pulso al cambiar de paso.
 *
 * Solo se animan transform y opacity. Los bucles se detienen con la pestaña
 * oculta y todo se limpia al desmontar. Con «reducir movimiento» queda un
 * degradado fijo, sin foco ni pulso.
 */

import React, { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { reduced } from '../../utils/alertMotion';

gsap.registerPlugin(useGSAP);

// Deriva de cada mancha: desplazamiento, escala y duración distintos para que no se note el ciclo
const DERIVA = [
  { xPercent: 18, yPercent: 12, scale: 1.18, duration: 13 },
  { xPercent: -16, yPercent: 16, scale: 0.86, duration: 17 },
  { xPercent: 12, yPercent: -14, scale: 1.22, duration: 15 },
  { xPercent: -22, yPercent: -10, scale: 0.9, duration: 11 },
];

// Punto de reposo del foco, en fracción del fondo (coincide con left/top en acceso.css)
const REPOSO_X = 0.3;
const REPOSO_Y = 0.34;

interface AuroraFondoProps {
  /** Cambia en cada cambio de paso: el foco da un pulso. */
  pulso: string;
}

export const AuroraFondo: React.FC<AuroraFondoProps> = ({ pulso }) => {
  const fondoRef = useRef<HTMLDivElement | null>(null);
  const auroraRef = useRef<HTMLDivElement | null>(null);
  const focoRef = useRef<HTMLDivElement | null>(null);
  const pulsoPrevio = useRef(pulso);

  // Entrada, deriva de la aurora y seguimiento del puntero
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(
        {
          movimiento: '(prefers-reduced-motion: no-preference)',
          punteroFino: '(hover: hover) and (pointer: fine)',
        },
        (ctx) => {
          const { movimiento, punteroFino } = ctx.conditions as { movimiento: boolean; punteroFino: boolean };
          const fondo = fondoRef.current;
          const aurora = auroraRef.current;
          const foco = focoRef.current;
          if (!movimiento || !fondo || !aurora || !foco) return;

          // Entrada: la aurora se abre y el foco aparece
          gsap.fromTo(aurora, { scale: 0.55, opacity: 0 }, { scale: 1, opacity: 1, duration: 1.4, ease: 'expo.out' });
          gsap.fromTo(foco, { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 0.85, duration: 1, delay: 0.2, ease: 'expo.out' });

          // Deriva lenta de las manchas
          const bucles = Array.from(aurora.children).map((mancha, i) =>
            gsap.to(mancha, { ...DERIVA[i % DERIVA.length], ease: 'sine.inOut', yoyo: true, repeat: -1 })
          );
          const alCambiarVisibilidad = () => bucles.forEach((bucle) => (document.hidden ? bucle.pause() : bucle.resume()));
          document.addEventListener('visibilitychange', alCambiarVisibilidad);
          alCambiarVisibilidad();

          // Foco que sigue al puntero: escribe la transformación directamente, sin pasar por React
          let quitarPuntero = () => {};
          if (punteroFino) {
            const moverX = gsap.quickTo(foco, 'x', { duration: 0.9, ease: 'power3.out' });
            const moverY = gsap.quickTo(foco, 'y', { duration: 0.9, ease: 'power3.out' });
            const alMover = (event: PointerEvent) => {
              const caja = fondo.getBoundingClientRect();
              moverX(event.clientX - caja.left - caja.width * REPOSO_X);
              moverY(event.clientY - caja.top - caja.height * REPOSO_Y);
            };
            const alSalir = () => {
              moverX(0);
              moverY(0);
            };
            window.addEventListener('pointermove', alMover, { passive: true });
            document.documentElement.addEventListener('pointerleave', alSalir);
            quitarPuntero = () => {
              window.removeEventListener('pointermove', alMover);
              document.documentElement.removeEventListener('pointerleave', alSalir);
            };
          }

          return () => {
            document.removeEventListener('visibilitychange', alCambiarVisibilidad);
            quitarPuntero();
          };
        }
      );
      return () => mm.revert();
    },
    { scope: fondoRef }
  );

  // Pulso del foco al cambiar de paso
  useGSAP(
    () => {
      if (pulsoPrevio.current === pulso) return;
      pulsoPrevio.current = pulso;
      if (!focoRef.current || reduced()) return;
      gsap.fromTo(
        focoRef.current,
        { scale: 1.5, opacity: 1 },
        { scale: 1, opacity: 0.85, duration: 0.7, ease: 'expo.out', overwrite: 'auto' }
      );
    },
    { dependencies: [pulso], scope: fondoRef }
  );

  return (
    <div ref={fondoRef} className="acc-fondo" aria-hidden="true">
      <div ref={auroraRef} className="acc-aurora">
        <i />
        <i />
        <i />
        <i />
      </div>
      <div ref={focoRef} className="acc-foco" />
    </div>
  );
};
