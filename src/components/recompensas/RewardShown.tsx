/**
 * src/components/recompensas/RewardShown.tsx
 *
 * Lo que la capa «Recompensas» tiene en pantalla: la placa y el vídeo de cada
 * recompensa, con su animación de entrada. La salida la anima el motor de
 * RewardsLayer, que conoce cada elemento por `register`.
 */

import React, { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import type { PlateStyleId, RewardsSettings } from '../../types/rewards';
import { reduced } from '../../utils/alertMotion';
import type { VideoBox } from '../../utils/rewardPosition';
import { PlateContent, RewardPlate } from './RewardPlate';

export interface Shown {
  id: string;
  plate: (PlateContent & { plateStyle: PlateStyleId; accent: string; barSeconds: number }) | null;
  video: {
    url: string | null;
    box: VideoBox | null; // null: pantalla completa
    blend: boolean;
    volume: number;
    /** Sin tiempo fijo: se retira cuando el vídeo termina. */
    untilEnd: boolean;
  } | null;
}

const X = 'expo.out';

export type Register = (id: string, el: HTMLElement | null, previous: HTMLElement | null) => void;

/** Placa con su entrada. La salida la anima el motor, que conoce el elemento por `register`. */
export const PlateIn: React.FC<{
  id: string;
  plate: NonNullable<Shown['plate']>;
  custom: RewardsSettings['customPlate'];
  register: Register;
}> = ({ id, plate, custom, register }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    register(id, el, null);
    const tween = reduced()
      ? gsap.set(el, { opacity: 1 })
      : gsap.fromTo(el, { opacity: 0, y: '0.7em' }, { opacity: 1, y: 0, duration: 0.4, ease: X });
    return () => {
      tween.kill();
      register(id, null, el);
    };
    // La placa se anima una sola vez, al entrar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <RewardPlate ref={ref} {...plate} custom={custom} />;
};

/** Vídeo de la recompensa en su hueco, o un recuadro de muestra si no hay archivo. */
export const VideoIn: React.FC<{
  id: string;
  video: NonNullable<Shown['video']>;
  register: Register;
  onEnded: () => void;
  onError: () => void;
}> = ({ id, video, register, onEnded, onError }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    register(id, el, null);
    const tween = reduced()
      ? gsap.set(el, { opacity: 1 })
      : gsap.fromTo(el, { opacity: 0, scale: 0.86 }, { opacity: 1, scale: 1, duration: 0.45, ease: X });
    return () => {
      tween.kill();
      register(id, null, el);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { box } = video;
  const style: React.CSSProperties = box
    ? { left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%` }
    : {};
  return (
    <div ref={ref} className="rw-video" data-full={box ? undefined : ''} style={style}>
      {video.url ? (
        <video
          ref={(element) => {
            if (element) element.volume = video.volume;
          }}
          src={video.url}
          autoPlay
          playsInline
          style={{ mixBlendMode: video.blend ? 'screen' : 'normal' }}
          onEnded={video.untilEnd ? onEnded : undefined}
          onError={onError}
        />
      ) : (
        <div className="rw-sample">
          <div>
            <i />
            Vídeo de la recompensa
          </div>
        </div>
      )}
    </div>
  );
};
