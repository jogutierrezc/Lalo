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

import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import gsap from 'gsap';
import { useTwitchChat } from '../hooks/useTwitchChat';
import { SanitizedTTSMessage } from '../utils/twitchSanitizer';
import { normalizeTextForFishAudio } from '../utils/emotionMapper';
import { loadSettings, TTSSettings } from '../types/settings';
import { AlertPosition, appearanceFromParams, normalizeAppearance } from '../utils/appearance';
import { MotionOptions, playEnter, playExit, startSpeaking, stopSpeaking } from '../utils/alertMotion';
import { AlertCard } from '../components/AlertCard';
import { Radio, VolumeX } from 'lucide-react';

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
  const overrides: Partial<TTSSettings> = appearanceFromParams(getURLParam);
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

  const {
    messageQueue,
    isConnected,
    removeMessageFromQueue,
    enqueueManualMessage
  } = useTwitchChat({
    channel: activeChannel,
    enabled: true,
  });

  const [currentMessage, setCurrentMessage] = useState<SanitizedTTSMessage | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isAudioLoading, setIsAudioLoading] = useState<boolean>(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState<boolean>(false);

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
            return { ...merged, ...normalizeAppearance(merged) };
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
      const finalizePlayback = () => {
        if (finalized) return;
        finalized = true;

        if (watchdogTimer) clearTimeout(watchdogTimer);
        stopSpeakingAnimation();

        animateExit(() => {
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
    [settings, animateExit, startSpeakingAnimation, stopSpeakingAnimation]
  );

  // Bucle FIFO estricto: Observa la cola y desencadena la siguiente tarjeta cuando isPlaying es falso
  useEffect(() => {
    if (!isPlaying && !isProcessingRef.current && messageQueue.length > 0) {
      const nextMessage = messageQueue[0];
      if (nextMessage) {
        removeMessageFromQueue(nextMessage.id);
        playAudioForMessage(nextMessage);
      }
    }
  }, [isPlaying, messageQueue, removeMessageFromQueue, playAudioForMessage]);

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
    </div>
  );
};
