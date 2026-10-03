/**
 * src/pages/GoalsStudio.tsx
 *
 * Estudio de Metas Comunitarias & Marcadores en Vivo (Sub Goals, Follower Goals, Bit Goals).
 * Diseñado con estética de hardware Cabina Broadcast, física de barras de progreso con GSAP,
 * efectos de confeti, video transparente de victoria, sacudida de pantalla sísmica y fanfarrias personalizadas.
 */

import React, { useRef, useState, useEffect } from 'react';
import gsap from 'gsap';
import {
  Check,
  Copy,
  ExternalLink,
  Flame,
  FolderOpen,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Tv,
  Upload,
  Users,
  Video,
  Volume2,
  Zap,
  AlertCircle,
  LayoutGrid,
} from 'lucide-react';
import { SuiteNav } from '../components/SuiteNav';
import { useGoalsSettings } from '../hooks/useGoalsSettings';
import {
  CommunityGoalItem,
  GoalStyle,
  GoalType,
  GoalsDisplayMode,
  calculateGoalProgress,
  shouldDisplayAsSlideshow,
} from '../types/goals';
import { AlertSoundType } from '../types/alerts';
import { playAlertOrCustomSound, playCustomAudio } from '../utils/alertsAudio';
import { postBus } from '../utils/bus';
import { MediaLibraryModal } from '../components/MediaLibraryModal';
import { GoalsOverlayView } from '../components/goals/GoalsOverlayView';
import {
  MediaItem,
  MediaType,
  inspectAudioFile,
  MAX_AUDIO_DURATION_SECONDS,
} from '../types/mediaLibrary';
import { GuidedTour, TourStep, isTourDone } from '../components/GuidedTour';

const TOUR_ID = 'metas';

const GOALS_TOUR_STEPS: TourStep[] = [
  {
    badge: 'Bienvenida',
    title: 'Estudio de Metas & Marcadores en Pantalla',
    body: (
      <>
        Bienvenido al Estudio de Metas Comunitarias. Diseña barras de progreso reactivas para Suscriptores, Seguidores y Bits con física fluida GSAP, celebraciones épicas de victoria al 100%, lluvia de confeti y anuncios TTS en tiempo real.
      </>
    ),
  },
  {
    target: 'goals-monitor',
    badge: 'Previsualización',
    title: 'Monitor 16:9 y Simulador en Vivo',
    body: 'El monitor simula en tiempo real lo que verán tus espectadores en OBS. Incluye controles de avance rápido (+1, +5, +25), reseteo y el botón para probar la celebración del 100%.',
  },
  {
    target: 'goals-mode',
    badge: 'Diseño Inteligente',
    title: 'Modos de Visualización & Carrusel Rotativo',
    body: 'Hasta 4 metas se muestran comprimidas en fila horizontal sin estorbar tu pantalla. Al llegar a 5 o más metas, el sistema activa automáticamente el Carrusel Rotativo con transiciones fluidas de GSAP.',
  },
  {
    target: 'goals-list',
    badge: 'Gestión',
    title: 'Lista de Metas Activas',
    body: 'Crea nuevas metas para cualquier métrica (Subs, Followers, Bits). Puedes pausar, activar o seleccionar cualquier meta para personalizarla en el inspector.',
  },
  {
    target: 'goals-appearance',
    badge: 'Personalización',
    title: 'Estilos Visuales & Color de Acento',
    body: 'Elige entre 4 estilos profesionales (Cabina Broadcast, Neón Glow, Cyberpunk o Minimalista) y ajusta la paleta de color para sincronizarla con la estética de tu stream.',
  },
  {
    target: 'goals-celebration',
    badge: 'Acción del Sistema',
    title: 'Celebración de Victoria (100% Milestone)',
    body: 'Cuando la comunidad completa la meta, el sistema desata la fiesta: lluvia de confeti en canvas, sacudida sísmica de pantalla (Screen Shake), video transparente WebM en pantalla completa y tu fanfarria MP3 favorita.',
  },
  {
    target: 'goals-obs',
    badge: 'Acción del Sistema',
    title: 'Fuente de Navegador para OBS Studio',
    body: 'Copia el enlace del widget de metas y pégalo como Fuente de Navegador en tu escena (1920 × 1080 o el área que prefieras). Se sincronizará en tiempo real con cada sub, follow o bit.',
  },
];

const ACCENTS = [
  { color: '#9146ff', name: 'Morado Twitch' },
  { color: '#00f5ff', name: 'Cian Neón' },
  { color: '#ffd700', name: 'Oro Puro' },
  { color: '#53fc18', name: 'Verde Radiactivo' },
  { color: '#ff2d46', name: 'Rojo Carmesí' },
  { color: '#ff6b4a', name: 'Coral Radiante' },
];

const STYLE_OPTIONS: { id: GoalStyle; name: string; desc: string }[] = [
  { id: 'cabina', name: 'Cabina Broadcast', desc: 'Chasis industrial con marcas de calibración LED' },
  { id: 'neon', name: 'Neón Glow', desc: 'Haz de plasma intenso con resplandor energético' },
  { id: 'cyber', name: 'Cyberpunk', desc: 'Bordes biselados y estética futurista' },
  { id: 'minimal', name: 'Minimalista', desc: 'Cápsula sobria de alto contraste' },
];

const SOUND_PRESETS: { id: AlertSoundType; name: string }[] = [
  { id: 'retro-fanfare', name: 'Fanfarria Retro Victoria' },
  { id: 'arcade-chime', name: 'Chime Arcade 16-bit' },
  { id: 'synth-bell', name: 'Campana Synth' },
  { id: 'soft-pop', name: 'Pop Cálido' },
  { id: 'none', name: 'Sin sonido' },
];

const DISPLAY_MODES: { id: GoalsDisplayMode; name: string; desc: string }[] = [
  {
    id: 'auto_4_or_slideshow',
    name: 'Automático (≤4 Fila, 5+ Carrusel)',
    desc: 'Hasta 4 metas se muestran en fila comprimida. Al llegar a 5 o más, pasa automáticamente a Carrusel rotativo con GSAP.',
  },
  {
    id: 'slideshow_only',
    name: 'Carrusel Continuo (Slideshow)',
    desc: 'Muestra una meta a la vez con transiciones continuas de GSAP y barra de temporizador.',
  },
  {
    id: 'row_only',
    name: 'Fila Simultánea Siempre',
    desc: 'Muestra todas las metas en horizontal adaptativo con compresión visual.',
  },
  {
    id: 'reactive_progress',
    name: 'Aparición Reactiva (Progreso)',
    desc: 'Destaca y enfoca automáticamente la meta que reciba donaciones o puntos en tiempo real.',
  },
  {
    id: 'single_active',
    name: 'Meta Única Seleccionada',
    desc: 'Muestra únicamente la meta activa seleccionada en el inspector.',
  },
];

export const GoalsStudio: React.FC = () => {
  const {
    goalsSettings,
    activeGoal,
    saved,
    updateSettings,
    updateGoalItem,
    addGoalItem,
    deleteGoalItem,
    setActiveGoalId,
    incrementGoal,
    resetGoal,
  } = useGoalsSettings();

  const [copiedUrl, setCopiedUrl] = useState(false);
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [recentProgressGoalId, setRecentProgressGoalId] = useState<string | null>(null);
  const [tourOpen, setTourOpen] = useState(false);

  // La guía se abre sola la primera vez; después se accede desde el botón en la cabecera
  useEffect(() => {
    if (isTourDone(TOUR_ID)) return;
    const timer = setTimeout(() => setTourOpen(true), 600);
    return () => clearTimeout(timer);
  }, []);

  // Modal de Biblioteca de Medios (Media Vault)
  const [isMediaModalOpen, setIsMediaModalOpen] = useState(false);
  const [mediaModalType, setMediaModalType] = useState<MediaType>('video');
  const [mediaModalTarget, setMediaModalTarget] = useState<'video' | 'audio'>('video');
  const [monitorVideoActive, setMonitorVideoActive] = useState<string | null>(null);
  const [confettiActive, setConfettiActive] = useState(false);

  const monitorStageRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const pct = calculateGoalProgress(activeGoal.current, activeGoal.target);
  const isCompleted = activeGoal.current >= activeGoal.target;

  // Animación física fluida de la barra de progreso con GSAP
  useEffect(() => {
    if (!progressBarRef.current) return;
    gsap.to(progressBarRef.current, {
      width: `${pct}%`,
      duration: 0.5,
      ease: 'power2.out',
    });
  }, [pct]);

  // Efecto de lluvia de confeti en el monitor
  useEffect(() => {
    if (!confettiActive || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const particles = Array.from({ length: 65 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * -canvas.height,
      vx: (Math.random() - 0.5) * 4,
      vy: Math.random() * 4 + 3,
      size: Math.random() * 6 + 4,
      color: ['#9146ff', '#00f5ff', '#ffd700', '#53fc18', '#ff2d46', '#ffffff'][
        Math.floor(Math.random() * 6)
      ],
      rotation: Math.random() * 360,
      vRot: (Math.random() - 0.5) * 10,
    }));

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.vRot;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      });
      animId = requestAnimationFrame(render);
    };

    render();

    const timer = setTimeout(() => {
      cancelAnimationFrame(animId);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setConfettiActive(false);
    }, 4500);

    return () => {
      cancelAnimationFrame(animId);
      clearTimeout(timer);
    };
  }, [confettiActive]);

  // Disparar celebración de meta completada (100% Milestone)
  const triggerCelebrationTest = () => {
    // 1. Audio / Fanfarria
    playAlertOrCustomSound(
      activeGoal.victoryCustomAudioUrl,
      activeGoal.victorySoundType || 'retro-fanfare',
      activeGoal.victoryCustomAudioVolume ?? 0.85
    );

    // 2. Confeti en el monitor
    if (activeGoal.confetti !== false) {
      setConfettiActive(true);
    }

    // 3. Screen Shake sísmico con GSAP
    if (activeGoal.victoryScreenShake && monitorStageRef.current) {
      gsap.fromTo(
        monitorStageRef.current,
        { x: -16, y: 12, rotate: -1 },
        {
          x: 0,
          y: 0,
          rotate: 0,
          duration: 0.75,
          ease: 'elastic.out(1.2, 0.18)',
          clearProps: 'transform',
        }
      );
    }

    // 4. Video de victoria transparente en el monitor
    if (activeGoal.victoryVideoUrl) {
      setMonitorVideoActive(activeGoal.victoryVideoUrl);
      setTimeout(() => setMonitorVideoActive(null), 5500);
    } else {
      setMonitorVideoActive(null);
    }

    // 5. Enviar celebración a OBS Studio por Bus
    postBus({
      type: 'GOAL_CELEBRATE',
      celebration: {
        goalId: activeGoal.id,
        title: activeGoal.title,
        victoryVideoUrl: activeGoal.victoryVideoUrl,
        victoryBlendMode: activeGoal.victoryBlendMode || 'transparent',
        victoryCustomAudioUrl: activeGoal.victoryCustomAudioUrl,
        victoryCustomAudioVolume: activeGoal.victoryCustomAudioVolume ?? 0.85,
        victorySoundType: activeGoal.victorySoundType,
        screenShake: activeGoal.victoryScreenShake,
        confetti: activeGoal.confetti,
        duration: 6,
      },
    });

    setTestStatus(`¡Celebración del 100% de «${activeGoal.title}» enviada a OBS y monitor!`);
    setTimeout(() => setTestStatus(null), 3500);
  };

  const openMediaVault = (type: MediaType, target: 'video' | 'audio') => {
    setMediaModalType(type);
    setMediaModalTarget(target);
    setIsMediaModalOpen(true);
  };

  const handleMediaModalSelect = (item: MediaItem) => {
    setIsMediaModalOpen(false);
    if (!activeGoal) return;
    if (mediaModalTarget === 'video') {
      updateGoalItem(activeGoal.id, {
        victoryVideoUrl: item.url,
        victoryVideoName: item.name,
        victoryBlendMode: item.format === 'webm' ? 'transparent' : 'screen',
      });
      setTestStatus(`¡Video «${item.name}» asignado desde la Biblioteca!`);
    } else {
      updateGoalItem(activeGoal.id, {
        victoryCustomAudioUrl: item.url,
        victoryCustomAudioName: item.name,
        victoryCustomAudioVolume: activeGoal.victoryCustomAudioVolume ?? 0.85,
      });
      setTestStatus(`¡Fanfarria «${item.name}» (${item.duration}s) asignada desde la Biblioteca!`);
    }
    setTimeout(() => setTestStatus(null), 3000);
  };

  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeGoal) return;
    try {
      setAudioError(null);
      const { dataUrl, duration } = await inspectAudioFile(file);
      updateGoalItem(activeGoal.id, {
        victoryCustomAudioUrl: dataUrl,
        victoryCustomAudioName: file.name,
        victoryCustomAudioVolume: activeGoal.victoryCustomAudioVolume ?? 0.85,
      });
      setTestStatus(`¡Fanfarria «${file.name}» (${duration}s) validada y cargada!`);
      setTimeout(() => setTestStatus(null), 3000);
    } catch (err: any) {
      setAudioError(err?.message || `El audio supera el límite de ${MAX_AUDIO_DURATION_SECONDS}s.`);
      setTimeout(() => setAudioError(null), 6000);
    }
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (uploadEv) => {
      const res = uploadEv.target?.result as string;
      const isWebM = file.name.toLowerCase().endsWith('.webm');
      updateGoalItem(activeGoal.id, {
        victoryVideoUrl: res,
        victoryVideoName: file.name,
        victoryBlendMode: isWebM ? 'transparent' : 'screen',
      });
      setTestStatus(`¡Video de victoria «${file.name}» asignado a la meta!`);
      setTimeout(() => setTestStatus(null), 3000);
    };
    reader.readAsDataURL(file);
  };

  const handleCreateNew = () => {
    const newId = `goal-${Date.now()}`;
    const newGoal: CommunityGoalItem = {
      id: newId,
      type: 'subs',
      title: 'Nueva Meta Comunitaria',
      current: 0,
      target: 50,
      unit: 'subs',
      enabled: true,
      style: 'cabina',
      accentColor: '#9146ff',
      showPercentage: true,
      showNumbers: true,
      celebrateOnComplete: true,
      victorySoundType: 'retro-fanfare',
      victoryScreenShake: true,
      confetti: true,
    };
    addGoalItem(newGoal);
  };

  const handleSimulateAdvance = (delta: number) => {
    setRecentProgressGoalId(activeGoal.id);
    incrementGoal(activeGoal.id, delta, 'Comunidad');
    setTestStatus(`¡Avance de +${delta} en «${activeGoal.title}»! (Progreso sincronizado y anunciado)`);
    setTimeout(() => {
      setRecentProgressGoalId(null);
      setTestStatus(null);
    }, 3500);
  };

  const handleAddFifthGoalTest = () => {
    const count = goalsSettings.goals.length + 1;
    const newGoal: CommunityGoalItem = {
      id: `goal-test-${Date.now()}`,
      type: 'bits',
      title: `Meta Comunitaria #${count}: ¡Hype de Stream!`,
      current: 45,
      target: 100,
      unit: 'bits',
      enabled: true,
      style: 'cyber',
      accentColor: '#00f5ff',
      showPercentage: true,
      showNumbers: true,
      celebrateOnComplete: true,
      victorySoundType: 'arcade-chime',
      victoryScreenShake: true,
      confetti: true,
    };
    addGoalItem(newGoal);
    setTestStatus('¡Meta agregada! Con 5 o más metas, el sistema pasa automáticamente a Carrusel Rotativo GSAP.');
    setTimeout(() => setTestStatus(null), 4500);
  };

  const widgetUrl = `${window.location.origin}/#widget?channel=${encodeURIComponent(
    goalsSettings.channel
  )}&app=goals`;

  const copyWidgetUrl = () => {
    navigator.clipboard.writeText(widgetUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2500);
  };

  const rootStyle = {
    '--acc': activeGoal.accentColor,
    '--acc-ink': '#ffffff',
  } as React.CSSProperties;

  return (
    <div className="cab" style={{ ...rootStyle, paddingBottom: tourOpen ? 220 : undefined }}>
      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-6">
        {/* Barra de navegación de la suite */}
        <SuiteNav
          currentApp="metas"
          channel={goalsSettings.channel}
          saved={saved}
          onOpenTour={() => setTourOpen(true)}
          tourAvailable={!tourOpen}
        />

        {/* Encabezado del Módulo */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[color:var(--cb-line)] pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-black text-black">
                MÓDULO 5
              </span>
              <span className="cab-caps text-xs text-[color:var(--cb-mut)]">
                MARCADORES & METAS COMUNITARIAS
              </span>
            </div>
            <h1
              className="cab-caps mt-1 text-2xl font-extrabold"
              style={{ fontStretch: '70%', fontWeight: 800 }}
            >
              Estudio de Metas & Marcadores en Pantalla
            </h1>
            <p className="mt-1 text-xs text-[color:var(--cb-mut)]">
              Crea barras de progreso para Suscriptores, Seguidores y Bits con física fluida GSAP,
              lluvia de confeti, videos transparentes y fanfarrias personalizadas de victoria al 100%.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2" data-tour="goals-obs">
            <button
              type="button"
              className="cab-btn2 !h-8 !px-3 !text-xs font-bold transition-transform active:scale-[0.97]"
              onClick={copyWidgetUrl}
              title="Copiar URL para OBS Browser Source"
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
              className="cab-btn2 !h-8 !px-3 !text-xs font-bold no-underline transition-transform active:scale-[0.97]"
              title="Abrir vista de overlay en pestaña nueva"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span>Ver Overlay</span>
            </a>
          </div>
        </header>

        {testStatus && (
          <div className="flex items-center gap-2 rounded border border-amber-500/40 bg-amber-950/40 px-3 py-2 text-xs font-bold text-amber-300">
            <Check className="h-4 w-4 text-amber-400" />
            <span>{testStatus}</span>
          </div>
        )}

        {/* MONITOR EN VIVO 16:9 */}
        <section aria-label="Monitor de simulación de meta" data-tour="goals-monitor">
          <div className="flex items-center justify-between pb-2">
            <div className="flex items-center gap-2">
              <Tv className="h-4 w-4 text-[color:var(--cb-mut)]" />
              <span className="cab-caps text-xs font-extrabold text-[color:var(--cb-fg)]">
                MONITOR DE ESCENARIO 16:9 (VISTA PREVIA OBS)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="cab-mono text-xs font-bold text-[color:var(--cb-fg)]">
                {pct}% COMPLETADO
              </span>
              {isCompleted && (
                <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-black text-emerald-400">
                  ¡META ALCANZADA!
                </span>
              )}
            </div>
          </div>

          <div
            ref={monitorStageRef}
            className="relative flex min-h-[300px] w-full flex-col items-center justify-center overflow-hidden rounded-lg border border-[color:var(--cb-line)] shadow-2xl"
            style={{
              background: 'radial-gradient(ellipse at 50% 40%, #171922 0%, #0a0b0e 100%)',
            }}
          >
            {/* Rejilla técnica broadcast */}
            <div
              className="pointer-events-none absolute inset-0 opacity-10"
              style={{
                backgroundImage:
                  'linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)',
                backgroundSize: '32px 32px',
              }}
            />

            {/* Canvas de Confeti */}
            <canvas
              ref={canvasRef}
              width={800}
              height={300}
              className="pointer-events-none absolute inset-0 z-20 h-full w-full"
            />

            {/* Video transparente de victoria si está activo */}
            {monitorVideoActive && (
              <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center p-4">
                <video
                  src={monitorVideoActive}
                  autoPlay
                  playsInline
                  muted={false}
                  className="max-h-56 w-auto rounded object-contain drop-shadow-2xl"
                  style={{
                    mixBlendMode:
                      activeGoal.victoryBlendMode === 'screen' ? 'screen' : 'normal',
                  }}
                />
              </div>
            )}

            {/* VISTA MULTI-META CON COMPRESIÓN (≤4 EN FILA) O CARRUSEL (5+) */}
            <div className="relative z-10 w-full py-6">
              <GoalsOverlayView
                goals={goalsSettings.goals}
                activeGoalId={activeGoal.id}
                displayMode={goalsSettings.displayMode}
                slideshowIntervalSec={goalsSettings.slideshowIntervalSec}
                recentProgressGoalId={recentProgressGoalId}
                onSelectGoal={(id) => setActiveGoalId(id)}
                isStudio={true}
              />
            </div>

            {/* Barra de control rápido de prueba en el monitor */}
            <div className="absolute bottom-3 left-4 right-4 z-10 flex flex-wrap items-center justify-between gap-2 rounded bg-black/75 px-3 py-2 backdrop-blur">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="cab-caps text-[10px] font-bold text-[color:var(--cb-mut)]">
                  AVANCE EN «{activeGoal.title.slice(0, 18)}...»:
                </span>
                <button
                  type="button"
                  onClick={() => handleSimulateAdvance(1)}
                  className="cab-btn2 !h-6 !px-2 !text-[11px] font-bold transition-transform active:scale-[0.97]"
                  title="Sumar +1 a la meta seleccionada y generar locución TTS"
                >
                  +1
                </button>
                <button
                  type="button"
                  onClick={() => handleSimulateAdvance(5)}
                  className="cab-btn2 !h-6 !px-2 !text-[11px] font-bold transition-transform active:scale-[0.97]"
                  title="Sumar +5 a la meta seleccionada y generar locución TTS"
                >
                  +5
                </button>
                <button
                  type="button"
                  onClick={() => handleSimulateAdvance(25)}
                  className="cab-btn2 !h-6 !px-2 !text-[11px] font-bold transition-transform active:scale-[0.97]"
                  title="Sumar +25 a la meta seleccionada y generar locución TTS"
                >
                  +25
                </button>
                <button
                  type="button"
                  onClick={() => resetGoal(activeGoal.id)}
                  className="cab-btn2 !h-6 !px-2 !text-[11px] text-rose-400 hover:text-rose-300 transition-transform active:scale-[0.97]"
                  title="Reiniciar contador a 0"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>0</span>
                </button>

                <button
                  type="button"
                  onClick={handleAddFifthGoalTest}
                  className="cab-btn2 !h-6 !px-2.5 !text-[10px] text-amber-300 border-amber-500/40 hover:bg-amber-950/40 font-bold transition-transform active:scale-[0.97]"
                  title="Añadir una meta para probar la transición automática al Carrusel Rotativo de 5 metas"
                >
                  <Plus className="h-3 w-3 text-amber-400" />
                  <span>Probar Umbral 5+ Metas</span>
                </button>
              </div>

              <button
                type="button"
                onClick={triggerCelebrationTest}
                className="cab-btn !h-7 !px-3 text-xs font-black transition-transform active:scale-[0.97]"
                style={{
                  background: 'linear-gradient(135deg, #ffd700, #ff8800)',
                  color: '#000000',
                }}
              >
                <Sparkles className="h-3.5 w-3.5 fill-current" />
                <span>¡Probar Celebración 100%!</span>
              </button>
            </div>
          </div>
        </section>

        {/* PANEL DE MODO DE VISUALIZACIÓN & ANUNCIOS TTS */}
        <section className="cab-mod p-4" aria-label="Modo de Visualización y Anuncios" data-tour="goals-mode">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[color:var(--cb-line)] pb-3">
            <div>
              <div className="flex items-center gap-2">
                <LayoutGrid className="h-4 w-4 text-amber-400" />
                <h2 className="cab-caps text-sm font-extrabold text-[color:var(--cb-fg)]">
                  Modo de Visualización en Pantalla & Anuncios de Voz TTS
                </h2>
              </div>
              <p className="cab-hint text-xs">
                Configura cómo se presentan múltiples metas en OBS y si se anuncian los avances y los hitos clave (25%, 50%, 75%, 100%).
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="cab-mono text-xs text-[color:var(--cb-mut)]">
                {goalsSettings.goals.filter((g) => g.enabled).length} metas activas
              </span>
              {shouldDisplayAsSlideshow(
                goalsSettings.goals.filter((g) => g.enabled).length,
                goalsSettings.displayMode
              ) ? (
                <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-black text-amber-400">
                  Modo: Carrusel Rotativo (5+ Metas con GSAP)
                </span>
              ) : (
                <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-black text-emerald-400">
                  Modo: En Fila (≤4 Metas Comprimidas)
                </span>
              )}
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-12">
            {/* Opciones de Modo (7 cols) */}
            <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {DISPLAY_MODES.map((mode) => {
                const isSelected = goalsSettings.displayMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => updateSettings({ displayMode: mode.id })}
                    className={`flex flex-col items-start rounded-lg border p-3 text-left transition-all active:scale-[0.97] ${
                      isSelected
                        ? 'border-amber-400 bg-amber-950/20 ring-1 ring-amber-400'
                        : 'border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] hover:bg-[color:var(--cb-panel)]'
                    }`}
                  >
                    <div className="flex w-full items-center justify-between">
                      <span className="cab-caps text-xs font-bold text-[color:var(--cb-fg)]">
                        {mode.name}
                      </span>
                      {isSelected && <Check className="h-3.5 w-3.5 text-amber-400" />}
                    </div>
                    <span className="mt-1 text-[11px] leading-relaxed text-[color:var(--cb-mut)]">
                      {mode.desc}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Ajustes de Intervalo y Anuncios TTS (5 cols) */}
            <div className="lg:col-span-5 flex flex-col justify-between gap-3 rounded-lg border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-3.5">
              <div>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-[color:var(--cb-fg)]">
                    Rotación Carrusel (Slideshow)
                  </span>
                  <span className="cab-mono text-amber-400 font-bold">
                    {goalsSettings.slideshowIntervalSec} seg
                  </span>
                </div>
                <input
                  type="range"
                  min={3}
                  max={30}
                  step={1}
                  value={goalsSettings.slideshowIntervalSec}
                  onChange={(e) => updateSettings({ slideshowIntervalSec: Number(e.target.value) })}
                  className="mt-2 w-full accent-amber-400"
                />
              </div>

              <div className="grid gap-2 border-t border-[color:var(--cb-line)] pt-3 text-xs">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={goalsSettings.announceProgress}
                    onChange={(e) => updateSettings({ announceProgress: e.target.checked })}
                    className="h-4 w-4 rounded accent-amber-400"
                  />
                  <span className="font-bold text-[color:var(--cb-fg)]">
                    Anunciar avances (+puntos/subs) con voz TTS
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={goalsSettings.announceMilestones}
                    onChange={(e) => updateSettings({ announceMilestones: e.target.checked })}
                    className="h-4 w-4 rounded accent-amber-400"
                  />
                  <span className="font-bold text-[color:var(--cb-fg)]">
                    Anunciar hitos clave (25%, 50%, 75%, 100%)
                  </span>
                </label>
              </div>
            </div>
          </div>
        </section>

        {/* LAYOUT PRINCIPAL: 2 COLUMNAS (Lista de Metas & Inspector de Personalización) */}
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Columna Izquierda: Lista de Metas (5 columnas) */}
          <section className="cab-mod lg:col-span-5" aria-label="Lista de Metas Comunitarias" data-tour="goals-list">
            <div className="flex items-center justify-between border-b border-[color:var(--cb-line)] pb-3">
              <div>
                <h2>
                  <span>1</span>Tus Metas Activas
                </h2>
                <p className="cab-hint text-xs">
                  Selecciona la meta a mostrar u organiza múltiples marcadores simultáneos.
                </p>
              </div>

              <button
                type="button"
                className="cab-btn2 !h-7 !px-2.5 !text-xs font-bold transition-transform active:scale-[0.97]"
                onClick={handleCreateNew}
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Nueva Meta</span>
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              {goalsSettings.goals.map((g) => {
                const isSel = g.id === activeGoal.id;
                const gPct = calculateGoalProgress(g.current, g.target);

                return (
                  <article
                    key={g.id}
                    onClick={() => setActiveGoalId(g.id)}
                    className={`cursor-pointer rounded-lg border p-3.5 transition-all ${
                      isSel
                        ? 'border-[color:var(--cb-fg)] bg-[color:var(--cb-panel)] shadow-md'
                        : 'border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] opacity-80 hover:opacity-100'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="flex h-8 w-8 items-center justify-center rounded-lg font-bold text-white shadow"
                          style={{ backgroundColor: g.accentColor }}
                        >
                          {g.type === 'subs' && <Flame className="h-4 w-4" />}
                          {g.type === 'followers' && <Users className="h-4 w-4" />}
                          {g.type === 'bits' && <Zap className="h-4 w-4" />}
                        </div>

                        <div>
                          <h3 className="cab-caps text-xs font-extrabold text-[color:var(--cb-fg)]">
                            {g.title}
                          </h3>
                          <span className="cab-mono text-[11px] text-[color:var(--cb-mut)]">
                            {g.current} / {g.target} {g.unit} ({gPct}%)
                          </span>
                        </div>
                      </div>

                      <span
                        className="rounded px-2 py-0.5 text-[10px] font-black uppercase"
                        style={{
                          backgroundColor: `${g.accentColor}25`,
                          color: g.accentColor,
                        }}
                      >
                        {g.type}
                      </span>
                    </div>

                    <div className="mt-2.5 flex items-center justify-between border-t border-[color:var(--cb-line)]/50 pt-2 text-[10px] text-[color:var(--cb-mut)]">
                      <div className="flex items-center gap-1.5">
                        <span className="rounded bg-[color:var(--cb-bg)] px-1.5 py-0.5 font-bold uppercase">
                          {g.style}
                        </span>
                        {g.victoryVideoUrl && (
                          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-bold text-amber-300">
                            Video Victoria
                          </span>
                        )}
                        {g.victoryCustomAudioUrl && (
                          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-bold text-emerald-300">
                            Fanfarria MP3
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <label
                          className="flex items-center gap-1.5 cursor-pointer text-[10px] font-bold"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={g.enabled}
                            onChange={(e) => updateGoalItem(g.id, { enabled: e.target.checked })}
                            className="h-3.5 w-3.5 rounded accent-amber-400"
                          />
                          <span className={g.enabled ? 'text-emerald-400' : 'text-neutral-400'}>
                            {g.enabled ? 'Activa' : 'Pausada'}
                          </span>
                        </label>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveGoalId(g.id);
                          }}
                          className="cab-btn2 !h-5 !px-2 !text-[10px] font-bold"
                        >
                          {isSel ? 'Seleccionada' : 'Editar'}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          {/* Columna Derecha: Inspector & Configuración de la Meta (7 columnas) */}
          <section className="cab-mod lg:col-span-7" aria-label={`Configurar ${activeGoal.title}`}>
            <div className="flex items-center justify-between border-b border-[color:var(--cb-line)] pb-3">
              <div>
                <h2>
                  <span>2</span>Personalización & Acciones del 100%
                </h2>
                <p className="cab-hint text-xs">
                  Modifica los valores numéricos, el estilo visual y qué sucede cuando la comunidad cumple la meta.
                </p>
              </div>

              {goalsSettings.goals.length > 1 && (
                <button
                  type="button"
                  className="cab-btn2 !h-7 !px-2 text-rose-400 hover:text-rose-300 transition-transform active:scale-[0.97]"
                  onClick={() => deleteGoalItem(activeGoal.id)}
                  title="Eliminar esta meta"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Eliminar</span>
                </button>
              )}
            </div>

            <div className="mt-4 grid gap-4">
              {/* Título de la meta y Tipo */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="cab-caps mb-1 block text-[11px] font-bold text-[color:var(--cb-mut)]">
                    Título de la Meta en Pantalla
                  </label>
                  <input
                    type="text"
                    value={activeGoal.title}
                    onChange={(e) => updateGoalItem(activeGoal.id, { title: e.target.value })}
                    className="cab-inp text-xs font-bold"
                  />
                </div>

                <div>
                  <label className="cab-caps mb-1 block text-[11px] font-bold text-[color:var(--cb-mut)]">
                    Tipo de Métrica
                  </label>
                  <select
                    value={activeGoal.type}
                    onChange={(e) => {
                      const t = e.target.value as GoalType;
                      updateGoalItem(activeGoal.id, {
                        type: t,
                        unit: t === 'subs' ? 'subs' : t === 'followers' ? 'seguidores' : 'bits',
                      });
                    }}
                    className="cab-inp text-xs font-bold"
                  >
                    <option value="subs">Suscripciones (Subs)</option>
                    <option value="followers">Seguidores (Followers)</option>
                    <option value="bits">Bits (Cheering)</option>
                  </select>
                </div>
              </div>

              {/* Valores Numéricos (Actual y Meta Objetivo) */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="cab-caps mb-1 block text-[11px] font-bold text-[color:var(--cb-mut)]">
                    Progreso Actual
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={activeGoal.current}
                    onChange={(e) =>
                      updateGoalItem(activeGoal.id, {
                        current: Math.max(0, parseInt(e.target.value, 10) || 0),
                      })
                    }
                    className="cab-inp cab-mono text-xs font-bold"
                  />
                </div>

                <div>
                  <label className="cab-caps mb-1 block text-[11px] font-bold text-[color:var(--cb-mut)]">
                    Meta Objetivo (Target)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={activeGoal.target}
                    onChange={(e) =>
                      updateGoalItem(activeGoal.id, {
                        target: Math.max(1, parseInt(e.target.value, 10) || 1),
                      })
                    }
                    className="cab-inp cab-mono text-xs font-bold"
                  />
                </div>
              </div>

              {/* Estilo Visual del Marcador */}
              <div data-tour="goals-appearance">
                <label className="cab-caps mb-1.5 block text-[11px] font-bold text-[color:var(--cb-mut)]">
                  Estilo Visual del Marcador
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {STYLE_OPTIONS.map((st) => {
                    const isSel = activeGoal.style === st.id;
                    return (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => updateGoalItem(activeGoal.id, { style: st.id })}
                        className={`rounded border p-2.5 text-left transition-all active:scale-[0.97] ${
                          isSel
                            ? 'border-[color:var(--cb-fg)] bg-[color:var(--cb-panel)] font-bold text-[color:var(--cb-fg)] shadow-sm'
                            : 'border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] text-[color:var(--cb-mut)] hover:text-[color:var(--cb-fg)]'
                        }`}
                      >
                        <span className="block text-xs">{st.name}</span>
                        <span className="block text-[10px] opacity-70">{st.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Paleta de Color de Acento */}
              <div>
                <label className="cab-caps mb-1.5 block text-[11px] font-bold text-[color:var(--cb-mut)]">
                  Color de Acento de la Barra
                </label>
                <div className="flex flex-wrap gap-2">
                  {ACCENTS.map((a) => {
                    const isSel = activeGoal.accentColor === a.color;
                    return (
                      <button
                        key={a.color}
                        type="button"
                        onClick={() => updateGoalItem(activeGoal.id, { accentColor: a.color })}
                        className={`h-7 w-7 rounded-full border border-black/40 transition-transform active:scale-95 ${
                          isSel ? 'ring-2 ring-white ring-offset-2 ring-offset-black' : ''
                        }`}
                        style={{ backgroundColor: a.color }}
                        title={a.name}
                      />
                    );
                  })}
                </div>
              </div>

              {/* ACCIONES AL LOGRAR EL 100% (VICTORIA) */}
              <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-4" data-tour="goals-celebration">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-amber-400">
                    <Sparkles className="h-4 w-4" />
                    <span className="cab-caps text-xs font-black tracking-wide">
                      ACCIONES AL LOGRAR EL 100% (MILITARY CELEBRATION)
                    </span>
                  </div>
                  <span className="text-[10px] font-bold text-amber-400">
                    Disparador de Victoria
                  </span>
                </div>
                <p className="text-[11px] text-[color:var(--cb-mut)]">
                  Configura qué efectos visuales, videos transparentes y fanfarrias sonoras se
                  activarán en vivo cuando el contador de la comunidad llegue a la meta.
                </p>

                {/* Toggles: Confeti y Screen Shake */}
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() =>
                      updateGoalItem(activeGoal.id, { confetti: activeGoal.confetti === false })
                    }
                    className={`flex items-center justify-between rounded border p-2.5 text-xs font-bold transition-all active:scale-[0.97] ${
                      activeGoal.confetti !== false
                        ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                        : 'border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] text-[color:var(--cb-mut)]'
                    }`}
                  >
                    <span>Lluvia de Confeti</span>
                    <span>{activeGoal.confetti !== false ? 'ACTIVADA' : 'DESACTIVADA'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      updateGoalItem(activeGoal.id, {
                        victoryScreenShake: !activeGoal.victoryScreenShake,
                      })
                    }
                    className={`flex items-center justify-between rounded border p-2.5 text-xs font-bold transition-all active:scale-[0.97] ${
                      activeGoal.victoryScreenShake
                        ? 'border-rose-500/50 bg-rose-500/10 text-rose-300'
                        : 'border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] text-[color:var(--cb-mut)]'
                    }`}
                  >
                    <span>Sacudida Sísmica (Shake)</span>
                    <span>{activeGoal.victoryScreenShake ? 'ACTIVADA' : 'DESACTIVADA'}</span>
                  </button>
                </div>

                {/* Subida de Video de Victoria Transparente */}
                <div className="mt-3 rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-3">
                  <div className="flex items-center justify-between">
                    <span className="cab-caps text-[11px] font-bold text-[color:var(--cb-fg)]">
                      Video de Victoria Transparente (.webm alfa / .mp4)
                    </span>
                    <span className="text-[10px] text-amber-400 font-bold">
                      Aparecerá en pantalla completa
                    </span>
                  </div>

                  {activeGoal.victoryVideoUrl ? (
                    <div className="mt-2 flex items-center justify-between rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-panel)] p-2">
                      <div className="flex items-center gap-2 text-xs truncate">
                        <Video className="h-4 w-4 text-emerald-400 shrink-0" />
                        <span className="cab-mono font-bold truncate">
                          {activeGoal.victoryVideoName || 'video_victoria.webm'}
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
                          className="cab-btn2 !h-6 !px-2 !text-[11px] text-rose-400 hover:text-rose-300 transition-transform active:scale-[0.97]"
                          onClick={() =>
                            updateGoalItem(activeGoal.id, {
                              victoryVideoUrl: undefined,
                              victoryVideoName: undefined,
                            })
                          }
                        >
                          Quitar video
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => openMediaVault('video', 'video')}
                        className="flex items-center justify-center gap-2 rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-panel)] p-3 text-xs font-bold text-[color:var(--cb-fg)] transition-all hover:border-amber-400 active:scale-[0.97]"
                      >
                        <FolderOpen className="h-4 w-4 text-amber-400" />
                        <span>Biblioteca de Videos (Vault)</span>
                      </button>

                      <label className="flex cursor-pointer items-center justify-center gap-2 rounded border border-dashed border-[color:var(--cb-line)] bg-[color:var(--cb-panel)] p-3 text-xs font-bold text-[color:var(--cb-fg)] transition-colors hover:border-[color:var(--cb-fg)] active:scale-[0.97]">
                        <Upload className="h-4 w-4 text-amber-400" />
                        <span>Subir Video (.webm/.mp4)</span>
                        <input
                          type="file"
                          accept="video/webm,video/mp4"
                          onChange={handleVideoUpload}
                          className="hidden"
                        />
                      </label>
                    </div>
                  )}
                </div>

                {/* Subida de Fanfarria de Victoria Personalizada (.mp3, .wav, .ogg, máx 30s) */}
                <div className="mt-3 rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-3">
                  <div className="flex items-center justify-between">
                    <span className="cab-caps text-[11px] font-bold text-[color:var(--cb-fg)]">
                      Fanfarria Sonora de Victoria (Clip ≤ 30s)
                    </span>
                    <span className="text-[10px] text-emerald-400 font-bold">
                      Audio en vivo en OBS
                    </span>
                  </div>

                  {audioError && (
                    <div className="mt-2 flex items-center gap-2 rounded border border-rose-500/40 bg-rose-950/40 p-2 text-xs font-bold text-rose-300">
                      <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
                      <span>{audioError}</span>
                    </div>
                  )}

                  {activeGoal.victoryCustomAudioUrl ? (
                    <div className="mt-2 rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-panel)] p-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 truncate text-xs">
                          <Volume2 className="h-4 w-4 shrink-0 text-emerald-400" />
                          <span className="cab-mono truncate font-bold">
                            {activeGoal.victoryCustomAudioName || 'audio_victoria.mp3'}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            className="cab-btn2 !h-6 !px-2 !text-[11px] transition-transform active:scale-[0.97]"
                            onClick={() =>
                              playCustomAudio(
                                activeGoal.victoryCustomAudioUrl,
                                activeGoal.victoryCustomAudioVolume ?? 0.85
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
                              updateGoalItem(activeGoal.id, {
                                victoryCustomAudioUrl: undefined,
                                victoryCustomAudioName: undefined,
                              })
                            }
                            title="Quitar audio"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>

                      {/* Control de volumen de fanfarria */}
                      <div className="mt-2 border-t border-[color:var(--cb-line)]/50 pt-2">
                        <div className="flex items-center justify-between text-[11px] text-[color:var(--cb-mut)]">
                          <span>Volumen de la Fanfarria</span>
                          <span className="cab-mono font-bold text-[color:var(--cb-fg)]">
                            {Math.round((activeGoal.victoryCustomAudioVolume ?? 0.85) * 100)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={activeGoal.victoryCustomAudioVolume ?? 0.85}
                          onChange={(e) =>
                            updateGoalItem(activeGoal.id, {
                              victoryCustomAudioVolume: parseFloat(e.target.value),
                            })
                          }
                          className="cab-range mt-1 w-full cursor-pointer"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
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
                          onChange={handleAudioUpload}
                          className="hidden"
                        />
                      </label>
                    </div>
                  )}

                  {/* Fallback de Timbre Sintetizado */}
                  <div className="mt-2.5">
                    <label className="cab-caps mb-1 block text-[10px] font-bold text-[color:var(--cb-mut)]">
                      Timbre de Fallback Web Audio API
                    </label>
                    <select
                      value={activeGoal.victorySoundType}
                      onChange={(e) =>
                        updateGoalItem(activeGoal.id, {
                          victorySoundType: e.target.value as AlertSoundType,
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
              </div>
            </div>
          </section>
        </div>

        {/* Modal de Biblioteca de Medios (Media Vault) */}
        <MediaLibraryModal
          isOpen={isMediaModalOpen}
          onClose={() => setIsMediaModalOpen(false)}
          onSelect={handleMediaModalSelect}
          allowedTypes={[mediaModalType]}
          title={
            mediaModalType === 'audio'
              ? 'Media Vault · Seleccionar o Subir Fanfarria de Victoria (máx 30s)'
              : 'Media Vault · Seleccionar o Subir Video de Victoria'
          }
        />

        {/* Tutorial Guiado */}
        {tourOpen && (
          <GuidedTour
            steps={GOALS_TOUR_STEPS}
            onClose={() => setTourOpen(false)}
            id={TOUR_ID}
            appName="Metas & Marcadores"
          />
        )}
      </div>
    </div>
  );
};
