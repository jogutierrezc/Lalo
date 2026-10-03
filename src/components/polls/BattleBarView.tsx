/**
 * src/components/polls/BattleBarView.tsx
 *
 * Marcador de Batalla 1v1. Una sola placa que responde a cuatro preguntas:
 * quién gana, por cuánto, cuánto queda y cómo se vota.
 *
 * Movimiento:
 * - Un voto mueve la barra y el porcentaje, y deja «+N» sobre el comando de ese
 *   lado. Las ráfagas del chat se funden en un solo movimiento.
 * - El destello de la barra se reserva para el cambio de líder.
 * - En los últimos 10 s el reloj marca cada segundo.
 * - Al cerrar, el color ganador barre la barra y su nombre crece.
 *
 * Los temas (cabina, neon, esports, cyber, minimal) solo cambian tokens.
 */

import React, { useEffect, useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { PollOption, PollStyleTheme } from '../../types/polls';
import { inkFor } from '../../utils/appearance';
import { reduced } from '../../utils/alertMotion';

const EASE = 'expo.out';

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

/** «!voto 1 · Ranked Tryhard» → «Ranked Tryhard». El comando ya va en su propia pastilla. */
function sideNote(sublabel?: string): string {
  if (!sublabel) return '';
  const parts = sublabel.split('·');
  return parts.length > 1 ? parts.slice(1).join('·').trim() : sublabel.trim().startsWith('!') ? '' : sublabel.trim();
}

export const BattleBarView: React.FC<BattleBarViewProps> = ({
  title,
  optionA,
  optionB,
  theme = 'cabina',
  timeLeftSec,
  totalDurationSec = 60,
  isActive,
  winner = null,
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fillRef = useRef<HTMLDivElement | null>(null);
  const dividerRef = useRef<HTMLDivElement | null>(null);
  const flareRef = useRef<HTMLElement | null>(null);
  const pctARef = useRef<HTMLElement | null>(null);
  const pctBRef = useRef<HTMLElement | null>(null);
  const cmdARef = useRef<HTMLSpanElement | null>(null);
  const cmdBRef = useRef<HTMLSpanElement | null>(null);
  const plusARef = useRef<HTMLElement | null>(null);
  const plusBRef = useRef<HTMLElement | null>(null);
  const timeRef = useRef<HTMLSpanElement | null>(null);
  const clockRef = useRef<HTMLElement | null>(null);
  const questionRef = useRef<HTMLSpanElement | null>(null);

  const rolling = useRef({ v: 50 });
  const prev = useRef<{ a: number; b: number; leader: string } | null>(null);

  const totalVotes = optionA.votes + optionB.votes;
  const pctA = totalVotes > 0 ? Math.round((optionA.votes / totalVotes) * 100) : 50;
  const pctB = 100 - pctA;
  const leader = optionA.votes > optionB.votes ? 'A' : optionB.votes > optionA.votes ? 'B' : 'TIE';

  // Entrada de la placa
  useLayoutEffect(() => {
    if (!rootRef.current || reduced()) return;
    gsap.fromTo(rootRef.current, { y: '1.2em', opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: EASE });
  }, []);

  // Votos: barra, porcentajes y aviso del lado que recibe el voto
  useLayoutEffect(() => {
    const before = prev.current;
    prev.current = { a: optionA.votes, b: optionB.votes, leader };
    const write = (value: number) => {
      const a = Math.round(value);
      if (pctARef.current) pctARef.current.textContent = `${a}%`;
      if (pctBRef.current) pctBRef.current.textContent = `${100 - a}%`;
    };
    const still = reduced();

    if (!before || still) {
      gsap.killTweensOf([fillRef.current, dividerRef.current, rolling.current]);
      rolling.current.v = pctA;
      write(pctA);
      gsap.set(fillRef.current, { xPercent: pctA - 100 });
      gsap.set(dividerRef.current, { xPercent: pctA });
      return;
    }

    gsap.to(fillRef.current, { xPercent: pctA - 100, duration: 0.6, ease: EASE, overwrite: 'auto' });
    gsap.to(dividerRef.current, { xPercent: pctA, duration: 0.6, ease: EASE, overwrite: 'auto' });
    gsap.to(rolling.current, {
      v: pctA,
      duration: 0.6,
      ease: EASE,
      overwrite: true,
      onUpdate: () => write(rolling.current.v),
    });

    const bump = (gain: number, cmd: HTMLElement | null, plus: HTMLElement | null) => {
      if (gain <= 0 || !cmd || !plus) return;
      plus.textContent = `+${gain}`;
      gsap.fromTo(cmd, { scale: 0.94 }, { scale: 1, duration: 0.2, ease: 'power2.out', overwrite: true });
      gsap.fromTo(plus, { y: '0.2em', opacity: 1 }, { y: '-0.7em', opacity: 0, duration: 0.6, ease: 'power2.out', overwrite: true });
    };
    bump(optionA.votes - before.a, cmdARef.current, plusARef.current);
    bump(optionB.votes - before.b, cmdBRef.current, plusBRef.current);

    // Cambio de líder: el único destello de la batalla
    if (leader !== before.leader && leader !== 'TIE' && flareRef.current) {
      gsap.fromTo(flareRef.current, { scaleX: 7 }, { scaleX: 1, duration: 0.45, ease: EASE, overwrite: true });
    }
  }, [optionA.votes, optionB.votes, pctA, leader]);

  // Reloj: la línea inferior corre de forma continua y el tiempo marca los últimos 10 s
  const low = isActive && timeLeftSec <= 10;
  useEffect(() => {
    const ratio = totalDurationSec > 0 ? Math.max(0, Math.min(1, timeLeftSec / totalDurationSec)) : 0;
    if (clockRef.current) {
      gsap.to(clockRef.current, { scaleX: ratio, duration: isActive ? 1 : 0.2, ease: 'none', overwrite: true });
    }
    if (low && timeLeftSec > 0 && timeRef.current && !reduced()) {
      gsap.fromTo(timeRef.current, { scale: 1.14 }, { scale: 1, duration: 0.25, ease: 'power2.out' });
    }
  }, [timeLeftSec, totalDurationSec, isActive, low]);

  // Cierre: un único movimiento. Se revierte solo si la batalla se reinicia.
  useEffect(() => {
    const root = rootRef.current;
    if (!winner || !root) return;
    const still = reduced();
    const ctx = gsap.context(() => {
      gsap.to('.bt-foot, .bt-div, .bt-clock', { opacity: 0, duration: 0.2 });
      if (questionRef.current && !still) {
        gsap.fromTo(
          questionRef.current,
          { clipPath: 'inset(0 100% 0 0)' },
          { clipPath: 'inset(0 0% 0 0)', duration: 0.45, ease: EASE, delay: 0.15 }
        );
      }
      if (winner === 'TIE') return;
      const side = winner === 'A' ? 'a' : 'b';
      const other = winner === 'A' ? 'b' : 'a';
      gsap.to('.bt-fill', { xPercent: winner === 'A' ? 0 : -100, duration: still ? 0 : 0.7, ease: 'power3.inOut' });
      gsap.to(`.bt-side[data-side="${other}"]`, { opacity: 0.3, duration: 0.3 });
      if (!still) {
        gsap.to(`.bt-side[data-side="${side}"]`, { scale: 1.12, duration: 0.5, ease: EASE, delay: 0.25 });
      }
    }, root);
    return () => ctx.revert();
  }, [winner]);

  const mins = Math.floor(timeLeftSec / 60);
  const secs = timeLeftSec % 60;
  const timeFormatted = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

  const headline = !winner
    ? title
    : winner === 'TIE'
    ? 'Empate'
    : `Gana ${winner === 'A' ? optionA.label : optionB.label} con el ${winner === 'A' ? pctA : pctB}%`;

  const noteA = sideNote(optionA.sublabel);
  const noteB = sideNote(optionB.sublabel);
  const trailing = winner ? null : leader === 'A' ? 'b' : leader === 'B' ? 'a' : null;

  return (
    <div className="ovl-fit">
      <div className="ovl">
        <div
          ref={rootRef}
          className="ovl-plate bt"
          data-ovl-theme={theme}
          style={
            {
              '--a': optionA.color,
              '--b': optionB.color,
              '--a-ink': inkFor(optionA.color),
              '--b-ink': inkFor(optionB.color),
            } as React.CSSProperties
          }
        >
          <div className="bt-top">
            <span ref={questionRef} className="bt-q ovl-caps" data-won={winner ? '' : undefined}>
              {headline}
            </span>
            {!winner && (
              <span ref={timeRef} className="bt-time ovl-mono" data-low={low ? '' : undefined}>
                {timeFormatted}
              </span>
            )}
          </div>

          <div className="bt-sides">
            <div className="bt-side" data-side="a" data-trail={trailing === 'a' ? '' : undefined}>
              <span className="bt-name" title={optionA.label}>
                {optionA.label}
              </span>
              <b ref={pctARef} className="bt-pct" />
            </div>
            <div className="bt-side" data-side="b" data-trail={trailing === 'b' ? '' : undefined}>
              <span className="bt-name" title={optionB.label}>
                {optionB.label}
              </span>
              <b ref={pctBRef} className="bt-pct" />
            </div>
          </div>

          <div className="bt-bar">
            <div ref={fillRef} className="bt-fill" />
            <div ref={dividerRef} className="bt-div">
              <i ref={flareRef} />
            </div>
          </div>

          <div className="bt-foot">
            <span>
              <span ref={cmdARef} className="bt-cmd" data-side="a">
                escribe <b className="ovl-mono">1</b>
                <em ref={plusARef} className="ovl-mono" aria-hidden="true" />
              </span>
              {noteA && <span className="bt-note">{noteA}</span>}
            </span>
            <span className="bt-tot">
              <b className="ovl-mono">{totalVotes}</b>&nbsp;{totalVotes === 1 ? 'voto' : 'votos'}
            </span>
            <span>
              {noteB && <span className="bt-note">{noteB}</span>}
              <span ref={cmdBRef} className="bt-cmd" data-side="b">
                <em ref={plusBRef} className="ovl-mono" aria-hidden="true" />
                escribe <b className="ovl-mono">2</b>
              </span>
            </span>
          </div>

          <i ref={clockRef} className="bt-clock" />
        </div>
      </div>
    </div>
  );
};
