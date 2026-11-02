/**
 * src/components/welcome/bienvenidaMotion.ts
 *
 * Guion GSAP de la bienvenida de Tally Studio, escena por escena. Los tiempos,
 * easings y gestos vienen de los dos artifacts aprobados (tally-studio-anuncio
 * para standby, revelación, «¿por qué tally?» y manifiesto; bienvenida-fundadores
 * para saludo, ventajas y regalo). Un solo motor sirve a las dos variantes:
 * `escenasDe(variante)` decide qué escenas hay y `inicios(variante)` cuándo
 * empieza cada una (src/lib/fundadores.ts).
 *
 * Cada escena tiene una función que añade sus tweens a la línea de tiempo.
 * Con movimiento reducido solo hay fundidos entre escenas. La última escena
 * («cierre») no se retira: se queda hasta que el creador pulsa un botón.
 *
 * Debe llamarse dentro de gsap.context(..., raíz) para que los selectores
 * queden acotados a la bienvenida.
 */

import gsap from 'gsap';
import { escenasDe, inicios, type EscenaId, type VarianteBienvenida } from '../../lib/fundadores';
import { APAGADO_TALLY, ROJO_TALLY } from './tallyMark';

export interface OpcionesLinea {
  variante: VarianteBienvenida;
  reducido: boolean;
  raiz: HTMLElement;
  /** Se llama cuando una escena entra, para anunciarla a lectores de pantalla. */
  alLlegar: (id: EscenaId) => void;
}

type Tl = gsap.core.Timeline;

/** Las partículas que saltan al entregar el emblema. */
function chispas(raiz: HTMLElement) {
  const envoltorio = raiz.querySelector<HTMLElement>('.bt-emblema-wrap');
  if (!envoltorio) return;
  const ancho = raiz.clientWidth;
  const colores = ['#ff2a2a', '#ff4a4a', '#f5f6f8', '#c3c8cf'];
  const n = 16;
  const puntos: HTMLElement[] = [];
  for (let i = 0; i < n; i++) {
    const b = document.createElement('b');
    b.className = 'bt-pt';
    b.style.background = colores[i % colores.length];
    envoltorio.appendChild(b);
    puntos.push(b);
  }
  gsap.fromTo(
    puntos,
    { x: 0, y: 0, opacity: 1, rotation: 0, scale: 1 },
    {
      x: (i: number) => Math.cos((i / n) * 6.283 + Math.random() * 0.4) * ancho * (0.1 + Math.random() * 0.06),
      y: (i: number) => Math.sin((i / n) * 6.283 + Math.random() * 0.4) * ancho * (0.1 + Math.random() * 0.06),
      rotation: () => (Math.random() - 0.5) * 360,
      opacity: 0,
      scale: 0.5,
      duration: 1.2,
      ease: 'power3.out',
      onComplete: () => puntos.forEach((p) => p.remove()),
    }
  );
}

const palabras = (sc: string, clase: string) => `${sc} ${clase} .bt-pal`;

// Cada función recibe: la línea, el inicio de la escena (S), el instante en que ya es visible (B) y las opciones.
type Escena = (tl: Tl, S: number, B: number, o: OpcionesLinea) => void;

const ESCENAS: Record<EscenaId, Escena> = {
  // 1 · Standby: la baliza parpadea y se enciende
  standby: (tl, _S, B) => {
    const sc = '.bt-sc-standby';
    const luz = `${sc} .bt-dome, ${sc} .bt-base`;
    tl.from('.bt-b1', { opacity: 0, y: 14, duration: 0.8 }, B + 0.1)
      .from(`${sc} .bt-st`, { opacity: 0, duration: 0.6 }, B + 0.3)
      .from(palabras(sc, '.bt-hd'), { opacity: 0, yPercent: 50, filter: 'blur(8px)', duration: 0.8, stagger: 0.08, clearProps: 'filter' }, B + 0.5)
      .to(luz, { fill: ROJO_TALLY, duration: 0.04, ease: 'none' }, B + 1.5)
      .to(luz, { fill: APAGADO_TALLY, duration: 0.04, ease: 'none' }, B + 1.62)
      .to(luz, { fill: ROJO_TALLY, duration: 0.04, ease: 'none' }, B + 1.78)
      .to(luz, { fill: APAGADO_TALLY, duration: 0.04, ease: 'none' }, B + 1.95)
      .to(luz, { fill: ROJO_TALLY, duration: 0.04, ease: 'none' }, B + 2.15)
      .to(`${sc} .bt-glow`, { opacity: 1, duration: 0.4, ease: 'power2.out' }, B + 2.15)
      .to(`${sc} .bt-st i`, { backgroundColor: ROJO_TALLY, boxShadow: '0 0 12px #ff2a2a', duration: 0.2 }, B + 2.15)
      .set(`${sc} .bt-rays`, { opacity: 1 }, B + 2.2);
  },

  // 2 · Revelación: destello rojo y corte al nombre
  revelacion: (tl, S, B) => {
    const sc = '.bt-sc-revelacion';
    tl.to('.bt-flood', { opacity: 0.9, duration: 0.1, ease: 'power2.in' }, S)
      .to('.bt-flood', { opacity: 0, duration: 0.7, ease: 'power2.out' }, B + 0.02)
      .from(`${sc} .bt-glow`, { opacity: 0, duration: 0.9, ease: 'power2.out' }, B + 0.02)
      .from(`${sc} .bt-eb`, { opacity: 0, y: 8, duration: 0.6 }, B + 0.2)
      .from(`${sc} .bt-dome, ${sc} .bt-base`, { scale: 0.86, transformOrigin: '50% 100%', duration: 0.7 }, B + 0.1)
      .from(`${sc} .bt-ray`, { strokeDashoffset: 1, duration: 0.5, stagger: 0.06, ease: 'power3.out' }, B + 0.25)
      .from(`${sc} .bt-wm`, { clipPath: 'inset(0 100% 0 0)', duration: 0.9, ease: 'expo.inOut' }, B + 0.35)
      .from(`${sc} .bt-wv`, { strokeDashoffset: 1, duration: 0.5, stagger: 0.12, ease: 'power3.out' }, B + 1.0)
      .from(`${sc} .bt-slogan`, { opacity: 0, y: 10, letterSpacing: '.4em', duration: 0.9 }, B + 1.3)
      .from(`${sc} .bt-es`, { opacity: 0, y: 8, duration: 0.6 }, B + 1.8);
  },

  // 3 · ¿Por qué tally?
  porque: (tl, _S, B) => {
    const sc = '.bt-sc-porque';
    tl.set('.bt-bug', { autoAlpha: 1 }, B)
      .from('.bt-bug', { opacity: 0, x: -10, duration: 0.6 }, B)
      .from(`${sc} .bt-eb`, { opacity: 0, x: -12, duration: 0.6 }, B + 0.05)
      .from(palabras(sc, '.bt-hd'), { opacity: 0, yPercent: 50, filter: 'blur(8px)', duration: 0.8, stagger: 0.06, clearProps: 'filter' }, B + 0.15)
      .from(`${sc} .bt-t`, { opacity: 0, y: 12, filter: 'blur(4px)', duration: 0.7, clearProps: 'filter' }, B + 1.0)
      .from(`${sc} .bt-row`, { opacity: 0, x: 24, duration: 0.7, stagger: 0.12 }, B + 0.5)
      .from(`${sc} .bt-r1 .bt-led`, { backgroundColor: APAGADO_TALLY, boxShadow: '0 0 0 rgba(255,42,42,0)', duration: 0.25, ease: 'power2.out' }, B + 1.9)
      .from(`${sc} .bt-r1`, { backgroundColor: '#1e2227', borderColor: '#2e343b', duration: 0.4 }, B + 1.9)
      .from(`${sc} .bt-r2 .bt-led`, { backgroundColor: APAGADO_TALLY, boxShadow: '0 0 0 rgba(61,220,151,0)', duration: 0.3 }, B + 2.3);
  },

  // 4 · Manifiesto
  manifiesto: (tl, _S, B) => {
    const sc = '.bt-sc-manifiesto';
    tl.from(`${sc} .bt-q1 .bt-pal`, { opacity: 0, yPercent: 40, filter: 'blur(6px)', duration: 0.7, stagger: 0.035, clearProps: 'filter' }, B + 0.1)
      .from(`${sc} .bt-q1 em .bt-pal`, { color: '#f5f6f8', duration: 0.5 }, B + 2.0)
      .from(`${sc} .bt-q2 .bt-pal`, { opacity: 0, y: 8, filter: 'blur(4px)', duration: 0.6, stagger: 0.02, clearProps: 'filter' }, B + 2.6);
  },

  // 5 · Saludo (fundador y cuenta nueva)
  saludo: (tl, _S, B) => {
    const sc = '.bt-sc-saludo';
    tl.from(`${sc} .bt-eyebrow`, { opacity: 0, x: -14, duration: 0.6 }, B)
      .from(palabras(sc, '.bt-h1'), { opacity: 0, yPercent: 55, filter: 'blur(8px)', duration: 0.8, stagger: 0.07, clearProps: 'filter' }, B + 0.1)
      .from(palabras(sc, '.bt-h2'), { opacity: 0, yPercent: 45, filter: 'blur(6px)', duration: 0.8, stagger: 0.06, clearProps: 'filter' }, B + 0.6)
      .from(`${sc} .bt-body`, { opacity: 0, y: 12, filter: 'blur(4px)', duration: 0.7, clearProps: 'filter' }, B + 1.1)
      .from(`${sc} .bt-hi-line`, { scaleX: 0, duration: 0.7 }, B + 1.6);
  },

  // 6 · Ventajas
  ventajas: (tl, _S, B) => {
    const sc = '.bt-sc-ventajas';
    tl.from(`${sc} .bt-eyebrow`, { opacity: 0, x: -14, duration: 0.6 }, B)
      .from(palabras(sc, '.bt-hl3'), { opacity: 0, yPercent: 55, filter: 'blur(8px)', duration: 0.8, stagger: 0.06, clearProps: 'filter' }, B + 0.1)
      .from(`${sc} .bt-feat`, { opacity: 0, y: 18, filter: 'blur(6px)', duration: 0.7, stagger: 0.14, clearProps: 'filter' }, B + 0.6)
      .from(`${sc} .bt-ic-wave line`, { scaleY: 0.2, transformOrigin: '50% 50%', duration: 0.7, stagger: 0.06, ease: 'back.out(2)' }, B + 0.8)
      .fromTo(`${sc} .bt-ic-check`, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.7, ease: 'power3.inOut' }, B + 1.0)
      .from(`${sc} .bt-ic-layer`, { y: -5, opacity: 0, duration: 0.6, stagger: 0.1 }, B + 1.15)
      .from(`${sc} .bt-ic-link`, { scaleX: 0, transformOrigin: '50% 50%', duration: 0.6 }, B + 1.3)
      .from(`${sc} .bt-ic-node`, { scale: 0.5, opacity: 0, transformOrigin: '50% 50%', duration: 0.6, stagger: 0.08 }, B + 1.3);
  },

  // 7 · Cierre: «Estás al aire». El fundador recibe emblema y regalo; la cuenta nueva, la baliza encendida.
  cierre: (tl, _S, B, o) => {
    const sc = '.bt-sc-cierre';
    tl.from(`${sc} .bt-glow`, { opacity: 0, duration: 0.8, ease: 'power2.out' }, B)
      .fromTo('.bt-flood', { opacity: 0 }, { opacity: 0.35, duration: 0.08, ease: 'power2.in' }, B + 0.2)
      .to('.bt-flood', { opacity: 0, duration: 0.6, ease: 'power2.out' }, B + 0.28);
    if (o.variante === 'fundador') {
      tl.from(`${sc} .bt-emblema`, { opacity: 0, scale: 1.14, rotation: -9, filter: 'blur(8px)', duration: 0.9, clearProps: 'filter' }, B + 0.1)
        .fromTo(`${sc} .bt-ring-draw`, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 1.1, ease: 'power3.inOut' }, B + 0.3)
        .fromTo(`${sc} .bt-sheen`, { xPercent: 130 }, { xPercent: -130, duration: 0.9, ease: 'power2.inOut' }, B + 0.75)
        .add(() => chispas(o.raiz), B + 0.7)
        .from(`${sc} .bt-plaque`, { opacity: 0, y: 10, duration: 0.6 }, B + 0.85)
        .from(`${sc} .bt-eyebrow`, { opacity: 0, x: -14, duration: 0.6 }, B + 0.2)
        .from(palabras(sc, '.bt-hl5'), { opacity: 0, yPercent: 60, filter: 'blur(10px)', duration: 0.9, stagger: 0.1, clearProps: 'filter' }, B + 0.3)
        .from(`${sc} .bt-gift-wrap`, { clipPath: 'inset(0 100% 0 0)', duration: 0.9, ease: 'expo.inOut' }, B + 1.2)
        .from(`${sc} .bt-gift-in > *`, { opacity: 0, y: 8, duration: 0.5, stagger: 0.08 }, B + 1.55)
        .from(`${sc} .bt-seg i`, { scaleX: 0, duration: 0.8, stagger: 0.12 }, B + 1.8)
        .from(`${sc} .bt-wave i`, { scaleY: 0.15, duration: 0.7, stagger: 0.06, ease: 'back.out(2)' }, B + 1.9)
        .from(`${sc} .bt-acciones > *`, { opacity: 0, y: 10, duration: 0.6, stagger: 0.1 }, B + 2.3);
    } else {
      tl.from(`${sc} .bt-beacon`, { opacity: 0, y: 12, duration: 0.7 }, B)
        .from(`${sc} .bt-ray`, { strokeDashoffset: 1, duration: 0.5, stagger: 0.06 }, B + 0.25)
        .from(palabras(sc, '.bt-hl5'), { opacity: 0, yPercent: 60, filter: 'blur(10px)', duration: 0.9, stagger: 0.1, clearProps: 'filter' }, B + 0.3)
        .from(`${sc} .bt-pill`, { opacity: 0, y: 10, duration: 0.6 }, B + 1.2)
        .from(`${sc} .bt-acciones > *`, { opacity: 0, y: 10, duration: 0.6, stagger: 0.1 }, B + 1.6);
    }
  },
};

/** Construye la línea de tiempo completa de una variante. Devuelve la línea ya en marcha. */
export function construirLinea(o: OpcionesLinea): Tl {
  const orden = escenasDe(o.variante);
  const ini = inicios(o.variante);
  const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });

  gsap.set(`.bt-sc-${orden[0]}`, { autoAlpha: 1 });

  orden.forEach((id, i) => {
    const S = ini[id] ?? 0;
    const siguiente = i < orden.length - 1 ? ini[orden[i + 1]] : undefined;
    const sc = `.bt-sc-${id}`;
    const hueco = i === 0 ? 0 : id === 'revelacion' ? 0.1 : 0.3;
    const B = S + hueco;

    tl.call(() => o.alLlegar(id), undefined, B);
    if (i > 0) tl.set(sc, { autoAlpha: 1 }, B);
    if (siguiente !== undefined) {
      tl.to(sc, { autoAlpha: 0, y: o.reducido ? 0 : -10, duration: o.reducido ? 0.3 : 0.35, ease: 'power3.out' }, siguiente);
    }
    if (o.reducido) {
      // Solo fundidos: sin desplazamientos, desenfoque ni destellos
      if (id === 'porque') tl.set('.bt-bug', { autoAlpha: 1 }, B);
      if (id === 'standby') {
        tl.set('.bt-sc-standby .bt-dome, .bt-sc-standby .bt-base', { fill: ROJO_TALLY }, B + 2.4)
          .set('.bt-sc-standby .bt-rays', { opacity: 1 }, B + 2.4)
          .set('.bt-sc-standby .bt-glow', { opacity: 1 }, B + 2.4);
      }
      tl.from(sc, { opacity: 0, duration: 0.4, ease: 'power2.out' }, B);
    } else {
      ESCENAS[id](tl, S, B, o);
    }
  });

  return tl;
}
