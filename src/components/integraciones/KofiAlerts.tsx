/**
 * src/components/integraciones/KofiAlerts.tsx
 *
 * Alertas de Ko-fi tal como se ven en OBS y en el monitor del panel: los seis
 * diseños aprobados (Recibo, Rótulo, Sello, Burbuja, Cinta y Cartel), cada uno
 * con su entrada, su tiempo en pantalla y su salida más rápida.
 *
 * Van en cola: una cada vez, y las que no caben se descartan. Solo se animan
 * transform, opacity y clip-path. El relevo va con temporizadores, porque OBS
 * detiene las animaciones de las fuentes ocultas.
 */

import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { KOFI_KIND_NAMES, enqueueKofi, kofiMoney, type KofiKind } from '../../../server/integrations/kofiRules';
import type { KofiDesign, KofiSettings } from '../../types/kofi';
import { reduced } from '../../utils/alertMotion';
import { BrandMark } from './BrandMark';
import '../../styles/ahora-suena.css';
import '../../styles/kofi.css';

export interface KofiAlertItem {
  kind: KofiKind;
  big: boolean;
  /** Texto principal, ya con el nombre puesto. */
  title: string;
  amount: number;
  currency: string;
  tier: string;
  /** Vacío si es privado o lo retuvo el filtro. */
  message: string;
  /** Segundos en pantalla. */
  hold: number;
  /** Se llama cuando la alerta empieza a verse: ahí suena y habla. */
  onShow?: () => void;
}

export interface KofiAlertsHandle {
  /** Pone una alerta en la cola. false si la cola está llena. */
  push: (item: KofiAlertItem) => boolean;
  /** Enseña una alerta ya, sustituyendo a la que haya (vista previa del panel). */
  preview: (item: KofiAlertItem) => void;
  /** Retira la alerta y vacía la cola. */
  clear: () => void;
}

interface Parts {
  ka: HTMLElement;
  bg: HTMLElement;
  tag: HTMLElement;
  amt: HTMLElement;
  am: HTMLElement;
  cu: HTMLElement;
  name: HTMLElement;
  tier: HTMLElement;
  msg: HTMLElement;
  ms: HTMLElement;
  mark: HTMLElement;
  bu: HTMLElement;
}

type Timeline = gsap.core.Timeline;
const X = 'expo.out';
const P2 = 'power2.in';
const FULL = 'inset(0% 0% 0% 0%)';
const all = (a: Parts) => [a.tag, a.amt, a.name, a.tier, a.msg, a.mark];

const MOTION: Record<KofiDesign, { in(t: Timeline, a: Parts): void; out(t: Timeline, a: Parts): void }> = {
  recibo: {
    in(t, a) {
      t.set(a.ka, { autoAlpha: 1 })
        .fromTo(a.ka, { clipPath: 'inset(0% 0% 100% 0%)', y: '-1em' }, { clipPath: FULL, y: 0, duration: 0.7, ease: X }, 0)
        .fromTo(all(a), { opacity: 0, y: '-.4em' }, { opacity: 1, y: 0, duration: 0.4, ease: X, stagger: 0.05 }, 0.15);
    },
    out(t, a) {
      t.to(a.ka, { autoAlpha: 0, y: '-1.2em', duration: 0.2, ease: P2 });
    },
  },
  rotulo: {
    in(t, a) {
      t.set(a.ka, { autoAlpha: 1 })
        .set([a.amt, a.name, a.tier, a.msg, a.mark], { opacity: 0 })
        .fromTo(a.tag, { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: FULL, duration: 0.35, ease: X }, 0)
        .fromTo(a.bg, { clipPath: 'inset(0% 100% 0% 0%)' }, { clipPath: FULL, duration: 0.6, ease: X }, 0.06)
        .fromTo([a.name, a.tier, a.msg], { x: '-1em' }, { x: 0, opacity: 1, duration: 0.5, ease: X, stagger: 0.06 }, 0.2)
        .fromTo(a.amt, { x: '1em' }, { x: 0, opacity: 1, duration: 0.5, ease: X }, 0.26)
        .to(a.mark, { opacity: 1, duration: 0.3 }, 0.4);
    },
    out(t, a) {
      t.to(all(a), { opacity: 0, duration: 0.12, ease: P2 }).fromTo(a.bg, { clipPath: FULL }, { clipPath: 'inset(0% 0% 0% 100%)', duration: 0.22, ease: P2 }, 0.05);
    },
  },
  sello: {
    in(t, a) {
      t.fromTo(a.ka, { autoAlpha: 0, scale: 1.7, rotation: -14 }, { autoAlpha: 1, scale: 1, rotation: -4, duration: 0.42, ease: X }).fromTo(
        [a.name, a.tier, a.msg, a.mark],
        { opacity: 0, y: '.4em' },
        { opacity: 1, y: 0, duration: 0.4, ease: X, stagger: 0.05 },
        0.22
      );
    },
    out(t, a) {
      t.to(a.ka, { autoAlpha: 0, scale: 0.9, duration: 0.18, ease: P2 });
    },
  },
  burbuja: {
    in(t, a) {
      t.fromTo(a.ka, { autoAlpha: 0, scale: 0.3, transformOrigin: '6% 100%' }, { autoAlpha: 1, scale: 1, transformOrigin: '6% 100%', duration: 0.5, ease: X }).fromTo(
        all(a),
        { opacity: 0, y: '.4em' },
        { opacity: 1, y: 0, duration: 0.4, ease: X, stagger: 0.04 },
        0.16
      );
    },
    out(t, a) {
      t.to(a.ka, { autoAlpha: 0, scale: 0.85, y: '.5em', duration: 0.18, ease: P2 });
    },
  },
  cinta: {
    in(t, a) {
      t.set(a.ka, { autoAlpha: 1 })
        .fromTo(a.ka, { clipPath: 'inset(0% 50% 0% 50%)' }, { clipPath: FULL, duration: 0.6, ease: X }, 0)
        .fromTo(all(a), { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power2.out', stagger: 0.04 }, 0.2);
    },
    out(t, a) {
      t.fromTo(a.ka, { clipPath: FULL }, { clipPath: 'inset(0% 50% 0% 50%)', duration: 0.22, ease: P2 });
    },
  },
  cartel: {
    in(t, a) {
      t.set(a.ka, { autoAlpha: 1 })
        .set(all(a), { opacity: 0 })
        .fromTo(a.bg, { scaleY: 0 }, { scaleY: 1, duration: 0.55, ease: X }, 0)
        .fromTo(a.amt, { scale: 0.6 }, { scale: 1, opacity: 1, duration: 0.6, ease: X }, 0.15)
        .fromTo([a.tag, a.name, a.tier, a.msg, a.mark], { y: '.9em' }, { y: 0, opacity: 1, duration: 0.5, ease: X, stagger: 0.07 }, 0.25);
    },
    out(t, a) {
      t.to(all(a), { opacity: 0, duration: 0.12, ease: P2 }).to(a.bg, { scaleY: 0, duration: 0.2, ease: P2 }, 0.06);
    },
  },
};

/** Tiempo de la salida más un respiro antes de la siguiente alerta. */
const GAP_MS = 450;

export const KofiAlerts = forwardRef<KofiAlertsHandle, { settings: KofiSettings }>(({ settings }, ref) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const parts = useRef<Parts | null>(null);
  const live = useRef(settings);
  live.current = settings;

  const queue = useRef<KofiAlertItem[]>([]);
  const busy = useRef(false);
  const visible = useRef(false);
  const tl = useRef<Timeline | null>(null);
  const barTw = useRef<gsap.core.Tween | null>(null);
  const marqueeTw = useRef<gsap.core.Tween | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const kill = () => {
    const a = parts.current;
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (gapTimer.current) clearTimeout(gapTimer.current);
    holdTimer.current = gapTimer.current = null;
    [tl.current, barTw.current, marqueeTw.current].forEach((item) => item?.kill());
    tl.current = barTw.current = marqueeTw.current = null;
    if (a) {
      gsap.set([a.ka, a.bg, a.ms, a.bu, ...all(a)], { clearProps: 'transform,opacity,clipPath' });
      a.msg.classList.remove('ell');
    }
  };

  const hide = (then?: () => void) => {
    const a = parts.current;
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    if (!a || !visible.current) return then?.();
    visible.current = false;
    [tl.current, barTw.current, marqueeTw.current].forEach((item) => item?.kill());
    tl.current = barTw.current = marqueeTw.current = null;
    if (reduced()) gsap.set(a.ka, { autoAlpha: 0 });
    else {
      tl.current = gsap.timeline({ onComplete: () => gsap.set(a.ka, { autoAlpha: 0 }) });
      MOTION[live.current.design].out(tl.current, a);
    }
    if (then) gapTimer.current = setTimeout(then, GAP_MS);
  };

  const show = (item: KofiAlertItem) => {
    const a = parts.current;
    if (!a) return;
    const s = live.current;
    kill();
    a.ka.dataset.ev = item.kind;
    if (item.big) a.ka.dataset.big = '1';
    else delete a.ka.dataset.big;
    a.tag.textContent = item.big ? 'Donación grande' : KOFI_KIND_NAMES[item.kind];
    a.am.textContent = kofiMoney(item.amount);
    a.cu.textContent = item.currency;
    a.name.textContent = item.title;
    a.tier.textContent = item.tier ? `Nivel ${item.tier}` : '';
    a.tier.hidden = !item.tier;
    a.ms.textContent = item.message;
    a.msg.hidden = !item.message;
    visible.current = true;
    if (reduced()) gsap.set(a.ka, { autoAlpha: 1, rotation: s.design === 'sello' ? -4 : 0 });
    else {
      tl.current = gsap.timeline();
      MOTION[s.design].in(tl.current, a);
      barTw.current = gsap.fromTo(a.bu, { scaleX: 1 }, { scaleX: 0, duration: item.hold, ease: 'none' });
    }
    // En «Cinta» el mensaje largo se desliza una vez mientras dura la alerta
    if (s.design === 'cinta' && item.message && s.showMessage) {
      const over = a.msg.scrollWidth - a.msg.clientWidth;
      if (over > 2) {
        if (reduced()) a.msg.classList.add('ell');
        else marqueeTw.current = gsap.to(a.ms, { x: -over, duration: Math.max(2, item.hold - 2.4), ease: 'sine.inOut', delay: 1.2 });
      }
    }
    item.onShow?.();
    holdTimer.current = setTimeout(() => hide(next.current), item.hold * 1000);
  };

  const next = useRef<() => void>(() => {});
  next.current = () => {
    const item = queue.current.shift();
    busy.current = Boolean(item);
    if (item) show(item);
  };

  useImperativeHandle(
    ref,
    () => ({
      push: (item) => {
        const before = queue.current.length;
        queue.current = enqueueKofi(queue.current, item);
        if (queue.current.length === before) return false;
        if (!busy.current) next.current();
        return true;
      },
      preview: (item) => {
        queue.current = [];
        busy.current = true;
        show(item);
      },
      clear: () => {
        queue.current = [];
        busy.current = false;
        if (gapTimer.current) clearTimeout(gapTimer.current);
        hide();
      },
    }),
    []
  );

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const q = (selector: string) => root.querySelector(selector) as HTMLElement;
    parts.current = {
      ka: root,
      bg: q('.ka-bg'),
      tag: q('.ka-tag'),
      amt: q('.ka-amt'),
      am: q('.ka-amt b'),
      cu: q('.ka-amt span'),
      name: q('.ka-name'),
      tier: q('.ka-tier'),
      msg: q('.ka-msg'),
      ms: q('.ka-msg span'),
      mark: q('.ka-mark'),
      bu: q('.ka-bar u'),
    };
    return () => {
      queue.current = [];
      kill();
    };
  }, []);

  // Sin esto, un cambio de diseño con una alerta a medias dejaría piezas a medio animar
  const design = settings.design;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!visible.current && parts.current) gsap.set(parts.current.ka, { clearProps: 'transform,clipPath' });
  }, [design]);

  const classes = ['ka', !settings.showAmount && 'no-amt', !settings.showMessage && 'no-msg'].filter(Boolean).join(' ');

  return (
    <div className="itg-ov">
      <div className="pos" data-p={settings.pos} style={{ fontSize: `${settings.size}%` }}>
        <div ref={rootRef} className={classes} data-k={settings.design} data-ev="don" style={{ '--ac': settings.color } as React.CSSProperties}>
          <div className="ka-bg" />
          <div className="ka-tag" />
          <div className="ka-amt">
            <b /> <span />
          </div>
          <div className="ka-name" />
          <div className="ka-tier" />
          <div className="ka-msg">
            <span />
          </div>
          <BrandMark brand="kofi" className="ka-mark" />
          <div className="ka-bar">
            <u />
          </div>
        </div>
      </div>
    </div>
  );
});

KofiAlerts.displayName = 'KofiAlerts';
