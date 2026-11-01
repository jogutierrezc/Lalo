/**
 * alertMotion.ts
 *
 * Movimiento GSAP de las alertas del widget. Cada estilo tiene su entrada, su
 * indicador de voz y su salida; la emoción del mensaje cambia el gesto con el
 * que entran las palabras. La salida siempre dura menos que la entrada.
 *
 * Los elementos se localizan por atributos data-al dentro de la tarjeta, de modo
 * que el widget de OBS y la vista previa del panel comparten el mismo código.
 */

import gsap from 'gsap';
import type { AlertStyle, AlertPosition, AlertEnergy } from './appearance';
import { GEM_STOPS } from './pixelSprites';
import { typeSchedule } from './typewriter';

export interface MotionOptions {
  style: AlertStyle;
  position: AlertPosition;
  energy: AlertEnergy;
  accent: string;
  emotion?: string | null; // etiqueta canónica (happy, shouting, singing...)
  leadIn?: number; // segundos de anuncio ("Juan dice:") antes del mensaje
}

const ENERGY = {
  calma: { amp: 0.5, time: 1.25, bounce: 0 },
  normal: { amp: 1, time: 1, bounce: 1 },
  hype: { amp: 1.6, time: 0.85, bounce: 1.5 },
} as const;

type Gesture = 'plain' | 'bounce' | 'shout' | 'whisper' | 'sad' | 'angry' | 'sing';

const GESTURES: Record<string, Gesture> = {
  happy: 'bounce',
  excited: 'bounce',
  laughing: 'bounce',
  shouting: 'shout',
  surprised: 'shout',
  whispering: 'whisper',
  sad: 'sad',
  crying: 'sad',
  angry: 'angry',
  scared: 'angry',
  singing: 'sing',
};

const all = (root: HTMLElement, selector: string) => Array.from(root.querySelectorAll<HTMLElement>(selector));
const part = (root: HTMLElement, name: string) => all(root, `[data-al="${name}"]`);
export const reduced = () =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sideOf = (position: AlertPosition) => (position[1] === 'l' ? -1 : position[1] === 'r' ? 1 : 0);
const back = (strength: number, bounce: number) => (bounce ? `back.out(${(strength * bounce).toFixed(2)})` : 'power3.out');
const clipHidden = (side: number) =>
  side > 0 ? 'inset(0% 0% 0% 100%)' : side < 0 ? 'inset(0% 100% 0% 0%)' : 'inset(0% 50% 0% 50%)';
const STICKER_TILT = -6;

// ---------- Estilos pixel: Arcade, Aventura, Diálogo y sus mezclas ----------
// El movimiento va a saltos de fotograma (steps) como un juego de 8 bits. Las
// medidas del diseño están en píxeles a 16 px de base: `unit` las escala al
// tamaño real de la tarjeta.

type PixelLook = 'arcade' | 'aventura' | 'dialogo';
const PIXEL_LOOK: Partial<Record<AlertStyle, PixelLook>> = {
  arcade: 'arcade',
  aventura: 'aventura',
  dialogo: 'dialogo',
  arcadeDialogo: 'arcade',
  aventuraDialogo: 'aventura',
};
const isPixel = (style: AlertStyle) => !!PIXEL_LOOK[style];
const isTyped = (style: AlertStyle) => style === 'dialogo' || style === 'arcadeDialogo' || style === 'aventuraDialogo';
const steps = (n: number) => `steps(${n})`;
const unit = (root: HTMLElement) => (parseFloat(getComputedStyle(root).fontSize) || 16) / 16;
const HERO_X0 = 8;
const HERO_W = 36;

/** Alterna dos fotogramas (a visible, b oculto) cada `period` segundos. */
function flip(a: HTMLElement | undefined, b: HTMLElement | undefined, period: number): gsap.core.Timeline {
  const tl = gsap.timeline({ repeat: -1 });
  if (!a || !b) return tl;
  tl.set(a, { autoAlpha: 0 }, 0).set(b, { autoAlpha: 1 }, 0).set(a, { autoAlpha: 1 }, period).set(b, { autoAlpha: 0 }, period).to({}, { duration: 2 * period }, 0);
  return tl;
}

/** Karaoke de color: cada palabra se tiñe de `color` mientras se lee. */
function pixelKaraoke(tl: gsap.core.Timeline, words: HTMLElement[], from: number, to: number, color: string) {
  if (!words.length) return;
  const step = (to - from) / words.length;
  words.forEach((w, i) => {
    tl.set(w, { color }, from + i * step).set(w, { clearProps: 'color' }, from + (i + 1) * step - 0.001);
  });
}

function pixelWordsIn(tl: gsap.core.Timeline, words: HTMLElement[], o: MotionOptions, u: number, at: number) {
  if (!words.length) return;
  const E = ENERGY[o.energy];
  const g = GESTURES[o.emotion || ''] || 'plain';
  const from: gsap.TweenVars = { opacity: 0, y: 10 * E.amp * u };
  const to: gsap.TweenVars = { opacity: 1, y: 0, x: 0, scale: 1, duration: 0.2 * E.time, ease: steps(3), stagger: Math.min(0.05, 0.7 / words.length) * E.time };
  if (g === 'bounce') {
    from.y = 16 * E.amp * u;
    to.ease = steps(4);
  }
  if (g === 'shout') {
    Object.assign(from, { y: 0, scale: 1.5 });
    Object.assign(to, { duration: 0.14 * E.time, ease: steps(2) });
  }
  if (g === 'whisper') {
    from.y = 0;
    Object.assign(to, { duration: 0.5 * E.time, ease: steps(4), stagger: (to.stagger as number) * 2 });
  }
  if (g === 'sad') {
    from.y = -12 * E.amp * u;
    to.duration = 0.5 * E.time;
  }
  if (g === 'angry') {
    Object.assign(from, { y: 0, scale: 1.25, x: () => gsap.utils.random(-6, 6) * E.amp * u });
    Object.assign(to, { duration: 0.12 * E.time, ease: steps(2) });
  }
  tl.fromTo(words, from, to, at);
}

/** Cantar (palabras que saltan) y gritar o enojo (sacudida del contenedor). */
function pixelExtras(tl: gsap.core.Timeline, shakers: HTMLElement[], words: HTMLElement[], o: MotionOptions, u: number) {
  const E = ENERGY[o.energy];
  const g = GESTURES[o.emotion || ''] || 'plain';
  if (g === 'sing' && words.length) tl.to(words, { y: -5 * u, duration: 0.25, ease: steps(1), yoyo: true, repeat: -1, stagger: 0.07 }, 0.2);
  if (g === 'shout' || g === 'angry') {
    tl.to(shakers, { x: () => gsap.utils.random(-1, 1) * 4 * E.amp * u, duration: 0.05, repeat: 7, repeatRefresh: true, ease: 'none' }, 0).to(shakers, { x: 0, duration: 0.05 }, '>');
  }
}

function pixelEnter(root: HTMLElement, o: MotionOptions): gsap.core.Timeline {
  const look = PIXEL_LOOK[o.style] as PixelLook;
  const E = ENERGY[o.energy];
  const T = E.time;
  const A = E.amp;
  const u = unit(root);
  const tl = gsap.timeline();
  const words = all(root, '.msg-word');

  if (look === 'arcade') {
    const cornerX = [-14, 14, -14, 14];
    const cornerY = [-14, -14, 14, 14];
    tl.fromTo(root, { clipPath: 'inset(50% 0% 50% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.32 * T, ease: steps(6) }, 0)
      .fromTo(part(root, 'bk'), { opacity: 0, x: (i: number) => cornerX[i] * A * u, y: (i: number) => cornerY[i] * A * u }, { opacity: 1, x: 0, y: 0, duration: 0.22 * T, ease: steps(3), stagger: 0.04 }, 0.14)
      .fromTo(part(root, 'inv'), { y: -44 * A * u, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3 * T, ease: steps(5) }, 0.18)
      .fromTo(part(root, 'tag'), { clipPath: 'inset(0% 100% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.32 * T, ease: steps(13) }, 0.28)
      .fromTo([...part(root, 'deco'), ...part(root, 'pip')], { opacity: 0 }, { opacity: 1, duration: 0.12, ease: steps(2), stagger: 0.04 }, 0.3)
      .fromTo(part(root, 'name'), { opacity: 0, y: 8 * u }, { opacity: 1, y: 0, duration: 0.2 * T, ease: steps(3) }, 0.34)
      .fromTo(part(root, 'star2'), { y: 14 * A * u, opacity: 0 }, { y: 0, opacity: 1, duration: 0.24 * T, ease: steps(3) }, 0.4);
    pixelWordsIn(tl, words, o, u, 0.42 * T);
  }

  if (look === 'aventura') {
    tl.fromTo(root, { clipPath: 'inset(50% 50% 50% 50%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.36 * T, ease: steps(7) }, 0)
      .fromTo(part(root, 'star'), { opacity: 0 }, { opacity: 1, duration: 0.1, ease: steps(1), stagger: { each: 0.012, from: 'random' } }, 0.1)
      .fromTo(part(root, 'chip'), { y: -48 * A * u, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3 * T, ease: steps(5) }, 0.2)
      .fromTo(part(root, 'scene'), { y: 120 * u }, { y: 0, duration: 0.3 * T, ease: steps(5) }, 0.14)
      .fromTo([...part(root, 'gem'), ...part(root, 'blk')], { opacity: 0, y: -14 * u }, { opacity: 1, y: 0, duration: 0.18, ease: steps(3), stagger: 0.05 }, 0.42);
    pixelWordsIn(tl, words, o, u, 0.34 * T);
  }

  if (look === 'dialogo') {
    tl.fromTo(root, { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.3 * T, ease: steps(5) }, 0)
      .fromTo(part(root, 'tab'), { y: -16 * A * u, opacity: 0 }, { y: 0, opacity: 1, duration: 0.2 * T, ease: steps(3) }, 0.18)
      .fromTo(part(root, 'port'), { opacity: 0, scale: 0.85 }, { opacity: 1, scale: 1, duration: 0.2 * T, ease: steps(3) }, 0.24);
  }

  // Los caracteres nacen ocultos para que el texto no mueva el diseño al escribirse
  if (isTyped(o.style)) tl.set(part(root, 'ch'), { opacity: 0 }, 0);
  return tl;
}

/** Máquina de escribir: cada carácter aparece con pausa en comas y puntos. `flash` lo tiñe un instante. */
function pixelTypewriter(tl: gsap.core.Timeline, root: HTMLElement, o: MotionOptions, total: number, flash: string | null) {
  const u = unit(root);
  const chs = part(root, 'ch');
  const next = part(root, 'next');
  const g = GESTURES[o.emotion || ''] || 'plain';
  // Si el widget antepone "Juan dice:", el texto empieza cuando termina ese anuncio
  const lead = Math.min(o.leadIn || 0, total * 0.3);
  const start = lead + 0.2;
  const span = Math.max(0.3, (total - lead) * 0.9 - 0.2);
  const { starts, end } = typeSchedule(chs.map((c) => c.textContent || ''), span);
  const dy = (g === 'bounce' ? 6 : g === 'sad' ? -6 : 0) * u;
  const sc = g === 'shout' ? 1.5 : 1;
  tl.set(next, { autoAlpha: 0 }, 0);
  chs.forEach((c, i) => {
    const at = start + starts[i];
    tl.fromTo(c, { opacity: 0, y: dy, scale: sc }, { opacity: 1, y: 0, scale: 1, duration: 0.08, ease: steps(2) }, at);
    if (flash) tl.set(c, { color: flash }, at).set(c, { clearProps: 'color' }, at + 0.16);
  });
  const done = start + end;
  tl.set(next, { autoAlpha: 1 }, done).to(next, { y: 5 * u, duration: 0.3, ease: steps(1), yoyo: true, repeat: -1 }, done);
}

function pixelSpeak(root: HTMLElement, o: MotionOptions, total: number): gsap.core.Timeline {
  const look = PIXEL_LOOK[o.style] as PixelLook;
  const E = ENERGY[o.energy];
  const u = unit(root);
  const tl = gsap.timeline();
  const words = all(root, '.msg-word');
  const lead = Math.min(o.leadIn || 0, total * 0.3);

  if (look === 'arcade') {
    tl.add(flip(part(root, 'fa')[0], part(root, 'fb')[0], 0.28 * E.time), 0)
      .to(part(root, 'inv'), { x: 10 * E.amp * u, duration: 0.56, ease: steps(4), yoyo: true, repeat: -1 }, 0)
      .to(part(root, 'star2'), { scale: 1.18, duration: 0.3, ease: steps(1), yoyo: true, repeat: -1 }, 0)
      .to(part(root, 'pip'), { opacity: 0.2, duration: 0.4, ease: steps(1), yoyo: true, repeat: -1, stagger: 0.1 }, 0);
    pixelKaraoke(tl, words, lead + 0.15, total * 0.92, o.accent);
    pixelExtras(tl, part(root, 'bar'), words, o, u);
  }

  if (look === 'aventura') {
    const run = part(root, 'run');
    const scene = part(root, 'scene')[0];
    // El héroe recorre el ancho real de la escena (en px de pantalla)
    const range = Math.max(0, (scene ? scene.offsetWidth : 560 * u) - (2 * HERO_X0 + HERO_W) * u);
    tl.add(flip(part(root, 'fa')[0], part(root, 'fb')[0], 0.12), 0)
      .to(run, { x: range, duration: total, ease: steps(Math.max(8, Math.round(total * 12))) }, 0)
      .to(part(root, 'star'), { opacity: 'random(0.25,1)', duration: 0.5, repeat: -1, repeatRefresh: true, ease: steps(1), stagger: { each: 0.03, from: 'random' } }, 0);
    const jumpAt = Math.max(0.2, total * 0.5 - 0.27);
    tl.to(part(root, 'hero'), { keyframes: [{ y: -38 * u * Math.min(1.3, E.amp + 0.2), duration: 0.27, ease: steps(4) }, { y: 0, duration: 0.27, ease: steps(4) }] }, jumpAt);
    part(root, 'gem').forEach((g, i) => {
      const t = total * (GEM_STOPS[i] ?? 0.5);
      tl.to(part(g, 'gemsp'), { y: -16 * u, autoAlpha: 0, duration: 0.24, ease: steps(3) }, t)
        .fromTo(part(g, 'plus'), { opacity: 1, y: 0 }, { opacity: 0, y: -22 * u, duration: 0.55, ease: steps(5) }, t);
    });
    pixelExtras(tl, part(root, 'scene'), words, o, u);
  }

  if (look === 'dialogo') {
    tl.add(flip(part(root, 'fa')[0], part(root, 'fb')[0], 0.11 * E.time), 0);
    pixelExtras(tl, [...part(root, 'port'), ...part(root, 'text')], [], o, u);
  }

  if (isTyped(o.style)) pixelTypewriter(tl, root, o, total, o.style === 'arcadeDialogo' ? o.accent : null);
  return tl;
}

function pixelExit(root: HTMLElement, o: MotionOptions): gsap.core.Timeline {
  const look = PIXEL_LOOK[o.style] as PixelLook;
  const u = unit(root);
  const tl = gsap.timeline();
  if (look === 'arcade') {
    tl.to(part(root, 'inv'), { y: -18 * u, duration: 0.12, ease: steps(3) }, 0).to(root, { clipPath: 'inset(50% 0% 50% 0%)', duration: 0.2, ease: steps(4) }, 0.06);
  }
  if (look === 'aventura') {
    tl.to(part(root, 'run'), { x: `+=${90 * u}`, duration: 0.2, ease: steps(5) }, 0).to(root, { clipPath: 'inset(0% 0% 0% 100%)', duration: 0.24, ease: steps(6) }, 0.04);
  }
  if (look === 'dialogo') {
    tl.to(part(root, 'next'), { autoAlpha: 0, duration: 0.1, ease: steps(1), repeat: 3, yoyo: true }, 0).to(root, { clipPath: 'inset(0% 0% 100% 0%)', duration: 0.2, ease: steps(4) }, 0.2);
  }
  return tl;
}

/** Entrada de la tarjeta y de las palabras del mensaje. */
export function playEnter(root: HTMLElement, o: MotionOptions): gsap.core.Timeline {
  const tl = gsap.timeline();
  if (reduced()) {
    tl.fromTo(root, { opacity: 0 }, { opacity: 1, duration: 0.25 });
    return tl;
  }
  if (isPixel(o.style)) return pixelEnter(root, o);

  const E = ENERGY[o.energy];
  const side = sideOf(o.position);
  const em = parseFloat(getComputedStyle(root).fontSize) || 16;
  const words = all(root, '.msg-word');
  let wordsAt = 0.22 * E.time;

  if (o.style === 'cabina') {
    tl.fromTo(root, { clipPath: clipHidden(side) }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.5 * E.time, ease: 'expo.out' }, 0)
      .fromTo(part(root, 'tally'), { opacity: 0.2 }, { opacity: 1, duration: 0.14, repeat: 2, yoyo: true }, 0.1)
      .fromTo(part(root, 'avatar'), { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3 * E.time, ease: 'power3.out' }, 0.12)
      .set(part(root, 'prog'), { scaleX: 0 }, 0);
  }

  if (o.style === 'bocadillo') {
    // El globo crece desde la cola: su origen es el avatar, no el centro
    tl.fromTo(part(root, 'avatar'), { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4 * E.time, ease: back(2, E.bounce) }, 0)
      .fromTo(
        part(root, 'balloon'),
        { scale: 0.82, opacity: 0, transformOrigin: `${side > 0 ? 'right' : 'left'} bottom` },
        { scale: 1, opacity: 1, duration: 0.45 * E.time, ease: back(1.6, E.bounce) },
        0.08
      )
      .fromTo(
        part(root, 'tag'),
        { y: -0.6 * em * E.amp, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.3 * E.time, ease: back(2, E.bounce), stagger: 0.06 },
        0.25
      );
    wordsAt = 0.3 * E.time;
  }

  if (o.style === 'subtitulo') {
    tl.fromTo(part(root, 'chip'), { y: 8 * E.amp, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3 * E.time, ease: 'power3.out' }, 0);
    wordsAt = 0.1;
  }

  if (o.style === 'sticker') {
    // El sticker se "pega" de golpe y la placa se despliega desde él
    tl.fromTo(
      part(root, 'sticker'),
      { scale: 1 + 0.5 * E.amp, rotation: STICKER_TILT - 16 * E.amp, opacity: 0 },
      { scale: 1, rotation: STICKER_TILT, opacity: 1, duration: 0.42 * E.time, ease: back(2.2, E.bounce) },
      0
    ).fromTo(
      part(root, 'plate'),
      { scaleX: 0.6, opacity: 0, transformOrigin: `${side > 0 ? 'right' : 'left'} center` },
      { scaleX: 1, opacity: 1, duration: 0.45 * E.time, ease: 'expo.out' },
      0.14
    );
    wordsAt = 0.3 * E.time;
  }

  // Palabras: el gesto de entrada depende de la emoción
  if (words.length) {
    const gesture = GESTURES[o.emotion || ''] || 'plain';
    const step = Math.min(0.05, 0.8 / words.length);
    const from: gsap.TweenVars = { opacity: 0, y: 0.5 * em * E.amp };
    const to: gsap.TweenVars = {
      opacity: o.style === 'subtitulo' ? 0.45 : 1,
      y: 0,
      x: 0,
      scale: 1,
      rotation: 0,
      duration: 0.32 * E.time,
      ease: 'power3.out',
      stagger: step,
    };
    if (gesture === 'bounce') {
      Object.assign(from, { y: 0.8 * em * E.amp, scale: 0.7, rotation: () => gsap.utils.random(-10, 10) * E.amp });
      to.ease = back(2.2, E.bounce);
    }
    if (gesture === 'shout') {
      Object.assign(from, { y: 0, scale: 1 + 0.7 * E.amp });
      Object.assign(to, { duration: 0.2 * E.time, ease: 'power4.out' });
    }
    if (gesture === 'whisper') {
      Object.assign(from, { y: 0, filter: 'blur(6px)' });
      Object.assign(to, { filter: 'blur(0px)', duration: 0.6 * E.time, stagger: step * 2 });
    }
    if (gesture === 'sad') {
      from.y = -0.5 * em * E.amp;
      Object.assign(to, { duration: 0.6 * E.time, ease: 'power1.out' });
    }
    if (gesture === 'angry') {
      Object.assign(from, { y: 0, scale: 1.2, x: () => gsap.utils.random(-0.5, 0.5) * em * E.amp });
      to.duration = 0.16 * E.time;
    }
    tl.fromTo(words, from, to, wordsAt);
  }

  return tl;
}

/**
 * Indicador de voz mientras suena el audio. Un solo elemento por estilo, para
 * no competir con el texto. `seconds` es la duración real o estimada del audio.
 */
export function startSpeaking(root: HTMLElement, o: MotionOptions, seconds: number): gsap.core.Timeline {
  const tl = gsap.timeline();
  if (reduced()) return tl;

  const E = ENERGY[o.energy];
  const em = parseFloat(getComputedStyle(root).fontSize) || 16;
  const words = all(root, '.msg-word');
  const gesture = GESTURES[o.emotion || ''] || 'plain';
  const total = Math.max(1, seconds);

  if (isPixel(o.style)) {
    tl.add(pixelSpeak(root, o, total), 0);
    scrollFollow(tl, root, total);
    return tl;
  }

  if (o.style === 'cabina') {
    tl.to(part(root, 'vu'), { scaleY: 'random(0.05, 0.85)', duration: 0.11, repeat: -1, repeatRefresh: true, ease: 'none', stagger: 0.03 }, 0)
      .fromTo(part(root, 'prog'), { scaleX: 0 }, { scaleX: 1, duration: total, ease: 'none' }, 0);
  }
  if (o.style === 'bocadillo') {
    tl.fromTo(part(root, 'arc'), { opacity: 0 }, { opacity: 1, duration: 0.18, stagger: { each: 0.09, repeat: -1, yoyo: true } }, 0)
      .to(part(root, 'avatar'), { rotation: 3 * E.amp, duration: 0.5, ease: 'sine.inOut', yoyo: true, repeat: -1 }, 0);
  }
  if (o.style === 'subtitulo') {
    tl.to(part(root, 'wave'), { scaleY: 'random(0.3, 1)', duration: 0.14, repeat: -1, repeatRefresh: true, ease: 'sine.inOut', stagger: 0.04 }, 0);
    if (words.length) {
      // Karaoke: cada palabra se enciende al ritmo de lectura, tras el anuncio del autor
      const lead = Math.min(o.leadIn || 0, total * 0.3);
      tl.to(
        words,
        {
          keyframes: [
            { opacity: 1, color: o.accent, scale: 1.07, duration: 0.12 },
            { color: '#ffffff', scale: 1, duration: 0.3 },
          ],
          stagger: ((total - lead) * 0.92) / words.length,
        },
        lead
      );
    }
  }
  if (o.style === 'sticker') {
    tl.to(part(root, 'sticker'), { rotation: STICKER_TILT + 5 * E.amp, scale: 1 + 0.05 * E.amp, duration: 0.45, ease: 'sine.inOut', yoyo: true, repeat: -1 }, 0)
      .to(part(root, 'wave'), { scaleY: 'random(0.3, 1)', duration: 0.14, repeat: -1, repeatRefresh: true, ease: 'sine.inOut', stagger: 0.04 }, 0);
  }

  if (gesture === 'sing' && words.length) {
    tl.to(words, { y: -0.22 * em * E.amp, duration: 0.4, ease: 'sine.inOut', yoyo: true, repeat: -1, stagger: 0.06 }, 0.2);
  }
  if (gesture === 'shout' || gesture === 'angry') {
    tl.to(root, { x: () => gsap.utils.random(-0.2, 0.2) * em * E.amp, duration: 0.05, repeat: 5, repeatRefresh: true, ease: 'none' }, 0).to(root, { x: 0, duration: 0.1 });
  }

  scrollFollow(tl, root, total);

  return tl;
}

/** Si el texto no cabe, avanza con la lectura. */
function scrollFollow(tl: gsap.core.Timeline, root: HTMLElement, total: number) {
  const box = part(root, 'text')[0];
  if (box) {
    const maxScroll = box.scrollHeight - box.clientHeight;
    if (maxScroll > 10) {
      tl.to(box, { scrollTop: maxScroll, duration: Math.max(4, total - 1.5), ease: 'none' }, 1);
    }
  }
}

/** Detiene el indicador de voz y deja la tarjeta en reposo. */
export function stopSpeaking(root: HTMLElement, speaking: gsap.core.Timeline | null): void {
  speaking?.kill();
  if (reduced()) return;
  gsap.to(part(root, 'vu'), { scaleY: 0.92, duration: 0.2, ease: 'power2.out' });
  gsap.to(part(root, 'wave'), { scaleY: 0.4, duration: 0.2, ease: 'power2.out' });
  gsap.to(part(root, 'avatar'), { rotation: 0, duration: 0.2, ease: 'power2.out' });
  gsap.to(part(root, 'sticker'), { rotation: STICKER_TILT, scale: 1, duration: 0.2, ease: 'power2.out' });
  gsap.to(root, { x: 0, duration: 0.1 });
  if (/\bal-(arcade|aventura|dialogo)\b/.test(root.className)) {
    // Estilos pixel: fotograma de reposo, texto completo y flecha de "siguiente" visible
    gsap.set(all(root, '.msg-word'), { clearProps: 'color' });
    gsap.set([...part(root, 'fa'), ...part(root, 'fb')], { clearProps: 'opacity,visibility' });
    gsap.set(part(root, 'ch'), { opacity: 1, clearProps: 'transform,color' });
    gsap.set(part(root, 'next'), { autoAlpha: 1, clearProps: 'transform' });
  }
}

/** Salida de la tarjeta. */
export function playExit(root: HTMLElement, o: MotionOptions, onDone: () => void): gsap.core.Timeline {
  const tl = gsap.timeline({ onComplete: onDone });
  if (reduced()) {
    tl.to(root, { opacity: 0, duration: 0.2 });
    return tl;
  }
  if (isPixel(o.style)) {
    tl.add(pixelExit(root, o), 0);
    return tl;
  }
  if (o.style === 'cabina') {
    tl.to(root, { clipPath: clipHidden(sideOf(o.position)), duration: 0.26, ease: 'power3.out' });
  }
  if (o.style === 'bocadillo') {
    tl.to([...part(root, 'balloon'), ...part(root, 'avatar')], { scale: 0.92, opacity: 0, duration: 0.2, ease: 'power2.out' });
  }
  if (o.style === 'subtitulo') {
    tl.to(root, { opacity: 0, filter: 'blur(6px)', duration: 0.3, ease: 'power2.out' });
  }
  if (o.style === 'sticker') {
    tl.to(part(root, 'plate'), { opacity: 0, scaleX: 0.9, duration: 0.18, ease: 'power2.out' }).to(
      part(root, 'sticker'),
      { scale: 0.85, opacity: 0, duration: 0.2, ease: 'power2.out' },
      0.04
    );
  }
  return tl;
}

/** Devuelve la tarjeta a su estado de reposo (lo que define el CSS). */
export function resetAlert(root: HTMLElement): void {
  const parts = all(root, '[data-al]');
  const words = all(root, '.msg-word');
  const chars = all(root, '.ch');
  gsap.killTweensOf([root, ...parts, ...words, ...chars]);
  gsap.set([root, ...parts], { clearProps: 'transform,opacity,visibility,filter,clipPath' });
  gsap.set([...words, ...chars], { clearProps: 'transform,opacity,filter,color' });
  part(root, 'text').forEach((box) => {
    box.scrollTop = 0;
  });
}

/**
 * Ciclo completo para la vista previa del panel: entrada, voz, salida y vuelta
 * al reposo. Devuelve una función que lo cancela.
 */
export function playDemo(root: HTMLElement, o: MotionOptions, seconds: number): () => void {
  resetAlert(root);
  const calls: gsap.core.Tween[] = [];
  let speaking: gsap.core.Timeline | null = null;
  let exit: gsap.core.Timeline | null = null;

  const enter = playEnter(root, o);
  const talkAt = enter.duration();

  calls.push(
    gsap.delayedCall(talkAt, () => {
      speaking = startSpeaking(root, o, seconds);
    })
  );
  calls.push(
    gsap.delayedCall(talkAt + seconds + 0.4, () => {
      stopSpeaking(root, speaking);
      exit = playExit(root, o, () => {
        calls.push(
          gsap.delayedCall(0.45, () => {
            resetAlert(root);
            gsap.fromTo(root, { opacity: 0 }, { opacity: 1, duration: 0.3, clearProps: 'opacity' });
          })
        );
      });
    })
  );

  return () => {
    calls.forEach((call) => call.kill());
    enter.kill();
    speaking?.kill();
    exit?.kill();
    resetAlert(root);
  };
}
