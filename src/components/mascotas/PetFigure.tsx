/**
 * src/components/mascotas/PetFigure.tsx
 *
 * El dibujo de la mascota: uno de los personajes de Lalo (figuras de muestra,
 * con ojos `.pt-e` y boca `.pt-m` que la capa anima) o las imágenes que subió
 * el streamer. Con dos imágenes, las dos están cargadas y la capa enseña una u
 * otra con `data-talk` en el contenedor: así un GIF no vuelve a empezar.
 */

import React from 'react';
import type { PetKind } from '../../types/pets';

interface PetFigureProps {
  kind: PetKind;
  color: string;
  idleUrl?: string;
  talkUrl?: string;
}

const INK = '#1d1a3a';

const Face: React.FC<{ eyes: number; mouth: number }> = ({ eyes, mouth }) => (
  <>
    <g className="pt-e" fill={INK}>
      <circle cx="45" cy={eyes} r="5.5" />
      <circle cx="75" cy={eyes} r="5.5" />
    </g>
    <ellipse className="pt-m" cx="60" cy={mouth} rx="8" ry="4.5" fill={INK} />
  </>
);

export const PetFigure: React.FC<PetFigureProps> = ({ kind, color, idleUrl, talkUrl }) => {
  if (kind === 'custom' && idleUrl) {
    return (
      <>
        <img className="pt-img" data-s="idle" src={idleUrl} alt="" draggable={false} decoding="async" />
        {talkUrl && <img className="pt-img" data-s="talk" src={talkUrl} alt="" draggable={false} decoding="async" />}
      </>
    );
  }

  const shape = { fill: color, stroke: INK, strokeWidth: 4, strokeLinejoin: 'round' as const };
  const line = { stroke: INK, strokeWidth: 4, strokeLinecap: 'round' as const };

  return (
    <svg viewBox="0 0 120 114" aria-hidden="true">
      {kind === 'bit' ? (
        <>
          <path d="M60 26V14" {...line} />
          <rect x="52" y="4" width="16" height="11" rx="3" {...shape} />
          <rect x="5" y="54" width="12" height="24" rx="4" {...shape} />
          <rect x="103" y="54" width="12" height="24" rx="4" {...shape} />
          <rect x="16" y="26" width="88" height="84" rx="16" {...shape} />
          <rect x="30" y="42" width="60" height="30" rx="9" fill="#fff" opacity=".3" />
          <Face eyes={57} mouth={90} />
        </>
      ) : kind === 'miso' ? (
        <>
          <path d="M22 46 28 12l22 20q10-3 20 0l22-20 6 34q6 16 2 32-6 32-40 32T20 78q-4-16 2-32z" {...shape} />
          <ellipse cx="60" cy="88" rx="20" ry="12" fill="#fff" opacity=".28" />
          <path d="M56 68h8l-4 5z" fill={INK} />
          <Face eyes={57} mouth={84} />
        </>
      ) : (
        <>
          <path d="M60 20V9" {...line} />
          <circle cx="60" cy="8" r="5" {...shape} />
          <path d="M60 20c27 0 42 19 42 46s-15 44-42 44-42-17-42-44 15-46 42-46z" {...shape} />
          <ellipse cx="60" cy="86" rx="22" ry="14" fill="#fff" opacity=".28" />
          <Face eyes={58} mouth={78} />
        </>
      )}
    </svg>
  );
};
