/**
 * src/components/mascotas/PetLayer.tsx
 *
 * Capa «Mascotas». La usan la fuente de navegador de OBS (Widget.tsx) y el
 * monitor de PetsStudio.
 *
 * - Reacciona a canjes de puntos, bits, Power-ups, llamadas en el chat, raids y
 *   al silencio del chat. Cada reacción espera su turno: la segunda no pisa a la
 *   primera.
 * - No reproduce audio: pone la frase en la cola de voz del widget (`speak`) y
 *   este le avisa cuando su frase empieza y termina (`voice`). Con el audio en
 *   la mano saca su curva de volumen y mueve la boca con ella.
 * - En el estudio no hay cola de voz: la frase se simula con su duración
 *   estimada, para ver el movimiento y el texto.
 * - Los pasos avanzan con temporizadores, no con el final de las animaciones:
 *   OBS detiene las animaciones de las fuentes ocultas.
 * - Nada de lo que llega del chat o de Twitch se inserta como HTML.
 */

import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { resolveMediaUrl } from '../../lib/mediaRef';
import type { PetEmotion, PetsSettings, PetTriggerId } from '../../types/pets';
import { reduced } from '../../utils/alertMotion';
import { stripEmotionTags } from '../../utils/emotionMapper';
import { findBlockedWord, normalizeUser } from '../../utils/moderation';
import {
  ENVELOPE_FPS,
  PetCue,
  SAMPLE_CUES,
  callsPet,
  cueFromEvent,
  envelopeAt,
  petEmotionOf,
  planCue,
  quietDue,
  speakSeconds,
  volumeEnvelope,
} from '../../utils/petsLogic';
import type { TwitchEvent } from '../../utils/twitchEvents';
import { PetFigure } from './PetFigure';
import { petFaceMarkup, type PetArtKind } from './petArt';

/** Aviso del widget: la frase con ese id empieza a sonar o terminó. */
export interface PetVoiceEvent {
  id: string;
  phase: 'start' | 'end';
  /** Duración prevista, si se sabe. */
  seconds?: number;
  audio?: HTMLAudioElement | null;
  blob?: Blob | null;
}

export interface PetLayerHandle {
  /** Evento del canal de Twitch (canje de puntos o Power-up). */
  event: (event: TwitchEvent) => void;
  /** Cada mensaje del chat: cheers, llamadas a la mascota y el reloj del silencio. */
  chat: (tags: { username?: string; 'display-name'?: string; bits?: string | number }, message: string) => void;
  raid: (channel: string, viewers: number) => void;
  voice: (event: PetVoiceEvent) => void;
  /** Prueba desde el estudio: no mira interruptores ni esperas. */
  test: (cue: PetCue) => void;
  /** Reproduce la entrada o el efecto, para elegirlos en el estudio. */
  preview: (what: 'enter' | 'fx') => void;
  /**
   * Dice una frase tal cual (una alerta de juego): no mira activadores ni esperas, pero sí respeta su
   * turno y el tope de la cola. La voz recibe el texto entero, con su etiqueta de emoción; el bocadillo
   * la enseña sin ella. Devuelve false si no la aceptó (mascota apagada o cola llena).
   */
  say: (text: string) => boolean;
  /** Pone una cara de emoción, con su gesto, para verla en el estudio. Se queda hasta la siguiente frase. */
  emotion: (emotion: PetEmotion) => void;
}

interface PetLayerProps {
  settings: PetsSettings;
  isStudio?: boolean;
  /** Reacciones de ejemplo una y otra vez, para colocar la capa en OBS. */
  demo?: boolean;
  /** Pone la frase en la cola de voz. Devuelve el id del mensaje, o null si no entró. */
  speak?: (text: string, options: { voiceId?: string; front?: boolean }) => string | null;
  /** Mensajes que esperan en la cola de voz: el número, o una función que lo lee en el momento (caja de Studio). */
  queueLength?: number | (() => number);
  blockedWords?: string[];
  blockedUsers?: string[];
  ignoredBots?: string[];
  /** Lo que va pasando, en palabras, para el estudio. */
  onStatus?: (message: string) => void;
}

const QUEUE_MAX = 4;
/** Si la voz no llega a empezar en este tiempo, la reacción se da por perdida. */
const VOICE_WAIT_SECONDS = 90;
const QUIET_CHECK_MS = 15000;
const DEMO_ORDER: PetTriggerId[] = ['points', 'bits', 'raid'];

const WHY: Record<string, string> = {
  off: 'La mascota está apagada.',
  disabled: 'Ese activador está apagado.',
  cooldown: 'Ese activador está en espera.',
  small: 'El cheer no llega al mínimo de bits.',
  no_lines: 'Ese activador no tiene frases escritas.',
};

async function decodeEnvelope(blob: Blob): Promise<number[] | null> {
  try {
    const Ctx: typeof OfflineAudioContext | undefined =
      window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    if (!Ctx) return null;
    // Solo se decodifica: no suena nada por este contexto
    const buffer = await new Ctx(1, 1, 44100).decodeAudioData(await blob.arrayBuffer());
    return volumeEnvelope(buffer.getChannelData(0), buffer.sampleRate, ENVELOPE_FPS);
  } catch {
    return null;
  }
}

export const PetLayer = forwardRef<PetLayerHandle, PetLayerProps>(
  ({ settings, isStudio = false, demo = false, speak, queueLength = 0, blockedWords, blockedUsers, ignoredBots, onStatus }, ref) => {
    const [said, setSaid] = useState<{ id: number; text: string; seconds: number } | null>(null);

    const live = useRef({ settings, speak, queueLength, blockedWords, blockedUsers, ignoredBots, onStatus });
    live.current = { settings, speak, queueLength, blockedWords, blockedUsers, ignoredBots, onStatus };

    const rootRef = useRef<HTMLDivElement | null>(null);
    const inRef = useRef<HTMLDivElement | null>(null);
    const idleRef = useRef<HTMLDivElement | null>(null);
    const figRef = useRef<HTMLDivElement | null>(null);
    const bubRef = useRef<HTMLDivElement | null>(null);
    const fxRef = useRef<HTMLDivElement | null>(null);

    const queueRef = useRef<string[]>([]);
    const busyRef = useRef(false);
    const shownRef = useRef(true);
    const aliveRef = useRef(true);
    const tokenRef = useRef(0);
    const activeRef = useRef<{ token: number; voiceId: string | null; text: string } | null>(null);
    const lastAtRef = useRef<Partial<Record<PetTriggerId, number>>>({});
    const lastChatRef = useRef(0);
    const lastQuietRef = useRef(0);
    const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
    const idleTweenRef = useRef<gsap.core.Tween | null>(null);
    const moveRef = useRef<gsap.core.Timeline | null>(null);
    const mouthRef = useRef<{ raf: number; run: number }>({ raf: 0, run: 0 });
    const gestureRef = useRef<gsap.core.Animation[]>([]);

    // El motor vive en una referencia: sus funciones leen siempre los ajustes vigentes
    const engine = useRef<{
      accept: (cue: PetCue) => void;
      direct: (text: string) => boolean;
      voice: (event: PetVoiceEvent) => void;
      preview: (what: 'enter' | 'fx') => void;
      enter: () => void;
      exit: () => void;
      setIdle: () => void;
      setGestures: () => void;
      showEmotion: (emotion: PetEmotion) => void;
      stop: () => void;
    } | null>(null);

    if (!engine.current) {
      const S = () => live.current.settings;
      const say = (message: string) => live.current.onStatus?.(message);
      const clearTimers = () => {
        timersRef.current.forEach(clearTimeout);
        timersRef.current = [];
      };
      const later = (fn: () => void, seconds: number) => {
        timersRef.current.push(setTimeout(fn, seconds * 1000));
      };

      // ---------- Movimiento ----------
      const offstage = (kind: PetsSettings['enter']): gsap.TweenVars => {
        const top = S().pos[0] === 't';
        const right = S().pos[1] === 'r';
        if (kind === 'asoma') return { yPercent: top ? -115 : 115 };
        if (kind === 'salta') return { yPercent: top ? -115 : -360 };
        if (kind === 'desliza') return { xPercent: right ? 140 : -140, rotation: right ? 10 : -10 };
        return { autoAlpha: 0, scale: 0.9, filter: 'blur(6px)' };
      };
      const REST: gsap.TweenVars = { yPercent: 0, xPercent: 0, rotation: 0, scale: 1, autoAlpha: 1, filter: 'blur(0px)' };

      const enter = () => {
        const el = inRef.current;
        if (!el) return;
        shownRef.current = true;
        moveRef.current?.kill();
        const tl = gsap.timeline();
        moveRef.current = tl;
        if (reduced()) {
          tl.fromTo(el, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2 });
          return;
        }
        const kind = S().enter;
        const [duration, ease] = (
          { asoma: [0.5, 'back.out(1.6)'], salta: [0.75, 'bounce.out'], desliza: [0.6, 'expo.out'], aparece: [0.35, 'power3.out'] } as const
        )[kind];
        tl.fromTo(el, { ...REST, ...offstage(kind) }, { ...REST, duration, ease });
        if (kind === 'salta' && figRef.current) {
          tl.to(figRef.current, { scaleY: 0.86, scaleX: 1.1, duration: 0.09, ease: 'power2.out' }, '-=0.42').to(figRef.current, {
            scaleY: 1,
            scaleX: 1,
            duration: 0.5,
            ease: 'elastic.out(1, 0.4)',
          });
        }
      };

      const exit = () => {
        const el = inRef.current;
        if (!el) return;
        shownRef.current = false;
        moveRef.current?.kill();
        const tl = gsap.timeline();
        moveRef.current = tl;
        if (reduced()) {
          tl.to(el, { autoAlpha: 0, duration: 0.2 });
          return;
        }
        // Sale más rápido de lo que entra; «Salta» se va por abajo, como «Asoma»
        const kind = S().enter === 'salta' ? 'asoma' : S().enter;
        tl.to(el, { ...offstage(kind), duration: 0.28, ease: 'power2.inOut' }).set(el, { autoAlpha: 0 });
      };

      const hop = () => {
        const fig = figRef.current;
        if (!fig || reduced()) return;
        gsap
          .timeline()
          .to(fig, { yPercent: -9, duration: 0.16, ease: 'power2.out' })
          .to(fig, { yPercent: 0, duration: 0.4, ease: 'bounce.out' });
      };

      const playFx = () => {
        const kind = S().fx;
        const root = rootRef.current;
        const box = fxRef.current;
        const pin = inRef.current;
        const fig = figRef.current;
        if (kind === 'nada' || reduced() || !root || !box || !pin || !fig) return;
        if (kind === 'sacudida') {
          gsap.fromTo(fig, { rotation: -8 }, { rotation: 0, duration: 0.8, ease: 'elastic.out(1.2, 0.25)' });
          return;
        }
        const area = root.getBoundingClientRect();
        const body = pin.getBoundingClientRect();
        const cx = body.left - area.left + body.width / 2;
        const cy = body.top - area.top + body.height / 2;
        const spawn = (className: string) => {
          const el = document.createElement('i');
          el.className = className;
          el.style.left = `${cx}px`;
          el.style.top = `${cy}px`;
          box.append(el);
          // Si OBS frena la animación, la chispa se retira igual
          setTimeout(() => el.remove(), 1500);
          return el;
        };
        if (kind === 'onda') {
          gsap.fromTo(spawn('pt-ring'), { scale: 0.4, autoAlpha: 0.9 }, { scale: 2, autoAlpha: 0, duration: 0.8, ease: 'power3.out' });
          return;
        }
        const reach = area.width * 0.16;
        for (let i = 0; i < 14; i += 1) {
          const angle = (Math.PI * 2 * i) / 14 + gsap.utils.random(-0.2, 0.2);
          const distance = reach * gsap.utils.random(0.55, 1);
          gsap.fromTo(
            spawn('pt-spark'),
            { x: 0, y: 0, scale: 1, autoAlpha: 1, rotation: 0 },
            {
              x: Math.cos(angle) * distance,
              y: Math.sin(angle) * distance - reach * 0.2,
              scale: 0.2,
              autoAlpha: 0,
              rotation: gsap.utils.random(-180, 180),
              duration: gsap.utils.random(0.6, 0.9),
              ease: 'power3.out',
            }
          );
        }
      };

      const setIdle = () => {
        idleTweenRef.current?.kill();
        idleTweenRef.current = null;
        const el = idleRef.current;
        if (!el) return;
        gsap.set(el, { clearProps: 'transform' });
        const kind = S().idle;
        if (reduced() || kind === 'quieta') return;
        idleTweenRef.current =
          kind === 'respira'
            ? gsap.to(el, { scaleY: 1.035, scaleX: 0.985, transformOrigin: '50% 100%', duration: 1.6, ease: 'sine.inOut', yoyo: true, repeat: -1 })
            : gsap.to(el, { yPercent: -6, duration: 1.9, ease: 'sine.inOut', yoyo: true, repeat: -1 });
      };

      // ---------- Gesto propio de cada personaje ----------
      const setGestures = () => {
        gestureRef.current.forEach((tween) => tween.kill());
        gestureRef.current = [];
        const svg = figRef.current?.querySelector<SVGSVGElement>('.pt-svg');
        if (!svg || reduced()) return;
        const part = (name: string) => svg.querySelector(`[data-p="${name}"]`);
        const loop = { ease: 'sine.inOut', yoyo: true, repeat: -1 };
        const add = (tween: gsap.core.Animation) => gestureRef.current.push(tween);
        const sway = (name: string, from: number, to: number, origin: string, duration: number) => {
          const el = part(name);
          if (el) add(gsap.fromTo(el, { rotation: from }, { rotation: to, svgOrigin: origin, duration, ...loop }));
        };
        const wave = (origin: string, rotation: number, duration: number, repeatDelay: number) => {
          const el = part('arm');
          if (el) add(gsap.to(el, { rotation, svgOrigin: origin, duration, repeatDelay, ...loop }));
        };
        const kind = svg.dataset.pet;
        if (kind === 'chispa') {
          const body = part('body');
          if (body) add(gsap.to(body, { skewX: 2.5, svgOrigin: '100 184', duration: 1.1, ...loop }));
          add(gsap.to(svg.querySelectorAll('[data-p="sparks"] path'), { scale: 0.5, autoAlpha: 0.4, transformOrigin: '50% 50%', duration: 0.7, stagger: 0.25, ...loop }));
          wave('150 120', -22, 0.5, 0.9);
        }
        if (kind === 'eco') {
          add(gsap.fromTo(svg.querySelectorAll('[data-p="waves"] > g'), { autoAlpha: 0.15 }, { autoAlpha: 1, duration: 0.6, stagger: 0.2, ...loop }));
          wave('164 110', -20, 0.5, 1.1);
        }
        if (kind === 'bit') {
          sway('antenna', -9, 9, '100 36', 1.3);
          wave('132 150', -14, 0.9, 1.4);
        }
        if (kind === 'miso') {
          sway('tail', -7, 9, '150 166', 1.5);
          const ear = part('ear');
          // La oreja se sacude de vez en cuando
          if (ear) {
            add(gsap.timeline({ repeat: -1, repeatDelay: 4.2, delay: 2.5 }).to(ear, { rotation: -12, svgOrigin: '62 86', duration: 0.12, ease: 'sine.inOut', yoyo: true, repeat: 3 }));
          }
        }
        if (kind === 'axo') {
          sway('gl', -6, 6, '48 100', 1.4);
          sway('gr', 6, -6, '152 100', 1.4);
          sway('tail', -8, 8, '124 168', 1.6);
        }
      };

      // ---------- Cara de emoción ----------
      const setFace = (emotion: PetEmotion) => {
        const fig = figRef.current;
        if (!fig) return;
        const svg = fig.querySelector<SVGSVGElement>('.pt-svg');
        const face = svg?.querySelector('[data-p="face"]');
        // El dibujo de la cara es texto fijo de petArt.ts
        if (svg && face) face.innerHTML = petFaceMarkup((svg.dataset.pet as PetArtKind) || 'chispa', emotion);
        // Personaje propio: solo si subió una imagen para esa emoción
        if (emotion !== 'neutral' && fig.querySelector(`.pt-img[data-s="emo-${emotion}"]`)) fig.dataset.emo = emotion;
        else delete fig.dataset.emo;
      };

      /** El cuerpo acompaña a la cara: cada emoción tiene su gesto. */
      const emote = (emotion: PetEmotion) => {
        const fig = figRef.current;
        if (!fig || reduced() || emotion === 'neutral') return;
        const tl = gsap.timeline();
        if (emotion === 'feliz') tl.to(fig, { yPercent: -6, duration: 0.16, ease: 'power2.out' }).to(fig, { yPercent: 0, duration: 0.4, ease: 'bounce.out' });
        if (emotion === 'emocionado') tl.to(fig, { yPercent: -9, duration: 0.12, ease: 'power2.out', yoyo: true, repeat: 3 });
        if (emotion === 'triste') {
          tl.to(fig, { scaleY: 0.93, scaleX: 1.03, duration: 0.5, ease: 'power2.out' }).to(fig, { scaleY: 1, scaleX: 1, duration: 0.8, ease: 'power2.inOut' }, '+=0.7');
        }
        if (emotion === 'enojado') tl.fromTo(fig, { x: -4 }, { x: 4, duration: 0.06, ease: 'none', yoyo: true, repeat: 7 }).to(fig, { x: 0, duration: 0.1 });
        if (emotion === 'sorprendido') tl.to(fig, { scale: 1.09, duration: 0.12, ease: 'power2.out' }).to(fig, { scale: 1, duration: 0.5, ease: 'elastic.out(1, 0.4)' });
      };

      const showEmotion = (emotion: PetEmotion) => {
        if (busyRef.current) return;
        if (!shownRef.current) enter();
        setFace(emotion);
        emote(emotion);
      };

      // ---------- Boca ----------
      const stopMouth = () => {
        mouthRef.current.run += 1;
        cancelAnimationFrame(mouthRef.current.raf);
        const fig = figRef.current;
        if (!fig) return;
        delete fig.dataset.talk;
        const mouth = fig.querySelector('.pt-m');
        if (mouth) gsap.to(mouth, { scaleY: 1, scaleX: 1, duration: 0.12 });
        gsap.to(fig, { yPercent: 0, duration: 0.15 });
      };

      const startMouth = (audio: HTMLAudioElement | null, blob: Blob | null) => {
        stopMouth();
        const fig = figRef.current;
        if (!fig) return;
        const run = mouthRef.current.run;
        const mouth = fig.querySelector('.pt-m');
        // Con la imagen de una emoción puesta, la de hablar no se alterna: el personaje se mueve con la voz
        const hasTalkImage = !fig.dataset.emo && fig.querySelector('.pt-img[data-s="talk"]') !== null;
        // Un GIF de hablar se deja correr entero; una imagen fija sigue el volumen
        const wholeTime = /\.gif($|\?)/i.test(S().talkImage?.url ?? '') || /\.gif$/i.test(S().talkImage?.name ?? '');
        const still = reduced();
        let envelope: number[] | null = null;
        if (blob && audio) {
          decodeEnvelope(blob).then((found) => {
            if (mouthRef.current.run === run) envelope = found;
          });
        }
        const started = performance.now();
        let level = 0;
        let switchedAt = 0;
        const tick = () => {
          if (mouthRef.current.run !== run) return;
          const now = performance.now();
          const t = (now - started) / 1000;
          // Sin curva (voz del navegador, estudio) la boca se mueve con un ritmo de habla genérico
          const target = envelope && audio ? envelopeAt(envelope, audio.currentTime) : 0.3 + 0.7 * Math.abs(Math.sin(t * 9.5) * Math.sin(t * 3.1));
          level += (target - level) * 0.5;
          if (mouth) {
            gsap.set(mouth, { scaleY: 0.4 + level * 1.3, scaleX: 1 - level * 0.15, transformOrigin: '50% 30%' });
          } else if (hasTalkImage) {
            const open = wholeTime || level > 0.2;
            if ((fig.dataset.talk === '1') !== open && now - switchedAt > 80) {
              switchedAt = now;
              if (open) fig.dataset.talk = '1';
              else delete fig.dataset.talk;
            }
          } else if (!still) {
            gsap.set(fig, { yPercent: -level * 4 });
          }
          mouthRef.current.raf = requestAnimationFrame(tick);
        };
        mouthRef.current.raf = requestAnimationFrame(tick);
      };

      // ---------- Turnos ----------
      const finish = (token: number) => {
        if (activeRef.current?.token !== token) return;
        activeRef.current = null;
        clearTimers();
        busyRef.current = false;
        if (aliveRef.current) pump();
      };

      const end = (token: number) => {
        if (activeRef.current?.token !== token) return;
        clearTimers();
        stopMouth();
        later(() => {
          setFace('neutral');
          if (bubRef.current) gsap.to(bubRef.current, { autoAlpha: 0, scale: 0.96, duration: 0.18, ease: 'power2.out' });
          later(() => {
            if (aliveRef.current) setSaid(null);
            if (S().stay === 'talk') exit();
            later(() => finish(token), S().stay === 'talk' ? 0.35 : 0.1);
          }, 0.2);
        }, 0.7);
      };

      const begin = (token: number, seconds: number | undefined, audio: HTMLAudioElement | null, blob: Blob | null) => {
        const active = activeRef.current;
        if (!active || active.token !== token) return;
        clearTimers();
        // Las etiquetas de emoción son para la voz: ni se enseñan ni cuentan para la duración estimada
        const shown = stripEmotionTags(active.text);
        const length = seconds && Number.isFinite(seconds) && seconds > 0 ? seconds : speakSeconds(shown);
        setSaid({ id: token, text: shown, seconds: length });
        // La cara de la emoción de la frase se queda mientras habla
        const emotion = petEmotionOf(active.text);
        setFace(emotion);
        emote(emotion);
        startMouth(audio, blob);
        // En el estudio nadie avisa del final; en OBS es una red por si el aviso no llega
        later(() => end(token), active.voiceId ? length + 20 : length);
      };

      const run = (text: string) => {
        busyRef.current = true;
        tokenRef.current += 1;
        const token = tokenRef.current;
        setSaid(null);
        if (shownRef.current) hop();
        else enter();
        later(playFx, 0.05);

        const speakNow = live.current.speak;
        if (!speakNow) {
          activeRef.current = { token, voiceId: null, text };
          later(() => begin(token, undefined, null, null), 0.4);
          return;
        }
        const voiceId = speakNow(text, { voiceId: S().voiceId || undefined, front: S().turn === 'primero' });
        if (!voiceId) {
          activeRef.current = { token, voiceId: null, text };
          finish(token);
          return;
        }
        activeRef.current = { token, voiceId, text };
        later(() => {
          if (S().stay === 'talk') exit();
          finish(token);
        }, VOICE_WAIT_SECONDS);
      };

      const pump = () => {
        if (busyRef.current) return;
        const next = queueRef.current.shift();
        if (next) run(next);
      };

      const accept = (cue: PetCue) => {
        const s = S();
        const now = Date.now();
        if (!cue.test) {
          if (cue.login && (live.current.blockedUsers ?? []).includes(cue.login)) return;
          if (cue.viewerText && findBlockedWord(cue.viewerText, live.current.blockedWords ?? [])) return;
        }
        const plan = planCue(cue, s, { now, lastAt: lastAtRef.current[cue.trigger] });
        if (plan.ok === false) {
          say(WHY[plan.why]);
          return;
        }
        const waiting = typeof live.current.queueLength === 'function' ? live.current.queueLength() : live.current.queueLength;
        if (!cue.test && s.turn === 'calla' && waiting > 0) {
          say('Hay mensajes esperando en la cola de voz: la mascota calla.');
          return;
        }
        if (queueRef.current.length >= QUEUE_MAX) {
          say('La mascota ya tiene varias reacciones esperando: esta se descarta.');
          return;
        }
        if (!cue.test) lastAtRef.current[cue.trigger] = now;
        queueRef.current.push(plan.text);
        say(`${s.name} dice: «${stripEmotionTags(plan.text)}»`);
        pump();
      };

      const direct = (text: string): boolean => {
        const line = text.trim();
        if (!line || !S().enabled) return false;
        if (queueRef.current.length >= QUEUE_MAX) {
          say('La mascota ya tiene varias reacciones esperando: esta se descarta.');
          return false;
        }
        queueRef.current.push(line);
        say(`${S().name} dice: «${stripEmotionTags(line)}»`);
        pump();
        return true;
      };

      const voice = (event: PetVoiceEvent) => {
        const active = activeRef.current;
        if (!active || active.voiceId !== event.id) return;
        if (event.phase === 'start') begin(active.token, event.seconds, event.audio ?? null, event.blob ?? null);
        else end(active.token);
      };

      const preview = (what: 'enter' | 'fx') => {
        if (busyRef.current) return;
        if (what === 'fx') {
          if (!shownRef.current) enter();
          playFx();
          return;
        }
        busyRef.current = true;
        if (shownRef.current) exit();
        later(enter, 0.45);
        later(() => {
          if (S().stay === 'talk') exit();
          busyRef.current = false;
          pump();
        }, 1.6);
      };

      const stop = () => {
        clearTimers();
        stopMouth();
        idleTweenRef.current?.kill();
        moveRef.current?.kill();
        gestureRef.current.forEach((tween) => tween.kill());
        gestureRef.current = [];
        queueRef.current = [];
        busyRef.current = false;
        activeRef.current = null;
      };

      engine.current = { accept, direct, voice, preview, enter, exit, setIdle, setGestures, showEmotion, stop };
    }

    useImperativeHandle(
      ref,
      () => ({
        event: (event) => {
          const cue = cueFromEvent(event, live.current.settings);
          if (cue) engine.current?.accept(cue);
        },
        chat: (tags, message) => {
          const login = normalizeUser(tags.username);
          if (login && (live.current.ignoredBots ?? []).includes(login)) return;
          lastChatRef.current = Date.now();
          const user = tags['display-name'] || tags.username || 'Alguien';
          const bits = Number(tags.bits);
          if (Number.isFinite(bits) && bits > 0) {
            engine.current?.accept({ trigger: 'bits', values: { user, bits }, login, viewerText: message });
            return;
          }
          const s = live.current.settings;
          const rest = callsPet(message, s.name, s.command);
          if (rest !== null) engine.current?.accept({ trigger: 'mention', values: { user, mensaje: rest }, login, viewerText: message });
        },
        raid: (channel, viewers) => engine.current?.accept({ trigger: 'raid', values: { user: channel, personas: viewers } }),
        voice: (event) => engine.current?.voice(event),
        test: (cue) => engine.current?.accept({ ...cue, test: true }),
        preview: (what) => engine.current?.preview(what),
        say: (text) => engine.current?.direct(text) ?? false,
        emotion: (emotion) => engine.current?.showEmotion(emotion),
      }),
      []
    );

    // Con «solo cuando habla», la mascota empieza fuera de pantalla
    useLayoutEffect(() => {
      if (settings.stay === 'talk' && inRef.current) {
        gsap.set(inRef.current, { autoAlpha: 0 });
        shownRef.current = false;
      }
      // Solo al montar: los cambios posteriores los atiende el efecto de abajo
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const firstStayRef = useRef(true);
    useEffect(() => {
      if (firstStayRef.current) {
        firstStayRef.current = false;
        return;
      }
      if (busyRef.current) return;
      if (settings.stay === 'always' && !shownRef.current) engine.current?.enter();
      if (settings.stay === 'talk' && shownRef.current) engine.current?.exit();
    }, [settings.stay]);

    // Al cambiar de esquina, la mascota se recoloca sin arrastrar el desplazamiento de la entrada
    useLayoutEffect(() => {
      if (!inRef.current) return;
      gsap.set(inRef.current, { clearProps: 'transform,filter' });
      if (!shownRef.current) gsap.set(inRef.current, { autoAlpha: 0 });
    }, [settings.pos]);

    useEffect(() => {
      engine.current?.setIdle();
    }, [settings.idle, settings.kind]);

    // Cada personaje de Lalo tiene su gesto: se rehace al cambiar de personaje
    useEffect(() => {
      engine.current?.setGestures();
    }, [settings.kind]);

    // Parpadeo de los personajes de Lalo
    useEffect(() => {
      let call: gsap.core.Tween | null = null;
      const blink = () => {
        const eyes = figRef.current?.querySelector('.pt-e');
        if (eyes && !reduced()) gsap.to(eyes, { scaleY: 0.08, transformOrigin: '50% 60%', duration: 0.07, yoyo: true, repeat: 1 });
        call = gsap.delayedCall(gsap.utils.random(2.2, 5), blink);
      };
      call = gsap.delayedCall(2, blink);
      return () => {
        call?.kill();
      };
    }, []);

    // Palabras al ritmo de la voz
    useLayoutEffect(() => {
      const bubble = bubRef.current;
      if (!said || !bubble) return;
      const still = reduced();
      const words = bubble.querySelectorAll('.pt-w');
      const tl = gsap.timeline();
      tl.fromTo(bubble, { autoAlpha: 0, scale: 0.9 }, { autoAlpha: 1, scale: 1, duration: still ? 0.15 : 0.28, ease: still ? 'power2.out' : 'back.out(1.8)' });
      if (words.length > 0) {
        tl.fromTo(
          words,
          { autoAlpha: 0, y: still ? 0 : '0.3em' },
          { autoAlpha: 1, y: 0, duration: 0.22, ease: 'power3.out', stagger: (said.seconds * 0.75) / words.length },
          0
        );
      }
      // Si OBS frena la animación con la fuente oculta, el texto queda entero igual
      const timer = setTimeout(() => {
        tl.progress(1);
      }, said.seconds * 1000);
      return () => {
        clearTimeout(timer);
        tl.kill();
      };
    }, [said]);

    // El silencio del chat (solo en directo: en el estudio no hay chat)
    useEffect(() => {
      if (isStudio) return;
      const timer = setInterval(() => {
        const s = live.current.settings;
        const now = Date.now();
        if (!s.triggers.quiet.on || !quietDue(lastChatRef.current, lastQuietRef.current, now, s.quietMinutes)) return;
        lastQuietRef.current = now;
        engine.current?.accept({ trigger: 'quiet', values: {} });
      }, QUIET_CHECK_MS);
      return () => clearInterval(timer);
    }, [isStudio]);

    // demo=1: reacciones de ejemplo que se repiten
    useEffect(() => {
      if (!demo) return;
      let step = 0;
      const next = () => {
        engine.current?.accept(SAMPLE_CUES[DEMO_ORDER[step % DEMO_ORDER.length]]);
        step += 1;
      };
      const first = setTimeout(next, 800);
      const timer = setInterval(next, 9000);
      return () => {
        clearTimeout(first);
        clearInterval(timer);
      };
    }, [demo]);

    useEffect(() => {
      aliveRef.current = true;
      return () => {
        aliveRef.current = false;
        engine.current?.stop();
      };
    }, []);

    const idleUrl = settings.idleImage ? resolveMediaUrl(settings.idleImage.url) : undefined;
    const talkUrl = settings.talkImage ? resolveMediaUrl(settings.talkImage.url) : undefined;
    const emotionUrls = useMemo(() => {
      const urls: Partial<Record<PetEmotion, string>> = {};
      Object.entries(settings.emotionImages).forEach(([emotion, image]) => {
        const url = image ? resolveMediaUrl(image.url) : null;
        if (url) urls[emotion as PetEmotion] = url;
      });
      return urls;
    }, [settings.emotionImages]);
    const words = useMemo(() => (said ? said.text.split(/\s+/).filter(Boolean) : []), [said]);

    return (
      <div
        ref={rootRef}
        className="ptl"
        data-studio={isStudio ? '' : undefined}
        aria-hidden="true"
        style={{ '--pt-w': `${settings.size}em`, '--pt-c': settings.color } as React.CSSProperties}
      >
        <div ref={fxRef} className="pt-fx" />
        <div className="pt" data-pos={settings.pos}>
          <div ref={inRef} className="pt-in">
            <div ref={idleRef} className="pt-idle">
              <div ref={figRef} className="pt-fig">
                <PetFigure
                  kind={settings.kind}
                  color={settings.color}
                  idleUrl={idleUrl || undefined}
                  talkUrl={talkUrl || undefined}
                  emotionUrls={emotionUrls}
                />
              </div>
            </div>
          </div>
          {said && settings.bubble !== 'none' && (
            <div ref={bubRef} key={said.id} className="pt-bub" data-style={settings.bubble}>
              <span className="pt-name">{settings.name}</span>
              <span className="pt-text">
                {words.map((word, index) => (
                  <React.Fragment key={index}>
                    <span className="pt-w">{word}</span>{' '}
                  </React.Fragment>
                ))}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }
);

PetLayer.displayName = 'PetLayer';
