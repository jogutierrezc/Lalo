/**
 * GuidedTour.tsx
 *
 * Guía de primeros pasos del panel. Un marco resalta el módulo del que se habla
 * y una consola fija abajo explica qué hacer. El panel sigue siendo usable
 * durante la guía: el marco no captura clics, así que se aprende haciendo.
 * Se puede saltar en cualquier momento y repetir desde la cabecera.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import gsap from 'gsap';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';

export interface TourStep {
  target?: string; // valor de data-tour del módulo a resaltar; sin él, el paso es de bienvenida
  title: string;
  body: React.ReactNode;
}

const TOUR_DONE_KEY = 'lalo_tts_tour_done';
const RING_PAD = 6;

// La guía de Ajustes conserva su clave original; las demás añaden su id
const doneKey = (id: string) => (id === 'ajustes' ? TOUR_DONE_KEY : `${TOUR_DONE_KEY}_${id}`);

export function isTourDone(id = 'ajustes'): boolean {
  try {
    return localStorage.getItem(doneKey(id)) === '1';
  } catch {
    return true; // sin almacenamiento no se puede recordar: mejor no insistir en cada visita
  }
}

function markTourDone(id: string) {
  try {
    localStorage.setItem(doneKey(id), '1');
  } catch {
    // Ignorar si no está soportado
  }
}

const reduced = () => !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const GuidedTour: React.FC<{ steps: TourStep[]; onClose: () => void; id?: string }> = ({ steps, onClose, id = 'ajustes' }) => {
  const [index, setIndex] = useState(0);
  const ringRef = useRef<HTMLDivElement | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const copyRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLElement | null>(null);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const ringShownRef = useRef(false);
  const closingRef = useRef(false);

  const step = steps[index];
  const isLast = index === steps.length - 1;

  const findTarget = useCallback(
    () => (step.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null),
    [step.target]
  );

  // Coloca el marco sobre el módulo, en coordenadas de documento (acompaña al scroll sin recalcular)
  const placeRing = useCallback(
    (animate: boolean) => {
      const ring = ringRef.current;
      if (!ring) return;
      const target = findTarget();
      if (!target) {
        ringShownRef.current = false;
        gsap.to(ring, { opacity: 0, duration: 0.2, overwrite: true });
        return;
      }
      const rect = target.getBoundingClientRect();
      const box = {
        x: rect.left + window.scrollX - RING_PAD,
        y: rect.top + window.scrollY - RING_PAD,
        width: rect.width + RING_PAD * 2,
        height: rect.height + RING_PAD * 2,
      };
      if (!ringShownRef.current) {
        // Primera aparición: se coloca sin viajar y solo funde
        ringShownRef.current = true;
        gsap.set(ring, box);
        gsap.to(ring, { opacity: 1, duration: reduced() ? 0 : 0.3, ease: 'power2.out', overwrite: 'auto' });
      } else if (animate && !reduced()) {
        gsap.to(ring, { ...box, opacity: 1, duration: 0.45, ease: 'power3.out', overwrite: true });
      } else {
        gsap.set(ring, { ...box, opacity: 1 });
      }
    },
    [findTarget]
  );

  // Entrada de la consola
  useLayoutEffect(() => {
    if (dockRef.current && !reduced()) {
      gsap.fromTo(dockRef.current, { yPercent: 100, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.4, ease: 'power3.out' });
    }
    primaryRef.current?.focus({ preventScroll: true });
  }, []);

  // Cambio de paso: mover el marco, llevar el módulo a la vista y relevar el texto
  useLayoutEffect(() => {
    const target = findTarget();
    placeRing(true);
    target?.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });

    if (!reduced()) {
      if (copyRef.current) {
        // Un desenfoque leve une el texto saliente con el entrante
        gsap.fromTo(
          copyRef.current,
          { opacity: 0, y: 6, filter: 'blur(2px)' },
          { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.25, ease: 'power2.out', clearProps: 'filter' }
        );
      }
    }
    if (barRef.current) {
      gsap.to(barRef.current, { scaleX: (index + 1) / steps.length, duration: reduced() ? 0 : 0.3, ease: 'power2.out' });
    }

    // El módulo puede cambiar de tamaño mientras se usa (por ejemplo, al elegir Sticker)
    const onResize = () => placeRing(false);
    window.addEventListener('resize', onResize);
    const observer = target && 'ResizeObserver' in window ? new ResizeObserver(onResize) : null;
    if (target && observer) observer.observe(target);
    return () => {
      window.removeEventListener('resize', onResize);
      observer?.disconnect();
    };
  }, [index, steps.length, findTarget, placeRing]);

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    markTourDone(id);
    if (reduced() || !dockRef.current) {
      onClose();
      return;
    }
    // Salida más corta que la entrada
    gsap.to(ringRef.current, { opacity: 0, duration: 0.18, ease: 'power2.out' });
    gsap.to(dockRef.current, { yPercent: 100, opacity: 0, duration: 0.2, ease: 'power2.out', onComplete: onClose });
  }, [onClose, id]);

  const next = useCallback(() => {
    if (isLast) close();
    else setIndex((i) => i + 1);
  }, [isLast, close]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  useEffect(
    () => () => {
      gsap.killTweensOf([ringRef.current, dockRef.current, copyRef.current, barRef.current]);
    },
    []
  );

  return createPortal(
    <>
      <div ref={ringRef} className="tour-ring" aria-hidden="true" />
      <div ref={dockRef} className="tour-dock" role="dialog" aria-label="Guía de primeros pasos">
        <div className="tour-progress" aria-hidden="true">
          <i ref={barRef} />
        </div>
        <div className="tour-inner">
          <div ref={copyRef} className="tour-copy" aria-live="polite">
            <p className="tour-count">
              Paso {index + 1} de {steps.length}
            </p>
            <h2 className="tour-title">{step.title}</h2>
            <p className="tour-body">{step.body}</p>
          </div>
          <div className="tour-actions">
            {index > 0 && (
              <button type="button" className="cab-btn2" onClick={back}>
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Atrás
              </button>
            )}
            <button ref={primaryRef} type="button" className="cab-btn" onClick={next}>
              {isLast ? 'Terminar' : index === 0 ? 'Empezar' : 'Siguiente'}
              {!isLast && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
            </button>
            {!isLast && (
              <button type="button" className="tour-skip" onClick={close}>
                <X className="h-4 w-4" aria-hidden="true" />
                Saltar guía
              </button>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body
  );
};
