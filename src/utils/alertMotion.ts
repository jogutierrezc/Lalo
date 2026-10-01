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
const reduced = () =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sideOf = (position: AlertPosition) => (position[1] === 'l' ? -1 : position[1] === 'r' ? 1 : 0);
const back = (strength: number, bounce: number) => (bounce ? `back.out(${(strength * bounce).toFixed(2)})` : 'power3.out');
const clipHidden = (side: number) =>
  side > 0 ? 'inset(0% 0% 0% 100%)' : side < 0 ? 'inset(0% 100% 0% 0%)' : 'inset(0% 50% 0% 50%)';
const STICKER_TILT = -6;

/** Entrada de la tarjeta y de las palabras del mensaje. */
export function playEnter(root: HTMLElement, o: MotionOptions): gsap.core.Timeline {
  const tl = gsap.timeline();
  if (reduced()) {
    tl.fromTo(root, { opacity: 0 }, { opacity: 1, duration: 0.25 });
    return tl;
  }

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
    tl.to(root, { x: 'random(-4, 4)', duration: 0.05, repeat: 9, repeatRefresh: true, ease: 'none' }, 0).to(root, { x: 0, duration: 0.1 });
  }

  // Si el texto no cabe, avanza con la lectura
  const box = part(root, 'text')[0];
  if (box) {
    const maxScroll = box.scrollHeight - box.clientHeight;
    if (maxScroll > 10) {
      tl.to(box, { scrollTop: maxScroll, duration: Math.max(4, total - 1.5), ease: 'none' }, 1);
    }
  }

  return tl;
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
}

/** Salida de la tarjeta. */
export function playExit(root: HTMLElement, o: MotionOptions, onDone: () => void): gsap.core.Timeline {
  const tl = gsap.timeline({ onComplete: onDone });
  if (reduced()) {
    tl.to(root, { opacity: 0, duration: 0.2 });
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
  gsap.killTweensOf([root, ...parts, ...words]);
  gsap.set([root, ...parts], { clearProps: 'transform,opacity,filter,clipPath' });
  gsap.set(words, { clearProps: 'transform,opacity,filter,color' });
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
