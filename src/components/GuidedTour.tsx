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
  badge?: string; // e.g. 'Acción del Sistema', 'Módulo', 'OBS Studio', 'Audio', 'En vivo'
}

export interface GuidedTourProps {
  steps: TourStep[];
  onClose: () => void;
  id?: string;
  appName?: string;
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

export function markTourDone(id = 'ajustes') {
  try {
    localStorage.setItem(doneKey(id), '1');
  } catch {
    // Ignorar si no está soportado
  }
}

export function resetTour(id = 'ajustes') {
  try {
    localStorage.removeItem(doneKey(id));
  } catch {
    // Ignorar si no está soportado
  }
}

const reduced = () => !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Feedback acústico sintético sutil con Web Audio API (cero-dependencias).
 * Tono sinusoidal suave (sine) con caída ultra-rápida.
 */
function playTourCue(isCompletion = false) {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;

    osc.type = 'sine';
    if (isCompletion) {
      // Fanfarria breve de triunfo
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.08); // G5
      osc.frequency.exponentialRampToValueAtTime(1046.5, now + 0.16); // C6
      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.28);
    } else {
      // Tick sutil al cambiar de paso
      osc.frequency.setValueAtTime(680, now);
      osc.frequency.exponentialRampToValueAtTime(840, now + 0.035);
      gain.gain.setValueAtTime(0.02, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.06);
    }
    setTimeout(() => ctx.close().catch(() => {}), 350);
  } catch {
    // No interrumpir si el navegador bloquea audio
  }
}

export const GuidedTour: React.FC<GuidedTourProps> = ({
  steps,
  onClose,
  id = 'ajustes',
  appName,
}) => {
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
    () => (step?.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null),
    [step?.target]
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

  // Entrada de la consola (slide up con power3.out)
  useLayoutEffect(() => {
    if (dockRef.current && !reduced()) {
      gsap.fromTo(dockRef.current, { yPercent: 100, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.4, ease: 'power3.out' });
    }
    primaryRef.current?.focus({ preventScroll: true });
  }, []);

  // Cambio de paso: mover el marco, llevar el módulo a la vista y relevar el texto con blur suave
  useLayoutEffect(() => {
    const target = findTarget();
    placeRing(true);
    target?.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });

    if (!reduced()) {
      if (copyRef.current) {
        // Un desenfoque leve une el texto saliente con el entrante (filosofía Emil Kowalski)
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

    // El módulo puede cambiar de tamaño mientras se usa
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
    playTourCue(true);
    if (reduced() || !dockRef.current) {
      onClose();
      return;
    }
    // Salida más corta que la entrada (Emil: exit faster than enter)
    gsap.to(ringRef.current, { opacity: 0, duration: 0.18, ease: 'power2.out' });
    gsap.to(dockRef.current, { yPercent: 100, opacity: 0, duration: 0.2, ease: 'power2.out', onComplete: onClose });
  }, [onClose, id]);

  const next = useCallback(() => {
    if (isLast) {
      close();
    } else {
      playTourCue(false);
      setIndex((i) => i + 1);
    }
  }, [isLast, close]);

  const back = useCallback(() => {
    playTourCue(false);
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  // Control por teclado: Esc para cerrar, Flechas para avanzar/retroceder (salvo si se está escribiendo)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
        return;
      }
      const active = document.activeElement;
      const isInput =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement ||
        (active && active.getAttribute('contenteditable') === 'true');
      if (isInput) return;

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        next();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, next, back]);

  useEffect(
    () => () => {
      gsap.killTweensOf([ringRef.current, dockRef.current, copyRef.current, barRef.current]);
    },
    []
  );

  if (!step) return null;

  return createPortal(
    <>
      <div ref={ringRef} className="tour-ring" aria-hidden="true" />
      <div
        ref={dockRef}
        className="tour-dock"
        role="dialog"
        aria-label={`Guía de primeros pasos${appName ? `: ${appName}` : ''}`}
      >
        <div className="tour-progress" aria-hidden="true">
          <i ref={barRef} />
        </div>
        <div className="tour-inner">
          <div ref={copyRef} className="tour-copy" aria-live="polite">
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <p className="tour-count">
                {appName ? `${appName.toUpperCase()} · ` : ''}Paso {index + 1} de {steps.length}
              </p>
              {step.badge && (
                <span className="rounded bg-[color:var(--ui,#9146ff)]/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-[color:var(--ui,#9146ff)] border border-[color:var(--ui,#9146ff)]/30">
                  {step.badge}
                </span>
              )}
            </div>
            <h2 className="tour-title">{step.title}</h2>
            <div className="tour-body">{step.body}</div>
          </div>
          <div className="tour-actions">
            {index > 0 && (
              <button
                type="button"
                className="cab-btn2"
                onClick={back}
                title="Paso anterior (Tecla ←)"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Atrás
              </button>
            )}
            <button
              ref={primaryRef}
              type="button"
              className="cab-btn"
              onClick={next}
              title={isLast ? 'Terminar tutorial' : 'Siguiente paso (Tecla → o Enter)'}
            >
              {isLast ? 'Terminar' : index === 0 ? 'Empezar' : 'Siguiente'}
              {!isLast && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
            </button>
            {!isLast && (
              <button
                type="button"
                className="tour-skip"
                onClick={close}
                title="Saltar tutorial (Esc)"
              >
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
