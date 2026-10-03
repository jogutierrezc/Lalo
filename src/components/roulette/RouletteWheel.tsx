/**
 * src/components/roulette/RouletteWheel.tsx
 *
 * Componente visual de la Ruleta de Castigos con renderizado SVG de alta definición,
 * física de inercia y desaceleración con GSAP, aguja mecánica flexible con rebote elástico,
 * chasis industrial Cabina Broadcast y sonidos mecánicos sintetizados.
 */

import React, { useEffect, useRef, useMemo } from 'react';
import gsap from 'gsap';
import {
  RouletteSegment,
  describeArc,
  polarToCartesian,
  RouletteStyle,
} from '../../types/roulette';
import { playWheelTick, playWheelFanfare } from '../../utils/rouletteAudio';

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
  size?: number;
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
  const pointerRef = useRef<SVGPolygonElement | null>(null);
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
  const radius = 185;

  // Sincronizar posición inicial en reposo sin depender de transform en JSX
  useEffect(() => {
    if (!isSpinning && wheelGroupRef.current) {
      const rot = startRotation !== undefined ? startRotation : currentAngleRef.current;
      currentAngleRef.current = rot;
      gsap.set(wheelGroupRef.current, {
        rotation: rot,
        transformOrigin: '220px 220px',
      });
    }
  }, [startRotation, isSpinning]);

  // Animación física del giro con GSAP directamente sobre el elemento SVG
  useEffect(() => {
    if (!isSpinning || !wheelGroupRef.current || count === 0) return;

    const startRot = startRotation !== undefined ? startRotation : currentAngleRef.current;
    const endRot = targetRotation;

    lastSliceRef.current = Math.floor(startRot / sliceAngle);
    lastTickTimeRef.current = 0;

    // Asegurar punto de partida exacto
    gsap.set(wheelGroupRef.current, {
      rotation: startRot,
      transformOrigin: '220px 220px',
    });

    // Tween de rotación directamente sobre wheelGroupRef.current
    // 'power3.out' genera una desaceleración física uniforme, elástica y natural (sin paradas abruptas ni tirones)
    const spinTween = gsap.to(wheelGroupRef.current, {
      rotation: endRot,
      duration: spinDurationSec,
      ease: 'power3.out',
      transformOrigin: '220px 220px',
      onUpdate: () => {
        if (!wheelGroupRef.current) return;
        const rot = (gsap.getProperty(wheelGroupRef.current, 'rotation') as number) || 0;
        currentAngleRef.current = rot;

        // Detección precisa de cruce de clavijas por índice de rebanada
        const currentSlice = Math.floor(rot / sliceAngle);
        if (currentSlice !== lastSliceRef.current) {
          lastSliceRef.current = currentSlice;

          // Sonido de tick regulado (máx ~28 ticks/s para evitar saturación y distorsión)
          const now = performance.now();
          if (now - lastTickTimeRef.current >= 35) {
            lastTickTimeRef.current = now;

            if (soundEnabled) {
              const progress = Math.max(0, Math.min(1, (rot - startRot) / (endRot - startRot || 1)));
              const pitch = 1.0 - progress * 0.3;
              playWheelTick(tickVolume, pitch);
            }
          }

          // Rebote táctil de la aguja con GSAP (hacia la derecha en sentido de giro, luego retorno elástico)
          if (pointerRef.current) {
            gsap.to(pointerRef.current, {
              rotation: 14,
              duration: 0.04,
              ease: 'power1.out',
              overwrite: 'auto',
              transformOrigin: '220px 24px',
              onComplete: () => {
                if (pointerRef.current) {
                  gsap.to(pointerRef.current, {
                    rotation: 0,
                    duration: 0.12,
                    ease: 'elastic.out(1.8, 0.3)',
                    overwrite: 'auto',
                    transformOrigin: '220px 24px',
                  });
                }
              },
            });
          }
        }
      },
      onComplete: () => {
        // Fijar ángulo final limpio
        const finalNormalized = ((endRot % 360) + 360) % 360;
        currentAngleRef.current = finalNormalized;

        if (pointerRef.current) {
          gsap.set(pointerRef.current, { rotation: 0, transformOrigin: '220px 24px' });
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

  // Color del chasis según el tema
  const themeBezelColor =
    styleTheme === 'neon'
      ? '#00f5ff'
      : styleTheme === 'gold'
      ? '#ffd700'
      : styleTheme === 'cyber'
      ? '#ec4899'
      : '#9146ff';

  return (
    <div
      className="relative flex items-center justify-center select-none"
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 440 440"
        className="h-full w-full drop-shadow-2xl overflow-visible"
      >
        <defs>
          {/* Sombras y degradados de bisel */}
          <radialGradient id="hubGrad" cx="40%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.4" />
            <stop offset="50%" stopColor="#222530" />
            <stop offset="100%" stopColor="#0d0e12" />
          </radialGradient>

          <linearGradient id="bezelGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#2c303e" />
            <stop offset="50%" stopColor="#12141a" />
            <stop offset="100%" stopColor="#2c303e" />
          </linearGradient>

          <filter id="glowFilter" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Chasis exterior / Bisel de hardware Cabina */}
        <circle
          cx={cx}
          cy={cy}
          r="215"
          fill="url(#bezelGrad)"
          stroke="#090a0d"
          strokeWidth="6"
        />

        {/* Anillo de LEDs decorativos perimetrales */}
        <circle
          cx={cx}
          cy={cy}
          r="202"
          fill="none"
          stroke={themeBezelColor}
          strokeWidth="2.5"
          strokeDasharray="4 8"
          opacity="0.8"
          filter="url(#glowFilter)"
        />

        {/* GRUPO GIRATORIO DE LA RULETA (controlado por GSAP) */}
        <g ref={wheelGroupRef}>
          {/* Rebanadas / Segmentos */}
          {activeSegments.map((segment, index) => {
            const startAngle = index * sliceAngle;
            const endAngle = (index + 1) * sliceAngle;
            const arcPath = describeArc(cx, cy, radius, startAngle, endAngle);

            // Posición y ángulo para el texto del segmento
            const midAngle = startAngle + sliceAngle / 2;
            const textPos = polarToCartesian(cx, cy, radius * 0.65, midAngle);

            return (
              <g key={segment.id}>
                {/* Cuña de color */}
                <path
                  d={arcPath}
                  fill={segment.color}
                  stroke="#0f1117"
                  strokeWidth="2"
                  className="transition-colors"
                />

                {/* Línea perimetral de contraste */}
                <path
                  d={describeArc(cx, cy, radius - 4, startAngle + 0.5, endAngle - 0.5)}
                  fill="none"
                  stroke="#ffffff"
                  strokeOpacity="0.15"
                  strokeWidth="1"
                />

                {/* Texto del castigo/reto orientado radialmente */}
                <text
                  x={textPos.x}
                  y={textPos.y}
                  fill={segment.textColor || '#ffffff'}
                  fontSize={count > 8 ? 10.5 : 12.5}
                  fontWeight="800"
                  fontFamily="system-ui, sans-serif"
                  textAnchor="middle"
                  dominantBaseline="central"
                  transform={`rotate(${midAngle + (midAngle > 90 && midAngle < 270 ? 180 : 0)} ${textPos.x} ${textPos.y})`}
                  style={{
                    textShadow: '0 1px 3px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.9)',
                    letterSpacing: '-0.02em',
                  }}
                >
                  {segment.text.length > 20
                    ? `${segment.text.slice(0, 18)}...`
                    : segment.text}
                </text>

                {/* Perno / Poste metálico en el borde de la rebanada */}
                {(() => {
                  const pegPos = polarToCartesian(cx, cy, radius - 6, startAngle);
                  return (
                    <circle
                      cx={pegPos.x}
                      cy={pegPos.y}
                      r="3.5"
                      fill="#ffffff"
                      stroke="#1e222d"
                      strokeWidth="1.5"
                      filter="url(#glowFilter)"
                    />
                  );
                })()}
              </g>
            );
          })}

          {/* Si no hay segmentos activos */}
          {activeSegments.length === 0 && (
            <circle cx={cx} cy={cy} r={radius} fill="#181a20" stroke="#333" />
          )}

          {/* Borde interior embellecedor */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke="#ffffff"
            strokeOpacity="0.2"
            strokeWidth="2"
          />
        </g>

        {/* Eje Central Metálico (Hub / Corona Central) */}
        <circle cx={cx} cy={cy} r="42" fill="#0b0c10" stroke="#252936" strokeWidth="4" />
        <circle cx={cx} cy={cy} r="34" fill="url(#hubGrad)" />
        <circle
          cx={cx}
          cy={cy}
          r="26"
          fill="none"
          stroke={themeBezelColor}
          strokeWidth="2"
          opacity="0.8"
        />

        {/* Icono central de Cabina */}
        <circle cx={cx} cy={cy} r="10" fill={themeBezelColor} opacity="0.9" />
        <circle cx={cx} cy={cy} r="4" fill="#ffffff" />

        {/* PUNTERO / AGUJA MECÁNICA SUPERIOR (flipper indicador) */}
        <g id="pointer-assembly">
          {/* Sombra de la aguja */}
          <polygon
            points="220,54 208,22 232,22"
            fill="rgba(0, 0, 0, 0.6)"
            transform="translate(0, 3)"
          />

          {/* Aguja roja brillante con borde metálico */}
          <polygon
            ref={pointerRef}
            points="220,54 208,22 232,22"
            fill="#ff2d46"
            stroke="#ffffff"
            strokeWidth="2.5"
            strokeLinejoin="round"
            style={{
              filter: 'drop-shadow(0 2px 5px rgba(255, 45, 70, 0.6))',
            }}
          />

          {/* Pivote de la aguja */}
          <circle
            cx="220"
            cy="24"
            r="8"
            fill="#12141a"
            stroke="#ffffff"
            strokeWidth="2"
          />
          <circle cx="220" cy="24" r="3.5" fill="#ffd700" />
        </g>
      </svg>
    </div>
  );
};
