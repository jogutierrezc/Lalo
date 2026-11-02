/**
 * src/components/done/renderers/svgCharacter.ts
 *
 * Personaje «svg» de Done: la mascota de cabina del diseño aprobado, con sus 10 emociones, el gesto
 * de pensar y los 11 gestos. charSvg() devuelve el dibujo (texto puro, se prueba sin DOM) y
 * createSvgActor() lo anima con GSAP. Su luz de tally se enciende cuando habla.
 */

import gsap from 'gsap';
import type { DoneEmotion, DoneGesture } from '../../../lib/doneTypes';
import { DONE_EMOTIONS, type SvgPalette } from '../doneLogic';
import type { ActorApi } from './types';

const W = '#F5F6F8';
const EASE = 'expo.out';
const STROKE = ` stroke="${W}" fill="none" stroke-linecap="round" stroke-linejoin="round"`;

const eye = (x: number, y: number, w: number, h: number): string =>
  `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="${w / 2}" fill="${W}"/>`;
const star = (x: number, y: number, r: number): string =>
  `<path d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z" fill="${W}"/>`;

type FaceParts = [eyes: string, mouth: string, extra: string];

/** Las caras: ojos, boca y adornos de cada emoción, más la de «pensando». */
export function faces(p: SvgPalette): Record<DoneEmotion | 'pensando', FaceParts> {
  return {
    normal: [eye(78, 88, 11, 17) + eye(122, 88, 11, 17), `<path d="M90 108Q100 114 110 108"${STROKE} stroke-width="3.5"/>`, ''],
    habla: [eye(78, 88, 11, 17) + eye(122, 88, 11, 17), `<ellipse cx="100" cy="109" rx="7" ry="5" fill="${W}"/>`, ''],
    emocionada: [eye(78, 86, 13, 22) + eye(122, 86, 13, 22), `<path d="M86 102Q100 124 114 102Z" fill="${W}"/>`, star(62, 74, 5) + star(138, 74, 5)],
    grita: [
      `<path d="M70 76L86 88L70 100"${STROKE} stroke-width="4"/><path d="M130 76L114 88L130 100"${STROKE} stroke-width="4"/>`,
      `<ellipse cx="100" cy="110" rx="12" ry="10" fill="${W}"/>`,
      '',
    ],
    feliz: [
      `<path d="M70 92Q78 78 86 92"${STROKE} stroke-width="4"/><path d="M114 92Q122 78 130 92"${STROKE} stroke-width="4"/>`,
      `<path d="M84 104Q100 124 116 104"${STROKE} stroke-width="3.5"/>`,
      '',
    ],
    alegre: [
      eye(78, 86, 11, 19) + eye(122, 86, 11, 19),
      `<path d="M90 104Q100 118 110 104Z" fill="${W}"/>`,
      `<circle cx="66" cy="105" r="6" fill="${p.accent}" opacity=".5"/><circle cx="134" cy="105" r="6" fill="${p.accent}" opacity=".5"/>`,
    ],
    triste: [
      eye(78, 93, 10, 14) + eye(122, 93, 10, 14),
      `<path d="M88 115Q100 105 112 115"${STROKE} stroke-width="3.5"/>`,
      `<path d="M68 82L88 74M132 82L112 74"${STROKE} stroke-width="3"/><path d="M70 101Q66 109 70 113Q74 109 70 101Z" fill="#7fc8ff"/>`,
    ],
    molesta: [
      eye(78, 91, 12, 8) + eye(122, 91, 12, 8),
      `<path d="M90 112H110"${STROKE} stroke-width="3.5"/>`,
      `<path d="M66 76L90 84M134 76L110 84"${STROKE} stroke-width="3.5"/>`,
    ],
    sorprendida: [
      `<circle cx="78" cy="88" r="9" fill="${W}"/><circle cx="78" cy="88" r="3.2" fill="${p.screen}"/><circle cx="122" cy="88" r="9" fill="${W}"/><circle cx="122" cy="88" r="3.2" fill="${p.screen}"/>`,
      `<circle cx="100" cy="112" r="6"${STROKE} stroke-width="3.5"/>`,
      '',
    ],
    magica: [star(78, 88, 11) + star(122, 88, 11), `<path d="M90 107Q100 115 110 107"${STROKE} stroke-width="3.5"/>`, star(58, 70, 4) + star(142, 106, 4) + star(144, 68, 3)],
    pensando: [eye(80, 80, 11, 15) + eye(124, 80, 11, 15), `<path d="M92 110H106"${STROKE} stroke-width="3.5"/>`, ''],
  };
}

/**
 * El dibujo de la mascota. En miniatura (thumb) lleva solo la cara normal y el tally encendido;
 * completa, lleva las 11 caras superpuestas (una visible) y el labio para hablar.
 */
export function charSvg(p: SvgPalette, thumb: boolean): string {
  const F = faces(p);
  const ids: (DoneEmotion | 'pensando')[] = thumb ? ['normal'] : [...DONE_EMOTIONS, 'pensando'];
  const face = ids
    .map(
      (id) =>
        `<g class="fx fx-${id}"${id === 'normal' ? '' : ' opacity="0"'}><g class="eyes">${F[id][0]}</g><g class="mouth">${F[id][1]}</g><g class="extra">${F[id][2]}</g></g>`
    )
    .join('');
  const lit = thumb ? p.accent : '#3a4047';
  return (
    '<svg class="ch" viewBox="0 0 200 270" aria-hidden="true">' +
    '<ellipse cx="100" cy="258" rx="48" ry="7" fill="#000" opacity=".35"/>' +
    '<g class="bodyg">' +
    `<g class="arm armL"><rect x="38" y="148" width="22" height="52" rx="11" fill="${p.body}"/><circle cx="49" cy="203" r="10" fill="${p.head}"/></g>` +
    `<g class="arm armR"><rect x="140" y="148" width="22" height="52" rx="11" fill="${p.body}"/><circle cx="151" cy="203" r="10" fill="${p.head}"/></g>` +
    `<rect x="72" y="222" width="20" height="32" rx="9" fill="${p.body}"/><rect x="108" y="222" width="20" height="32" rx="9" fill="${p.body}"/>` +
    `<rect class="torso" x="60" y="140" width="80" height="96" rx="30" fill="${p.body}"/>` +
    '<rect x="76" y="160" width="48" height="36" rx="12" fill="#0b0d0f" opacity=".5"/>' +
    `<circle class="led" cx="100" cy="178" r="8" fill="${lit}"/>` +
    '<g class="headg">' +
    `<line x1="100" y1="44" x2="100" y2="24" stroke="${p.head}" stroke-width="5" stroke-linecap="round"/>` +
    `<circle class="glowL" cx="100" cy="17" r="20" fill="${p.accent}" opacity="0"/>` +
    `<circle class="tallyL" cx="100" cy="17" r="9" fill="${lit}"/>` +
    `<circle cx="35" cy="94" r="9" fill="${p.body}"/><circle cx="165" cy="94" r="9" fill="${p.body}"/>` +
    `<rect x="38" y="44" width="124" height="104" rx="38" fill="${p.head}"/>` +
    `<rect x="50" y="57" width="100" height="78" rx="24" fill="${p.screen}"/>` +
    face +
    (thumb ? '' : `<ellipse class="lip" cx="100" cy="109" rx="8" ry="6" fill="${W}" opacity="0"/>`) +
    '</g></g></svg>'
  );
}

/** Miniatura estática de la mascota, para las tarjetas. */
export const charThumbSvg = (p: SvgPalette): string => charSvg(p, true);

/** Segundos que dura cada gesto del dibujo (para esperar a que termine antes de seguir). */
export const SVG_GESTURE_SECONDS: Record<DoneGesture, number> = {
  wave: 2.1,
  spin: 0.9,
  dance: 1.8,
  jump: 0.75,
  sing: 2.0,
  bow: 1.1,
  ult: 1.2,
  pride: 1.3,
  nod: 0.6,
  shrug: 1.0,
  arms_up: 1.1,
};

interface SvgActorOptions {
  reduced: boolean;
}

/**
 * Anima el dibujo montado dentro de `root` (el contenedor del personaje). Monta el SVG, deja la
 * respiración y el parpadeo en marcha y devuelve la API común de los personajes.
 */
export function createSvgActor(root: HTMLElement, palette: SvgPalette, { reduced }: SvgActorOptions): ActorApi {
  const q = (selector: string): Element | null => root.querySelector(selector);
  const qa = (selector: string): Element[] => Array.from(root.querySelectorAll(selector));

  root.innerHTML = `${charSvg(palette, false)}<div class="done-ring"></div>`;
  let current: DoneEmotion | 'pensando' = 'normal';
  let emotion: DoneEmotion = 'normal';
  let thinking = false;
  let idle: gsap.core.Timeline | null = null;
  let blink: gsap.core.Tween | null = null;
  let lipFn: (() => void) | null = null;
  let disposed = false;
  let externalLevel = -1;
  let externalAt = 0;

  gsap.set(q('.armL'), { svgOrigin: '49 152' });
  gsap.set(q('.armR'), { svgOrigin: '151 152' });
  gsap.set(q('.headg'), { svgOrigin: '100 148' });
  gsap.set(q('.bodyg'), { svgOrigin: '100 254' });
  gsap.set(q('.lip'), { svgOrigin: '100 109' });

  if (!reduced) {
    idle = gsap.timeline({ repeat: -1, yoyo: true }).to(q('.bodyg'), { scaleY: 1.014, duration: 1.7, ease: 'sine.inOut' });
    const schedule = () => {
      blink = gsap.delayedCall(2.8 + Math.random() * 2.6, () => {
        if (disposed) return;
        const eyes = q(`.fx-${current} .eyes`);
        if (eyes) {
          gsap.set(eyes, { svgOrigin: '100 88' });
          gsap.to(eyes, { scaleY: 0.08, duration: 0.07, yoyo: true, repeat: 1 });
        }
        schedule();
      });
    };
    schedule();
  }

  function face(id: DoneEmotion | 'pensando', instant = false) {
    if (id === current) return;
    const prev = q(`.fx-${current}`) as HTMLElement | null;
    const next = q(`.fx-${id}`) as HTMLElement | null;
    if (!next) return;
    current = id;
    if (reduced || instant) {
      if (prev) prev.style.opacity = '0';
      next.style.opacity = '1';
      return;
    }
    if (prev) gsap.to(prev, { opacity: 0, duration: 0.08 });
    gsap.to(next, { opacity: 1, duration: 0.12 });
  }

  function tally(on: boolean) {
    const color = on ? '#ff2a2a' : '#3a4047';
    gsap.to(q('.tallyL'), { fill: color, duration: 0.15 });
    gsap.to(q('.led'), { fill: color, duration: 0.15 });
    gsap.to(q('.glowL'), { opacity: on ? 0.45 : 0, duration: 0.2 });
  }

  function notes() {
    for (let i = 0; i < 3; i++) {
      const n = document.createElement('span');
      n.className = 'done-note';
      n.textContent = i % 2 ? '♫' : '♪';
      n.style.left = `${30 + i * 18}%`;
      root.appendChild(n);
      gsap.fromTo(n, { y: 0, opacity: 1 }, { y: -70 - i * 14, x: (i - 1) * 16, opacity: 0, duration: 1.2, delay: i * 0.25, ease: 'power1.out', onComplete: () => n.remove() });
    }
  }

  const api: ActorApi = {
    setEmotion(id) {
      emotion = id;
      if (!thinking) face(id);
    },

    setThinking(on) {
      thinking = on;
      face(on ? 'pensando' : emotion);
    },

    setSpeaking(on) {
      tally(on);
      if (on) {
        gsap.to(qa('.mouth'), { opacity: 0, duration: 0.05 });
        gsap.set(q('.lip'), { opacity: 1 });
        if (reduced || lipFn) return;
        const t0 = performance.now();
        lipFn = () => {
          const t = (performance.now() - t0) / 1000;
          // Con audio real, la boca sigue el volumen; sin audio, un movimiento de habla.
          const live = performance.now() - externalAt < 200 && externalLevel >= 0;
          const v = live ? 0.2 + 0.8 * Math.min(1, externalLevel * 4) : 0.25 + 0.75 * Math.abs(Math.sin(t * 17) * (0.6 + 0.4 * Math.sin(t * 5.3)));
          gsap.set(q('.lip'), { scaleY: v, scaleX: 0.8 + 0.3 * v });
        };
        gsap.ticker.add(lipFn);
      } else {
        if (lipFn) {
          gsap.ticker.remove(lipFn);
          lipFn = null;
        }
        externalLevel = -1;
        gsap.set(q('.lip'), { opacity: 0, scaleY: 1, scaleX: 1 });
        gsap.to(qa('.mouth'), { opacity: 1, duration: 0.1 });
      }
    },

    setMouth(level) {
      externalLevel = level;
      externalAt = performance.now();
    },

    gesture(name) {
      if (reduced) return Promise.resolve();
      const L = q('.armL');
      const R = q('.armR');
      const H = q('.headg');
      const B = q('.bodyg');
      const S = q('svg.ch');
      const tl = gsap.timeline();
      const rest = (at: string | number) =>
        tl
          .to([L, R], { rotation: 0, duration: 0.3, ease: EASE }, at)
          .to(H, { rotation: 0, y: 0, duration: 0.3, ease: EASE }, at)
          .to(B, { y: 0, rotation: 0, duration: 0.3, ease: EASE }, at);
      const sign = (i: number) => (i ? -165 : 165);

      switch (name) {
        case 'wave':
          tl.to(R, { rotation: -150, duration: 0.3, ease: EASE }).to(R, { rotation: -118, duration: 0.2, repeat: 5, yoyo: true, ease: 'sine.inOut' });
          rest('+=0');
          break;
        case 'spin':
          gsap.set(S, { transformPerspective: 700 });
          tl.fromTo(S, { rotationY: 0 }, { rotationY: 360, duration: 0.9, ease: 'power2.inOut' });
          break;
        case 'dance':
          tl.to(B, { y: -8, duration: 0.2, repeat: 7, yoyo: true, ease: 'sine.inOut' }, 0)
            .to(L, { rotation: 140, duration: 0.22, repeat: 7, yoyo: true }, 0)
            .to(R, { rotation: -140, duration: 0.22, repeat: 7, yoyo: true, delay: 0.22 }, 0)
            .to(H, { rotation: 6, duration: 0.22, repeat: 7, yoyo: true }, 0);
          break;
        case 'jump':
          tl.to(B, { y: -40, duration: 0.24, ease: 'power2.out' }).to(B, { y: 0, duration: 0.5, ease: 'bounce.out' });
          break;
        case 'sing':
          tl.add(notes, 0).to(H, { rotation: -8, duration: 0.3, ease: EASE }, 0).to(R, { rotation: -70, duration: 0.3, ease: EASE }, 0);
          rest('+=1.1');
          break;
        case 'bow':
          tl.to(B, { rotation: 14, duration: 0.35, ease: EASE }).to(B, { rotation: 0, duration: 0.4, ease: EASE }, '+=.3');
          break;
        case 'ult':
          tl.to([L, R], { rotation: (i: number) => sign(i), duration: 0.3, ease: EASE }, 0)
            .fromTo(q('.done-ring'), { scale: 0.3, opacity: 0.9 }, { scale: 2.2, opacity: 0, duration: 0.8, ease: 'power2.out' }, 0.1)
            .to(B, { y: -8, duration: 0.25, ease: EASE }, 0);
          rest('+=.8');
          break;
        case 'pride':
          tl.to(B, { scale: 1.05, duration: 0.3, ease: EASE }, 0)
            .to(L, { rotation: 22, duration: 0.3 }, 0)
            .to(R, { rotation: -22, duration: 0.3 }, 0)
            .to(B, { scale: 1, duration: 0.4, ease: EASE }, '+=.7');
          rest('<');
          break;
        case 'nod':
          tl.to(H, { y: 7, duration: 0.14, repeat: 3, yoyo: true, ease: 'sine.inOut' });
          break;
        case 'shrug':
          tl.to(L, { rotation: 30, duration: 0.25, ease: EASE }, 0).to(R, { rotation: -30, duration: 0.25, ease: EASE }, 0).to(H, { rotation: 8, duration: 0.25, ease: EASE }, 0);
          rest('+=.7');
          break;
        case 'arms_up':
          tl.to([L, R], { rotation: (i: number) => sign(i), duration: 0.3, ease: EASE });
          rest('+=.8');
          break;
      }
      return new Promise<void>((resolve) => {
        tl.eventCallback('onComplete', () => resolve());
        // Seguro: si el temporizador de GSAP se pausa (pestaña oculta), no se queda esperando para siempre.
        window.setTimeout(resolve, (SVG_GESTURE_SECONDS[name] + 1.5) * 1000);
      });
    },

    dispose() {
      disposed = true;
      if (lipFn) gsap.ticker.remove(lipFn);
      lipFn = null;
      idle?.kill();
      blink?.kill();
      gsap.killTweensOf(root.querySelectorAll('*'));
      root.innerHTML = '';
    },
  };
  return api;
}
