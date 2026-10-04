/**
 * src/components/powerups/TwitchEventLayer.tsx
 *
 * Lado de OBS del canal de eventos de Twitch. Va montada en el widget y:
 *
 * - Pregunta al servidor por los eventos nuevos del streamer (bits, Power-ups y
 *   canjes de puntos) con la clave privada `k` de la URL. Solo recibe los suyos.
 *   Con el canal de eventos encendido pregunta cada pocos segundos; apagado,
 *   mucho más despacio, lo justo para que lleguen las pruebas del panel.
 * - Atiende también las pruebas que el panel envía por el bus a las fuentes
 *   abiertas en este mismo navegador (sirve sin cuenta en la nube).
 * - Con cada evento hace lo que el streamer eligió en «Power-ups»: lanzar una
 *   recompensa de Lalo (por la puerta común de src/utils/rewardsEngine.ts), un
 *   aviso en pantalla, que la voz lea un mensaje, y poner el total nuevo de las
 *   metas de bits.
 * - Entrega además cada evento a `onEvent`: la ruleta lo usa para girar con los
 *   canjes de puntos que no piden texto.
 *
 * Los ajustes se leen en cada evento: el widget ya los deja en localStorage.
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { isCloudEnabled } from '../../lib/supabase';
import { readWidgetKey } from '../../lib/widgetCloud';
import { pollWidgetEvents } from '../../lib/twitchEventsApi';
import { loadPowerupsSettings } from '../../types/powerups';
import { calculateGoalProgress, loadGoalsSettings } from '../../types/goals';
import { reduced } from '../../utils/alertMotion';
import { playAlertAudio } from '../../utils/alertsAudio';
import { listenBus, postBus } from '../../utils/bus';
import { findBlockedWord, normalizeUser } from '../../utils/moderation';
import { triggerReward } from '../../utils/rewardsEngine';
import { PlannedAction, TwitchEvent, parseTwitchEvent, planActions } from '../../utils/twitchEvents';

/** Cada cuánto se pregunta por eventos con el canal encendido y apagado. */
export const POLL_ACTIVE_MS = 4000;
export const POLL_IDLE_MS = 20000;
const NOTICE_SECONDS = 5;
const NOTICE_QUEUE_MAX = 6;

/** Fuentes que pueden hacer algo con un evento. Las demás (chat, raid...) ni preguntan. */
const LISTENING_APPS = ['', 'tts', 'all', 'rewards', 'recompensas', 'goals', 'scene', 'roulette', 'ruleta', 'wheel', 'kofi', 'kofigoal', 'kofirecent'];
const NOTICE_APPS = ['all', 'rewards', 'recompensas'];
const VOICE_APPS = ['', 'tts', 'all'];

interface TwitchEventLayerProps {
  /** Valor de `app` en la URL de la fuente. */
  app: string;
  /** Pone una frase en la cola de voz de esta fuente. */
  speak: (text: string, user?: string, system?: boolean) => unknown;
  blockedWords: string[];
  blockedUsers: string[];
  /** Cada evento leído, antes de las acciones de «Power-ups». Lo usa la ruleta. */
  onEvent?: (event: TwitchEvent) => void;
  /** Avisos de Ko-fi (viajan por el mismo canal). Los pinta la capa de Ko-fi. */
  onKofi?: (payload: unknown, test: boolean) => void;
  /** Hay una capa de Ko-fi en esta fuente: se pregunta al ritmo rápido aunque el canal de Twitch esté apagado. */
  fast?: boolean;
}

interface Notice {
  id: number;
  tag: string;
  text: string;
}

export const TwitchEventLayer: React.FC<TwitchEventLayerProps> = ({ app, speak, blockedWords, blockedUsers, onEvent, onKofi, fast }) => {
  const live = useRef({ app, speak, blockedWords, blockedUsers, onEvent, onKofi, fast });
  live.current = { app, speak, blockedWords, blockedUsers, onEvent, onKofi, fast };

  /** Un evento ya leído: primero a quien escucha (la ruleta), luego lo que mande «Power-ups». */
  const handle = useRef<(event: TwitchEvent) => void>(() => {});
  handle.current = (event) => {
    live.current.onEvent?.(event);
    planActions(event, loadPowerupsSettings()).forEach((action) => run.current(action));
  };

  const [notice, setNotice] = useState<Notice | null>(null);
  const waiting = useRef<Notice[]>([]);
  const showing = useRef(false);
  const plateRef = useRef<HTMLDivElement | null>(null);
  const noticeCount = useRef(0);

  const nextNotice = useRef<() => void>(() => {});
  nextNotice.current = () => {
    const next = waiting.current.shift() ?? null;
    showing.current = next !== null;
    setNotice(next);
    if (next) playAlertAudio('soft-pop', 0.5);
  };

  const run = useRef<(action: PlannedAction) => void>(() => {});
  run.current = (action) => {
    const now = live.current;
    if (action.do === 'reward') {
      // Sin capa «Recompensas» en esta fuente devuelve no_layer y no pasa nada
      triggerReward(action.input);
      return;
    }
    if (action.do === 'goals') {
      // Totales, no sumas: si otra fuente avisa de lo mismo, el número no cambia
      const goals = loadGoalsSettings().goals;
      action.goals.forEach((total) => {
        const goal = goals.find((item) => item.id === total.id);
        if (!goal || goal.type !== 'bits') return;
        postBus({
          type: 'GOAL_UPDATE',
          goal: {
            goalId: goal.id,
            title: goal.title,
            current: total.current,
            target: goal.target,
            unit: goal.unit,
            percent: calculateGoalProgress(total.current, goal.target),
            completed: total.current >= goal.target,
            delta: action.bits,
            user: action.user,
          },
        });
      });
      return;
    }
    if (action.do === 'plate') {
      if (!NOTICE_APPS.includes(now.app) || waiting.current.length >= NOTICE_QUEUE_MAX) return;
      noticeCount.current += 1;
      waiting.current.push({ id: noticeCount.current, tag: action.tag, text: action.text });
      if (!showing.current) nextNotice.current();
      return;
    }
    if (action.do === 'voice') {
      if (!VOICE_APPS.includes(now.app)) return;
      // Lo que escribe el espectador pasa por los mismos bloqueos que la voz del chat
      if (action.login && now.blockedUsers.includes(normalizeUser(action.login))) return;
      if (action.viewerText && findBlockedWord(action.viewerText, now.blockedWords)) return;
      now.speak(action.text, 'Power-up', true);
    }
  };

  const listening = LISTENING_APPS.includes(app);

  // Pruebas del panel a las fuentes de este navegador
  useEffect(() => {
    if (!listening) return;
    return listenBus((message) => {
      if (message.type !== 'TWITCH_EVENT') return;
      if (message.kind === 'kofi') return live.current.onKofi?.(message.payload, true);
      const event = parseTwitchEvent(message.kind, message.payload, true);
      if (event) handle.current(event);
    });
  }, [listening]);

  // Eventos del servidor, con la clave privada de la URL
  useEffect(() => {
    const key = listening && isCloudEnabled ? readWidgetKey() : null;
    if (!key) return;
    let cursor: number | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      const result = await pollWidgetEvents(key, cursor).catch(() => null);
      if (stopped) return;
      if (result) {
        result.events.forEach((row) => {
          if (cursor !== null && row.id <= cursor) return;
          if (row.kind === 'kofi') return live.current.onKofi?.(row.payload, row.test);
          const event = parseTwitchEvent(row.kind, row.payload, row.test);
          if (event) handle.current(event);
        });
        cursor = Math.max(cursor ?? 0, result.cursor);
      }
      timer = setTimeout(tick, loadPowerupsSettings().channelActive || live.current.fast ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    };
    tick();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [listening]);

  // Entrada y salida del aviso
  useLayoutEffect(() => {
    const plate = plateRef.current;
    if (!notice || !plate) return;
    const tl = gsap.timeline();
    tl.fromTo(plate, { opacity: 0, y: reduced() ? 0 : 14 }, { opacity: 1, y: 0, duration: 0.4, ease: 'expo.out' });
    tl.to(plate, { opacity: 0, duration: 0.2, ease: 'power2.out' }, NOTICE_SECONDS);
    // El relevo va con un temporizador: OBS detiene las animaciones de las fuentes ocultas
    const timer = setTimeout(() => nextNotice.current(), (NOTICE_SECONDS + 0.25) * 1000);
    return () => {
      tl.kill();
      clearTimeout(timer);
    };
  }, [notice]);

  if (!notice) return null;
  return (
    <div className="ovl pointer-events-none fixed inset-x-0 bottom-10 z-40 flex justify-start px-10">
      <div
        key={notice.id}
        ref={plateRef}
        className="ovl-plate nt"
        style={{ '--c': '#b68cff', '--c-ink': '#1b1c1f' } as React.CSSProperties}
      >
        <span className="nt-tag ovl-caps">{notice.tag}</span>
        <span className="nt-text">{notice.text}</span>
      </div>
    </div>
  );
};
