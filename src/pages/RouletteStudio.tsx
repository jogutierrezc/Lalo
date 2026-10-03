/**
 * src/pages/RouletteStudio.tsx
 *
 * Módulo 6: Estudio de Ruleta de Castigos & Retos en Vivo de Lalo Stream Suite.
 * Diseñado con estética de hardware Cabina Broadcast, física de rotación con GSAP,
 * síntesis de ticks mecánicos con Web Audio API y modo Operate de Impeccable.
 */

import React, { useRef, useState, useEffect } from 'react';
import gsap from 'gsap';
import {
  Check,
  Copy,
  ExternalLink,
  Flame,
  FolderOpen,
  Gamepad2,
  Mic,
  Plus,
  RotateCw,
  Skull,
  Timer,
  Trash2,
  Tv,
  Zap,
} from 'lucide-react';
import { SuiteNav } from '../components/SuiteNav';
import { useRouletteSettings } from '../hooks/useRouletteSettings';
import {
  RouletteSegment,
  PenaltyCategory,
  ROULETTE_PRESETS,
  ROULETTE_STYLE_PRESETS,
  CATEGORY_LABELS,
  VIBRANT_SEGMENT_COLORS,
} from '../types/roulette';
import { AlertSoundType } from '../types/alerts';
import { playAlertOrCustomSound } from '../utils/alertsAudio';
import { RouletteOverlayView } from '../components/roulette/RouletteOverlayView';
import {
  speakRouletteSpinAnnouncement,
  speakRouletteWinnerAnnouncement,
} from '../utils/rouletteAudio';
import { loadSettings, PRESET_VOICES } from '../types/settings';
import { MediaLibraryModal } from '../components/MediaLibraryModal';
import { MediaItem } from '../types/mediaLibrary';
import { GuidedTour, TourStep, isTourDone } from '../components/GuidedTour';
import { Volume2, Sparkles } from 'lucide-react';

const TOUR_ID = 'ruleta';

const ROULETTE_TOUR_STEPS: TourStep[] = [
  {
    badge: 'Bienvenida',
    title: 'Estudio de Ruleta de Castigos & Retos',
    body: (
      <>
        Bienvenido a la Ruleta Interactiva de Lalo Stream Suite. Aquí diseñas ruletas de retos, penitencias y minijuegos con física inercial de GSAP, ticks mecánicos y animaciones sincronizadas en tiempo real con OBS Studio y Puntos de Canal.
      </>
    ),
  },
  {
    target: 'roulette-monitor',
    badge: 'Previsualización',
    title: 'Monitor 16:9 y Simulador en Vivo',
    body: 'El monitor simula con precisión milimétrica la escena de OBS. Pulsa «¡Girar Ruleta!» para disparar la animación inercial, escuchar los clicks percutivos de la aguja y ver la revelación dramática del castigo.',
  },
  {
    target: 'roulette-presets',
    badge: 'Preajustes',
    title: 'Colecciones de Retos Preconfiguradas',
    body: 'Carga al instante plantillas temáticas listas para el stream: Castigos Gamer, Retos Físicos & Fitness, Comida Picante, o Actuación & Show con voces divertidas.',
  },
  {
    target: 'roulette-segments',
    badge: 'Gestión',
    title: 'Biblioteca de Castigos y Segmentos',
    body: 'Crea, edita o desactiva penitencias personalizadas. Cada segmento puede tener su propio color, categoría y temporizador activo de cuenta regresiva en pantalla.',
  },
  {
    target: 'roulette-appearance',
    badge: 'Personalización',
    title: 'Estilos Visuales & Chasis de Transmisión',
    body: 'Elige entre 4 skins profesionales (Cabina Broadcast con LEDs perimetrales, Neón Glow, Cyberpunk o Casino Oro VIP) y ajusta la duración del giro para crear máximo suspenso.',
  },
  {
    target: 'roulette-actions',
    badge: 'Acción del Sistema',
    title: 'Efectos al Caer el Castigo',
    body: 'Configura sacudida sísmica de pantalla (Screen Shake), lluvia de confeti, chimes arcade o fanfarrias personalizadas desde la Biblioteca de Medios al detenerse la ruleta.',
  },
  {
    target: 'roulette-obs',
    badge: 'Acción del Sistema',
    title: 'Fuente de Navegador para OBS Studio',
    body: 'Copia el enlace del widget de ruleta y pégalo como Fuente de Navegador en tu escena (1920 × 1080). La ruleta aparecerá con transparencia total cuando tú o tus espectadores la hagan girar.',
  },
];

const SOUND_PRESETS: { id: AlertSoundType; name: string }[] = [
  { id: 'arcade-chime', name: 'Chime Arcade (16-bit)' },
  { id: 'retro-fanfare', name: 'Fanfarria Retro Victoria' },
  { id: 'synth-bell', name: 'Campana Synth' },
  { id: 'soft-pop', name: 'Pop Cálido' },
  { id: 'none', name: 'Sin sonido de victoria' },
];

export const RouletteStudio: React.FC = () => {
  const {
    rouletteSettings,
    saved,
    updateSettings,
    updateSegment,
    addSegment,
    deleteSegment,
    loadPreset,
    triggerSpin,
  } = useRouletteSettings();

  const [copiedUrl, setCopiedUrl] = useState(false);
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const [startRotation, setStartRotation] = useState<number>(0);
  const [currentRotation, setCurrentRotation] = useState(0);
  const [targetWinner, setTargetWinner] = useState<RouletteSegment | undefined>(undefined);
  const [activeWinner, setActiveWinner] = useState<{ segment: RouletteSegment; user: string } | null>(null);
  const [confettiActive, setConfettiActive] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);

  // Modal de Biblioteca de Medios (Media Vault)
  const [isMediaModalOpen, setIsMediaModalOpen] = useState(false);

  // Formulario rápido para nuevo segmento
  const [newText, setNewText] = useState('');
  const [newCategory, setNewCategory] = useState<PenaltyCategory>('gameplay');
  const [newColor, setNewColor] = useState(VIBRANT_SEGMENT_COLORS[0]);
  const [newDuration, setNewDuration] = useState(0);

  const monitorStageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Auto-lanzar el tutorial la primera vez
  useEffect(() => {
    if (isTourDone(TOUR_ID)) return;
    const timer = setTimeout(() => setTourOpen(true), 600);
    return () => clearTimeout(timer);
  }, []);

  // Efecto de lluvia de confeti
  useEffect(() => {
    if (!confettiActive || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const particles = Array.from({ length: 70 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * -canvas.height,
      vx: (Math.random() - 0.5) * 4,
      vy: Math.random() * 4 + 3,
      size: Math.random() * 6 + 4,
      color: ['#9146ff', '#00f5ff', '#ffd700', '#53fc18', '#ff2d46', '#ec4899'][
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

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const widgetUrl = `${baseUrl}/#widget?app=roulette&channel=${encodeURIComponent(
    rouletteSettings.channel
  )}`;

  const copyWidgetUrl = () => {
    navigator.clipboard?.writeText(widgetUrl).catch(() => {});
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2200);
  };

  const [isSpeakingTts, setIsSpeakingTts] = useState<string | null>(null);
  const ttsSettings = loadSettings();
  const activeVoiceName = PRESET_VOICES.find((v) => v.id === ttsSettings.referenceId)?.name || 'Voz Personalizada';

  // Disparar giro local y sincronizar con OBS
  const handleStartSpin = (targetId?: string) => {
    if (isSpinning) return;
    setActiveWinner(null);
    setIsSpinning(true);

    const spinEvent = triggerSpin('Streamer', targetId);
    if (!spinEvent) {
      setIsSpinning(false);
      return;
    }

    setStartRotation(spinEvent.startRotation ?? (currentRotation % 360));
    setCurrentRotation(spinEvent.finalRotation);
    setTargetWinner(spinEvent.winnerSegment);
    setTestStatus('¡Ruleta girando con inercia GSAP! (Sincronizado con OBS)');

    // Anunciar con la voz TTS del sistema que la ruleta va a girar
    if (rouletteSettings.ttsAnnounceSpin !== false) {
      speakRouletteSpinAnnouncement('Streamer', rouletteSettings.title);
    }
  };

  const handleWheelComplete = (winner: RouletteSegment) => {
    setIsSpinning(false);
    setActiveWinner({ segment: winner, user: 'Streamer' });

    // 1. Audio de victoria
    playAlertOrCustomSound(
      rouletteSettings.victoryCustomAudioUrl,
      rouletteSettings.victorySoundType,
      rouletteSettings.victoryCustomAudioVolume ?? 0.85
    );

    // 2. Anunciar con la voz TTS oficial del sistema el castigo resultante
    if (rouletteSettings.ttsAnnounceWinner !== false) {
      speakRouletteWinnerAnnouncement(winner, 'Streamer');
    }

    // 3. Confeti
    if (rouletteSettings.confetti) {
      setConfettiActive(true);
    }

    // 4. Screen Shake sísmico con GSAP
    if (rouletteSettings.screenShake && monitorStageRef.current) {
      gsap.fromTo(
        monitorStageRef.current,
        { x: -16, y: 12, rotate: -1.2 },
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

    setTestStatus(`¡La ruleta se detuvo en: «${winner.text}»!`);
    setTimeout(() => setTestStatus(null), 4000);
  };

  const handleAddSegmentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim()) return;

    const newSeg: RouletteSegment = {
      id: `seg-${Date.now()}`,
      text: newText.trim(),
      category: newCategory,
      color: newColor,
      durationSec: newDuration > 0 ? newDuration : undefined,
      intensity: 'medium',
      enabled: true,
    };

    addSegment(newSeg);
    setNewText('');
    setNewDuration(0);
    // Cambiar al siguiente color de la paleta
    const nextIdx = (VIBRANT_SEGMENT_COLORS.indexOf(newColor) + 1) % VIBRANT_SEGMENT_COLORS.length;
    setNewColor(VIBRANT_SEGMENT_COLORS[nextIdx]);
  };

  const handleMediaModalSelect = (item: MediaItem) => {
    setIsMediaModalOpen(false);
    updateSettings({
      victoryCustomAudioUrl: item.url,
      victorySoundType: 'none',
    });
    setTestStatus(`¡Audio «${item.name}» asignado para la ruleta!`);
    setTimeout(() => setTestStatus(null), 3000);
  };

  return (
    <div className="cab" style={{ paddingBottom: tourOpen ? 220 : undefined }}>
      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-6">
        {/* Barra superior de la Suite */}
        <SuiteNav
          currentApp="ruleta"
          channel={rouletteSettings.channel}
          saved={saved}
          onOpenTour={() => setTourOpen(true)}
          tourAvailable={!tourOpen}
        />

        {/* Encabezado del Módulo */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[color:var(--cb-line)] pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-rose-500 px-1.5 py-0.5 text-[10px] font-black text-white">
                MÓDULO 6
              </span>
              <span className="cab-caps text-xs text-[color:var(--cb-mut)]">
                MINIJUEGOS & CASTIGOS EN VIVO
              </span>
            </div>
            <h1
              className="cab-caps mt-1 text-2xl font-extrabold"
              style={{ fontStretch: '70%', fontWeight: 800 }}
            >
              Ruleta de Castigos, Retos & Penitencias
            </h1>
            <p className="mt-1 text-xs text-[color:var(--cb-mut)]">
              Minijuego interactivo accionado por Puntos de Canal o comandos de chat. Física inercial GSAP,
              clicks mecánicos sintetizados, aguja elástica y temporizadores activos en pantalla.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2" data-tour="roulette-obs">
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
          <div className="flex items-center gap-2 rounded border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-xs font-bold text-rose-300">
            <Check className="h-4 w-4 text-rose-400" />
            <span>{testStatus}</span>
          </div>
        )}

        {/* MONITOR EN VIVO 16:9 DE LA RULETA */}
        <section aria-label="Monitor de simulación de ruleta" data-tour="roulette-monitor">
          <div className="flex items-center justify-between pb-2">
            <div className="flex items-center gap-2">
              <Tv className="h-4 w-4 text-[color:var(--cb-mut)]" />
              <span className="cab-caps text-xs font-extrabold text-[color:var(--cb-fg)]">
                MONITOR DE ESCENARIO 16:9 (VISTA PREVIA OBS)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="cab-mono text-xs font-bold text-rose-400">
                {rouletteSettings.segments.filter((s) => s.enabled).length} SEGMENTOS ACTIVOS
              </span>
            </div>
          </div>

          <div
            ref={monitorStageRef}
            className="relative flex min-h-[460px] w-full flex-col items-center justify-center overflow-hidden rounded-lg border border-[color:var(--cb-line)] shadow-2xl p-6"
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
              width={900}
              height={460}
              className="pointer-events-none absolute inset-0 z-20 h-full w-full"
            />

            {/* Ruleta SVG Interactiva con GSAP & Overlay Broadcast */}
            <div className="relative z-10 flex flex-col items-center w-full max-w-3xl">
              <RouletteOverlayView
                settings={rouletteSettings}
                targetRotation={currentRotation}
                startRotation={startRotation}
                targetWinner={targetWinner}
                isSpinning={isSpinning}
                activeUser="Streamer"
                winnerBanner={activeWinner}
                onSpinComplete={handleWheelComplete}
                onBannerDismiss={() => setActiveWinner(null)}
                isStudio={true}
              />
            </div>

            {/* Barra de control rápido de prueba en el monitor */}
            <div className="absolute bottom-3 left-4 right-4 z-30 flex flex-wrap items-center justify-between gap-3 rounded bg-black/80 px-4 py-2.5 backdrop-blur border border-white/10">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleStartSpin()}
                  disabled={isSpinning}
                  className="cab-btn !h-8 !px-4 text-xs font-black transition-transform active:scale-[0.97] disabled:opacity-50"
                  style={{
                    background: 'linear-gradient(135deg, #ff2d46, #9146ff)',
                    color: '#ffffff',
                  }}
                >
                  <RotateCw className={`h-3.5 w-3.5 ${isSpinning ? 'animate-spin' : ''}`} />
                  <span>{isSpinning ? 'GIRANDO...' : '¡GIRAR RULETA!'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const active = rouletteSettings.segments.filter((s) => s.enabled);
                    if (active.length > 0) {
                      const rand = active[Math.floor(Math.random() * active.length)];
                      handleStartSpin(rand.id);
                    }
                  }}
                  disabled={isSpinning}
                  className="cab-btn2 !h-8 !px-3 !text-xs font-bold transition-transform active:scale-[0.97]"
                  title="Elegir un castigo forzado para probar"
                >
                  <Zap className="h-3 w-3 text-amber-400" />
                  <span>Giro Forzado (Test)</span>
                </button>
              </div>

              {/* Selector de Presets Rápidos */}
              <div className="flex items-center gap-2" data-tour="roulette-presets">
                <span className="cab-caps text-[10px] font-bold text-zinc-400">
                  CARGAR PREAJUSTE:
                </span>
                <div className="flex flex-wrap gap-1">
                  {ROULETTE_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        loadPreset(p.id);
                        setTestStatus(`¡Plantilla «${p.name}» cargada en la ruleta!`);
                        setTimeout(() => setTestStatus(null), 3000);
                      }}
                      className="cab-btn2 !h-6 !px-2 !text-[10px] font-bold transition-transform active:scale-[0.97]"
                      title={p.description}
                    >
                      {p.id === 'gamer' && <Gamepad2 className="h-2.5 w-2.5 text-rose-400" />}
                      {p.id === 'fitness' && <Flame className="h-2.5 w-2.5 text-amber-400" />}
                      {p.id === 'show' && <Mic className="h-2.5 w-2.5 text-purple-400" />}
                      {p.id === 'picante' && <Skull className="h-2.5 w-2.5 text-rose-500" />}
                      <span>{p.name.split(' ')[0]}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* LAYOUT PRINCIPAL: 2 COLUMNAS (Gestión de Segmentos & Ajustes del Sistema) */}
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Columna Izquierda: Segmentos & Penitencias (7 columnas) */}
          <section
            className="cab-mod lg:col-span-7"
            aria-label="Segmentos de la Ruleta"
            data-tour="roulette-segments"
          >
            <div className="flex items-center justify-between border-b border-[color:var(--cb-line)] pb-3">
              <div>
                <h2>
                  <span>1</span>Castigos & Segmentos Activos
                </h2>
                <p className="cab-hint text-xs">
                  Añade o edita los retos que aparecerán en la ruleta durante la transmisión.
                </p>
              </div>

              <span className="cab-mono text-xs font-bold text-[color:var(--cb-mut)]">
                {rouletteSettings.segments.length} retos en catálogo
              </span>
            </div>

            {/* Formulario rápido para agregar reto */}
            <form onSubmit={handleAddSegmentSubmit} className="mt-4 rounded-lg border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-3.5">
              <span className="cab-caps text-xs font-bold text-[color:var(--cb-fg)] block mb-2">
                Añadir Nuevo Castigo / Reto
              </span>

              <div className="grid gap-3 sm:grid-cols-12">
                <div className="sm:col-span-6">
                  <label className="cab-caps mb-1 block text-[10px] font-bold text-[color:var(--cb-mut)]">
                    Texto del Castigo
                  </label>
                  <input
                    type="text"
                    value={newText}
                    onChange={(e) => setNewText(e.target.value)}
                    placeholder="Ej: 20 flexiones, comer limón..."
                    className="cab-inp text-xs font-bold"
                    required
                  />
                </div>

                <div className="sm:col-span-3">
                  <label className="cab-caps mb-1 block text-[10px] font-bold text-[color:var(--cb-mut)]">
                    Categoría
                  </label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as PenaltyCategory)}
                    className="cab-inp text-xs font-bold"
                  >
                    <option value="gameplay">Gameplay</option>
                    <option value="fitness">Fitness</option>
                    <option value="voice">Voz / Audio</option>
                    <option value="food">Picante / Sabor</option>
                    <option value="show">Show</option>
                    <option value="safe">Inmunidad</option>
                  </select>
                </div>

                <div className="sm:col-span-3">
                  <label className="cab-caps mb-1 block text-[10px] font-bold text-[color:var(--cb-mut)]">
                    Duración (seg)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={5}
                    value={newDuration}
                    onChange={(e) => setNewDuration(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    placeholder="0 = Sin tempo"
                    className="cab-inp cab-mono text-xs font-bold"
                  />
                </div>
              </div>

              {/* Selector de Color y Botón Añadir */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--cb-line)] pt-3">
                <div className="flex items-center gap-1.5">
                  <span className="cab-caps text-[10px] font-bold text-[color:var(--cb-mut)] mr-1">
                    Color:
                  </span>
                  {VIBRANT_SEGMENT_COLORS.map((col) => (
                    <button
                      key={col}
                      type="button"
                      onClick={() => setNewColor(col)}
                      className={`h-5 w-5 rounded-full border border-black/40 transition-transform ${
                        newColor === col ? 'ring-2 ring-white scale-110' : 'opacity-80 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: col }}
                    />
                  ))}
                </div>

                <button
                  type="submit"
                  className="cab-btn !h-7 !px-3 text-xs font-bold transition-transform active:scale-[0.97]"
                >
                  <Plus className="h-3 w-3" />
                  <span>Añadir a la Ruleta</span>
                </button>
              </div>
            </form>

            {/* Lista de Segmentos */}
            <div className="mt-4 grid gap-2">
              {rouletteSettings.segments.map((seg) => {
                const cat = CATEGORY_LABELS[seg.category] || CATEGORY_LABELS.custom;
                return (
                  <div
                    key={seg.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[color:var(--cb-line)] bg-[color:var(--cb-panel)] p-2.5 transition-colors hover:border-[color:var(--cb-fg)]/40"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <div
                        className="h-4 w-4 shrink-0 rounded-full border border-black/40 shadow-sm"
                        style={{ backgroundColor: seg.color }}
                      />

                      <div className="min-w-0">
                        <span className="block truncate text-xs font-bold text-[color:var(--cb-fg)]">
                          {seg.text}
                        </span>
                        <div className="flex items-center gap-2 text-[10px] text-[color:var(--cb-mut)]">
                          <span style={{ color: cat.color }}>{cat.label}</span>
                          {seg.durationSec && seg.durationSec > 0 && (
                            <span className="cab-mono flex items-center gap-0.5 text-amber-400">
                              <Timer className="h-2.5 w-2.5" />
                              <span>{seg.durationSec}s</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1.5 cursor-pointer text-[10px] font-bold">
                        <input
                          type="checkbox"
                          checked={seg.enabled}
                          onChange={(e) => updateSegment(seg.id, { enabled: e.target.checked })}
                          className="h-3.5 w-3.5 rounded accent-rose-500"
                        />
                        <span className={seg.enabled ? 'text-emerald-400' : 'text-zinc-500'}>
                          {seg.enabled ? 'Activo' : 'Pausado'}
                        </span>
                      </label>

                      {rouletteSettings.segments.length > 2 && (
                        <button
                          type="button"
                          onClick={() => deleteSegment(seg.id)}
                          className="cab-btn2 !h-6 !px-2 text-rose-400 hover:text-rose-300 transition-transform active:scale-[0.97]"
                          title="Eliminar este reto"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Columna Derecha: Configuración de la Ruleta & Acciones (5 columnas) */}
          <div className="grid gap-5 lg:col-span-5">
            {/* Módulo: Estilo y Físicas */}
            <section className="cab-mod" data-tour="roulette-appearance">
              <h2>
                <span>2</span>Estilo Visual & Físicas
              </h2>

              <div className="mt-3 grid gap-3">
                <div>
                  <label className="cab-caps mb-1.5 block text-[11px] font-bold text-[color:var(--cb-mut)]">
                    Estilo de Chasis
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {ROULETTE_STYLE_PRESETS.map((st) => (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => updateSettings({ style: st.id })}
                        className={`rounded border p-2.5 text-left transition-all active:scale-[0.97] ${
                          rouletteSettings.style === st.id
                            ? 'border-rose-400 bg-rose-950/20 ring-1 ring-rose-400 font-bold text-white'
                            : 'border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] text-[color:var(--cb-mut)]'
                        }`}
                      >
                        <span className="block text-xs">{st.name}</span>
                        <span className="block text-[10px] opacity-70 truncate">{st.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs font-bold text-[color:var(--cb-fg)]">
                    <span>Duración de Giro Inercial (GSAP)</span>
                    <span className="cab-mono text-rose-400">
                      {rouletteSettings.spinDurationSec} seg
                    </span>
                  </div>
                  <input
                    type="range"
                    min={3}
                    max={12}
                    step={0.5}
                    value={rouletteSettings.spinDurationSec}
                    onChange={(e) =>
                      updateSettings({ spinDurationSec: parseFloat(e.target.value) })
                    }
                    className="mt-1.5 w-full accent-rose-500"
                  />
                  <span className="cab-hint text-[10px]">
                    Curva física power4.out: arranque veloz y desaceleración dramática.
                  </span>
                </div>
              </div>
            </section>

            {/* Módulo: Efectos al Caer el Castigo */}
            <section className="cab-mod" data-tour="roulette-actions">
              <h2>
                <span>3</span>Efectos al Resolver
              </h2>

              <div className="mt-3 grid gap-3">
                {/* Toggles: Screen Shake y Confeti */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => updateSettings({ screenShake: !rouletteSettings.screenShake })}
                    className={`flex items-center justify-between rounded border p-2 text-xs font-bold transition-all active:scale-[0.97] ${
                      rouletteSettings.screenShake
                        ? 'border-rose-500/50 bg-rose-500/10 text-rose-300'
                        : 'border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] text-[color:var(--cb-mut)]'
                    }`}
                  >
                    <span>Screen Shake</span>
                    <span>{rouletteSettings.screenShake ? 'SÍ' : 'NO'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => updateSettings({ confetti: !rouletteSettings.confetti })}
                    className={`flex items-center justify-between rounded border p-2 text-xs font-bold transition-all active:scale-[0.97] ${
                      rouletteSettings.confetti
                        ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                        : 'border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] text-[color:var(--cb-mut)]'
                    }`}
                  >
                    <span>Lluvia Confeti</span>
                    <span>{rouletteSettings.confetti ? 'SÍ' : 'NO'}</span>
                  </button>
                </div>

                {/* Sonido de Victoria */}
                <div>
                  <label className="cab-caps mb-1 block text-[11px] font-bold text-[color:var(--cb-mut)]">
                    Sonido de Fanfarria al Detenerse
                  </label>
                  <select
                    value={rouletteSettings.victorySoundType}
                    onChange={(e) =>
                      updateSettings({ victorySoundType: e.target.value as AlertSoundType })
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

                {/* Integración con Media Vault */}
                <div className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="cab-caps text-[10px] font-bold text-[color:var(--cb-mut)]">
                      Fanfarria MP3 Personalizada
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsMediaModalOpen(true)}
                      className="cab-btn2 !h-6 !px-2 text-[10px] font-bold text-amber-400"
                    >
                      <FolderOpen className="h-3 w-3" />
                      <span>Explorar Vault</span>
                    </button>
                  </div>
                  {rouletteSettings.victoryCustomAudioUrl && (
                    <span className="mt-1 block truncate text-[11px] text-emerald-400 font-mono">
                      ✓ Audio personalizado asignado
                    </span>
                  )}
                </div>

                {/* Integración con Twitch (Puntos de Canal & Chat) */}
                <div className="border-t border-[color:var(--cb-line)] pt-3">
                  <label className="cab-caps mb-1 block text-[11px] font-bold text-[color:var(--cb-mut)]">
                    Nombre del Canje de Puntos de Twitch
                  </label>
                  <input
                    type="text"
                    value={rouletteSettings.triggerRewardName || ''}
                    onChange={(e) => updateSettings({ triggerRewardName: e.target.value })}
                    placeholder="Ej: Girar Ruleta de Castigos"
                    className="cab-inp text-xs font-bold"
                  />
                  <span className="cab-hint text-[10px]">
                    Al canjear esta recompensa en Twitch, el bot o EventSub hará girar la ruleta en directo.
                  </span>
                </div>
              </div>
            </section>

            {/* Módulo: Locutor TTS con Voz de Fish Audio */}
            <section className="cab-mod" data-tour="roulette-tts">
              <div className="flex items-center justify-between border-b border-[color:var(--cb-line)] pb-3">
                <div className="flex items-center gap-2">
                  <Mic className="h-4 w-4 text-rose-400" />
                  <h2 className="!border-none !pb-0 !mb-0">
                    <span>4</span>Locutor TTS de la Ruleta
                  </h2>
                </div>
                <span className="rounded bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-300">
                  FISH AUDIO
                </span>
              </div>

              <div className="mt-3 flex items-center justify-between rounded-lg border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] px-3 py-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                  <span className="text-xs text-[color:var(--cb-mut)]">Voz activa:</span>
                  <span className="rounded bg-rose-500/20 px-2 py-0.5 font-mono text-xs font-bold text-rose-300">
                    {activeVoiceName}
                  </span>
                </div>
                <a
                  href="#tts"
                  className="text-[11px] font-semibold text-cyan-400 hover:text-cyan-300 hover:underline"
                >
                  Cambiar en TTS →
                </a>
              </div>

              <p className="mt-3 text-xs leading-relaxed text-[color:var(--cb-mut)]">
                La voz del sistema anuncia automáticamente cuando la ruleta empieza a girar y proclama el castigo final con inflexión emocional.
              </p>

              <div className="mt-3 grid gap-2">
                {/* Toggle Anunciar Giro */}
                <button
                  type="button"
                  onClick={() =>
                    updateSettings({
                      ttsAnnounceSpin: !(rouletteSettings.ttsAnnounceSpin !== false),
                    })
                  }
                  className={`flex items-center justify-between rounded border p-2 text-xs font-bold transition-all active:scale-[0.97] ${
                    rouletteSettings.ttsAnnounceSpin !== false
                      ? 'border-rose-500/50 bg-rose-500/10 text-rose-300'
                      : 'border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] text-[color:var(--cb-mut)]'
                  }`}
                >
                  <span>Anunciar inicio de giro</span>
                  <span>{rouletteSettings.ttsAnnounceSpin !== false ? 'ACTIVADO' : 'SILENCIADO'}</span>
                </button>

                {/* Toggle Anunciar Ganador */}
                <button
                  type="button"
                  onClick={() =>
                    updateSettings({
                      ttsAnnounceWinner: !(rouletteSettings.ttsAnnounceWinner !== false),
                    })
                  }
                  className={`flex items-center justify-between rounded border p-2 text-xs font-bold transition-all active:scale-[0.97] ${
                    rouletteSettings.ttsAnnounceWinner !== false
                      ? 'border-rose-500/50 bg-rose-500/10 text-rose-300'
                      : 'border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] text-[color:var(--cb-mut)]'
                  }`}
                >
                  <span>Anunciar castigo/reto resultante</span>
                  <span>{rouletteSettings.ttsAnnounceWinner !== false ? 'ACTIVADO' : 'SILENCIADO'}</span>
                </button>
              </div>

              {/* Botones de prueba de locución */}
              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[color:var(--cb-line)] pt-3">
                <button
                  type="button"
                  disabled={isSpeakingTts !== null}
                  onClick={() => {
                    setIsSpeakingTts('spin');
                    speakRouletteSpinAnnouncement('Streamer', rouletteSettings.title, undefined, () =>
                      setIsSpeakingTts(null)
                    );
                  }}
                  className="flex items-center justify-center gap-1.5 rounded bg-slate-800 hover:bg-slate-700 px-2.5 py-1.5 text-xs font-bold text-slate-200 transition-transform active:scale-[0.97] disabled:opacity-50"
                >
                  <Volume2 className="h-3.5 w-3.5 text-cyan-400" />
                  <span>{isSpeakingTts === 'spin' ? 'Hablando...' : 'Probar Giro'}</span>
                </button>

                <button
                  type="button"
                  disabled={isSpeakingTts !== null}
                  onClick={() => {
                    setIsSpeakingTts('winner');
                    const sampleWinner =
                      rouletteSettings.segments.find((s) => s.enabled) || rouletteSettings.segments[0];
                    speakRouletteWinnerAnnouncement(sampleWinner, 'Streamer', undefined, () =>
                      setIsSpeakingTts(null)
                    );
                  }}
                  className="flex items-center justify-center gap-1.5 rounded bg-slate-800 hover:bg-slate-700 px-2.5 py-1.5 text-xs font-bold text-slate-200 transition-transform active:scale-[0.97] disabled:opacity-50"
                >
                  <Volume2 className="h-3.5 w-3.5 text-rose-400" />
                  <span>{isSpeakingTts === 'winner' ? 'Hablando...' : 'Probar Resultado'}</span>
                </button>
              </div>
            </section>
          </div>
        </div>

        {/* Modal de Biblioteca de Medios (Media Vault) */}
        <MediaLibraryModal
          isOpen={isMediaModalOpen}
          onClose={() => setIsMediaModalOpen(false)}
          onSelect={handleMediaModalSelect}
          allowedTypes={['audio']}
          title="Media Vault · Seleccionar Audio para la Ruleta de Castigos"
        />

        {/* Tutorial Guiado */}
        {tourOpen && (
          <GuidedTour
            steps={ROULETTE_TOUR_STEPS}
            onClose={() => setTourOpen(false)}
            id={TOUR_ID}
            appName="Ruleta de Castigos"
          />
        )}
      </div>
    </div>
  );
};
