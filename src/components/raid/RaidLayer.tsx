/**
 * src/components/raid/RaidLayer.tsx
 *
 * Capa «Saludo de raid». La usan la fuente de navegador de OBS (Widget.tsx) y el
 * monitor de RaidStudio.
 *
 * - Una placa con el canal y cuántas personas llegan y, al lado, un corto de ese
 *   canal en el reproductor oficial de Twitch. Si no hay corto, la placa sola.
 * - Los saludos esperan en cola: el segundo no pisa al primero.
 * - El reproductor de Twitch no avisa cuando el corto termina, así que el saludo
 *   se retira al pasar min(duración del corto, máximo elegido) más un margen.
 * - Fuera de OBS el navegador puede impedir que el corto arranque solo con
 *   sonido; en las fuentes de navegador de OBS sí arranca.
 * - Nada de lo que llega del chat o de Twitch se inserta como HTML.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import type { RaidSettings } from '../../types/raid';
import { reduced } from '../../utils/alertMotion';
import type { UserRole } from '../../utils/moderation';
import {
  EMBED_WAIT_SECONDS,
  Greeting,
  GreetingRequest,
  canUseRaidCommands,
  clipEmbedUrl,
  clipLookupUrl,
  clipSeconds,
  cooldownLeft,
  displaySeconds,
  enqueueGreeting,
  normalizeLogin,
  parseRaidCommand,
  raidPasses,
  readClipResponse,
  sampleGreeting,
  welcomeText,
} from '../../utils/raidLogic';

export interface RaidLayerHandle {
  /** Llega una raid. Devuelve false si no se saluda (capa apagada, raid pequeña o cola llena). */
  raid: (channel: string, viewers: number, login?: string) => boolean;
  /** Mensaje del streamer o de un moderador. Devuelve true si era un comando de esta capa. */
  command: (message: string, sender: { name: string; role: UserRole }) => boolean;
  /** Prueba desde el estudio: no mira si la capa está encendida ni la espera de los comandos. */
  test: (request: GreetingRequest) => void;
  /** Retira el saludo que está en pantalla. Devuelve false si no había ninguno. */
  cut: () => boolean;
}

interface RaidLayerProps {
  settings: RaidSettings;
  isStudio?: boolean;
  /** Muestra un saludo de ejemplo una y otra vez, para colocar la capa en OBS. */
  demo?: boolean;
  /** La voz activa del streamer lee la bienvenida (la misma cola que lee el chat). */
  onSpeak?: (text: string) => void;
  /** Lo que va pasando, en palabras, para el estudio. */
  onStatus?: (message: string) => void;
}

const LOOKUP_TIMEOUT_MS = 8000;
// El reproductor se pinta a este tamaño y se escala al hueco: Twitch pide un mínimo de 400 × 300 para arrancar solo
const EMBED_WIDTH = 640;
const EMBED_HEIGHT = 360;
const TAG: Record<Greeting['kind'], string> = { raid: 'Raid', so: 'Saludo', clip: 'Corto' };
const X = 'expo.out';

export const RaidLayer = forwardRef<RaidLayerHandle, RaidLayerProps>(
  ({ settings, isStudio = false, demo = false, onSpeak, onStatus }, ref) => {
    const [current, setCurrent] = useState<Greeting | null>(null);

    const settingsRef = useRef(settings);
    settingsRef.current = settings;
    const onSpeakRef = useRef(onSpeak);
    onSpeakRef.current = onSpeak;
    const onStatusRef = useRef(onStatus);
    onStatusRef.current = onStatus;
    const studioRef = useRef(isStudio);
    studioRef.current = isStudio;

    const queueRef = useRef<GreetingRequest[]>([]);
    const busyRef = useRef(false);
    const activeIdRef = useRef<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const lastUseRef = useRef<{ so?: number; clip?: number }>({});
    const aliveRef = useRef(true);
    const demoShownRef = useRef(false);

    const cardRef = useRef<HTMLDivElement | null>(null);
    const nameRef = useRef<HTMLParagraphElement | null>(null);
    const countRef = useRef<HTMLElement | null>(null);
    const clipRef = useRef<HTMLDivElement | null>(null);
    const barRef = useRef<HTMLElement | null>(null);

    const timelineRef = useRef<gsap.core.Timeline | null>(null);
    const exitTweenRef = useRef<gsap.core.Tween | null>(null);
    const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
    const clockStartedRef = useRef(false);
    const startClockRef = useRef<() => void>(() => {});

    const say = (message: string) => onStatusRef.current?.(message);

    const clearTimers = () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
    const later = (fn: () => void, seconds: number) => {
      timersRef.current.push(setTimeout(fn, seconds * 1000));
    };

    // El motor vive en una referencia: sus funciones leen siempre los ajustes vigentes
    const engine = useRef<{
      pump: () => void;
      finish: (id: string) => void;
      leave: (id: string, fast: boolean) => void;
      add: (request: GreetingRequest) => boolean;
    } | null>(null);

    if (!engine.current) {
      const resolve = async (request: GreetingRequest): Promise<Greeting | null> => {
        if (request.sample) {
          return { ...request, clip: request.sample.clip ?? null, clipState: request.sample.state, note: request.sample.note };
        }
        const url = clipLookupUrl(request, settingsRef.current.clipDays);
        if (!url) return { ...request, clip: null, clipState: 'none' };

        const controller = new AbortController();
        abortRef.current = controller;
        const timeout = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
        let found = readClipResponse(null);
        let notFound = false;
        try {
          const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
          notFound = res.status === 404;
          found = readClipResponse(await res.json().catch(() => null));
        } catch {
          found = { ...found, error: 'No se pudo llegar al servidor para buscar el corto.' };
        } finally {
          clearTimeout(timeout);
          abortRef.current = null;
        }

        // Un canal o un corto que no existe no se saluda; una raid siempre viene de un canal real
        if (notFound && request.kind !== 'raid') {
          say(found.error || 'Twitch no encontró ese canal o ese corto.');
          return null;
        }
        if (request.kind === 'clip' && !found.clip) {
          say(
            found.state === 'not_configured'
              ? `No se puede reproducir el corto: al servidor le falta ${found.missing.join(' y ') || 'la configuración de Twitch'}.`
              : found.error || 'No se pudo cargar ese corto.'
          );
          if (!studioRef.current || found.state !== 'not_configured') return null;
        }

        const channel = request.kind === 'clip' ? found.clip?.broadcaster || request.channel || 'Corto' : found.broadcaster || request.channel;
        if (found.state === 'not_configured') {
          // En OBS sale la placa sola; en el estudio, el recuadro dice qué falta
          return {
            ...request,
            channel,
            clip: null,
            clipState: 'not_configured',
            note: studioRef.current
              ? `El servidor no está configurado: falta ${found.missing.join(' y ') || 'la configuración de Twitch'}. En OBS saldría la placa sola.`
              : undefined,
          };
        }
        if (found.state === 'error') say(`${found.error || 'No se pudo buscar el corto.'} Sale la placa sola.`);
        return { ...request, channel, clip: found.clip, clipState: found.state };
      };

      const pump = () => {
        if (busyRef.current || !aliveRef.current) return;
        const next = queueRef.current[0];
        if (!next) return;
        queueRef.current = queueRef.current.slice(1);
        busyRef.current = true;
        activeIdRef.current = next.id;
        resolve(next).then((greeting) => {
          if (!aliveRef.current) return;
          // Un !cortar mientras se buscaba el corto: este saludo ya no sale
          if (!greeting || activeIdRef.current !== next.id) {
            if (activeIdRef.current === next.id) activeIdRef.current = null;
            busyRef.current = false;
            pump();
            return;
          }
          setCurrent(greeting);
        });
      };

      const finish = (id: string) => {
        if (activeIdRef.current !== id) return;
        activeIdRef.current = null;
        clearTimers();
        timelineRef.current?.kill();
        exitTweenRef.current?.kill();
        busyRef.current = false;
        if (!aliveRef.current) return;
        setCurrent(null);
        pump();
      };

      const leave = (id: string, fast: boolean) => {
        if (activeIdRef.current !== id) return;
        const card = cardRef.current;
        clearTimers();
        timelineRef.current?.kill();
        if (!card) {
          finish(id);
          return;
        }
        // Si OBS tiene la fuente oculta y no avanza la animación, el saludo se retira igual
        later(() => finish(id), 0.5);
        exitTweenRef.current?.kill();
        exitTweenRef.current = gsap.to(card, {
          opacity: 0,
          y: reduced() || fast ? 0 : '0.6em',
          duration: fast ? 0.18 : reduced() ? 0.2 : 0.24,
          ease: 'power2.out',
          onComplete: () => finish(id),
        });
      };

      const add = (request: GreetingRequest) => {
        const result = enqueueGreeting(queueRef.current, request);
        queueRef.current = result.queue;
        if (result.accepted) pump();
        return result.accepted;
      };

      engine.current = { pump, finish, leave, add };
    }

    const cut = useCallback((): boolean => {
      const id = activeIdRef.current;
      if (!id) return false;
      if (cardRef.current) {
        engine.current?.leave(id, true);
      } else {
        // Aún se estaba buscando el corto: se cancela la búsqueda y el saludo no llega a salir
        activeIdRef.current = null;
        abortRef.current?.abort();
      }
      return true;
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        raid: (channel, viewers, login) => {
          const s = settingsRef.current;
          if (!raidPasses(viewers, s)) return false;
          return (
            engine.current?.add({
              id: `raid-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              kind: 'raid',
              channel,
              login: normalizeLogin(login) || normalizeLogin(channel),
              viewers,
            }) ?? false
          );
        },
        command: (message, sender) => {
          const s = settingsRef.current;
          if (!s.enabled || !canUseRaidCommands(sender.role)) return false;
          const parsed = parseRaidCommand(message, s.commands);
          if (!parsed) return false;
          if (parsed.kind === 'cut') {
            cut();
            return true;
          }
          const now = Date.now();
          const left = cooldownLeft(lastUseRef.current[parsed.kind], now, s.cooldownSec);
          if (left > 0) {
            say(`${s.commands[parsed.kind]} está en espera: faltan ${left} s.`);
            return true;
          }
          const id = `${parsed.kind}-${now}-${Math.random().toString(36).slice(2, 7)}`;
          const accepted =
            parsed.kind === 'so'
              ? engine.current?.add({ id, kind: 'so', channel: parsed.login, login: parsed.login, by: sender.name })
              : engine.current?.add({ id, kind: 'clip', clipId: parsed.clipId, by: sender.name });
          // La espera solo cuenta si el comando llegó a entrar en la cola
          if (accepted) lastUseRef.current[parsed.kind] = now;
          return true;
        },
        test: (request) => {
          engine.current?.add(request);
        },
        cut,
      }),
      [cut]
    );

    // Entrada, cuenta de personas, corto y retirada de cada saludo
    useLayoutEffect(() => {
      const card = cardRef.current;
      if (!current || !card) return;
      const id = current.id;
      const s = settingsRef.current;
      const hasPanel = clipRef.current !== null;
      const seconds = current.clip ? clipSeconds(current.clip.duration, s.maxClipSeconds) : 0;
      const total = displaySeconds(hasPanel && current.clip ? current.clip.duration : null, s.maxClipSeconds);
      const still = reduced();

      clockStartedRef.current = false;
      startClockRef.current = () => {
        if (clockStartedRef.current || activeIdRef.current !== id) return;
        clockStartedRef.current = true;
        // La barra de tiempo avanza con una transición de CSS: sigue al reloj aunque OBS frene la animación
        const bar = barRef.current;
        if (bar && seconds > 0) {
          bar.style.transition = 'none';
          bar.style.transform = 'scaleX(0)';
          void bar.offsetWidth;
          bar.style.transition = `transform ${seconds}s linear`;
          bar.style.transform = 'scaleX(1)';
        }
        later(() => engine.current?.leave(id, false), total);
      };

      const tl = gsap.timeline();
      timelineRef.current = tl;

      if (still) {
        // Movimiento reducido: aparece y desaparece, sin desplazarse ni contar
        tl.set(card, { opacity: 1 });
        if (countRef.current) countRef.current.textContent = String(current.viewers ?? 0);
      } else {
        tl.set(card, { opacity: 1, y: 0 })
          .fromTo(card, { clipPath: 'inset(100% 0 0 0)' }, { clipPath: 'inset(0% 0 0 0)', duration: 0.5, ease: X, clearProps: 'clipPath' })
          .fromTo(nameRef.current, { y: '0.4em', opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: X }, 0.12);
        if (current.viewers && countRef.current) {
          const counter = { v: 0 };
          const target = countRef.current;
          tl.to(
            counter,
            {
              v: current.viewers,
              duration: 0.9,
              ease: X,
              onUpdate: () => {
                target.textContent = String(Math.round(counter.v));
              },
            },
            0.2
          );
        }
        if (clipRef.current) {
          tl.fromTo(clipRef.current, { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 0.5, ease: X, clearProps: 'clipPath' }, 0.4);
        }
      }

      // La cuenta no depende de la animación: OBS puede pausarla con la fuente oculta
      if (current.viewers && countRef.current) {
        const target = countRef.current;
        const viewers = current.viewers;
        later(() => {
          target.textContent = String(viewers);
        }, 1.3);
      }

      const realEmbed = hasPanel && current.clipState === 'ok';
      if (!hasPanel) later(() => engine.current?.leave(id, false), total);
      // Con reproductor, el tiempo empieza cuando carga (o tras una espera máxima); sin él, al acabar la entrada
      else later(() => startClockRef.current(), realEmbed ? EMBED_WAIT_SECONDS : 0.9);

      if (current.kind === 'raid' && s.voice && !current.sample) {
        onSpeakRef.current?.(welcomeText(s.voiceTemplate, current.channel || '', current.viewers || 0));
      }

      return () => {
        tl.kill();
      };
    }, [current]);

    // El reproductor se escala al ancho de su hueco
    useLayoutEffect(() => {
      const box = clipRef.current;
      if (!box || !current) return;
      const fit = () => box.style.setProperty('--rd-scale', String(box.clientWidth / EMBED_WIDTH));
      fit();
      if (!('ResizeObserver' in window)) return;
      const observer = new ResizeObserver(fit);
      observer.observe(box);
      return () => observer.disconnect();
    }, [current]);

    // demo=1: un saludo de ejemplo que se repite
    useEffect(() => {
      if (!demo || current) return;
      const timer = setTimeout(() => {
        demoShownRef.current = true;
        engine.current?.add(sampleGreeting('raid', 'Corto de muestra. En directo aquí va el corto más visto del canal.'));
      }, demoShownRef.current ? 2000 : 0);
      return () => clearTimeout(timer);
    }, [demo, current]);

    // Al desmontar se detiene todo: búsquedas, temporizadores y animaciones
    useEffect(() => {
      aliveRef.current = true;
      return () => {
        aliveRef.current = false;
        abortRef.current?.abort();
        timersRef.current.forEach(clearTimeout);
        timersRef.current = [];
        timelineRef.current?.kill();
        exitTweenRef.current?.kill();
        queueRef.current = [];
        busyRef.current = false;
        activeIdRef.current = null;
      };
    }, []);

    const clip = current?.clip ?? null;
    const embed = current?.clipState === 'ok' && clip;
    // El recuadro sale con un corto real, con uno de muestra o, en el estudio, para decir qué falta
    const showPanel = !!current && (!!clip || !!current.note);
    const parent = typeof window !== 'undefined' ? window.location.hostname : '';

    return (
      <div className="rdl" data-studio={isStudio ? '' : undefined} aria-hidden="true">
        {current && (
          <div className="rd">
            <div ref={cardRef} className="rd-card" data-f={settings.frame} data-solo={showPanel ? undefined : ''}>
              <div className="rd-info">
                <span className="rd-tag">{TAG[current.kind]}</span>
                <p ref={nameRef} className="rd-name">
                  {current.channel}
                </p>
                {current.kind === 'raid' && current.viewers ? (
                  <p className="rd-meta">
                    llega con <b ref={countRef}>0</b> {current.viewers === 1 ? 'persona' : 'personas'}
                  </p>
                ) : current.by ? (
                  <p className="rd-meta">
                    {current.kind === 'clip' ? 'enviado por' : 'recomendado por'} <b>{current.by}</b>
                  </p>
                ) : null}
                {clip && (clip.title || clip.game) && (
                  <p className="rd-meta rd-about">
                    {clip.title && <span>«{clip.title}»</span>}
                    {clip.game && <span>{clip.game}</span>}
                  </p>
                )}
              </div>

              {showPanel && (
                <div ref={clipRef} className="rd-clip" data-embed={embed ? '' : undefined}>
                  {embed ? (
                    <>
                      {clip.thumbnail && <img className="rd-thumb" src={clip.thumbnail} alt="" decoding="async" draggable={false} />}
                      <iframe
                        key={clip.id}
                        className="rd-frame"
                        src={clipEmbedUrl(clip.id, parent)}
                        title={`Corto de ${clip.broadcaster || current.channel || 'Twitch'}`}
                        width={EMBED_WIDTH}
                        height={EMBED_HEIGHT}
                        allow="autoplay; fullscreen"
                        onLoad={() => startClockRef.current()}
                      />
                    </>
                  ) : (
                    <div className="rd-play">
                      <div>
                        <i />
                        <span>{current.note}</span>
                      </div>
                    </div>
                  )}
                  <div className="rd-bar">
                    <u ref={barRef} />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }
);

RaidLayer.displayName = 'RaidLayer';
