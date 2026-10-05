/**
 * src/components/juego/GameAlertLayer.tsx
 *
 * Capa «Alertas de juego», diseño «Grieta». La usan la fuente de navegador de
 * OBS (dentro de GameWidgetLayer) y el monitor de GameStudio.
 *
 * - Cada alerta espera su turno: la segunda no pisa a la primera. Una misma
 *   alerta (la misma partida, el mismo rango) no sale dos veces en la fuente.
 * - Movimiento con GSAP: un filo de luz se abre a lo ancho y se despliega en
 *   placa; cae la gema; el título entra letra a letra, con desenfoque; las
 *   cifras cuentan; pasa un brillo y la gema late. Al salir se pliega por donde
 *   se abrió. Con «reducir movimiento» todo pasa a fundidos.
 * - No reproduce la voz: avisa con `onAnnounce` de la frase que hay que decir, y
 *   quien la monta decide si la lee la voz o la mascota.
 * - Los turnos avanzan con temporizadores, no con el final de las animaciones:
 *   OBS detiene las animaciones de las fuentes ocultas.
 * - Lo que llega de Riot (campeón, cola) se pinta como texto, nunca como HTML.
 */

import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import type { GameAlertId, GameSettings } from '../../types/game';
import { reduced } from '../../utils/alertMotion';
import { playAlertAudio } from '../../utils/alertsAudio';
import { SAMPLE_ALERTS, alertView, announceText, type GameAlert, type GameAlertView } from '../../utils/gameAlerts';

export interface GameAlertLayerHandle {
  /** Una alerta real. Se descarta si el módulo o esa alerta están apagados, o si ya salió. */
  push: (alert: GameAlert) => void;
  /** Prueba desde el estudio, con datos de ejemplo: no mira interruptores. */
  test: (id: GameAlertId) => void;
}

interface GameAlertLayerProps {
  settings: GameSettings;
  isStudio?: boolean;
  /** Alertas de ejemplo una y otra vez, para colocar la capa en OBS. */
  demo?: boolean;
  /** En el estudio: la alerta que se enseña quieta mientras no hay ninguna en marcha. */
  rest?: GameAlertId;
  /** La frase que hay que decir (con su etiqueta de emoción), cuando la alerta entra en pantalla. */
  onAnnounce?: (text: string, alert: GameAlert) => void;
  /** Lo que va pasando, en palabras, para el estudio. */
  onStatus?: (message: string) => void;
}

const QUEUE_MAX = 6;
const SEEN_MAX = 60;
const DEMO_ORDER: GameAlertId[] = ['win', 'up', 'penta', 'start'];
const ENERGY = { suave: 0.6, normal: 1, intensa: 1.5 } as const;
/** Lo que tarda la placa en plegarse. */
const EXIT_SECONDS = 0.5;

interface Shown {
  token: number;
  view: GameAlertView;
  /** Segundos en pantalla antes de plegarse. */
  hold: number;
}

/** La placa. El título va partido en letras para que entren una a una, sin romper las palabras. */
const Plaque: React.FC<{ view: GameAlertView }> = ({ view }) => {
  const words = useMemo(() => view.title.split(' ').filter(Boolean), [view.title]);
  return (
    <div className="gj" data-a="frame" style={{ '--gj-c': view.color } as React.CSSProperties}>
      <div className="gj-in">
        <i className="gj-gem" data-a="icon" />
        <p className="gj-tag" data-a="tag">
          {view.tagline}
        </p>
        <p className="gj-title" data-a="title">
          {words.map((word, index) => (
            <React.Fragment key={index}>
              <span className="gj-word">
                {[...word].map((ch, at) => (
                  <span key={at} className="gj-ch">
                    {ch}
                  </span>
                ))}
              </span>{' '}
            </React.Fragment>
          ))}
        </p>
        <div className="gj-rule" data-a="line" />
        {view.sub && (
          <p className="gj-sub" data-a="sub">
            {view.sub}
          </p>
        )}
        {view.stats.length > 0 && (
          <div className="gj-stats">
            {view.stats.map((stat) => (
              <div key={stat.label} data-a="stat">
                <b data-n={stat.value}>{stat.value}</b>
                <span>{stat.label}</span>
              </div>
            ))}
          </div>
        )}
        <i className="gj-sh" data-a="shine" />
      </div>
    </div>
  );
};

export const GameAlertLayer = forwardRef<GameAlertLayerHandle, GameAlertLayerProps>(
  ({ settings, isStudio = false, demo = false, rest, onAnnounce, onStatus }, ref) => {
    const [shown, setShown] = useState<Shown | null>(null);

    const live = useRef({ settings, onAnnounce, onStatus, isStudio });
    live.current = { settings, onAnnounce, onStatus, isStudio };

    const boxRef = useRef<HTMLDivElement | null>(null);
    const queueRef = useRef<GameAlert[]>([]);
    const seenRef = useRef<string[]>([]);
    const busyRef = useRef(false);
    const aliveRef = useRef(true);
    const tokenRef = useRef(0);
    const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

    // El motor vive en una referencia: sus funciones leen siempre los ajustes vigentes
    const engine = useRef<{ accept: (alert: GameAlert, test: boolean) => void; stop: () => void } | null>(null);

    if (!engine.current) {
      const S = () => live.current.settings;
      const say = (message: string) => live.current.onStatus?.(message);
      const later = (fn: () => void, seconds: number) => {
        timersRef.current.push(setTimeout(fn, seconds * 1000));
      };

      const run = (alert: GameAlert) => {
        busyRef.current = true;
        tokenRef.current += 1;
        const token = tokenRef.current;
        const s = S();
        const hold = Math.max(1.6, s.durationSec);
        setShown({ token, view: alertView(alert, s), hold });
        // En el estudio no suena nada: el sonido y la voz salen por la fuente de OBS
        if (!live.current.isStudio) playAlertAudio(s.sound, s.soundVolume);
        live.current.onAnnounce?.(announceText(alert, s), alert);
        later(() => {
          timersRef.current = [];
          if (!aliveRef.current) return;
          setShown((current) => (current?.token === token ? null : current));
          busyRef.current = false;
          pump();
        }, hold + EXIT_SECONDS + 0.2);
      };

      const pump = () => {
        if (busyRef.current) return;
        const next = queueRef.current.shift();
        if (next) run(next);
      };

      const accept = (alert: GameAlert, test: boolean) => {
        const s = S();
        if (!test) {
          if (!s.enabled) return say('Las alertas de juego están apagadas.');
          if (!s.alerts[alert.id]?.on) return say('Esa alerta está apagada.');
          // Varias lecturas de la misma partida, o varias fuentes compartiendo lo guardado, no la repiten aquí
          if (seenRef.current.includes(alert.key)) return;
          seenRef.current = [...seenRef.current, alert.key].slice(-SEEN_MAX);
        }
        if (queueRef.current.length >= QUEUE_MAX) return say('Hay varias alertas esperando: esta se descarta.');
        queueRef.current.push(alert);
        pump();
      };

      const stop = () => {
        timersRef.current.forEach(clearTimeout);
        timersRef.current = [];
        queueRef.current = [];
        busyRef.current = false;
      };

      engine.current = { accept, stop };
    }

    useImperativeHandle(
      ref,
      () => ({
        push: (alert) => engine.current?.accept(alert, false),
        test: (id) => engine.current?.accept({ ...SAMPLE_ALERTS[id], key: `test:${id}:${Date.now()}` }, true),
      }),
      []
    );

    // Entrada, cifras, brillo, latido y plegado de la alerta en pantalla
    useLayoutEffect(() => {
      const box = boxRef.current;
      if (!shown || !box) return;
      const q = (name: string) => Array.from(box.querySelectorAll<HTMLElement>(`[data-a="${name}"]`));
      const frame = q('frame');
      const tl = gsap.timeline();
      const out = shown.hold;

      if (reduced()) {
        tl.fromTo(box, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2 }).to(box, { autoAlpha: 0, duration: 0.25, ease: 'power2.out' }, out);
        return () => {
          tl.kill();
        };
      }

      const e = ENERGY[live.current.settings.energy] ?? 1;
      gsap.set(box, { autoAlpha: 1 });
      // Un filo de luz que se abre a lo ancho y luego se despliega en placa
      tl.fromTo(frame, { scaleX: 0, scaleY: 0.05 }, { scaleX: 1, duration: 0.36, ease: 'expo.out' })
        .to(frame, { scaleY: 1, duration: 0.44, ease: 'expo.out' }, 0.3)
        .from(q('icon'), { y: -20 * e, rotation: 225, scale: 0.3, autoAlpha: 0, duration: 0.6, ease: `back.out(${1.8 * e})` }, 0.42)
        .from(q('tag'), { autoAlpha: 0, letterSpacing: '0.5em', duration: 0.5, ease: 'expo.out' }, 0.5)
        .from(box.querySelectorAll('.gj-ch'), { autoAlpha: 0, y: 10 * e, filter: 'blur(6px)', duration: 0.4, ease: 'power3.out', stagger: 0.035 }, 0.56)
        .from(q('line'), { scaleX: 0, duration: 0.6, ease: 'expo.out' }, 0.78)
        .from(q('sub'), { autoAlpha: 0, y: 4, duration: 0.35, ease: 'power2.out' }, 0.92)
        .from(q('stat'), { autoAlpha: 0, y: 8 * e, duration: 0.3, stagger: 0.07, ease: 'power3.out' }, 0.98);

      // Las cifras enteras cuentan desde cero; «+21» o «-18» salen ya escritas
      box.querySelectorAll<HTMLElement>('[data-n]').forEach((node) => {
        const raw = node.dataset.n ?? '';
        if (!/^\d+$/.test(raw)) return;
        const counter = { v: 0 };
        tl.to(
          counter,
          {
            v: Number(raw),
            duration: 0.7,
            ease: 'power2.out',
            onUpdate: () => {
              node.textContent = String(Math.round(counter.v));
            },
            onComplete: () => {
              node.textContent = raw;
            },
          },
          1.02
        );
      });

      tl.to(q('shine'), { xPercent: 420, duration: 1, ease: 'power2.inOut' }, 1.05);
      // La gema late mientras la alerta está en pantalla; con un número impar de vueltas acaba en su tamaño
      const beats = Math.floor((out - 1.4) / 0.55) - 1;
      const repeat = beats % 2 === 1 ? beats : beats - 1;
      if (repeat >= 1) tl.to(q('icon'), { scale: 1.3, duration: 0.55, ease: 'sine.inOut', yoyo: true, repeat }, 1.4);

      // Sale más rápido de lo que entra y se pliega por donde se abrió: el texto se apaga, la placa
      // vuelve al filo y el filo se cierra
      tl.to(box.querySelectorAll('.gj-in > *'), { autoAlpha: 0, duration: 0.14 }, out)
        .to(frame, { scaleY: 0.05, duration: 0.2, ease: 'power3.inOut' }, out + 0.1)
        .to(frame, { scaleX: 0, duration: 0.2, ease: 'power3.in' }, out + 0.28)
        .set(box, { autoAlpha: 0 });

      return () => {
        tl.kill();
      };
    }, [shown]);

    // demo=1: alertas de ejemplo que se repiten
    useEffect(() => {
      if (!demo) return;
      let step = 0;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const next = () => {
        const id = DEMO_ORDER[step % DEMO_ORDER.length];
        step += 1;
        engine.current?.accept({ ...SAMPLE_ALERTS[id], key: `demo:${step}` }, true);
        timer = setTimeout(next, (live.current.settings.durationSec + 3) * 1000);
      };
      timer = setTimeout(next, 800);
      return () => {
        if (timer) clearTimeout(timer);
      };
    }, [demo]);

    useEffect(() => {
      aliveRef.current = true;
      return () => {
        aliveRef.current = false;
        engine.current?.stop();
      };
    }, []);

    // En el estudio, sin alerta en marcha, la placa queda quieta para ver posición, tamaño y color
    const still = useMemo(
      () => (isStudio && rest && !shown ? alertView(SAMPLE_ALERTS[rest], settings) : null),
      [isStudio, rest, shown, settings]
    );

    return (
      <div
        className="gjl"
        data-pos={settings.pos}
        data-studio={isStudio ? '' : undefined}
        aria-hidden="true"
        style={{ '--gj-k': settings.size / 100 } as React.CSSProperties}
      >
        {shown && (
          <div ref={boxRef} key={shown.token} style={{ maxWidth: '100%' }}>
            <Plaque view={shown.view} />
          </div>
        )}
        {still && <Plaque view={still} />}
      </div>
    );
  }
);

GameAlertLayer.displayName = 'GameAlertLayer';
