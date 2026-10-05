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
 * En una escena de Studio (app=scene) sigue leyendo los eventos y lanza las
 * recompensas y las metas, pero el aviso y la voz los ponen las cajas de la
 * escena (ver noticeRules.ts): aquí ni se pintan ni se leen.
 *
 * Los ajustes se leen en cada evento: el widget ya los deja en localStorage.
 */

import React, { useEffect, useRef } from 'react';
import { isCloudEnabled } from '../../lib/supabase';
import { readWidgetKey } from '../../lib/widgetCloud';
import { pollWidgetEvents } from '../../lib/twitchEventsApi';
import { loadPowerupsSettings } from '../../types/powerups';
import { calculateGoalProgress, loadGoalsSettings } from '../../types/goals';
import { listenBus, postBus } from '../../utils/bus';
import { triggerReward } from '../../utils/rewardsEngine';
import { PlannedAction, TwitchEvent, parseTwitchEvent, planActions } from '../../utils/twitchEvents';
import { PowerupNotice, useNoticeQueue } from './PowerupNotice';
import { NOTICE_APPS, VOICE_APPS, voiceAllowed } from './noticeRules';

/** Cada cuánto se pregunta por eventos con el canal encendido y apagado. */
export const POLL_ACTIVE_MS = 4000;
export const POLL_IDLE_MS = 20000;

/** Fuentes que pueden hacer algo con un evento. Las demás (chat, raid...) ni preguntan. */
const LISTENING_APPS = ['', 'tts', 'all', 'rewards', 'recompensas', 'goals', 'scene', 'roulette', 'ruleta', 'wheel', 'kofi', 'kofigoal', 'kofirecent', 'pets'];

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

export const TwitchEventLayer: React.FC<TwitchEventLayerProps> = ({ app, speak, blockedWords, blockedUsers, onEvent, onKofi, fast }) => {
  const live = useRef({ app, speak, blockedWords, blockedUsers, onEvent, onKofi, fast });
  live.current = { app, speak, blockedWords, blockedUsers, onEvent, onKofi, fast };

  /** Un evento ya leído: primero a quien escucha (la ruleta), luego lo que mande «Power-ups». */
  const handle = useRef<(event: TwitchEvent) => void>(() => {});
  handle.current = (event) => {
    live.current.onEvent?.(event);
    planActions(event, loadPowerupsSettings()).forEach((action) => run.current(action));
  };

  const { notice, push: pushNotice, next: nextNotice } = useNoticeQueue();

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
      if (NOTICE_APPS.includes(now.app)) pushNotice(action.tag, action.text);
      return;
    }
    if (action.do === 'voice') {
      if (!VOICE_APPS.includes(now.app)) return;
      // Lo que escribe el espectador pasa por los mismos bloqueos que la voz del chat
      if (!voiceAllowed(action, now.blockedUsers, now.blockedWords)) return;
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

  // El aviso, con su entrada, su tiempo y su salida (PowerupNotice.tsx)
  if (!notice) return null;
  return (
    <div className="ovl pointer-events-none fixed inset-x-0 bottom-10 z-40 flex justify-start px-10">
      <PowerupNotice key={notice.id} notice={notice} onDone={nextNotice} />
    </div>
  );
};
