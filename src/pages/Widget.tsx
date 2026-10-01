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
 * Renderiza el texto del mensaje descomponiéndolo en palabras y etiquetas de corchete [expresión]
 * preparadas para la animación cinética escalonada de GSAP (.msg-word).
 */
function renderMessageContent(text: string) {
  const tokens = text.split(/(\[[a-zA-ZáéíóúÁÉÍÓÚñÑ\s-_]{2,30}\]|\s+)/g);
  return tokens.map((token, index) => {
    if (!token) return null;

    if (token.startsWith('[') && token.endsWith(']')) {
      return (
        <span
          key={index}
          className="msg-word inline-block px-2 py-0.5 mx-0.5 rounded-lg bg-purple-500/25 text-purple-200 border border-purple-500/40 text-[0.86em] font-semibold tracking-wide shadow-sm"
        >
          {token}
        </span>
      );
    }

    if (/^\s+$/.test(token)) {
      return token;
    }

    return (
      <span key={index} className="msg-word inline-block">
        {token}
      </span>
    );
  });
}

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

  // Referencias defensivas y de animación GSAP
  const isProcessingRef = useRef<boolean>(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const avatarRef = useRef<HTMLDivElement | null>(null);
  const textContainerRef = useRef<HTMLDivElement | null>(null);
  const barsRef = useRef<HTMLDivElement | null>(null);
  const ambientGlowRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Tweens y timelines de animación GSAP
  const entryTimelineRef = useRef<gsap.core.Timeline | null>(null);
  const equalizerTweenRef = useRef<gsap.core.Tween | null>(null);
  const avatarTweenRef = useRef<gsap.core.Tween | null>(null);
  const auraTweenRef = useRef<gsap.core.Tween | null>(null);
  const glowTweenRef = useRef<gsap.core.Tween | null>(null);

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
          setSettings((prev) => ({ ...prev, ...event.data.settings }));
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
  // ÚNICAMENTE cuando está inactivo y con cooldown de 3 minutos para prevenir cualquier bucle.
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
            if (Date.now() - lastReload > 180000) {
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

    const initialTimer = setTimeout(checkDeployment, 8000);
    const intervalTimer = setInterval(checkDeployment, 45000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
    };
  }, [isPlaying, messageQueue.length]);

  // Animación de entrada GSAP (Tarjeta elástica + Revelación cinética escalonada de palabras)
  useEffect(() => {
    if (currentMessage && cardRef.current) {
      entryTimelineRef.current?.kill();
      gsap.killTweensOf(cardRef.current);

      const tl = gsap.timeline();
      entryTimelineRef.current = tl;

      // 1. Tarjeta entra con overshoot elástico suave (back.out)
      tl.fromTo(
        cardRef.current,
        { y: 45, opacity: 0, scale: 0.94 },
        {
          y: 0,
          opacity: 1,
          scale: 1,
          duration: 0.5,
          ease: 'back.out(1.4)',
        }
      );

      // 2. Revelación cinética de palabras (.msg-word) escalonada
      if (textContainerRef.current) {
        const words = textContainerRef.current.querySelectorAll('.msg-word');
        if (words.length > 0) {
          gsap.killTweensOf(words);
          // Velocidad adaptativa: palabras cortas juegan dinámicas, párrafos largos entran fluidos sin demoras
          const staggerSpeed = Math.max(0.01, Math.min(0.035, 0.9 / words.length));

          tl.fromTo(
            words,
            { opacity: 0, y: 12, scale: 0.92, filter: 'blur(4px)' },
            {
              opacity: 1,
              y: 0,
              scale: 1,
              filter: 'blur(0px)',
              duration: 0.35,
              stagger: staggerSpeed,
              ease: 'power2.out',
            },
            '-=0.25' // Se superpone con el aterrizaje de la tarjeta
          );
        }
      }
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
      gsap.killTweensOf(cardRef.current);

      const exitTl = gsap.timeline({
        onComplete: () => {
          clearTimeout(hardTimeout);
          triggerComplete();
        },
      });

      // Si hay palabras visibles, desvanecerlas suavemente hacia arriba
      if (textContainerRef.current) {
        const words = textContainerRef.current.querySelectorAll('.msg-word');
        if (words.length > 0) {
          exitTl.to(words, {
            y: -10,
            opacity: 0,
            duration: 0.18,
            stagger: 0.005,
            ease: 'power2.in',
          });
        }
      }

      // Salida rápida y elegante de la tarjeta
      exitTl.to(
        cardRef.current,
        {
          opacity: 0,
          y: -22,
          scale: 0.96,
          duration: 0.3,
          ease: 'power2.in',
        },
        '-=0.1'
      );
    } else {
      clearTimeout(hardTimeout);
      triggerComplete();
    }
  }, []);

  // Inicia la orquestación visual completa de "habla" con GSAP:
  // 1. Avatar parlante: micro-vibración y rebote sutil al ritmo de la voz.
  // 2. Ondas acústicas/Aura: anillos de pulso concéntricos expandiéndose hacia afuera.
  // 3. Resplandor ambiental respirante: luz difusa que late detrás de la tarjeta.
  // 4. Ecualizador armónico de 7 bandas: barras de frecuencia reactivas.
  const startSpeakingAnimation = useCallback(() => {
    // 1. Ecualizador reactivo
    if (barsRef.current) {
      const bars = barsRef.current.querySelectorAll('.eq-bar');
      if (bars.length) {
        equalizerTweenRef.current?.kill();
        equalizerTweenRef.current = gsap.to(bars, {
          scaleY: 'random(0.3, 1.9)',
          duration: 0.16,
          repeat: -1,
          yoyo: true,
          stagger: {
            each: 0.035,
            from: 'center',
          },
          ease: 'sine.inOut',
        });
      }
    }

    // 2. Avatar con micro-movimiento vocal (como si hablara)
    if (avatarRef.current) {
      avatarTweenRef.current?.kill();
      avatarTweenRef.current = gsap.to(avatarRef.current, {
        scale: 1.07,
        y: -2.5,
        rotation: 'random(-1.2, 1.2)',
        duration: 0.17,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      });
    }

    // 3. Anillos de sonido/aura emanando del avatar
    if (cardRef.current) {
      const auraRings = cardRef.current.querySelectorAll('.talking-aura-ring');
      if (auraRings.length) {
        auraTweenRef.current?.kill();
        auraTweenRef.current = gsap.fromTo(
          auraRings,
          { scale: 0.95, opacity: 0.75 },
          {
            scale: 1.6,
            opacity: 0,
            duration: 1.15,
            repeat: -1,
            stagger: 0.55,
            ease: 'power1.out',
          }
        );
      }
    }

    // 4. Luz ambiental respirando con energía vocal
    if (ambientGlowRef.current) {
      glowTweenRef.current?.kill();
      glowTweenRef.current = gsap.to(ambientGlowRef.current, {
        scale: 1.35,
        opacity: 0.45,
        duration: 0.45,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      });
    }
  }, []);

  const stopSpeakingAnimation = useCallback(() => {
    if (equalizerTweenRef.current) {
      equalizerTweenRef.current.kill();
      equalizerTweenRef.current = null;
    }
    if (avatarTweenRef.current) {
      avatarTweenRef.current.kill();
      avatarTweenRef.current = null;
    }
    if (auraTweenRef.current) {
      auraTweenRef.current.kill();
      auraTweenRef.current = null;
    }
    if (glowTweenRef.current) {
      glowTweenRef.current.kill();
      glowTweenRef.current = null;
    }

    if (barsRef.current) {
      const bars = barsRef.current.querySelectorAll('.eq-bar');
      gsap.to(bars, { scaleY: 0.3, duration: 0.2, ease: 'power1.out' });
    }
    if (avatarRef.current) {
      gsap.to(avatarRef.current, { scale: 1, y: 0, rotation: 0, duration: 0.2, ease: 'power2.out' });
    }
    if (cardRef.current) {
      const auraRings = cardRef.current.querySelectorAll('.talking-aura-ring');
      gsap.to(auraRings, { opacity: 0, scale: 0.95, duration: 0.2 });
    }
    if (ambientGlowRef.current) {
      gsap.to(ambientGlowRef.current, { scale: 1, opacity: 0.2, duration: 0.3, ease: 'power1.out' });
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
          startSpeakingAnimation();
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
              startSpeakingAnimation();
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
          {/* Luz ambiental con respiración vocal GSAP */}
          <div
            ref={ambientGlowRef}
            className="absolute -top-12 -right-12 w-36 h-36 rounded-full blur-2xl opacity-20 pointer-events-none transition-opacity"
            style={{ backgroundColor: currentMessage.userColor }}
          />

          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-3">
              {/* Contenedor de Avatar con aura de voz interactiva */}
              <div className="relative shrink-0 flex items-center justify-center">
                {/* Ondas concéntricas de sonido / aura parlante */}
                <span
                  className="talking-aura-ring absolute -inset-1 rounded-2xl opacity-0 pointer-events-none border border-purple-400/50"
                  style={{
                    boxShadow: `0 0 16px ${currentMessage.userColor || '#9146FF'}88`,
                  }}
                />
                <span
                  className="talking-aura-ring absolute -inset-1.5 rounded-2xl opacity-0 pointer-events-none border border-fuchsia-400/40"
                  style={{
                    boxShadow: `0 0 24px ${currentMessage.userColor || '#9146FF'}66`,
                  }}
                />

                {/* Avatar parlante animado con GSAP */}
                <div
                  ref={avatarRef}
                  className="w-11 h-11 rounded-xl flex items-center justify-center font-bold text-white shadow-lg text-sm uppercase ring-2 ring-white/15 relative z-10 transition-shadow select-none"
                  style={{ backgroundColor: currentMessage.userColor || '#9146FF' }}
                >
                  {currentMessage.displayName.charAt(0)}
                </div>
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
                  className="flex items-center gap-1 h-7 px-3 py-1 rounded-xl bg-black/40 border border-white/10 shadow-inner"
                >
                  <span className="eq-bar w-1 h-3 rounded-full bg-purple-400 origin-bottom" />
                  <span className="eq-bar w-1 h-5 rounded-full bg-fuchsia-400 origin-bottom" />
                  <span className="eq-bar w-1 h-4 rounded-full bg-indigo-400 origin-bottom" />
                  <span className="eq-bar w-1 h-6 rounded-full bg-purple-300 origin-bottom" />
                  <span className="eq-bar w-1 h-4 rounded-full bg-pink-400 origin-bottom" />
                  <span className="eq-bar w-1 h-5 rounded-full bg-fuchsia-400 origin-bottom" />
                  <span className="eq-bar w-1 h-3 rounded-full bg-purple-400 origin-bottom" />
                </div>
              )}
            </div>
          </div>

          <div
            ref={textContainerRef}
            className="relative max-h-64 overflow-y-auto no-scrollbar"
          >
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
