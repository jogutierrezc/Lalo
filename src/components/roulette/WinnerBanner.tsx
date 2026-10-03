/**
 * src/components/roulette/WinnerBanner.tsx
 *
 * Resultado de la ruleta: una placa con el color del segmento ganador que se
 * despliega junto a la rueda. El castigo es lo más grande y entra palabra a
 * palabra, como las alertas de voz. Si el reto tiene duración, la barra corre
 * de forma continua y el reloj da un pulso por segundo en los últimos 5.
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { RouletteSegment, CATEGORY_LABELS } from '../../types/roulette';
import { Play, Pause, RotateCcw, X } from 'lucide-react';
import { inkFor } from '../../utils/appearance';
import { reduced } from '../../utils/alertMotion';

const INTENSITY: Record<NonNullable<RouletteSegment['intensity']>, string> = {
  light: 'suave',
  medium: 'media',
  hard: 'dura',
  extreme: 'extrema',
};

export interface WinnerBannerProps {
  segment: RouletteSegment;
  user?: string;
  onDismiss?: () => void;
  autoDismissSec?: number;
  isStudio?: boolean;
}

export const WinnerBanner: React.FC<WinnerBannerProps> = ({
  segment,
  user = 'Streamer',
  onDismiss,
  autoDismissSec,
  isStudio = false,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const progressBarRef = useRef<HTMLElement | null>(null);
  const clockRef = useRef<HTMLElement | null>(null);

  // Temporizador para retos con duración
  const initialDuration = segment.durationSec && segment.durationSec > 0 ? segment.durationSec : 0;
  const [timeLeft, setTimeLeft] = useState<number>(initialDuration);
  const [isTimerRunning, setIsTimerRunning] = useState<boolean>(initialDuration > 0);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);

  // Entrada: la placa se despliega desde la rueda y el castigo entra por palabras
  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    if (reduced()) {
      gsap.fromTo(root, { opacity: 0 }, { opacity: 1, duration: 0.25 });
      return;
    }
    const tl = gsap.timeline({ delay: 0.25 });
    tl.fromTo(
      root,
      { clipPath: 'inset(0 100% 0 0)' },
      { clipPath: 'inset(0 0% 0 0)', duration: 0.5, ease: 'expo.out' }
    ).fromTo(
      root.querySelectorAll('.rl-title span'),
      { y: '0.5em', opacity: 0 },
      { y: 0, opacity: 1, duration: 0.32, ease: 'expo.out', stagger: 0.06 },
      0.15
    );
    return () => {
      tl.kill();
    };
  }, [segment.id]);

  // Lógica de cuenta regresiva
  useEffect(() => {
    if (!isTimerRunning || timeLeft <= 0) {
      if (timeLeft === 0 && initialDuration > 0) {
        setIsCompleted(true);
      }
      return;
    }

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          setIsTimerRunning(false);
          setIsCompleted(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isTimerRunning, timeLeft, initialDuration]);

  // La barra recorre cada segundo de forma lineal, así avanza sin saltos
  useEffect(() => {
    if (!progressBarRef.current || initialDuration <= 0) return;
    const target = Math.max(0, (isTimerRunning ? timeLeft - 1 : timeLeft) / initialDuration);
    gsap.to(progressBarRef.current, {
      scaleX: target,
      duration: isTimerRunning ? 1 : 0.2,
      ease: 'none',
      overwrite: true,
    });
    // Últimos 5 segundos: un pulso del reloj por segundo
    if (isTimerRunning && timeLeft <= 5 && timeLeft > 0 && clockRef.current && !reduced()) {
      gsap.fromTo(clockRef.current, { scale: 1.14 }, { scale: 1, duration: 0.25, ease: 'power2.out' });
    }
  }, [timeLeft, initialDuration, isTimerRunning]);

  // Auto-cierre si está configurado (y no hay temporizador activo pendiente)
  useEffect(() => {
    if (!autoDismissSec || autoDismissSec <= 0 || initialDuration > 0) return;
    const timer = setTimeout(() => {
      if (onDismiss) onDismiss();
    }, autoDismissSec * 1000);
    return () => clearTimeout(timer);
  }, [autoDismissSec, initialDuration, onDismiss]);

  const cat = CATEGORY_LABELS[segment.category] || CATEGORY_LABELS.custom;
  const isSafe = segment.category === 'safe';

  return (
    <div
      ref={containerRef}
      className="rl-res"
      style={{ '--c': segment.color, '--c-ink': inkFor(segment.color) } as React.CSSProperties}
    >
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="rl-x" aria-label="Cerrar resultado">
          <X className="h-4 w-4" />
        </button>
      )}

      <p className="rl-who ovl-caps">{isSafe ? `Se salva @${user}` : `Le toca a @${user}`}</p>

      <h3 className="rl-title">
        {segment.text.split(/\s+/).map((word, i) => (
          <span key={i}>{word}</span>
        ))}
      </h3>

      <p className="rl-meta">
        <span>{cat.label}</span>
        {segment.intensity && <span>Intensidad {INTENSITY[segment.intensity]}</span>}
      </p>

      {initialDuration > 0 && (
        <>
          <div className="rl-timer">
            {isCompleted ? (
              <em className="ovl-caps">Cumplido</em>
            ) : (
              <b ref={clockRef} className="ovl-mono">
                {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
              </b>
            )}
            <i>
              <u ref={progressBarRef} />
            </i>
          </div>

          {/* Controles del temporizador, solo en el estudio */}
          {isStudio && (
            <div className="rl-ctl">
              <button type="button" onClick={() => setIsTimerRunning(!isTimerRunning)} className="cab-btn2 !min-h-[30px] !px-2.5">
                {isTimerRunning ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                <span>{isTimerRunning ? 'Pausar' : 'Iniciar'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setTimeLeft(initialDuration);
                  setIsTimerRunning(true);
                  setIsCompleted(false);
                }}
                className="cab-btn2 !min-h-[30px] !px-2.5"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Reiniciar</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
