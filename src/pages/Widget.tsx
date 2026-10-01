/**
 * Widget.tsx
 *
 * Overlay de Text-to-Speech para OBS Studio.
 * - Fondo 100% transparente para Browser Source.
 * - Motor de animaciones fluidas con GSAP (Timeline de entrada con overshoot elástico + salida suave).
 * - Ecualizador visual reactivo con barras en stagger durante la reproducción de voz.
 * - Despachador de cola FIFO estricto con eventos onEnded / onError de HTML5 Audio para evitar traslape.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import gsap from 'gsap';
import { useTwitchChat } from '../hooks/useTwitchChat';
import { SanitizedTTSMessage } from '../utils/twitchSanitizer';
import { loadSettings } from '../types/settings';
import { MessageSquare, Volume2, Radio } from 'lucide-react';

export const Widget: React.FC = () => {
  const [settings, setSettings] = useState(loadSettings);

  // Cargar settings y escuchar cambios en localStorage
  useEffect(() => {
    const handleStorage = () => setSettings(loadSettings());
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Asegurar que el fondo del body sea 100% transparente para OBS
  useEffect(() => {
    document.body.classList.add('obs-transparent');
    return () => {
      document.body.classList.remove('obs-transparent');
    };
  }, []);

  // Conexión al chat de Twitch mediante el hook
  const {
    messageQueue,
    isConnected,
    removeMessageFromQueue,
    enqueueManualMessage
  } = useTwitchChat({
    channel: settings.channel,
    enabled: true,
  });

  // Estado del reproductor y mensaje actual en pantalla
  const [currentMessage, setCurrentMessage] = useState<SanitizedTTSMessage | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isAudioLoading, setIsAudioLoading] = useState<boolean>(false);

  // Referencias para elementos DOM y GSAP
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const barsRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const equalizerTweenRef = useRef<gsap.core.Tween | null>(null);

  // Exponer método en window para permitir enviar mensajes de prueba desde el Dashboard en la misma pestaña
  useEffect(() => {
    (window as unknown as { __LALO_TTS_TEST_TRIGGER__?: (text: string, user?: string) => void }).__LALO_TTS_TEST_TRIGGER__ = (
      text: string,
      user?: string
    ) => {
      enqueueManualMessage(text, user);
    };
  }, [enqueueManualMessage]);

  /**
   * Animación GSAP de entrada:
   * Efecto de surgimiento desde abajo con overshoot elástico
   * (y: 50, opacity: 0, duration: 0.6, ease: "back.out(1.7)")
   */
  const animateEntrance = useCallback(() => {
    if (!cardRef.current) return;
    gsap.killTweensOf(cardRef.current);
    gsap.fromTo(
      cardRef.current,
      { y: 50, opacity: 0, scale: 0.94 },
      {
        y: 0,
        opacity: 1,
        scale: 1,
        duration: 0.6,
        ease: 'back.out(1.7)',
      }
    );
  }, []);

  /**
   * Animación GSAP de salida:
   * Desvanecimiento suave tras terminar el audio
   * (opacity: 0, y: -20, duration: 0.4)
   */
  const animateExit = useCallback((onCompleteCallback: () => void) => {
    if (!cardRef.current) {
      onCompleteCallback();
      return;
    }
    gsap.to(cardRef.current, {
      opacity: 0,
      y: -20,
      scale: 0.96,
      duration: 0.4,
      ease: 'power2.in',
      onComplete: () => {
        onCompleteCallback();
      },
    });
  }, []);

  /**
   * Iniciar animación del ecualizador visual de barras
   * mientras la IA está hablando.
   */
  const startEqualizer = useCallback(() => {
    if (!barsRef.current) return;
    const bars = barsRef.current.querySelectorAll('.eq-bar');
    if (!bars.length) return;

    if (equalizerTweenRef.current) {
      equalizerTweenRef.current.kill();
    }

    equalizerTweenRef.current = gsap.to(bars, {
      scaleY: 'random(0.25, 1.8)',
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

  /**
   * Detener y resetear el ecualizador visual
   */
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

  /**
   * Reproduce el audio TTS del mensaje indicado.
   */
  const playAudioForMessage = useCallback(
    async (message: SanitizedTTSMessage) => {
      setIsPlaying(true);
      setIsAudioLoading(true);
      setCurrentMessage(message);

      // Lanzar animación visual de entrada en GSAP
      requestAnimationFrame(() => {
        animateEntrance();
      });

      let audioUrl: string | null = null;
      let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

      try {
        // Timeout defensivo de 12 segundos para evitar bloqueo eterno de red
        const controller = new AbortController();
        const fetchTimeout = setTimeout(() => controller.abort(), 12000);

        // Petición al endpoint backend /api/tts
        const response = await fetch('/api/tts', {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: message.cleanText,
            reference_id: settings.referenceId || undefined,
          }),
        });

        clearTimeout(fetchTimeout);

        if (!response.ok) {
          throw new Error(`Error en servidor TTS: HTTP ${response.status}`);
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

        // Liberación de recursos y avance en la cola
        const handlePlaybackEnd = () => {
          if (watchdogTimer) clearTimeout(watchdogTimer);
          stopEqualizer();
          animateExit(() => {
            setCurrentMessage(null);
            setIsPlaying(false);
            setIsAudioLoading(false);
            if (audioUrl) {
              URL.revokeObjectURL(audioUrl);
            }
            audioRef.current = null;
          });
        };

        audio.onplay = () => {
          setIsAudioLoading(false);
          startEqualizer();
        };

        audio.onended = handlePlaybackEnd;

        audio.onerror = (e) => {
          console.error('[Audio Error]', e);
          handlePlaybackEnd();
        };

        // Watchdog de seguridad (máximo 25s o proporcional a longitud)
        const maxDurationMs = Math.max(10000, message.cleanText.length * 200);
        watchdogTimer = setTimeout(() => {
          console.warn('[Audio Watchdog] Tiempo límite excedido, forzando liberación de la cola.');
          handlePlaybackEnd();
        }, maxDurationMs);

        await audio.play();
      } catch (err) {
        console.error('[Widget TTS Error]', err);
        if (watchdogTimer) clearTimeout(watchdogTimer);
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        stopEqualizer();
        animateExit(() => {
          setCurrentMessage(null);
          setIsPlaying(false);
          setIsAudioLoading(false);
        });
      }
    },
    [settings, animateEntrance, animateExit, startEqualizer, stopEqualizer]
  );

  /**
   * Bucle controlador de la cola FIFO:
   * Desacoplado: obtiene messageQueue[0] de forma segura para no perder mensajes.
   */
  useEffect(() => {
    if (!isPlaying && messageQueue.length > 0) {
      const nextMessage = messageQueue[0];
      if (nextMessage) {
        removeMessageFromQueue(nextMessage.id);
        playAudioForMessage(nextMessage);
      }
    }
  }, [isPlaying, messageQueue, removeMessageFromQueue, playAudioForMessage]);

  // Limpieza estricta de memoria al desmontar (cero leaks en OBS)
  useEffect(() => {
    return () => {
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
      {/* Indicador sutil de conexión para testing en OBS (opcional) */}
      <div className="absolute top-4 right-4 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-md border border-white/5 text-xs text-zinc-400">
        <Radio className={`w-3.5 h-3.5 ${isConnected ? 'text-emerald-400 animate-pulse' : 'text-zinc-600'}`} />
        <span>#{settings.channel || 'sin canal'}</span>
        {messageQueue.length > 0 && (
          <span className="ml-1 px-1.5 py-0.5 rounded-full bg-purple-600/50 text-[10px] text-purple-200 font-mono">
            {messageQueue.length}
          </span>
        )}
      </div>

      {/* Tarjeta Visual de TTS animada por GSAP */}
      {currentMessage && (
        <div
          ref={cardRef}
          className="max-w-xl w-full mx-auto glass-panel rounded-2xl p-5 shadow-glass border border-white/10 relative overflow-hidden backdrop-blur-xl pointer-events-auto"
          style={{
            boxShadow: `0 12px 40px -10px ${currentMessage.userColor}33, 0 0 20px -2px rgba(145, 70, 255, 0.15)`,
          }}
        >
          {/* Luz ambiental sutil */}
          <div
            className="absolute -top-12 -right-12 w-32 h-32 rounded-full blur-2xl opacity-20 pointer-events-none"
            style={{ backgroundColor: currentMessage.userColor }}
          />

          {/* Encabezado: Avatar + Nombre de usuario de Twitch + Ecualizador */}
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-3">
              {/* Badge inicial del usuario */}
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white shadow-md text-sm uppercase ring-2 ring-white/10"
                style={{ backgroundColor: currentMessage.userColor || '#9146FF' }}
              >
                {currentMessage.displayName.charAt(0)}
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <span
                    className="font-bold text-base tracking-tight"
                    style={{ color: currentMessage.userColor || '#f4f4f5' }}
                  >
                    {currentMessage.displayName}
                  </span>
                  <span className="text-[10px] font-mono text-zinc-400 px-1.5 py-0.5 rounded bg-white/5 border border-white/5">
                    !s
                  </span>
                </div>
                <div className="text-xs text-zinc-400 flex items-center gap-1">
                  <MessageSquare className="w-3 h-3 text-zinc-500" />
                  <span>Mensaje de chat</span>
                </div>
              </div>
            </div>

            {/* Ecualizador Visual Reactivo */}
            <div className="flex items-center gap-3">
              {isAudioLoading ? (
                <div className="flex items-center gap-1.5 text-xs text-purple-300 animate-pulse">
                  <Volume2 className="w-4 h-4 text-purple-400 animate-spin" />
                  <span>Sintetizando...</span>
                </div>
              ) : (
                <div
                  ref={barsRef}
                  className="flex items-center gap-1 h-6 px-2.5 py-1 rounded-lg bg-black/30 border border-white/5"
                  title="Ecualizador de voz"
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

          {/* Cuerpo del mensaje procesado */}
          <div className="relative">
            <p className="text-zinc-100 text-lg font-medium leading-relaxed tracking-normal break-words drop-shadow-sm">
              "{currentMessage.cleanText}"
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
