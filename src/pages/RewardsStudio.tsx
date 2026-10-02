/**
 * src/pages/RewardsStudio.tsx
 *
 * Estudio de Recompensas de Puntos de Canal, Avisos Personalizados y Videos Transparentes.
 * Diseñado bajo la estética Cabina Broadcast (hardware de televisión),
 * principios de diseño de Emil Kowalski y modo Operate de Impeccable.
 */

import React, { useState, useRef } from 'react';
import gsap from 'gsap';
import {
  Check,
  Coins,
  Copy,
  ExternalLink,
  Film,
  FolderOpen,
  Play,
  Plus,
  Trash2,
  Tv,
  Upload,
  Video,
  Volume2,
  AlertCircle,
} from 'lucide-react';
import { SuiteNav } from '../components/SuiteNav';
import { useRewardsSettings } from '../hooks/useRewardsSettings';
import {
  CustomRewardItem,
  RewardBlendMode,
  RewardVideoPosition,
  buildRewardNotice,
} from '../types/rewards';
import { AlertSoundType } from '../types/alerts';
import { playAlertOrCustomSound, playCustomAudio } from '../utils/alertsAudio';
import { postBus } from '../utils/bus';
import { MediaLibraryModal } from '../components/MediaLibraryModal';
import {
  MediaItem,
  MediaType,
  inspectAudioFile,
  MAX_AUDIO_DURATION_SECONDS,
} from '../types/mediaLibrary';

const ACCENTS = [
  { color: '#9146ff', name: 'Morado Twitch' },
  { color: '#ff2d46', name: 'Rojo Carmesí' },
  { color: '#53fc18', name: 'Verde Neón' },
  { color: '#ffb020', name: 'Ámbar Dorado' },
  { color: '#22c7e0', name: 'Cian Cibernético' },
  { color: '#ff6b4a', name: 'Coral Radiante' },
];

const SOUND_PRESETS: { id: AlertSoundType; name: string }[] = [
  { id: 'arcade-chime', name: 'Chime Arcade (16-bit)' },
  { id: 'retro-fanfare', name: 'Fanfarria Retro' },
  { id: 'synth-bell', name: 'Campana Synth' },
  { id: 'soft-pop', name: 'Pop Cálido' },
  { id: 'none', name: 'Sin sonido de alerta' },
];

const POSITION_LABELS: Record<RewardVideoPosition, string> = {
  center: 'Centro de Pantalla',
  fullscreen: 'Pantalla Completa',
  'bottom-right': 'Inferior Derecha',
  'bottom-left': 'Inferior Izquierda',
  'top-right': 'Superior Derecha',
  'top-left': 'Superior Izquierda',
};

const BLEND_MODE_LABELS: Record<RewardBlendMode, { label: string; desc: string }> = {
  transparent: {
    label: 'WebM Transparente (Alfa)',
    desc: 'Canal alfa nativo de 60 FPS sin ningún fondo',
  },
  screen: {
    label: 'Screen Blend (Fondo Negro)',
    desc: 'Remueve fondos oscuros; ideal para fuego, chispas y humo',
  },
  'chroma-green': {
    label: 'Chroma Key (Pantalla Verde)',
    desc: 'Eliminación automática de color verde (#00ff00)',
  },
};

export const RewardsStudio: React.FC = () => {
  const {
    rewardsSettings,
    updateRewardItem,
    addRewardItem,
    deleteRewardItem,
    saved,
  } = useRewardsSettings();

  const [selectedRewardId, setSelectedRewardId] = useState<string>(
    rewardsSettings.rewards[0]?.id || 'reward-confetti'
  );
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);

  // Modal de Biblioteca de Medios (Media Vault)
  const [isMediaModalOpen, setIsMediaModalOpen] = useState(false);
  const [mediaModalType, setMediaModalType] = useState<MediaType>('video');
  const [mediaModalTarget, setMediaModalTarget] = useState<'video' | 'audio'>('video');

  // Monitor de simulación 16:9
  const monitorStageRef = useRef<HTMLDivElement | null>(null);
  const [monitorActiveReward, setMonitorActiveReward] = useState<{
    reward: CustomRewardItem;
    user: string;
    text: string;
  } | null>(null);

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const widgetUrl = `${baseUrl}/#widget?app=rewards&channel=${rewardsSettings.channel}`;

  const currentReward =
    rewardsSettings.rewards.find((r) => r.id === selectedRewardId) ||
    rewardsSettings.rewards[0];

  const copyWidgetUrl = () => {
    navigator.clipboard?.writeText(widgetUrl).catch(() => {});
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2200);
  };

  const openMediaVault = (type: MediaType, target: 'video' | 'audio') => {
    setMediaModalType(type);
    setMediaModalTarget(target);
    setIsMediaModalOpen(true);
  };

  const handleMediaModalSelect = (item: MediaItem) => {
    setIsMediaModalOpen(false);
    if (!currentReward) return;
    if (mediaModalTarget === 'video') {
      updateRewardItem(currentReward.id, {
        videoUrl: item.url,
        videoName: item.name,
        blendMode: item.format === 'webm' ? 'transparent' : 'screen',
      });
      setTestStatus(`¡Video «${item.name}» asignado desde la Biblioteca!`);
    } else {
      updateRewardItem(currentReward.id, {
        customAudioUrl: item.url,
        customAudioName: item.name,
        customAudioVolume: currentReward.customAudioVolume ?? currentReward.volume ?? 0.85,
      });
      setTestStatus(`¡Audio «${item.name}» (${item.duration}s) asignado desde la Biblioteca!`);
    }
    setTimeout(() => setTestStatus(null), 3000);
  };

  const handleCustomAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentReward) return;
    try {
      setAudioError(null);
      const { dataUrl, duration } = await inspectAudioFile(file);
      updateRewardItem(currentReward.id, {
        customAudioUrl: dataUrl,
        customAudioName: file.name,
        customAudioVolume: currentReward.customAudioVolume ?? currentReward.volume ?? 0.85,
      });
      setTestStatus(`¡Audio «${file.name}» (${duration}s) asignado a la recompensa!`);
      setTimeout(() => setTestStatus(null), 3000);
    } catch (err: any) {
      setAudioError(err?.message || `El archivo supera el límite de ${MAX_AUDIO_DURATION_SECONDS}s.`);
      setTimeout(() => setAudioError(null), 6000);
    }
  };

  // Disparar prueba en el monitor y en OBS
  const triggerRewardTest = (rewardToTest: CustomRewardItem) => {
    const demoUser = 'EspectadorFan';
    const demoMessage = '¡Lanza el meme que ganamos la partida!';
    const noticeText = buildRewardNotice(
      rewardToTest.noticeTemplate,
      demoUser,
      rewardToTest.name,
      demoMessage
    );

    // 1. Sonido o Audio Personalizado
    const audioVol = rewardToTest.customAudioVolume ?? rewardToTest.volume ?? 0.85;
    playAlertOrCustomSound(
      rewardToTest.customAudioUrl,
      rewardToTest.soundType || 'arcade-chime',
      audioVol
    );

    // 2. Sacudida de pantalla en el monitor de simulación
    if (rewardToTest.screenShake && monitorStageRef.current) {
      gsap.fromTo(
        monitorStageRef.current,
        { x: -14, y: 10, rotate: -0.8 },
        {
          x: 0,
          y: 0,
          rotate: 0,
          duration: 0.65,
          ease: 'elastic.out(1.2, 0.2)',
          clearProps: 'transform',
        }
      );
    }

    // 3. Activar en el monitor
    setMonitorActiveReward({
      reward: rewardToTest,
      user: demoUser,
      text: noticeText,
    });

    // 4. Enviar al widget en OBS vía bus
    postBus({
      type: 'REWARD_TRIGGER',
      reward: {
        id: `reward-run-${Date.now()}`,
        user: demoUser,
        rewardName: rewardToTest.name,
        noticeText,
        videoUrl: rewardToTest.videoUrl,
        blendMode: rewardToTest.blendMode,
        position: rewardToTest.position,
        scale: rewardToTest.scale,
        volume: rewardToTest.volume,
        screenShake: rewardToTest.screenShake,
        accentColor: rewardToTest.accentColor,
        soundType: rewardToTest.soundType,
        duration: rewardToTest.duration || 5,
        customAudioUrl: rewardToTest.customAudioUrl,
        customAudioVolume: audioVol,
      },
    });

    setTestStatus(`¡Recompensa «${rewardToTest.name}» disparada al monitor y a OBS!`);
    setTimeout(() => setTestStatus(null), 3200);

    // Auto-cierre en el monitor
    const timeoutSec = rewardToTest.duration || 5;
    setTimeout(() => {
      setMonitorActiveReward(null);
    }, timeoutSec * 1000);
  };


  // Carga de archivo de video local (.webm, .mp4)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentReward) return;

    const reader = new FileReader();
    reader.onload = (uploadEvent) => {
      const result = uploadEvent.target?.result as string;
      const isWebM = file.name.toLowerCase().endsWith('.webm');
      updateRewardItem(currentReward.id, {
        videoUrl: result,
        videoName: file.name,
        blendMode: isWebM ? 'transparent' : 'screen',
      });
      setTestStatus(`¡Archivo de video «${file.name}» cargado con éxito!`);
      setTimeout(() => setTestStatus(null), 3000);
    };
    reader.readAsDataURL(file);
  };

  const handleCreateNew = () => {
    const newId = `custom-reward-${Date.now()}`;
    const newReward: CustomRewardItem = {
      id: newId,
      name: 'Nueva Recompensa con Video',
      cost: 500,
      description: 'Aviso personalizado en pantalla con video transparente.',
      enabled: true,
      cooldownSeconds: 30,
      userInputRequired: false,
      blendMode: 'transparent',
      position: 'center',
      scale: 1.0,
      volume: 0.85,
      showNoticeText: true,
      noticeTemplate: '¡{user} canjeó {reward}!',
      duration: 5,
      screenShake: false,
      soundType: 'arcade-chime',
      accentColor: '#9146ff',
    };
    addRewardItem(newReward);
    setSelectedRewardId(newId);
  };

  const rootStyle = {
    '--acc': currentReward?.accentColor || '#9146ff',
    '--acc-ink': '#ffffff',
  } as React.CSSProperties;

  return (
    <div className="cab" style={rootStyle}>
      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-6">
        {/* Barra superior de la Suite */}
        <SuiteNav
          currentApp="recompensas"
          channel={rewardsSettings.channel}
          saved={saved}
        />

        {/* Encabezado del Módulo */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[color:var(--cb-line)] pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-black text-black">
                MÓDULO 4
              </span>
              <span className="cab-caps text-xs text-[color:var(--cb-mut)]">
                ESTUDIO DE PUNTOS DE CANAL & FX
              </span>
            </div>
            <h1
              className="cab-caps mt-1 text-2xl font-extrabold"
              style={{ fontStretch: '70%', fontWeight: 800 }}
            >
              Biblioteca de Recompensas & Videos Transparentes
            </h1>
            <p className="mt-1 text-xs text-[color:var(--cb-mut)]">
              Configura avisos interactivos de canal con videos WebM con canal alfa, efectos de sacudida de pantalla (Screen Shake) y triggers para OBS Studio.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="cab-btn2 !h-8 !px-3 !text-xs font-bold"
              onClick={copyWidgetUrl}
              title="Copiar URL para fuente de navegador en OBS Studio"
            >
              {copiedUrl ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              <span>{copiedUrl ? '¡URL Copiada!' : 'Copiar URL OBS'}</span>
            </button>
            <a
              href={widgetUrl}
              target="_blank"
              rel="noreferrer"
              className="cab-btn2 !h-8 !px-3 !text-xs font-bold no-underline"
              title="Abrir vista de overlay en pestaña nueva"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span>Ver Overlay</span>
            </a>
          </div>
        </header>

        {/* Notificación de estado temporal */}
        {testStatus && (
          <div className="flex items-center gap-2 rounded border border-amber-500/40 bg-amber-950/40 px-3 py-2 text-xs font-bold text-amber-300">
            <Check className="h-4 w-4 text-amber-400" />
            <span>{testStatus}</span>
          </div>
        )}

        {/* Monitor 16:9 de Simulación en Vivo */}
        <section aria-label="Monitor de simulación de escenario">
          <div className="rounded-md border border-[color:var(--cb-line)] bg-[color:var(--cb-panel)] p-4 shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Tv className="h-4 w-4 text-amber-400" />
                <span className="cab-caps text-xs font-bold">
                  MONITOR EN VIVO 16:9 (VISTA PREVIA DE OBS)
                </span>
              </div>
              {currentReward && (
                <button
                  type="button"
                  className="cab-btn !h-8 !px-4 !text-xs font-extrabold"
                  onClick={() => triggerRewardTest(currentReward)}
                  title="Ejecutar prueba de la recompensa seleccionada"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span>Probar Recompensa en Monitor y OBS</span>
                </button>
              )}
            </div>

            {/* Escenario 16:9 con guías de transmisión */}
            <div
              ref={monitorStageRef}
              className="relative aspect-video w-full overflow-hidden rounded border border-black/40 bg-zinc-950 shadow-inner flex items-center justify-center"
              style={{
                backgroundImage:
                  'radial-gradient(circle at center, #18191f 0%, #0d0e12 100%)',
              }}
            >
              {/* Cuadrícula sutil de referencia */}
              <div className="pointer-events-none absolute inset-0 opacity-15 [background-image:linear-gradient(to_right,#ffffff15_1px,transparent_1px),linear-gradient(to_bottom,#ffffff15_1px,transparent_1px)] [background-size:40px_40px]" />

              {/* Guías de márgenes de seguridad OBS */}
              <div className="pointer-events-none absolute inset-4 rounded border border-dashed border-white/10" />

              {/* Contenido renderizado si hay recompensa activa en el monitor */}
              {monitorActiveReward ? (
                <div
                  className={`pointer-events-none absolute inset-0 flex p-6 transition-all duration-300 ${
                    monitorActiveReward.reward.position === 'fullscreen'
                      ? 'items-center justify-center'
                      : monitorActiveReward.reward.position === 'bottom-right'
                      ? 'items-end justify-end'
                      : monitorActiveReward.reward.position === 'bottom-left'
                      ? 'items-end justify-start'
                      : monitorActiveReward.reward.position === 'top-right'
                      ? 'items-start justify-end'
                      : monitorActiveReward.reward.position === 'top-left'
                      ? 'items-start justify-start'
                      : 'items-center justify-center'
                  }`}
                >
                  <div
                    className="flex flex-col items-center gap-2"
                    style={{
                      transform: `scale(${monitorActiveReward.reward.scale || 1})`,
                    }}
                  >
                    {/* Video o animación generativa */}
                    {monitorActiveReward.reward.videoUrl ? (
                      <video
                        src={monitorActiveReward.reward.videoUrl}
                        autoPlay
                        playsInline
                        muted={false}
                        className="max-h-56 w-auto rounded object-contain"
                        style={{
                          mixBlendMode:
                            monitorActiveReward.reward.blendMode === 'screen'
                              ? 'screen'
                              : 'normal',
                        }}
                      />
                    ) : (
                      <div className="relative flex h-36 w-36 items-center justify-center">
                        <div
                          className="absolute inset-0 animate-ping rounded-full opacity-30"
                          style={{
                            backgroundColor:
                              monitorActiveReward.reward.accentColor || '#9146ff',
                          }}
                        />
                        <div
                          className="flex h-20 w-20 items-center justify-center rounded-2xl bg-black/80 shadow-2xl backdrop-blur-md"
                          style={{
                            border: `2px solid ${
                              monitorActiveReward.reward.accentColor || '#9146ff'
                            }`,
                          }}
                        >
                          <Coins
                            className="h-10 w-10 animate-bounce"
                            style={{
                              color:
                                monitorActiveReward.reward.accentColor || '#9146ff',
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Aviso personalizado en pantalla */}
                    {monitorActiveReward.reward.showNoticeText && (
                      <div
                        className="flex items-center gap-2.5 rounded-lg border bg-zinc-950/95 px-3.5 py-2 shadow-2xl backdrop-blur-md"
                        style={{
                          borderColor:
                            monitorActiveReward.reward.accentColor || '#9146ff',
                        }}
                      >
                        <div
                          className="flex h-7 w-7 items-center justify-center rounded-md font-black text-black"
                          style={{
                            backgroundColor:
                              monitorActiveReward.reward.accentColor || '#9146ff',
                          }}
                        >
                          <Coins className="h-3.5 w-3.5 text-white" />
                        </div>
                        <div className="flex flex-col text-left">
                          <span
                            className="text-[10px] font-black uppercase tracking-wider"
                            style={{
                              color:
                                monitorActiveReward.reward.accentColor || '#9146ff',
                            }}
                          >
                            {monitorActiveReward.reward.name}
                          </span>
                          <span className="text-xs font-bold text-white">
                            {monitorActiveReward.text}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1.5 text-center text-zinc-500">
                  <Film className="h-8 w-8 opacity-40 text-amber-400" />
                  <span className="cab-caps text-xs font-bold">
                    Escenario en Espera · Pulsa «Probar Recompensa» para simular la animación
                  </span>
                  <span className="text-[11px] text-zinc-600">
                    Posición actual:{' '}
                    <b className="text-zinc-400">
                      {POSITION_LABELS[currentReward?.position || 'center']}
                    </b>{' '}
                    · Escala: <b className="text-zinc-400">{currentReward?.scale}x</b>
                  </span>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Área Principal: Lista de Recompensas + Inspector de Edición */}
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1.35fr)]">
          {/* Columna Izquierda: Biblioteca de Recompensas */}
          <section className="cab-mod" aria-label="Biblioteca de Recompensas">
            <div className="flex items-center justify-between border-b border-[color:var(--cb-line)] pb-3">
              <div>
                <h2>
                  <span>1</span>Biblioteca de Recompensas
                </h2>
                <p className="cab-hint text-xs">
                  Recompensas canjeables mediante Puntos de Canal en Twitch.
                </p>
              </div>
              <button
                type="button"
                className="cab-btn !h-8 !px-3 !text-xs font-bold"
                onClick={handleCreateNew}
                title="Crear una nueva recompensa personalizada"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Nueva</span>
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              {rewardsSettings.rewards.map((r) => {
                const isSelected = r.id === currentReward?.id;
                return (
                  <article
                    key={r.id}
                    onClick={() => setSelectedRewardId(r.id)}
                    className={`cursor-pointer rounded-md border p-3.5 transition-all duration-150 active:scale-[0.98] ${
                      isSelected
                        ? 'border-[color:var(--cb-fg)] bg-[color:var(--cb-surface)] shadow-md'
                        : 'border-[color:var(--cb-line)] bg-[color:var(--cb-panel)] hover:border-[color:var(--cb-fg)]/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-10 w-10 flex-none items-center justify-center rounded-md font-mono text-sm font-bold shadow-sm"
                          style={{
                            backgroundColor: `${r.accentColor}25`,
                            color: r.accentColor,
                            border: `1px solid ${r.accentColor}50`,
                          }}
                        >
                          <Coins className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="cab-caps text-sm font-extrabold text-[color:var(--cb-fg)]">
                            {r.name}
                          </h3>
                          <p className="text-xs text-[color:var(--cb-mut)] line-clamp-1">
                            {r.description}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="cab-mono rounded bg-amber-500/20 px-2 py-0.5 text-xs font-black text-amber-300">
                          {r.cost} pts
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[color:var(--cb-line)]/50 pt-2 text-[11px] text-[color:var(--cb-mut)]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-[color:var(--cb-bg)] px-1.5 py-0.5 font-bold">
                          {r.videoUrl ? 'Video Cargado' : 'Preset Generativo'}
                        </span>
                        <span className="rounded bg-[color:var(--cb-bg)] px-1.5 py-0.5">
                          {POSITION_LABELS[r.position]}
                        </span>
                        {r.customAudioUrl && (
                          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-bold text-emerald-300">
                            Audio MP3
                          </span>
                        )}
                        {r.screenShake && (
                          <span className="rounded bg-rose-500/20 px-1.5 py-0.5 font-bold text-rose-300">
                            Screen Shake
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        className="cab-btn2 !h-6 !px-2 !text-[11px] font-bold"
                        onClick={(e) => {
                          e.stopPropagation();
                          triggerRewardTest(r);
                        }}
                        title="Probar rápidamente esta recompensa"
                      >
                        <Play className="h-2.5 w-2.5 fill-current" />
                        <span>Probar</span>
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          {/* Columna Derecha: Inspector & Carga de Video Transparente */}
          {currentReward && (
            <section
              className="cab-mod"
              aria-label={`Editar ${currentReward.name}`}
            >
              <div className="flex items-center justify-between border-b border-[color:var(--cb-line)] pb-3">
                <div>
                  <h2>
                    <span>2</span>Editor de Video & Avisos
                  </h2>
                  <p className="cab-hint text-xs">
                    Edita el video transparente, modo de mezcla, escala y aviso en pantalla.
                  </p>
                </div>

                {rewardsSettings.rewards.length > 1 && (
                  <button
                    type="button"
                    className="cab-btn2 !h-7 !px-2 text-rose-400 hover:text-rose-300"
                    onClick={() => deleteRewardItem(currentReward.id)}
                    title="Eliminar esta recompensa"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Eliminar</span>
                  </button>
                )}
              </div>

              <div className="mt-4 grid gap-4">
                {/* Nombre y Coste */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="cab-caps mb-1 block text-[11px] font-bold text-[color:var(--cb-mut)]">
                      Nombre de la Recompensa
                    </label>
                    <input
                      type="text"
                      value={currentReward.name}
                      onChange={(e) =>
                        updateRewardItem(currentReward.id, { name: e.target.value })
                      }
                      className="cab-inp text-xs font-bold"
                    />
                  </div>

                  <div>
                    <label className="cab-caps mb-1 block text-[11px] font-bold text-[color:var(--cb-mut)]">
                      Coste (Puntos de Canal)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={50}
                      value={currentReward.cost}
                      onChange={(e) =>
                        updateRewardItem(currentReward.id, {
                          cost: Math.max(0, parseInt(e.target.value, 10) || 0),
                        })
                      }
                      className="cab-inp cab-mono text-xs font-bold"
                    />
                  </div>
                </div>

                {/* Subida de Video Transparente */}
                <div className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-3.5">
                  <div className="flex items-center justify-between">
                    <span className="cab-caps text-xs font-bold text-[color:var(--cb-fg)]">
                      VIDEO TRANSPARENTE / MEME
                    </span>
                    <span className="text-[10px] font-bold text-amber-400">
                      Soporta .webm (alfa) y .mp4
                    </span>
                  </div>

                  {currentReward.videoUrl ? (
                    <div className="mt-2.5 flex items-center justify-between rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-panel)] p-2">
                      <div className="flex items-center gap-2 text-xs">
                        <Video className="h-4 w-4 text-emerald-400" />
                        <span className="cab-mono font-bold truncate max-w-xs">
                          {currentReward.videoName || 'video_cargado.webm'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          className="cab-btn2 !h-6 !px-2 !text-[11px] text-amber-400 transition-transform active:scale-[0.97]"
                          onClick={() => openMediaVault('video', 'video')}
                        >
                          <FolderOpen className="h-3 w-3" />
                          <span>Cambiar</span>
                        </button>
                        <button
                          type="button"
                          className="cab-btn2 !h-6 !px-2 !text-[11px] text-rose-400 transition-transform active:scale-[0.97]"
                          onClick={() =>
                            updateRewardItem(currentReward.id, {
                              videoUrl: undefined,
                              videoName: undefined,
                            })
                          }
                        >
                          Quitar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => openMediaVault('video', 'video')}
                        className="flex items-center justify-center gap-2 rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-bg)] p-3 text-xs font-bold text-[color:var(--cb-fg)] transition-all hover:border-amber-400 active:scale-[0.97]"
                      >
                        <FolderOpen className="h-4 w-4 text-amber-400" />
                        <span>Biblioteca de Videos (Vault)</span>
                      </button>

                      <label className="flex cursor-pointer items-center justify-center gap-2 rounded border border-dashed border-[color:var(--cb-line)] bg-[color:var(--cb-bg)] p-3 text-xs font-bold text-[color:var(--cb-fg)] transition-colors hover:border-[color:var(--cb-fg)] active:scale-[0.97]">
                        <Upload className="h-4 w-4 text-amber-400" />
                        <span>Subir Video (.webm/.mp4)</span>
                        <input
                          type="file"
                          accept="video/webm,video/mp4"
                          onChange={handleFileUpload}
                          className="hidden"
                        />
                      </label>
                    </div>
                  )}

                  {/* Selector de Modo de Transparencia */}
                  <div className="mt-3">
                    <label className="cab-caps mb-1 block text-[11px] font-bold text-[color:var(--cb-mut)]">
                      Modo de Transparencia
                    </label>
                    <div className="grid gap-1.5 sm:grid-cols-3">
                      {(['transparent', 'screen', 'chroma-green'] as RewardBlendMode[]).map(
                        (mode) => {
                          const isSel = currentReward.blendMode === mode;
                          return (
                            <button
                              key={mode}
                              type="button"
                              onClick={() =>
                                updateRewardItem(currentReward.id, { blendMode: mode })
                              }
                              className={`rounded border p-2 text-left transition-all ${
                                isSel
                                  ? 'border-[color:var(--cb-fg)] bg-[color:var(--cb-panel)] font-bold text-[color:var(--cb-fg)] shadow-sm'
                                  : 'border-[color:var(--cb-line)] bg-[color:var(--cb-bg)] text-[color:var(--cb-mut)] hover:text-[color:var(--cb-fg)]'
                              }`}
                            >
                              <span className="block text-xs">
                                {BLEND_MODE_LABELS[mode].label}
                              </span>
                              <span className="block text-[10px] opacity-70">
                                {BLEND_MODE_LABELS[mode].desc}
                              </span>
                            </button>
                          );
                        }
                      )}
                    </div>
                  </div>
                </div>

                {/* Posición y Escala */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="cab-caps mb-1 block text-[11px] font-bold text-[color:var(--cb-mut)]">
                      Posición en Pantalla
                    </label>
                    <select
                      value={currentReward.position}
                      onChange={(e) =>
                        updateRewardItem(currentReward.id, {
                          position: e.target.value as RewardVideoPosition,
                        })
                      }
                      className="cab-inp text-xs font-bold"
                    >
                      {Object.entries(POSITION_LABELS).map(([pos, label]) => (
                        <option key={pos} value={pos}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <label className="cab-caps text-[11px] font-bold text-[color:var(--cb-mut)]">
                        Escala del Video
                      </label>
                      <span className="cab-mono text-xs font-bold text-[color:var(--cb-fg)]">
                        {currentReward.scale}x
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.5}
                      max={2.0}
                      step={0.05}
                      value={currentReward.scale}
                      onChange={(e) =>
                        updateRewardItem(currentReward.id, {
                          scale: parseFloat(e.target.value),
                        })
                      }
                      className="w-full accent-[color:var(--ui,#9146ff)]"
                    />
                  </div>
                </div>

                {/* Efectos de Impacto: Screen Shake y Volumen */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="cab-caps mb-1 block text-[11px] font-bold text-[color:var(--cb-mut)]">
                      Efecto de Sacudida (Screen Shake)
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        updateRewardItem(currentReward.id, {
                          screenShake: !currentReward.screenShake,
                        })
                      }
                      className={`flex w-full items-center justify-between rounded border p-2 text-xs font-bold transition-all ${
                        currentReward.screenShake
                          ? 'border-rose-500 bg-rose-950/30 text-rose-300'
                          : 'border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] text-[color:var(--cb-mut)]'
                      }`}
                    >
                      <span>Sacudida física con GSAP</span>
                      <span>{currentReward.screenShake ? 'ACTIVADA' : 'DESACTIVADA'}</span>
                    </button>
                  </div>

                  <div>
                    <label className="cab-caps mb-1 block text-[11px] font-bold text-[color:var(--cb-mut)]">
                      Sonido de Chime Complementario
                    </label>
                    <select
                      value={currentReward.soundType}
                      onChange={(e) =>
                        updateRewardItem(currentReward.id, {
                          soundType: e.target.value as AlertSoundType,
                        })
                      }
                      className="cab-inp text-xs font-bold"
                    >
                      {SOUND_PRESETS.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Audio Personalizado (.mp3, .wav, .ogg, máx 30s) */}
                <div className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-3.5">
                  <div className="flex items-center justify-between">
                    <span className="cab-caps text-xs font-bold text-[color:var(--cb-fg)]">
                      AUDIO PERSONALIZADO / FANFARRIA
                    </span>
                    <span className="text-[10px] font-bold text-[color:var(--ui,#9146ff)]">
                      MP3 / WAV / OGG (máx 30s)
                    </span>
                  </div>

                  {audioError && (
                    <div className="mt-2.5 flex items-center gap-2 rounded border border-rose-500/40 bg-rose-950/40 p-2 text-xs font-bold text-rose-300">
                      <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
                      <span>{audioError}</span>
                    </div>
                  )}

                  {currentReward.customAudioUrl ? (
                    <div className="mt-2.5 rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-panel)] p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 truncate text-xs">
                          <Volume2 className="h-4 w-4 shrink-0 text-emerald-400" />
                          <span className="cab-mono truncate font-bold text-[color:var(--cb-fg)]">
                            {currentReward.customAudioName || 'fanfarria_recompensa.mp3'}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            className="cab-btn2 !h-6 !px-2 !text-[11px] transition-transform active:scale-[0.97]"
                            onClick={() =>
                              playCustomAudio(
                                currentReward.customAudioUrl,
                                currentReward.customAudioVolume ?? currentReward.volume ?? 0.85
                              )
                            }
                            title="Escuchar audio"
                          >
                            <Play className="h-2.5 w-2.5 fill-current text-emerald-400" />
                            <span>Escuchar</span>
                          </button>

                          <button
                            type="button"
                            className="cab-btn2 !h-6 !px-2 !text-[11px] text-amber-400 transition-transform active:scale-[0.97]"
                            onClick={() => openMediaVault('audio', 'audio')}
                            title="Cambiar desde la Biblioteca"
                          >
                            <FolderOpen className="h-3 w-3" />
                            <span>Cambiar</span>
                          </button>

                          <button
                            type="button"
                            className="cab-btn2 !h-6 !px-2 !text-[11px] text-rose-400 hover:text-rose-300 transition-transform active:scale-[0.97]"
                            onClick={() =>
                              updateRewardItem(currentReward.id, {
                                customAudioUrl: undefined,
                                customAudioName: undefined,
                              })
                            }
                            title="Quitar audio"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>

                      {/* Control de volumen de audio de la recompensa */}
                      <div className="mt-2.5 border-t border-[color:var(--cb-line)]/50 pt-2">
                        <div className="flex items-center justify-between text-[11px] text-[color:var(--cb-mut)]">
                          <span>Volumen de Reproducción</span>
                          <span className="cab-mono font-bold text-[color:var(--cb-fg)]">
                            {Math.round(
                              (currentReward.customAudioVolume ?? currentReward.volume ?? 0.85) *
                                100
                            )}
                            %
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={
                            currentReward.customAudioVolume ?? currentReward.volume ?? 0.85
                          }
                          onChange={(e) =>
                            updateRewardItem(currentReward.id, {
                              customAudioVolume: parseFloat(e.target.value),
                            })
                          }
                          className="cab-range mt-1 w-full cursor-pointer"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => openMediaVault('audio', 'audio')}
                        className="flex items-center justify-center gap-2 rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-panel)] p-3 text-xs font-bold text-[color:var(--cb-fg)] transition-all hover:border-[color:var(--ui,#9146ff)] active:scale-[0.97]"
                      >
                        <FolderOpen className="h-4 w-4 text-[color:var(--ui,#9146ff)]" />
                        <span>Explorar Biblioteca (Vault)</span>
                      </button>

                      <label className="flex cursor-pointer items-center justify-center gap-2 rounded border border-dashed border-[color:var(--cb-line)] bg-[color:var(--cb-panel)] p-3 text-xs font-bold text-[color:var(--cb-fg)] transition-colors hover:border-[color:var(--cb-fg)] active:scale-[0.97]">
                        <Upload className="h-4 w-4 text-emerald-400" />
                        <span>Subir Audio (máx 30s)</span>
                        <input
                          type="file"
                          accept="audio/mp3,audio/wav,audio/ogg,audio/mpeg,audio/webm,audio/m4a"
                          onChange={handleCustomAudioUpload}
                          className="hidden"
                        />
                      </label>
                    </div>
                  )}
                </div>

                {/* Configuración de Avisos y Texto */}
                <div className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-3.5">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="cab-caps text-xs font-bold text-[color:var(--cb-fg)]">
                      AVISO DE TEXTO EN PANTALLA
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        updateRewardItem(currentReward.id, {
                          showNoticeText: !currentReward.showNoticeText,
                        })
                      }
                      className="text-[10px] font-bold text-amber-400 hover:underline"
                    >
                      {currentReward.showNoticeText ? 'Desactivar texto' : 'Activar texto'}
                    </button>
                  </div>

                  {currentReward.showNoticeText && (
                    <div className="grid gap-3">
                      <div>
                        <label className="cab-caps mb-1 block text-[11px] font-bold text-[color:var(--cb-mut)]">
                          Plantilla del Aviso (Variables: {'{user}'}, {'{reward}'}, {'{message}'})
                        </label>
                        <input
                          type="text"
                          value={currentReward.noticeTemplate}
                          onChange={(e) =>
                            updateRewardItem(currentReward.id, {
                              noticeTemplate: e.target.value,
                            })
                          }
                          className="cab-inp text-xs font-bold"
                        />
                      </div>

                      {/* Selector de Color de Acento */}
                      <div>
                        <label className="cab-caps mb-1.5 block text-[11px] font-bold text-[color:var(--cb-mut)]">
                          Color de Acento del Aviso
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {ACCENTS.map((a) => {
                            const isSel = currentReward.accentColor === a.color;
                            return (
                              <button
                                key={a.color}
                                type="button"
                                onClick={() =>
                                  updateRewardItem(currentReward.id, {
                                    accentColor: a.color,
                                  })
                                }
                                className={`flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-bold transition-all ${
                                  isSel
                                    ? 'border-white bg-black/60 text-white'
                                    : 'border-[color:var(--cb-line)] bg-[color:var(--cb-panel)] text-[color:var(--cb-mut)]'
                                }`}
                              >
                                <span
                                  className="h-2.5 w-2.5 rounded-full"
                                  style={{ backgroundColor: a.color }}
                                />
                                <span>{a.name}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}
        </div>

        {/* Modal de Biblioteca de Medios (Media Vault) */}
        <MediaLibraryModal
          isOpen={isMediaModalOpen}
          onClose={() => setIsMediaModalOpen(false)}
          onSelect={handleMediaModalSelect}
          allowedTypes={[mediaModalType]}
          title={
            mediaModalType === 'audio'
              ? 'Media Vault · Seleccionar o Subir Audio para Recompensa (máx 30s)'
              : 'Media Vault · Seleccionar o Subir Video Transparente para Recompensa'
          }
        />
      </div>
    </div>
  );
};
