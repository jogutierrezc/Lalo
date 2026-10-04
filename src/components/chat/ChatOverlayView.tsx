/**
 * src/components/chat/ChatOverlayView.tsx
 *
 * Capa «Chat en vivo». La usan la fuente de navegador de OBS (Widget.tsx) y el
 * monitor de ChatStudio.
 *
 * - React solo pinta el contenedor y sus ajustes (plantilla, lado, tamaño...),
 *   que llegan al CSS como atributos y variables. Los mensajes se añaden y se
 *   quitan a mano dentro de la lista, para que un chat rápido no obligue a
 *   repintar el árbol entero.
 * - Nada de lo que escribe el chat se inserta como HTML: los nodos se crean
 *   uno a uno y el texto entra siempre con textContent.
 * - Ráfagas: los mensajes que llegan muy juntos se añaden en un solo paso y la
 *   pila se mueve una vez. Si el chat va desbordado, los mensajes aparecen sin
 *   coreografía y los más antiguos se quitan sin animar.
 * - Lo que borra la moderación se tacha, se queda un momento y sale.
 */

import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { CHAT_FONTS, ChatSettings, chatNameBackground } from '../../types/chat';
import { inkFor } from '../../utils/appearance';
import { reduced } from '../../utils/alertMotion';
import { stripCheermotes } from '../../utils/moderation';
import { ChatBadge, ChatDisplayMessage, emoteUrl, readableNameColor, splitMessage } from '../../utils/chatFeed';
import '../../styles/chat-efectos.css';
import { ChatMotionOptions, ChatSpecial, chatDelete, chatEnter, chatExit, chatShift, killChat, lookOf } from '../../utils/chatMotion';

export interface ChatOverlayHandle {
  /** Añade un mensaje al final de la pila. */
  push: (message: ChatDisplayMessage) => void;
  /** Quita un mensaje borrado por la moderación (se tacha y sale). */
  remove: (id: string) => void;
  /** Quita todos los mensajes de un usuario expulsado o silenciado. */
  removeUser: (username: string) => void;
  /** Vacía la capa. */
  clear: () => void;
  /** Borra el último mensaje a la vista, como haría un moderador. Devuelve false si no hay ninguno. */
  removeLast: () => boolean;
}

interface ChatOverlayViewProps {
  settings: ChatSettings;
  isStudio?: boolean;
}

interface RowState {
  el: HTMLDivElement;
  message: ChatDisplayMessage;
  timeline: gsap.core.Timeline | null;
  life: gsap.core.Tween | null;
  leaving: boolean;
}

const BADGE_TEXT: Record<ChatBadge, string> = { broadcaster: 'CANAL', mod: 'MOD', vip: 'VIP', sub: 'SUB' };
const DELETED_TEXT = 'mensaje borrado por moderación';
// Los mensajes que llegan dentro de esta ventana se añaden juntos
const FLUSH_MS = 70;
// Más mensajes por segundo que esto y la capa deja la coreografía
const FLOOD_PER_SECOND = 6;
// Filas de más que se toleran mientras salen antes de quitarlas sin animar
const EXTRA_ROWS = 6;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, part?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (part) node.dataset.ch = part;
  return node;
};

/** Palabras sueltas (para animarlas) con sus espacios entre medias. */
function appendWords(parent: HTMLElement, text: string, skipCheermotes: boolean): void {
  text.split(/(\s+)/).forEach((token) => {
    if (!token) return;
    if (/^\s+$/.test(token)) {
      parent.appendChild(document.createTextNode(' '));
      return;
    }
    if (skipCheermotes && stripCheermotes(token) === '') return;
    const word = el('span', 'ch-w');
    word.textContent = token;
    parent.appendChild(word);
  });
}

function emoteImage(id: string, name: string, theme: 'dark' | 'light', giant = false): HTMLImageElement {
  const img = el('img', giant ? 'ch-em ch-em-giant' : 'ch-em');
  const scale = giant ? '3.0' : '2.0';
  let format: 'default' | 'static' = reduced() ? 'static' : 'default';
  img.alt = name;
  img.decoding = 'async';
  img.draggable = false;
  img.onerror = () => {
    if (format === 'default') {
      // Primero se prueba la imagen fija; si tampoco carga, queda la palabra
      format = 'static';
      img.src = emoteUrl(id, theme, 'static', scale);
      return;
    }
    const word = el('span', 'ch-w');
    word.textContent = name;
    img.replaceWith(word);
  };
  img.src = emoteUrl(id, theme, format, scale);
  return img;
}

function buildRow(message: ChatDisplayMessage, settings: ChatSettings): HTMLDivElement {
  const row = el('div', 'ch-row');
  row.dataset.id = message.id;
  if (message.bits > 0) row.dataset.bits = '';
  if (message.subscriber || message.highlighted) row.dataset.hl = 'sub';
  if (message.emoteOnly) row.dataset.big = '';
  if (message.voice) row.dataset.voice = '';
  // Power-ups de Twitch: efecto de mensaje y emote gigante (estilos en chat-efectos.css)
  if (message.effect) row.dataset.fx = message.effect;
  if (message.giant) row.dataset.giant = '';

  const msg = el('div', 'ch-msg', 'msg');
  const clip = el('span', 'ch-clip');
  clip.append(el('span', 'ch-flash', 'flash'), el('span', 'ch-sheen', 'sheen'), el('span', 'ch-bar', 'bar'));
  msg.append(clip, el('span', 'ch-line', 'line'));

  const head = el('span', 'ch-head', 'head');
  message.badges.forEach((badge) => {
    const chip = el('span', 'ch-bdg');
    chip.textContent = BADGE_TEXT[badge];
    head.appendChild(chip);
  });
  if (message.first) {
    const chip = el('span', 'ch-bdg');
    chip.textContent = 'NUEVO';
    head.appendChild(chip);
  }
  if (message.effect || message.giant) {
    const chip = el('span', 'ch-bdg ch-pu');
    chip.textContent = 'POWER-UP';
    head.appendChild(chip);
  }
  if (message.bits > 0) {
    const chip = el('span', 'ch-bits', 'bits');
    chip.dataset.bits = String(message.bits);
    chip.textContent = `${message.bits} bits`;
    head.appendChild(chip);
  }
  const who = el('span', 'ch-who');
  who.textContent = message.user;
  who.style.color = readableNameColor(message.color, message.username, chatNameBackground(settings));
  head.appendChild(who);

  const tx = el('span', 'ch-tx', 'tx');
  const theme = settings.template === 'burbuja' ? 'light' : 'dark';
  const segments = splitMessage(message.text, message.emotes);
  // Twitch agranda el último emote del mensaje
  const giantAt = message.giant ? segments.map((segment) => segment.kind).lastIndexOf('emote') : -1;
  segments.forEach((segment, index) => {
    if (segment.kind === 'emote') tx.appendChild(emoteImage(segment.id, segment.name, theme, index === giantAt));
    else appendWords(tx, segment.value, message.bits > 0);
  });

  const mark = el('i', 'ch-spk');
  mark.textContent = 'VOZ';
  msg.append(head, tx, el('span', 'ch-cur', 'cur'), mark);
  row.appendChild(msg);
  return row;
}

const specialOf = (message: ChatDisplayMessage, settings: ChatSettings): ChatSpecial => {
  if (message.bits > 0 && settings.highlightBits) return 'bits';
  if (message.emoteOnly && settings.bigEmotes) return 'emotes';
  if ((message.subscriber || message.highlighted) && settings.highlightSubs) return 'sub';
  return null;
};

export const ChatOverlayView = forwardRef<ChatOverlayHandle, ChatOverlayViewProps>(({ settings, isStudio = false }, ref) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const rows = useRef(new Map<string, RowState>());
  const pending = useRef<ChatDisplayMessage[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFlush = useRef(0);
  const arrivals = useRef<number[]>([]);
  const trimRef = useRef<() => void>(() => {});

  // El motor vive en una referencia: los métodos leen siempre los ajustes vigentes
  const engine = useRef<ChatOverlayHandle | null>(null);
  if (!engine.current) {
    const motion = (): ChatMotionOptions => {
      const s = settingsRef.current;
      return { look: lookOf(s.template), motion: s.motion, energy: s.energy, side: s.side };
    };
    const gapOf = (list: HTMLElement) => parseFloat(getComputedStyle(list).rowGap) || 0;

    const drop = (state: RowState, settle: boolean) => {
      const list = listRef.current;
      state.timeline?.kill();
      state.life?.kill();
      rows.current.delete(state.message.id);
      if (!list || !state.el.isConnected) return;
      // Las filas de encima bajan a ocupar el hueco con un solo movimiento
      const above: HTMLElement[] = [];
      let sibling = state.el.previousElementSibling;
      while (sibling) {
        above.push(sibling as HTMLElement);
        sibling = sibling.previousElementSibling;
      }
      const height = state.el.offsetHeight + gapOf(list);
      state.el.remove();
      if (settle) chatShift(above, -height, motion());
    };

    const leave = (state: RowState) => {
      if (state.leaving) return;
      state.leaving = true;
      state.life?.kill();
      state.timeline?.kill();
      state.timeline = chatExit(state.el, motion(), () => drop(state, true));
    };

    const moderate = (state: RowState) => {
      if (state.leaving) return;
      state.leaving = true;
      state.life?.kill();
      state.timeline?.kill();
      const swap = () => {
        state.el.dataset.del = '';
        const tx = state.el.querySelector<HTMLElement>('[data-ch="tx"]');
        if (tx) {
          tx.replaceChildren();
          appendWords(tx, DELETED_TEXT, false);
        }
      };
      state.timeline = chatDelete(state.el, motion(), swap, () => {
        state.timeline = chatExit(state.el, motion(), () => drop(state, true));
      });
    };

    const trim = (flooded: boolean) => {
      const max = settingsRef.current.maxMessages;
      const live = Array.from(rows.current.values()).filter((state) => !state.leaving);
      live.slice(0, Math.max(0, live.length - max)).forEach((state) => (flooded ? drop(state, false) : leave(state)));
      // Si las salidas no avanzan (OBS pausa las fuentes ocultas), las más antiguas se quitan sin más
      const all = Array.from(rows.current.values());
      all.slice(0, Math.max(0, all.length - max - EXTRA_ROWS)).forEach((state) => drop(state, false));
    };

    trimRef.current = () => trim(false);

    const flush = () => {
      flushTimer.current = null;
      const list = listRef.current;
      const batch = pending.current.splice(0);
      if (!list || !batch.length) return;
      const now = performance.now();
      lastFlush.current = now;
      arrivals.current = arrivals.current.filter((at) => now - at < 1000).concat(batch.map(() => now));
      const flooded = arrivals.current.length > FLOOD_PER_SECOND;
      const s = settingsRef.current;
      const o = motion();

      const older = Array.from(list.children) as HTMLElement[];
      const added = batch.map((message) => {
        const state: RowState = { el: buildRow(message, s), message, timeline: null, life: null, leaving: false };
        rows.current.set(message.id, state);
        list.appendChild(state.el);
        return state;
      });

      // Una sola medida y un solo movimiento de la pila para todo el lote
      const gap = gapOf(list);
      const delta = added.reduce((sum, state) => sum + state.el.offsetHeight + gap, 0);
      chatShift(older, delta, o, flooded);

      added.forEach((state) => {
        state.timeline = chatEnter(state.el, specialOf(state.message, s), o, flooded);
        if (s.seconds > 0) state.life = gsap.delayedCall(s.seconds, () => leave(state));
      });
      trim(flooded);
    };

    engine.current = {
      push: (message) => {
        if (rows.current.has(message.id) || pending.current.some((item) => item.id === message.id)) return;
        pending.current.push(message);
        // Desbordado antes de pintar: los más antiguos ni se dibujan
        const max = settingsRef.current.maxMessages;
        if (pending.current.length > max) pending.current.splice(0, pending.current.length - max);
        if (flushTimer.current === null) {
          const wait = Math.max(0, FLUSH_MS - (performance.now() - lastFlush.current));
          flushTimer.current = setTimeout(flush, wait);
        }
      },
      remove: (id) => {
        pending.current = pending.current.filter((item) => item.id !== id);
        const state = rows.current.get(id);
        if (state) moderate(state);
      },
      removeUser: (username) => {
        const name = username.toLowerCase();
        pending.current = pending.current.filter((item) => item.username !== name);
        Array.from(rows.current.values())
          .filter((state) => state.message.username === name)
          .forEach(moderate);
      },
      clear: () => {
        pending.current = [];
        Array.from(rows.current.values()).forEach(leave);
      },
      removeLast: () => {
        const last = Array.from(rows.current.values())
          .filter((state) => !state.leaving)
          .pop();
        if (!last) return false;
        moderate(last);
        return true;
      },
    };
  }

  useImperativeHandle(ref, () => engine.current as ChatOverlayHandle, []);

  // Menos mensajes a la vez: los que sobran salen
  useEffect(() => {
    trimRef.current();
  }, [settings.maxMessages]);

  // El color del nombre depende del fondo de la plantilla
  const nameBackground = chatNameBackground(settings);
  useLayoutEffect(() => {
    rows.current.forEach((state) => {
      const who = state.el.querySelector<HTMLElement>('.ch-who');
      if (who) who.style.color = readableNameColor(state.message.color, state.message.username, nameBackground);
    });
  }, [nameBackground]);

  // Al desmontar se detiene todo: temporizadores, tiempos de vida y animaciones
  useEffect(() => {
    const root = rootRef.current;
    const live = rows.current;
    return () => {
      if (flushTimer.current !== null) clearTimeout(flushTimer.current);
      flushTimer.current = null;
      pending.current = [];
      live.forEach((state) => {
        state.timeline?.kill();
        state.life?.kill();
      });
      live.clear();
      if (root) killChat(root);
      listRef.current?.replaceChildren();
    };
  }, []);

  const custom = settings.custom;
  const style: Record<string, string | number> = { '--ch-size': settings.size, '--ch-w': `${settings.width}em` };
  if (settings.template === 'custom') {
    Object.assign(style, {
      '--ch-font': CHAT_FONTS.find((font) => font.id === custom.font)?.stack || CHAT_FONTS[0].stack,
      '--ch-bg': custom.bg,
      '--ch-bga': custom.opacity,
      '--ch-fg': custom.fg,
      '--ch-r': `${custom.radius}em`,
      '--ch-acc': custom.accent,
      '--ch-acc-ink': inkFor(custom.accent),
    });
  }
  const on = (flag: boolean) => (flag ? '' : undefined);

  return (
    <div
      ref={rootRef}
      className="chl"
      data-tpl={settings.template}
      data-side={settings.side}
      data-badges={settings.badges ? '1' : '0'}
      data-hl-subs={on(settings.highlightSubs)}
      data-hl-bits={on(settings.highlightBits)}
      data-big-emotes={on(settings.bigEmotes)}
      data-voice-mark={on(settings.voiceMark)}
      data-studio={on(isStudio)}
      style={style as React.CSSProperties}
      aria-hidden="true"
    >
      <div ref={listRef} className="ch-list" />
    </div>
  );
});

ChatOverlayView.displayName = 'ChatOverlayView';
