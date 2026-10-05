/**
 * src/components/estudio/LaloBoxes.tsx
 *
 * Las capas de Lalo (chat, metas, alertas y saludo de raid) dentro de la caja
 * de una escena. Cada una usa su componente de siempre; el CSS de Studio
 * (src/styles/estudio.css) hace que la caja sea su «pantalla» y que su tamaño
 * de letra salga del ancho de la caja.
 *
 * - En OBS (`mode="live"`) reciben los mismos avisos que las fuentes sueltas, a
 *   través del registro que les pasa SceneView.
 * - En el editor (`mode="edit"`) enseñan una muestra fija para poder colocarlas.
 * - Alertas y saludo de raid admiten posición aleatoria: la caja es la zona y
 *   cada aviso sale en un punto distinto, siempre entero dentro de ella.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertCard } from '../AlertCard';
import { ChatOverlayHandle, ChatOverlayView } from '../chat/ChatOverlayView';
import { GoalsOverlayView } from '../goals/GoalsOverlayView';
import { RaidLayer, RaidLayerHandle } from '../raid/RaidLayer';
import type { StudioLayer } from '../../types/studio';
import { typeInfo } from '../../types/studio';
import type { StreamAlertEvent } from '../../utils/bus';
import { MotionOptions, playDemo, playEnter, playExit } from '../../utils/alertMotion';
import { demoMessage } from '../../utils/chatFeed';
import { Spot, pickSpot, spotAt } from '../../utils/randomSpot';
import { PHASE_BOXES } from './boxes';
import type { BoxProps } from './boxes/types';

export type { BoxProps, SceneData, SceneRegistry, SceneServices, SceneSignal } from './boxes/types';

// ---------- Zona de posición aleatoria ----------

function useZone(layer: StudioLayer) {
  const random = layer.random?.enabled ? layer.random : null;
  const [spot, setSpot] = useState<Spot | null>(null);
  const lastRef = useRef<Spot | null>(null);
  const bounds = useMemo(
    () => (random ? { zoneW: layer.w, zoneH: layer.h, itemW: Math.min(random.w, layer.w), itemH: Math.min(random.h, layer.h) } : null),
    [random, layer.w, layer.h]
  );
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;

  /** Elige otro sitio dentro de la zona. Sin posición aleatoria no hace nada. */
  const move = useCallback(() => {
    const b = boundsRef.current;
    if (!b) return;
    const next = pickSpot(b, lastRef.current);
    lastRef.current = next;
    setSpot(next);
  }, []);

  let style: React.CSSProperties | undefined;
  if (bounds) {
    const at = spotAt(bounds, spot?.u ?? 0.5, spot?.v ?? 0.5);
    style = {
      left: `${(at.x / layer.w) * 100}%`,
      top: `${(at.y / layer.h) * 100}%`,
      width: `${(bounds.itemW / layer.w) * 100}%`,
      height: `${(bounds.itemH / layer.h) * 100}%`,
    };
  }
  return { zone: !!bounds, style, move };
}

/** Caja del aviso: toda la capa o, con posición aleatoria, el punto elegido dentro de la zona. */
const Spotted: React.FC<{ zone: boolean; style?: React.CSSProperties; kind: string; children: React.ReactNode }> = ({
  zone,
  style,
  kind,
  children,
}) => (
  <div className="es-zone" data-on={zone ? '' : undefined}>
    <div className="es-spot es-lalo" data-kind={kind} style={style}>
      {children}
    </div>
  </div>
);

// ---------- Chat ----------

const ChatBox: React.FC<BoxProps> = ({ layer, mode, data, registry }) => {
  const ref = useRef<ChatOverlayHandle | null>(null);
  // En el editor los mensajes de muestra no caducan
  const settings = useMemo(() => (mode === 'edit' ? { ...data.chat, seconds: 0 } : data.chat), [mode, data.chat]);

  useEffect(() => {
    const handle = ref.current;
    if (handle) registry.chat.set(layer.id, handle);
    return () => {
      registry.chat.delete(layer.id);
    };
  }, [registry, layer.id]);

  useEffect(() => {
    if (mode !== 'edit') return;
    const timers = (['normal', 'sub', 'normal'] as const).map((kind, i) =>
      setTimeout(() => ref.current?.push(demoMessage(kind)), 60 + i * 140)
    );
    return () => {
      timers.forEach(clearTimeout);
      ref.current?.clear();
    };
  }, [mode]);

  return (
    <div className="es-lalo" data-kind="chat" style={{ '--ch-wn': settings.width } as React.CSSProperties}>
      <ChatOverlayView ref={ref} settings={settings} />
    </div>
  );
};

// ---------- Metas ----------

const GoalBox: React.FC<BoxProps> = ({ mode, data }) => {
  const goals = data.goals;
  if (mode === 'edit' && !goals.goals.some((goal) => goal.enabled)) {
    return <div className="es-el es-empty">No hay metas activas. Enciende una en Metas.</div>;
  }
  return (
    <div className="es-lalo" data-kind="goal">
      <GoalsOverlayView
        goals={goals.goals}
        activeGoalId={goals.activeGoalId}
        displayMode={goals.displayMode}
        slideshowIntervalSec={goals.slideshowIntervalSec}
        position={goals.position}
        recentProgressGoalId={data.goalEventId}
      />
    </div>
  );
};

// ---------- Alertas ----------

interface Shot {
  key: string;
  user: string;
  text: string;
  accent: string;
  seconds: number;
}

const SAMPLE_USER = 'pau_rl';
const QUEUE_LIMIT = 12;

const AlertBox: React.FC<BoxProps> = ({ layer, mode, data, registry, demo }) => {
  const alerts = data.alerts;
  const { zone, style, move } = useZone(layer);
  const [shot, setShot] = useState<Shot | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const queueRef = useRef<StreamAlertEvent[]>([]);
  const busyRef = useRef(false);
  const stopDemoRef = useRef<(() => void) | null>(null);

  const sampleText = (alerts.events.follow.template || '¡{user} te acaba de seguir!').replace('{user}', SAMPLE_USER);
  const motion: MotionOptions = { style: alerts.alertStyle, position: alerts.position, energy: alerts.energy, accent: shot?.accent || alerts.accent };
  const motionRef = useRef(motion);
  motionRef.current = motion;
  const durationRef = useRef(alerts.duration);
  durationRef.current = alerts.duration;

  const next = useCallback(() => {
    const alert = queueRef.current.shift();
    if (!alert) {
      busyRef.current = false;
      setShot(null);
      return;
    }
    busyRef.current = true;
    move();
    setShot({
      key: `${alert.id}-${Date.now()}`,
      user: alert.user,
      text: alert.text,
      accent: alert.accent || motionRef.current.accent,
      seconds: Math.min(30, Math.max(2, alert.duration || durationRef.current || 5)),
    });
  }, [move]);

  const fire = useCallback(
    (alert: StreamAlertEvent) => {
      if (queueRef.current.length >= QUEUE_LIMIT) return;
      queueRef.current.push(alert);
      if (!busyRef.current) next();
    },
    [next]
  );

  // Prueba: en el editor la muestra salta a otro sitio y repite su entrada; en OBS llega como una alerta más
  const test = useCallback(() => {
    if (mode === 'live') {
      fire({ id: `prueba-${Date.now()}`, eventType: 'follow', user: SAMPLE_USER, text: sampleText, duration: 4 });
      return;
    }
    move();
    stopDemoRef.current?.();
    if (cardRef.current) stopDemoRef.current = playDemo(cardRef.current, motionRef.current, 2.5);
  }, [mode, fire, move, sampleText]);

  useEffect(() => {
    registry.alert.set(layer.id, fire);
    registry.test.set(layer.id, test);
    return () => {
      registry.alert.delete(layer.id);
      registry.test.delete(layer.id);
    };
  }, [registry, layer.id, fire, test]);

  // demo=1 en la URL de la escena: alertas de muestra para colocarla en OBS
  useEffect(() => {
    if (!demo || mode !== 'live') return;
    const first = setTimeout(test, 400);
    const timer = setInterval(test, 6500);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [demo, mode, test]);

  // Entrada, tiempo en pantalla y salida de cada alerta en OBS
  const shotKey = shot?.key;
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (mode !== 'live' || !shot || !card) return;
    let finished = false;
    let exit: gsap.core.Timeline | null = null;
    let guard: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      next();
    };
    const enter = playEnter(card, motionRef.current);
    const leave = setTimeout(() => {
      exit = playExit(card, motionRef.current, finish);
      // Si OBS tiene la fuente oculta y no avanza la animación, la alerta se retira igual
      guard = setTimeout(finish, 700);
    }, shot.seconds * 1000);
    return () => {
      finished = true;
      clearTimeout(leave);
      if (guard) clearTimeout(guard);
      enter.kill();
      exit?.kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shotKey, mode]);

  useEffect(
    () => () => {
      stopDemoRef.current?.();
      queueRef.current = [];
      busyRef.current = false;
    },
    []
  );

  const shown = mode === 'edit' ? { key: 'muestra', user: SAMPLE_USER, text: sampleText, accent: alerts.accent } : shot;
  return (
    <Spotted zone={zone} style={style} kind="alert">
      {shown && (
        <AlertCard
          key={shown.key}
          ref={cardRef}
          alertStyle={alerts.alertStyle}
          position={alerts.position}
          accent={shown.accent}
          name={shown.user}
          text={shown.text}
          stickerSvg={alerts.stickerSvg}
          fontSize="calc(100cqw / 34)"
        />
      )}
    </Spotted>
  );
};

// ---------- Saludo de raid ----------

const RaidBox: React.FC<BoxProps> = ({ layer, mode, data, registry, demo, onSpeak }) => {
  const { zone, style, move } = useZone(layer);
  const ref = useRef<RaidLayerHandle | null>(null);

  useEffect(() => {
    const handle = ref.current;
    if (handle) registry.raid.set(layer.id, handle);
    if (mode === 'edit') registry.test.set(layer.id, move);
    return () => {
      registry.raid.delete(layer.id);
      registry.test.delete(layer.id);
    };
  }, [registry, layer.id, mode, move]);

  return (
    <Spotted zone={zone} style={style} kind="raid">
      {mode === 'live' ? (
        <RaidLayer ref={ref} settings={data.raid} demo={demo} onSpeak={onSpeak} onShow={move} />
      ) : (
        // Muestra fija con la misma placa que pinta la capa
        <div className="rdl" aria-hidden="true">
          <div className="rd">
            <div className="rd-card" data-f={data.raid.frame} style={{ opacity: 1 }}>
              <div className="rd-info">
                <span className="rd-tag">Raid</span>
                <p className="rd-name">StreamerHost</p>
                <p className="rd-meta">
                  llega con <b>48</b> personas
                </p>
              </div>
              <div className="rd-clip">
                <div className="rd-play">
                  <div>
                    <i />
                    <span>Aquí va el corto más visto del canal.</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </Spotted>
  );
};

/** Dibuja una capa de Lalo dentro de su caja. */
export const LaloBox: React.FC<BoxProps> = (props) => {
  switch (props.layer.type) {
    case 'chat':
      return <ChatBox {...props} />;
    case 'goal':
      return <GoalBox {...props} />;
    case 'alert':
      return <AlertBox {...props} />;
    case 'raid':
      return <RaidBox {...props} />;
    default: {
      // Las demás capas viven en boxes/ (una fase por archivo)
      const Box = PHASE_BOXES[props.layer.type as keyof typeof PHASE_BOXES];
      if (Box) return <Box {...props} />;
      // Capa que aún no tiene caja: en el editor se dice; en OBS no se pinta nada
      return props.mode === 'edit' ? <div className="es-el es-empty">{typeInfo(props.layer.type).name}: disponible pronto</div> : null;
    }
  }
};
