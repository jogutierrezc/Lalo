/**
 * src/components/welcome/tallyMark.tsx
 *
 * Baliza y logotipo de Tally Studio en vector, copiados de la propuesta aprobada
 * (tally-studio-anuncio.html: beacon() y lockup()). Es una versión MÍNIMA para la
 * bienvenida, con sus propios estilos en src/styles/bienvenida-tally.css.
 *
 * TODO unificar: cuando exista src/components/brand/TallyLogo.tsx (otro
 * worktree), sustituir esto por ese componente y borrar este archivo. Las clases
 * que usan las animaciones son: .bt-beacon, .bt-dome, .bt-base, .bt-ray,
 * .bt-wm, .bt-wv.
 */

import React from 'react';

export const ROJO_TALLY = '#FF2A2A';
export const APAGADO_TALLY = '#3A4047';

/** Rayos de la baliza: [x1, y1, x2, y2] en un lienzo de 64 x 64. */
const RAYOS: [number, number, number, number][] = [
  [14.1, 29.5, 6.6, 26.8],
  [21.1, 20.4, 16.5, 13.9],
  [32, 17, 32, 9],
  [42.9, 20.4, 47.5, 13.9],
  [49.9, 29.5, 57.4, 26.8],
];

export interface ColoresBaliza {
  cupula?: string;
  brillo?: string;
  rayo?: string;
  base?: string;
  sinRayos?: boolean;
}

/** La baliza de cabina: cúpula, brillo, base y cinco rayos que se dibujan con pathLength. */
export const BalizaTally: React.FC<ColoresBaliza & { className?: string }> = ({
  cupula = ROJO_TALLY,
  brillo = '#fff',
  rayo,
  base,
  sinRayos,
  className = '',
}) => {
  const colorRayo = rayo ?? cupula;
  const colorBase = base ?? cupula;
  return (
    <svg className={`bt-beacon ${className}`.trim()} viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">
      <g className="bt-rays" stroke={colorRayo} strokeWidth="3.2" strokeLinecap="round" opacity={sinRayos ? 0 : 1}>
        {RAYOS.map(([x1, y1, x2, y2]) => (
          <line key={`${x1}-${y1}`} className="bt-ray" x1={x1} y1={y1} x2={x2} y2={y2} pathLength={1} strokeDasharray={1} strokeDashoffset={0} />
        ))}
      </g>
      <path className="bt-dome" d="M18 49V36a14 14 0 0 1 28 0v13z" fill={cupula} />
      <path d="M24.5 44V37a7.5 7.5 0 0 1 4.6-6.9" stroke={brillo} strokeOpacity=".9" strokeWidth="2.8" strokeLinecap="round" />
      <rect className="bt-base" x="12" y="50" width="40" height="6" rx="2" fill={colorBase} />
      <rect x="16" y="58" width="32" height="2.5" rx="1.25" fill={colorBase} fillOpacity=".45" />
    </svg>
  );
};

/** Las tres ondas que salen de la «y» de «tally». */
const Ondas: React.FC = () => (
  <svg className="bt-waves" viewBox="0 0 28 26" fill="none" strokeWidth="3" strokeLinecap="round" aria-hidden="true" focusable="false">
    <path className="bt-wv" pathLength={1} strokeDasharray={1} strokeDashoffset={0} d="M4 7Q9 13 4 19" />
    <path className="bt-wv" pathLength={1} strokeDasharray={1} strokeDashoffset={0} d="M10 4Q18 13 10 22" />
    <path className="bt-wv" pathLength={1} strokeDasharray={1} strokeDashoffset={0} d="M16 1Q27 13 16 25" />
  </svg>
);

/** Baliza + «tally studio». `grande` es el tamaño de la revelación. */
export const LogotipoTally: React.FC<{ className?: string; texto?: string }> = ({
  className = '',
  texto = 'Tally Studio',
}) => (
  <span className={`bt-lock ${className}`.trim()} role="img" aria-label={texto}>
    <BalizaTally />
    <span className="bt-wm" aria-hidden="true">
      <span className="bt-w1">
        tally
        <Ondas />
      </span>
      <span className="bt-w2">studio</span>
    </span>
  </span>
);

/** Curvas de nivel para el fondo de las escenas: una polilínea por línea. */
export function curvasDeNivel(lineas: number, ancho: number, alto: number, amplitud: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < lineas; i++) {
    const y0 = 8 + i * ((alto - 16) / lineas);
    let d = '';
    for (let x = 0; x <= ancho; x += 10) {
      const y = y0 + amplitud * Math.sin(x / (ancho / 10) + i * 0.5) + amplitud * 0.6 * Math.sin(x / (ancho / 26) + i * 0.9);
      d += `${x ? 'L' : 'M'}${x} ${y.toFixed(1)}`;
    }
    out.push(d);
  }
  return out;
}

const CURVAS = curvasDeNivel(22, 1600, 900, 26);

/** Fondo decorativo de curvas de nivel, difuminado hacia la izquierda. */
export const FondoCurvas: React.FC = () => (
  <svg className="bt-bgl" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" fill="none" stroke={ROJO_TALLY} strokeWidth="1.2" aria-hidden="true" focusable="false">
    {CURVAS.map((d, i) => (
      <path key={i} d={d} />
    ))}
  </svg>
);
