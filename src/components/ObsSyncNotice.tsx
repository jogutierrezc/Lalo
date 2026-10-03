/**
 * src/components/ObsSyncNotice.tsx
 *
 * Aviso flotante (HUD Toast) de confirmación cinemática para OBS Studio.
 * Diseñado bajo las directivas de Impeccable (Operate & Craft) y Emil Kowalski:
 * - Animación elástica de entrada con GSAP (back.out, blur reveal y spatial consistency).
 * - Barra de progreso temporal que se consume con precisión.
 * - Faro beacon pulsante en verde esmeralda.
 * - Salida acelerada fluida con micro-blur.
 * - Descarte interactivo manual o por temporizador.
 */

import React, { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { Check, Copy, X } from 'lucide-react';

export interface ObsSyncNoticeProps {
  appType: string;
  url: string;
  onDismiss: () => void;
  autoDismissMs?: number;
}

export const ObsSyncNotice: React.FC<ObsSyncNoticeProps> = ({
  appType,
  url,
  onDismiss,
  autoDismissMs = 4200,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const beaconRef = useRef<HTMLSpanElement | null>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);

  const [copiedAgain, setCopiedAgain] = useState(false);

  // Animación de entrada y temporizador de barra de progreso con GSAP
  useEffect(() => {
    if (!containerRef.current) return;

    const ctx = gsap.context(() => {
      const tl = gsap.timeline();
      timelineRef.current = tl;

      // 1. Entrada física con resorte 'back.out(1.5)' y micro-blur
      tl.fromTo(
        containerRef.current,
        {
          y: -32,
          opacity: 0,
          scale: 0.92,
          filter: 'blur(6px)',
        },
        {
          y: 0,
          opacity: 1,
          scale: 1,
          filter: 'blur(0px)',
          duration: 0.38,
          ease: 'back.out(1.5)',
        }
      );

      // 2. Barra de progreso que se consume uniformemente a lo largo del tiempo
      if (progressBarRef.current) {
        tl.fromTo(
          progressBarRef.current,
          { width: '100%' },
          {
            width: '0%',
            duration: autoDismissMs / 1000,
            ease: 'none',
          },
          0
        );
      }

      // 3. Salida suave automática al completarse el tiempo
      tl.to(
        containerRef.current,
        {
          y: -24,
          opacity: 0,
          scale: 0.94,
          filter: 'blur(4px)',
          duration: 0.28,
          ease: 'power2.in',
          onComplete: onDismiss,
        },
        autoDismissMs / 1000
      );

      // 4. Faro beacon pulsante en segundo plano
      if (beaconRef.current) {
        gsap.to(beaconRef.current, {
          scale: 1.8,
          opacity: 0,
          repeat: -1,
          duration: 1.4,
          ease: 'power2.out',
        });
      }
    }, containerRef);

    return () => {
      ctx.revert();
    };
  }, [autoDismissMs, onDismiss]);

  // Cierre interactivo inmediato con animación de salida acelerada
  const handleManualDismiss = () => {
    if (timelineRef.current) {
      timelineRef.current.kill();
    }
    if (containerRef.current) {
      gsap.to(containerRef.current, {
        y: -20,
        opacity: 0,
        scale: 0.94,
        filter: 'blur(4px)',
        duration: 0.22,
        ease: 'power2.in',
        onComplete: onDismiss,
      });
    } else {
      onDismiss();
    }
  };

  const handleCopyAgain = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopiedAgain(true);
    setTimeout(() => setCopiedAgain(false), 2000);
  };

  return (
    <div
      ref={containerRef}
      role="status"
      aria-live="polite"
      className="fixed top-16 right-4 sm:right-8 z-50 max-w-md w-[calc(100vw-2rem)] select-none"
      style={{
        willChange: 'transform, opacity, filter',
      }}
    >
      <div
        className="relative overflow-hidden rounded-xl border border-emerald-500/40 bg-slate-950/90 p-4 shadow-2xl backdrop-blur-2xl"
        style={{
          boxShadow:
            '0 20px 40px -10px rgba(0, 0, 0, 0.85), 0 0 25px -4px rgba(16, 185, 129, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.15)',
        }}
      >
        {/* Esquinas angulares decorativas estilo hardware broadcast */}
        <div className="pointer-events-none absolute top-0 left-0 h-2.5 w-2.5 border-t-2 border-l-2 border-emerald-400" />
        <div className="pointer-events-none absolute top-0 right-0 h-2.5 w-2.5 border-t-2 border-r-2 border-emerald-400" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-2.5 w-2.5 border-b-2 border-l-2 border-emerald-400" />
        <div className="pointer-events-none absolute bottom-0 right-0 h-2.5 w-2.5 border-b-2 border-r-2 border-emerald-400" />

        {/* Resplandor ambiental superior */}
        <div className="pointer-events-none absolute -top-12 left-1/2 -translate-x-1/2 h-20 w-44 rounded-full bg-emerald-500/20 blur-xl" />

        <div className="flex items-start gap-3.5">
          {/* Insignia / Medallón con checkmark y faro LED */}
          <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-400/40 bg-emerald-950/80 shadow-[0_0_12px_rgba(16,185,129,0.35)]">
            <span
              ref={beaconRef}
              className="absolute inset-0 rounded-lg bg-emerald-400/30"
            />
            <Check className="h-5 w-5 text-emerald-300 stroke-[2.5]" />
          </div>

          {/* Contenido textual principal */}
          <div className="min-w-0 flex-1 pr-6">
            <div className="flex items-center gap-2">
              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[9px] font-black uppercase tracking-wider text-emerald-300">
                LIVE SYNC
              </span>
              <span className="text-[11px] font-bold text-slate-400">
                Overlay {appType}
              </span>
            </div>

            <h4 className="mt-1 text-sm font-extrabold tracking-tight text-white drop-shadow">
              ¡Actualización enviada a OBS Studio!
            </h4>

            <p className="mt-0.5 text-xs text-slate-300 leading-snug">
              Señal emitida vía Broadcast y Servidor. El enlace actualizado con todos los parámetros ya está en tu portapapeles.
            </p>

            {/* Acciones secundarias en el footer del toast */}
            <div className="mt-2.5 flex items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 active:scale-[0.96] px-2.5 py-1 text-[11px] font-semibold text-slate-200 transition-all"
                onClick={handleCopyAgain}
              >
                {copiedAgain ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-400" />
                    <span className="text-emerald-300">Copiado</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3 text-slate-400" />
                    <span>Copiar de nuevo</span>
                  </>
                )}
              </button>

              <span className="text-[10px] text-slate-500 font-mono">
                1920 × 1080
              </span>
            </div>
          </div>

          {/* Botón de cierre manual */}
          <button
            type="button"
            className="absolute top-3 right-3 flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:text-white hover:bg-white/10 active:scale-[0.9] transition-all"
            onClick={handleManualDismiss}
            title="Cerrar notificación"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Barra de progreso inferior con degradado esmeralda */}
        <div className="absolute bottom-0 left-0 right-0 h-[2.5px] bg-slate-800">
          <div
            ref={progressBarRef}
            className="h-full bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400"
          />
        </div>
      </div>
    </div>
  );
};
