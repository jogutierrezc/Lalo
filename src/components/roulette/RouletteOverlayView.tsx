/**
 * src/components/roulette/RouletteOverlayView.tsx
 *
 * Capa de la Ruleta de Castigos para OBS y para el monitor del estudio.
 *
 * La rueda va directa sobre la escena, sin chasis: debajo, una etiqueta con el
 * título y quién gira. Durante el giro solo se mueve la rueda. Al detenerse, la
 * rueda se aparta y el resultado se despliega a su lado (WinnerBanner).
 */

import React, { useEffect, useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { RouletteWheel } from './RouletteWheel';
import { WinnerBanner } from './WinnerBanner';
import { RouletteSegment, RouletteSettings } from '../../types/roulette';
import { reduced } from '../../utils/alertMotion';

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

const CONFETTI_COUNT = 38;

function burstRouletteConfetti(box: HTMLElement, accentColor: string): void {
  box.replaceChildren();
  const tones = [accentColor, '#ffffff', '#ffd700', '#22c8f0'];
  const shapes = ['ribbon', 'diamond', 'spark'] as const;
  const height = box.clientHeight || 540;

  for (let i = 0; i < CONFETTI_COUNT; i += 1) {
    const bit = document.createElement('i');
    bit.dataset.shape = shapes[i % shapes.length];
    bit.style.left = `${gsap.utils.random(12, 88)}%`;
    bit.style.background = tones[i % tones.length];
    box.append(bit);

    gsap.fromTo(
      bit,
      {
        y: gsap.utils.random(-24, 8),
        x: 0,
        scale: gsap.utils.random(0.85, 1.18),
        rotation: gsap.utils.random(-45, 45),
        rotationX: gsap.utils.random(0, 180),
        rotationY: gsap.utils.random(0, 180),
        autoAlpha: 0,
      },
      {
        y: height * 1.05,
        x: gsap.utils.random(-90, 90),
        rotation: gsap.utils.random(-480, 480),
        rotationX: gsap.utils.random(360, 840),
        rotationY: gsap.utils.random(360, 840),
        autoAlpha: 0.9,
        duration: gsap.utils.random(1.9, 3.2),
        delay: gsap.utils.random(0.04, 0.65),
        ease: 'power1.in',
      }
    );
  }
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const unitRef = useRef<HTMLDivElement | null>(null);
  const labelRef = useRef<HTMLDivElement | null>(null);
  const fxRef = useRef<HTMLDivElement | null>(null);
  const hasResult = Boolean(winnerBanner);
  const firstResult = useRef(true);

  // Entrada: la rueda se asienta y la etiqueta se despliega desde el centro
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || reduced()) return;
    const ctx = gsap.context(() => {
      if (unitRef.current) {
        gsap.fromTo(
          unitRef.current,
          { scale: 0.92, autoAlpha: 0 },
          { scale: 1, autoAlpha: 1, duration: 0.5, ease: 'expo.out', clearProps: 'transform' }
        );
      }
      if (labelRef.current) {
        gsap.fromTo(
          labelRef.current,
          { clipPath: 'inset(0 50% 0 50%)' },
          { clipPath: 'inset(0 0% 0 0%)', duration: 0.4, ease: 'expo.out', delay: 0.18, clearProps: 'clipPath' }
        );
      }
    }, root);
    return () => ctx.revert();
  }, []);

  // Con resultado, la rueda cede el sitio; al cerrarlo, vuelve al centro
  useEffect(() => {
    if (firstResult.current) {
      firstResult.current = false;
      if (!hasResult) return;
    }
    const root = rootRef.current;
    const unit = unitRef.current;
    const label = labelRef.current;
    if (!root || !unit) return;
    const still = reduced();
    const ctx = gsap.context(() => {
      if (hasResult) {
        gsap.to(unit, { x: '-13em', scale: 0.72, duration: still ? 0 : 0.52, ease: 'power3.inOut', overwrite: 'auto' });
        if (label) gsap.to(label, { autoAlpha: 0, y: 4, duration: 0.16, ease: 'power2.in', overwrite: 'auto' });
      } else {
        gsap.to(unit, { x: 0, scale: 1, autoAlpha: 1, duration: still ? 0 : 0.42, ease: 'expo.out', overwrite: 'auto', clearProps: 'transform' });
        if (label) gsap.to(label, { autoAlpha: 1, y: 0, duration: 0.22, ease: 'power2.out', overwrite: 'auto', clearProps: 'transform' });
      }
    }, root);
    return () => ctx.revert();
  }, [hasResult]);

  // Confeti en OBS cuando cae un resultado y está activado en los ajustes
  useEffect(() => {
    const fx = fxRef.current;
    if (!fx || isStudio || !winnerBanner || !settings.confetti || reduced()) {
      fx?.replaceChildren();
      return;
    }
    const ctx = gsap.context(() => {
      burstRouletteConfetti(fx, winnerBanner.segment.color);
    }, fx);
    const sweep = setTimeout(() => fx.replaceChildren(), 4200);
    return () => {
      clearTimeout(sweep);
      ctx.revert();
      fx.replaceChildren();
    };
  }, [winnerBanner, settings.confetti, isStudio]);

  return (
    <div className="ovl-fit">
      <div ref={rootRef} className="ovl rl" data-ovl-theme={settings.style} data-studio={isStudio ? '' : undefined}>
        <div ref={fxRef} className="rl-fx" data-a="fx" aria-hidden="true" />
        <div ref={unitRef} className="rl-unit">
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
            size="24em"
            onSpinComplete={onSpinComplete}
          />

          <div ref={labelRef} className="ovl-plate rl-label" data-spinning={isSpinning ? '' : undefined}>
            <b className="ovl-caps">{settings.title || 'Ruleta de castigos'}</b>
            {isSpinning && activeUser && <span className="rl-spinner">gira @{activeUser}</span>}
          </div>
        </div>

        {winnerBanner && (
          <div className="rl-resbox">
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
