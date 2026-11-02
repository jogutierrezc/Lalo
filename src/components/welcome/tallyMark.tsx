/**
 * src/components/welcome/tallyMark.tsx
 *
 * Adaptadores de la bienvenida sobre el logotipo único de la marca
 * (src/components/brand/TallyLogo.tsx). Las animaciones de bienvenidaMotion.ts
 * se enganchan a las clases .tally-beacon, .tally-dome, .tally-base,
 * .tally-rays, .tally-ray, .tally-wm y .tally-wv que dibuja TallyLogo.
 */

import React from 'react';
import { TallyLogo } from '../brand/TallyLogo';

export const ROJO_TALLY = '#FF2A2A';
export const APAGADO_TALLY = '#3A4047';

/** La baliza de cabina sola. `apagada`: sin luz ni rayos, lista para encenderse en la escena de standby. */
export const BalizaTally: React.FC<{ apagada?: boolean; className?: string }> = ({ apagada, className }) => (
  <TallyLogo variant="baliza" tone="onyx" apagada={apagada} decorativo className={className} />
);

/** Baliza + «tally studio». `bt-big` es el tamaño de la revelación. */
export const LogotipoTally: React.FC<{ className?: string }> = ({ className }) => (
  <TallyLogo variant="lockup" tone="onyx" className={className} />
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
