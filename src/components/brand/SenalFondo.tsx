/**
 * src/components/brand/SenalFondo.tsx
 *
 * Fondo de la pantalla de acceso con la identidad de Tally Studio: Oscuro OBS
 * con curvas de nivel rojas muy tenues, una forma de onda al pie y un halo rojo
 * detrás del logotipo. Las curvas y la onda son SVG generado una sola vez.
 *
 * Solo se anima la entrada (el fondo se abre una vez) y un pulso breve del halo
 * al cambiar de paso. No hay bucles. Con «reducir movimiento» queda fijo.
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

interface SenalFondoProps {
  /** Cambia en cada cambio de paso: el halo da un pulso. */
  pulso: string;
}

export const SenalFondo: React.FC<SenalFondoProps> = ({ pulso }) => {
  const fondoRef = useRef<HTMLDivElement | null>(null);
  const curvasRef = useRef<SVGSVGElement | null>(null);
  const ondaRef = useRef<SVGSVGElement | null>(null);
  const haloRef = useRef<HTMLDivElement | null>(null);
  const pulsoPrevio = useRef(pulso);

  // Entrada única
  useGSAP(
    () => {
      if (reduced() || !curvasRef.current || !ondaRef.current || !haloRef.current) return;
      gsap.fromTo(curvasRef.current, { opacity: 0 }, { opacity: 1, duration: 1.6, ease: 'power2.out', clearProps: 'opacity' });
      gsap.fromTo(ondaRef.current, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 1.2, delay: 0.2, ease: 'expo.out', clearProps: 'opacity,transform' });
      gsap.fromTo(haloRef.current, { scale: 0.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 1.4, ease: 'expo.out', clearProps: 'opacity,transform' });
    },
    { scope: fondoRef }
  );

  // Pulso del halo al cambiar de paso
  useGSAP(
    () => {
      if (pulsoPrevio.current === pulso) return;
      pulsoPrevio.current = pulso;
      if (!haloRef.current || reduced()) return;
      gsap.fromTo(haloRef.current, { scale: 1.25, opacity: 0.6 }, { scale: 1, opacity: 1, duration: 0.8, ease: 'expo.out', overwrite: 'auto', clearProps: 'opacity,transform' });
    },
    { dependencies: [pulso], scope: fondoRef }
  );

  return (
    <div ref={fondoRef} className="acc-fondo" aria-hidden="true">
      <svg ref={curvasRef} className="acc-curvas" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" fill="none" stroke="#ff2a2a" strokeWidth="1.2">
        {CURVAS.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </svg>
      <svg ref={ondaRef} className="acc-onda" viewBox={`0 0 ${W} 150`} preserveAspectRatio="none">
        {BARRAS.map((b, i) => (
          <rect key={i} x={b.x.toFixed(1)} y={b.y.toFixed(1)} width="4.4" height={b.h.toFixed(1)} rx="2" fill="#ff2a2a" />
        ))}
      </svg>
      <div ref={haloRef} className="acc-halo" />
    </div>
  );
};
