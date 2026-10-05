/**
 * src/components/estudio/boxes/fase2.tsx
 *
 * Cajas de Studio de la fase 2: Ko-fi (`kofi`, `kofigoal`, `kofirecent`),
 * Recompensa (`reward`) y Aviso de Power-up (`powerup`). El contrato está en
 * ./types.ts; lo que deciden sin tocar el DOM, en ./fase2Logic.ts.
 *
 * Cada caja usa la capa de siempre de su módulo y el CSS de
 * src/styles/estudio-fase2.css hace que la caja sea su «pantalla».
 *
 * - En OBS (`mode="live"`) les llegan las mismas señales que a las fuentes
 *   sueltas. TwitchEventLayer sigue montada en la fuente y es quien lanza las
 *   recompensas de un evento de Twitch (por triggerReward, que aquí atiende la
 *   caja «Recompensa») y pone los totales de las metas; el aviso y la voz de un
 *   Power-up, que en una escena no hace, los pone la caja «Aviso de Power-up».
 * - En el editor (`mode="edit"`) enseñan una muestra fija: sin red, sin voz, sin
 *   sonido y sin temporizadores que la retiren.
 * - Con dos cajas del mismo tipo en una escena, lo que no debe ocurrir dos veces
 *   (sonido, voz, lanzar una recompensa) lo hace solo la primera.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { fetchKofiState } from '../../../lib/integrationsApi';
import { isCloudEnabled } from '../../../lib/supabase';
import { readWidgetKey } from '../../../lib/widgetCloud';
import { loadKofiSettings, normalizeKofiSettings, type KofiSettings } from '../../../types/kofi';
import { loadPowerupsSettings } from '../../../types/powerups';
import { reduced } from '../../../utils/alertMotion';
import { listenBus } from '../../../utils/bus';
import { KOFI_DEMO_RAISED, KOFI_DEMO_RECENT, KOFI_DEMO_SEQUENCE, kofiSamplePayload } from '../../../utils/kofiSamples';
import { registerRewardsEngine, type RewardTriggerInput, type RewardTriggerResult } from '../../../utils/rewardsEngine';
import { KofiAlerts, type KofiAlertsHandle } from '../../integraciones/KofiAlerts';
import { KofiStage, type KofiStageHandle } from '../../integraciones/KofiStage';
import { PowerupNotice, useNoticeQueue } from '../../powerups/PowerupNotice';
import { NOTICE_SECONDS, voiceAllowed } from '../../powerups/noticeRules';
import { RewardPlate } from '../../recompensas/RewardPlate';
import { RewardsLayer, sampleRequest, type RewardsLayerHandle } from '../../recompensas/RewardsLayer';
import { rewardsSettingsForWidget } from '../../recompensas/RewardsWidgetLayer';
import {
  KOFI_BOX_PARTS,
  POWERUP_SAMPLE,
  REWARD_SAMPLE,
  REWARD_SAMPLE_ACCENT,
  createTurn,
  kofiSampleAlert,
  legacyRewardRequest,
  powerupBoxActions,
  rewardTestAction,
} from './fase2Logic';
import type { BoxMap, BoxProps, SceneSink } from './types';
import '../../../styles/recompensas.css';
import '../../../styles/estudio-fase2.css';

const STATE_EVERY_MS = 60000;
const NO_BLOCKED: string[] = [];

/**
 * Por dónde le llegan los avisos a una caja. En OBS los reparte el widget como
 * señales; en el editor nadie reparte nada, así que la caja que tiene ajustes
 * propios que refrescar (`editorBus`) escucha ella misma el bus del panel.
 */
function useSink({ layer, mode, registry }: BoxProps, sink: SceneSink, editorBus = false) {
  const sinkRef = useRef(sink);
  sinkRef.current = sink;
  useEffect(() => {
    const call: SceneSink = (signal) => sinkRef.current(signal);
    registry.sinks.set(layer.id, call);
    const stopBus = editorBus && mode === 'edit' ? listenBus((message) => void call({ kind: 'bus', message })) : null;
    return () => {
      if (registry.sinks.get(layer.id) === call) registry.sinks.delete(layer.id);
      stopBus?.();
    };
  }, [registry, layer.id, mode, editorBus]);
}

/** La prueba de la capa (botón «Probar» del editor). */
function useTest({ layer, registry }: BoxProps, test: () => void) {
  const testRef = useRef(test);
  testRef.current = test;
  useEffect(() => {
    const call = () => testRef.current();
    registry.test.set(layer.id, call);
    return () => {
      if (registry.test.get(layer.id) === call) registry.test.delete(layer.id);
    };
  }, [registry, layer.id]);
}

// ---------- Ko-fi ----------

/** Los ajustes de Ko-fi de la caja; `apply` los cambia cuando el bus trae unos nuevos. */
function useKofiSettings(): [KofiSettings, SceneSink] {
  const [settings, setSettings] = useState(loadKofiSettings);
  const apply = useCallback<SceneSink>((signal) => {
    if (signal.kind === 'bus' && signal.message.type === 'KOFI_SETTINGS_UPDATE') setSettings(normalizeKofiSettings(signal.message.settings));
  }, []);
  return [settings, apply];
}

const kofiVoiceTurn = createTurn();

/** Alerta de Ko-fi: la alerta ocupa la caja, centrada, con su diseño y su cola. */
const KofiAlertBox: React.FC<BoxProps> = (props) => {
  const { layer, mode, demo, services } = props;
  const live = mode === 'live';
  const [settings, applySettings] = useKofiSettings();
  const stage = useRef<KofiStageHandle | null>(null);
  const alerts = useRef<KofiAlertsHandle | null>(null);
  const servicesRef = useRef(services);
  servicesRef.current = services;
  const currency = settings.goal.currency;

  useEffect(() => (live ? kofiVoiceTurn.join(layer.id, true) : undefined), [live, layer.id]);

  useSink(props, (signal) => {
    applySettings(signal);
    // Con demo=1, o si otra caja de alertas ya suena y habla, esta solo la pinta
    if (signal.kind === 'kofi' && live) stage.current?.event(signal.payload, signal.test, demo || !kofiVoiceTurn.leads(layer.id));
  }, true);

  useTest(props, () => {
    if (live) stage.current?.event(kofiSamplePayload('d25', currency), true, true);
    else alerts.current?.preview(kofiSampleAlert(settings, false));
  });

  // Editor: una alerta de muestra fija, que se rehace si cambian el diseño o los ajustes
  useLayoutEffect(() => {
    if (!live) alerts.current?.preview(kofiSampleAlert(settings, true));
  }, [live, settings]);

  // demo=1 en la URL de la escena: alertas de ejemplo, sin sonido ni voz, para colocarla en OBS
  const hold = settings.hold;
  useEffect(() => {
    if (!live || !demo) return;
    let index = 0;
    const fire = () => {
      stage.current?.event(kofiSamplePayload(KOFI_DEMO_SEQUENCE[index % KOFI_DEMO_SEQUENCE.length], currency), true, true);
      index += 1;
    };
    const first = setTimeout(fire, 400);
    const timer = setInterval(fire, (hold + 1) * 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [live, demo, hold, currency]);

  // El mensaje del apoyo, si el streamer quiere que se lea: KofiStage ya lo pasó por las palabras bloqueadas
  const speak = useCallback((text: string) => void servicesRef.current?.speak(text, 'Ko-fi', true), []);

  return (
    <div className="es-lalo" data-kind="kofi" data-design={settings.design}>
      {live ? (
        <KofiStage
          ref={stage}
          settings={settings}
          parts={KOFI_BOX_PARTS.kofi}
          blockedWords={services?.blockedWords ?? NO_BLOCKED}
          speak={demo ? undefined : speak}
          muted={demo}
        />
      ) : (
        <KofiAlerts ref={alerts} settings={settings} />
      )}
    </div>
  );
};

/** Meta de Ko-fi y últimos apoyos: la pieza fija llena su caja y se pone al día con cada aviso. */
const KofiFixedBox: React.FC<BoxProps & { piece: 'kofigoal' | 'kofirecent' }> = (props) => {
  const { mode, demo, services, piece } = props;
  const live = mode === 'live';
  // En el editor y con demo=1 los datos son de ejemplo: ni cuenta ni servidor
  const sample = !live || !!demo;
  const [settings, applySettings] = useKofiSettings();
  const stage = useRef<KofiStageHandle | null>(null);
  const read = useRef<() => void>(() => {});

  useSink(props, (signal) => {
    applySettings(signal);
    if (sample) return;
    if (signal.kind === 'bus' && signal.message.type === 'KOFI_REFRESH') read.current();
    // Cada aviso entra en la lista y, si suma, sube la meta. Aquí nunca suena ni habla
    if (signal.kind === 'kofi') stage.current?.event(signal.payload, signal.test, true);
  }, true);

  // Lo recaudado y los últimos apoyos, del servidor: al montarse, cada minuto y al reiniciar la meta
  const refreshAt = settings.refreshAt;
  useEffect(() => {
    const key = !sample && isCloudEnabled ? readWidgetKey() : null;
    if (!key) return;
    let stopped = false;
    read.current = async () => {
      const state = await fetchKofiState(key).catch(() => null);
      if (!stopped && state) stage.current?.setState(state);
    };
    read.current();
    const timer = setInterval(() => read.current(), STATE_EVERY_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
      read.current = () => {};
    };
  }, [sample, refreshAt]);

  return (
    <div
      className="es-lalo"
      data-kind={piece}
      data-layout={piece === 'kofigoal' ? settings.goal.layout : settings.recent.layout}
      data-sample={sample ? '' : undefined}
    >
      <KofiStage
        ref={stage}
        settings={settings}
        parts={KOFI_BOX_PARTS[piece]}
        blockedWords={services?.blockedWords ?? NO_BLOCKED}
        muted
        initial={sample ? { raised: KOFI_DEMO_RAISED, recent: KOFI_DEMO_RECENT } : undefined}
      />
    </div>
  );
};

const KofiGoalBox: React.FC<BoxProps> = (props) => <KofiFixedBox {...props} piece="kofigoal" />;
const KofiRecentBox: React.FC<BoxProps> = (props) => <KofiFixedBox {...props} piece="kofirecent" />;

// ---------- Recompensa ----------

type RewardEngine = (input: RewardTriggerInput) => RewardTriggerResult;
const rewardTurn = createTurn<RewardEngine>();
let leaveEngine: (() => void) | null = null;

/**
 * La caja se apunta como la capa «Recompensas» de esta fuente: así le llega todo
 * lo que pasa por triggerReward (los canjes sin texto y los Power-ups que lanza
 * TwitchEventLayer). Con varias cajas, atiende la primera.
 */
function joinRewards(id: string, engine: RewardEngine): () => void {
  const leave = rewardTurn.join(id, engine);
  if (!leaveEngine) leaveEngine = registerRewardsEngine((input) => rewardTurn.lead()?.(input) ?? { ok: false, reason: 'no_layer' });
  return () => {
    leave();
    if (rewardTurn.size() > 0) return;
    leaveEngine?.();
    leaveEngine = null;
  };
}

/** Recompensa: placas y vídeos dentro de la caja; también los de «pantalla completa», que se ajustan a ella. */
const RewardBox: React.FC<BoxProps> = (props) => {
  const { layer, mode, demo } = props;
  const live = mode === 'live';
  const ref = useRef<RewardsLayerHandle | null>(null);
  const plateRef = useRef<HTMLDivElement | null>(null);
  // En el editor los ajustes se leen al montar: la página de Recompensas es otra pantalla del panel
  const [settings] = useState(rewardsSettingsForWidget);

  useEffect(
    () => (live ? joinRewards(layer.id, (input) => ref.current?.trigger(input) ?? { ok: false, reason: 'no_layer' }) : undefined),
    [live, layer.id]
  );

  useSink(props, (signal) => {
    if (!live || !rewardTurn.leads(layer.id)) return;
    // Cheers y canjes de puntos con texto. Los eventos de Twitch no se miran aquí: entran por triggerReward
    if (signal.kind === 'chat') ref.current?.chat(signal.tags, signal.message, signal.role);
    if (signal.kind !== 'bus') return;
    if (signal.message.type === 'REWARD_TEST') {
      const action = rewardTestAction(signal.message.test);
      if (action && 'clear' in action) ref.current?.clear();
      else if (action) ref.current?.fire(action.request, false);
    }
    if (signal.message.type === 'REWARD_TRIGGER') ref.current?.fire(legacyRewardRequest(signal.message.reward), false);
  });

  useTest(props, () => {
    if (live) {
      ref.current?.fire(sampleRequest(settings.defaultPlateStyle, null), false);
      return;
    }
    const plate = plateRef.current;
    if (!plate) return;
    gsap.killTweensOf(plate);
    gsap.fromTo(plate, { opacity: 0, y: reduced() ? 0 : '0.7em' }, { opacity: 1, y: 0, duration: 0.4, ease: 'expo.out', clearProps: 'transform,opacity' });
  });

  useEffect(
    () => () => {
      if (plateRef.current) gsap.killTweensOf(plateRef.current);
    },
    []
  );

  return (
    <div className="es-lalo" data-kind="reward">
      {live ? (
        <RewardsLayer ref={ref} getSettings={rewardsSettingsForWidget} demoPlate={demo ? settings.defaultPlateStyle : null} />
      ) : (
        // Muestra fija con la misma placa que pinta la capa, en el estilo de partida del streamer
        <div className="rwl" data-studio="" aria-hidden="true">
          <div className="rw-stack">
            <RewardPlate
              ref={plateRef}
              {...REWARD_SAMPLE}
              plateStyle={settings.defaultPlateStyle}
              accent={REWARD_SAMPLE_ACCENT}
              custom={settings.customPlate}
              still
            />
          </div>
        </div>
      )}
    </div>
  );
};

// ---------- Aviso de Power-up ----------

const powerupVoiceTurn = createTurn();

/** Aviso de Power-up: la placa de avisos dentro de la caja, con su cola. La voz del Power-up sale por la cola de voz del widget. */
const PowerupBox: React.FC<BoxProps> = (props) => {
  const { layer, mode, demo, services } = props;
  const live = mode === 'live';
  const [pulse, setPulse] = useState(0);
  const { notice, push, next } = useNoticeQueue(() => !!demo || !powerupVoiceTurn.leads(layer.id));

  useEffect(() => (live ? powerupVoiceTurn.join(layer.id, true) : undefined), [live, layer.id]);

  useSink(props, (signal) => {
    if (!live || signal.kind !== 'twitch') return;
    const { plates, voices } = powerupBoxActions(signal.event, loadPowerupsSettings());
    plates.forEach((plate) => push(plate.tag, plate.text));
    if (!services || !powerupVoiceTurn.leads(layer.id)) return;
    voices.forEach((voice) => {
      if (voiceAllowed(voice, services.blockedUsers, services.blockedWords)) services.speak(voice.text, 'Power-up', true);
    });
  });

  useTest(props, () => {
    if (live) push(POWERUP_SAMPLE.tag, POWERUP_SAMPLE.text);
    else setPulse((value) => value + 1);
  });

  // demo=1 en la URL de la escena: avisos de muestra para colocarla en OBS
  useEffect(() => {
    if (!live || !demo) return;
    const fire = () => push(POWERUP_SAMPLE.tag, POWERUP_SAMPLE.text);
    const first = setTimeout(fire, 400);
    const timer = setInterval(fire, (NOTICE_SECONDS + 1.5) * 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [live, demo, push]);

  return (
    <div className="es-lalo" data-kind="powerup">
      <div className="ovl">
        {live ? notice && <PowerupNotice key={notice.id} notice={notice} onDone={next} /> : <PowerupNotice notice={POWERUP_SAMPLE} still pulse={pulse} />}
      </div>
    </div>
  );
};

export const FASE2_BOXES: BoxMap = {
  kofi: KofiAlertBox,
  kofigoal: KofiGoalBox,
  kofirecent: KofiRecentBox,
  reward: RewardBox,
  powerup: PowerupBox,
};
