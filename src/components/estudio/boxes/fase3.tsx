/**
 * src/components/estudio/boxes/fase3.tsx
 *
 * Cajas de Studio de la fase 3: Ruleta (`roulette`) y Batalla (`poll`). El
 * contrato está en ./types.ts.
 *
 * - Ruleta: en OBS monta la capa de siempre (RouletteLayer) dentro de la caja y
 *   le pasa el chat, los eventos de Twitch y los comandos del streamer y sus
 *   moderadores. Lo que anuncia entra en la cola de voz del widget. En el editor
 *   se ve abierta y quieta; su prueba da un giro corto y sin sonido.
 * - Batalla: la fuente suelta lleva la batalla dentro de Widget.tsx, así que la
 *   caja tiene su propio motor (src/utils/pollBox.ts), alimentado por los avisos
 *   POLL_* del bus. Los votos del chat llegan ya como POLL_VOTE. La cuenta atrás
 *   y la retirada avanzan con temporizadores, no con el final de una animación.
 *   En el editor se ve una batalla de muestra, a medias y sin cuenta atrás.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { BattleBarView } from '../../polls/BattleBarView';
import { RouletteLayer, RouletteLayerHandle } from '../../roulette/RouletteLayer';
import { RouletteOverlayView } from '../../roulette/RouletteOverlayView';
import { PollSettings, loadPollSettings } from '../../../types/polls';
import { RouletteSegment, RouletteSettings, loadRouletteSettings, normalizeRouletteSettings } from '../../../types/roulette';
import { reduced } from '../../../utils/alertMotion';
import { BusMessage, PollBattleUpdateEvent, listenBus } from '../../../utils/bus';
import {
  EMPTY_POLL,
  POLL_ORPHAN_MS,
  POLL_WINNER_HOLD_MS,
  PollEffect,
  PollEngine,
  PollStep,
  adoptPoll,
  clearPoll,
  createPollVoice,
  pollSettingsFromBus,
  pollVisible,
  samplePoll,
  startPoll,
  stopPoll,
  tickPoll,
  votePoll,
} from '../../../utils/pollBox';
import { playCountdownBeep, playLeadClash, playPollModNoticeSound, playPollVictoryFanfare, playVoteTick } from '../../../utils/pollsAudio';
import { ROULETTE_PREVIEW_RESULT_MS, ROULETTE_PREVIEW_SPIN_SEC, rouletteSample } from '../../../utils/rouletteBox';
import { buildSpin } from '../../../utils/rouletteLogic';
import type { BoxMap, BoxProps } from './types';
import '../../../styles/estudio-fase3.css';

const SAMPLE_USER = 'pau_rl';

// ---------- Ruleta ----------

interface PreviewView {
  spinning: boolean;
  start: number;
  target: number;
  winner?: RouletteSegment;
  banner: { segment: RouletteSegment; user: string } | null;
}

const REST: PreviewView = { spinning: false, start: 0, target: 0, banner: null };
const noop = () => {};

/** La ruleta en el editor: abierta y quieta, con los segmentos del streamer o los de muestra. */
const RoulettePreview: React.FC<Pick<BoxProps, 'layer' | 'registry'>> = ({ layer, registry }) => {
  const [settings, setSettings] = useState<RouletteSettings>(loadRouletteSettings);
  const [view, setView] = useState<PreviewView>(REST);
  const sample = useMemo(() => rouletteSample(settings), [settings]);
  const sampleRef = useRef(sample);
  sampleRef.current = sample;
  const restRef = useRef(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(
    () =>
      listenBus((message) => {
        if (message.type === 'ROULETTE_SETTINGS_UPDATE') setSettings(normalizeRouletteSettings(message.settings));
      }),
    []
  );

  // Prueba: un giro corto y sin sonido; el resultado se queda unos segundos y la rueda vuelve a su sitio
  const test = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    const spin = buildSpin(sampleRef.current, { id: `muestra-${Date.now()}`, user: SAMPLE_USER, baseRotation: restRef.current });
    if (!spin) return;
    const start = spin.startRotation ?? 0;
    const rest = ((spin.finalRotation % 360) + 360) % 360;
    const winner = spin.winnerSegment;
    setView({ spinning: true, start, target: spin.finalRotation, winner, banner: null });
    // Los pasos van con temporizador: no dependen de que la animación del giro termine
    const landed = ROULETTE_PREVIEW_SPIN_SEC * 1000 + 300;
    timersRef.current = [
      setTimeout(() => {
        restRef.current = rest;
        setView({ spinning: false, start: rest, target: spin.finalRotation, winner, banner: { segment: winner, user: SAMPLE_USER } });
      }, landed),
      setTimeout(() => setView({ ...REST, start: rest, target: rest }), landed + ROULETTE_PREVIEW_RESULT_MS),
    ];
  }, []);

  useEffect(() => {
    registry.test.set(layer.id, test);
    return () => {
      registry.test.delete(layer.id);
    };
  }, [registry, layer.id, test]);

  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  return (
    <div className="rl-box">
      <div className="rl-box-in">
        <RouletteOverlayView
          settings={sample}
          targetRotation={view.target}
          startRotation={view.start}
          targetWinner={view.winner}
          isSpinning={view.spinning}
          activeUser={SAMPLE_USER}
          winnerBanner={view.banner}
          onSpinComplete={noop}
        />
      </div>
    </div>
  );
};

const RouletteBox: React.FC<BoxProps> = ({ layer, mode, registry, demo, services }) => {
  const ref = useRef<RouletteLayerHandle | null>(null);
  const servicesRef = useRef(services);
  servicesRef.current = services;
  // Único camino de voz de la ruleta: la cola del widget, leída tal cual
  const speak = useCallback((text: string) => servicesRef.current?.speak(text, 'Ruleta', true) ?? null, []);

  useEffect(() => {
    if (mode !== 'live') return;
    registry.sinks.set(layer.id, (signal) => {
      const roulette = ref.current;
      if (!roulette) return false;
      if (signal.kind === 'chat') roulette.chat(signal.tags, signal.role);
      if (signal.kind === 'twitch') roulette.event(signal.event);
      // Abrir o cerrar la ruleta: si el comando era suyo, nadie más lo atiende
      return signal.kind === 'staff' ? roulette.command(signal.message, signal.sender) : false;
    });
    return () => {
      registry.sinks.delete(layer.id);
    };
  }, [registry, layer.id, mode]);

  return (
    <div className="es-lalo" data-kind="roulette">
      {mode === 'live' ? <RouletteLayer ref={ref} speak={speak} demo={demo} boxed /> : <RoulettePreview layer={layer} registry={registry} />}
    </div>
  );
};

// ---------- Batalla ----------

/** Salida de la barra: más corta que su entrada (0,5 s). */
const POLL_EXIT_SEC = 0.2;
/** Votos que suma la prueba del editor y lo que tarda en volver a la muestra. */
const POLL_TEST_VOTES = 6;
const POLL_TEST_MS = 2600;

const PollBox: React.FC<BoxProps> = ({ layer, mode, registry, demo, services }) => {
  const live = mode === 'live';
  const [settings, setSettings] = useState<PollSettings>(loadPollSettings);
  const [engine, setEngine] = useState<PollEngine>(EMPTY_POLL);
  /** Lo que hay en pantalla: sigue ahí mientras dura la salida. */
  const [shown, setShown] = useState<{ id: number; battle: PollBattleUpdateEvent } | null>(null);
  /** Votos de más que enseña la prueba del editor. */
  const [bump, setBump] = useState(0);

  const engineRef = useRef(engine);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const servicesRef = useRef(services);
  servicesRef.current = services;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const exitRef = useRef<{ timer: ReturnType<typeof setTimeout>; tween: gsap.core.Tween | null } | null>(null);
  const voiceRef = useRef<ReturnType<typeof createPollVoice> | null>(null);
  if (!voiceRef.current) voiceRef.current = createPollVoice((text) => servicesRef.current?.speak(text, 'Batalla', true));

  const run = useCallback((effects: PollEffect[]) => {
    const s = settingsRef.current;
    effects.forEach((effect) => {
      if (effect.kind === 'say') {
        voiceRef.current?.say(effect.text);
        return;
      }
      if (!s.audioEffectsEnabled) return;
      if (effect.sound === 'notice') playPollModNoticeSound(s.audioVolume);
      if (effect.sound === 'tick-a') playVoteTick(s.audioVolume, 0);
      if (effect.sound === 'tick-b') playVoteTick(s.audioVolume, 1);
      if (effect.sound === 'clash') playLeadClash(s.audioVolume);
      if (effect.sound === 'beep') playCountdownBeep(s.audioVolume, true);
      if (effect.sound === 'fanfare') playPollVictoryFanfare(s.audioVolume);
    });
  }, []);

  const apply = useCallback(
    (step: PollStep) => {
      if (step.engine !== engineRef.current) {
        engineRef.current = step.engine;
        setEngine(step.engine);
      }
      run(step.effects);
    },
    [run]
  );

  const onBus = useCallback(
    (message: BusMessage) => {
      const current = engineRef.current;
      if (message.type === 'POLL_SETTINGS_UPDATE') setSettings((prev) => pollSettingsFromBus(message.settings, prev));
      else if (message.type === 'POLL_START') apply(startPoll(current, message.poll));
      else if (message.type === 'POLL_VOTE') apply(votePoll(current, message.user, message.option, settingsRef.current.allowVoteChange));
      else if (message.type === 'POLL_STATE_UPDATE') apply(adoptPoll(current, message.state));
      else if (message.type === 'POLL_STOP') apply(stopPoll(current, message.user));
      else if (message.type === 'POLL_CLEAR') apply({ engine: clearPoll(current), effects: [] });
      else if (message.type === 'POLL_TTS_CUE') voiceRef.current?.say(message.cue?.text || '');
    },
    [apply]
  );

  // En OBS los avisos del bus llegan por la escena; en el editor solo interesan los ajustes
  useEffect(() => {
    if (!live) {
      return listenBus((message) => {
        if (message.type === 'POLL_SETTINGS_UPDATE') setSettings((prev) => pollSettingsFromBus(message.settings, prev));
      });
    }
    registry.sinks.set(layer.id, (signal) => {
      if (signal.kind === 'bus') onBus(signal.message);
    });
    return () => {
      registry.sinks.delete(layer.id);
    };
  }, [registry, layer.id, live, onBus]);

  // Cuenta atrás de una batalla propia: un paso por segundo
  const counting = live && engine.own && !!engine.battle?.isActive;
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => apply(tickPoll(engineRef.current)), 1000);
    return () => clearInterval(timer);
  }, [counting, engine.id, apply]);

  // El resultado se queda un rato y la batalla se retira sola
  const finished = !!engine.battle && !engine.battle.isActive && Boolean(engine.battle.winner);
  useEffect(() => {
    if (!finished) return;
    const timer = setTimeout(() => apply({ engine: clearPoll(engineRef.current), effects: [] }), POLL_WINNER_HOLD_MS);
    return () => clearTimeout(timer);
  }, [finished, engine.id, apply]);

  // Batalla que lleva otra página: si deja de avisar, no se queda colgada en pantalla
  const orphan = !engine.own && engine.battle?.isActive ? engine.battle : null;
  useEffect(() => {
    if (!orphan) return;
    const timer = setTimeout(() => apply({ engine: clearPoll(engineRef.current), effects: [] }), POLL_ORPHAN_MS);
    return () => clearTimeout(timer);
  }, [orphan, apply]);

  // Entrada y salida. La retirada la marca un temporizador: OBS detiene las animaciones de una fuente oculta
  const cancelExit = useCallback(() => {
    const exit = exitRef.current;
    if (!exit) return;
    exitRef.current = null;
    clearTimeout(exit.timer);
    exit.tween?.kill();
    if (wrapRef.current) gsap.set(wrapRef.current, { clearProps: 'opacity,transform' });
  }, []);

  const battle = engine.battle;
  const battleId = engine.id;
  useEffect(() => {
    if (pollVisible(battle)) {
      cancelExit();
      setShown({ id: battleId, battle });
      return;
    }
    if (!shownRef.current || exitRef.current) return;
    const el = wrapRef.current;
    const tween = el ? gsap.to(el, { opacity: 0, y: reduced() ? 0 : '0.5em', duration: POLL_EXIT_SEC, ease: 'power2.out' }) : null;
    const timer = setTimeout(() => {
      cancelExit();
      setShown(null);
    }, POLL_EXIT_SEC * 1000 + 40);
    exitRef.current = { timer, tween };
  }, [battle, battleId, cancelExit]);

  useEffect(() => () => cancelExit(), [cancelExit]);

  // Prueba del editor: una tanda de votos mueve la barra y la muestra vuelve a su sitio
  const test = useCallback(() => setBump((n) => (n > 0 ? -POLL_TEST_VOTES : POLL_TEST_VOTES)), []);
  useEffect(() => {
    if (live) return;
    registry.test.set(layer.id, test);
    return () => {
      registry.test.delete(layer.id);
    };
  }, [registry, layer.id, live, test]);
  useEffect(() => {
    if (!bump) return;
    const timer = setTimeout(() => setBump(0), POLL_TEST_MS);
    return () => clearTimeout(timer);
  }, [bump]);

  const sample = useMemo(() => {
    const base = samplePoll(settings);
    if (!bump) return base;
    // La tanda cae del lado que va por detrás (o del otro, si se prueba dos veces seguidas)
    return bump > 0
      ? { ...base, optionB: { ...base.optionB, votes: base.optionB.votes + bump } }
      : { ...base, optionA: { ...base.optionA, votes: base.optionA.votes - bump } };
  }, [settings, bump]);

  // Editor: la muestra. OBS: la batalla en curso y, con demo=1, la muestra mientras no hay ninguna
  const view = !live ? { id: -1, battle: sample } : shown || (demo ? { id: -1, battle: sample } : null);

  return (
    <div className="es-lalo f3-poll" data-kind="poll">
      <div ref={wrapRef} className="f3-poll-in">
        {view && (
          <BattleBarView
            key={view.id}
            title={view.battle.title}
            optionA={view.battle.optionA}
            optionB={view.battle.optionB}
            theme={settings.theme}
            timeLeftSec={view.battle.timeLeftSec}
            totalDurationSec={view.battle.totalDurationSec}
            isActive={view.battle.isActive}
            winner={view.battle.winner}
          />
        )}
      </div>
    </div>
  );
};

export const FASE3_BOXES: BoxMap = {
  roulette: RouletteBox,
  poll: PollBox,
};
