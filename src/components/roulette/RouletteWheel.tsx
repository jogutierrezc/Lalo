/**
 * src/components/roulette/RouletteWheel.tsx
 *
 * Componente visual de la Ruleta de Castigos con renderizado cinemático SVG de alta definición,
 * física de inercia y desaceleración con GSAP, aguja mecánica flexible con rebote elástico,
 * chasis industrial Cabina Broadcast, LEDs perimetrales animados, shockwave de impacto
 * y síntesis de sonido físico. Diseñado bajo las directivas de Impeccable y Emil Kowalski.
 */

import React, { useEffect, useRef, useMemo } from 'react';
import gsap from 'gsap';
import {
  RouletteSegment,
  describeArc,
  polarToCartesian,
  RouletteStyle,
  CATEGORY_LABELS,
} from '../../types/roulette';
import { playWheelTick, playWheelFanfare, playWheelWhoosh } from '../../utils/rouletteAudio';

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
  const pointerAssemblyRef = useRef<SVGGElement | null>(null);
  const pointerRef = useRef<SVGGElement | null>(null);
  const shockwaveRef = useRef<SVGCircleElement | null>(null);
  const sparksRef = useRef<SVGGElement | null>(null);
  const ledsGroupRef = useRef<SVGGElement | null>(null);
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

  // Animación de LEDs perimetrales durante el giro
  useEffect(() => {
    if (!ledsGroupRef.current) return;
    const leds = ledsGroupRef.current.children;

    if (isSpinning) {
      // Persecución rápida de luces LED
      const tween = gsap.to(leds, {
        opacity: 1,
        fill: styleTheme === 'gold' ? '#fff6a9' : styleTheme === 'neon' ? '#00f5ff' : '#ff4d6d',
        stagger: {
          each: 0.04,
          repeat: -1,
          yoyo: true,
        },
        duration: 0.15,
        ease: 'power1.inOut',
      });
      return () => {
        tween.kill();
      };
    } else {
      // Reposo suave con respiración sutil
      gsap.to(leds, {
        opacity: 0.7,
        stagger: 0.03,
        duration: 0.6,
        ease: 'power2.out',
      });
    }
  }, [isSpinning, styleTheme]);

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
            { attr: { r: 6 }, opacity: 0.95 },
            {
              attr: { r: 42 },
              opacity: 0,
              duration: 0.55,
              ease: 'power2.out',
            }
          );
        }

        // Chispas de partículas emanando del puntero
        if (sparksRef.current) {
          Array.from(sparksRef.current.children).forEach((spark) => {
            gsap.fromTo(
              spark,
              { x: 0, y: 0, opacity: 1, scale: 1 },
              {
                x: gsap.utils.random(-35, 35),
                y: gsap.utils.random(5, 45),
                opacity: 0,
                scale: gsap.utils.random(0.3, 1.1),
                duration: 0.45,
                ease: 'power1.out',
              }
            );
          });
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

  // Generación de 28 LEDs perimetrales
  const perimetralLeds = useMemo(() => {
    const totalLeds = 28;
    const ledRadius = 205;
    return Array.from({ length: totalLeds }, (_, i) => {
      const angle = (i * 360) / totalLeds;
      const pos = polarToCartesian(cx, cy, ledRadius, angle);
      return { id: `led-${i}`, x: pos.x, y: pos.y, angle };
    });
  }, [cx, cy]);

  // Paleta de acento del chasis según el tema
  const themeBezelColor =
    styleTheme === 'neon'
      ? '#00f5ff'
      : styleTheme === 'gold'
      ? '#ffd700'
      : styleTheme === 'cyber'
      ? '#ec4899'
      : '#ff2d46';

  const themeBorderGradient =
    styleTheme === 'gold'
      ? ['#ffd700', '#b8860b', '#fff8dc', '#8b6508']
      : styleTheme === 'neon'
      ? ['#00f5ff', '#0077ff', '#7000ff', '#00f5ff']
      : styleTheme === 'cyber'
      ? ['#ff007f', '#7928ca', '#00f5ff', '#ff007f']
      : ['#3a3f50', '#1c1f28', '#2a2e3d', '#12141a'];

  return (
    <div
      className="relative flex items-center justify-center select-none"
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 440 440"
        className="h-full w-full drop-shadow-[0_20px_45px_rgba(0,0,0,0.85)] overflow-visible"
      >
        <defs>
          {/* Sombras y degradados de bisel 3D */}
          <radialGradient id="hubGrad" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.8" />
            <stop offset="25%" stopColor="#3b4252" />
            <stop offset="65%" stopColor="#1e222b" />
            <stop offset="100%" stopColor="#0a0c10" />
          </radialGradient>

          <radialGradient id="hubGoldGrad" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#fff8dc" stopOpacity="0.9" />
            <stop offset="35%" stopColor="#ffd700" />
            <stop offset="75%" stopColor="#b8860b" />
            <stop offset="100%" stopColor="#5c4308" />
          </radialGradient>

          {/* Degradado metálico perimetral exterior */}
          <linearGradient id="bezelOuterGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={themeBorderGradient[0]} />
            <stop offset="33%" stopColor={themeBorderGradient[1]} />
            <stop offset="66%" stopColor={themeBorderGradient[2]} />
            <stop offset="100%" stopColor={themeBorderGradient[3]} />
          </linearGradient>

          <radialGradient id="innerShadowGrad" cx="50%" cy="50%" r="50%">
            <stop offset="85%" stopColor="#000000" stopOpacity="0" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.65" />
          </radialGradient>

          {/* Filtros de Resplandor Glow */}
          <filter id="neonGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>

          <filter id="pegShadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" floodColor="#000000" floodOpacity="0.8" />
          </filter>

          <filter id="pointerShadow" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#000000" floodOpacity="0.75" />
          </filter>
        </defs>

        {/* 1. CHASIS EXTERIOR / BISEL INDUSTRIAL METÁLICO */}
        <circle
          cx={cx}
          cy={cy}
          r="217"
          fill="url(#bezelOuterGrad)"
          stroke="#050608"
          strokeWidth="4"
        />

        {/* Anillo de canal negro profundo donde asientan los LEDs */}
        <circle
          cx={cx}
          cy={cy}
          r="206"
          fill="#0c0e13"
          stroke="#1a1d26"
          strokeWidth="3"
        />

        {/* LEDs Perimetrales Animados */}
        <g ref={ledsGroupRef}>
          {perimetralLeds.map((led) => (
            <circle
              key={led.id}
              cx={led.x}
              cy={led.y}
              r="3.2"
              fill={themeBezelColor}
              opacity="0.85"
              filter="url(#neonGlow)"
            />
          ))}
        </g>

        {/* Borde interior biselado antes del plato giratorio */}
        <circle
          cx={cx}
          cy={cy}
          r="193"
          fill="#141720"
          stroke="#252a37"
          strokeWidth="2.5"
        />

        {/* 2. GRUPO GIRATORIO DE LA RULETA (controlado en rotación pura sobre eje 220, 220) */}
        <g
          ref={wheelGroupRef}
          transform={`rotate(${startRotation !== undefined ? startRotation : currentAngleRef.current}, 220, 220)`}
        >
          {/* Rebanadas / Segmentos */}
          {activeSegments.map((segment, index) => {
            const startAngle = index * sliceAngle;
            const endAngle = (index + 1) * sliceAngle;
            const arcPath = describeArc(cx, cy, radius, startAngle, endAngle);

            // Posición y ángulo para el texto del segmento
            const midAngle = startAngle + sliceAngle / 2;
            const textRadius = count > 10 ? radius * 0.68 : radius * 0.64;
            const textPos = polarToCartesian(cx, cy, textRadius, midAngle);

            // Icono de la categoría
            const catInfo = CATEGORY_LABELS[segment.category] || CATEGORY_LABELS.custom;
            const iconPos = polarToCartesian(cx, cy, radius * 0.86, midAngle);

            const isWinningSegment = targetWinner?.id === segment.id;

            return (
              <g key={segment.id} className="transition-opacity">
                {/* Cuña de color con gradiente de contraste */}
                <path
                  d={arcPath}
                  fill={segment.color}
                  stroke={isWinningSegment && !isSpinning ? '#ffffff' : '#0a0c10'}
                  strokeWidth={isWinningSegment && !isSpinning ? '3.5' : '2'}
                  className="transition-colors"
                />

                {/* Relieve luminoso en el borde perimetral de cada cuña */}
                <path
                  d={describeArc(cx, cy, radius - 2, startAngle + 0.3, endAngle - 0.3)}
                  fill="none"
                  stroke="#ffffff"
                  strokeOpacity="0.22"
                  strokeWidth="1.5"
                />

                {/* Sombreado radial sutil hacia el eje para dar volumen físico 3D */}
                <path
                  d={describeArc(cx, cy, radius * 0.45, startAngle, endAngle)}
                  fill="none"
                  stroke="#000000"
                  strokeOpacity="0.25"
                  strokeWidth={radius * 0.3}
                />

                {/* Icono de Categoría (Emoji) en el extremo de la cuña */}
                {count <= 14 && (
                  <text
                    x={iconPos.x}
                    y={iconPos.y}
                    fontSize={count > 8 ? 10 : 13}
                    textAnchor="middle"
                    dominantBaseline="central"
                    transform={`rotate(${midAngle + (midAngle > 90 && midAngle < 270 ? 180 : 0)} ${iconPos.x} ${iconPos.y})`}
                    style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8))' }}
                  >
                    {catInfo.icon || '🎯'}
                  </text>
                )}

                {/* Texto del castigo/reto orientado radialmente con doble sombra */}
                <text
                  x={textPos.x}
                  y={textPos.y}
                  fill={segment.textColor || '#ffffff'}
                  fontSize={count > 10 ? 10 : count > 6 ? 11.5 : 13}
                  fontWeight="800"
                  fontFamily="system-ui, -apple-system, sans-serif"
                  textAnchor="middle"
                  dominantBaseline="central"
                  transform={`rotate(${midAngle + (midAngle > 90 && midAngle < 270 ? 180 : 0)} ${textPos.x} ${textPos.y})`}
                  style={{
                    textShadow:
                      '0 1.5px 3px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,0.9)',
                    letterSpacing: '-0.02em',
                  }}
                >
                  {segment.text.length > 22
                    ? `${segment.text.slice(0, 20)}…`
                    : segment.text}
                </text>

                {/* Clavija / Perno metálico 3D en el borde exterior del segmento */}
                {(() => {
                  const pegPos = polarToCartesian(cx, cy, radius - 5, startAngle);
                  return (
                    <g filter="url(#pegShadow)">
                      {/* Sombra base */}
                      <circle cx={pegPos.x} cy={pegPos.y + 0.8} r="4.2" fill="#000000" opacity="0.6" />
                      {/* Cuerpo metálico cilíndrico */}
                      <circle
                        cx={pegPos.x}
                        cy={pegPos.y}
                        r="3.8"
                        fill={styleTheme === 'gold' ? '#ffd700' : '#e2e8f0'}
                        stroke="#1e222d"
                        strokeWidth="1.2"
                      />
                      {/* Reflejo blanco specular */}
                      <circle cx={pegPos.x - 1} cy={pegPos.y - 1} r="1.3" fill="#ffffff" opacity="0.9" />
                    </g>
                  );
                })()}
              </g>
            );
          })}

          {/* Sombra interior periférica para crear profundidad física de cúpula */}
          <circle cx={cx} cy={cy} r={radius} fill="url(#innerShadowGrad)" pointerEvents="none" />
        </g>

        {/* 3. EJE CENTRAL METÁLICO (Turbine Hub / Corona Central de Lujo) */}
        <g id="center-hub">
          {/* Sombra proyectada del eje sobre los segmentos */}
          <circle cx={cx} cy={cy + 3} r="44" fill="#000000" opacity="0.5" filter="url(#pegShadow)" />

          {/* Anillo exterior de acero oscuro */}
          <circle cx={cx} cy={cy} r="42" fill="#12141c" stroke="#2c3242" strokeWidth="3" />

          {/* Corona intermedia dorada o cromada */}
          <circle
            cx={cx}
            cy={cy}
            r="36"
            fill={styleTheme === 'gold' ? 'url(#hubGoldGrad)' : 'url(#hubGrad)'}
            stroke="#0a0c10"
            strokeWidth="1.5"
          />

          {/* Inset metálico rebajado */}
          <circle cx={cx} cy={cy} r="26" fill="#090b0e" stroke="#252b38" strokeWidth="2" />

          {/* Gema / Emblema central de la Suite con destello */}
          <circle
            cx={cx}
            cy={cy}
            r="16"
            fill={themeBezelColor}
            filter="url(#neonGlow)"
            opacity="0.9"
          />
          <circle cx={cx} cy={cy} r="10" fill="#ffffff" opacity="0.3" />
          <circle cx={cx - 3} cy={cy - 3} r="4" fill="#ffffff" opacity="0.85" />
        </g>

        {/* 4. SHOCKWAVE & PARTÍCULAS DE CHOQUE */}
        <circle
          ref={shockwaveRef}
          cx="220"
          cy="48"
          r="6"
          fill="none"
          stroke={themeBezelColor}
          strokeWidth="3"
          opacity="0"
        />

        <g ref={sparksRef}>
          {Array.from({ length: 8 }, (_, i) => (
            <circle
              key={i}
              cx="220"
              cy="48"
              r="2.5"
              fill={styleTheme === 'gold' ? '#ffd700' : '#ffffff'}
              opacity="0"
            />
          ))}
        </g>

        {/* 5. PUNTERO / AGUJA MECÁNICA AERODINÁMICA SUPERIOR (Flipper Indicador sobre eje 220, 22) */}
        <g id="pointer-assembly" ref={pointerAssemblyRef} filter="url(#pointerShadow)">
          {/* Flipper oscilante que gira de forma unificada sobre el eje (220, 22) */}
          <g ref={pointerRef} transform="rotate(0, 220, 22)">
            {/* Sombra de la aguja */}
            <path
              d="M 220 58 L 210 22 Q 220 16 230 22 Z"
              fill="rgba(0, 0, 0, 0.7)"
              transform="translate(0, 3)"
            />

            {/* Hoja de la aguja con doble bisel 3D */}
            <path
              d="M 220 58 L 209 22 Q 220 17 231 22 Z"
              fill="#ff1744"
              stroke="#ffffff"
              strokeWidth="2.2"
              strokeLinejoin="round"
              style={{
                filter: 'drop-shadow(0 2px 6px rgba(255, 23, 68, 0.7))',
              }}
            />

            {/* Bisel izquierdo brillante sobre la aguja */}
            <path
              d="M 220 58 L 209 22 Q 215 19 220 20 Z"
              fill="#ffffff"
              opacity="0.3"
              pointerEvents="none"
            />
          </g>

          {/* Pivote mecánico cromado superior (Eje fijo en 220, 22) */}
          <circle cx="220" cy="22" r="9" fill="#141822" stroke="#ffffff" strokeWidth="2" />
          <circle cx="220" cy="22" r="4.5" fill={themeBezelColor} />
          <circle cx="218.5" cy="20.5" r="1.8" fill="#ffffff" opacity="0.9" />
        </g>
      </svg>
    </div>
  );
};
