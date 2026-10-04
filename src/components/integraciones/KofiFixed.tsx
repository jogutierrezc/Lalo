/**
 * src/components/integraciones/KofiFixed.tsx
 *
 * Capas fijas de Ko-fi, que se quedan en pantalla y se actualizan con cada
 * aviso: la meta de dinero (Barra o Depósito) y los últimos apoyos (Lista o
 * Cinta). Solo se animan transform y opacity.
 */

import React, { useEffect, useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { KOFI_KIND_NAMES, kofiMoney, type KofiRecent } from '../../../server/integrations/kofiRules';
import type { KofiGoalLayout, KofiRecentLayout } from '../../types/kofi';
import { reduced } from '../../utils/alertMotion';
import { BrandMark } from './BrandMark';
import '../../styles/ahora-suena.css';
import '../../styles/kofi.css';

const X = 'expo.out';

interface KofiGoalProps {
  layout: KofiGoalLayout;
  title: string;
  target: number;
  currency: string;
  total: number;
  color: string;
  /** Último aviso que sumó: cambia `id` con cada uno para enseñar «+cantidad». */
  plus?: { id: number; amount: number } | null;
}

export const KofiGoal: React.FC<KofiGoalProps> = ({ layout, title, target, currency, total, color, plus }) => {
  const fillRef = useRef<HTMLElement | null>(null);
  const numRef = useRef<HTMLDivElement | null>(null);
  const plusRef = useRef<HTMLSpanElement | null>(null);
  const shown = useRef({ v: total });
  const first = useRef(true);

  const safeTarget = Math.max(1, target);
  const ratio = Math.min(1, Math.max(0, total / safeTarget));

  useLayoutEffect(() => {
    const fill = fillRef.current;
    const num = numRef.current;
    if (!fill || !num) return;
    const bar = layout === 'barra';
    const to = { scaleX: bar ? ratio : 1, scaleY: bar ? 1 : ratio };
    const write = () => {
      num.textContent = `${kofiMoney(shown.current.v)} / ${kofiMoney(safeTarget)} ${currency}`;
    };
    gsap.killTweensOf([fill, shown.current]);
    if (first.current || reduced()) {
      gsap.set(fill, to);
      shown.current.v = total;
      write();
    } else {
      gsap.to(fill, { ...to, duration: 0.9, ease: X });
      gsap.to(shown.current, { v: total, duration: 0.9, ease: X, onUpdate: write });
    }
    first.current = false;
  }, [layout, ratio, total, safeTarget, currency]);

  useLayoutEffect(() => {
    const chip = plusRef.current;
    if (!chip || !plus) return;
    chip.textContent = `+${kofiMoney(plus.amount)}`;
    gsap.killTweensOf(chip);
    if (reduced()) {
      gsap.set(chip, { opacity: 1, y: 0 });
      gsap.to(chip, { opacity: 0, duration: 0.2, delay: 1.6 });
      return;
    }
    gsap.timeline().fromTo(chip, { opacity: 0, y: '.6em' }, { opacity: 1, y: 0, duration: 0.4, ease: X }).to(chip, { opacity: 0, y: '-.4em', duration: 0.2, ease: 'power2.in' }, 1.6);
  }, [plus]);

  useEffect(
    () => () => {
      gsap.killTweensOf([fillRef.current, plusRef.current, shown.current]);
    },
    []
  );

  return (
    <div className="kg" data-l={layout} style={{ '--ac': color } as React.CSSProperties}>
      <div className="kbg" />
      <div className="kg-t">{title || 'Meta'}</div>
      <div className="kg-n" ref={numRef} />
      <div className="kg-bar">
        <u ref={fillRef} />
      </div>
      <div className="kg-f">
        <b>{total >= safeTarget ? 'Meta cumplida' : `${Math.round(ratio * 100)}%`}</b>
        <BrandMark brand="kofi" className="kmark" />
      </div>
      <span className="kg-plus" ref={plusRef} aria-hidden="true" />
    </div>
  );
};

interface KofiRecentListProps {
  layout: KofiRecentLayout;
  items: KofiRecent[];
  color: string;
  /** Cambia cuando entra un apoyo nuevo: el primero entra y los demás se desplazan. */
  bump?: number;
}

export const KofiRecentList: React.FC<KofiRecentListProps> = ({ layout, items, color, bump = 0 }) => {
  const listRef = useRef<HTMLUListElement | null>(null);
  const lastBump = useRef(bump);
  const count = layout === 'lista' ? 4 : 3;
  const shown = items.slice(0, count);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || bump === lastBump.current) return;
    lastBump.current = bump;
    const rows = Array.from(list.children) as HTMLElement[];
    gsap.killTweensOf(rows);
    gsap.set(rows, { clearProps: 'transform,opacity' });
    if (reduced() || rows.length === 0) return;
    const [head, ...rest] = rows;
    const column = layout === 'lista';
    gsap.fromTo(head, column ? { opacity: 0, x: '1em' } : { opacity: 0, y: '.8em' }, { opacity: 1, x: 0, y: 0, duration: 0.5, ease: X });
    if (rest.length) gsap.fromTo(rest, column ? { y: '-1.9em' } : { x: '-6em' }, { x: 0, y: 0, duration: 0.5, ease: X });
  }, [bump, layout]);

  useEffect(
    () => () => {
      if (listRef.current) gsap.killTweensOf(Array.from(listRef.current.children));
    },
    []
  );

  return (
    <div className="kr" data-l={layout} style={{ '--ac': color } as React.CSSProperties}>
      <div className="kbg" />
      <div className="kr-h">
        <span>Últimos apoyos</span>
        <BrandMark brand="kofi" className="kmark" />
      </div>
      <ul ref={listRef}>
        {shown.map((item, index) => (
          <li key={`${bump}-${index}`}>
            <b>{item.name}</b>
            <span>
              {kofiMoney(item.amount)} · {KOFI_KIND_NAMES[item.kind]}
            </span>
          </li>
        ))}
        {shown.length === 0 && (
          <li>
            <span>Aún no hay apoyos</span>
          </li>
        )}
      </ul>
    </div>
  );
};
