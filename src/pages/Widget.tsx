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
import { loadSettings, TTSSettings } from '../types/settings';
import { AlertPosition, appearanceFromParams, normalizeAppearance } from '../utils/appearance';
import {
  ControlAction,
  ControlCommand,
  DEFAULT_TIMEOUT_MINUTES,
  moderationFromParams,
  needsApproval,
  normalizeModeration,
  normalizeUser,
  pickNext,
  UserRole,
} from '../utils/moderation';
import { BusMessage, LiveItem, LogItem, SessionStats, WidgetState, listenBus, postBus, RewardTriggerEvent, GoalProgressEvent, RouletteSpinEvent } from '../utils/bus';
import { MotionOptions, playEnter, playExit, startSpeaking, stopSpeaking } from '../utils/alertMotion';
import { AlertCard } from '../components/AlertCard';
import { playAlertOrCustomSound } from '../utils/alertsAudio';
import { playModerationChime, announceModerationAction, ACTION_DESCRIPTIONS } from '../utils/moderationAudio';
import { Coins, Radio, VolumeX, Shield } from 'lucide-react';
import { loadGoalsSettings } from '../types/goals';
import { GoalsOverlayView } from '../components/goals/GoalsOverlayView';
import { loadRouletteSettings, RouletteSegment } from '../types/roulette';
import { RouletteWheel } from '../components/roulette/RouletteWheel';
import { WinnerBanner } from '../components/roulette/WinnerBanner';
import { loadPollSettings } from '../types/polls';
import { BattleBarView } from '../components/polls/BattleBarView';
import { PollBattleUpdateEvent } from '../utils/bus';
import { speakPollEmotionCue, playVoteTick } from '../utils/pollsAudio';

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
 * Ajustes que llegan en la URL del widget. El navegador de OBS no comparte
 * localStorage con el panel, así que la URL manda sobre lo guardado.
 */
function urlOverrides(): Partial<TTSSettings> {
  const overrides: Partial<TTSSettings> = { ...appearanceFromParams(getURLParam), ...moderationFromParams(getURLParam) };
  const volume = parseFloat(getURLParam('vol') || '');
  if (Number.isFinite(volume)) overrides.volume = Math.min(1, Math.max(0, volume));
  const speed = parseFloat(getURLParam('speed') || '');
  if (Number.isFinite(speed)) overrides.speed = Math.min(1.5, Math.max(0.75, speed));
  return overrides;
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

const LALOPLAY_DEFAULT_VOICE = '37f9f4eec7624089a49b188d47588f2c';
const OLD_PRESET_VOICE = '7f92f8afb8ec43bf81429cc1c9199cb1';

export const Widget: React.FC = () => {
  const [settings, setSettings] = useState(() => {
    const base = loadSettings();
    const channelParam = getURLParam('channel') || getURLParam('c');
    const voiceParam = getURLParam('voice') || getURLParam('reference_id') || getURLParam('v');
    const modelParam = getURLParam('model') || getURLParam('m');
    const announceParam = getURLParam('announce') || getURLParam('a');

    const rawModel = (modelParam || base.model || 's2.1-pro-free').trim().replace(/[.,;/\\]+$/, '');
    const cleanModel = rawModel.toLowerCase().includes('free') ? 's2.1-pro-free' : (rawModel || 's2.1-pro-free');

    // Resolver voz: si no se especificó o es la antigua voz de muestra, asignar la voz clonada oficial
    const rawVoice = (voiceParam || base.referenceId || LALOPLAY_DEFAULT_VOICE).trim().replace(/[.,;/\\]+$/, '');
    const cleanVoice = (!rawVoice || rawVoice === OLD_PRESET_VOICE || rawVoice === 'default' || rawVoice === 'undefined')
      ? LALOPLAY_DEFAULT_VOICE
      : rawVoice;

    return {
      ...base,
      channel: channelParam || base.channel || 'laloplay_',
      referenceId: cleanVoice,
      model: cleanModel,
      announceSender: announceParam !== null ? announceParam === 'true' || announceParam === '1' : base.announceSender,
      ...urlOverrides(),
    };
  });

  const activeChannel = settings.channel || 'laloplay_';

  // Sincronizar cambios en localStorage
  useEffect(() => {
    const handleStorage = () => {
      const updated = loadSettings();
      const voiceParam = getURLParam('voice') || getURLParam('reference_id') || getURLParam('v');
      const rawVoice = (voiceParam || updated.referenceId || LALOPLAY_DEFAULT_VOICE).trim().replace(/[.,;/\\]+$/, '');
      const cleanVoice = (!rawVoice || rawVoice === OLD_PRESET_VOICE || rawVoice === 'default' || rawVoice === 'undefined')
        ? LALOPLAY_DEFAULT_VOICE
        : rawVoice;

      const modelParam = getURLParam('model') || getURLParam('m');
      const rawModel = (modelParam || updated.model || 's2.1-pro-free').trim().replace(/[.,;/\\]+$/, '');
      const cleanModel = rawModel.toLowerCase().includes('free') ? 's2.1-pro-free' : (rawModel || 's2.1-pro-free');

      setSettings((prev) => ({
        ...prev,
        ...updated,
        channel: getURLParam('channel') || getURLParam('c') || updated.channel,
        referenceId: cleanVoice,
        model: cleanModel,
        ...urlOverrides(),
      }));
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
  });

  const [currentMessage, setCurrentMessage] = useState<SanitizedTTSMessage | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isAudioLoading, setIsAudioLoading] = useState<boolean>(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState<boolean>(false);

  // Notificación de acciones de moderadores en pantalla
  const [modNotice, setModNotice] = useState<{
    action: ControlAction | 'remove';
    sender: string;
    user?: string;
    timestamp: number;
  } | null>(null);
  const modNoticeRef = useRef<HTMLDivElement | null>(null);

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
          setSettings((prev) => {
            const merged = { ...prev, ...event.data.settings };
            return { ...merged, ...normalizeAppearance(merged), ...normalizeModeration(merged) };
          });
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
          // Nueva versión detectada en Vercel mientras el stream sigue abierto
          if (!isProcessingRef.current && !isPlaying && messageQueue.length === 0) {
            const lastReload = Number(sessionStorage.getItem('last_auto_update_ts') || '0');
            if (Date.now() - lastReload > 30000) {
              sessionStorage.setItem('last_auto_update_ts', Date.now().toString());
              console.log('[OBS Widget] Nueva versión detectada en Vercel. Recargando overlay en estado inactivo...');
              window.location.reload();
            }
          }
        }
      } catch {
        // Ignorar fallos temporales de conexión
      } finally {
        isChecking = false;
      }
    };

    const initialTimer = setTimeout(checkDeployment, 2000);
    const intervalTimer = setInterval(checkDeployment, 15000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
    };
  }, [isPlaying, messageQueue.length]);

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
        if (skipped) {
          // Saltado por el streamer: cortar la voz ya
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
        watchdogTimer = setTimeout(() => finalizePlayback(), seconds * 1000);
        return;
      }

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

        if (settings.announceSender !== false) {
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
            reference_id: settings.referenceId || undefined,
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
            const fallbackText = settings.announceSender !== false
              ? `${cleanUserName} dice: ${speechText}`
              : speechText;

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
  const [currentGoalEvent, setCurrentGoalEvent] = useState<GoalProgressEvent | null>(null);

  // Soporte para Ruleta de Castigos & Retos en OBS
  const isRouletteApp =
    getURLParam('app') === 'roulette' ||
    getURLParam('app') === 'ruleta' ||
    getURLParam('app') === 'wheel' ||
    window.location.hash.includes('app=roulette') ||
    window.location.hash.includes('app=ruleta');
  const [rouletteSettings, setRouletteSettings] = useState(() => loadRouletteSettings());
  const [activeRouletteSpin, setActiveRouletteSpin] = useState<RouletteSpinEvent | null>(null);
  const [rouletteStartRotation, setRouletteStartRotation] = useState(0);
  const [rouletteRotation, setRouletteRotation] = useState(0);
  const [isRouletteSpinning, setIsRouletteSpinning] = useState(false);
  const [rouletteWinnerBanner, setRouletteWinnerBanner] = useState<{
    segment: RouletteSegment;
    user: string;
  } | null>(null);
  const rouletteContainerRef = useRef<HTMLDivElement | null>(null);

  // Soporte para Batallas & Encuestas en OBS
  const isPollsApp =
    getURLParam('app') === 'polls' ||
    getURLParam('app') === 'versus' ||
    getURLParam('app') === 'encuestas' ||
    getURLParam('app') === 'batallas' ||
    window.location.hash.includes('app=polls') ||
    window.location.hash.includes('app=versus') ||
    window.location.hash.includes('app=encuestas');
  const [pollSettings, setPollSettings] = useState(() => loadPollSettings());
  const [activePollState, setActivePollState] = useState<PollBattleUpdateEvent | null>(null);
  const pollsContainerRef = useRef<HTMLDivElement | null>(null);

  // Animación física del aviso HUD de moderación en OBS
  useEffect(() => {
    if (!modNotice) return;
    if (modNoticeRef.current) {
      gsap.fromTo(
        modNoticeRef.current,
        { y: -30, opacity: 0, scale: 0.95 },
        { y: 0, opacity: 1, scale: 1, duration: 0.35, ease: 'back.out(1.5)' }
      );
    }
    const timer = setTimeout(() => {
      if (modNoticeRef.current) {
        gsap.to(modNoticeRef.current, {
          y: -15,
          opacity: 0,
          scale: 0.95,
          duration: 0.3,
          ease: 'power2.in',
          onComplete: () => setModNotice(null),
        });
      } else {
        setModNotice(null);
      }
    }, 4200);
    return () => clearTimeout(timer);
  }, [modNotice]);

  const handleObsWheelComplete = useCallback((winner: RouletteSegment) => {
    setIsRouletteSpinning(false);
    setActiveRouletteSpin((prev) => {
      if (prev) {
        const finalWinner = prev.winnerSegment || winner;
        setRouletteWinnerBanner({
          segment: finalWinner,
          user: prev.user || 'Streamer',
        });

        playAlertOrCustomSound(
          prev.victoryCustomAudioUrl,
          prev.victorySoundType || 'arcade-chime',
          prev.victoryCustomAudioVolume ?? 0.85
        );

        const bannerDuration = prev.winnerBannerDurationSec || 8;
        setTimeout(() => {
          if (rouletteContainerRef.current) {
            gsap.to(rouletteContainerRef.current, {
              opacity: 0,
              scale: 0.95,
              y: -20,
              duration: 0.45,
              ease: 'power2.in',
              onComplete: () => {
                setActiveRouletteSpin(null);
                setRouletteWinnerBanner(null);
              },
            });
          } else {
            setActiveRouletteSpin(null);
            setRouletteWinnerBanner(null);
          }
        }, bannerDuration * 1000);
      }
      return prev;
    });
  }, []);

  useEffect(() => {
    if (activeReward && rewardOverlayRef.current) {
      gsap.fromTo(
        rewardOverlayRef.current,
        { opacity: 0, scale: 0.93, y: 15 },
        { opacity: 1, scale: 1, y: 0, duration: 0.38, ease: 'back.out(1.5)', clearProps: 'transform,opacity' }
      );
    }
  }, [activeReward]);

  useEffect(() => {
    const stop = listenBus((message: BusMessage) => {
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

        // Reproducir audio si el modo incluye sonido sintetizado o clip personalizado
        if (mode === 'synth' || mode === 'custom_audio' || mode === 'both') {
          playAlertOrCustomSound(alert.customAudioUrl, alert.soundType || 'synth-bell', alert.customAudioVolume ?? 0.85);
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
        if (alert.videoUrl) {
          setActiveReward({
            id: alert.id,
            user: alert.user,
            rewardName: `Alerta de ${alert.eventType.toUpperCase()}`,
            noticeText: alert.text,
            videoUrl: alert.videoUrl,
            blendMode: alert.blendMode || 'transparent',
            position: 'center',
            scale: alert.videoScale || 1.0,
            volume: 0.85,
            screenShake: alert.screenShake,
            accentColor: alert.accent || '#9146ff',
            soundType: alert.soundType,
            duration: alert.duration || 5,
          });
        }

        // Encolar síntesis de voz (TTS) solo si el modo es 'tts' o 'both'
        if (mode === 'tts' || mode === 'both') {
          enqueueManualMessage(alert.text, alert.user);
        }
      }
      if (message.type === 'REWARD_TRIGGER') {
        const reward = message.reward;
        playAlertOrCustomSound(reward.customAudioUrl, reward.soundType || 'arcade-chime', reward.customAudioVolume ?? 0.85);
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
        setTimeout(() => {
          if (rewardOverlayRef.current) {
            gsap.to(rewardOverlayRef.current, {
              opacity: 0,
              scale: 0.95,
              duration: 0.4,
              ease: 'power2.in',
              onComplete: () => setActiveReward(null),
            });
          } else {
            setActiveReward(null);
          }
        }, durationSec * 1000);
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
              utter.volume = goalsSettings.announceTtsVolume ?? 0.85;
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
      if (message.type === 'ROULETTE_SETTINGS_UPDATE') {
        setRouletteSettings(message.settings);
      }
      if (message.type === 'ROULETTE_SPIN') {
        const spin = message.spin;
        setActiveRouletteSpin(spin);
        setRouletteStartRotation(spin.startRotation ?? 0);
        setRouletteRotation(spin.finalRotation);
        setIsRouletteSpinning(true);
        setRouletteWinnerBanner(null);

        if (spin.screenShake && containerRef.current) {
          gsap.fromTo(
            containerRef.current,
            { x: -16, y: 12, rotate: -1.2 },
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
      }
      if (message.type === 'ROULETTE_CLEAR') {
        setActiveRouletteSpin(null);
        setRouletteWinnerBanner(null);
        setIsRouletteSpinning(false);
      }
      if (message.type === 'POLL_SETTINGS_UPDATE') {
        setPollSettings(message.settings);
      }
      if (message.type === 'POLL_STATE_UPDATE') {
        setActivePollState(message.state);
        if (message.state.lastVoteOption !== undefined && pollSettings.audioEffectsEnabled) {
          playVoteTick(pollSettings.audioVolume, message.state.lastVoteOption);
        }
      }
      if (message.type === 'POLL_TTS_CUE') {
        speakPollEmotionCue(message.cue.text, message.cue.emotion);
      }
      if (message.type === 'POLL_CLEAR') {
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
    if (!paused && !isPlaying && !isProcessingRef.current && messageQueue.length > 0) {
      // El siguiente es el primero ya aprobado; con prioridad, antes los canjes y los bits
      const nextMessage = pickNext(messageQueue, { approval, approvedIds, priorityPaid: settings.priorityPaid });
      if (nextMessage) {
        removeMessageFromQueue(nextMessage.id);
        playAudioForMessage(nextMessage);
      }
    }
  }, [paused, isPlaying, messageQueue, removeMessageFromQueue, playAudioForMessage, approval, approvedIds, settings.priorityPaid]);

  // Limpieza al desmontar
  useEffect(() => {
    return () => {
      isProcessingRef.current = false;
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
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs shadow-lg animate-bounce"
          >
            <VolumeX className="w-4 h-4" />
            <span>Haz clic para activar el audio</span>
          </button>
        </div>
      )}

      {/* Indicador de estado de Twitch y contador de cola */}
      <div className={`absolute right-4 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/50 backdrop-blur-md border border-white/10 text-xs text-zinc-300 ${settings.position[0] === 't' ? 'bottom-4' : 'top-4'}`}>
        <Radio className={`w-3.5 h-3.5 ${isConnected ? 'text-emerald-400 animate-pulse' : 'text-zinc-600'}`} />
        <span className="font-mono">#{activeChannel}</span>
        {paused && <span className="font-semibold text-amber-300">En pausa</span>}
        {approval && <span className="font-semibold text-amber-300">Manual</span>}
        {messageQueue.length > 0 && (
          <span className="ml-1 px-1.5 py-0.5 rounded-full bg-purple-600 text-[10px] text-white font-mono font-bold">
            {messageQueue.length}
          </span>
        )}
      </div>

      {/* Tarjeta de TTS para OBS en el estilo elegido desde el panel */}
      {currentMessage && (
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
      )}

      {/* Overlay de Metas Comunitarias & Marcadores (Compresión ≤4 en fila y Carrusel 5+ con GSAP) */}
      {isGoalsApp && (
        <div className="pointer-events-none fixed inset-x-0 top-6 z-30 flex justify-center px-4">
          <GoalsOverlayView
            goals={goalsSettings.goals}
            activeGoalId={goalsSettings.activeGoalId}
            displayMode={goalsSettings.displayMode}
            slideshowIntervalSec={goalsSettings.slideshowIntervalSec}
            recentProgressGoalId={currentGoalEvent?.goalId}
          />
        </div>
      )}

      {/* Overlay de Ruleta de Castigos & Retos en OBS */}
      {(isRouletteApp || activeRouletteSpin) && (
        <div
          ref={rouletteContainerRef}
          className="pointer-events-none fixed inset-0 z-40 flex flex-col items-center justify-center p-6"
        >
          <div className="relative flex flex-col items-center rounded-2xl border border-white/10 bg-black/85 p-6 shadow-2xl backdrop-blur-md">
            <h2
              className="cab-caps mb-3 text-sm font-black tracking-widest text-rose-400 drop-shadow"
              style={{ fontStretch: '75%' }}
            >
              {rouletteSettings.title || 'RULETA DE CASTIGOS & RETOS'}
            </h2>

            <RouletteWheel
              segments={rouletteSettings.segments}
              targetRotation={rouletteRotation}
              startRotation={rouletteStartRotation}
              targetWinner={activeRouletteSpin?.winnerSegment}
              isSpinning={isRouletteSpinning}
              spinDurationSec={activeRouletteSpin?.spinDurationSec || rouletteSettings.spinDurationSec}
              styleTheme={rouletteSettings.style}
              soundEnabled={rouletteSettings.soundEnabled}
              tickVolume={rouletteSettings.tickVolume}
              size={360}
              onSpinComplete={handleObsWheelComplete}
            />

            {rouletteWinnerBanner && (
              <div className="mt-4 w-full">
                <WinnerBanner
                  segment={rouletteWinnerBanner.segment}
                  user={rouletteWinnerBanner.user}
                  autoDismissSec={activeRouletteSpin?.winnerBannerDurationSec || 8}
                  isStudio={false}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Overlay de Batallas & Encuestas en OBS */}
      {(isPollsApp || (activePollState && activePollState.isActive)) && (
        <div
          ref={pollsContainerRef}
          className="pointer-events-none fixed inset-x-0 bottom-8 z-40 flex items-center justify-center p-6"
        >
          <div className="w-full max-w-3xl pointer-events-auto">
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

      {/* Toast HUD de Notificación de Acciones de Moderación */}
      {modNotice && (
        <div
          ref={modNoticeRef}
          className="pointer-events-none fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-full border border-amber-500/40 bg-zinc-950/90 px-4 py-2 shadow-2xl backdrop-blur-md transition-all"
        >
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/20 text-amber-400">
            <Shield className="h-3.5 w-3.5" />
          </div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-100">
            <span className="text-amber-400 font-bold uppercase tracking-wider text-[10px]">
              MODERACIÓN
            </span>
            <span className="text-zinc-500">•</span>
            <span>
              {modNotice.action in ACTION_DESCRIPTIONS
                ? ACTION_DESCRIPTIONS[modNotice.action as ControlAction](modNotice.sender, modNotice.user)
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
            className={`relative flex flex-col items-center gap-3 ${
              activeReward.position === 'fullscreen' ? 'h-full w-full justify-center' : 'max-w-xl'
            }`}
            style={{
              transform: `scale(${activeReward.scale || 1})`,
              transformOrigin: activeReward.position === 'bottom-right' ? 'bottom right' : 'center',
            }}
          >
            {/* Reproductor de Video Transparente */}
            {activeReward.videoUrl ? (
              <video
                ref={rewardVideoRef}
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
            ) : (
              /* Animación vectorial transparente generativa para presets sin archivo cargado */
              <div className="relative flex h-48 w-48 items-center justify-center">
                <div
                  className="absolute inset-0 animate-ping rounded-full opacity-30"
                  style={{ backgroundColor: activeReward.accentColor || '#9146ff' }}
                />
                <div
                  className="absolute inset-2 animate-pulse rounded-full border-2 opacity-80"
                  style={{ borderColor: activeReward.accentColor || '#9146ff' }}
                />
                <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-black/60 shadow-2xl backdrop-blur-md">
                  <Coins
                    className="h-12 w-12 animate-bounce"
                    style={{ color: activeReward.accentColor || '#9146ff' }}
                  />
                </div>
              </div>
            )}

            {/* Aviso en pantalla personalizado estilo Cabina Broadcast */}
            {activeReward.noticeText && (
              <div
                className="flex items-center gap-3 rounded-lg border bg-zinc-950/90 px-4 py-2.5 shadow-2xl backdrop-blur-md"
                style={{
                  borderColor: activeReward.accentColor || 'var(--ui, #9146ff)',
                  boxShadow: `0 8px 32px -4px ${activeReward.accentColor || '#9146ff'}40`,
                }}
              >
                <div
                  className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-black font-black"
                  style={{ backgroundColor: activeReward.accentColor || '#9146ff' }}
                >
                  <Coins className="h-4 w-4 text-white" />
                </div>
                <div className="flex flex-col">
                  <span
                    className="text-[10px] font-black uppercase tracking-wider"
                    style={{ color: activeReward.accentColor || '#9146ff' }}
                  >
                    {activeReward.rewardName}
                  </span>
                  <span className="text-sm font-bold text-white drop-shadow-sm">
                    {activeReward.noticeText}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
