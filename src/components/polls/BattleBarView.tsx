/**
 * src/components/polls/BattleBarView.tsx
 *
 * Componente visual de la Batalla 1v1 con físicas fluidas de GSAP y diseño broadcast Impeccable.
 * Muestra el enfrentamiento de barras líquidas, choque central en el 'VS',
 * porcentajes tabulares de alta legibilidad y reloj de cuenta regresiva.
 */

import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { Swords, Flame, Trophy, Clock } from 'lucide-react';
import { PollOption, PollStyleTheme } from '../../types/polls';

interface BattleBarViewProps {
  title: string;
  optionA: PollOption;
  optionB: PollOption;
  theme?: PollStyleTheme;
  timeLeftSec: number;
  totalDurationSec: number;
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
  totalDurationSec,
  isActive,
  winner = null,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const barARef = useRef<HTMLDivElement | null>(null);
  const barBRef = useRef<HTMLDivElement | null>(null);
  const vsBadgeRef = useRef<HTMLDivElement | null>(null);
  const percentATextRef = useRef<HTMLSpanElement | null>(null);
  const percentBTextRef = useRef<HTMLSpanElement | null>(null);

  const totalVotes = optionA.votes + optionB.votes;
  const pctA = totalVotes > 0 ? Math.round((optionA.votes / totalVotes) * 100) : 50;
  const pctB = totalVotes > 0 ? 100 - pctA : 50;

  // Animación reactiva de las barras y choque con GSAP
  useEffect(() => {
    if (!containerRef.current) return;

    // Respetar prefers-reduced-motion
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = prefersReduced ? 0.05 : 0.45;
    const ease = prefersReduced ? 'none' : 'power2.out';

    if (barARef.current) {
      gsap.to(barARef.current, {
        width: `${pctA}%`,
        duration,
        ease,
        overwrite: 'auto',
      });
    }

    if (barBRef.current) {
      gsap.to(barBRef.current, {
        width: `${pctB}%`,
        duration,
        ease,
        overwrite: 'auto',
      });
    }

    // Sacudida elástica en el centro VS al alterarse los votos
    if (vsBadgeRef.current && totalVotes > 0 && !prefersReduced) {
      gsap.fromTo(
        vsBadgeRef.current,
        { scale: 1.25, rotate: pctA > pctB ? -8 : 8 },
        { scale: 1, rotate: 0, duration: 0.35, ease: 'back.out(2)', overwrite: 'auto' }
      );
    }
  }, [pctA, pctB, totalVotes]);

  // Animación del ganador al finalizar
  useEffect(() => {
    if (!winner || !containerRef.current) return;

    if (winner === 'A' && barARef.current) {
      gsap.to(barARef.current, { filter: 'brightness(1.4)', duration: 0.3, yoyo: true, repeat: 3 });
    } else if (winner === 'B' && barBRef.current) {
      gsap.to(barBRef.current, { filter: 'brightness(1.4)', duration: 0.3, yoyo: true, repeat: 3 });
    }
  }, [winner]);

  // Formato de tiempo mm:ss
  const mins = Math.floor(timeLeftSec / 60);
  const secs = timeLeftSec % 60;
  const timeFormatted = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

  return (
    <div
      ref={containerRef}
      className="relative flex w-full max-w-4xl flex-col items-center justify-center rounded-xl border border-slate-700/60 bg-slate-950/90 p-6 shadow-2xl backdrop-blur-md"
      style={{
        boxShadow:
          pctA > pctB
            ? '0 0 35px -8px rgba(0, 229, 255, 0.25)'
            : pctB > pctA
            ? '0 0 35px -8px rgba(255, 0, 85, 0.25)'
            : '0 0 25px -8px rgba(145, 70, 255, 0.2)',
      }}
    >
      {/* Título de la Batalla & Tally de Tiempo */}
      <div className="flex w-full flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-tr from-cyan-500 to-rose-500 p-1 text-slate-950 shadow-md">
            <Swords className="h-4 w-4" />
          </span>
          <div>
            <span className="block text-[10px] font-black tracking-widest text-slate-400 uppercase">
              BATALLA EN VIVO · CHAT EN DIRECTO
            </span>
            <h2 className="text-base font-extrabold tracking-tight text-white md:text-lg">
              {title}
            </h2>
          </div>
        </div>

        {/* Indicador de Temporizador */}
        <div className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/80 px-3.5 py-1">
          <Clock className={`h-3.5 w-3.5 ${timeLeftSec <= 10 && isActive ? 'animate-pulse text-amber-400' : 'text-slate-400'}`} />
          <span className="font-mono text-xs font-bold tabular-nums text-white">
            {timeFormatted}
          </span>
          {isActive ? (
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
          ) : (
            <span className="rounded bg-slate-800 px-1.5 py-0.2 text-[9px] font-bold text-slate-400">
              PAUSADO
            </span>
          )}
        </div>
      </div>

      {/* Cabecera de Opciones: Etiquetas y Totales de Votos */}
      <div className="mt-5 grid w-full grid-cols-2 items-end justify-between gap-4 px-1">
        {/* Opción A (Izquierda / Cyan) */}
        <div className="flex flex-col items-start">
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: optionA.color }} />
            <span className="text-xs font-black tracking-wider uppercase" style={{ color: optionA.color }}>
              OPCIÓN 1 · {optionA.sublabel || '!voto 1'}
            </span>
          </div>
          <h3 className="mt-0.5 text-lg font-black tracking-tight text-white md:text-xl line-clamp-1">
            {optionA.label}
          </h3>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              ref={percentATextRef}
              className="font-mono text-3xl font-black tabular-nums md:text-4xl"
              style={{ color: optionA.color }}
            >
              {pctA}%
            </span>
            <span className="text-xs font-semibold text-slate-400">
              ({optionA.votes} {optionA.votes === 1 ? 'voto' : 'votos'})
            </span>
          </div>
        </div>

        {/* Opción B (Derecha / Magenta) */}
        <div className="flex flex-col items-end text-right">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-black tracking-wider uppercase" style={{ color: optionB.color }}>
              OPCIÓN 2 · {optionB.sublabel || '!voto 2'}
            </span>
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: optionB.color }} />
          </div>
          <h3 className="mt-0.5 text-lg font-black tracking-tight text-white md:text-xl line-clamp-1">
            {optionB.label}
          </h3>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-xs font-semibold text-slate-400">
              ({optionB.votes} {optionB.votes === 1 ? 'voto' : 'votos'})
            </span>
            <span
              ref={percentBTextRef}
              className="font-mono text-3xl font-black tabular-nums md:text-4xl"
              style={{ color: optionB.color }}
            >
              {pctB}%
            </span>
          </div>
        </div>
      </div>

      {/* Barra de Colisión Central (Liquid Clash Bar) */}
      <div className="relative mt-4 flex h-10 w-full items-center overflow-hidden rounded-full border-2 border-slate-700/80 bg-slate-900 p-1 shadow-inner">
        {/* Barra Opción A (Izquierda) */}
        <div
          ref={barARef}
          className="relative h-full overflow-hidden rounded-l-full transition-all"
          style={{
            width: '50%',
            background: `linear-gradient(90deg, #0ea5e9 0%, ${optionA.color} 100%)`,
            boxShadow: `0 0 16px ${optionA.accentGlow}`,
          }}
        >
          {/* Brillo líquido interior */}
          <div className="absolute inset-0 bg-gradient-to-t from-white/0 via-white/20 to-white/0 opacity-40 animate-pulse" />
        </div>

        {/* Barra Opción B (Derecha) */}
        <div
          ref={barBRef}
          className="relative h-full overflow-hidden rounded-r-full transition-all"
          style={{
            width: '50%',
            background: `linear-gradient(90deg, ${optionB.color} 0%, #d946ef 100%)`,
            boxShadow: `0 0 16px ${optionB.accentGlow}`,
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-white/0 via-white/20 to-white/0 opacity-40 animate-pulse" />
        </div>

        {/* Emblema Central 'VS' con destellos de choque */}
        <div
          ref={vsBadgeRef}
          className="absolute left-1/2 top-1/2 z-10 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white/80 bg-slate-950 font-black text-white shadow-xl"
          style={{
            boxShadow: '0 0 20px rgba(255, 255, 255, 0.45)',
          }}
        >
          <span className="text-xs font-black tracking-tighter text-amber-300 drop-shadow">
            VS
          </span>
        </div>
      </div>

      {/* Banner de Victoria al finalizar */}
      {winner && (
        <div className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 py-2.5 px-4 animate-in fade-in zoom-in-95">
          <Trophy className="h-5 w-5 text-amber-400 animate-bounce" />
          <span className="text-sm font-black text-amber-300">
            {winner === 'TIE'
              ? '¡EMPATE TÉCNICO! Ambas opciones obtuvieron el mismo apoyo.'
              : winner === 'A'
              ? `¡VICTORIA PARA: ${optionA.label}!`
              : `¡VICTORIA PARA: ${optionB.label}!`}
          </span>
        </div>
      )}

      {/* Pie de instrucciones para el espectador */}
      <div className="mt-3 flex w-full items-center justify-between text-[11px] font-bold text-slate-400">
        <span>💬 Escribe <code className="rounded bg-slate-800 px-1 py-0.5 text-cyan-400">!voto 1</code> en el chat</span>
        <span className="flex items-center gap-1">
          <Flame className="h-3 w-3 text-rose-500" />
          <span>{totalVotes} {totalVotes === 1 ? 'voto emitido' : 'votos totales'}</span>
        </span>
        <span>Escribe <code className="rounded bg-slate-800 px-1 py-0.5 text-rose-400">!voto 2</code> en el chat 💬</span>
      </div>
    </div>
  );
};
