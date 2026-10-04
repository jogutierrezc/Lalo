/**
 * src/components/integraciones/musicMotion.ts
 *
 * Movimiento de los seis diseños de «Ahora suena»: entrada (in), cambio de
 * canción (sw) y salida (out), tal como se aprobaron en la maqueta. Solo se
 * animan transform, opacity y clip-path; las entradas usan expo.out y las
 * salidas son más rápidas.
 *
 * La portada nunca se gira, se escala ni se recorta por su cuenta: solo cambia
 * su opacidad o se mueve con la pieza entera. Lo que gira en «Disco» es un
 * disco dibujado por Lalo.
 */

import type { MusicDesign } from '../../types/music';

export interface MusicParts {
  np: HTMLElement;
  bg: HTMLElement;
  disc: HTMLElement;
  cov: HTMLElement;
  tx: HTMLElement;
  kick: HTMLElement;
  t: HTMLElement;
  a: HTMLElement;
  al: HTMLElement;
  pr: HTMLElement;
  side: HTMLElement;
  wipe: HTMLElement;
}

type Timeline = gsap.core.Timeline;
interface DesignMotion {
  in(t: Timeline, e: MusicParts, sx: number, sy: number): void;
  /** `apply` pinta la canción nueva en el momento en que la anterior ya no se ve. */
  sw(t: Timeline, e: MusicParts, apply: () => void): void;
  out(t: Timeline, e: MusicParts, sx: number, sy: number): void;
}

const X = 'expo.out';
const P2 = 'power2.in';
const FULL = 'inset(0% 0% 0% 0%)';
const FROML = 'inset(0% 100% 0% 0%)';
const TOR = 'inset(0% 0% 0% 100%)';

const lines = (e: MusicParts) => [e.kick, e.t, e.a, e.al];

export const MUSIC_MOTION: Record<MusicDesign, DesignMotion> = {
  ficha: {
    in(t, e, sx, sy) {
      t.fromTo(e.np, { autoAlpha: 0, x: `${sx * 1.8}em`, y: sx ? 0 : `${sy * 1.2}em` }, { autoAlpha: 1, x: 0, y: 0, duration: 0.5, ease: X }).fromTo(
        e.tx,
        { clipPath: FROML },
        { clipPath: FULL, duration: 0.55, ease: X },
        0.08
      );
    },
    sw(t, e, apply) {
      t.to([e.tx, e.cov], { opacity: 0, duration: 0.14, ease: P2 })
        .to(e.tx, { y: '-.5em', duration: 0.14, ease: P2 }, 0)
        .add(apply)
        .fromTo(e.tx, { y: '.6em' }, { y: 0, opacity: 1, duration: 0.4, ease: X })
        .to(e.cov, { opacity: 1, duration: 0.3, ease: 'power2.out' }, '<');
    },
    out(t, e, sx, sy) {
      t.to(e.np, { autoAlpha: 0, x: `${sx * 0.9}em`, y: sx ? 0 : `${sy * 0.6}em`, duration: 0.2, ease: P2 });
    },
  },
  franja: {
    in(t, e) {
      const L = lines(e);
      t.set(e.np, { autoAlpha: 1 })
        .set([e.cov, e.side, e.pr, ...L], { opacity: 0 })
        .fromTo(e.bg, { clipPath: FROML }, { clipPath: FULL, duration: 0.6, ease: X }, 0)
        .fromTo(e.cov, { x: '-1em' }, { x: 0, opacity: 1, duration: 0.5, ease: X }, 0.14)
        .fromTo(L, { y: '.9em' }, { y: 0, opacity: 1, duration: 0.5, ease: X, stagger: 0.06 }, 0.2)
        .to([e.side, e.pr], { opacity: 1, duration: 0.3, ease: 'power2.out' }, 0.38);
    },
    sw(t, e, apply) {
      t.set(e.wipe, { transformOrigin: '0% 50%' })
        .to(e.wipe, { scaleX: 1, duration: 0.2, ease: P2 })
        .to(e.cov, { opacity: 0, duration: 0.15 }, 0)
        .add(apply)
        .set(e.wipe, { transformOrigin: '100% 50%' })
        .to(e.wipe, { scaleX: 0, duration: 0.45, ease: X })
        .to(e.cov, { opacity: 1, duration: 0.3 }, '<');
    },
    out(t, e) {
      t.to([e.cov, e.side, e.pr, e.tx], { opacity: 0, duration: 0.12, ease: P2 }).fromTo(e.bg, { clipPath: FULL }, { clipPath: TOR, duration: 0.24, ease: P2 }, 0.06);
    },
  },
  columna: {
    in(t, e, _sx, sy) {
      const L = lines(e);
      t.set(e.np, { autoAlpha: 1 })
        .set([e.cov, e.side, e.pr, ...L], { opacity: 0 })
        .fromTo(e.np, { y: `${sy * 2}em` }, { y: 0, duration: 0.6, ease: X }, 0)
        .fromTo(e.bg, { clipPath: sy < 0 ? 'inset(0% 0% 100% 0%)' : 'inset(100% 0% 0% 0%)' }, { clipPath: FULL, duration: 0.6, ease: X }, 0)
        .to(e.cov, { opacity: 1, duration: 0.4, ease: 'power2.out' }, 0.12)
        .fromTo(L, { y: '.6em' }, { y: 0, opacity: 1, duration: 0.45, ease: X, stagger: 0.05 }, 0.24)
        .to([e.pr, e.side], { opacity: 1, duration: 0.3 }, 0.4);
    },
    sw(t, e, apply) {
      const L = lines(e);
      t.to(L, { x: '-.7em', opacity: 0, duration: 0.14, ease: P2, stagger: 0.025 })
        .to(e.cov, { opacity: 0, duration: 0.16 }, 0)
        .add(apply)
        .to(e.cov, { opacity: 1, duration: 0.35, ease: 'power2.out' })
        .fromTo(L, { x: '.7em' }, { x: 0, opacity: 1, duration: 0.42, ease: X, stagger: 0.05 }, '<');
    },
    out(t, e, _sx, sy) {
      t.to(e.np, { autoAlpha: 0, y: `${sy}em`, duration: 0.22, ease: P2 });
    },
  },
  disco: {
    in(t, e) {
      t.fromTo(e.np, { autoAlpha: 0, scale: 0.94, transformOrigin: '0% 50%' }, { autoAlpha: 1, scale: 1, duration: 0.5, ease: X })
        .fromTo(e.disc, { x: '-3.3em', rotation: -140 }, { x: 0, rotation: 0, duration: 0.75, ease: X }, 0.14)
        .fromTo([e.tx, e.side], { x: '-.9em', opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: X, stagger: 0.05 }, 0.24);
    },
    sw(t, e, apply) {
      t.to(e.disc, { x: '-3.3em', duration: 0.2, ease: P2 })
        .to([e.tx, e.cov], { opacity: 0, duration: 0.16 }, 0)
        .add(apply)
        .to(e.cov, { opacity: 1, duration: 0.3 })
        .to(e.disc, { x: 0, duration: 0.6, ease: X }, '<.05')
        .fromTo(e.tx, { x: '-.7em' }, { x: 0, opacity: 1, duration: 0.45, ease: X }, '<');
    },
    out(t, e) {
      t.to(e.disc, { x: '-3.3em', duration: 0.16, ease: P2 }).to(e.np, { autoAlpha: 0, scale: 0.97, duration: 0.2, ease: P2 }, 0.08);
    },
  },
  linea: {
    in(t, e) {
      t.set(e.np, { autoAlpha: 1 })
        .fromTo(e.np, { clipPath: FROML }, { clipPath: FULL, duration: 0.55, ease: X }, 0)
        .fromTo(e.tx, { x: '-1.2em', opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: X }, 0.1);
    },
    sw(t, e, apply) {
      t.to(e.tx, { yPercent: -110, opacity: 0, duration: 0.16, ease: P2 }).add(apply).fromTo(e.tx, { yPercent: 110 }, { yPercent: 0, opacity: 1, duration: 0.4, ease: X });
    },
    out(t, e) {
      t.fromTo(e.np, { clipPath: FULL }, { clipPath: TOR, duration: 0.22, ease: P2 });
    },
  },
  portada: {
    in(t, e) {
      const L = lines(e);
      t.set(e.np, { autoAlpha: 1 })
        .set([e.cov, e.side, e.pr, ...L], { opacity: 0 })
        .fromTo(e.bg, { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: FULL, duration: 0.7, ease: X }, 0)
        .fromTo(e.cov, { y: '1.2em' }, { y: 0, opacity: 1, duration: 0.7, ease: X }, 0.1)
        .fromTo(L, { y: '1em', clipPath: 'inset(0% 0% 100% 0%)' }, { y: 0, opacity: 1, clipPath: FULL, duration: 0.6, ease: X, stagger: 0.08 }, 0.22)
        .fromTo(e.pr, { scaleX: 0, transformOrigin: '0% 50%' }, { scaleX: 1, opacity: 1, duration: 0.6, ease: X }, 0.45)
        .to(e.side, { opacity: 1, duration: 0.3 }, 0.55);
    },
    sw(t, e, apply) {
      const L = lines(e);
      t.to(L, { y: '-.6em', opacity: 0, duration: 0.14, ease: P2, stagger: 0.03 })
        .to(e.cov, { opacity: 0, duration: 0.18 }, 0)
        .add(apply)
        .to(e.cov, { opacity: 1, duration: 0.4, ease: 'power2.out' })
        .fromTo(L, { y: '.9em' }, { y: 0, opacity: 1, duration: 0.5, ease: X, stagger: 0.07 }, '<');
    },
    out(t, e) {
      t.to(e.np, { autoAlpha: 0, y: '.8em', duration: 0.24, ease: P2 });
    },
  },
};

/** Todas las piezas que alguna animación toca, para limpiarlas antes de la siguiente. */
export const partList = (e: MusicParts): HTMLElement[] => [e.bg, e.disc, e.cov, e.tx, e.kick, e.t, e.a, e.al, e.pr, e.side, e.wipe];

/** Hacia dónde está el borde más cercano: [horizontal, vertical], cada uno -1, 0 o 1. */
export function edgeDirection(pos: string): [number, number] {
  return [pos[1] === 'l' ? -1 : pos[1] === 'r' ? 1 : 0, pos[0] === 't' ? -1 : 1];
}
