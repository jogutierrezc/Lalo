/**
 * src/components/polls/BattleBarView.tsx
 *
 * Componente visual de Batalla 1v1 con diseño cinemático de arena esports,
 * físicas fluidas GSAP, colisión de barras de energía con corte angular,
 * contador numérico animado con interpolación suave, shockwave de impacto y partículas de choque.
 * Diseñado bajo directivas de Impeccable y Emil Kowalski.
 */

import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { Swords, Flame, Trophy, Clock, Zap, Crown } from 'lucide-react';
import { PollOption } from '../../types/polls';

interface BattleBarViewProps {
  title: string;
  optionA: PollOption;
  optionB: PollOption;
  theme?: string;
  timeLeftSec: number;
  totalDurationSec?: number;
  isActive: boolean;
  winner?: 'A' | 'B' | 'TIE' | null;
  onClash?: () => void;
}

export const BattleBarView: React.FC<BattleBarViewProps> = ({
  title,
  optionA,
  optionB,
  timeLeftSec,
  totalDurationSec = 60,
  isActive,
  winner = null,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const barARef = useRef<HTMLDivElement | null>(null);
  const barBRef = useRef<HTMLDivElement | null>(null);
  const vsBadgeRef = useRef<HTMLDivElement | null>(null);
  const shockwaveRef = useRef<HTMLDivElement | null>(null);
  const sparksContainerRef = useRef<HTMLDivElement | null>(null);
  const percentATextRef = useRef<HTMLSpanElement | null>(null);
  const percentBTextRef = useRef<HTMLSpanElement | null>(null);
  const winnerCardRef = useRef<HTMLDivElement | null>(null);

  // Valores numéricos para interpolación continua (Rolling Numbers)
  const rollingA = useRef({ val: 50 });
  const rollingB = useRef({ val: 50 });

  const totalVotes = optionA.votes + optionB.votes;
  const targetPctA = totalVotes > 0 ? Math.round((optionA.votes / totalVotes) * 100) : 50;
  const targetPctB = totalVotes > 0 ? 100 - targetPctA : 50;

  const leader = optionA.votes > optionB.votes ? 'A' : optionB.votes > optionA.votes ? 'B' : 'TIE';
  const voteDiff = Math.abs(optionA.votes - optionB.votes);

  // 1. Animación GSAP de barras líquidas, números rodantes y shockwave de choque
  useEffect(() => {
    if (!containerRef.current) return;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = prefersReduced ? 0.05 : 0.5;
    const ease = prefersReduced ? 'none' : 'power2.out';

    // Animación de ancho de barra con GSAP
    if (barARef.current) {
      gsap.to(barARef.current, {
        width: `${targetPctA}%`,
        duration,
        ease,
        overwrite: 'auto',
      });
    }

    if (barBRef.current) {
      gsap.to(barBRef.current, {
        width: `${targetPctB}%`,
        duration,
        ease,
        overwrite: 'auto',
      });
    }

    // Interpolación suave de porcentajes (Rolling Numbers)
    gsap.to(rollingA.current, {
      val: targetPctA,
      duration,
      ease,
      onUpdate: () => {
        if (percentATextRef.current) {
          percentATextRef.current.innerText = `${Math.round(rollingA.current.val)}%`;
        }
      },
      overwrite: 'auto',
    });

    gsap.to(rollingB.current, {
      val: targetPctB,
      duration,
      ease,
      onUpdate: () => {
        if (percentBTextRef.current) {
          percentBTextRef.current.innerText = `${Math.round(rollingB.current.val)}%`;
        }
      },
      overwrite: 'auto',
    });

    // Choque sísmico y shockwave en el emblema VS ante cambios de votos
    if (vsBadgeRef.current && totalVotes > 0 && !prefersReduced) {
      const tl = gsap.timeline();

      // Sacudida angular del escudo
      tl.fromTo(
        vsBadgeRef.current,
        { scale: 1.35, rotate: targetPctA > targetPctB ? -14 : 14 },
        { scale: 1, rotate: 0, duration: 0.45, ease: 'elastic.out(1.4, 0.25)' }
      );

      // Onda expansiva de energía (Shockwave Ring)
      if (shockwaveRef.current) {
        gsap.fromTo(
          shockwaveRef.current,
          {
            scale: 0.8,
            opacity: 1,
            borderColor: targetPctA > targetPctB ? optionA.color : optionB.color,
          },
          {
            scale: 2.8,
            opacity: 0,
            duration: 0.55,
            ease: 'power2.out',
          }
        );
      }

      // Generación de chispas de partículas (Sparks)
      if (sparksContainerRef.current) {
        const sparks = sparksContainerRef.current.children;
        Array.from(sparks).forEach((spark) => {
          gsap.fromTo(
            spark,
            { x: 0, y: 0, opacity: 1, scale: gsap.utils.random(0.8, 1.4) },
            {
              x: gsap.utils.random(-45, 45),
              y: gsap.utils.random(-45, 45),
              opacity: 0,
              duration: 0.4,
              ease: 'power1.out',
            }
          );
        });
      }
    }
  }, [targetPctA, targetPctB, totalVotes, optionA.color, optionB.color]);

  // 2. Animación de revelación dramática del ganador al finalizar
  useEffect(() => {
    if (!winner || !containerRef.current) return;

    if (winnerCardRef.current) {
      gsap.fromTo(
        winnerCardRef.current,
        { scale: 0.88, opacity: 0, y: 15 },
        { scale: 1, opacity: 1, y: 0, duration: 0.5, ease: 'back.out(1.6)' }
      );
    }

    if (winner === 'A' && barARef.current) {
      gsap.to(barARef.current, {
        filter: 'brightness(1.5) drop-shadow(0 0 25px rgba(0,229,255,0.8))',
        duration: 0.4,
        yoyo: true,
        repeat: 3,
      });
      if (barBRef.current) {
        gsap.to(barBRef.current, { filter: 'grayscale(70%) brightness(0.4)', duration: 0.6 });
      }
    } else if (winner === 'B' && barBRef.current) {
      gsap.to(barBRef.current, {
        filter: 'brightness(1.5) drop-shadow(0 0 25px rgba(255,0,85,0.8))',
        duration: 0.4,
        yoyo: true,
        repeat: 3,
      });
      if (barARef.current) {
        gsap.to(barARef.current, { filter: 'grayscale(70%) brightness(0.4)', duration: 0.6 });
      }
    }
  }, [winner]);

  // Formato mm:ss para el reloj
  const mins = Math.floor(timeLeftSec / 60);
  const secs = timeLeftSec % 60;
  const timeFormatted = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

  // Cálculo del progreso circular para el reloj
  const progressRatio = totalDurationSec > 0 ? Math.max(0, Math.min(1, timeLeftSec / totalDurationSec)) : 0;
  const circleRadius = 14;
  const circleCircumference = 2 * Math.PI * circleRadius;
  const strokeDashoffset = circleCircumference * (1 - progressRatio);

  return (
    <div
      ref={containerRef}
      className="relative flex w-full max-w-4xl flex-col items-center justify-center rounded-2xl border-2 border-slate-800 bg-[#070b14]/95 p-6 md:p-8 shadow-2xl backdrop-blur-xl transition-all"
      style={{
        boxShadow:
          leader === 'A'
            ? '0 0 40px -6px rgba(0, 229, 255, 0.35), inset 0 1px 1px rgba(255,255,255,0.1)'
            : leader === 'B'
            ? '0 0 40px -6px rgba(255, 0, 85, 0.35), inset 0 1px 1px rgba(255,255,255,0.1)'
            : '0 0 30px -6px rgba(145, 70, 255, 0.25), inset 0 1px 1px rgba(255,255,255,0.1)',
      }}
    >
      {/* Esquinas angulares decorativas de arena esports */}
      <div className="pointer-events-none absolute -top-1 -left-1 h-4 w-4 border-t-2 border-l-2 border-cyan-400" />
      <div className="pointer-events-none absolute -top-1 -right-1 h-4 w-4 border-t-2 border-r-2 border-rose-500" />
      <div className="pointer-events-none absolute -bottom-1 -left-1 h-4 w-4 border-b-2 border-l-2 border-cyan-400" />
      <div className="pointer-events-none absolute -bottom-1 -right-1 h-4 w-4 border-b-2 border-r-2 border-rose-500" />

      {/* CABECERA SUPERIOR: Categoría, Título de la Batalla y Reloj SVG */}
      <div className="flex w-full flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-cyan-500 via-indigo-500 to-rose-500 p-0.5 shadow-lg shadow-cyan-500/20">
            <div className="flex h-full w-full items-center justify-center rounded-[10px] bg-slate-950 text-white">
              <Swords className="h-5 w-5 text-amber-400" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 rounded bg-slate-900 px-2 py-0.5 text-[9px] font-black tracking-widest text-cyan-400 uppercase border border-slate-800">
                <Zap className="h-2.5 w-2.5 fill-current" />
                <span>ARENA EN VIVO</span>
              </span>
              {isActive && (
                <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                  <span>VOTACIÓN ABIERTA</span>
                </span>
              )}
            </div>
            <h2 className="mt-0.5 text-base font-black tracking-tight text-white md:text-xl">
              {title}
            </h2>
          </div>
        </div>

        {/* Temporizador Circular SVG */}
        <div className="flex items-center gap-2.5 rounded-full border border-slate-800 bg-slate-900/90 px-3 py-1.5 shadow-inner">
          <div className="relative flex h-8 w-8 items-center justify-center">
            <svg className="h-8 w-8 -rotate-90 transform" viewBox="0 0 36 36">
              <circle
                cx="18"
                cy="18"
                r={circleRadius}
                fill="none"
                stroke="#1e293b"
                strokeWidth="3.5"
              />
              <circle
                cx="18"
                cy="18"
                r={circleRadius}
                fill="none"
                stroke={timeLeftSec <= 10 && isActive ? '#ef4444' : '#00e5ff'}
                strokeWidth="3.5"
                strokeDasharray={circleCircumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                className="transition-all duration-300"
              />
            </svg>
            <Clock className={`absolute h-3.5 w-3.5 ${timeLeftSec <= 10 && isActive ? 'text-rose-400 animate-bounce' : 'text-slate-400'}`} />
          </div>
          <div className="flex flex-col pr-1">
            <span className="text-[9px] font-bold tracking-wider text-slate-500 uppercase">TIEMPO</span>
            <span className="font-mono text-sm font-black tabular-nums text-white">
              {timeFormatted}
            </span>
          </div>
        </div>
      </div>

      {/* TARJETAS DE LUCHADORES / OPCIONES */}
      <div className="mt-6 grid w-full grid-cols-2 items-end justify-between gap-6 px-1">
        {/* Opción 1 (Izquierda / Cyan) */}
        <div className="relative flex flex-col items-start rounded-xl border border-cyan-500/20 bg-gradient-to-r from-cyan-950/30 to-transparent p-4">
          {leader === 'A' && totalVotes > 0 && (
            <div className="absolute -top-3 left-3 flex items-center gap-1 rounded-full border border-cyan-400 bg-cyan-950 px-2.5 py-0.5 text-[9px] font-black tracking-wider text-cyan-300 shadow-lg shadow-cyan-500/30 animate-pulse">
              <Crown className="h-3 w-3 text-amber-400 fill-current" />
              <span>LIDERANDO (+{voteDiff})</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="rounded bg-cyan-500/20 px-2 py-0.5 font-mono text-[10px] font-black text-cyan-300 border border-cyan-500/40">
              {optionA.sublabel || '!voto 1'}
            </span>
            <span className="text-xs font-bold text-slate-400 uppercase">OPCIÓN 1</span>
          </div>
          <h3 className="mt-1 text-lg font-black tracking-tight text-white md:text-2xl line-clamp-1">
            {optionA.label}
          </h3>
          <div className="mt-2 flex items-baseline gap-2">
            <span
              ref={percentATextRef}
              className="font-mono text-3xl font-black tabular-nums md:text-5xl text-cyan-400 drop-shadow-[0_0_12px_rgba(0,229,255,0.4)]"
            >
              {targetPctA}%
            </span>
            <span className="text-xs font-bold text-slate-400">
              ({optionA.votes} {optionA.votes === 1 ? 'voto' : 'votos'})
            </span>
          </div>
        </div>

        {/* Opción 2 (Derecha / Magenta) */}
        <div className="relative flex flex-col items-end rounded-xl border border-rose-500/20 bg-gradient-to-l from-rose-950/30 to-transparent p-4 text-right">
          {leader === 'B' && totalVotes > 0 && (
            <div className="absolute -top-3 right-3 flex items-center gap-1 rounded-full border border-rose-400 bg-rose-950 px-2.5 py-0.5 text-[9px] font-black tracking-wider text-rose-300 shadow-lg shadow-rose-500/30 animate-pulse">
              <Crown className="h-3 w-3 text-amber-400 fill-current" />
              <span>LIDERANDO (+{voteDiff})</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-400 uppercase">OPCIÓN 2</span>
            <span className="rounded bg-rose-500/20 px-2 py-0.5 font-mono text-[10px] font-black text-rose-300 border border-rose-500/40">
              {optionB.sublabel || '!voto 2'}
            </span>
          </div>
          <h3 className="mt-1 text-lg font-black tracking-tight text-white md:text-2xl line-clamp-1">
            {optionB.label}
          </h3>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xs font-bold text-slate-400">
              ({optionB.votes} {optionB.votes === 1 ? 'voto' : 'votos'})
            </span>
            <span
              ref={percentBTextRef}
              className="font-mono text-3xl font-black tabular-nums md:text-5xl text-rose-400 drop-shadow-[0_0_12px_rgba(255,0,85,0.4)]"
            >
              {targetPctB}%
            </span>
          </div>
        </div>
      </div>

      {/* BARRA LÍQUIDA CINEMÁTICA CON CORTE ANGULAR EN EL CENTRO */}
      <div className="relative mt-5 flex h-12 w-full items-center overflow-visible rounded-xl border-2 border-slate-700/80 bg-slate-950 p-1 shadow-inner">
        {/* Pista de fondo de chevron markers */}
        <div
          className="pointer-events-none absolute inset-0 opacity-10"
          style={{
            backgroundImage:
              'repeating-linear-gradient(45deg, #fff 0, #fff 2px, transparent 0, transparent 16px)',
          }}
        />

        {/* Barra Opción 1 (Izquierda / Cyan) */}
        <div
          ref={barARef}
          className="relative h-full overflow-hidden rounded-l-lg transition-all"
          style={{
            width: '50%',
            background: 'linear-gradient(90deg, #0284c7 0%, #00e5ff 100%)',
            boxShadow: '0 0 20px rgba(0, 229, 255, 0.45)',
          }}
        >
          {/* Shimmer animado interior */}
          <div
            className="absolute inset-0 opacity-30 animate-pulse"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.6) 50%, transparent 100%)',
            }}
          />
        </div>

        {/* Barra Opción 2 (Derecha / Magenta) */}
        <div
          ref={barBRef}
          className="relative h-full overflow-hidden rounded-r-lg transition-all"
          style={{
            width: '50%',
            background: 'linear-gradient(90deg, #ff0055 0%, #c026d3 100%)',
            boxShadow: '0 0 20px rgba(255, 0, 85, 0.45)',
          }}
        >
          <div
            className="absolute inset-0 opacity-30 animate-pulse"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.6) 50%, transparent 100%)',
            }}
          />
        </div>

        {/* EMBLEMA CENTRAL VS CON SHOCKWAVE Y PARTÍCULAS */}
        <div className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center">
          {/* Anillo de Onda Expansiva (Shockwave) */}
          <div
            ref={shockwaveRef}
            className="pointer-events-none absolute h-12 w-12 rounded-full border-2 opacity-0"
          />

          {/* Contenedor de Chispas (Sparks) */}
          <div ref={sparksContainerRef} className="pointer-events-none absolute">
            {[...Array(6)].map((_, i) => (
              <span
                key={i}
                className="absolute h-1.5 w-1.5 rounded-full bg-amber-300 opacity-0 shadow-md"
              />
            ))}
          </div>

          {/* Medallón 3D de Combate */}
          <div
            ref={vsBadgeRef}
            className="relative flex h-13 w-13 items-center justify-center rounded-full border-2 border-white/90 bg-gradient-to-br from-slate-900 via-slate-950 to-black shadow-2xl transition-transform"
            style={{
              boxShadow:
                leader === 'A'
                  ? '0 0 25px rgba(0, 229, 255, 0.6)'
                  : leader === 'B'
                  ? '0 0 25px rgba(255, 0, 85, 0.6)'
                  : '0 0 20px rgba(255, 255, 255, 0.5)',
            }}
          >
            <span className="text-sm font-black tracking-tighter text-amber-300 drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
              VS
            </span>
          </div>
        </div>
      </div>

      {/* BANNER DRAMÁTICO DE VICTORIA / CLÍMAX */}
      {winner && (
        <div
          ref={winnerCardRef}
          className="mt-6 flex w-full flex-col items-center justify-center rounded-xl border-2 border-amber-400 bg-gradient-to-r from-amber-950/70 via-slate-950/90 to-amber-950/70 py-3.5 px-6 shadow-2xl backdrop-blur-md"
        >
          <div className="flex items-center gap-2">
            <Trophy className="h-6 w-6 text-amber-400 animate-bounce" />
            <span className="text-base font-black uppercase tracking-wider text-amber-300 md:text-lg">
              {winner === 'TIE'
                ? '¡EMPATE ÉPICO! AMBAS OPCIONES IGUALADAS'
                : winner === 'A'
                ? `¡VICTORIA PARA: ${optionA.label}!`
                : `¡VICTORIA PARA: ${optionB.label}!`}
            </span>
            <Trophy className="h-6 w-6 text-amber-400 animate-bounce" />
          </div>
          <span className="mt-1 text-xs font-bold text-slate-300">
            {winner === 'TIE'
              ? 'El chat no llegó a un consenso decisivo'
              : `Finalizado con ${winner === 'A' ? targetPctA : targetPctB}% del apoyo popular`}
          </span>
        </div>
      )}

      {/* FOOTER: Instrucciones de voto táctil para espectadores */}
      <div className="mt-4 flex w-full items-center justify-between text-xs font-bold text-slate-400">
        <span className="flex items-center gap-1.5">
          <span>💬 Escribe</span>
          <code className="rounded bg-cyan-950 border border-cyan-500/40 px-2 py-0.5 font-mono text-cyan-300 shadow">
            !voto 1
          </code>
        </span>

        <span className="flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900/80 px-3 py-1 text-slate-300">
          <Flame className="h-3.5 w-3.5 text-rose-500 fill-current animate-pulse" />
          <span className="font-mono font-black">{totalVotes}</span>
          <span>{totalVotes === 1 ? 'voto total' : 'votos totales'}</span>
        </span>

        <span className="flex items-center gap-1.5">
          <span>Escribe</span>
          <code className="rounded bg-rose-950 border border-rose-500/40 px-2 py-0.5 font-mono text-rose-300 shadow">
            !voto 2
          </code>
          <span>💬</span>
        </span>
      </div>
    </div>
  );
};
