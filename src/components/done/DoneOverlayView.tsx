/**
 * src/components/done/DoneOverlayView.tsx
 *
 * El overlay de Done: el personaje, la tarjeta del espectador, el «pensando» y el texto de la
 * respuesta con el estilo elegido (los mismos de la voz del chat: AlertCard + alertMotion), todo
 * con GSAP. Lo usan igual la fuente de OBS (modo «live», con voz) y la vista previa de la ventana
 * de configuración (modo «preview», sin voz ni chat real). Su fondo es transparente.
 *
 * Una frase sigue estos pasos: tarjeta del espectador → pensando → texto con efecto de escritura
 * mientras el personaje cambia de cara, hace su gesto y enciende su tally al hablar → salida.
 * Con audio, la boca sigue el volumen de la voz (AnalyserNode, RMS). Con «reducir movimiento»
 * solo hay fundidos y no hay gestos.
 */

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { AlertCard } from '../AlertCard';
import { playEnter, playExit, startSpeaking, stopSpeaking, type MotionOptions } from '../../utils/alertMotion';
import type { AlertPosition } from '../../utils/appearance';
import { doneSynthesize, type DoneVoice } from '../../lib/doneClient';
import type { DoneEmotion, DoneGesture, DoneSettings, DoneSpeech } from '../../lib/doneTypes';
import {
  DONE_EMOTION_LABEL,
  DONE_EMOTION_TAG,
  SpeechQueue,
  audioVolume,
  cardKindOf,
  gestureAllowed,
  normalizeTextStyle,
  rmsOf,
  spokenSeconds,
  stageLayout,
  typingSeconds,
  viewerColor,
  type CardKind,
  type CharacterSpec,
} from './doneLogic';
import { CharacterView } from './CharacterView';
import type { ActorApi } from './renderers/types';
import '../../styles/done.css';

export type OverlayStep = 0 | 1 | 2 | 3 | 4;

export interface PushExtra {
  /** Lo que escribió el espectador (para la tarjeta). */
  ask?: string;
  /** Milisegundos de «pensando» antes de responder (la vista previa simula la espera de la IA). */
  thinkMs?: number;
}

export interface DoneOverlayHandle {
  /** Encola una frase. Las repetidas (mismo id) se ignoran. */
  push(speech: DoneSpeech, extra?: PushExtra): void;
  /** Cambia la cara un momento (vista previa). */
  emote(emotion: DoneEmotion): void;
  /** Hace un gesto si el personaje lo permite (vista previa). */
  gesture(gesture: DoneGesture): void;
  /** Para lo que suena y vacía la cola. */
  clear(): void;
}

export interface DoneOverlayViewProps {
  settings: DoneSettings;
  spec: CharacterSpec;
  mode: 'live' | 'preview';
  /** Clave de OBS: para el GLB y para la voz. */
  widgetKey?: string;
  voice?: DoneVoice | null;
  /** Reproducir la voz. En la vista previa es siempre false. */
  audio?: boolean;
  background?: 'game' | 'clear';
  showDebug?: boolean;
  /** Aviso de licencia (Riot Games), con el texto exacto del servidor. */
  licenseNotice?: string | null;
  onStep?: (step: OverlayStep) => void;
  /** Cuando la respuesta empieza a mostrarse (la vista previa la añade al chat simulado). */
  onSpeechStart?: (speech: DoneSpeech) => void;
  onFallback?: (reason: string) => void;
  onQueue?: (waiting: number) => void;
}

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';
export const prefersReducedMotion = (): boolean => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(REDUCED_QUERY).matches;

const wait = (seconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, seconds * 1000));
const ACCENT = '#ff2a2a';

/** Posición del aviso de texto según el lado del personaje (define de dónde entra la tarjeta). */
const alertPosition = (position: DoneSettings['position'], styleId: string): AlertPosition => (styleId === 'subtitulo' ? 'bc' : position === 'left' ? 'bl' : position === 'center' ? 'bc' : 'br');

interface Card {
  kind: Exclude<CardKind, 'none'>;
  viewer: string | null;
  ask: string | null;
}

interface Segment {
  key: string;
  text: string;
  emotion: DoneEmotion;
  name: string;
}

/** Aparición palabra a palabra al ritmo de «letras por segundo» (los estilos de diálogo escriben carácter a carácter por su cuenta). */
function revealWords(card: HTMLElement, cps: number) {
  const words = Array.from(card.querySelectorAll<HTMLElement>('.msg-word'));
  if (words.length === 0) return;
  gsap.killTweensOf(words);
  gsap.set(words, { opacity: 0, clearProps: 'transform,filter' });
  let chars = 0;
  for (const word of words) {
    gsap.to(word, { opacity: 1, duration: 0.14, delay: chars / cps, ease: 'none', overwrite: false });
    chars += (word.textContent?.length ?? 0) + 1;
  }
}

const TYPED_STYLES = new Set(['dialogo', 'arcadeDialogo', 'aventuraDialogo']);

export const DoneOverlayView = forwardRef<DoneOverlayHandle, DoneOverlayViewProps>(function DoneOverlayView(props, ref) {
  const { mode, spec, widgetKey, background = 'game', showDebug = false, licenseNotice, onFallback } = props;
  const settingsRef = useRef(props.settings);
  settingsRef.current = props.settings;
  const propsRef = useRef(props);
  propsRef.current = props;

  const { settings } = props;
  const styleId = normalizeTextStyle(settings.textStyle);
  const layout = stageLayout(settings.obsSize, settings.position);
  const reducedRef = useRef(prefersReducedMotion());

  const actorRef = useRef<ActorApi>(null);
  const vqRef = useRef<HTMLDivElement>(null);
  const thinkRef = useRef<HTMLDivElement>(null);
  const textCardRef = useRef<HTMLDivElement>(null);

  const [card, setCard] = useState<Card | null>(null);
  const [thinking, setThinking] = useState(false);
  const [segment, setSegment] = useState<Segment | null>(null);
  const [dbg, setDbg] = useState<{ emotion: string; gesture: string }>({ emotion: 'normal', gesture: '—' });

  const queue = useRef(new SpeechQueue());
  const extras = useRef(new Map<string, PushExtra>());
  const running = useRef(false);
  const epoch = useRef(0);
  const alive = useRef(true);
  const audioContext = useRef<AudioContext | null>(null);
  const activeAudio = useRef<HTMLAudioElement | null>(null);

  const step = useCallback((n: OverlayStep) => propsRef.current.onStep?.(n), []);

  /* ----- Voz: reproduce el audio y mueve la boca con su volumen (RMS) ----- */
  const playAudio = useCallback(async (blob: Blob): Promise<number> => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.volume = audioVolume(settingsRef.current.voiceVolume);
    activeAudio.current = audio;
    let meter: number | null = null;
    const started = performance.now();
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        audioContext.current = audioContext.current ?? new Ctx();
        const context = audioContext.current;
        if (context.state === 'suspended') await context.resume().catch(() => undefined);
        if (context.state === 'running') {
          const source = context.createMediaElementSource(audio);
          const analyser = context.createAnalyser();
          analyser.fftSize = 512;
          source.connect(analyser);
          analyser.connect(context.destination);
          const data = new Uint8Array(analyser.fftSize);
          meter = window.setInterval(() => {
            analyser.getByteTimeDomainData(data);
            actorRef.current?.setMouth(rmsOf(data));
          }, 33);
        }
      }
    } catch {
      // Sin analizador, la voz suena igual y la boca se mueve sola.
    }
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      audio.addEventListener('ended', done, { once: true });
      audio.addEventListener('error', done, { once: true });
      audio.play().catch(() => resolve());
    });
    if (meter !== null) window.clearInterval(meter);
    activeAudio.current = null;
    URL.revokeObjectURL(url);
    return (performance.now() - started) / 1000;
  }, []);

  const motion = (): MotionOptions => {
    const s = settingsRef.current;
    const id = normalizeTextStyle(s.textStyle);
    return { style: id, position: alertPosition(s.position, id), energy: 'normal', accent: ACCENT };
  };

  /* ----- Una frase, de principio a fin ----- */
  const hideChrome = useCallback(async (myEpoch: number) => {
    const els = [vqRef.current, thinkRef.current].filter(Boolean) as HTMLElement[];
    const reduced = reducedRef.current;
    const textCard = textCardRef.current?.querySelector<HTMLElement>('.al') ?? null;
    await new Promise<void>((resolve) => {
      let pending = 1;
      const finish = () => {
        pending -= 1;
        if (pending <= 0) resolve();
      };
      if (els.length) gsap.to(els, { opacity: 0, y: reduced ? 0 : -6, duration: reduced ? 0.15 : 0.22, ease: 'power2.out' });
      if (textCard) {
        pending += 1;
        playExit(textCard, motion(), finish);
      }
      window.setTimeout(finish, 300);
      window.setTimeout(resolve, 700);
    });
    if (myEpoch !== epoch.current) return;
    setCard(null);
    setSegment(null);
    setThinking(false);
    for (const el of els) gsap.set(el, { clearProps: 'opacity,transform' });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const play = useCallback(
    async (speech: DoneSpeech, extra: PushExtra, myEpoch: number) => {
      const live = () => alive.current && myEpoch === epoch.current;
      const s = settingsRef.current;
      const p = propsRef.current;
      const reduced = reducedRef.current;
      const actor = () => actorRef.current;
      const kind = cardKindOf(speech);

      // 1. Tarjeta del espectador / evento
      step(1);
      if (kind !== 'none') {
        setCard({ kind, viewer: speech.viewer, ask: extra.ask ?? null });
        await wait(reduced ? 0.15 : 0.32);
      }
      if (!live()) return;

      // 2. Pensando
      if (extra.thinkMs && extra.thinkMs > 0) {
        step(2);
        setThinking(true);
        actor()?.setThinking(true);
        await wait(extra.thinkMs / 1000);
        actor()?.setThinking(false);
        setThinking(false);
        if (!live()) return;
      }

      // 3. Respuesta lista: en la vista previa se escribe en el chat simulado
      step(3);
      p.onSpeechStart?.(speech);

      // Voz: se sintetiza antes de enseñar el texto para que texto y voz arranquen juntos
      let blob: Blob | null = null;
      if (p.audio) {
        setThinking(true);
        blob = await doneSynthesize(speech.text, p.widgetKey ?? null, p.voice ?? null);
        setThinking(false);
        if (!live()) return;
      }

      // 4. Hablar: cara, gesto, tally, texto y voz
      step(4);
      actor()?.setEmotion(speech.emotion);
      setDbg({ emotion: speech.emotion, gesture: speech.gesture ?? '—' });
      const allowed = !reduced && gestureAllowed(p.spec, speech.gesture);
      const gesturePromise = allowed && speech.gesture ? (actor()?.gesture(speech.gesture) ?? Promise.resolve()) : Promise.resolve();
      actor()?.setSpeaking(true);

      const showText = s.showText;
      const typedSeconds = typingSeconds(speech.text, s.typingCps);
      if (showText) {
        setSegment({ key: speech.id, text: speech.text, emotion: speech.emotion, name: 'Done' });
        await wait(0.05);
      }
      const cardEl = textCardRef.current?.querySelector<HTMLElement>('.al') ?? null;

      let seconds = showText ? typedSeconds : spokenSeconds(speech.text);
      const audioDone = blob ? playAudio(blob) : Promise.resolve(0);
      if (blob) seconds = Math.max(seconds, 2);
      if (cardEl) {
        const id = normalizeTextStyle(s.textStyle);
        // Los estilos de diálogo escriben carácter a carácter durante `seconds`; los demás, palabra a palabra.
        startSpeaking(cardEl, { ...motion(), emotion: DONE_EMOTION_TAG[speech.emotion] }, TYPED_STYLES.has(id) ? typedSeconds : Math.max(seconds, typedSeconds));
      }
      await Promise.all([wait(seconds), audioDone]);
      if (!live()) return;
      await Promise.race([gesturePromise, wait(2.5)]);
      if (cardEl) stopSpeaking(cardEl, null);
      actor()?.setSpeaking(false);
      actor()?.setMouth(0);
      actor()?.setEmotion('normal');
      setDbg({ emotion: 'normal', gesture: '—' });
      await wait(queue.current.length ? 0.45 : 1.4);
      if (!live()) return;
      await hideChrome(myEpoch);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hideChrome, playAudio, step]
  );

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        const myEpoch = epoch.current;
        const next = queue.current.next();
        if (!next || !alive.current) break;
        const extra = extras.current.get(next.id) ?? {};
        extras.current.delete(next.id);
        propsRef.current.onQueue?.(queue.current.length);
        try {
          await play(next, extra, myEpoch);
        } catch {
          // Una frase que falla no detiene la cola.
        }
        if (myEpoch !== epoch.current) break;
      }
    } finally {
      running.current = false;
      step(0);
      propsRef.current.onQueue?.(queue.current.length);
      // Si llegó algo mientras se limpiaba, se sigue.
      if (queue.current.length && alive.current) void pump();
    }
  }, [play, step]);

  useImperativeHandle(
    ref,
    (): DoneOverlayHandle => ({
      push(speech, extra = {}) {
        if (queue.current.push(speech) === 0) return;
        extras.current.set(speech.id, extra);
        propsRef.current.onQueue?.(queue.current.length);
        void pump();
      },
      emote(emotion) {
        actorRef.current?.setEmotion(emotion);
        setDbg((d) => ({ ...d, emotion }));
        window.setTimeout(() => {
          if (alive.current && !running.current) {
            actorRef.current?.setEmotion('normal');
            setDbg((d) => ({ ...d, emotion: 'normal' }));
          }
        }, 1600);
      },
      gesture(gesture) {
        if (reducedRef.current || !gestureAllowed(propsRef.current.spec, gesture)) return;
        setDbg((d) => ({ ...d, gesture }));
        void (actorRef.current?.gesture(gesture) ?? Promise.resolve()).then(() => alive.current && setDbg((d) => ({ ...d, gesture: '—' })));
      },
      clear() {
        epoch.current += 1;
        queue.current.clear();
        extras.current.clear();
        activeAudio.current?.pause();
        actorRef.current?.setSpeaking(false);
        actorRef.current?.setThinking(false);
        setCard(null);
        setSegment(null);
        setThinking(false);
        step(0);
      },
    }),
    [pump, step]
  );

  useEffect(() => {
    alive.current = true;
    const query = window.matchMedia?.(REDUCED_QUERY);
    const update = () => {
      reducedRef.current = prefersReducedMotion();
    };
    query?.addEventListener?.('change', update);
    return () => {
      alive.current = false;
      epoch.current += 1;
      query?.removeEventListener?.('change', update);
      activeAudio.current?.pause();
      void audioContext.current?.close().catch(() => undefined);
      audioContext.current = null;
    };
  }, []);

  /* ----- Entrada de la tarjeta del espectador y del «pensando» ----- */
  useLayoutEffect(() => {
    if (!card || !vqRef.current) return;
    const el = vqRef.current;
    const ctx = gsap.context(() => {
      if (reducedRef.current) gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.15 });
      else gsap.fromTo(el, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.28, ease: 'expo.out' });
    }, el);
    return () => ctx.revert();
  }, [card]);

  useLayoutEffect(() => {
    if (!thinking || !thinkRef.current) return;
    const el = thinkRef.current;
    const ctx = gsap.context(() => {
      if (reducedRef.current) {
        gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.15 });
        return;
      }
      gsap.fromTo(el, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.22, ease: 'expo.out' });
      gsap.to(el.querySelectorAll('i'), { y: -5, opacity: 0.4, duration: 0.35, stagger: { each: 0.12, repeat: -1, yoyo: true }, ease: 'sine.inOut' });
    }, el);
    return () => ctx.revert();
  }, [thinking]);

  /* ----- Entrada del texto: la tarjeta del estilo y la aparición al ritmo de «letras por segundo» ----- */
  useLayoutEffect(() => {
    const el = textCardRef.current?.querySelector<HTMLElement>('.al');
    if (!segment || !el) return;
    const tl = playEnter(el, { ...motion(), emotion: DONE_EMOTION_TAG[segment.emotion] });
    if (!reducedRef.current && !TYPED_STYLES.has(styleId)) revealWords(el, Math.max(10, settingsRef.current.typingCps));
    return () => {
      tl.kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment?.key]);

  const emotionLabel = segment && segment.emotion !== 'normal' && segment.emotion !== 'habla' ? DONE_EMOTION_LABEL[segment.emotion] : null;
  const stageStyle = useMemo(() => ({ '--size': layout.heightPct, '--char-w': layout.widthOfHeightPct } as React.CSSProperties), [layout.heightPct, layout.widthOfHeightPct]);

  return (
    <div className="done-stage" data-mode={mode} data-bg={background} data-pos={layout.anchor} data-style={styleId} data-dbg={showDebug ? '1' : '0'} style={stageStyle}>
      {mode === 'preview' && (
        <>
          <div className="done-bg-game" aria-hidden="true">
            <div className="hp" />
            <div className="map" />
            <div className="ground" />
            <div className="lab">Partida de ejemplo, no forma parte de la capa</div>
          </div>
          <div className="done-bg-check" aria-hidden="true" />
          <span className="done-pvtag">Vista previa · sin audio</span>
          <div className="done-dbg" aria-hidden="true">
            emoción: {dbg.emotion}
            <br />
            gesto: {dbg.gesture}
          </div>
        </>
      )}

      <div className="done-say">
        {card && (
          <div ref={vqRef} className="done-vq" data-kind={card.kind}>
            {card.kind === 'chat' && card.viewer && (
              <>
                <b style={{ color: viewerColor(card.viewer) }}>{card.viewer}</b>
                <span>
                  <span className="cmd">!{settings.commandWord}</span> {card.ask ?? ''}
                </span>
              </>
            )}
            {card.kind === 'event' && (
              <>
                <span className="evt">Evento</span>
                <span>{card.viewer ?? ''}</span>
              </>
            )}
            {card.kind === 'spontaneous' && (
              <>
                <span className="evt">Comentario</span>
                <span>Comentario espontáneo</span>
              </>
            )}
          </div>
        )}
        {thinking && (
          <div ref={thinkRef} className="done-think" role="status" aria-label="Done está pensando">
            <i />
            <i />
            <i />
          </div>
        )}
        {segment && settings.showText && (
          <div ref={textCardRef} className="done-text">
            <AlertCard
              key={segment.key}
              alertStyle={styleId}
              position={alertPosition(settings.position, styleId)}
              accent={ACCENT}
              name={segment.name}
              text={segment.text}
              emotionLabel={emotionLabel}
              emotionTag={DONE_EMOTION_TAG[segment.emotion]}
              userColor="#3a4047"
              loading={false}
              fontSize="clamp(11px, 1.7cqw, 30px)"
            />
          </div>
        )}
      </div>

      <div className="done-charwrap">
        <CharacterView ref={actorRef} spec={spec} widgetKey={widgetKey} reducedMotion={reducedRef.current} onFallback={onFallback} />
      </div>

      {licenseNotice && (
        <p className="done-license" role="note">
          {licenseNotice}
        </p>
      )}
    </div>
  );
});
