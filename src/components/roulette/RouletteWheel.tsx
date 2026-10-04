/**
 * src/components/roulette/RouletteWheel.tsx
 *
 * Rueda de la Ruleta de Castigos. Dibujo plano en SVG, en el mismo lenguaje que
 * el resto de capas: aro mate, segmentos de color liso y texto legible.
 *
 * El movimiento es el de siempre: giro con desaceleración, sonido de cada
 * clavija, aguja que cede al pasar y un pequeño retroceso al clavarse. Al
 * detenerse, los segmentos que no ganaron se apagan.
 */

import React, { useEffect, useRef, useMemo } from 'react';
import gsap from 'gsap';
import {
  RouletteSegment,
  describeArc,
  polarToCartesian,
  RouletteStyle,
} from '../../types/roulette';
import { inkFor } from '../../utils/appearance';
import '../../styles/ruleta.css';
import { playWheelTick, playWheelFanfare, playWheelWhoosh } from '../../utils/rouletteAudio';

/** Aro, línea y marca (clavijas, eje y aguja) de cada tema. */
const THEMES: Record<RouletteStyle, { ring: string; line: string; mark: string }> = {
  cabina: { ring: '#1b1c1f', line: '#3a3c42', mark: '#efe9dc' },
  neon: { ring: '#0b0a14', line: '#00f5ff', mark: '#00f5ff' },
  cyber: { ring: '#0a0d14', line: '#ec4899', mark: '#ec4899' },
  gold: { ring: '#17130a', line: '#c9a227', mark: '#ffd700' },
};

export interface RouletteWheelProps {
  segments: RouletteSegment[];
  targetRotation: number;
  startRotation?: number;
  targetWinner?: RouletteSegment;
  isSpinning: boolean;
  spinDurationSec?: number;
  styleTheme?: RouletteStyle;
  soundEnabled?: boolean;
  tickVolume?: number;
  size?: number | string;
  onSpinComplete?: (winnerSegment: RouletteSegment, winnerIndex: number) => void;
}

export const RouletteWheel: React.FC<RouletteWheelProps> = ({
  segments,
  targetRotation,
  startRotation,
  targetWinner,
  isSpinning,
  spinDurationSec = 6.0,
  styleTheme = 'cabina',
  soundEnabled = true,
  tickVolume = 0.75,
  size = 380,
  onSpinComplete,
}) => {
  const wheelGroupRef = useRef<SVGGElement | null>(null);
  const pointerAssemblyRef = useRef<SVGGElement | null>(null);
  const pointerRef = useRef<SVGGElement | null>(null);
  const shockwaveRef = useRef<SVGCircleElement | null>(null);
  const pointerTweenRef = useRef<gsap.core.Tween | null>(null);
  const pointerAngleRef = useRef<{ angle: number }>({ angle: 0 });

  const lastSliceRef = useRef<number>(-1);
  const lastTickTimeRef = useRef<number>(0);
  const currentAngleRef = useRef<number>(startRotation ?? 0);

  const activeSegments = useMemo(
    () => segments.filter((s) => s.enabled),
    [segments]
  );

  const count = activeSegments.length;
  const sliceAngle = count > 0 ? 360 / count : 360;

  // Centro y radio del círculo SVG
  const cx = 220;
  const cy = 220;
  const radius = 184;

  // Sincronizar posición inicial en reposo asegurando giro exacto sobre eje (220, 220)
  useEffect(() => {
    if (!isSpinning && wheelGroupRef.current) {
      const rot = startRotation !== undefined ? startRotation : currentAngleRef.current;
      currentAngleRef.current = rot;
      wheelGroupRef.current.style.transform = '';
      wheelGroupRef.current.style.transformOrigin = '';
      wheelGroupRef.current.setAttribute('transform', `rotate(${rot}, 220, 220)`);
    }
  }, [startRotation, isSpinning]);

  // Animación física del giro con GSAP en coordenadas nativas SVG sobre eje (220, 220)
  useEffect(() => {
    if (!isSpinning || !wheelGroupRef.current || count === 0) return;

    const startRot = startRotation !== undefined ? startRotation : currentAngleRef.current;
    const endRot = targetRotation;

    lastSliceRef.current = Math.floor(startRot / sliceAngle);
    lastTickTimeRef.current = 0;

    // Sonido cinemático de viento al arrancar
    if (soundEnabled) {
      playWheelWhoosh(tickVolume * 0.8);
    }

    // Asegurar punto de partida exacto y limpiar cualquier CSS transform residual
    wheelGroupRef.current.style.transform = '';
    wheelGroupRef.current.style.transformOrigin = '';
    wheelGroupRef.current.setAttribute('transform', `rotate(${startRot}, 220, 220)`);

    if (pointerRef.current) {
      pointerRef.current.style.transform = '';
      pointerRef.current.style.transformOrigin = '';
      pointerRef.current.setAttribute('transform', 'rotate(0, 220, 22)');
    }

    const triggerPointerFlick = () => {
      if (!pointerRef.current) return;
      if (pointerTweenRef.current) {
        pointerTweenRef.current.kill();
      }
      const pObj = pointerAngleRef.current;
      pointerTweenRef.current = gsap.to(pObj, {
        angle: 14,
        duration: 0.032,
        ease: 'power1.out',
        onUpdate: () => {
          if (pointerRef.current) {
            pointerRef.current.setAttribute('transform', `rotate(${pObj.angle}, 220, 22)`);
          }
        },
        onComplete: () => {
          pointerTweenRef.current = gsap.to(pObj, {
            angle: 0,
            duration: 0.16,
            ease: 'elastic.out(2.0, 0.25)',
            onUpdate: () => {
              if (pointerRef.current) {
                pointerRef.current.setAttribute('transform', `rotate(${pObj.angle}, 220, 22)`);
              }
            },
            onComplete: () => {
              if (pointerRef.current) {
                pointerRef.current.setAttribute('transform', 'rotate(0, 220, 22)');
              }
            },
          });
        },
      });
    };

    const spinProxy = { angle: startRot };

    // Tween de rotación cinemática con desaceleración física uniforme 'power3.out'
    const spinTween = gsap.to(spinProxy, {
      angle: endRot,
      duration: spinDurationSec,
      ease: 'power3.out',
      onUpdate: () => {
        if (!wheelGroupRef.current) return;
        const rot = spinProxy.angle;
        currentAngleRef.current = rot;
        wheelGroupRef.current.setAttribute('transform', `rotate(${rot}, 220, 220)`);

        // Detección precisa de cruce de clavijas por índice de rebanada
        const currentSlice = Math.floor(rot / sliceAngle);
        if (currentSlice !== lastSliceRef.current) {
          lastSliceRef.current = currentSlice;

          // Sonido de tick regulado (máx ~28 ticks/s para evitar saturación y distorsión)
          const now = performance.now();
          if (now - lastTickTimeRef.current >= 34) {
            lastTickTimeRef.current = now;

            if (soundEnabled) {
              const progress = Math.max(0, Math.min(1, (rot - startRot) / (endRot - startRot || 1)));
              const pitch = 1.0 - progress * 0.28;
              playWheelTick(tickVolume, pitch);
            }
          }

          // Rebote táctil de la aguja con GSAP sobre su eje (220, 22)
          triggerPointerFlick();
        }
      },
      onComplete: () => {
        // Fijar ángulo final limpio
        const finalNormalized = ((endRot % 360) + 360) % 360;
        currentAngleRef.current = finalNormalized;

        if (pointerTweenRef.current) {
          pointerTweenRef.current.kill();
        }
        pointerAngleRef.current.angle = 0;
        if (pointerRef.current) {
          pointerRef.current.setAttribute('transform', 'rotate(0, 220, 22)');
        }

        // Micro-retroceso físico de inercia al clavar el perno (Emil Kowalski delight)
        if (wheelGroupRef.current) {
          const recoilProxy = { angle: endRot };
          gsap.to(recoilProxy, {
            angle: endRot - 1.2,
            duration: 0.12,
            yoyo: true,
            repeat: 1,
            ease: 'power2.inOut',
            onUpdate: () => {
              wheelGroupRef.current?.setAttribute(
                'transform',
                `rotate(${recoilProxy.angle}, 220, 220)`
              );
            },
            onComplete: () => {
              wheelGroupRef.current?.setAttribute(
                'transform',
                `rotate(${finalNormalized}, 220, 220)`
              );
            },
          });
        }

        // Shockwave de onda expansiva desde la aguja
        if (shockwaveRef.current) {
          gsap.fromTo(
            shockwaveRef.current,
            { attr: { r: 8 }, opacity: 0.9 },
            {
              attr: { r: 42 },
              opacity: 0,
              duration: 0.55,
              ease: 'power2.out',
            }
          );
        }

        // Segmento ganador: usar targetWinner si fue provisto o calcular con precisión
        let winner = targetWinner;
        let winnerIndex = -1;
        if (!winner) {
          const winningAngle = (360 - finalNormalized) % 360;
          winnerIndex = Math.floor((winningAngle + 0.001) / sliceAngle) % count;
          winner = activeSegments[winnerIndex] || activeSegments[0];
        } else {
          winnerIndex = activeSegments.findIndex((s) => s.id === winner?.id);
        }

        if (soundEnabled) {
          playWheelFanfare(tickVolume);
        }

        if (onSpinComplete) {
          onSpinComplete(winner, winnerIndex);
        }
      },
    });

    return () => {
      spinTween.kill();
      if (pointerTweenRef.current) {
        pointerTweenRef.current.kill();
      }
    };
  }, [
    isSpinning,
    targetRotation,
    startRotation,
    spinDurationSec,
    count,
    sliceAngle,
    soundEnabled,
    tickVolume,
    activeSegments,
    targetWinner,
    onSpinComplete,
  ]);

  // Paleta del aro según el tema: solo tres colores planos
  const theme = THEMES[styleTheme] || THEMES.cabina;
  const fontSize = count > 10 ? 12 : count > 6 ? 15 : 18;
  const maxChars = count > 10 ? 20 : count > 6 ? 19 : 18;
  const hasResult = Boolean(targetWinner) && !isSpinning;

  return (
    <div className="rw" style={{ width: size, height: size }}>
      <svg viewBox="0 0 440 440" className="rw-svg" aria-hidden="true">
        {/* Aro */}
        <circle cx={cx} cy={cy} r="199" fill={theme.ring} stroke={theme.line} strokeWidth="2" />

        {/* Plato giratorio: rota sobre el eje (220, 220) */}
        <g
          ref={wheelGroupRef}
          transform={`rotate(${startRotation !== undefined ? startRotation : currentAngleRef.current}, 220, 220)`}
        >
          {activeSegments.map((segment, index) => {
            const startAngle = index * sliceAngle;
            const endAngle = (index + 1) * sliceAngle;
            const midAngle = startAngle + sliceAngle / 2;
            // El texto corre a lo largo del radio, que es donde el segmento tiene sitio
            const textPos = polarToCartesian(cx, cy, radius * 0.58, midAngle);
            const pegPos = polarToCartesian(cx, cy, radius - 6, startAngle);
            const dimmed = hasResult && targetWinner?.id !== segment.id;
            const label = segment.text.length > maxChars ? `${segment.text.slice(0, maxChars - 1).trimEnd()}…` : segment.text;

            return (
              <g key={segment.id} className="rw-seg" data-dim={dimmed ? '' : undefined}>
                <path d={describeArc(cx, cy, radius, startAngle, endAngle)} fill={segment.color} stroke={theme.ring} strokeWidth="3" />
                <text
                  x={textPos.x}
                  y={textPos.y}
                  className="rw-text"
                  fill={inkFor(segment.color)}
                  fontSize={fontSize}
                  textAnchor="middle"
                  dominantBaseline="central"
                  transform={`rotate(${midAngle > 180 ? midAngle + 90 : midAngle - 90} ${textPos.x} ${textPos.y})`}
                >
                  {label}
                </text>
                {/* Clavija en el borde de cada segmento */}
                <circle cx={pegPos.x} cy={pegPos.y} r="3.4" fill={theme.mark} stroke={theme.ring} strokeWidth="1.5" />
              </g>
            );
          })}
        </g>

        {/* Eje */}
        <circle cx={cx} cy={cy} r="30" fill={theme.ring} stroke={theme.mark} strokeWidth="3" />
        <circle cx={cx} cy={cy} r="9" fill={theme.mark} />

        {/* Onda al clavarse la aguja */}
        <circle ref={shockwaveRef} cx="220" cy="48" r="8" fill="none" stroke={theme.mark} strokeWidth="3" opacity="0" />

        {/* Aguja: cede sobre su pivote (220, 22) al pasar cada clavija */}
        <g ref={pointerAssemblyRef}>
          <g ref={pointerRef} transform="rotate(0, 220, 22)">
            <path d="M 220 62 L 206 20 L 234 20 Z" fill={theme.mark} stroke={theme.ring} strokeWidth="3" strokeLinejoin="round" />
          </g>
          <circle cx="220" cy="22" r="7" fill={theme.ring} stroke={theme.mark} strokeWidth="2.5" />
        </g>
      </svg>
    </div>
  );
};
