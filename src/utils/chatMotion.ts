/**
 * chatMotion.ts
 *
 * Movimiento GSAP de la capa «Chat en vivo». Cada plantilla tiene su propio
 * gesto para los tres momentos de un mensaje: entrar, hacer sitio (la pila
 * sube) y salir. Además hay cuatro entradas genéricas y un trato corto y
 * distinto para los mensajes especiales: suscriptor destacado, bits, solo
 * emotes y borrado por moderación.
 *
 * Reglas de la casa:
 * - La salida siempre dura menos que la entrada.
 * - Solo se animan transform, opacity y clip-path. El desenfoque (filter) se
 *   usa en transiciones cortas de una sola vez y con radios pequeños.
 * - Nada late en bucle. Con «reducir movimiento» solo cambia la opacidad.
 * - La pila se mueve con un único tween que se pisa a sí mismo: una ráfaga de
 *   mensajes la reorienta, no encola movimientos.
 *
 * Las piezas se localizan por data-ch dentro de la fila, de modo que la fuente
 * de OBS y el monitor del estudio comparten el mismo código.
 */

import gsap from 'gsap';
import { reduced } from './alertMotion';
import type { ChatEnergy, ChatMotion, ChatSide, ChatTemplate } from '../types/chat';

export type ChatLook = Exclude<ChatTemplate, 'custom'>;
export type ChatSpecial = 'sub' | 'bits' | 'emotes' | null;

export interface ChatMotionOptions {
  look: ChatLook;
  motion: ChatMotion;
  energy: ChatEnergy;
  side: ChatSide;
}

/** Intensidad: escala la distancia (amp), la duración (time) y el rebote (bounce). */
export const CHAT_ENERGY = {
  calma: { amp: 0.5, time: 1.25, bounce: 0 },
  normal: { amp: 1, time: 1, bounce: 1 },
  hype: { amp: 1.6, time: 0.85, bounce: 1.5 },
} as const;

/** La plantilla personalizada parte de Cabina y usa su movimiento. */
export const lookOf = (template: ChatTemplate): ChatLook => (template === 'custom' ? 'cabina' : template);

const FULL = 'inset(0% 0% 0% 0%)';
const one = (row: HTMLElement, name: string) => row.querySelector<HTMLElement>(`[data-ch="${name}"]`);
const all = (row: HTMLElement, selector: string) => Array.from(row.querySelectorAll<HTMLElement>(selector));
const edge = (side: ChatSide) => (side === 'r' ? 'inset(0% 0% 0% 100%)' : 'inset(0% 100% 0% 0%)');
const back = (strength: number, bounce: number) => (bounce ? `back.out(${(strength * bounce).toFixed(2)})` : 'power3.out');
const spring = (bounce: number) => (bounce ? `elastic.out(${(1 + 0.15 * bounce).toFixed(2)}, 0.45)` : 'power3.out');
const emOf = (row: HTMLElement) => parseFloat(getComputedStyle(row).fontSize) || 16;
const present = <T>(items: (T | null)[]): T[] => items.filter((item): item is T => item !== null);

// ---------- Escritura letra a letra ----------

const MAX_TYPED_CHARS = 160;

/** Parte las palabras en letras (si el mensaje no es muy largo) y devuelve las unidades en orden. */
function splitUnits(row: HTMLElement): HTMLElement[] {
  const words = all(row, '.ch-w');
  const total = words.reduce((sum, word) => sum + (word.textContent || '').length, 0);
  if (total <= MAX_TYPED_CHARS) {
    words.forEach((word) => {
      const chars = Array.from(word.textContent || '');
      word.textContent = '';
      chars.forEach((char) => {
        const span = document.createElement('span');
        span.className = 'ch-c';
        span.textContent = char;
        word.appendChild(span);
      });
    });
  }
  return all(row, total <= MAX_TYPED_CHARS ? '.ch-c, .ch-em' : '.ch-w, .ch-em');
}

/** Devuelve cada palabra a un solo nodo de texto. */
function joinUnits(row: HTMLElement): void {
  all(row, '.ch-w').forEach((word) => {
    if (word.firstElementChild) word.textContent = word.textContent || '';
  });
}

/**
 * La línea se escribe sola. Las letras ya ocupan su sitio (solo cambia su
 * opacidad), así que la altura del mensaje no cambia mientras se escribe.
 * Con cursor, un bloque sigue a la última letra, parpadea dos veces y se va.
 */
function typeLine(tl: gsap.core.Timeline, row: HTMLElement, at: number, time: number, cursor: boolean, perUnit = 0.028): number {
  const units = splitUnits(row);
  if (!units.length) return 0;
  const cur = cursor ? one(row, 'cur') : null;
  const state = { n: 0 };
  let shown = 0;
  const duration = Math.min(1.1, Math.max(0.2, units.length * perUnit)) * time;

  gsap.set(units, { opacity: 0 });
  if (cur) tl.set(cur, { opacity: 1, x: units[0].offsetLeft, y: units[0].offsetTop }, at);
  tl.to(
    state,
    {
      n: units.length,
      duration,
      ease: 'none',
      onUpdate: () => {
        const n = Math.round(state.n);
        if (n === shown) return;
        for (let i = shown; i < n; i += 1) units[i].style.opacity = '1';
        shown = n;
        const last = units[n - 1];
        if (cur && last) gsap.set(cur, { x: last.offsetLeft + last.offsetWidth, y: last.offsetTop });
      },
    },
    at
  );
  const end = at + duration;
  tl.call(
    () => {
      units.forEach((unit) => {
        unit.style.opacity = '';
      });
      joinUnits(row);
    },
    [],
    end + 0.01
  );
  if (cur) {
    // Dos parpadeos y fuera
    [0.14, 0.42].forEach((offset) => {
      tl.set(cur, { opacity: 0 }, end + offset).set(cur, { opacity: 1 }, end + offset + 0.14);
    });
    tl.set(cur, { opacity: 0 }, end + 0.7);
    return duration + 0.7;
  }
  return duration;
}

// ---------- Entrada ----------

/**
 * Entrada de un mensaje. `quick` se usa cuando el chat va en ráfaga: el mensaje
 * aparece con un fundido mínimo para no acumular trabajo.
 */
export function chatEnter(row: HTMLElement, special: ChatSpecial, o: ChatMotionOptions, quick = false): gsap.core.Timeline {
  const tl = gsap.timeline();
  const msg = one(row, 'msg');
  if (!msg) return tl;
  if (reduced() || quick) {
    tl.fromTo(msg, { opacity: 0 }, { opacity: 1, duration: quick ? 0.12 : 0.25, ease: 'power2.out' });
    return tl;
  }

  const E = CHAT_ENERGY[o.energy];
  const T = E.time;
  const dir = o.side === 'r' ? 1 : -1;
  const em = emOf(row);
  const head = one(row, 'head');
  const tx = one(row, 'tx');
  const emotes = all(row, '.ch-em');
  // En un mensaje de solo emotes, los emotes tienen su propia entrada
  const units = all(row, special === 'emotes' ? '.ch-w' : '.ch-w, .ch-em');
  let specialAt = 0.2 * T;

  if (o.motion === 'deslizar') {
    tl.fromTo(msg, { x: dir * 2.6 * em * E.amp, opacity: 0 }, { x: 0, opacity: 1, duration: 0.45 * T, ease: 'expo.out' }, 0);
  } else if (o.motion === 'brotar') {
    tl.fromTo(msg, { scale: 1 - 0.16 * E.amp, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4 * T, ease: back(1.6, E.bounce) }, 0);
    specialAt = 0.4 * T;
  } else if (o.motion === 'aparecer') {
    tl.fromTo(msg, { y: 0.5 * em * E.amp, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35 * T, ease: 'power2.out' }, 0);
  } else if (o.motion === 'escribir') {
    tl.fromTo(msg, { opacity: 0 }, { opacity: 1, duration: 0.15 }, 0);
    specialAt = 0.1 + typeLine(tl, row, 0.1, T, true);
  } else if (o.look === 'cabina') {
    // Rótulo de televisión: la placa se despliega desde el borde y el nombre llega primero
    tl.fromTo(msg, { clipPath: edge(o.side) }, { clipPath: FULL, duration: 0.5 * T, ease: 'expo.out' }, 0);
    if (head) tl.fromTo(head, { x: dir * 1.2 * em * E.amp, opacity: 0 }, { x: 0, opacity: 1, duration: 0.34 * T, ease: 'power3.out' }, 0.04);
    if (tx) tl.fromTo(tx, { opacity: 0 }, { opacity: 1, duration: 0.36 * T, ease: 'power2.out' }, 0.18 * T);
    specialAt = 0.14 * T;
  } else if (o.look === 'burbuja') {
    // El globo crece desde su punta (el origen lo fija el CSS), se pasa un poco y se asienta
    tl.fromTo(
      msg,
      { scaleX: 0.3, scaleY: 0.15, opacity: 0 },
      { scaleX: 1 + 0.05 * E.amp, scaleY: 1 - 0.06 * E.amp, opacity: 1, duration: 0.2 * T, ease: 'power2.out' },
      0
    ).to(msg, { scaleX: 1, scaleY: 1, duration: 0.5 * T, ease: spring(E.bounce) }, 0.2 * T);
    tl.fromTo(present([head, tx]), { opacity: 0 }, { opacity: 1, duration: 0.2 * T, ease: 'power2.out' }, 0.1 * T);
    specialAt = 0.7 * T;
  } else if (o.look === 'subtitulo') {
    // Las palabras suben una a una
    tl.fromTo(msg, { opacity: 0 }, { opacity: 1, duration: 0.01 }, 0);
    if (head) tl.fromTo(head, { y: 0.5 * em * E.amp, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3 * T, ease: 'power3.out' }, 0);
    if (units.length) {
      tl.fromTo(
        units,
        { y: 0.8 * em * E.amp, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.38 * T, ease: 'power3.out', stagger: Math.min(0.045, 0.55 / units.length) },
        0.06
      );
    }
    specialAt = 0.06;
  } else if (o.look === 'cristal') {
    // De borroso y translúcido a nítido, con un único brillo que cruza el cristal
    const sheen = one(row, 'sheen');
    tl.fromTo(
      msg,
      { opacity: 0, scale: 1 - 0.03 * E.amp, filter: `blur(${Math.min(6, 4 * E.amp + 1).toFixed(1)}px)` },
      { opacity: 1, scale: 1, filter: 'blur(0px)', duration: 0.5 * T, ease: 'power2.out' },
      0
    );
    if (sheen) {
      tl.fromTo(sheen, { xPercent: -130, opacity: 1 }, { xPercent: 330, duration: 0.75 * T, ease: 'power2.out' }, 0.18 * T).set(sheen, {
        opacity: 0,
      });
    }
    specialAt = 0.3 * T;
  } else {
    // Terminal: la línea se escribe sola con un cursor de bloque
    tl.fromTo(msg, { opacity: 0 }, { opacity: 1, duration: 0.01 }, 0);
    specialAt = 0.05 + typeLine(tl, row, 0.05, T, true, special === 'emotes' ? 0.09 : 0.028);
  }

  addSpecial(tl, row, special, o, specialAt, emotes);

  // Reposo: la placa vuelve a lo que define el CSS
  tl.set(msg, { clearProps: 'transform,clipPath,filter' });
  return tl;
}

/** Trato propio de cada plantilla para suscriptor destacado, bits y solo emotes. */
function addSpecial(
  tl: gsap.core.Timeline,
  row: HTMLElement,
  special: ChatSpecial,
  o: ChatMotionOptions,
  at: number,
  emotes: HTMLElement[]
): void {
  if (!special) return;
  const E = CHAT_ENERGY[o.energy];
  const T = E.time;
  const em = emOf(row);
  const dir = o.side === 'r' ? 1 : -1;
  const msg = one(row, 'msg');
  const flash = one(row, 'flash');
  const sheen = one(row, 'sheen');

  if (special === 'sub') {
    if (o.look === 'cabina') {
      // La franja sube y parpadea como el piloto de «en el aire»
      const bar = one(row, 'bar');
      if (bar) {
        tl.fromTo(bar, { scaleY: 0 }, { scaleY: 1, duration: 0.25 * T, ease: 'power3.out' }, at).fromTo(
          bar,
          { opacity: 0.25 },
          { opacity: 1, duration: 0.12, repeat: 2, yoyo: true, ease: 'none' },
          at + 0.25 * T
        );
      }
    } else if (o.look === 'burbuja') {
      if (msg && E.bounce) tl.fromTo(msg, { rotation: dir * 4 * E.amp }, { rotation: 0, duration: 0.7, ease: 'elastic.out(1.2, 0.35)' }, at);
    } else if (o.look === 'subtitulo') {
      const line = one(row, 'line');
      if (line) tl.fromTo(line, { scaleX: 0 }, { scaleX: 1, duration: 0.45 * T, ease: 'expo.out' }, at + 0.1);
    } else if (o.look === 'cristal') {
      if (flash) tl.fromTo(flash, { opacity: 0.5 }, { opacity: 0, duration: 0.7, ease: 'power2.out' }, at);
    } else if (flash) {
      // Terminal: dos destellos secos, sin fundido
      [0, 0.16].forEach((offset) => {
        tl.set(flash, { opacity: 0.45 }, at + offset).set(flash, { opacity: 0 }, at + offset + 0.08);
      });
    }
    return;
  }

  if (special === 'bits') {
    const chip = one(row, 'bits');
    if (o.look === 'cabina') {
      // Un barrido claro cruza la placa
      if (flash) {
        tl.fromTo(flash, { clipPath: edge(o.side), opacity: 0.85 }, { clipPath: FULL, duration: 0.3 * T, ease: 'expo.out' }, at).to(flash, {
          opacity: 0,
          duration: 0.35,
          ease: 'power2.out',
        });
      }
    } else if (o.look === 'burbuja') {
      if (msg) tl.fromTo(msg, { scale: 1 + 0.14 * E.amp }, { scale: 1, duration: 0.7, ease: spring(E.bounce) }, at);
    } else if (o.look === 'subtitulo') {
      const words = all(row, '.ch-w');
      if (words.length) {
        tl.fromTo(words, { scale: 1 + 0.5 * E.amp }, { scale: 1, duration: 0.3 * T, ease: 'power4.out', stagger: Math.min(0.045, 0.55 / words.length) }, at);
      }
    } else if (o.look === 'cristal') {
      // El brillo vuelve en sentido contrario
      if (sheen) {
        tl.fromTo(sheen, { xPercent: 330, opacity: 1 }, { xPercent: -130, duration: 0.6 * T, ease: 'power2.out' }, at + 0.55 * T).set(sheen, {
          opacity: 0,
        });
      }
    } else if (chip) {
      // Terminal: la cifra cuenta desde cero, a saltos
      const total = Number(chip.dataset.bits) || 0;
      const state = { v: 0 };
      tl.to(
        state,
        {
          v: total,
          duration: 0.5,
          ease: 'steps(8)',
          onUpdate: () => {
            chip.textContent = `${Math.round(state.v)} bits`;
          },
        },
        at
      );
    }
    if (chip && o.look !== 'terminal') {
      tl.fromTo(chip, { scale: 1.6 }, { scale: 1, duration: 0.4 * T, ease: 'expo.out' }, at + 0.08);
    }
    return;
  }

  if (!emotes.length || o.look === 'terminal' || o.motion === 'escribir') return;
  const step = Math.min(0.08, 0.5 / emotes.length);
  if (o.look === 'burbuja') {
    tl.fromTo(
      emotes,
      { scale: 0, rotation: () => gsap.utils.random(-25, 25) * E.amp },
      { scale: 1, rotation: 0, duration: 0.5 * T, ease: back(2.4, E.bounce), stagger: step },
      at * 0.4
    );
  } else if (o.look === 'subtitulo') {
    tl.fromTo(emotes, { y: -1 * em * E.amp, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 * T, ease: 'power3.out', stagger: step }, at);
  } else if (o.look === 'cristal') {
    tl.fromTo(
      emotes,
      { scale: 1.35, opacity: 0, filter: 'blur(3px)' },
      { scale: 1, opacity: 1, filter: 'blur(0px)', duration: 0.4 * T, ease: 'power2.out', stagger: step, clearProps: 'filter' },
      at
    );
  } else {
    tl.fromTo(emotes, { y: 0.7 * em * E.amp, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35 * T, ease: 'power3.out', stagger: step }, at);
  }
}

// ---------- Salida ----------

/** Salida de un mensaje. Siempre más corta que su entrada. */
export function chatExit(row: HTMLElement, o: ChatMotionOptions, onDone: () => void): gsap.core.Timeline {
  const msg = one(row, 'msg');
  if (!msg) return gsap.timeline().call(onDone);
  const tl = gsap.timeline({ onComplete: onDone });
  if (reduced()) {
    tl.to(msg, { opacity: 0, duration: 0.2 });
    return tl;
  }
  const dir = o.side === 'r' ? 1 : -1;
  const em = emOf(row);

  if (o.motion === 'deslizar') {
    tl.to(msg, { x: dir * 1.4 * em, opacity: 0, duration: 0.22, ease: 'power2.out' });
  } else if (o.motion === 'brotar') {
    tl.to(msg, { scale: 0.9, opacity: 0, duration: 0.18, ease: 'power2.out' });
  } else if (o.motion === 'aparecer' || o.motion === 'escribir') {
    tl.to(msg, { opacity: 0, duration: 0.2, ease: 'power2.out' });
  } else if (o.look === 'cabina') {
    // Se repliega hacia el borde por donde entró
    tl.to(msg, { clipPath: edge(o.side), duration: 0.24, ease: 'power3.out' });
  } else if (o.look === 'burbuja') {
    // Se encoge de vuelta a su punta
    tl.to(msg, { scaleX: 0.25, scaleY: 0.1, opacity: 0, duration: 0.2, ease: 'power2.out' });
  } else if (o.look === 'subtitulo') {
    tl.to(msg, { opacity: 0, y: -0.3 * em, filter: 'blur(4px)', duration: 0.28, ease: 'power2.out' });
  } else if (o.look === 'cristal') {
    // Se disuelve
    tl.to(msg, { opacity: 0, scale: 1.03, filter: 'blur(5px)', duration: 0.3, ease: 'power2.out' });
  } else {
    // Terminal: la línea se cierra de abajo arriba detrás de una máscara
    tl.to(msg, { clipPath: 'inset(0% 0% 100% 0%)', duration: 0.2, ease: 'power3.out' });
  }
  return tl;
}

// ---------- Borrado por moderación ----------

/**
 * Un mensaje borrado no desaparece de golpe: el texto se cambia por el aviso,
 * se queda un momento y luego sale. `swap` cambia el contenido; `onHoldDone`
 * avisa de que ya puede salir.
 */
export function chatDelete(
  row: HTMLElement,
  o: ChatMotionOptions,
  swap: () => void,
  onHoldDone: () => void,
  holdSec = 1.3
): gsap.core.Timeline {
  const msg = one(row, 'msg');
  const tl = gsap.timeline({ onComplete: onHoldDone });
  killRow(row);
  joinUnits(row);
  all(row, '.ch-w, .ch-em, [data-ch]').forEach((el) => gsap.set(el, { clearProps: 'transform,opacity,filter,clipPath' }));
  if (!msg || reduced()) {
    tl.call(swap).to({}, { duration: holdSec });
    return tl;
  }

  const tx = one(row, 'tx');
  if (o.motion !== 'propio') {
    if (tx) tl.to(tx, { opacity: 0, duration: 0.12, ease: 'power2.out' }).call(swap).to(tx, { opacity: 1, duration: 0.2, ease: 'power2.out' });
    else tl.call(swap);
  } else if (o.look === 'cabina') {
    // El rótulo se cierra y vuelve a abrirse con el aviso
    tl.to(msg, { clipPath: edge(o.side), duration: 0.16, ease: 'power3.out' })
      .call(swap)
      .to(msg, { clipPath: FULL, duration: 0.26, ease: 'expo.out' });
  } else if (o.look === 'burbuja') {
    // El globo se desinfla y recupera la forma
    tl.to(msg, { scaleY: 0.7, scaleX: 1.04, duration: 0.12, ease: 'power2.out' })
      .call(swap)
      .to(msg, { scaleY: 1, scaleX: 1, duration: 0.45, ease: 'elastic.out(1.1, 0.5)' });
  } else if (o.look === 'subtitulo') {
    tl.to(msg, { opacity: 0.2, filter: 'blur(4px)', duration: 0.14, ease: 'power2.out' })
      .call(swap)
      .to(msg, { opacity: 1, filter: 'blur(0px)', duration: 0.22, ease: 'power2.out' });
  } else if (o.look === 'cristal') {
    const flash = one(row, 'flash');
    tl.to(msg, { opacity: 0.35, duration: 0.14, ease: 'power2.out' }).call(swap).to(msg, { opacity: 1, duration: 0.25, ease: 'power2.out' });
    if (flash) tl.fromTo(flash, { opacity: 0.35 }, { opacity: 0, duration: 0.5, ease: 'power2.out' }, 0.14);
  } else {
    // Terminal: la línea se borra de un golpe y el aviso se escribe encima
    swap();
    tl.set(msg, { opacity: 0 }, 0).set(msg, { opacity: 1 }, 0.08);
    typeLine(tl, row, 0.09, 0.6, false);
  }
  tl.set(msg, { clearProps: 'transform,clipPath,filter' });
  tl.to({}, { duration: holdSec });
  return tl;
}

// ---------- La pila ----------

/** Curva y duración con las que la pila hace sitio, según la plantilla. */
function stackFeel(o: ChatMotionOptions): { duration: number; ease: string } {
  const E = CHAT_ENERGY[o.energy];
  if (o.motion !== 'propio') return { duration: 0.45 * E.time, ease: 'expo.out' };
  switch (o.look) {
    case 'burbuja':
      return { duration: 0.5 * E.time, ease: back(1.3, E.bounce) };
    case 'subtitulo':
      return { duration: 0.4 * E.time, ease: 'power3.out' };
    case 'cristal':
      return { duration: 0.55 * E.time, ease: 'power2.out' };
    case 'terminal':
      // Como una terminal: la pantalla salta de línea, no se desliza
      return { duration: 0.1, ease: 'steps(2)' };
    default:
      return { duration: 0.45 * E.time, ease: 'expo.out' };
  }
}

/**
 * Mueve las filas `delta` píxeles respecto a donde las deja el navegador y las
 * lleva a su sitio. Parte de donde estén ahora y pisa el tween anterior, así
 * que varias llamadas seguidas dan un solo movimiento continuo.
 * delta > 0: acaba de entrar un mensaje debajo. delta < 0: se quitó uno debajo.
 */
export function chatShift(rows: HTMLElement[], delta: number, o: ChatMotionOptions, quick = false): void {
  if (!rows.length || !delta) return;
  if (reduced()) {
    gsap.killTweensOf(rows);
    gsap.set(rows, { y: 0 });
    return;
  }
  const feel = stackFeel(o);
  gsap.fromTo(
    rows,
    { y: (_index: number, row: HTMLElement) => (Number(gsap.getProperty(row, 'y')) || 0) + delta },
    { y: 0, duration: quick ? Math.min(0.18, feel.duration) : feel.duration, ease: quick ? 'power2.out' : feel.ease, overwrite: true }
  );
}

/** Detiene todo lo que se esté moviendo dentro de una fila. */
export function killRow(row: HTMLElement): void {
  gsap.killTweensOf([row, ...all(row, '*')]);
}

/** Detiene todo el movimiento de la capa (al desmontar). */
export function killChat(root: HTMLElement): void {
  gsap.killTweensOf(all(root, '*'));
}
