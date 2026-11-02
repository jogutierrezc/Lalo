/**
 * src/components/brand/SenalFondo.tsx
 *
 * Fondo de la pantalla de acceso con la identidad de Tally Studio: Oscuro OBS
 * con curvas de nivel rojas, una onda de audio al pie, un halo rojo detrás del
 * logotipo y un foco de luz que sigue al puntero. Es el mismo movimiento que
 * tenía la aurora anterior, reescrito en rojo Tally:
 *
 *   - Entrada: las curvas, la onda, las manchas y el halo se abren una vez.
 *   - Deriva lenta (bucles): tres manchas rojas a la deriva, las curvas de nivel
 *     (dos capas que se desplazan en sentidos opuestos) y la onda, cuyas barras
 *     laten en cuatro grupos desfasados.
 *   - Foco de luz: sigue al puntero (solo con puntero fino) y, igual que el
 *     halo, da un pulso al cambiar de paso.
 *
 * Solo se animan transform y opacity. Los bucles se pausan con la pestaña oculta
 * y todo se limpia al desmontar. Con «reducir movimiento» queda fijo: sin
 * bucles, sin foco y sin pulso.
 */

import React, { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { reduced } from '../../utils/alertMotion';

gsap.registerPlugin(useGSAP);

const W = 1600;
const H = 900;

/** Curvas de nivel: líneas onduladas apiladas, con dos senoidales superpuestas. */
function curvasDeNivel(lineas: number, amp: number): string[] {
  const trazos: string[] = [];
  for (let i = 0; i < lineas; i++) {
    const y0 = 8 + i * ((H - 16) / lineas);
    let d = '';
    for (let x = 0; x <= W; x += 10) {
      const y = y0 + amp * Math.sin(x / (W / 10) + i * 0.5) + amp * 0.6 * Math.sin(x / (W / 26) + i * 0.9);
      d += `${x ? 'L' : 'M'}${x} ${y.toFixed(1)}`;
    }
    trazos.push(d);
  }
  return trazos;
}

/** Forma de onda: barras redondeadas centradas en una franja. */
function barrasDeOnda(n: number): { x: number; y: number; h: number }[] {
  const barras: { x: number; y: number; h: number }[] = [];
  const franja = 150;
  for (let i = 0; i < n; i++) {
    const h = 14 + 120 * Math.abs(Math.sin(i * 0.37) * Math.cos(i * 0.11 + 1)) * (0.55 + 0.45 * Math.sin(i * 0.09));
    barras.push({ x: 8 + i * ((W - 16) / n), y: (franja - h) / 2, h });
  }
  return barras;
}

const CURVAS = curvasDeNivel(22, 26);
const BARRAS = barrasDeOnda(160);
const GRUPOS_ONDA = 4;

// Deriva de cada mancha: desplazamiento, escala y duración distintos para que no se note el ciclo
const DERIVA = [
  { xPercent: 18, yPercent: 12, scale: 1.18, duration: 13 },
  { xPercent: -16, yPercent: 16, scale: 0.86, duration: 17 },
  { xPercent: 12, yPercent: -14, scale: 1.22, duration: 15 },
];

// Latido de cada grupo de barras de la onda: escala vertical y duración propias
const LATIDO = [
  { scaleY: 1.35, duration: 1.1 },
  { scaleY: 0.55, duration: 1.6 },
  { scaleY: 1.2, duration: 1.35 },
  { scaleY: 0.65, duration: 1.9 },
];

// Punto de reposo del foco, en fracción del fondo (coincide con left/top en acceso.css)
const REPOSO_X = 0.5;
const REPOSO_Y = 0.34;

interface SenalFondoProps {
  /** Cambia en cada cambio de paso: el halo y el foco dan un pulso. */
  pulso: string;
}

export const SenalFondo: React.FC<SenalFondoProps> = ({ pulso }) => {
  const fondoRef = useRef<HTMLDivElement | null>(null);
  const curvasRef = useRef<SVGSVGElement | null>(null);
  const ondaRef = useRef<SVGSVGElement | null>(null);
  const haloRef = useRef<HTMLDivElement | null>(null);
  const manchasRef = useRef<HTMLDivElement | null>(null);
  const focoRef = useRef<HTMLDivElement | null>(null);
  const pulsoPrevio = useRef(pulso);

  // Entrada, deriva en bucle y seguimiento del puntero
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
          const curvas = curvasRef.current;
          const onda = ondaRef.current;
          const halo = haloRef.current;
          const manchas = manchasRef.current;
          const foco = focoRef.current;
          if (!movimiento || !fondo || !curvas || !onda || !halo || !manchas || !foco) return;

          // Entrada: todo se abre una vez
          gsap.fromTo(curvas, { opacity: 0 }, { opacity: 1, duration: 1.6, ease: 'power2.out', clearProps: 'opacity' });
          gsap.fromTo(onda, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 1.2, delay: 0.2, ease: 'expo.out', clearProps: 'opacity,transform' });
          gsap.fromTo(halo, { scale: 0.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 1.4, ease: 'expo.out', clearProps: 'opacity,transform' });
          gsap.fromTo(manchas, { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 1.6, ease: 'expo.out' });
          gsap.fromTo(foco, { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 0.8, duration: 1, delay: 0.2, ease: 'expo.out' });

          // Bucles: manchas rojas a la deriva, curvas de nivel en dos capas y latido de la onda
          const bucles: gsap.core.Tween[] = [];
          Array.from(manchas.children).forEach((mancha, i) => {
            bucles.push(gsap.to(mancha, { ...DERIVA[i % DERIVA.length], ease: 'sine.inOut', yoyo: true, repeat: -1 }));
          });
          curvas.querySelectorAll('.acc-capa').forEach((capa, i) => {
            bucles.push(gsap.to(capa, { xPercent: i ? -2.2 : 2.2, yPercent: i ? 1.2 : -1.2, duration: i ? 21 : 26, ease: 'sine.inOut', yoyo: true, repeat: -1 }));
          });
          onda.querySelectorAll('.acc-barras').forEach((grupo, i) => {
            bucles.push(
              gsap.to(grupo, { ...LATIDO[i % LATIDO.length], transformOrigin: '50% 50%', ease: 'sine.inOut', yoyo: true, repeat: -1, delay: i * 0.3 })
            );
          });
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

  // Pulso del halo y del foco al cambiar de paso
  useGSAP(
    () => {
      if (pulsoPrevio.current === pulso) return;
      pulsoPrevio.current = pulso;
      if (!haloRef.current || !focoRef.current || reduced()) return;
      gsap.fromTo(haloRef.current, { scale: 1.25, opacity: 0.6 }, { scale: 1, opacity: 1, duration: 0.8, ease: 'expo.out', overwrite: 'auto' });
      gsap.fromTo(focoRef.current, { scale: 1.5, opacity: 1 }, { scale: 1, opacity: 0.8, duration: 0.7, ease: 'expo.out', overwrite: 'auto' });
    },
    { dependencies: [pulso], scope: fondoRef }
  );

  return (
    <div ref={fondoRef} className="acc-fondo" aria-hidden="true">
      <div ref={manchasRef} className="acc-manchas">
        <i />
        <i />
        <i />
      </div>
      <svg ref={curvasRef} className="acc-curvas" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" fill="none" stroke="#ff2a2a" strokeWidth="1.2">
        {[0, 1].map((capa) => (
          <g key={capa} className="acc-capa">
            {CURVAS.map((d, i) => (i % 2 === capa ? <path key={i} d={d} /> : null))}
          </g>
        ))}
      </svg>
      <svg ref={ondaRef} className="acc-onda" viewBox={`0 0 ${W} 150`} preserveAspectRatio="none">
        {Array.from({ length: GRUPOS_ONDA }, (_, g) => (
          <g key={g} className="acc-barras">
            {BARRAS.map((b, i) =>
              i % GRUPOS_ONDA === g ? <rect key={i} x={b.x.toFixed(1)} y={b.y.toFixed(1)} width="4.4" height={b.h.toFixed(1)} rx="2" fill="#ff2a2a" /> : null
            )}
          </g>
        ))}
      </svg>
      <div ref={haloRef} className="acc-halo" />
      <div ref={focoRef} className="acc-foco" />
    </div>
  );
};
