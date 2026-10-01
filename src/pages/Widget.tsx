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

import React, { useState, useEffect, useRef, useCallback } from 'react';
import gsap from 'gsap';
import { useTwitchChat } from '../hooks/useTwitchChat';
import { SanitizedTTSMessage } from '../utils/twitchSanitizer';
import { normalizeTextForFishAudio } from '../utils/emotionMapper';
import { loadSettings } from '../types/settings';
import { MessageSquare, Volume2, Radio, VolumeX } from 'lucide-react';

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
 * Renderiza el texto del mensaje destacando las etiquetas de corchete [expresión]
 * con estilo visual de pill/chip en lugar de texto plano.
 */
function renderMessageContent(text: string) {
  const parts = text.split(/(\[[a-zA-ZáéíóúÁÉÍÓÚñÑ\s-_]{2,30}\])/g);
  return parts.map((part, index) => {
    if (part.startsWith('[') && part.endsWith(']')) {
      return (
        <span
          key={index}
          className="inline-block px-1.5 py-0.5 mx-0.5 rounded bg-purple-500/25 text-purple-200 border border-purple-500/40 text-[0.85em] font-semibold tracking-wide"
        >
          {part}
        </span>
      );
    }
    return part;
  });
}

export const Widget: React.FC = () => {
  const [settings, setSettings] = useState(() => {
    const base = loadSettings();
    const channelParam = getURLParam('channel');
    const voiceParam = getURLParam('voice') || getURLParam('reference_id');
    const modelParam = getURLParam('model');
    const announceParam = getURLParam('announce');

    const rawModel = (modelParam || base.model || 's2.1-pro-free').trim().replace(/[.,;/\\]+$/, '');
    const cleanModel = rawModel.toLowerCase().includes('free') ? 's2.1-pro-free' : (rawModel || 's2.1-pro-free');

    return {
      ...base,
      channel: channelParam || base.channel || 'laloplay_',
      referenceId: voiceParam || base.referenceId,
      model: cleanModel,
      announceSender: announceParam !== null ? announceParam === 'true' || announceParam === '1' : base.announceSender,
    };
  });

  const activeChannel = settings.channel || 'laloplay_';

  // Sincronizar cambios en localStorage
  useEffect(() => {
    const handleStorage = () => {
      const updated = loadSettings();
      setSettings((prev) => ({
        ...prev,
        ...updated,
        channel: getURLParam('channel') || updated.channel,
        referenceId: getURLParam('voice') || getURLParam('reference_id') || updated.referenceId,
        model: getURLParam('model') || updated.model,
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

  // Referencias defensivas
  const isProcessingRef = useRef<boolean>(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const barsRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const equalizerTweenRef = useRef<gsap.core.Tween | null>(null);

  // Sincronización entre pestañas (Dashboard <-> Widget) vía BroadcastChannel
  useEffect(() => {
    let bus: BroadcastChannel | null = null;
    try {
      bus = new BroadcastChannel('lalo_tts_bus');
      bus.onmessage = (event) => {
        if (event.data?.type === 'ENQUEUE' && event.data.text) {
          enqueueManualMessage(event.data.text, event.data.user || 'Streamer');
        }
        if (event.data?.type === 'RELOAD') {
          console.log('[Lalo Widget] Orden de recarga recibida desde el Dashboard.');
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

  // Auto-actualizador transparente para fuentes de OBS Browser Source:
  // Detecta nuevos despliegues en Vercel y recarga el overlay automáticamente cuando no hay audio activo
  useEffect(() => {
    const currentBuildId = typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : null;
    let pendingUpdate = false;

    const checkForUpdates = async () => {
      try {
        const response = await fetch(`/api/version?t=${Date.now()}`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        }).catch(() => fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' }));

        if (!response || !response.ok) return;
        const data = await response.json();

        if (data?.buildId && currentBuildId && data.buildId !== currentBuildId) {
          console.log(`[Lalo Auto-Update] Nueva versión detectada en Vercel (Remota: ${data.buildId}, Local: ${currentBuildId}).`);
          pendingUpdate = true;
        }
      } catch {
        // Ignorar fallos temporales de red en el sondeo
      }
    };

    // Revisar actualizaciones cada 20 segundos
    const pollTimer = setInterval(() => {
      if (!isProcessingRef.current && !isPlaying && messageQueue.length === 0) {
        if (pendingUpdate) {
          console.log('[Lalo Auto-Update] Aplicando actualización de Vercel en estado inactivo...');
          window.location.reload();
          return;
        }
        checkForUpdates();
      }
    }, 20000);

    // Revisar la primera vez tras 5 segundos
    const initialTimer = setTimeout(checkForUpdates, 5000);

    return () => {
      clearInterval(pollTimer);
      clearTimeout(initialTimer);
    };
  }, [isPlaying, messageQueue.length]);

  // Animación de entrada GSAP (Back overshoot elástico)
  useEffect(() => {
    if (currentMessage && cardRef.current) {
      gsap.killTweensOf(cardRef.current);
      gsap.fromTo(
        cardRef.current,
        { y: 50, opacity: 0, scale: 0.94 },
        {
          y: 0,
          opacity: 1,
          scale: 1,
          duration: 0.55,
          ease: 'back.out(1.7)',
        }
      );
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
    const hardTimeout = setTimeout(triggerComplete, 450);

    if (cardRef.current) {
      gsap.killTweensOf(cardRef.current);
      gsap.to(cardRef.current, {
        opacity: 0,
        y: -20,
        scale: 0.96,
        duration: 0.35,
        ease: 'power2.in',
        onComplete: () => {
          clearTimeout(hardTimeout);
          triggerComplete();
        },
      });
    } else {
      clearTimeout(hardTimeout);
      triggerComplete();
    }
  }, []);

  // Animación de ecualizador mientras habla
  const startEqualizer = useCallback(() => {
    if (!barsRef.current) return;
    const bars = barsRef.current.querySelectorAll('.eq-bar');
    if (!bars.length) return;

    if (equalizerTweenRef.current) {
      equalizerTweenRef.current.kill();
    }

    equalizerTweenRef.current = gsap.to(bars, {
      scaleY: 'random(0.3, 1.8)',
      duration: 0.18,
      repeat: -1,
      yoyo: true,
      stagger: {
        each: 0.05,
        from: 'random',
      },
      ease: 'sine.inOut',
    });
  }, []);

  const stopEqualizer = useCallback(() => {
    if (equalizerTweenRef.current) {
      equalizerTweenRef.current.kill();
      equalizerTweenRef.current = null;
    }
    if (barsRef.current) {
      const bars = barsRef.current.querySelectorAll('.eq-bar');
      gsap.to(bars, { scaleY: 0.3, duration: 0.2, ease: 'power1.out' });
    }
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
        stopEqualizer();

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

        const template = settings.announceTemplate || '{user} dice: {message}';
        const spokenText = settings.announceSender !== false
          ? template
              .replace('{user}', cleanUserName)
              .replace('{message}', normalizedMessageText)
          : normalizedMessageText;

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
          startEqualizer();
        };

        audio.onended = () => {
          finalizePlayback();
        };

        audio.onerror = (e) => {
          console.warn('[Audio Player Error]', e);
          finalizePlayback();
        };

        // Watchdog de seguridad (proporcional al texto de hasta 1000 caracteres)
        const maxDurationMs = Math.max(15000, message.cleanText.length * 220);
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
              startEqualizer();
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
    [settings, animateExit, startEqualizer, stopEqualizer]
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
      if (equalizerTweenRef.current) {
        equalizerTweenRef.current.kill();
      }
      if (cardRef.current) {
        gsap.killTweensOf(cardRef.current);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 pointer-events-none flex flex-col justify-end p-8 overflow-hidden select-none"
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
      <div className="absolute top-4 right-4 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/50 backdrop-blur-md border border-white/10 text-xs text-zinc-300">
        <Radio className={`w-3.5 h-3.5 ${isConnected ? 'text-emerald-400 animate-pulse' : 'text-zinc-600'}`} />
        <span className="font-mono">#{activeChannel}</span>
        {messageQueue.length > 0 && (
          <span className="ml-1 px-1.5 py-0.5 rounded-full bg-purple-600 text-[10px] text-white font-mono font-bold">
            {messageQueue.length}
          </span>
        )}
      </div>

      {/* Tarjeta de TTS para OBS */}
      {currentMessage && (
        <div
          ref={cardRef}
          className="max-w-xl md:max-w-2xl w-full mx-auto glass-panel rounded-2xl p-5 shadow-glass border border-white/10 relative overflow-hidden backdrop-blur-xl pointer-events-auto"
          style={{
            boxShadow: `0 12px 40px -10px ${currentMessage.userColor}33, 0 0 20px -2px rgba(145, 70, 255, 0.15)`,
          }}
        >
          {/* Luz ambiental */}
          <div
            className="absolute -top-12 -right-12 w-32 h-32 rounded-full blur-2xl opacity-20 pointer-events-none"
            style={{ backgroundColor: currentMessage.userColor }}
          />

          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white shadow-md text-sm uppercase ring-2 ring-white/10 shrink-0"
                style={{ backgroundColor: currentMessage.userColor || '#9146FF' }}
              >
                {currentMessage.displayName.charAt(0)}
              </div>

              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className="font-bold text-base tracking-tight"
                    style={{ color: currentMessage.userColor || '#f4f4f5' }}
                  >
                    {currentMessage.displayName}
                  </span>
                  <span className="text-xs font-semibold text-purple-400">
                    dice:
                  </span>
                  <span className="text-[10px] font-mono text-zinc-400 px-1.5 py-0.5 rounded bg-white/5 border border-white/5">
                    !s
                  </span>
                  {currentMessage.emotion && (
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border shadow-sm backdrop-blur-md animate-in fade-in zoom-in-95 duration-300 ${currentMessage.emotion.badgeClass}`}
                    >
                      <span className="text-xs leading-none">{currentMessage.emotion.emoji}</span>
                      <span>{currentMessage.emotion.label}</span>
                    </span>
                  )}
                </div>
                <div className="text-xs text-zinc-400 flex items-center gap-1">
                  <MessageSquare className="w-3 h-3 text-zinc-500" />
                  <span>Mensaje de chat</span>
                </div>
              </div>
            </div>

            {/* Estado del ecualizador */}
            <div className="flex items-center gap-3 shrink-0">
              {isAudioLoading ? (
                <div className="flex items-center gap-1.5 text-xs text-purple-300 animate-pulse">
                  <Volume2 className="w-4 h-4 text-purple-400 animate-spin" />
                  <span>Sintetizando...</span>
                </div>
              ) : (
                <div
                  ref={barsRef}
                  className="flex items-center gap-1 h-6 px-2.5 py-1 rounded-lg bg-black/30 border border-white/5"
                >
                  <span className="eq-bar w-1 h-4 rounded-full bg-purple-400 origin-bottom" />
                  <span className="eq-bar w-1 h-5 rounded-full bg-fuchsia-400 origin-bottom" />
                  <span className="eq-bar w-1 h-3 rounded-full bg-indigo-400 origin-bottom" />
                  <span className="eq-bar w-1 h-5 rounded-full bg-purple-400 origin-bottom" />
                  <span className="eq-bar w-1 h-4 rounded-full bg-pink-400 origin-bottom" />
                </div>
              )}
            </div>
          </div>

          <div className="relative max-h-64 overflow-y-auto no-scrollbar">
            <p
              className={`text-zinc-100 font-medium leading-relaxed tracking-normal break-words drop-shadow-sm ${
                currentMessage.cleanText.length > 400
                  ? 'text-sm'
                  : currentMessage.cleanText.length > 200
                  ? 'text-base'
                  : 'text-lg'
              }`}
            >
              "{renderMessageContent(currentMessage.cleanText)}"
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
