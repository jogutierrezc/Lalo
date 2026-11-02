/**
 * src/components/brand/TallyLogo.tsx
 *
 * Logotipo de Tally Studio en vector: la baliza de cabina (cúpula roja con
 * cinco rayos) y el lockup, que añade «tally studio» en minúsculas con las
 * ondas de señal tras «tally».
 *
 * - variant: 'lockup' (baliza y nombre) o 'baliza' (solo el isotipo).
 * - tone: 'onyx' (sobre fondo oscuro), 'rojo' (sobre rojo, todo en blanco) o
 *   'blanco' (sobre fondo claro). El color del nombre se fija por tono y no
 *   hereda nada del tema del panel, para que sobre onyx nunca salga oscuro.
 * - size: tamaño de letra en píxeles; la baliza mide 1.7 veces ese valor.
 * - animated: la baliza se enciende una sola vez al montarse (parpadeo, rayos
 *   y ondas). Con «reducir movimiento» aparece ya encendida, sin animación.
 *
 * Los estilos están en src/styles/tally.css (clases .tally-*).
 */

import React, { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { reduced } from '../../utils/alertMotion';

gsap.registerPlugin(useGSAP);

export type TallyTone = 'onyx' | 'rojo' | 'blanco';
export type TallyVariant = 'lockup' | 'baliza';

const RED = '#FF2A2A';
const OFF = '#3A4047';

/** Colores de la baliza por tono. */
const TONES: Record<TallyTone, { dome: string; highlight: string }> = {
  onyx: { dome: RED, highlight: '#FFFFFF' },
  rojo: { dome: '#FFFFFF', highlight: RED },
  blanco: { dome: RED, highlight: '#FFFFFF' },
};

// Cada rayo: x1, y1, x2, y2 (en el lienzo de 64 × 64 de la baliza)
const RAYS: [number, number, number, number][] = [
  [14.1, 29.5, 6.6, 26.8],
  [21.1, 20.4, 16.5, 13.9],
  [32, 17, 32, 9],
  [42.9, 20.4, 47.5, 13.9],
  [49.9, 29.5, 57.4, 26.8],
];

const Baliza: React.FC<{ tone: TallyTone; apagada?: boolean }> = ({ tone, apagada }) => {
  const { dome, highlight } = apagada ? { dome: OFF, highlight: '#6A727C' } : TONES[tone];
  return (
    <svg className="tally-beacon" viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">
      <g className="tally-rays" stroke={dome} strokeWidth="3.2" strokeLinecap="round" opacity={apagada ? 0 : 1}>
        {RAYS.map(([x1, y1, x2, y2]) => (
          <line key={`${x1}-${y1}`} className="tally-ray" x1={x1} y1={y1} x2={x2} y2={y2} pathLength={1} strokeDasharray={1} strokeDashoffset={0} />
        ))}
      </g>
      <path className="tally-dome" d="M18 49V36a14 14 0 0 1 28 0v13z" fill={dome} />
      <path d="M24.5 44V37a7.5 7.5 0 0 1 4.6-6.9" stroke={highlight} strokeOpacity=".9" strokeWidth="2.8" strokeLinecap="round" />
      <rect className="tally-base" x="12" y="50" width="40" height="6" rx="2" fill={dome} />
      <rect x="16" y="58" width="32" height="2.5" rx="1.25" fill={dome} fillOpacity=".45" />
    </svg>
  );
};

const Ondas: React.FC = () => (
  <svg className="tally-waves" viewBox="0 0 28 26" fill="none" strokeWidth="3" strokeLinecap="round" aria-hidden="true" focusable="false">
    <path className="tally-wv" pathLength={1} strokeDasharray={1} strokeDashoffset={0} d="M4 7Q9 13 4 19" />
    <path className="tally-wv" pathLength={1} strokeDasharray={1} strokeDashoffset={0} d="M10 4Q18 13 10 22" />
    <path className="tally-wv" pathLength={1} strokeDasharray={1} strokeDashoffset={0} d="M16 1Q27 13 16 25" />
  </svg>
);

interface TallyLogoProps {
  variant?: TallyVariant;
  tone?: TallyTone;
  /** Tamaño de letra en píxeles. Sin él, el logotipo toma el tamaño de su contenedor. */
  size?: number;
  /** Enciende la baliza una vez al montarse. */
  animated?: boolean;
  /** Baliza apagada y sin rayos (la bienvenida la enciende con su propia animación). */
  apagada?: boolean;
  /** Nombre accesible. Con `decorativo` queda oculto a lectores de pantalla. */
  decorativo?: boolean;
  className?: string;
}

export const TallyLogo: React.FC<TallyLogoProps> = ({
  variant = 'lockup',
  tone = 'onyx',
  size,
  animated = false,
  apagada = false,
  decorativo = false,
  className,
}) => {
  const ref = useRef<HTMLSpanElement | null>(null);
  const { dome } = TONES[tone];

  // Encendido único: parpadeo de la cúpula, rayos y ondas. Sin bucles
  useGSAP(
    () => {
      const raiz = ref.current;
      if (!raiz || !animated || reduced()) return;
      const cuerpo = raiz.querySelectorAll('.tally-dome, .tally-base');
      const rayos = raiz.querySelectorAll('.tally-ray');
      const ondas = raiz.querySelectorAll('.tally-wv');
      const nombre = raiz.querySelector('.tally-wm');

      gsap.set(cuerpo, { fill: OFF });
      gsap.set([rayos, ondas], { strokeDashoffset: 1 });
      if (nombre) gsap.set(nombre, { clipPath: 'inset(0 100% 0 0)' });

      const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
      tl.fromTo(raiz.querySelector('.tally-beacon'), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.7 }, 0)
        .to(cuerpo, { fill: dome, duration: 0.04, ease: 'none' }, 0.5)
        .to(cuerpo, { fill: OFF, duration: 0.04, ease: 'none' }, 0.62)
        .to(cuerpo, { fill: dome, duration: 0.04, ease: 'none' }, 0.78)
        .to(cuerpo, { fill: OFF, duration: 0.04, ease: 'none' }, 0.95)
        .to(cuerpo, { fill: dome, duration: 0.04, ease: 'none', clearProps: 'fill' }, 1.15)
        .to(rayos, { strokeDashoffset: 0, duration: 0.5, stagger: 0.06, ease: 'power3.out', clearProps: 'strokeDashoffset' }, 1.2);
      if (nombre) tl.to(nombre, { clipPath: 'inset(0 0% 0 0)', duration: 0.9, ease: 'expo.inOut', clearProps: 'clipPath' }, 1.3);
      tl.to(ondas, { strokeDashoffset: 0, duration: 0.5, stagger: 0.12, ease: 'power3.out', clearProps: 'strokeDashoffset' }, 1.9);
    },
    { scope: ref, dependencies: [animated, tone] }
  );

  const style = size ? ({ fontSize: size } as React.CSSProperties) : undefined;
  const a11y = decorativo ? { 'aria-hidden': true } : { role: 'img', 'aria-label': 'Tally Studio' };

  return (
    <span ref={ref} className={['tally-lock', className].filter(Boolean).join(' ')} data-tone={tone} data-variant={variant} style={style} {...a11y}>
      <Baliza tone={tone} apagada={apagada} />
      {variant === 'lockup' && (
        <span className="tally-wm" aria-hidden="true">
          <span className="tally-w1">
            tally
            <Ondas />
          </span>
          <span>studio</span>
        </span>
      )}
    </span>
  );
};
