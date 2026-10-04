/**
 * src/components/recompensas/RewardPlate.tsx
 *
 * La placa de una recompensa en sus seis estilos. La pintan la capa de OBS, el
 * monitor del estudio y las miniaturas del selector de estilo.
 *
 * Los cinco estilos de serie comparten marcado y cambian de forma en
 * recompensas.css. «Personalizado» usa la imagen o el vídeo del creador como
 * fondo y coloca cada texto en una celda de una rejilla 3 × 3.
 * Nada de lo que llega del chat se inserta como HTML.
 */

import React, { forwardRef, useLayoutEffect, useRef } from 'react';
import type { CustomPlate, PlateStyleId } from '../../types/rewards';
import { resolveMediaUrl } from '../../lib/mediaRef';
import { inkFor } from '../../utils/appearance';

export interface PlateContent {
  /** Qué la activó: «Canje de puntos», «Cheer de 100 bits». */
  tag: string;
  /** Nombre del sonido o de la recompensa. */
  name: string;
  /** Quién la activó, o el texto del aviso. */
  user: string;
  /** Cantidad y unidad para el talón del boleto: «100» «bits». */
  amount: string;
  unit: string;
}

interface RewardPlateProps extends PlateContent {
  plateStyle: PlateStyleId;
  accent: string;
  custom: CustomPlate;
  /** Segundos que tarda la línea de progreso en llenarse. Sin valor, la línea queda fija. */
  barSeconds?: number;
  /** Miniatura o muestra fija: visible desde el principio, sin esperar a la animación de entrada. */
  still?: boolean;
}

const CELLS = [0, 1, 2, 3, 4, 5, 6, 7, 8];

export const RewardPlate = forwardRef<HTMLDivElement, RewardPlateProps>(
  ({ plateStyle, accent, custom, tag, name, user, amount, unit, barSeconds, still }, ref) => {
    const barRef = useRef<HTMLElement | null>(null);

    // La línea avanza con una transición de CSS: sigue al reloj aunque OBS frene las animaciones
    useLayoutEffect(() => {
      const bar = barRef.current;
      if (!bar || barSeconds === undefined) return;
      bar.style.transition = 'none';
      bar.style.transform = 'scaleX(0)';
      void bar.offsetWidth;
      bar.style.transition = `transform ${Math.max(0.05, barSeconds)}s linear`;
      bar.style.transform = 'scaleX(1)';
    }, [barSeconds]);

    const vars = { '--c': accent, '--c-ink': inkFor(accent) } as React.CSSProperties;
    const bar = (
      <i className="rw-bar">
        <u ref={barRef} />
      </i>
    );

    if (plateStyle === 'custom') {
      const src = resolveMediaUrl(custom.mediaUrl);
      const texts: { cell: number; node: React.ReactNode }[] = custom.showText
        ? [
            { cell: custom.nameCell, node: <b key="n" className="rw-name">{name}</b> },
            { cell: custom.userCell, node: <span key="u" className="rw-user">{user}</span> },
          ]
        : [];
      return (
        <div
          ref={ref}
          className="rw-plate"
          data-s="custom"
          data-still={still ? '' : undefined}
          data-empty={src ? undefined : ''}
          style={{ ...vars, '--w': `${custom.width}em`, '--t': custom.textColor } as React.CSSProperties}
        >
          {src ? (
            custom.mediaKind === 'video' ? (
              <video className="rw-media" src={src} autoPlay loop muted playsInline />
            ) : (
              <img className="rw-media" src={src} alt="" decoding="async" draggable={false} />
            )
          ) : (
            <div className="rw-media rw-nomedia">Sube tu imagen o vídeo</div>
          )}
          {texts.length > 0 && (
            <div className="rw-grid">
              {CELLS.map((cell) => {
                const here = texts.filter((text) => text.cell === cell);
                return here.length ? (
                  <div key={cell} className="rw-cell" data-col={cell % 3} data-row={Math.floor(cell / 3)}>
                    {here.map((text) => text.node)}
                  </div>
                ) : null;
              })}
            </div>
          )}
          {bar}
        </div>
      );
    }

    return (
      <div ref={ref} className="rw-plate" data-s={plateStyle} data-still={still ? '' : undefined} style={vars}>
        <span className="rw-stub">
          <b>{amount}</b>
          <i>{unit}</i>
        </span>
        <span className="rw-disc" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        <div className="rw-body">
          <span className="rw-tag">{tag}</span>
          <b className="rw-name">{name}</b>
          <span className="rw-user">{user}</span>
          {bar}
        </div>
      </div>
    );
  }
);

RewardPlate.displayName = 'RewardPlate';
