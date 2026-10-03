/**
 * src/components/roulette/RouletteOverlayView.tsx
 *
 * Overlay cinemático broadcast para la Ruleta de Castigos en OBS Studio y Monitor del Studio.
 * Diseñado con estética Impeccable (Operate & Experience), física inercial fluida GSAP,
 * chasis flotante con micro-textura acrílica transparente, LEDs perimetrales y revelación dramática.
 */

import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { RouletteWheel } from './RouletteWheel';
import { WinnerBanner } from './WinnerBanner';
import {
  RouletteSegment,
  RouletteSettings,
} from '../../types/roulette';

export interface RouletteOverlayViewProps {
  settings: RouletteSettings;
  targetRotation: number;
  startRotation?: number;
  targetWinner?: RouletteSegment;
  isSpinning: boolean;
  activeUser?: string;
  winnerBanner?: {
    segment: RouletteSegment;
    user: string;
  } | null;
  onSpinComplete: (winner: RouletteSegment, index: number) => void;
  onBannerDismiss?: () => void;
  isStudio?: boolean;
}

export const RouletteOverlayView: React.FC<RouletteOverlayViewProps> = ({
  settings,
  targetRotation,
  startRotation,
  targetWinner,
  isSpinning,
  activeUser = 'Streamer',
  winnerBanner,
  onSpinComplete,
  onBannerDismiss,
  isStudio = false,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const glowBackdropRef = useRef<HTMLDivElement | null>(null);

  // Animación de entrada GSAP al montarse o al iniciar el giro
  useEffect(() => {
    if (!containerRef.current) return;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;

    gsap.fromTo(
      containerRef.current,
      { scale: 0.9, opacity: 0, y: 20 },
      {
        scale: 1,
        opacity: 1,
        y: 0,
        duration: 0.5,
        ease: 'back.out(1.4)',
        clearProps: 'transform',
      }
    );
  }, []);

  // Pulso de resplandor ambiental durante el giro
  useEffect(() => {
    if (!glowBackdropRef.current) return;
    if (isSpinning) {
      gsap.to(glowBackdropRef.current, {
        opacity: 0.45,
        scale: 1.15,
        duration: 0.6,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      });
    } else {
      gsap.to(glowBackdropRef.current, {
        opacity: 0.2,
        scale: 1,
        duration: 0.5,
        ease: 'power2.out',
      });
    }
  }, [isSpinning]);

  // Color de resplandor según tema
  const glowColor =
    settings.style === 'gold'
      ? 'rgba(255, 215, 0, 0.35)'
      : settings.style === 'neon'
      ? 'rgba(0, 245, 255, 0.4)'
      : settings.style === 'cyber'
      ? 'rgba(236, 72, 153, 0.4)'
      : 'rgba(255, 45, 70, 0.35)';

  const accentBorder =
    settings.style === 'gold'
      ? 'border-amber-500/40'
      : settings.style === 'neon'
      ? 'border-cyan-500/40'
      : settings.style === 'cyber'
      ? 'border-pink-500/40'
      : 'border-rose-500/40';

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col items-center justify-center p-4 select-none max-w-xl w-full"
    >
      {/* Resplandor ambiental de fondo dinámico */}
      <div
        ref={glowBackdropRef}
        className="pointer-events-none absolute -inset-6 rounded-full blur-3xl opacity-20 transition-opacity"
        style={{ background: glowColor }}
      />

      {/* Chasis broadcast principal con estética acrílica de alta definición */}
      <div
        className={`relative flex flex-col items-center w-full rounded-3xl border ${accentBorder} bg-slate-950/85 p-6 shadow-2xl backdrop-blur-xl overflow-hidden`}
        style={{
          boxShadow: `0 24px 60px -12px rgba(0, 0, 0, 0.85), 0 0 40px -10px ${glowColor}`,
        }}
      >
        {/* Esquinas angulares decorativas de hardware esports */}
        <div className="pointer-events-none absolute top-0 left-0 h-4 w-4 border-t-2 border-l-2 border-white/40" />
        <div className="pointer-events-none absolute top-0 right-0 h-4 w-4 border-t-2 border-r-2 border-white/40" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-4 w-4 border-b-2 border-l-2 border-white/40" />
        <div className="pointer-events-none absolute bottom-0 right-0 h-4 w-4 border-b-2 border-r-2 border-white/40" />

        {/* Encabezado Broadcast */}
        <div className="mb-4 flex flex-col items-center text-center">
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 backdrop-blur-md">
            <span
              className={`h-2 w-2 rounded-full ${
                isSpinning ? 'bg-rose-500 animate-ping' : 'bg-emerald-400'
              }`}
            />
            <span className="text-[10px] font-black tracking-widest text-slate-300 uppercase">
              {isSpinning ? 'GIRO EN CURSO' : 'RULETA LISTA'}
            </span>
            <span className="text-white/20">•</span>
            <span className="text-[10px] font-bold text-slate-400">
              {activeUser ? `@${activeUser}` : 'Chat'}
            </span>
          </div>

          <h2
            className="mt-2 text-base md:text-lg font-black tracking-wider text-white uppercase drop-shadow"
            style={{ letterSpacing: '0.04em' }}
          >
            {settings.title || 'RULETA DE CASTIGOS & RETOS'}
          </h2>
        </div>

        {/* Escenario Central: Ruleta SVG */}
        <div className="relative flex items-center justify-center my-2">
          <RouletteWheel
            segments={settings.segments}
            targetRotation={targetRotation}
            startRotation={startRotation}
            targetWinner={targetWinner}
            isSpinning={isSpinning}
            spinDurationSec={settings.spinDurationSec}
            styleTheme={settings.style}
            soundEnabled={settings.soundEnabled}
            tickVolume={settings.tickVolume}
            size={isStudio ? 340 : 380}
            onSpinComplete={onSpinComplete}
          />
        </div>

        {/* Banner Dramático del Castigo / Reto Ganador */}
        {winnerBanner && (
          <div className="mt-4 w-full">
            <WinnerBanner
              segment={winnerBanner.segment}
              user={winnerBanner.user}
              onDismiss={onBannerDismiss}
              autoDismissSec={settings.winnerBannerDurationSec || 8}
              isStudio={isStudio}
            />
          </div>
        )}
      </div>
    </div>
  );
};
