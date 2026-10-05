/**
 * src/components/powerups/PowerupNotice.tsx
 *
 * El aviso en pantalla de un Power-up: la placa de avisos de la suite (.ovl-plate
 * .nt) con su entrada, su tiempo en pantalla y su salida, y la cola que los
 * enseña de uno en uno. Lo usan la fuente suelta de OBS (TwitchEventLayer, que
 * lo coloca abajo a la izquierda) y la caja «Aviso de Power-up» de Studio.
 *
 * Quien lo usa pone el contenedor `.ovl` y decide dónde va. Lo que llega de
 * Twitch se pinta como texto, nunca como HTML.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { reduced } from '../../utils/alertMotion';
import { playAlertAudio } from '../../utils/alertsAudio';
import { NOTICE_SECONDS, Notice, enqueueNotice } from './noticeRules';

const ACCENT = { '--c': '#b68cff', '--c-ink': '#1b1c1f' } as React.CSSProperties;

/** Entrada del aviso: sube un poco mientras aparece. Con movimiento reducido solo aparece. */
const enter = (plate: HTMLElement) =>
  gsap.fromTo(plate, { opacity: 0, y: reduced() ? 0 : 14 }, { opacity: 1, y: 0, duration: 0.4, ease: 'expo.out' });

/**
 * Cola de avisos: uno cada vez; los que no caben se descartan. `muted` quita el
 * sonido (muestras); si es una función, se pregunta al enseñar cada aviso.
 */
export function useNoticeQueue(muted: boolean | (() => boolean) = false) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const waiting = useRef<Notice[]>([]);
  const showing = useRef(false);
  const count = useRef(0);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  /** Pasa al siguiente aviso, o deja la capa vacía. */
  const next = useCallback(() => {
    const following = waiting.current.shift() ?? null;
    showing.current = following !== null;
    setNotice(following);
    const quiet = typeof mutedRef.current === 'function' ? mutedRef.current() : mutedRef.current;
    if (following && !quiet) playAlertAudio('soft-pop', 0.5);
  }, []);

  /** Pone un aviso en la cola. false si la cola está llena. */
  const push = useCallback(
    (tag: string, text: string): boolean => {
      const before = waiting.current.length;
      count.current += 1;
      waiting.current = enqueueNotice(waiting.current, { id: count.current, tag, text });
      if (waiting.current.length === before) return false;
      if (!showing.current) next();
      return true;
    },
    [next]
  );

  useEffect(
    () => () => {
      waiting.current = [];
      showing.current = false;
    },
    []
  );

  return { notice, push, next };
}

interface PowerupNoticeProps {
  notice: Pick<Notice, 'tag' | 'text'>;
  /** Se llama cuando el aviso ya cumplió su tiempo: toca enseñar el siguiente. */
  onDone?: () => void;
  /** Muestra fija: visible desde el principio y sin temporizador que la retire. */
  still?: boolean;
  /** En una muestra fija, cada cambio repite la entrada. */
  pulse?: number;
}

export const PowerupNotice: React.FC<PowerupNoticeProps> = ({ notice, onDone, still = false, pulse = 0 }) => {
  const plateRef = useRef<HTMLDivElement | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  // Entrada, tiempo en pantalla y salida
  useLayoutEffect(() => {
    const plate = plateRef.current;
    if (!plate || still) return;
    const tl = gsap.timeline();
    tl.add(enter(plate));
    tl.to(plate, { opacity: 0, duration: 0.2, ease: 'power2.out' }, NOTICE_SECONDS);
    // El relevo va con un temporizador: OBS detiene las animaciones de las fuentes ocultas
    const timer = setTimeout(() => doneRef.current?.(), (NOTICE_SECONDS + 0.25) * 1000);
    return () => {
      tl.kill();
      clearTimeout(timer);
    };
  }, [still]);

  // Muestra fija: la prueba del editor repite la entrada
  const firstPulse = useRef(pulse);
  useLayoutEffect(() => {
    const plate = plateRef.current;
    if (!plate || !still || pulse === firstPulse.current) return;
    const tween = enter(plate);
    return () => {
      tween.kill();
      gsap.set(plate, { clearProps: 'transform,opacity' });
    };
  }, [still, pulse]);

  return (
    <div ref={plateRef} className="ovl-plate nt" style={ACCENT}>
      <span className="nt-tag ovl-caps">{notice.tag}</span>
      <span className="nt-text">{notice.text}</span>
    </div>
  );
};
