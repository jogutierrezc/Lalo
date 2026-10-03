/**
 * src/components/polls/BattleBarView.tsx
 *
 * Componente visual de Batalla 1v1 con soporte para 5 temas cinemáticos:
 * - Cabina: Rackmount de máster de televisión con tally LED «AL AIRE», vúmetros analógicos y telemetría broadcast.
 * - Neon: Tubos de neón láser, scanlines CRT retro, resplandor difuso cian/magenta y estética arcade 80s.
 * - Esports: Chasis de fibra de carbono, cortes angulares 45°, corona de campeonato y partículas de choque sísmico.
 * - Cyber: Matriz futurista con retículas de apuntado, bloques de datos segmentados y telemetría digital.
 * - Minimal: Vidrio esmerilado flotante ultra refinado, tipografía suiza limpia y gradientes líquidos sutiles.
 *
 * Animaciones fluidas GSAP (interpolación de porcentajes, shockwave sísmica, barras líquidas y revelación de victoria).
 * Diseñado bajo directivas de Impeccable y Emil Kowalski.
 */

import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';
import {
  Swords,
  Flame,
  Trophy,
  Clock,
  Zap,
  Crown,
  Radio,
  Sparkles,
  Activity,
  Terminal,
} from 'lucide-react';
import { PollOption, PollStyleTheme } from '../../types/polls';

interface BattleBarViewProps {
  title: string;
  optionA: PollOption;
  optionB: PollOption;
  theme?: PollStyleTheme | string;
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
  theme = 'esports',
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
  const vuMeterRef = useRef<HTMLDivElement | null>(null);

  // Valores numéricos para interpolación continua (Rolling Numbers)
  const rollingA = useRef({ val: 50 });
  const rollingB = useRef({ val: 50 });

  const totalVotes = optionA.votes + optionB.votes;
  const targetPctA = totalVotes > 0 ? Math.round((optionA.votes / totalVotes) * 100) : 50;
  const targetPctB = totalVotes > 0 ? 100 - targetPctA : 50;

  const leader = optionA.votes > optionB.votes ? 'A' : optionB.votes > optionA.votes ? 'B' : 'TIE';
  const voteDiff = Math.abs(optionA.votes - optionB.votes);

  const activeTheme = (theme as PollStyleTheme) || 'esports';

  // 1. Animación GSAP de barras líquidas, números rodantes y shockwave de choque
  useEffect(() => {
    if (!containerRef.current) return;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = prefersReduced ? 0.05 : 0.45;
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

      // Sacudida angular y retroceso elástico del escudo
      tl.fromTo(
        vsBadgeRef.current,
        { scale: 1.35, rotate: targetPctA > targetPctB ? -14 : 14 },
        { scale: 1, rotate: 0, duration: 0.42, ease: 'elastic.out(1.4, 0.25)' }
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
            duration: 0.5,
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

  // 3. Vúmetro dinámico para el tema Cabina Broadcast
  useEffect(() => {
    if (activeTheme !== 'cabina' || !vuMeterRef.current || !isActive) return;
    const bars = vuMeterRef.current.querySelectorAll('.vu-led');
    const interval = setInterval(() => {
      bars.forEach((b) => {
        const active = Math.random() > 0.4;
        (b as HTMLElement).style.opacity = active ? '1' : '0.25';
      });
    }, 140);
    return () => clearInterval(interval);
  }, [activeTheme, isActive]);

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
      className={`relative flex w-full max-w-4xl flex-col items-center justify-center p-6 md:p-8 transition-all select-none ${
        activeTheme === 'cabina'
          ? 'rounded-2xl border-2 border-slate-700 bg-gradient-to-b from-[#10141e] via-[#090c12] to-[#06080c] shadow-2xl backdrop-blur-xl'
          : activeTheme === 'neon'
          ? 'rounded-2xl border-2 border-cyan-500/40 bg-[#030308]/95 shadow-[0_0_50px_rgba(0,240,255,0.2)] backdrop-blur-xl'
          : activeTheme === 'cyber'
          ? 'rounded-xl border border-emerald-500/40 bg-black/90 shadow-[0_0_35px_rgba(0,255,102,0.2)] backdrop-blur-xl'
          : activeTheme === 'minimal'
          ? 'rounded-3xl border border-white/10 bg-black/80 shadow-2xl backdrop-blur-2xl'
          : 'rounded-2xl border-2 border-slate-800 bg-[#070b14]/95 shadow-2xl backdrop-blur-xl'
      }`}
      style={{
        boxShadow:
          activeTheme === 'neon'
            ? leader === 'A'
              ? '0 0 45px -4px rgba(0, 240, 255, 0.45), inset 0 1px 0 rgba(255,255,255,0.1)'
              : leader === 'B'
              ? '0 0 45px -4px rgba(255, 0, 127, 0.45), inset 0 1px 0 rgba(255,255,255,0.1)'
              : '0 0 35px -4px rgba(0, 240, 255, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)'
            : leader === 'A'
            ? '0 0 40px -6px rgba(0, 229, 255, 0.35), inset 0 1px 1px rgba(255,255,255,0.1)'
            : leader === 'B'
            ? '0 0 40px -6px rgba(255, 0, 85, 0.35), inset 0 1px 1px rgba(255,255,255,0.1)'
            : '0 0 30px -6px rgba(145, 70, 255, 0.25), inset 0 1px 1px rgba(255,255,255,0.1)',
      }}
    >
      {/* 1. TEXTURAS DE FONDO SEGÚN TEMA */}
      {activeTheme === 'esports' && (
        <>
          {/* Esquinas angulares de arena esports */}
          <div className="pointer-events-none absolute -top-1 -left-1 h-4 w-4 border-t-2 border-l-2 border-cyan-400" />
          <div className="pointer-events-none absolute -top-1 -right-1 h-4 w-4 border-t-2 border-r-2 border-rose-500" />
          <div className="pointer-events-none absolute -bottom-1 -left-1 h-4 w-4 border-b-2 border-l-2 border-cyan-400" />
          <div className="pointer-events-none absolute -bottom-1 -right-1 h-4 w-4 border-b-2 border-r-2 border-rose-500" />
        </>
      )}

      {activeTheme === 'cabina' && (
        <>
          {/* Tornillos simulados en las 4 esquinas del rackmount broadcast */}
          <div className="pointer-events-none absolute top-2.5 left-2.5 flex h-3 w-3 items-center justify-center rounded-full border border-slate-600 bg-slate-800 text-[8px] font-black text-slate-500">
            +
          </div>
          <div className="pointer-events-none absolute top-2.5 right-2.5 flex h-3 w-3 items-center justify-center rounded-full border border-slate-600 bg-slate-800 text-[8px] font-black text-slate-500">
            +
          </div>
          <div className="pointer-events-none absolute bottom-2.5 left-2.5 flex h-3 w-3 items-center justify-center rounded-full border border-slate-600 bg-slate-800 text-[8px] font-black text-slate-500">
            +
          </div>
          <div className="pointer-events-none absolute bottom-2.5 right-2.5 flex h-3 w-3 items-center justify-center rounded-full border border-slate-600 bg-slate-800 text-[8px] font-black text-slate-500">
            +
          </div>
        </>
      )}

      {activeTheme === 'neon' && (
        /* Scanlines CRT retro */
        <div
          className="pointer-events-none absolute inset-0 rounded-2xl opacity-15"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.6) 3px)',
          }}
        />
      )}

      {activeTheme === 'cyber' && (
        <>
          {/* Retículas de apuntado táctico */}
          <span className="pointer-events-none absolute top-2 left-2 font-mono text-[10px] text-emerald-500/60 font-black">
            [+]
          </span>
          <span className="pointer-events-none absolute top-2 right-2 font-mono text-[10px] text-emerald-500/60 font-black">
            [+]
          </span>
          <span className="pointer-events-none absolute bottom-2 left-2 font-mono text-[10px] text-emerald-500/60 font-black">
            [+]
          </span>
          <span className="pointer-events-none absolute bottom-2 right-2 font-mono text-[10px] text-emerald-500/60 font-black">
            [+]
          </span>
        </>
      )}

      {/* 2. CABECERA SUPERIOR */}
      <div className="flex w-full flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div className="flex items-center gap-3">
          {/* Icono temático */}
          <div
            className={`relative flex h-10 w-10 items-center justify-center rounded-xl p-0.5 shadow-lg ${
              activeTheme === 'cabina'
                ? 'bg-slate-800 border border-slate-600'
                : activeTheme === 'neon'
                ? 'bg-gradient-to-tr from-cyan-400 via-fuchsia-500 to-rose-500 shadow-cyan-500/30'
                : activeTheme === 'cyber'
                ? 'bg-emerald-950 border border-emerald-500/50'
                : activeTheme === 'minimal'
                ? 'bg-white/10 border border-white/20'
                : 'bg-gradient-to-tr from-cyan-500 via-indigo-500 to-rose-500 shadow-cyan-500/20'
            }`}
          >
            <div className="flex h-full w-full items-center justify-center rounded-[10px] bg-slate-950 text-white">
              {activeTheme === 'cabina' ? (
                <Radio className="h-5 w-5 text-cyan-400" />
              ) : activeTheme === 'neon' ? (
                <Zap className="h-5 w-5 text-fuchsia-400 fill-current animate-pulse" />
              ) : activeTheme === 'cyber' ? (
                <Terminal className="h-5 w-5 text-emerald-400" />
              ) : activeTheme === 'minimal' ? (
                <Activity className="h-5 w-5 text-sky-400" />
              ) : (
                <Swords className="h-5 w-5 text-amber-400" />
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2">
              {/* Badge de Tally / Estado */}
              {activeTheme === 'cabina' ? (
                <span className="flex items-center gap-1.5 rounded bg-red-950/80 border border-red-500/50 px-2 py-0.5 font-mono text-[9px] font-black tracking-wider text-red-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-ping" />
                  <span>AL AIRE · MASTER CONTROL</span>
                </span>
              ) : activeTheme === 'neon' ? (
                <span className="flex items-center gap-1 rounded bg-fuchsia-950/80 border border-fuchsia-500/50 px-2 py-0.5 text-[9px] font-black tracking-wider text-fuchsia-300 drop-shadow-[0_0_8px_rgba(255,0,127,0.6)]">
                  <Sparkles className="h-2.5 w-2.5 text-fuchsia-400" />
                  <span>SYNTHWAVE LASER</span>
                </span>
              ) : activeTheme === 'cyber' ? (
                <span className="flex items-center gap-1 rounded bg-emerald-950/80 border border-emerald-500/50 px-2 py-0.5 font-mono text-[9px] font-black tracking-wider text-emerald-400">
                  <Activity className="h-2.5 w-2.5 text-emerald-400" />
                  <span>FEED_LIVE // PROTOCOL</span>
                </span>
              ) : (
                <span className="flex items-center gap-1 rounded bg-slate-900 px-2 py-0.5 text-[9px] font-black tracking-widest text-cyan-400 uppercase border border-slate-800">
                  <Zap className="h-2.5 w-2.5 fill-current" />
                  <span>ARENA EN VIVO</span>
                </span>
              )}

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

        {/* Temporizador & Vúmetro (en tema Cabina) */}
        <div className="flex items-center gap-3">
          {/* Vúmetro de audio para Cabina Broadcast */}
          {activeTheme === 'cabina' && (
            <div
              ref={vuMeterRef}
              className="hidden sm:flex items-end gap-1 h-7 px-2 py-1 rounded bg-black/60 border border-slate-800"
              title="Monitor de Audio Broadcast"
            >
              {[0.4, 0.6, 0.8, 1.0, 0.7, 0.9, 0.5, 0.85].map((h, idx) => (
                <span
                  key={idx}
                  className="vu-led w-1 rounded-sm bg-gradient-to-t from-emerald-500 via-amber-400 to-rose-500 transition-opacity duration-100"
                  style={{ height: `${h * 100}%` }}
                />
              ))}
            </div>
          )}

          {/* Reloj SVG */}
          <div className="flex items-center gap-2.5 rounded-full border border-slate-800 bg-slate-900/90 px-3 py-1.5 shadow-inner">
            <div className="relative flex h-8 w-8 items-center justify-center">
              <svg className="h-8 w-8 -rotate-90 transform" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r={circleRadius} fill="none" stroke="#1e293b" strokeWidth="3.5" />
                <circle
                  cx="18"
                  cy="18"
                  r={circleRadius}
                  fill="none"
                  stroke={timeLeftSec <= 10 && isActive ? '#ef4444' : activeTheme === 'neon' ? '#ff007f' : '#00e5ff'}
                  strokeWidth="3.5"
                  strokeDasharray={circleCircumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                  className="transition-all duration-300"
                />
              </svg>
              <Clock
                className={`absolute h-3.5 w-3.5 ${
                  timeLeftSec <= 10 && isActive ? 'text-rose-400 animate-bounce' : 'text-slate-400'
                }`}
              />
            </div>
            <div className="flex flex-col pr-1">
              <span className="text-[9px] font-bold tracking-wider text-slate-500 uppercase">TIEMPO</span>
              <span className="font-mono text-sm font-black tabular-nums text-white">
                {timeFormatted}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. TARJETAS DE LUCHADORES / OPCIONES */}
      <div className="mt-6 grid w-full grid-cols-2 items-end justify-between gap-6 px-1">
        {/* Opción 1 (Izquierda) */}
        <div
          className={`relative flex flex-col items-start rounded-xl p-4 transition-all ${
            activeTheme === 'neon'
              ? 'border border-cyan-400/40 bg-gradient-to-r from-cyan-950/40 to-transparent shadow-[0_0_20px_rgba(0,240,255,0.15)]'
              : activeTheme === 'cyber'
              ? 'border border-emerald-500/30 bg-gradient-to-r from-emerald-950/30 to-transparent'
              : activeTheme === 'minimal'
              ? 'border border-white/10 bg-white/5 backdrop-blur-md'
              : 'border border-cyan-500/20 bg-gradient-to-r from-cyan-950/30 to-transparent'
          }`}
        >
          {leader === 'A' && totalVotes > 0 && (
            <div className="absolute -top-3 left-3 flex items-center gap-1 rounded-full border border-cyan-400 bg-cyan-950 px-2.5 py-0.5 text-[9px] font-black tracking-wider text-cyan-300 shadow-lg shadow-cyan-500/30 animate-pulse">
              <Crown className="h-3 w-3 text-amber-400 fill-current" />
              <span>LIDERANDO (+{voteDiff})</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span
              className={`rounded px-2 py-0.5 font-mono text-[10px] font-black border ${
                activeTheme === 'neon'
                  ? 'bg-cyan-500/30 text-cyan-200 border-cyan-400 shadow-[0_0_8px_rgba(0,240,255,0.4)]'
                  : activeTheme === 'cyber'
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
              }`}
            >
              {optionA.sublabel || '!voto 1 o 1'}
            </span>
            <span className="text-xs font-bold text-slate-400 uppercase">OPCIÓN 1</span>
          </div>
          <h3 className="mt-1 text-lg font-black tracking-tight text-white md:text-2xl line-clamp-1">
            {optionA.label}
          </h3>
          <div className="mt-2 flex items-baseline gap-2">
            <span
              ref={percentATextRef}
              className={`font-mono text-3xl font-black tabular-nums md:text-5xl ${
                activeTheme === 'neon'
                  ? 'text-cyan-300 drop-shadow-[0_0_16px_rgba(0,240,255,0.7)]'
                  : activeTheme === 'cyber'
                  ? 'text-emerald-400 font-mono drop-shadow-[0_0_12px_rgba(0,255,102,0.4)]'
                  : 'text-cyan-400 drop-shadow-[0_0_12px_rgba(0,229,255,0.4)]'
              }`}
            >
              {targetPctA}%
            </span>
            <span className="text-xs font-bold text-slate-400">
              ({optionA.votes} {optionA.votes === 1 ? 'voto' : 'votos'})
            </span>
          </div>
        </div>

        {/* Opción 2 (Derecha) */}
        <div
          className={`relative flex flex-col items-end rounded-xl p-4 text-right transition-all ${
            activeTheme === 'neon'
              ? 'border border-rose-500/40 bg-gradient-to-l from-rose-950/40 to-transparent shadow-[0_0_20px_rgba(255,0,127,0.15)]'
              : activeTheme === 'cyber'
              ? 'border border-amber-500/30 bg-gradient-to-l from-amber-950/30 to-transparent'
              : activeTheme === 'minimal'
              ? 'border border-white/10 bg-white/5 backdrop-blur-md'
              : 'border border-rose-500/20 bg-gradient-to-l from-rose-950/30 to-transparent'
          }`}
        >
          {leader === 'B' && totalVotes > 0 && (
            <div className="absolute -top-3 right-3 flex items-center gap-1 rounded-full border border-rose-400 bg-rose-950 px-2.5 py-0.5 text-[9px] font-black tracking-wider text-rose-300 shadow-lg shadow-rose-500/30 animate-pulse">
              <Crown className="h-3 w-3 text-amber-400 fill-current" />
              <span>LIDERANDO (+{voteDiff})</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-400 uppercase">OPCIÓN 2</span>
            <span
              className={`rounded px-2 py-0.5 font-mono text-[10px] font-black border ${
                activeTheme === 'neon'
                  ? 'bg-rose-500/30 text-rose-200 border-rose-400 shadow-[0_0_8px_rgba(255,0,127,0.4)]'
                  : activeTheme === 'cyber'
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
              }`}
            >
              {optionB.sublabel || '!voto 2 o 2'}
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
              className={`font-mono text-3xl font-black tabular-nums md:text-5xl ${
                activeTheme === 'neon'
                  ? 'text-rose-300 drop-shadow-[0_0_16px_rgba(255,0,127,0.7)]'
                  : activeTheme === 'cyber'
                  ? 'text-amber-400 font-mono drop-shadow-[0_0_12px_rgba(255,183,0,0.4)]'
                  : 'text-rose-400 drop-shadow-[0_0_12px_rgba(255,0,85,0.4)]'
              }`}
            >
              {targetPctB}%
            </span>
          </div>
        </div>
      </div>

      {/* 4. BARRA DE COLISIÓN DE ENERGÍA */}
      <div
        className={`relative mt-5 flex h-12 w-full items-center overflow-visible p-1 shadow-inner transition-all ${
          activeTheme === 'cabina'
            ? 'rounded-xl border-2 border-slate-700 bg-slate-950'
            : activeTheme === 'neon'
            ? 'rounded-full border-2 border-cyan-500/60 bg-black/90 shadow-[0_0_20px_rgba(0,240,255,0.3)]'
            : activeTheme === 'cyber'
            ? 'rounded-lg border-2 border-emerald-500/60 bg-black/95'
            : activeTheme === 'minimal'
            ? 'rounded-full border border-white/20 bg-black/50'
            : 'rounded-xl border-2 border-slate-700/80 bg-slate-950'
        }`}
      >
        {/* Pista de fondo de chevron markers */}
        <div
          className="pointer-events-none absolute inset-0 opacity-10"
          style={{
            backgroundImage:
              'repeating-linear-gradient(45deg, #fff 0, #fff 2px, transparent 0, transparent 16px)',
          }}
        />

        {/* Barra Opción 1 (Izquierda) */}
        <div
          ref={barARef}
          className={`relative h-full overflow-hidden transition-all ${
            activeTheme === 'minimal' || activeTheme === 'neon' ? 'rounded-l-full' : 'rounded-l-lg'
          }`}
          style={{
            width: '50%',
            background:
              activeTheme === 'neon'
                ? 'linear-gradient(90deg, #00b4d8 0%, #00f0ff 100%)'
                : activeTheme === 'cyber'
                ? 'linear-gradient(90deg, #059669 0%, #10b981 100%)'
                : 'linear-gradient(90deg, #0284c7 0%, #00e5ff 100%)',
            boxShadow:
              activeTheme === 'neon'
                ? '0 0 25px rgba(0, 240, 255, 0.6)'
                : '0 0 20px rgba(0, 229, 255, 0.45)',
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

        {/* Barra Opción 2 (Derecha) */}
        <div
          ref={barBRef}
          className={`relative h-full overflow-hidden transition-all ${
            activeTheme === 'minimal' || activeTheme === 'neon' ? 'rounded-r-full' : 'rounded-r-lg'
          }`}
          style={{
            width: '50%',
            background:
              activeTheme === 'neon'
                ? 'linear-gradient(90deg, #ff007f 0%, #c026d3 100%)'
                : activeTheme === 'cyber'
                ? 'linear-gradient(90deg, #f59e0b 0%, #d97706 100%)'
                : 'linear-gradient(90deg, #ff0055 0%, #c026d3 100%)',
            boxShadow:
              activeTheme === 'neon'
                ? '0 0 25px rgba(255, 0, 127, 0.6)'
                : '0 0 20px rgba(255, 0, 85, 0.45)',
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
              <span key={i} className="absolute h-1.5 w-1.5 rounded-full bg-amber-300 opacity-0 shadow-md" />
            ))}
          </div>

          {/* Medallón 3D de Combate */}
          <div
            ref={vsBadgeRef}
            className={`relative flex h-13 w-13 items-center justify-center rounded-full border-2 transition-transform ${
              activeTheme === 'cabina'
                ? 'border-amber-400/80 bg-gradient-to-br from-slate-900 to-black'
                : activeTheme === 'neon'
                ? 'border-fuchsia-400 bg-black shadow-[0_0_20px_rgba(255,0,127,0.7)]'
                : activeTheme === 'cyber'
                ? 'border-emerald-400 bg-black font-mono shadow-[0_0_15px_rgba(0,255,102,0.6)]'
                : activeTheme === 'minimal'
                ? 'border-white/40 bg-black/60 backdrop-blur-md'
                : 'border-white/90 bg-gradient-to-br from-slate-900 via-slate-950 to-black'
            }`}
            style={{
              boxShadow:
                activeTheme === 'neon'
                  ? '0 0 25px rgba(255, 0, 127, 0.7)'
                  : leader === 'A'
                  ? '0 0 25px rgba(0, 229, 255, 0.6)'
                  : leader === 'B'
                  ? '0 0 25px rgba(255, 0, 85, 0.6)'
                  : '0 0 20px rgba(255, 255, 255, 0.5)',
            }}
          >
            <span
              className={`text-sm font-black tracking-tighter ${
                activeTheme === 'neon'
                  ? 'text-fuchsia-300 drop-shadow-[0_0_6px_rgba(255,0,127,0.9)]'
                  : activeTheme === 'cyber'
                  ? 'text-emerald-400'
                  : 'text-amber-300 drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]'
              }`}
            >
              VS
            </span>
          </div>
        </div>
      </div>

      {/* 5. BANNER DRAMÁTICO DE VICTORIA / CLÍMAX */}
      {winner && (
        <div
          ref={winnerCardRef}
          className={`mt-6 flex w-full flex-col items-center justify-center rounded-xl border-2 py-3.5 px-6 shadow-2xl backdrop-blur-md ${
            activeTheme === 'neon'
              ? 'border-fuchsia-400 bg-gradient-to-r from-fuchsia-950/80 via-purple-950/90 to-fuchsia-950/80 shadow-[0_0_30px_rgba(255,0,127,0.5)]'
              : activeTheme === 'cyber'
              ? 'border-emerald-400 bg-gradient-to-r from-emerald-950/80 via-black to-emerald-950/80 font-mono shadow-[0_0_25px_rgba(0,255,102,0.4)]'
              : 'border-amber-400 bg-gradient-to-r from-amber-950/70 via-slate-950/90 to-amber-950/70'
          }`}
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

      {/* 6. FOOTER: Instrucciones de voto táctil para espectadores */}
      <div className="mt-4 flex w-full items-center justify-between text-xs font-bold text-slate-400">
        <span className="flex items-center gap-1.5">
          <span>💬 Escribe</span>
          <code
            className={`rounded px-2 py-0.5 font-mono shadow border ${
              activeTheme === 'neon'
                ? 'bg-cyan-950 border-cyan-400/60 text-cyan-300'
                : activeTheme === 'cyber'
                ? 'bg-emerald-950 border-emerald-500/50 text-emerald-300'
                : 'bg-cyan-950 border-cyan-500/40 text-cyan-300'
            }`}
          >
            1
          </code>
          <span>o</span>
          <code className="rounded bg-slate-900 border border-slate-700 px-1.5 py-0.5 font-mono text-slate-400">
            !1
          </code>
        </span>

        <span className="flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900/80 px-3 py-1 text-slate-300">
          <Flame className="h-3.5 w-3.5 text-rose-500 fill-current animate-pulse" />
          <span className="font-mono font-black">{totalVotes}</span>
          <span>{totalVotes === 1 ? 'voto total' : 'votos totales'}</span>
        </span>

        <span className="flex items-center gap-1.5">
          <span>Escribe</span>
          <code className="rounded bg-slate-900 border border-slate-700 px-1.5 py-0.5 font-mono text-slate-400">
            !2
          </code>
          <span>o</span>
          <code
            className={`rounded px-2 py-0.5 font-mono shadow border ${
              activeTheme === 'neon'
                ? 'bg-rose-950 border-rose-400/60 text-rose-300'
                : activeTheme === 'cyber'
                ? 'bg-amber-950 border-amber-500/50 text-amber-300'
                : 'bg-rose-950 border-rose-500/40 text-rose-300'
            }`}
          >
            2
          </code>
          <span>💬</span>
        </span>
      </div>
    </div>
  );
};
