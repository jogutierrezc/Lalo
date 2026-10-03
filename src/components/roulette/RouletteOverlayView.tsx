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
  const unitRef = useRef<HTMLDivElement | null>(null);
  const labelRef = useRef<HTMLDivElement | null>(null);
  const hasResult = Boolean(winnerBanner);
  const firstResult = useRef(true);

  // Entrada: la rueda se asienta y la etiqueta se despliega desde el centro
  useLayoutEffect(() => {
    if (!unitRef.current || reduced()) return;
    gsap.fromTo(
      unitRef.current,
      { scale: 0.92, opacity: 0 },
      { scale: 1, opacity: 1, duration: 0.5, ease: 'expo.out' }
    );
    if (labelRef.current) {
      gsap.fromTo(
        labelRef.current,
        { clipPath: 'inset(0 50% 0 50%)' },
        { clipPath: 'inset(0 0% 0 0%)', duration: 0.4, ease: 'expo.out', delay: 0.2 }
      );
    }
  }, []);

  // Con resultado, la rueda cede el sitio; al cerrarlo, vuelve al centro
  useEffect(() => {
    if (firstResult.current) {
      firstResult.current = false;
      if (!hasResult) return;
    }
    const unit = unitRef.current;
    const label = labelRef.current;
    if (!unit) return;
    const still = reduced();
    if (hasResult) {
      gsap.to(unit, { x: '-13em', scale: 0.72, duration: still ? 0 : 0.55, ease: 'power3.inOut', overwrite: 'auto' });
      if (label) gsap.to(label, { opacity: 0, duration: 0.15, overwrite: 'auto' });
    } else {
      gsap.to(unit, { x: 0, scale: 1, opacity: 1, duration: still ? 0 : 0.4, ease: 'expo.out', overwrite: 'auto' });
      if (label) gsap.to(label, { opacity: 1, duration: 0.2, overwrite: 'auto' });
    }
  }, [hasResult]);

  return (
    <div className="ovl-fit">
      <div className="ovl rl" data-ovl-theme={settings.style} data-studio={isStudio ? '' : undefined}>
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

          <div ref={labelRef} className="ovl-plate rl-label">
            <b className="ovl-caps">{settings.title || 'Ruleta de castigos'}</b>
            {isSpinning && activeUser && <span>gira @{activeUser}</span>}
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
