/**
 * src/components/mascotas/PetFigure.tsx
 *
 * El dibujo de la mascota: uno de los personajes de Lalo (el SVG de petArt.ts,
 * con sus ojos `.pt-e` y su boca `.pt-m`) o las imágenes que subió el streamer.
 *
 * - Personaje de Lalo: se pinta con la cara neutral. La capa cambia la cara de
 *   emoción por su cuenta (sustituye el grupo data-p="face"), sin volver a
 *   pintar el personaje, para no cortar sus animaciones.
 * - Personaje propio: todas las imágenes están cargadas y la capa enseña una u
 *   otra con `data-talk` y `data-emo` en el contenedor: así un GIF no vuelve a
 *   empezar.
 */

import React, { useMemo } from 'react';
import type { PetEmotion, PetKind } from '../../types/pets';
import { petMarkup } from './petArt';

interface PetFigureProps {
  kind: PetKind;
  color: string;
  idleUrl?: string;
  talkUrl?: string;
  /** Personaje propio: imagen de cada emoción que tenga una. */
  emotionUrls?: Partial<Record<PetEmotion, string>>;
}

export const PetFigure: React.FC<PetFigureProps> = ({ kind, color, idleUrl, talkUrl, emotionUrls }) => {
  // El dibujo es texto fijo de petArt.ts: no lleva nada del chat ni de los ajustes
  const art = useMemo(() => (kind === 'custom' ? null : { __html: petMarkup(kind) }), [kind]);

  if (kind === 'custom' && idleUrl) {
    return (
      <>
        <img className="pt-img" data-s="idle" src={idleUrl} alt="" draggable={false} decoding="async" />
        {talkUrl && <img className="pt-img" data-s="talk" src={talkUrl} alt="" draggable={false} decoding="async" />}
        {Object.entries(emotionUrls ?? {}).map(
          ([emotion, url]) => url && <img key={emotion} className="pt-img" data-s={`emo-${emotion}`} src={url} alt="" draggable={false} decoding="async" />
        )}
      </>
    );
  }

  return (
    <svg
      className="pt-svg"
      data-pet={kind === 'custom' ? 'chispa' : kind}
      viewBox="0 0 200 200"
      aria-hidden="true"
      style={{ '--pt-c': color } as React.CSSProperties}
      dangerouslySetInnerHTML={art ?? { __html: petMarkup('chispa') }}
    />
  );
};
