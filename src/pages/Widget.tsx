/**
 * src/pages/Widget.tsx
 *
 * Overlay de Text-to-Speech para OBS Studio.
 * - Fondo 100% transparente para Browser Source.
 * - Modelo Gratuito de Fish Audio (s2.1-pro-free) con soporte para reference_id.
 * - Motor de animaciones fluidas con GSAP (Entrada elástica back.out(1.7) + salida fade).
 * - Bucle de cola FIFO blindado contra bloqueos (Race conditions, Autoplay policy y rAF throttle).
 * - Canal BroadcastChannel para pruebas instantáneas desde el Dashboard.
 */

import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import gsap from 'gsap';
import { RejectedMessage, useTwitchChat } from '../hooks/useTwitchChat';
import { SanitizedTTSMessage } from '../utils/twitchSanitizer';
import { normalizeTextForFishAudio } from '../utils/emotionMapper';
import { loadSettings, STORAGE_KEY as TTS_STORAGE_KEY } from '../types/settings';
import { AlertPosition, inkFor } from '../utils/appearance';
import {
  ControlAction,
  ControlCommand,
  DEFAULT_TIMEOUT_MINUTES,
  needsApproval,
  normalizeModeration,
  normalizeUser,
  pickNext,
  UserRole,
} from '../utils/moderation';
import { BusMessage, LiveItem, LogItem, SessionStats, WidgetState, listenBus, postBus, RewardTriggerEvent, GoalProgressEvent } from '../utils/bus';
import { MotionOptions, playEnter, playExit, reduced, startSpeaking, stopSpeaking } from '../utils/alertMotion';
import { AlertCard } from '../components/AlertCard';
import { playAlertOrCustomSound } from '../utils/alertsAudio';
import { playModerationChime, announceModerationAction, ACTION_DESCRIPTIONS } from '../utils/moderationAudio';
import { Radio, VolumeX } from 'lucide-react';
import { loadGoalsSettings } from '../types/goals';
import { GoalsOverlayView } from '../components/goals/GoalsOverlayView';
import { RouletteLayer, RouletteLayerHandle } from '../components/roulette/RouletteLayer';
import { loadPollSettings, determineLeader, PollStyleTheme } from '../types/polls';
import { BattleBarView } from '../components/polls/BattleBarView';
import { PollBattleUpdateEvent } from '../utils/bus';
import {
  speakPollEmotionCue,
  playVoteTick,
  playLeadClash,
  playCountdownBeep,
  playPollVictoryFanfare,
  announceModPollStarted,
  announceModPollStopped,
} from '../utils/pollsAudio';
import { ChatSettings, decodeChatSettings, loadChatSettings, normalizeChatSettings } from '../types/chat';
import { ChatOverlayHandle, ChatOverlayView } from '../components/chat/ChatOverlayView';
import { ChatDisplayMessage, ChatModerationEvent, DEMO_SEQUENCE, demoMessage } from '../utils/chatFeed';
import '../styles/chat.css';
import { RaidSettings, RAID_FRAMES, RaidFrame, decodeRaidSettings, loadRaidSettings, normalizeRaidSettings } from '../types/raid';
import { RaidLayer, RaidLayerHandle } from '../components/raid/RaidLayer';
import '../styles/raid.css';
import { PetsSettings, decodePetsSettings, loadPetsSettings, normalizePetsSettings } from '../types/pets';
import { PetLayer, PetLayerHandle, PetVoiceEvent } from '../components/mascotas/PetLayer';
import { SAMPLE_CUES } from '../utils/petsLogic';
import '../styles/mascotas.css';
import { GameSettings, decodeGameSettings, loadGameSettings, normalizeGameSettings } from '../types/game';
import { GameWidgetLayer } from '../components/juego/GameWidgetLayer';
import '../styles/juego.css';
import { cloudDelivered } from '../lib/widgetCloud';
import { resolveWidgetSettings } from '../utils/widgetSettings';
import { shouldPlayPreSound } from '../utils/preSound';
import { createPreSoundPlayer } from '../utils/preSoundPlayer';
import { setActiveVoice } from '../utils/activeVoice';
import type { RewardsLayerHandle } from '../components/recompensas/RewardsLayer';
import { RewardsWidgetLayer, rewardsSettingsForWidget } from '../components/recompensas/RewardsWidgetLayer';
import { TwitchEventLayer } from '../components/powerups/TwitchEventLayer';
import { MusicWidgetLayer, MusicWidgetLayerHandle } from '../components/integraciones/MusicWidgetLayer';
import { KofiWidgetLayer, KofiWidgetLayerHandle } from '../components/integraciones/KofiWidgetLayer';
import { kofiSettingsForWidget, musicSettingsForWidget, withKofiDesign, withMusicDesign } from '../components/integraciones/widgetSettings';
import { normalizeMusicSettings } from '../types/music';
import { normalizeKofiSettings } from '../types/kofi';
import type { TwitchEvent } from '../utils/twitchEvents';
import { loadStudioSettings, normalizeStudioSettings, sceneForWidget } from '../types/studio';
import { SceneData, SceneHandle, SceneServices, SceneView } from '../components/estudio/SceneView';
import { loadAlertsSettings } from '../types/alerts';
import { Spot, pickSpot, spotStyle } from '../utils/randomSpot';

/** OBS expone window.obsstudio en sus fuentes de navegador. */
const IN_OBS = typeof window !== 'undefined' && 'obsstudio' in window;

function getURLParam(key: string): string | null {
  const searchVal = new URLSearchParams(window.location.search).get(key);
  if (searchVal) return searchVal.trim().replace(/[.,;/\\]+$/, '');

  const hash = window.location.hash;
  const qIndex = hash.indexOf('?');
  if (qIndex !== -1) {
    const hashVal = new URLSearchParams(hash.slice(qIndex)).get(key);
    if (hashVal) return hashVal.trim().replace(/[.,;/\\]+$/, '');
  }
  return null;
}

/**
 * Ajustes de la voz para esta fuente: lo guardado y lo que trae la URL, con la
 * precedencia de utils/widgetSettings.ts. Con cuenta en la nube y los ajustes ya
 * descargados manda lo guardado; si no, la URL.
 */
const widgetTtsSettings = () => resolveWidgetSettings(loadSettings(), getURLParam, cloudDelivered('tts'));

/**
 * Ajustes del chat para esta fuente. Llegan enteros en `cs`, que vale mientras la
 * cuenta en la nube no haya entregado los suyos; `tpl`, `side`, `motion` y
 * `energy` permiten cambiar uno suelto a mano.
 */
function chatSettingsForWidget(base: ChatSettings): ChatSettings {
  const fromUrl = (cloudDelivered('chat') ? null : decodeChatSettings(getURLParam('cs'))) || base;
  const overrides: Record<string, string> = {};
  const map: [string, string][] = [
    ['tpl', 'template'],
    ['side', 'side'],
    ['motion', 'motion'],
    ['energy', 'energy'],
  ];
  map.forEach(([param, key]) => {
    const value = getURLParam(param);
    if (value) overrides[key] = value.toLowerCase();
  });
  if (!Object.keys(overrides).length) return fromUrl;
  const merged = normalizeChatSettings({ ...fromUrl, ...overrides });
  // Un valor que no existe no cambia nada: se queda el que había
  (Object.keys(overrides) as (keyof ChatSettings)[]).forEach((key) => {
    if (merged[key] !== overrides[key]) Object.assign(merged, { [key]: fromUrl[key] });
  });
  return merged;
}

/**
 * Ajustes del saludo de raid para esta fuente. Llegan enteros en `rs`, que vale
 * mientras la cuenta en la nube no haya entregado los suyos; `frame` permite
 * cambiar el marco a mano.
 */
function raidSettingsForWidget(base: RaidSettings): RaidSettings {
  const fromUrl = (cloudDelivered('raid') ? null : decodeRaidSettings(getURLParam('rs'))) || base;
  const frame = (getURLParam('frame') || '').toLowerCase();
  return RAID_FRAMES.some((item) => item.id === frame) ? { ...fromUrl, frame: frame as RaidFrame } : fromUrl;
}

/** Ajustes de la mascota: los de la cuenta si llegaron; si no, los de la URL (`ps`) o los de este navegador. */
function petsSettingsForWidget(base: PetsSettings): PetsSettings {
  return (cloudDelivered('pets') ? null : decodePetsSettings(getURLParam('ps'))) || base;
}

/** Ajustes de «Alertas de juego»: los de la cuenta si llegaron; si no, los de la URL (`gs`) o los de este navegador. */
function gameSettingsForWidget(base: GameSettings): GameSettings {
  return (cloudDelivered('game') ? null : decodeGameSettings(getURLParam('gs'))) || base;
}

// Colocación de la alerta en pantalla (horizontal con justify, vertical con items)
const POSITION_CLASS: Record<AlertPosition, string> = {
  tl: 'items-start justify-start',
  tc: 'items-start justify-center',
  tr: 'items-start justify-end',
  bl: 'items-end justify-start',
  bc: 'items-end justify-center',
  br: 'items-end justify-end',
};

// Bloqueos hechos desde el chat (!s block usuario): se guardan en el navegador de OBS
const RUNTIME_BLOCKS_KEY = 'lalo_tts_runtime_blocks';

function loadRuntimeBlocks(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RUNTIME_BLOCKS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.map(normalizeUser).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function saveRuntimeBlocks(users: string[]) {
  try {
    localStorage.setItem(RUNTIME_BLOCKS_KEY, JSON.stringify(users));
  } catch {
    // Ignorar si no está soportado
  }
}

const toLiveItem = (m: SanitizedTTSMessage): LiveItem => ({
  id: m.id,
  user: m.displayName,
  username: m.username,
  text: m.cleanText,
  trigger: m.trigger,
  bits: m.bits,
});

type LiveControl = (ControlCommand & { id?: string }) | { action: 'remove'; id?: string; user?: string; minutes?: number; sender?: string; senderRole?: UserRole };

// Bloqueos temporales (!s timeout usuario 10): usuario -> momento en que caduca
const TIMEOUTS_KEY = 'lalo_tts_timeouts';

function loadTimeouts(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(TIMEOUTS_KEY) || '{}');
    const result: Record<string, number> = {};
    Object.entries(parsed || {}).forEach(([user, until]) => {
      const name = normalizeUser(user);
      if (name && typeof until === 'number' && until > Date.now()) result[name] = until;
    });
    return result;
  } catch {
    return {};
  }
}

function saveTimeouts(timeouts: Record<string, number>) {
  try {
    localStorage.setItem(TIMEOUTS_KEY, JSON.stringify(timeouts));
  } catch {
    // Ignorar si no está soportado
  }
}

const EMPTY_STATS: SessionStats = { read: 0, skipped: 0, rejected: 0, paid: 0, byUser: {} };

const LOG_LIMIT = 30;

/** Con posición aleatoria, la tarjeta de la alerta va dentro de una caja colocada en el punto elegido. */
const AlertSpot: React.FC<{ spot?: Spot; margin: number; scale: number; children: React.ReactNode }> = ({
  spot,
  margin,
  scale,
  children,
}) =>
  spot ? (
    <div
      style={{
        ...spotStyle(spot, margin),
        width: `min(calc(clamp(13px, 1.05vw, 22px) * ${scale} * 34), ${100 - margin * 2}%)`,
      }}
    >
      {children}
    </div>
  ) : (
    <>{children}</>
  );

/** Estilo del vídeo de una alerta en su punto aleatorio; undefined si no le toca. */
function rewardSpotStyle(spot: Spot | undefined, margin: number, scale: number): React.CSSProperties | undefined {
  if (!spot) return undefined;
  const base = spotStyle(spot, margin);
  return {
    ...base,
    transform: `${base.transform} scale(${scale})`,
    transformOrigin: `${(spot.u * 100).toFixed(2)}% ${(spot.v * 100).toFixed(2)}%`,
  };
}

/** demo=1 en la fuente de la voz o de las alertas: una tarjeta de muestra fija, sin sonido, para colocarla en OBS. */
const DEMO_CARD: SanitizedTTSMessage = {
  id: 'demo-card',
  rawText: '!s Así se ve un mensaje leído en tu directo',
  cleanText: 'Así se ve un mensaje leído en tu directo',
  username: 'superviewer',
  displayName: 'SuperViewer',
  userColor: '#22c7e0',
  timestamp: 0,
  trigger: 'test',
};

export const Widget: React.FC = () => {
  const [settings, setSettings] = useState(widgetTtsSettings);
  // Los ajustes vigentes, para lo que se ejecuta fuera del pintado (avisos del bus, temporizadores)
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // Las frases que dicen otras capas (batallas) usan la misma voz y el mismo volumen
  setActiveVoice(settings);

  const activeChannel = settings.channel || 'laloplay_';

  // Ajustes nuevos en este navegador: los trae la nube (widgetCloud) o el panel si comparte navegador
  useEffect(() => {
    // Un cambio en lo guardado es lo último que eligió el streamer: manda sobre la URL
    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== TTS_STORAGE_KEY) return;
      setSettings(resolveWidgetSettings(loadSettings(), getURLParam, true));
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Fondo 100% transparente para OBS Browser Source
  useEffect(() => {
    document.body.classList.add('obs-transparent');
    return () => {
      document.body.classList.remove('obs-transparent');
    };
  }, []);

  // Control en vivo: pausa, bloqueos hechos desde el chat y registro de lo leído o descartado
  const [paused, setPaused] = useState(false);
  const [runtimeBlocks, setRuntimeBlocks] = useState<string[]>(loadRuntimeBlocks);
  const [log, setLog] = useState<LogItem[]>([]);
  const [stats, setStats] = useState<SessionStats>(EMPTY_STATS);
  const pushLog = useCallback((item: LogItem) => {
    setLog((prev) => [item, ...prev].slice(0, LOG_LIMIT));
    // Contadores de la sesión: el registro solo guarda los últimos mensajes
    setStats((prev) => ({
      read: prev.read + (item.status === 'read' ? 1 : 0),
      skipped: prev.skipped + (item.status === 'skipped' ? 1 : 0),
      rejected: prev.rejected + (item.status === 'rejected' ? 1 : 0),
      paid: prev.paid + (item.status === 'read' && (item.trigger === 'reward' || item.trigger === 'bits') ? 1 : 0),
      byUser: item.status === 'read' ? { ...prev.byUser, [item.user]: (prev.byUser[item.user] || 0) + 1 } : prev.byUser,
    }));
  }, []);

  // Aprobación manual y solo texto: lo que diga el chat o el panel manda sobre la URL
  const [approvalOverride, setApprovalOverride] = useState<boolean | null>(null);
  const [textOnlyOverride, setTextOnlyOverride] = useState<boolean | null>(null);
  const [approvedIds, setApprovedIds] = useState<string[]>([]);
  const approval = approvalOverride ?? settings.approvalMode;
  const textOnly = textOnlyOverride ?? settings.textOnly;
  const textOnlyRef = useRef(textOnly);
  textOnlyRef.current = textOnly;

  // Bloqueos temporales: un reloj los hace caducar
  const [timeouts, setTimeouts] = useState<Record<string, number>>(loadTimeouts);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  const activeTimeouts = useMemo(
    () =>
      Object.entries(timeouts)
        .filter(([, until]) => until > clock)
        .map(([user, until]) => ({ user, until })),
    [timeouts, clock]
  );
  const controlRef = useRef<(command: LiveControl) => void>(() => {});
  const finalizeRef = useRef<((skipped?: boolean) => void) | null>(null);

  const moderation = useMemo(
    () =>
      normalizeModeration({
        ...settings,
        blockedUsers: [...settings.blockedUsers, ...runtimeBlocks, ...activeTimeouts.map((t) => t.user)],
      }),
    [settings, runtimeBlocks, activeTimeouts]
  );

  const handleRejected = useCallback(
    (m: RejectedMessage) =>
      pushLog({ id: m.id, user: m.user, username: m.username, text: m.text, at: m.at, status: 'rejected', reason: m.reason }),
    [pushLog]
  );
  const handleControl = useCallback((command: ControlCommand) => controlRef.current(command), []);

  // Capa «Chat en vivo»: fuente propia (app=chat) o dentro de «Todo en uno»
  const appParam = (getURLParam('app') || '').toLowerCase();

  // Escena de Studio (app=scene): sus capas reciben los mismos avisos que las fuentes sueltas
  const isScene = appParam === 'scene';
  const [studioSettings, setStudioSettings] = useState(loadStudioSettings);
  const scene = useMemo(
    () => (isScene ? sceneForWidget(studioSettings, getURLParam('scene'), getURLParam('sc')) : null),
    [isScene, studioSettings]
  );
  const sceneRef = useRef<SceneHandle | null>(null);
  const sceneHas = (type: string) => !!scene && scene.layers.some((layer) => layer.type === type && !layer.hidden);
  const sceneInfoRef = useRef({ isScene, hasAlert: false, hasPoll: false, hasReward: false });
  sceneInfoRef.current = { isScene, hasAlert: sceneHas('alert'), hasPoll: sceneHas('poll'), hasReward: sceneHas('reward') };

  // Alertas: posición aleatoria en la pantalla, si el streamer la encendió
  const [alertsSettings, setAlertsSettings] = useState(loadAlertsSettings);
  const alertsRef = useRef(alertsSettings);
  alertsRef.current = alertsSettings;
  const alertSpotsRef = useRef(new Map<string, Spot>());
  const lastAlertSpotRef = useRef<Spot | null>(null);

  const isChatOnly = appParam === 'chat';
  const [chatSettings, setChatSettings] = useState(() => chatSettingsForWidget(loadChatSettings()));
  const showChat = isChatOnly || (appParam === 'all' && chatSettings.inAll);
  const chatRef = useRef<ChatOverlayHandle | null>(null);
  const chatFilterRef = useRef({ hideCommands: false, hideBots: true, bots: moderation.ignoredBots });
  chatFilterRef.current = { hideCommands: chatSettings.hideCommands, hideBots: chatSettings.hideBots, bots: moderation.ignoredBots };

  const handleChatMessage = useCallback((message: ChatDisplayMessage) => {
    const filter = chatFilterRef.current;
    if (filter.hideCommands && message.text.trim().startsWith('!')) return;
    if (filter.hideBots && filter.bots.includes(message.username)) return;
    chatRef.current?.push(message);
    sceneRef.current?.chat.push(message);
  }, []);
  const handleChatModeration = useCallback((event: ChatModerationEvent) => {
    if (event.type === 'delete') chatRef.current?.remove(event.id);
    if (event.type === 'user') chatRef.current?.removeUser(event.username);
    if (event.type === 'clear') chatRef.current?.clear();
    if (event.type === 'delete') sceneRef.current?.chat.remove(event.id);
    if (event.type === 'user') sceneRef.current?.chat.removeUser(event.username);
    if (event.type === 'clear') sceneRef.current?.chat.clear();
  }, []);

  // Capa «Saludo de raid»: fuente propia (app=raid) o dentro de «Todo en uno»
  const isRaidOnly = appParam === 'raid';
  const [raidSettings, setRaidSettings] = useState(() => raidSettingsForWidget(loadRaidSettings()));
  const showRaid = isRaidOnly || (appParam === 'all' && raidSettings.inAll);
  const raidRef = useRef<RaidLayerHandle | null>(null);
  // Mascota: fuente propia (app=pets) o dentro de «Todo en uno». Habla por la misma cola de voz
  const isPetsOnly = appParam === 'pets';
  const [petsSettings, setPetsSettings] = useState(() => petsSettingsForWidget(loadPetsSettings()));
  const showPets = isPetsOnly || (appParam === 'all' && petsSettings.inAll);
  const petsRef = useRef<PetLayerHandle | null>(null);
  // Alertas de juego (Riot): fuente propia (app=game) o dentro de «Todo en uno». No lee el chat: solo anuncia lo suyo
  const isGameOnly = appParam === 'game';
  const [gameSettings, setGameSettings] = useState(() => gameSettingsForWidget(loadGameSettings()));
  const showGame = isGameOnly || (appParam === 'all' && gameSettings.inAll);
  const gameVoiceRef = useRef({ game: gameSettings, pets: petsSettings, showPets });
  gameVoiceRef.current = { game: gameSettings, pets: petsSettings, showPets };
  const handleRaid = useCallback((raid: { channel: string; login: string; viewers: number }) => {
    raidRef.current?.raid(raid.channel, raid.viewers, raid.login);
    sceneRef.current?.raid(raid.channel, raid.viewers, raid.login);
    sceneRef.current?.signal({ kind: 'raid', channel: raid.channel, viewers: raid.viewers, login: raid.login });
    petsRef.current?.raid(raid.channel, raid.viewers);
  }, []);
  // Ruleta: fuente propia (app=roulette) o dentro de «Todo en uno». La giran los puntos del canal o
  // los bits; el streamer y sus moderadores la abren y la cierran con un comando
  const isRouletteApp = appParam === 'roulette' || appParam === 'ruleta' || appParam === 'wheel';
  const showRoulette = isRouletteApp || appParam === 'all';
  const rouletteRef = useRef<RouletteLayerHandle | null>(null);
  // Confirmación en pantalla de un comando que atendió una capa (se asigna más abajo, con el aviso de moderación)
  const staffNoticeRef = useRef<(sender: string, message: string) => void>(() => {});
  const handleStaffMessage = useCallback((message: string, sender: { name: string; role: UserRole }) => {
    const taken =
      (raidRef.current?.command(message, sender) ?? false) ||
      (sceneRef.current?.raidCommand(message, sender) ?? false) ||
      (rouletteRef.current?.command(message, sender) ?? false) ||
      (musicRef.current?.command(message, sender) ?? false) ||
      (sceneRef.current?.signal({ kind: 'staff', message, sender }) ?? false);
    // Quien lo escribió ve en el directo que su comando llegó
    if (taken) staffNoticeRef.current(sender.name, message);
    return taken;
  }, []);

  // Integraciones. «Ahora suena»: fuente propia (app=music) o dentro de «Todo en uno». La muestran y
  // la ocultan el streamer y sus moderadores con un comando
  const appParamRef = useRef(appParam);
  const [musicSettings, setMusicSettings] = useState(() => musicSettingsForWidget(getURLParam));
  const showMusic = appParam === 'music' || (appParam === 'all' && musicSettings.inAll);
  const musicRef = useRef<MusicWidgetLayerHandle | null>(null);
  // Ko-fi: alertas (app=kofi), meta (app=kofigoal) y últimos apoyos (app=kofirecent); en «Todo en uno»,
  // las piezas que el streamer tenga encendidas
  const isKofiAlerts = appParam === 'kofi';
  const [kofiSettings, setKofiSettings] = useState(() => kofiSettingsForWidget(getURLParam, appParam));
  const kofiInAll = appParam === 'all' && kofiSettings.inAll;
  const kofiGoalOn = appParam === 'kofigoal' || (kofiInAll && kofiSettings.goal.on);
  const kofiRecentOn = appParam === 'kofirecent' || (kofiInAll && kofiSettings.recent.on);
  const kofiAlertsOn = isKofiAlerts || kofiInAll;
  const kofiParts = useMemo(() => ({ alerts: kofiAlertsOn, goal: kofiGoalOn, recent: kofiRecentOn }), [kofiAlertsOn, kofiGoalOn, kofiRecentOn]);
  const showKofi = kofiAlertsOn || kofiGoalOn || kofiRecentOn;
  const kofiRef = useRef<KofiWidgetLayerHandle | null>(null);
  const handleKofiEvent = useCallback((payload: unknown, test: boolean) => {
    kofiRef.current?.event(payload, test);
    sceneRef.current?.signal({ kind: 'kofi', payload, test });
  }, []);
  // Estas fuentes no hablan: la voz sale por «Voz del chat», «Todo en uno» o «Alertas de Ko-fi»
  const isQuietIntegration = appParam === 'music' || appParam === 'kofigoal' || appParam === 'kofirecent';

  // Capa «Recompensas»: fuente propia (app=rewards) o dentro de «Todo en uno». Reacciona sola a los
  // cheers y a los canjes con texto que llegan por la misma conexión del chat
  const isRewardsOnly = appParam === 'rewards' || appParam === 'recompensas';
  const [rewardsInAll, setRewardsInAll] = useState(() => rewardsSettingsForWidget().inAll);
  useEffect(() => {
    if (appParam !== 'all') return;
    const timer = setInterval(() => setRewardsInAll(rewardsSettingsForWidget().inAll), 30000);
    return () => clearInterval(timer);
  }, [appParam]);
  const showRewards = isRewardsOnly || (appParam === 'all' && rewardsInAll);
  const rewardsRef = useRef<RewardsLayerHandle | null>(null);
  const handleRewardChat = useCallback(
    (tags: Parameters<RewardsLayerHandle['chat']>[0], message: string, role: UserRole) => {
      rewardsRef.current?.chat(tags, message, role);
      rouletteRef.current?.chat(tags, role);
      petsRef.current?.chat(tags, message);
      sceneRef.current?.signal({ kind: 'chat', tags, message, role });
    },
    []
  );
  // Temporizador del aviso antiguo (REWARD_TRIGGER): uno nuevo no hereda la retirada del anterior
  const rewardHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // demo=1: chat de muestra para colocar la capa en OBS sin esperar al chat real
  const chatDemo = (showChat || sceneHas('chat')) && getURLParam('demo') === '1';
  const voiceCommandRef = useRef(moderation.voiceCommand);
  voiceCommandRef.current = moderation.voiceCommand;
  useEffect(() => {
    if (!chatDemo) return;
    let step = 0;
    const next = () => {
      const kind = DEMO_SEQUENCE[step % DEMO_SEQUENCE.length];
      step += 1;
      const sample = demoMessage(kind, voiceCommandRef.current, kind === 'command');
      chatRef.current?.push(sample);
      sceneRef.current?.chat.push(sample);
      // Al final de cada vuelta se borra un mensaje, para ver la moderación
      if (step % DEMO_SEQUENCE.length === 0) {
        setTimeout(() => {
          chatRef.current?.removeLast();
          sceneRef.current?.chat.removeLast();
        }, 900);
      }
    };
    const first = [0, 350, 700, 1050, 1400].map((wait) => setTimeout(next, wait));
    const timer = setInterval(next, 1900);
    return () => {
      first.forEach(clearTimeout);
      clearInterval(timer);
    };
  }, [chatDemo]);

  const {
    messageQueue,
    isConnected,
    removeMessageFromQueue,
    clearQueue,
    enqueueManualMessage
  } = useTwitchChat({
    channel: activeChannel,
    enabled: true,
    moderation,
    onControl: handleControl,
    onRejected: handleRejected,
    onChatMessage: handleChatMessage,
    onChatModeration: handleChatModeration,
    onRaid: handleRaid,
    onStaffMessage: handleStaffMessage,
    onChatEvent: handleRewardChat,
  });

  // La bienvenida de una raid entra en la misma cola de voz que el chat
  const speakRaidWelcome = useCallback((text: string) => enqueueManualMessage(text, 'Raid', true), [enqueueManualMessage]);
  // Lo que dice la ruleta también: una sola voz, la de «Voz del chat», y una frase detrás de otra
  const speakRoulette = useCallback((text: string) => enqueueManualMessage(text, 'Ruleta', true), [enqueueManualMessage]);
  const handleTwitchEvent = useCallback((event: TwitchEvent) => {
    rouletteRef.current?.event(event);
    petsRef.current?.event(event);
    sceneRef.current?.signal({ kind: 'twitch', event });
  }, []);
  // Una frase de la cola de voz empieza o termina: lo saben la mascota y las capas de la escena
  const tapVoice = useCallback((event: PetVoiceEvent) => {
    petsRef.current?.voice(event);
    sceneRef.current?.signal({ kind: 'voice', event });
  }, []);
  // Lo que el widget presta a las capas de una escena de Studio
  const queueLengthRef = useRef(0);
  queueLengthRef.current = messageQueue.length;
  const sceneServices = useMemo<SceneServices>(
    () => ({
      speak: (text, username, system, options) => enqueueManualMessage(text, username, system, options)?.id ?? null,
      queueLength: () => queueLengthRef.current,
      blockedWords: moderation.blockedWords,
      blockedUsers: moderation.blockedUsers,
      ignoredBots: moderation.ignoredBots,
    }),
    [enqueueManualMessage, moderation.blockedWords, moderation.blockedUsers, moderation.ignoredBots]
  );
  // Lo que dice la mascota, con su voz si tiene una; devuelve el id para saber cuándo suena su frase
  const speakPet = useCallback(
    (text: string, options: { voiceId?: string; front?: boolean }) => enqueueManualMessage(text, 'Mascota', true, options)?.id ?? null,
    [enqueueManualMessage]
  );
  // Una alerta de juego: la dice la mascota si está montada en esta fuente y la acepta; si no, la voz.
  // La emoción va como etiqueta al inicio del texto y la frase se lee tal cual, sin tarjeta
  const announceGame = useCallback(
    (text: string) => {
      const { game, pets, showPets: petsHere } = gameVoiceRef.current;
      if (game.announcer === 'nadie') return;
      if (game.announcer === 'mascota' && petsHere && petsRef.current?.say(text)) return;
      const voiceId = game.voiceSource === 'pet' ? pets.voiceId : game.voiceSource === 'catalogue' ? game.voiceId : '';
      enqueueManualMessage(text, 'Juego', true, voiceId ? { voiceId } : {});
    },
    [enqueueManualMessage]
  );
  // El mensaje de un apoyo de Ko-fi, cuando el streamer quiere que se lea
  const speakKofi = useCallback((text: string) => void enqueueManualMessage(text, 'Ko-fi', true), [enqueueManualMessage]);

  // Sonido antes de la voz: se carga por adelantado y se recuerda cuándo habló la voz por última vez
  const preSoundRef = useRef<ReturnType<typeof createPreSoundPlayer> | null>(null);
  if (!preSoundRef.current) preSoundRef.current = createPreSoundPlayer();
  const lastSpokenAtRef = useRef(0);
  // Mensajes que ya llegan con su propio sonido (alertas): no llevan otro encima
  const ownSoundIdsRef = useRef(new Set<string>());
  useEffect(() => {
    preSoundRef.current?.preload(settings.preSound);
  }, [settings.preSound]);

  const [currentMessage, setCurrentMessage] = useState<SanitizedTTSMessage | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isAudioLoading, setIsAudioLoading] = useState<boolean>(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState<boolean>(false);

  // Notificación de acciones de moderadores en pantalla
  const [modNotice, setModNotice] = useState<{
    /** `command`: comando de otra capa (saludo de raid, ruleta, música); `user` lleva el comando. */
    action: ControlAction | 'remove' | 'command';
    sender: string;
    user?: string;
    timestamp: number;
  } | null>(null);
  const modNoticeRef = useRef<HTMLDivElement | null>(null);
  staffNoticeRef.current = (sender, message) => {
    if (moderation.modNotificationAudio !== false) playModerationChime(settings.volume);
    setModNotice({ action: 'command', sender, user: message.trim().split(/\s+/)[0].slice(0, 24), timestamp: Date.now() });
  };

  // Referencias defensivas y de animación GSAP
  const isProcessingRef = useRef<boolean>(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Timelines GSAP de entrada y de voz, y opciones de movimiento vigentes
  const entryTimelineRef = useRef<gsap.core.Timeline | null>(null);
  const speakTimelineRef = useRef<gsap.core.Timeline | null>(null);
  const motion: MotionOptions = {
    style: settings.alertStyle,
    position: settings.position,
    energy: settings.energy,
    accent: settings.accent,
    emotion: currentMessage?.emotion?.tag,
    leadIn: settings.announceSender !== false ? 1 : 0,
  };
  const motionRef = useRef<MotionOptions>(motion);
  motionRef.current = motion;

  // Sincronización entre pestañas (Dashboard <-> Widget) vía BroadcastChannel
  useEffect(() => {
    let bus: BroadcastChannel | null = null;
    try {
      bus = new BroadcastChannel('lalo_tts_bus');
      bus.onmessage = (event) => {
        if (event.data?.type === 'ENQUEUE' && event.data.text) {
          enqueueManualMessage(event.data.text, event.data.user || 'Streamer');
        }
        if (event.data?.type === 'SETTINGS_UPDATE' && event.data.settings) {
          console.log('[Lalo Widget] Configuración actualizada dinámicamente desde el Dashboard.');
          // Lo envía el panel o la nube: es lo último que eligió el streamer y manda sobre la URL
          setSettings((prev) => resolveWidgetSettings({ ...prev, ...event.data.settings }, getURLParam, true));
        }
        if (event.data?.type === 'FORCE_RELOAD' || event.data?.type === 'RELOAD') {
          console.log('[Lalo Widget] Orden de recarga remota recibida vía BroadcastChannel.');
          window.location.reload();
        }
      };
    } catch {
      // BroadcastChannel no soportado en entornos antiguos
    }

    // Exponer método en window para pruebas directas en la misma ventana
    (window as unknown as { __LALO_TTS_TEST_TRIGGER__?: (text: string, user?: string) => void }).__LALO_TTS_TEST_TRIGGER__ = (
      text: string,
      user?: string
    ) => {
      enqueueManualMessage(text, user);
    };

    return () => {
      if (bus) bus.close();
    };
  }, [enqueueManualMessage]);

  // Observador de despliegues seguro para OBS Studio:
  // Detecta si se publica un nuevo commit en Vercel y actualiza el overlay de forma transparente
  // ÚNICAMENTE cuando está inactivo y con cooldown de 30 segundos para prevenir cualquier bucle.
  useEffect(() => {
    let initialDeployment: string | null = null;
    let isChecking = false;

    const checkDeployment = async () => {
      if (isChecking) return;
      isChecking = true;
      try {
        const res = await fetch(`/api/version?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        const serverDeployment = data?.deployment;

        if (!initialDeployment) {
          initialDeployment = serverDeployment;
        } else if (serverDeployment && initialDeployment !== serverDeployment) {
          const isManual = typeof serverDeployment === 'string' && serverDeployment.includes('manual-reload');
          const lastReload = Number(sessionStorage.getItem('last_auto_update_ts') || '0');

          // Si el streamer presionó "Actualizar OBS", recargar sin esperar cooldown
          if (isManual || Date.now() - lastReload > 25000) {
            sessionStorage.setItem('last_auto_update_ts', Date.now().toString());
            console.log('[OBS Widget] Actualización detectada desde el panel. Recargando overlay en OBS...');
            window.location.reload();
          }
        }
      } catch {
        // Ignorar fallos temporales de conexión
      } finally {
        isChecking = false;
      }
    };

    const initialTimer = setTimeout(checkDeployment, 1500);
    const intervalTimer = setInterval(checkDeployment, 7000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
    };
  }, [isPlaying, messageQueue.length]);

  // demo=1 en la fuente de la voz o de las alertas: tarjeta de muestra fija para colocarla y ver el tamaño
  const cardDemo = getURLParam('demo') === '1' && ['', 'tts', 'alerts'].includes(appParam);
  useEffect(() => {
    if (cardDemo && !currentMessage && !isPlaying) setCurrentMessage(DEMO_CARD);
  }, [cardDemo, currentMessage, isPlaying]);

  // Animación de entrada GSAP según el estilo de alerta elegido.
  // useLayoutEffect evita que la tarjeta se vea un fotograma antes de animar.
  useLayoutEffect(() => {
    if (currentMessage && cardRef.current) {
      entryTimelineRef.current?.kill();
      entryTimelineRef.current = playEnter(cardRef.current, motionRef.current);
    }
  }, [currentMessage]);

  // Animación de salida GSAP con seguro contra throttling de rAF en OBS
  const animateExit = useCallback((onCompleteCallback: () => void) => {
    let finished = false;
    const triggerComplete = () => {
      if (!finished) {
        finished = true;
        onCompleteCallback();
      }
    };

    // Timeout de escape: garantiza que onCompleteCallback SIEMPRE se ejecute
    // incluso si OBS suspende el requestAnimationFrame de la pestaña oculta
    const hardTimeout = setTimeout(triggerComplete, 500);

    if (cardRef.current) {
      entryTimelineRef.current?.kill();
      playExit(cardRef.current, motionRef.current, () => {
        clearTimeout(hardTimeout);
        triggerComplete();
      });
    } else {
      clearTimeout(hardTimeout);
      triggerComplete();
    }
  }, []);

  // Indicador de voz del estilo activo (vúmetro, ondas, karaoke o sticker).
  // Usa la duración real del audio cuando se conoce; si no, la estima por longitud.
  const startSpeakingAnimation = useCallback((textLength?: number, seconds?: number) => {
    if (!cardRef.current) return;
    speakTimelineRef.current?.kill();
    const estimated = Math.max(3, (textLength || 80) * 0.065);
    const duration = seconds && Number.isFinite(seconds) && seconds > 0 ? seconds : estimated;
    speakTimelineRef.current = startSpeaking(cardRef.current, motionRef.current, duration);
  }, []);

  const stopSpeakingAnimation = useCallback(() => {
    if (cardRef.current) {
      stopSpeaking(cardRef.current, speakTimelineRef.current);
    } else {
      speakTimelineRef.current?.kill();
    }
    speakTimelineRef.current = null;
  }, []);

  // Procesamiento y reproducción de audio de un mensaje
  const playAudioForMessage = useCallback(
    async (message: SanitizedTTSMessage) => {
      isProcessingRef.current = true;
      setIsPlaying(true);
      setIsAudioLoading(true);
      setCurrentMessage(message);

      let audioUrl: string | null = null;
      let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
      let finalized = false;

      // Limpieza final y avance incondicional a la siguiente tarjeta (idempotente)
      const finalizePlayback = (skipped = false) => {
        if (finalized) return;
        finalized = true;

        if (watchdogTimer) clearTimeout(watchdogTimer);
        lastSpokenAtRef.current = Date.now();
        ownSoundIdsRef.current.delete(message.id);
        tapVoice({ id: message.id, phase: 'end' });
        if (skipped) {
          // Saltado por el streamer: cortar la voz y el sonido previo ya
          preSoundRef.current?.stop();
          if (audioRef.current) audioRef.current.pause();
          if ('speechSynthesis' in window && window.speechSynthesis) window.speechSynthesis.cancel();
        }
        pushLog({ ...toLiveItem(message), at: Date.now(), status: skipped ? 'skipped' : 'read' });
        stopSpeakingAnimation();

        animateExit(() => {
          finalizeRef.current = null;
          setCurrentMessage(null);
          setIsAudioLoading(false);
          setIsPlaying(false);
          isProcessingRef.current = false;

          if (audioUrl) {
            URL.revokeObjectURL(audioUrl);
          }
          if (audioRef.current) {
            audioRef.current = null;
          }
        });
      };

      finalizeRef.current = finalizePlayback;

      // Solo texto: la alerta se muestra el tiempo que se tardaría en leerla, sin pedir audio
      if (textOnlyRef.current) {
        const seconds = Math.min(20, Math.max(3, message.cleanText.length * 0.065));
        setIsAudioLoading(false);
        startSpeakingAnimation(message.cleanText.length, seconds);
        tapVoice({ id: message.id, phase: 'start', seconds });
        watchdogTimer = setTimeout(() => finalizePlayback(), seconds * 1000);
        return;
      }

      // Sonido antes de la voz: empieza ya, mientras se pide el audio, para que no haya hueco.
      // La promesa se cumple cuando la voz puede empezar y nunca falla
      const preSound = shouldPlayPreSound(settings.preSound, {
        trigger: message.trigger,
        system: message.system,
        hasOwnSound: ownSoundIdsRef.current.has(message.id),
        textOnly: false,
        lastSpokenAt: lastSpokenAtRef.current,
        now: Date.now(),
      })
        ? (preSoundRef.current?.play(settings.preSound) ?? Promise.resolve()).catch(() => {})
        : Promise.resolve();

      try {
        const controller = new AbortController();
        const fetchTimeout = setTimeout(() => controller.abort(), 40000);

        // Preparar texto a sintetizar anunciando el nombre del usuario si está habilitado
        const cleanUserName = (message.displayName || message.username || 'Usuario')
          .replace(/[_.-]+/g, ' ')
          .trim();

        // Traducir etiquetas de emoción al formato canónico en inglés para Fish Audio S2 (ej. [feliz] -> [happy])
        const normalizedMessageText = normalizeTextForFishAudio(message.cleanText);

        const isSinging = message.emotion?.tag === 'singing';
        let spokenText: string;

        if (settings.announceSender !== false && !message.system) {
          if (isSinging) {
            // Para canciones: anunciar que el usuario "canta" y delimitar con punto
            // para que Fish Audio inicie la prosodia musical limpia desde el inicio del verso
            const singingTemplate = settings.announceTemplate
              ? settings.announceTemplate.replace(/dice:?/i, 'canta.')
              : '{user} canta.';
            const intro = singingTemplate.replace('{user}', cleanUserName).replace('{message}', '').trim();
            const cleanSong = normalizedMessageText.replace(/^\[singing\]\s*/i, '');
            spokenText = `${intro} [singing] ${cleanSong}`.trim();
          } else {
            const template = settings.announceTemplate || '{user} dice: {message}';
            spokenText = template
              .replace('{user}', cleanUserName)
              .replace('{message}', normalizedMessageText);
          }
        } else {
          spokenText = normalizedMessageText;
        }

        // Llamada al endpoint backend con el modelo gratuito s2.1-pro-free
        const response = await fetch('/api/tts', {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: spokenText,
            reference_id: message.voiceId || settings.referenceId || undefined,
            model: settings.model || 's2.1-pro-free',
          }),
        });

        clearTimeout(fetchTimeout);

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData?.error || `HTTP ${response.status}`);
        }

        const blob = await response.blob();
        audioUrl = URL.createObjectURL(blob);

        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.src = '';
        }

        const audio = new Audio(audioUrl);
        audio.volume = settings.volume;
        audio.playbackRate = settings.speed;
        audioRef.current = audio;

        audio.onplay = () => {
          setIsAudioLoading(false);
          setAutoplayBlocked(false);
          startSpeakingAnimation(message.cleanText.length, audio.duration / (audio.playbackRate || 1));
          // La mascota mueve la boca con el volumen de este mismo audio
          tapVoice({ id: message.id, phase: 'start', seconds: audio.duration / (audio.playbackRate || 1), audio, blob });
        };

        audio.onended = () => {
          finalizePlayback();
        };

        audio.onerror = (e) => {
          console.warn('[Audio Player Error]', e);
          finalizePlayback();
        };

        // Watchdog de seguridad (proporcional al texto de hasta 1200 caracteres)
        const maxDurationMs = Math.max(20000, message.cleanText.length * 250);
        watchdogTimer = setTimeout(() => {
          console.warn('[Audio Watchdog] Tiempo límite alcanzado. Pasando al siguiente mensaje.');
          finalizePlayback();
        }, maxDurationMs);

        // Pre-cargar el buffer de audio para evitar chasquidos, cortes o zumbidos iniciales en OBS
        await new Promise<void>((resolve) => {
          let ready = false;
          const onReady = () => {
            if (!ready) {
              ready = true;
              resolve();
            }
          };
          audio.addEventListener('canplaythrough', onReady, { once: true });
          audio.addEventListener('loadeddata', onReady, { once: true });
          setTimeout(onReady, 350);
        });

        // La voz espera a que acabe el sonido previo (o a su tope)
        await preSound;
        if (finalized) return;

        // Intentar reproducción
        await audio.play();
      } catch (err) {
        console.warn('[Widget TTS Error]', err);
        setIsAudioLoading(false);

        // Si el navegador bloqueó la reproducción automática (Autoplay policy)
        if (err instanceof Error && err.name === 'NotAllowedError') {
          console.warn('[Autoplay] Bloqueado por política del navegador. Esperando interacción.');
          setAutoplayBlocked(true);
        }

        // Respaldo de emergencia con Web Speech API
        if ('speechSynthesis' in window && window.speechSynthesis) {
          try {
            window.speechSynthesis.cancel();
            const cleanUserName = (message.displayName || message.username || 'Usuario')
              .replace(/[_.-]+/g, ' ')
              .trim();
            // Limpiar etiquetas entre corchetes para que el sintetizador nativo no las lea literalmente
            const speechText = message.cleanText.replace(/\[[a-zA-ZáéíóúÁÉÍÓÚñÑ\s-_]{2,30}\]/g, '').trim() || message.cleanText;
            const fallbackText = settings.announceSender !== false && !message.system
              ?`${cleanUserName} dice: ${speechText}`
              : speechText;

            await preSound;
            if (finalized) return;
            const utterance = new SpeechSynthesisUtterance(fallbackText);
            utterance.lang = 'es-ES';
            utterance.rate = settings.speed;
            utterance.volume = settings.volume;

            let speechFinished = false;
            const finishSpeech = () => {
              if (!speechFinished) {
                speechFinished = true;
                if (speechWatchdog) clearTimeout(speechWatchdog);
                finalizePlayback();
              }
            };

            const speechTimeoutMs = Math.max(8000, Math.min(180000, message.cleanText.length * 180));
            const speechWatchdog = setTimeout(finishSpeech, speechTimeoutMs);

            utterance.onstart = () => {
              setIsAudioLoading(false);
              startSpeakingAnimation(message.cleanText.length);
              tapVoice({ id: message.id, phase: 'start' });
            };
            utterance.onend = finishSpeech;
            utterance.onerror = finishSpeech;

            window.speechSynthesis.speak(utterance);
            return;
          } catch {
            // fallback falló, cerrar limpiamente
          }
        }

        // Si todo falla, pausar brevemente y avanzar a la siguiente tarjeta
        setTimeout(() => {
          finalizePlayback();
        }, 1200);
      }
    },
    [settings, animateExit, startSpeakingAnimation, stopSpeakingAnimation, pushLog]
  );

  // Un cambio de volumen o de velocidad se nota también en el mensaje que está sonando
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = settings.volume;
    audio.playbackRate = settings.speed;
  }, [settings.volume, settings.speed]);

  // Órdenes de control: llegan del chat (streamer y mods) o del control en vivo de este navegador
  controlRef.current = (command: LiveControl) => {
    // Retroalimentación sonora y locución ante órdenes de moderación
    if (command.action !== 'reload') {
      if (moderation.modNotificationAudio !== false) {
        playModerationChime(settings.volume);
      }
      if (moderation.modNotificationVoice !== false && command.action !== 'remove') {
        announceModerationAction(
          command.action as ControlAction,
          command.sender || 'Moderación',
          command.user,
          command.minutes,
          settings.volume
        );
      }
      setModNotice({
        action: command.action,
        sender: command.sender || 'Moderación',
        user: command.user,
        timestamp: Date.now(),
      });
    }

    const dropUser = (user: string) =>
      messageQueue.filter((m) => m.username.toLowerCase() === user && m.trigger !== 'test').forEach((m) => removeMessageFromQueue(m.id));

    switch (command.action) {
      case 'skip':
        finalizeRef.current?.(true);
        break;
      case 'pause':
        setPaused(true);
        break;
      case 'resume':
        setPaused(false);
        break;
      case 'clear':
        messageQueue.forEach((m) => pushLog({ ...toLiveItem(m), at: Date.now(), status: 'skipped', reason: 'Cola vaciada' }));
        clearQueue();
        break;
      case 'panic':
        // Silencio: corta la voz, vacía la cola y deja todo en pausa
        finalizeRef.current?.(true);
        messageQueue.forEach((m) => pushLog({ ...toLiveItem(m), at: Date.now(), status: 'skipped', reason: 'Silencio' }));
        clearQueue();
        setPaused(true);
        break;
      case 'remove':
      case 'reject': {
        // Sin id, se rechaza el mensaje más antiguo que espera aprobación.
        // removeMessageFromQueue quita el primero si no encuentra el id: comprobar antes.
        const target = command.id
          ? messageQueue.find((m) => m.id === command.id)
          : messageQueue.find((m) => needsApproval(m, { approval, approvedIds, priorityPaid: false }));
        if (target) {
          pushLog({ ...toLiveItem(target), at: Date.now(), status: 'rejected', reason: command.action === 'reject' ? 'No aprobado' : 'Quitado' });
          removeMessageFromQueue(target.id);
        }
        break;
      }
      case 'approve': {
        const target = command.id
          ? messageQueue.find((m) => m.id === command.id)
          : messageQueue.find((m) => needsApproval(m, { approval, approvedIds, priorityPaid: false }));
        if (target) setApprovedIds((prev) => [...prev.slice(-99), target.id]);
        break;
      }
      case 'manual':
        setApprovalOverride(true);
        break;
      case 'auto':
        setApprovalOverride(false);
        break;
      case 'mute':
        setTextOnlyOverride(true);
        break;
      case 'unmute':
        setTextOnlyOverride(false);
        break;
      case 'timeout':
        if (command.user) {
          const user = command.user;
          const until = Date.now() + (command.minutes || DEFAULT_TIMEOUT_MINUTES) * 60000;
          setTimeouts((prev) => {
            const next = { ...prev, [user]: until };
            saveTimeouts(next);
            return next;
          });
          dropUser(user);
        }
        break;
      case 'block':
        if (command.user) {
          const user = command.user;
          setRuntimeBlocks((prev) => {
            const next = prev.includes(user) ? prev : [...prev, user];
            saveRuntimeBlocks(next);
            return next;
          });
          dropUser(user);
        }
        break;
      case 'unblock':
        if (command.user) {
          const user = command.user;
          setRuntimeBlocks((prev) => {
            const next = prev.filter((u) => u !== user);
            saveRuntimeBlocks(next);
            return next;
          });
          setTimeouts((prev) => {
            const next = { ...prev };
            delete next[user];
            saveTimeouts(next);
            return next;
          });
        }
        break;
      default:
        break;
    }
  };

  // Estado para el control en vivo: se publica con cada cambio y con un latido periódico
  const publishRef = useRef<() => void>(() => {});
  publishRef.current = () => {
    const state: WidgetState = {
      channel: activeChannel,
      connected: isConnected,
      paused,
      approval,
      textOnly,
      timeouts: activeTimeouts,
      stats,
      now: currentMessage ? toLiveItem(currentMessage) : null,
      queue: messageQueue.map((m) => ({ ...toLiveItem(m), pending: needsApproval(m, { approval, approvedIds, priorityPaid: false }) })),
      log,
      at: Date.now(),
    };
    postBus({ type: 'STATE', state });
  };

  useEffect(() => {
    publishRef.current();
  }, [activeChannel, isConnected, paused, approval, textOnly, approvedIds, activeTimeouts, stats, currentMessage, messageQueue, log]);

  // Recompensas interactivas y avisos con video transparente
  const [activeReward, setActiveReward] = useState<RewardTriggerEvent | null>(null);
  const rewardOverlayRef = useRef<HTMLDivElement | null>(null);
  const rewardVideoRef = useRef<HTMLVideoElement | null>(null);

  // Soporte para Metas Comunitarias en OBS
  const isGoalsApp = getURLParam('app') === 'goals' || window.location.hash.includes('app=goals');
  const [goalsSettings, setGoalsSettings] = useState(() => loadGoalsSettings());
  const goalsSettingsRef = useRef(goalsSettings);
  goalsSettingsRef.current = goalsSettings;
  const [currentGoalEvent, setCurrentGoalEvent] = useState<GoalProgressEvent | null>(null);

  // Soporte para Batallas & Encuestas en OBS
  const isPollsApp =
    getURLParam('app') === 'polls' ||
    getURLParam('app') === 'versus' ||
    getURLParam('app') === 'encuestas' ||
    getURLParam('app') === 'batallas' ||
    window.location.hash.includes('app=polls') ||
    window.location.hash.includes('app=versus') ||
    window.location.hash.includes('app=encuestas');
  const [pollSettings, setPollSettings] = useState(() => {
    const base = loadPollSettings();
    const themeParam = getURLParam('theme') || getURLParam('t');
    if (themeParam && ['cabina', 'neon', 'esports', 'cyber', 'minimal'].includes(themeParam.toLowerCase())) {
      return { ...base, theme: themeParam.toLowerCase() as PollStyleTheme };
    }
    return base;
  });
  // Los avisos del bus se atienden con los ajustes vigentes, no con los del arranque
  const pollSettingsRef = useRef(pollSettings);
  pollSettingsRef.current = pollSettings;
  const [activePollState, setActivePollState] = useState<PollBattleUpdateEvent | null>(null);
  const pollsContainerRef = useRef<HTMLDivElement | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollWinnerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollVotersRef = useRef<Map<string, 0 | 1>>(new Map());
  const pollLeaderRef = useRef<'A' | 'B' | 'TIE'>('TIE');

  // Animación física del aviso HUD de moderación en OBS
  useEffect(() => {
    if (!modNotice) return;
    if (modNoticeRef.current) {
      gsap.fromTo(
        modNoticeRef.current,
        { clipPath: reduced() ? 'inset(0 0% 0 0%)' : 'inset(0 50% 0 50%)', opacity: 0 },
        { clipPath: 'inset(0 0% 0 0%)', opacity: 1, duration: 0.4, ease: 'expo.out' }
      );
    }
    const timer = setTimeout(() => {
      if (modNoticeRef.current) {
        gsap.to(modNoticeRef.current, {
          opacity: 0,
          duration: 0.2,
          ease: 'power2.out',
          onComplete: () => setModNotice(null),
        });
      } else {
        setModNotice(null);
      }
    }, 4200);
    return () => clearTimeout(timer);
  }, [modNotice]);

  useEffect(() => {
    if (activeReward && rewardOverlayRef.current) {
      gsap.fromTo(
        rewardOverlayRef.current,
        { opacity: 0, y: reduced() ? 0 : 14 },
        { opacity: 1, y: 0, duration: 0.4, ease: 'expo.out', clearProps: 'transform,opacity' }
      );
    }
  }, [activeReward]);

  useEffect(() => {
    const stop = listenBus((message: BusMessage) => {
      // Las capas de una escena de Studio ven también lo que pasa por el bus (ajustes, pruebas, giros, votos)
      sceneRef.current?.signal({ kind: 'bus', message });
      if (message.type === 'CONTROL') {
        controlRef.current({
          action: message.action,
          id: message.id,
          user: message.user,
          minutes: message.minutes,
          sender: message.sender || 'Panel de Control',
          senderRole: (message.senderRole as UserRole) || 'broadcaster',
        } as LiveControl);
      }
      if (message.type === 'STATE_REQUEST') {
        publishRef.current();
      }
      if (message.type === 'ENQUEUE') {
        enqueueManualMessage(message.text, message.user);
      }
      if (message.type === 'ALERT_TRIGGER') {
        const alert = message.alert;
        const mode = alert.audioMode || (alert.customAudioUrl ? 'custom_audio' : 'synth');
        // En una escena de Studio la alerta sale en su capa; una escena sin capa de alertas no hace nada
        const inScene = sceneInfoRef.current.isScene;
        if (inScene && !sceneInfoRef.current.hasAlert) return;
        if (inScene) sceneRef.current?.alert(alert);
        // Posición aleatoria (fuentes sueltas): el sitio se elige una vez por alerta
        let alertSpot: Spot | null = null;
        if (!inScene && alertsRef.current.randomPosition) {
          const m = alertsRef.current.randomMargin;
          const bounds = { zoneW: 1920, zoneH: 1080, itemW: 640, itemH: 220, margin: (1920 * m) / 100 };
          alertSpot = pickSpot(bounds, lastAlertSpotRef.current);
          lastAlertSpotRef.current = alertSpot;
          if (alertSpotsRef.current.size > 40) alertSpotsRef.current.clear();
          alertSpotsRef.current.set(alert.id, alertSpot);
        }

        // Reproducir audio si el modo incluye sonido sintetizado o clip personalizado
        if (mode === 'synth' || mode === 'custom_audio' || mode === 'both') {
          playAlertOrCustomSound(alert.customAudioUrl, alert.soundType || 'synth-bell', alert.customAudioVolume ?? alertsRef.current.soundVolume);
        }

        // Sacudida de pantalla si está habilitada en la alerta
        if (alert.screenShake && containerRef.current) {
          gsap.fromTo(
            containerRef.current,
            { x: -16, y: 12, rotate: -1 },
            {
              x: 0,
              y: 0,
              rotate: 0,
              duration: 0.7,
              ease: 'elastic.out(1.2, 0.18)',
              clearProps: 'transform',
            }
          );
        }

        // Si la alerta incluye video transparente, proyectarlo en el overlay
        if (alert.videoUrl && !inScene) {
          setActiveReward({
            id: alert.id,
            user: alert.user,
            rewardName: `Alerta de ${alert.eventType.toUpperCase()}`,
            noticeText: alert.text,
            videoUrl: alert.videoUrl,
            blendMode: alert.blendMode || 'transparent',
            position: 'center',
            scale: alert.videoScale || 1.0,
            volume: alert.customAudioVolume ?? alertsRef.current.soundVolume,
            screenShake: alert.screenShake,
            accentColor: alert.accent || '#9146ff',
            soundType: alert.soundType,
            duration: alert.duration || 5,
          });
        }

        // Encolar síntesis de voz (TTS) solo si el modo es 'tts' o 'both'
        if (mode === 'tts' || mode === 'both') {
          const queued = enqueueManualMessage(alert.text, alert.user);
          if (queued && alertSpot) alertSpotsRef.current.set(queued.id, alertSpot);
          // La alerta ya sonó con lo suyo: la voz entra sin el sonido previo
          if (queued && mode === 'both') ownSoundIdsRef.current.add(queued.id);
        }
      }
      if (message.type === 'REWARD_TRIGGER') {
        const reward = message.reward;
        playAlertOrCustomSound(reward.customAudioUrl, reward.soundType || 'arcade-chime', reward.customAudioVolume ?? 0.85);
        // Una escena de Studio con capa «Recompensa» pinta el aviso dentro de su caja (en silencio: ya sonó aquí)
        if (sceneInfoRef.current.hasReward) return;
        if (reward.screenShake && containerRef.current) {
          gsap.fromTo(
            containerRef.current,
            { x: -16, y: 12, rotate: -1 },
            {
              x: 0,
              y: 0,
              rotate: 0,
              duration: 0.7,
              ease: 'elastic.out(1.2, 0.18)',
              clearProps: 'transform',
            }
          );
        }
        setActiveReward(reward);
        const durationSec = reward.duration || 6;
        if (rewardHideTimerRef.current) clearTimeout(rewardHideTimerRef.current);
        rewardHideTimerRef.current = setTimeout(() => {
          if (rewardOverlayRef.current) {
            gsap.to(rewardOverlayRef.current, {
              opacity: 0,
              duration: 0.22,
              ease: 'power2.out',
              onComplete: () => setActiveReward(null),
            });
          } else {
            setActiveReward(null);
          }
        }, durationSec * 1000);
      }
      if (message.type === 'CHAT_SETTINGS_UPDATE') {
        setChatSettings(normalizeChatSettings(message.settings));
      }
      if (message.type === 'RAID_SETTINGS_UPDATE') {
        setRaidSettings(normalizeRaidSettings(message.settings));
      }
      if (message.type === 'PETS_SETTINGS_UPDATE') {
        setPetsSettings(normalizePetsSettings(message.settings));
      }
      if (message.type === 'GAME_SETTINGS_UPDATE') {
        setGameSettings(normalizeGameSettings(message.settings));
      }
      if (message.type === 'PETS_TEST') {
        petsRef.current?.test(SAMPLE_CUES[message.trigger]);
      }
      if (message.type === 'MUSIC_SETTINGS_UPDATE') {
        setMusicSettings(withMusicDesign(normalizeMusicSettings(message.settings), getURLParam));
      }
      if (message.type === 'KOFI_SETTINGS_UPDATE') {
        setKofiSettings(withKofiDesign(normalizeKofiSettings(message.settings), getURLParam, appParamRef.current));
      }
      if (message.type === 'STUDIO_SETTINGS_UPDATE') {
        setStudioSettings(normalizeStudioSettings(message.settings));
      }
      if (message.type === 'ALERT_SETTINGS_UPDATE') {
        setAlertsSettings((prev) => ({ ...prev, ...message.settings }));
      }
      if (message.type === 'GOALS_SETTINGS_UPDATE') {
        setGoalsSettings(message.settings);
      }
      if (message.type === 'GOAL_UPDATE') {
        setCurrentGoalEvent(message.goal);
        setGoalsSettings((prev) => ({
          ...prev,
          goals: prev.goals.map((g) =>
            g.id === message.goal.goalId
              ? { ...g, current: message.goal.current, target: message.goal.target }
              : g
          ),
        }));

        // Locución hablada de avance o de hito en OBS si está habilitado
        if (message.goal.announcement) {
          if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            try {
              const utter = new SpeechSynthesisUtterance(message.goal.announcement);
              utter.lang = 'es-MX';
              utter.volume = goalsSettingsRef.current.announceTtsVolume ?? 0.85;
              window.speechSynthesis.speak(utter);
            } catch (err) {
              console.warn('OBS TTS speech error:', err);
            }
          }
        }
      }
      if (message.type === 'GOAL_CELEBRATE') {
        const cel = message.celebration;
        playAlertOrCustomSound(
          cel.victoryCustomAudioUrl,
          cel.victorySoundType || 'retro-fanfare',
          cel.victoryCustomAudioVolume ?? 0.85
        );
        if (cel.screenShake && containerRef.current) {
          gsap.fromTo(
            containerRef.current,
            { x: -18, y: 14, rotate: -1.2 },
            {
              x: 0,
              y: 0,
              rotate: 0,
              duration: 0.8,
              ease: 'elastic.out(1.2, 0.18)',
              clearProps: 'transform',
            }
          );
        }
        if (cel.victoryVideoUrl) {
          setActiveReward({
            id: `goal-cel-${cel.goalId}-${Date.now()}`,
            user: 'Comunidad',
            rewardName: '¡META ALCANZADA!',
            noticeText: `¡Meta Completada: ${cel.title}!`,
            videoUrl: cel.victoryVideoUrl,
            blendMode: cel.victoryBlendMode || 'transparent',
            position: 'center',
            scale: 1.2,
            volume: cel.victoryCustomAudioVolume ?? 0.85,
            screenShake: cel.screenShake,
            accentColor: '#ffd700',
            soundType: cel.victorySoundType,
            duration: cel.duration || 6,
          });
          setTimeout(() => {
            setActiveReward(null);
          }, (cel.duration || 6) * 1000);
        }
      }
      // Una escena de Studio con capa «Batalla» la lleva esa capa: aquí no cuenta, no suena y no habla.
      // Sin esa capa, la escena sigue mostrando la batalla con la barra de siempre
      if (sceneInfoRef.current.hasPoll && message.type.startsWith('POLL_')) return;
      if (message.type === 'POLL_SETTINGS_UPDATE') {
        setPollSettings(message.settings);
      }
      if (message.type === 'POLL_START') {
        const poll = message.poll;
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        if (pollWinnerTimerRef.current) clearTimeout(pollWinnerTimerRef.current);
        pollVotersRef.current.clear();
        pollLeaderRef.current = 'TIE';

        // 1. Notificación en pantalla y aviso HUD
        setModNotice({
          action: 'poll_start',
          sender: poll.startedBy,
          user: poll.title,
          timestamp: Date.now(),
        });

        // 2. Chime y Locución TTS con la voz oficial del sistema y modulación emocional
        announceModPollStarted({
          modName: poll.startedBy,
          modRole: poll.startedByRole,
          title: poll.title,
          optionALabel: poll.optionA.label,
          optionBLabel: poll.optionB.label,
          durationSec: poll.durationSec,
          volume: settingsRef.current.volume,
        });

        // 3. Estado inicial de la batalla
        const initialPollState: PollBattleUpdateEvent = {
          title: poll.title,
          optionA: {
            id: 'opt-a',
            label: poll.optionA.label,
            sublabel: poll.optionA.sublabel || '!voto 1 o 1',
            color: poll.optionA.color || '#00e5ff',
            accentGlow: 'rgba(0, 229, 255, 0.45)',
            votes: 0,
          },
          optionB: {
            id: 'opt-b',
            label: poll.optionB.label,
            sublabel: poll.optionB.sublabel || '!voto 2 o 2',
            color: poll.optionB.color || '#ff0055',
            accentGlow: 'rgba(255, 0, 85, 0.45)',
            votes: 0,
          },
          timeLeftSec: poll.durationSec,
          totalDurationSec: poll.durationSec,
          isActive: true,
          winner: null,
          leader: 'TIE',
        };
        setActivePollState(initialPollState);

        // 4. Temporizador de cuenta regresiva en OBS
        let remainingSeconds = poll.durationSec;
        pollTimerRef.current = setInterval(() => {
          remainingSeconds -= 1;
          if (remainingSeconds <= 0) {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
            setActivePollState((prev) => {
              if (!prev) return null;
              const finalWinner = determineLeader(prev.optionA.votes, prev.optionB.votes);
              const totalVotes = prev.optionA.votes + prev.optionB.votes;
              const winVotes = finalWinner === 'A' ? prev.optionA.votes : prev.optionB.votes;
              const winPct = totalVotes > 0 ? Math.round((winVotes / totalVotes) * 100) : 50;
              const winLabel =
                finalWinner === 'A'
                  ? prev.optionA.label
                  : finalWinner === 'B'
                  ? prev.optionB.label
                  : 'Empate';

              // Fanfarria de victoria
              if (pollSettingsRef.current.audioEffectsEnabled) {
                playPollVictoryFanfare(pollSettingsRef.current.audioVolume);
              }

              // Locución TTS con la voz oficial de Fish Audio
              const winnerText =
                finalWinner === 'TIE'
                  ? '[tenso] ¡Tiempo finalizado! La votación ha terminado en un empate absoluto entre ambas opciones.'
                  : `[triunfal] ¡Tiempo finalizado! La opción ganadora indiscutible es ${winLabel} con ${winPct} por ciento de los votos.`;
              speakPollEmotionCue(winnerText, finalWinner === 'TIE' ? '[tenso]' : '[triunfal]');

              // Mantener el banner de victoria 10 segundos antes de ocultar con animación fluida
              pollWinnerTimerRef.current = setTimeout(() => {
                if (pollsContainerRef.current) {
                  gsap.to(pollsContainerRef.current, {
                    opacity: 0,
                    y: 16,
                    duration: 0.24,
                    ease: 'power2.out',
                    onComplete: () => {
                    setActivePollState(null);
                    gsap.set(pollsContainerRef.current, { clearProps: 'all' });
                  },
                  });
                } else {
                  setActivePollState(null);
                }
              }, 10000);

              const finished: PollBattleUpdateEvent = {
                ...prev,
                timeLeftSec: 0,
                isActive: false,
                winner: finalWinner,
              };
              postBus({ type: 'POLL_STATE_UPDATE', state: finished });
              return finished;
            });
            return;
          }

          // Alerta a los 10 segundos finales
          if (remainingSeconds === 10) {
            if (pollSettingsRef.current.audioEffectsEnabled) {
              playCountdownBeep(pollSettingsRef.current.audioVolume, true);
            }
            speakPollEmotionCue('[susurro] Quedan solo 10 segundos, ¡emitan sus votos en el chat!', '[susurro]');
          } else if (remainingSeconds <= 5 && remainingSeconds > 0) {
            if (pollSettingsRef.current.audioEffectsEnabled) {
              playCountdownBeep(pollSettingsRef.current.audioVolume, true);
            }
          }

          setActivePollState((prev) => {
            if (!prev || !prev.isActive) return prev;
            const updated = { ...prev, timeLeftSec: remainingSeconds };
            postBus({ type: 'POLL_STATE_UPDATE', state: updated });
            return updated;
          });
        }, 1000);
      }
      if (message.type === 'POLL_STOP') {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        if (pollWinnerTimerRef.current) clearTimeout(pollWinnerTimerRef.current);
        const modName = message.user || 'Moderación';
        setModNotice({
          action: 'poll_stop',
          sender: modName,
          timestamp: Date.now(),
        });
        announceModPollStopped(modName);

        if (pollsContainerRef.current) {
          gsap.to(pollsContainerRef.current, {
            opacity: 0,
            y: 16,
            duration: 0.24,
            ease: 'power2.out',
            onComplete: () => {
                    setActivePollState(null);
                    gsap.set(pollsContainerRef.current, { clearProps: 'all' });
                  },
          });
        } else {
          setActivePollState(null);
        }
      }
      if (message.type === 'POLL_VOTE') {
        const voter = (message.user || 'Anónimo').toLowerCase().trim();
        setActivePollState((prev) => {
          if (!prev || !prev.isActive) return prev;

          const existingVote = pollVotersRef.current.get(voter);
          if (existingVote !== undefined) {
            if (!pollSettingsRef.current.allowVoteChange) return prev;
            if (existingVote === message.option) return prev;
          }

          let votesA = prev.optionA.votes;
          let votesB = prev.optionB.votes;

          if (existingVote === 0) votesA = Math.max(0, votesA - 1);
          if (existingVote === 1) votesB = Math.max(0, votesB - 1);

          if (message.option === 0) votesA += 1;
          if (message.option === 1) votesB += 1;

          pollVotersRef.current.set(voter, message.option);

          const newLeader = determineLeader(votesA, votesB);
          if (newLeader !== 'TIE' && newLeader !== pollLeaderRef.current) {
            pollLeaderRef.current = newLeader;
            if (pollSettingsRef.current.audioEffectsEnabled) {
              playLeadClash(pollSettingsRef.current.audioVolume);
            }
          }

          if (pollSettingsRef.current.audioEffectsEnabled) {
            playVoteTick(pollSettingsRef.current.audioVolume, message.option);
          }

          const nextState: PollBattleUpdateEvent = {
            ...prev,
            optionA: { ...prev.optionA, votes: votesA },
            optionB: { ...prev.optionB, votes: votesB },
            leader: newLeader,
            lastVoteUser: message.user,
            lastVoteOption: message.option,
          };
          postBus({ type: 'POLL_STATE_UPDATE', state: nextState });
          return nextState;
        });
      }
      if (message.type === 'POLL_STATE_UPDATE') {
        setActivePollState(message.state);
        if (message.state.lastVoteOption !== undefined && pollSettingsRef.current.audioEffectsEnabled) {
          playVoteTick(pollSettingsRef.current.audioVolume, message.state.lastVoteOption);
        }
      }
      if (message.type === 'POLL_TTS_CUE') {
        speakPollEmotionCue(message.cue.text, message.cue.emotion);
      }
      if (message.type === 'POLL_CLEAR') {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        if (pollWinnerTimerRef.current) clearTimeout(pollWinnerTimerRef.current);
        setActivePollState(null);
      }
    });
    const heartbeat = setInterval(() => publishRef.current(), 5000);
    return () => {
      stop();
      clearInterval(heartbeat);
    };
  }, [enqueueManualMessage]);

  // Al bloquear a alguien desde el panel, sus mensajes en espera salen de la cola
  useEffect(() => {
    const blocked = messageQueue.find((m) => m.trigger !== 'test' && moderation.blockedUsers.includes(m.username.toLowerCase()));
    if (blocked) removeMessageFromQueue(blocked.id);
  }, [moderation.blockedUsers, messageQueue, removeMessageFromQueue]);

  // Bucle FIFO estricto: Observa la cola y desencadena la siguiente tarjeta cuando isPlaying es falso.
  // En pausa, el mensaje que suena termina y la cola espera.
  useEffect(() => {
    // La fuente que solo muestra el chat no habla: la voz sale por «Voz del chat» o «Todo en uno»
    if (isChatOnly) {
      if (messageQueue.length > 0) clearQueue();
      return;
    }
    // La fuente que solo muestra las recompensas tampoco lee el chat
    if (isRewardsOnly || isQuietIntegration) {
      if (messageQueue.length > 0) clearQueue();
      return;
    }
    // Una escena de Studio no lee el chat: solo dice la bienvenida de una raid y las alertas de su capa
    if (isScene) {
      const foreign = messageQueue.find((m) => !m.system && m.trigger !== 'test');
      if (foreign) {
        removeMessageFromQueue(foreign.id);
        return;
      }
    }
    // Las fuentes del saludo de raid y de la ruleta solo dicen lo suyo: el chat lo lee otra fuente
    if (isRaidOnly || isRouletteApp || isKofiAlerts || isPetsOnly || isGameOnly) {
      const foreign = messageQueue.find((m) => !m.system);
      if (foreign) {
        removeMessageFromQueue(foreign.id);
        return;
      }
    }
    if (!paused && !isPlaying && !isProcessingRef.current && messageQueue.length > 0) {
      // El siguiente es el primero ya aprobado; con prioridad, antes los canjes y los bits
      const nextMessage = pickNext(messageQueue, { approval, approvedIds, priorityPaid: settings.priorityPaid });
      if (nextMessage) {
        removeMessageFromQueue(nextMessage.id);
        playAudioForMessage(nextMessage);
      }
    }
  }, [paused, isPlaying, messageQueue, removeMessageFromQueue, playAudioForMessage, approval, approvedIds, settings.priorityPaid, isChatOnly, isRaidOnly, isRouletteApp, isRewardsOnly, isScene, clearQueue, isQuietIntegration, isKofiAlerts, isPetsOnly, isGameOnly]);

  // Limpieza al desmontar
  useEffect(() => {
    return () => {
      isProcessingRef.current = false;
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (pollWinnerTimerRef.current) clearTimeout(pollWinnerTimerRef.current);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
      }
      stopSpeakingAnimation();
      entryTimelineRef.current?.kill();
      if (cardRef.current) {
        gsap.killTweensOf(cardRef.current);
      }
    };
  }, [stopSpeakingAnimation]);

  // Lo que necesita una escena de Studio para pintar las capas de Lalo
  const sceneGoalId = currentGoalEvent?.goalId;
  const sceneData = useMemo<SceneData>(
    () => ({ chat: chatSettings, raid: raidSettings, goals: goalsSettings, alerts: alertsSettings, goalEventId: sceneGoalId }),
    [chatSettings, raidSettings, goalsSettings, alertsSettings, sceneGoalId]
  );

  return (
    <div
      ref={containerRef}
      className={`fixed inset-0 pointer-events-none flex p-8 overflow-hidden select-none ${POSITION_CLASS[settings.position]}`}
    >
      {/* Botón flotante para desbloquear audio en navegadores si fuera bloqueado */}
      {autoplayBlocked && (
        <div className="absolute top-4 left-4 pointer-events-auto z-50">
          <button
            onClick={() => {
              setAutoplayBlocked(false);
              if (audioRef.current) audioRef.current.play().catch(() => {});
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs shadow-lg"
          >
            <VolumeX className="w-4 h-4" />
            <span>Haz clic para activar el audio</span>
          </button>
        </div>
      )}

      {/* Estado de Twitch y cola. En OBS solo aparece si se pierde la conexión: no es contenido para la emisión */}
      {(!IN_OBS || !isConnected) && (
        <div className={`absolute right-4 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/70 border border-white/10 text-xs text-zinc-300 ${settings.position[0] === 't' ? 'bottom-4' : 'top-4'}`}>
          <Radio className={`w-3.5 h-3.5 ${isConnected ? 'text-emerald-400' : 'text-zinc-600'}`} />
          <span className="font-mono">#{activeChannel}</span>
          {!isConnected && <span className="font-semibold text-amber-300">Sin conexión</span>}
          {paused && <span className="font-semibold text-amber-300">En pausa</span>}
          {approval && <span className="font-semibold text-amber-300">Manual</span>}
          {messageQueue.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-purple-600 text-[10px] text-white font-mono font-bold">
              {messageQueue.length}
            </span>
          )}
        </div>
      )}

      {/* Tarjeta de TTS para OBS en el estilo elegido desde el panel */}
      {currentMessage && !currentMessage.system && !isScene && (
        <AlertSpot spot={alertSpotsRef.current.get(currentMessage.id)} margin={alertsSettings.randomMargin} scale={settings.scale}>
        <AlertCard
          key={currentMessage.id}
          ref={cardRef}
          alertStyle={settings.alertStyle}
          position={settings.position}
          accent={settings.accent}
          name={currentMessage.displayName}
          text={currentMessage.cleanText}
          emotionLabel={currentMessage.emotion?.label}
          emotionTag={currentMessage.emotion?.tag}
          userColor={currentMessage.userColor}
          stickerSvg={settings.stickerSvg}
          loading={isAudioLoading}
          fontSize={`calc(clamp(13px, 1.05vw, 22px) * ${settings.scale})`}
        />
        </AlertSpot>
      )}

      {/* Chat en vivo */}
      {showChat && <ChatOverlayView ref={chatRef} settings={chatSettings} />}

      {/* Saludo de raid con corto */}
      {showRaid && (
        <RaidLayer ref={raidRef} settings={raidSettings} demo={getURLParam('demo') === '1'} onSpeak={speakRaidWelcome} />
      )}

      {/* Mascota: reacciona con voz a canjes, bits, Power-ups, llamadas en el chat y raids */}
      {showPets && (
        <PetLayer
          ref={petsRef}
          settings={petsSettings}
          demo={getURLParam('demo') === '1' && appParam !== 'all'}
          speak={speakPet}
          queueLength={messageQueue.length}
          blockedWords={moderation.blockedWords}
          blockedUsers={moderation.blockedUsers}
          ignoredBots={moderation.ignoredBots}
        />
      )}

      {/* Alertas de juego: la placa «Grieta» con lo que pasa en la cuenta de Riot del streamer */}
      {showGame && <GameWidgetLayer settings={gameSettings} demo={getURLParam('demo') === '1' && appParam !== 'all'} onAnnounce={announceGame} />}

      {/* Recompensas: sonidos, placas y vídeos por puntos de canal o bits */}
      {showRewards && <RewardsWidgetLayer ref={rewardsRef} />}

      {/* Canal de eventos de Twitch: Power-ups, Bits para las metas y canjes de puntos sin texto */}
      <TwitchEventLayer
        app={appParam}
        speak={enqueueManualMessage}
        blockedWords={moderation.blockedWords}
        blockedUsers={moderation.blockedUsers}
        onEvent={handleTwitchEvent}
        onKofi={handleKofiEvent}
        fast={showKofi}
      />

      {/* «Ahora suena»: la canción que escucha el streamer */}
      {showMusic && <MusicWidgetLayer ref={musicRef} settings={musicSettings} demo={getURLParam('demo') === '1' && appParam !== 'all'} />}

      {/* Ko-fi: alertas, meta y últimos apoyos */}
      {showKofi && (
        <KofiWidgetLayer
          ref={kofiRef}
          settings={kofiSettings}
          parts={kofiParts}
          demo={getURLParam('demo') === '1' && appParam !== 'all'}
          blockedWords={moderation.blockedWords}
          speak={speakKofi}
        />
      )}

      {/* Escena de Studio: las capas colocadas en el lienzo de 1920 × 1080 */}
      {isScene && scene && (
        <div className="es-screen">
          <div className="es-frame">
            <SceneView
              ref={sceneRef}
              scene={scene}
              mode="live"
              data={sceneData}
              demo={getURLParam('demo') === '1'}
              onSpeak={speakRaidWelcome}
              services={sceneServices}
            />
          </div>
        </div>
      )}

      {/* Overlay de Metas Comunitarias & Marcadores (Compresión ≤4 en fila y Carrusel 5+ con GSAP) */}
      {isGoalsApp && (
        <div className="pointer-events-none fixed inset-x-0 top-6 z-30 flex justify-center px-4">
          <GoalsOverlayView
            goals={goalsSettings.goals}
            activeGoalId={goalsSettings.activeGoalId}
            displayMode={goalsSettings.displayMode}
            slideshowIntervalSec={goalsSettings.slideshowIntervalSec}
            position={goalsSettings.position}
            recentProgressGoalId={currentGoalEvent?.goalId}
          />
        </div>
      )}

      {/* Ruleta: se ve mientras está abierta o gira; la giran los puntos del canal o los bits */}
      {showRoulette && <RouletteLayer ref={rouletteRef} speak={speakRoulette} demo={getURLParam('demo') === '1'} />}

      {/* Overlay de Batallas & Encuestas en OBS */}
      {!sceneHas('poll') && (isPollsApp || (activePollState && (activePollState.isActive || Boolean(activePollState.winner)))) && (
        <div
          ref={pollsContainerRef}
          className="pointer-events-none fixed inset-x-0 bottom-8 z-40 flex items-center justify-center p-6"
        >
          <div className="w-full pointer-events-auto">
            <BattleBarView
              title={activePollState?.title || pollSettings.activeBattleTitle}
              optionA={activePollState?.optionA || pollSettings.options[0]}
              optionB={activePollState?.optionB || pollSettings.options[1]}
              theme={pollSettings.theme}
              timeLeftSec={activePollState?.timeLeftSec ?? pollSettings.durationSec}
              totalDurationSec={activePollState?.totalDurationSec ?? pollSettings.durationSec}
              isActive={activePollState?.isActive ?? false}
              winner={activePollState?.winner}
            />
          </div>
        </div>
      )}

      {/* Aviso de acciones de moderación, en la misma placa que el resto de capas */}
      {modNotice && (
        <div className="ovl pointer-events-none fixed inset-x-0 top-6 z-50 flex justify-center px-4">
          <div
            ref={modNoticeRef}
            className="ovl-plate nt"
            style={{ '--c': '#ffb020', '--c-ink': '#1b1c1f' } as React.CSSProperties}
          >
            <span className="nt-tag ovl-caps">Moderación</span>
            <span className="nt-text">
              {modNotice.action in ACTION_DESCRIPTIONS
                ? ACTION_DESCRIPTIONS[modNotice.action as ControlAction](modNotice.sender, modNotice.user)
                : modNotice.action === 'command'
                  ? `${modNotice.sender} usó ${modNotice.user || 'un comando'}`
                  : `${modNotice.action} por ${modNotice.sender}`}
            </span>
          </div>
        </div>
      )}

      {/* Capa de Recompensa / Video Transparente y Aviso Personalizado */}
      {activeReward && (
        <div
          ref={rewardOverlayRef}
          className={`pointer-events-none fixed inset-0 z-40 flex p-8 ${
            activeReward.position === 'fullscreen'
              ? 'items-center justify-center'
              : activeReward.position === 'bottom-right'
              ? 'items-end justify-end'
              : activeReward.position === 'bottom-left'
              ? 'items-end justify-start'
              : activeReward.position === 'top-right'
              ? 'items-start justify-end'
              : activeReward.position === 'top-left'
              ? 'items-start justify-start'
              : 'items-center justify-center'
          }`}
        >
          <div
            className={`ovl relative flex flex-col items-center gap-3 ${
              activeReward.position === 'fullscreen' ? 'h-full w-full justify-center' : 'max-w-xl'
            }`}
            style={rewardSpotStyle(alertSpotsRef.current.get(activeReward.id), alertsSettings.randomMargin, activeReward.scale || 1) || {
              transform: `scale(${activeReward.scale || 1})`,
              transformOrigin: activeReward.position === 'bottom-right' ? 'bottom right' : 'center',
            }}
          >
            {/* Reproductor de Video Transparente */}
            {activeReward.videoUrl ? (
              <video
                ref={(element) => {
                  rewardVideoRef.current = element;
                  // El volumen del vídeo es el de la alerta o la recompensa, no el máximo
                  if (element) element.volume = Math.min(1, Math.max(0, activeReward.volume ?? 0.85));
                }}
                src={activeReward.videoUrl}
                autoPlay
                playsInline
                muted={false}
                className={`rounded-lg object-contain ${
                  activeReward.position === 'fullscreen' ? 'max-h-[85vh] w-auto' : 'max-h-80 w-auto'
                }`}
                style={{
                  mixBlendMode: activeReward.blendMode === 'screen' ? 'screen' : 'normal',
                }}
              />
            ) : null}

            {/* Aviso de la recompensa. Sin vídeo, el aviso es la recompensa: va en grande */}
            {(activeReward.noticeText || !activeReward.videoUrl) && (
              <div
                className="ovl-plate nt"
                data-big={activeReward.videoUrl ? undefined : ''}
                style={
                  {
                    '--c': activeReward.accentColor || '#9146ff',
                    '--c-ink': inkFor(activeReward.accentColor || '#9146ff'),
                  } as React.CSSProperties
                }
              >
                <span className="nt-tag ovl-caps">{activeReward.rewardName}</span>
                <span className="nt-text">{activeReward.noticeText || `Canjeado por ${activeReward.user}`}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
