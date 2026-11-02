/**
 * src/components/welcome/InsigniaFundador.tsx
 *
 * Emblema «Creador Fundador Nº xxx»: octógono de esquinas cortadas, anillo con
 * el texto «CREADOR FUNDADOR • TALLY STUDIO •» y la baliza al centro. Es el
 * diseño aprobado en la bienvenida de fundadores, con la identidad Tally.
 * Lo usan la bienvenida, Mi cuenta y el listado de streamers del administrador.
 *
 * Clases que anima bienvenidaMotion.ts: .bt-ring-draw (trazo del anillo).
 */

import React, { useId } from 'react';
import { nombreEmblema } from '../../lib/fundadores';
import '../../styles/bienvenida-tally.css';

export interface InsigniaProps {
  numero: number;
  /** Lado en píxeles. Sin él, ocupa el ancho del contenedor. */
  tamano?: number;
  className?: string;
  /** Oculta el nombre accesible cuando el texto de al lado ya lo dice. */
  decorativa?: boolean;
}

export const InsigniaFundador: React.FC<InsigniaProps> = ({ numero, tamano, className = '', decorativa }) => {
  const uid = useId().replace(/:/g, '');
  const idDegradado = `bt-seal-${uid}`;
  const idAnillo = `bt-ring-${uid}`;
  const nombre = nombreEmblema(numero);
  return (
    <svg
      className={`bt-insignia ${className}`.trim()}
      viewBox="0 0 200 200"
      width={tamano}
      height={tamano}
      role={decorativa ? undefined : 'img'}
      aria-label={decorativa ? undefined : `Emblema ${nombre}`}
      aria-hidden={decorativa ? true : undefined}
      focusable="false"
    >
      <defs>
        <linearGradient id={idDegradado} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff2a2a" />
          <stop offset="1" stopColor="#8f1010" />
        </linearGradient>
        <path id={idAnillo} d="M100,100 m-74,0 a74,74 0 1,1 148,0 a74,74 0 1,1 -148,0" fill="none" />
      </defs>
      <polygon points="36,6 164,6 194,36 194,164 164,194 36,194 6,164 6,36" fill={`url(#${idDegradado})`} stroke="#f5f6f8" strokeOpacity=".85" strokeWidth="2" />
      <polygon points="40,16 160,16 184,40 184,160 160,184 40,184 16,160 16,40" fill="none" stroke="#ffffff" strokeOpacity=".28" strokeWidth="1.5" />
      <text fontFamily="Sora, Segoe UI, sans-serif" fontSize="10.5" fontWeight="800" fill="#f5f6f8">
        <textPath href={`#${idAnillo}`} textLength="458" lengthAdjust="spacing">
          CREADOR FUNDADOR • TALLY STUDIO •{' '}
        </textPath>
      </text>
      <circle cx="100" cy="100" r="52" fill="#16191c" stroke="#f5f6f8" strokeOpacity=".9" strokeWidth="2" />
      <circle className="bt-ring-draw" cx="100" cy="100" r="60" fill="none" stroke="#f5f6f8" strokeOpacity=".8" strokeWidth="1.5" pathLength={1} strokeDasharray={1} strokeDashoffset={0} transform="rotate(-90 100 100)" />
      <g transform="translate(58.4 56) scale(1.3)">
        <g stroke="#f5f6f8" strokeWidth="3.2" strokeLinecap="round">
          <line x1="14.1" y1="29.5" x2="6.6" y2="26.8" />
          <line x1="21.1" y1="20.4" x2="16.5" y2="13.9" />
          <line x1="32" y1="17" x2="32" y2="9" />
          <line x1="42.9" y1="20.4" x2="47.5" y2="13.9" />
          <line x1="49.9" y1="29.5" x2="57.4" y2="26.8" />
        </g>
        <path d="M18 49V36a14 14 0 0 1 28 0v13z" fill="#ff2a2a" />
        <path d="M24.5 44V37a7.5 7.5 0 0 1 4.6-6.9" stroke="#fff" strokeOpacity=".9" strokeWidth="2.8" strokeLinecap="round" fill="none" />
        <rect x="12" y="50" width="40" height="6" rx="2" fill="#f5f6f8" />
      </g>
    </svg>
  );
};
