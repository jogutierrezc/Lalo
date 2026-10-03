/**
 * src/components/roulette/WinnerBanner.tsx
 *
 * Banner de presentación dramática del castigo/reto resultante.
 * Incluye temporizador activo de cuenta regresiva para retos con duración,
 * insignia de usuario y estética de transmisión Cabina Broadcast.
 */

import React, { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import {
  RouletteSegment,
  CATEGORY_LABELS,
} from '../../types/roulette';
import { Play, Pause, RotateCcw, Check, Sparkles, X, Timer } from 'lucide-react';

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
  const progressBarRef = useRef<HTMLDivElement | null>(null);

  // Temporizador para retos con duración
  const initialDuration = segment.durationSec && segment.durationSec > 0 ? segment.durationSec : 0;
  const [timeLeft, setTimeLeft] = useState<number>(initialDuration);
  const [isTimerRunning, setIsTimerRunning] = useState<boolean>(initialDuration > 0);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);

  // Animación física de entrada con GSAP
  useEffect(() => {
    if (!containerRef.current) return;
    gsap.fromTo(
      containerRef.current,
      { opacity: 0, scale: 0.92, y: 24 },
      {
        opacity: 1,
        scale: 1,
        y: 0,
        duration: 0.35,
        ease: 'back.out(1.6)',
      }
    );
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

  // Animación de la barra de progreso del temporizador
  useEffect(() => {
    if (!progressBarRef.current || initialDuration <= 0) return;
    const pct = (timeLeft / initialDuration) * 100;
    gsap.to(progressBarRef.current, {
      width: `${pct}%`,
      duration: 0.3,
      ease: 'linear',
    });
  }, [timeLeft, initialDuration]);

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
      className="relative z-40 mx-auto max-w-lg overflow-hidden rounded-xl border border-[color:var(--cb-line)] bg-zinc-950/95 p-4 shadow-2xl backdrop-blur-md"
      style={{
        borderColor: segment.color,
        boxShadow: `0 12px 40px -10px ${segment.color}50, 0 0 0 1px ${segment.color}30`,
      }}
    >
      {/* Botón de cierre en modo estudio */}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="absolute right-2.5 top-2.5 rounded-full p-1 text-zinc-400 hover:bg-white/10 hover:text-white transition-all active:scale-[0.97]"
          title="Cerrar aviso"
        >
          <X className="h-4 w-4" />
        </button>
      )}

      {/* Encabezado: Insignia de resultado */}
      <div className="flex items-center gap-2">
        <span
          className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-black shadow-sm"
          style={{ backgroundColor: segment.color }}
        >
          <Sparkles className="h-3 w-3 fill-current" />
          <span>{isSafe ? '¡INMUNIDAD / SE SALVÓ!' : '¡CASTIGO / RETO ASIGNADO!'}</span>
        </span>

        <span className="text-[11px] font-bold text-zinc-400">
          Giro desatado por <b className="text-white">@{user}</b>
        </span>
      </div>

      {/* Título principal del castigo */}
      <div className="mt-2.5">
        <h3
          className="cab-caps text-xl font-extrabold text-white tracking-tight leading-snug drop-shadow-md"
          style={{ fontStretch: '75%' }}
        >
          {segment.text}
        </h3>
      </div>

      {/* Categoría e Intensidad */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span
          className="rounded border px-2 py-0.5 text-[10px] font-bold"
          style={{
            borderColor: `${cat.color}60`,
            backgroundColor: `${cat.color}20`,
            color: cat.color,
          }}
        >
          {cat.label}
        </span>

        {segment.intensity && (
          <span className="cab-mono text-[10px] uppercase font-bold text-zinc-400">
            Intensidad: <b className="text-zinc-200">{segment.intensity}</b>
          </span>
        )}
      </div>

      {/* Temporizador de cuenta regresiva (si el reto tiene duración) */}
      {initialDuration > 0 && (
        <div className="mt-3.5 rounded-lg border border-white/10 bg-black/60 p-3">
          <div className="flex items-center justify-between text-xs font-bold">
            <div className="flex items-center gap-1.5 text-zinc-300">
              <Timer className="h-4 w-4 text-amber-400" />
              <span>TEMPO DEL RETO:</span>
            </div>

            <div className="flex items-center gap-2">
              <span
                className={`cab-mono text-base font-black ${
                  timeLeft <= 5 ? 'animate-pulse text-rose-400' : 'text-amber-400'
                }`}
              >
                {Math.floor(timeLeft / 60)}:
                {(timeLeft % 60).toString().padStart(2, '0')}
              </span>
              {isCompleted && (
                <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-extrabold">
                  <Check className="h-3.5 w-3.5" />
                  <span>¡CUMPLIDO!</span>
                </span>
              )}
            </div>
          </div>

          {/* Barra de progreso animada */}
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              ref={progressBarRef}
              className="h-full rounded-full transition-all"
              style={{
                backgroundColor: timeLeft <= 5 ? '#ff2d46' : segment.color,
                width: '100%',
              }}
            />
          </div>

          {/* Controles del temporizador en el estudio */}
          {isStudio && (
            <div className="mt-2.5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsTimerRunning(!isTimerRunning)}
                className="cab-btn2 !h-6 !px-2 !text-[10px] font-bold transition-transform active:scale-[0.97]"
              >
                {isTimerRunning ? (
                  <>
                    <Pause className="h-3 w-3" />
                    <span>Pausar</span>
                  </>
                ) : (
                  <>
                    <Play className="h-3 w-3 fill-current text-emerald-400" />
                    <span>Iniciar</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setTimeLeft(initialDuration);
                  setIsTimerRunning(true);
                  setIsCompleted(false);
                }}
                className="cab-btn2 !h-6 !px-2 !text-[10px] font-bold text-zinc-400 hover:text-white transition-transform active:scale-[0.97]"
                title="Reiniciar temporizador"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Reiniciar</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
