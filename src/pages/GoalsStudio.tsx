/**
 * src/pages/GoalsStudio.tsx
 *
 * Estudio de Metas sobre la plantilla común del panel: lista de metas, editor
 * de la elegida y monitor 16:9 siempre a la vista.
 *
 * - El progreso real se edita en un solo sitio: «Va en» y «Meta».
 * - Cada meta elige su diseño (Barra, Anillo, Bloques, Cinta, Columna o
 *   Personalizado); la posición en pantalla es común a todas.
 * - «Probar» bajo el monitor mueve la meta en el monitor y en las fuentes de
 *   OBS abiertas, sin cambiar lo guardado. «Reiniciar» lo deshace.
 * - «Probar celebración» también se envía a las fuentes de OBS abiertas.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import gsap from 'gsap';
import { Check, Copy, Play, Plus, Trash2 } from 'lucide-react';
import { SuiteNav } from '../components/SuiteNav';
import { useGoalsSettings } from '../hooks/useGoalsSettings';
import {
  CommunityGoalItem,
  GoalType,
  GoalsDisplayMode,
  GoalsSettings,
  calculateGoalProgress,
  shouldDisplayAsSlideshow,
} from '../types/goals';
import {
  GOAL_CUSTOM_SHAPES,
  GOAL_DESIGNS,
  GOAL_FONTS,
  GOAL_POSITIONS,
  GOAL_RADIUS_MAX,
  GOAL_SIZE_MAX,
  GOAL_SIZE_MIN,
  GoalCustom,
  GoalFontId,
  GoalStyle,
  nextMilestoneValue,
  normalizeGoalCustom,
} from '../utils/goalDesign';
import { AlertSoundType } from '../types/alerts';
import { playAlertOrCustomSound } from '../utils/alertsAudio';
import { postBus } from '../utils/bus';
import { MediaLibraryModal } from '../components/MediaLibraryModal';
import { GoalsOverlayView } from '../components/goals/GoalsOverlayView';
import { MediaItem, MediaType, inspectAudioFile, MAX_AUDIO_DURATION_SECONDS } from '../types/mediaLibrary';
import { GuidedTour, TourStep, isTourDone } from '../components/GuidedTour';
import { Field, Range, Toggle, UndoNote, useUndo } from '../components/studio/StudioKit';
import { buildSuiteWidgetUrl } from '../utils/widgetUrl';
import { loadSettings } from '../types/settings';
import { useCloudSession } from '../hooks/useCloudSession';
import '../styles/capas.css';

const TOUR_ID = 'metas';

const GOALS_TOUR_STEPS: TourStep[] = [
  {
    badge: 'Bienvenida',
    title: 'Metas',
    body: 'Aquí preparas las barras de progreso de tu directo: suscripciones, seguidores, bits y más.',
  },
  {
    target: 'goals-list',
    badge: 'Lista',
    title: 'Tus metas',
    body: 'Elige una meta para editarla. El interruptor decide si se muestra en pantalla.',
  },
  {
    target: 'goals-mode',
    badge: 'En pantalla',
    title: 'Cómo se reparten',
    body: 'A la vez, por turnos o solo una, y en qué punto de la pantalla. En automático, hasta 4 metas se ven a la vez y con 5 o más pasan a carrusel.',
  },
  {
    target: 'goals-editor',
    badge: 'Editor',
    title: 'Título, progreso y diseño',
    body: '«Va en» y «Meta» son el progreso real. Debajo eliges el diseño de la meta. Lo que ocurre al completarla y los anuncios de voz están plegados.',
  },
  {
    target: 'goals-monitor',
    badge: 'Monitor',
    title: 'Prueba y copia la URL',
    body: '«Probar» mueve la meta aquí y en OBS sin tocar lo guardado. «Copiar URL para OBS» te da la fuente de navegador.',
  },
];

const ACCENTS = [
  { color: '#9146ff', name: 'Morado' },
  { color: '#00f5ff', name: 'Cian' },
  { color: '#ffd700', name: 'Oro' },
  { color: '#53fc18', name: 'Verde' },
  { color: '#ff2d46', name: 'Rojo' },
  { color: '#ff6b4a', name: 'Coral' },
];

const GOAL_TYPES: { id: GoalType; name: string; unit: string }[] = [
  { id: 'subs', name: 'Suscripciones', unit: 'subs' },
  { id: 'followers', name: 'Seguidores', unit: 'seguidores' },
  { id: 'bits', name: 'Bits', unit: 'bits' },
  { id: 'raids', name: 'Raids', unit: 'raids' },
  { id: 'donations', name: 'Puntos', unit: 'puntos' },
];

const SOUNDS: { id: AlertSoundType; name: string }[] = [
  { id: 'retro-fanfare', name: 'Fanfarria' },
  { id: 'arcade-chime', name: 'Arcade' },
  { id: 'synth-bell', name: 'Campana' },
  { id: 'soft-pop', name: 'Pop suave' },
  { id: 'none', name: 'Sin sonido' },
];

const LAYOUTS: { id: GoalsDisplayMode; name: string; hint: string }[] = [
  { id: 'auto_4_or_slideshow', name: 'Auto', hint: 'Hasta 4 metas se ven a la vez; con 5 o más pasan a carrusel.' },
  { id: 'slideshow_only', name: 'Carrusel', hint: 'Una meta cada vez, por turnos.' },
  { id: 'row_only', name: 'A la vez', hint: 'Todas a la vez, con un máximo de 4. Al centro van en fila; en un lateral, apiladas.' },
  { id: 'single_active', name: 'Solo una', hint: 'Solo la meta que tengas elegida en la lista.' },
];

const CONFETTI_COLORS = ['#9146ff', '#00f5ff', '#ffd700', '#53fc18', '#ff2d46', '#ffffff'];
const DEFAULT_VOLUME = 0.85;
const fmt = (value: number) => Math.round(value).toLocaleString('es');

type TestAction = 1 | 5 | 'hito' | 'fin';

/** Avisa a las fuentes de OBS de un valor de prueba, sin voz ni guardado. */
const sendTestValue = (goal: CommunityGoalItem, value: number) =>
  postBus({
    type: 'GOAL_UPDATE',
    goal: {
      goalId: goal.id,
      title: goal.title,
      current: value,
      target: goal.target,
      unit: goal.unit,
      percent: calculateGoalProgress(value, goal.target),
      completed: value >= goal.target,
    },
  });

/** «Aparición reactiva» se pinta igual que «A la vez»: comparten botón. */
const layoutOf = (mode: GoalsDisplayMode): GoalsDisplayMode => (mode === 'reactive_progress' ? 'row_only' : mode);

export const GoalsStudio: React.FC = () => {
  const { goalsSettings, activeGoal, saved, updateSettings, updateGoalItem, addGoalItem, deleteGoalItem, setActiveGoalId } =
    useGoalsSettings();
  const cloud = useCloudSession();
  const uid = useId();
  const goals = goalsSettings.goals;

  const [copiedUrl, setCopiedUrl] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [wantsFile, setWantsFile] = useState(false);
  const [vault, setVault] = useState<MediaType | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  // Valor de prueba por meta: lo ven el monitor y OBS, pero no se guarda
  const [tested, setTested] = useState<Record<string, number>>({});
  const [recentGoalId, setRecentGoalId] = useState<string | null>(null);
  const [monitorVideo, setMonitorVideo] = useState<string | null>(null);
  const [confettiActive, setConfettiActive] = useState(false);
  const undo = useUndo<{ goals: CommunityGoalItem[]; activeGoalId: string }>();

  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // La guía se abre sola la primera vez; después se accede desde la cabecera
  useEffect(() => {
    if (isTourDone(TOUR_ID)) return;
    const timer = setTimeout(() => setTourOpen(true), 600);
    return () => clearTimeout(timer);
  }, []);

  useEffect(
    () => () => {
      if (statusTimer.current) clearTimeout(statusTimer.current);
      if (recentTimer.current) clearTimeout(recentTimer.current);
      if (videoTimer.current) clearTimeout(videoTimer.current);
    },
    []
  );

  const say = (message: string) => {
    setStatus(message);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(null), 3500);
  };

  // Lluvia de confeti sobre el monitor
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
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
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

  // ---------- Meta seleccionada ----------
  const hasFile = Boolean(activeGoal.victoryCustomAudioUrl);
  const volume = activeGoal.victoryCustomAudioVolume ?? DEFAULT_VOLUME;
  const patch = (value: Partial<CommunityGoalItem>) => {
    // Si cambia el progreso real, la prueba de esa meta deja de tener sentido
    if (('current' in value || 'target' in value) && activeGoal.id in tested) {
      setTested((prev) => {
        const next = { ...prev };
        delete next[activeGoal.id];
        return next;
      });
    }
    updateGoalItem(activeGoal.id, value);
  };

  // ---------- Diseño ----------
  const design = GOAL_DESIGNS.find((entry) => entry.id === activeGoal.style) || GOAL_DESIGNS[0];
  const custom = normalizeGoalCustom(activeGoal.custom);
  const patchCustom = (value: Partial<GoalCustom>) => patch({ custom: { ...custom, ...value } });
  const chooseDesign = (id: GoalStyle) => patch(id === 'custom' ? { style: id, custom } : { style: id });
  const sameDesignEverywhere = goals.every(
    (goal) =>
      goal.style === activeGoal.style &&
      (goal.style !== 'custom' || JSON.stringify(normalizeGoalCustom(goal.custom)) === JSON.stringify(custom))
  );
  const applyDesignToAll = () => {
    undo.offer(`Todas las metas usan ahora el diseño ${design.name}.`, { goals, activeGoalId: activeGoal.id });
    updateSettings({
      goals: goals.map((goal) =>
        activeGoal.style === 'custom' ? { ...goal, style: activeGoal.style, custom } : { ...goal, style: activeGoal.style }
      ),
    });
  };

  const select = (id: string) => {
    setActiveGoalId(id);
    setWantsFile(false);
    setAudioError(null);
  };

  const createGoal = () => {
    setWantsFile(false);
    setAudioError(null);
    addGoalItem({
      id: `goal-${Date.now()}`,
      type: 'subs',
      title: 'Meta nueva',
      current: 0,
      target: 50,
      unit: 'subs',
      enabled: true,
      style: 'barra',
      accentColor: '#9146ff',
      showPercentage: true,
      showNumbers: true,
      celebrateOnComplete: true,
      victorySoundType: 'retro-fanfare',
      victoryScreenShake: true,
      confetti: true,
    });
  };

  const removeGoal = () => {
    undo.offer(`Se eliminó «${activeGoal.title}».`, { goals, activeGoalId: activeGoal.id });
    deleteGoalItem(activeGoal.id);
    setWantsFile(false);
  };

  const restoreGoal = () => {
    if (!undo.pending) return;
    updateSettings(undo.pending.snapshot);
    undo.clear();
  };

  // ---------- En pantalla ----------
  const enabledCount = goals.filter((goal) => goal.enabled).length;
  const layout = layoutOf(goalsSettings.displayMode);
  const layoutMeta = LAYOUTS.find((entry) => entry.id === layout) || LAYOUTS[0];
  const carouselApplies = shouldDisplayAsSlideshow(enabledCount, goalsSettings.displayMode);

  // ---------- Sonido ----------
  const chooseSound = (value: string) => {
    if (value === 'file') {
      setWantsFile(true);
      return;
    }
    setWantsFile(false);
    setAudioError(null);
    patch({
      victorySoundType: value as AlertSoundType,
      victoryCustomAudioUrl: undefined,
      victoryCustomAudioName: undefined,
    });
  };

  const assignAudio = (url: string, name: string) => {
    setWantsFile(false);
    setAudioError(null);
    patch({ victoryCustomAudioUrl: url, victoryCustomAudioName: name, victoryCustomAudioVolume: volume });
    say(`Sonido «${name}» asignado.`);
  };

  const handleAudioUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const { dataUrl } = await inspectAudioFile(file);
      assignAudio(dataUrl, file.name);
    } catch (err) {
      setAudioError(
        err instanceof Error && err.message
          ? err.message
          : `El archivo supera la duración máxima de ${MAX_AUDIO_DURATION_SECONDS} s. Elige uno más corto.`
      );
    }
  };

  // ---------- Vídeo ----------
  const assignVideo = (url: string, name: string, isWebm: boolean) => {
    patch({ victoryVideoUrl: url, victoryVideoName: name, victoryBlendMode: isWebm ? 'transparent' : 'screen' });
    say(`Vídeo «${name}» asignado.`);
  };

  const handleVideoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (loaded) => {
      assignVideo(loaded.target?.result as string, file.name, file.name.toLowerCase().endsWith('.webm'));
    };
    reader.onerror = () => say('No se pudo leer el vídeo. Prueba con otro archivo.');
    reader.readAsDataURL(file);
  };

  const handleVaultSelect = (media: MediaItem) => {
    const type = vault;
    setVault(null);
    if (type === 'audio') assignAudio(media.url, media.name);
    else assignVideo(media.url, media.name, media.format === 'webm');
  };

  // ---------- Probar ----------
  // La copia que ve el monitor: metas guardadas con su valor de prueba
  const previewGoals = goals.map((goal) => (goal.id in tested ? { ...goal, current: tested[goal.id] } : goal));
  const hasTest = Object.keys(tested).length > 0;

  const runTest = (action: TestAction) => {
    const from = tested[activeGoal.id] ?? activeGoal.current;
    if (from >= activeGoal.target) {
      say('La meta ya está cumplida. Pulsa «Reiniciar» para repetir la prueba.');
      return;
    }
    const to =
      action === 'fin'
        ? activeGoal.target
        : action === 'hito'
          ? nextMilestoneValue(from, activeGoal.target)
          : Math.min(activeGoal.target, from + action);
    setTested((prev) => ({ ...prev, [activeGoal.id]: to }));
    sendTestValue(activeGoal, to);
    setRecentGoalId(activeGoal.id);
    if (recentTimer.current) clearTimeout(recentTimer.current);
    recentTimer.current = setTimeout(() => setRecentGoalId(null), 3500);
  };

  // Vuelve a lo guardado. Si la meta guardada ya está cumplida, la prueba
  // arranca de cero para poder repetirla.
  const resetTest = () => {
    const fromZero = activeGoal.current >= activeGoal.target;
    setTested(fromZero ? { [activeGoal.id]: 0 } : {});
    postBus({ type: 'GOALS_SETTINGS_UPDATE', settings: goalsSettings });
    if (fromZero) sendTestValue(activeGoal, 0);
    say(
      fromZero
        ? 'La meta guardada ya está cumplida: la prueba empieza de cero.'
        : 'Prueba reiniciada: el monitor y OBS muestran lo guardado.'
    );
  };

  const testCelebration = () => {
    playAlertOrCustomSound(activeGoal.victoryCustomAudioUrl, activeGoal.victorySoundType || 'retro-fanfare', volume);
    if (activeGoal.confetti !== false) setConfettiActive(true);
    if (activeGoal.victoryScreenShake && stageRef.current) {
      gsap.fromTo(
        stageRef.current,
        { x: -16, y: 12, rotate: -1 },
        { x: 0, y: 0, rotate: 0, duration: 0.75, ease: 'elastic.out(1.2, 0.18)', clearProps: 'transform' }
      );
    }

    if (videoTimer.current) clearTimeout(videoTimer.current);
    setMonitorVideo(activeGoal.victoryVideoUrl || null);
    if (activeGoal.victoryVideoUrl) videoTimer.current = setTimeout(() => setMonitorVideo(null), 5500);

    postBus({
      type: 'GOAL_CELEBRATE',
      celebration: {
        goalId: activeGoal.id,
        title: activeGoal.title,
        victoryVideoUrl: activeGoal.victoryVideoUrl,
        victoryBlendMode: activeGoal.victoryBlendMode || 'transparent',
        victoryCustomAudioUrl: activeGoal.victoryCustomAudioUrl,
        victoryCustomAudioVolume: volume,
        victorySoundType: activeGoal.victorySoundType,
        screenShake: activeGoal.victoryScreenShake,
        confetti: activeGoal.confetti,
        duration: 6,
      },
    });
    say(`Celebración de «${activeGoal.title}» enviada al monitor y a OBS.`);
  };

  // Cada guardado envía a OBS las metas reales; si hay una prueba en marcha,
  // se repite detrás para que el monitor y OBS sigan mostrando lo mismo.
  const testedRef = useRef(tested);
  testedRef.current = tested;
  const settingsRef = useRef<GoalsSettings>(goalsSettings);
  settingsRef.current = goalsSettings;
  useEffect(() => {
    Object.entries(testedRef.current).forEach(([id, value]) => {
      const goal = goalsSettings.goals.find((entry) => entry.id === id);
      if (goal) sendTestValue(goal, value);
    });
  }, [goalsSettings]);
  // Al salir del estudio, OBS vuelve a lo guardado
  useEffect(
    () => () => {
      if (Object.keys(testedRef.current).length > 0) {
        postBus({ type: 'GOALS_SETTINGS_UPDATE', settings: settingsRef.current });
      }
    },
    []
  );

  // ---------- URL de OBS ----------
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const copyWidgetUrl = () => {
    const url = buildSuiteWidgetUrl(
      baseUrl,
      'goals',
      goalsSettings.channel,
      loadSettings(),
      cloud.profile?.status === 'active' ? { k: cloud.profile.widget_key } : undefined
    );
    navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopiedUrl(true);
        setTimeout(() => setCopiedUrl(false), 2200);
      })
      .catch(() => say('No se pudo copiar. Usa «Fuentes de OBS» en la cabecera.'));
  };

  return (
    <div className="cab" style={{ paddingBottom: tourOpen ? 220 : undefined }}>
      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-6">
        <SuiteNav
          currentApp="metas"
          channel={goalsSettings.channel}
          saved={saved}
          onOpenTour={() => setTourOpen(true)}
          tourAvailable={!tourOpen}
        />

        <div className="grid items-start gap-5 min-[1200px]:grid-cols-[250px_minmax(0,1fr)_minmax(0,380px)]">
          <div className="grid gap-5">
            {/* ---------- Lista de metas ---------- */}
            <section className="cab-mod" data-tour="goals-list">
              <h2>Metas</h2>
              <ul className="cab-rows !max-h-none">
                {goals.map((goal) => {
                  const current = goal.id === activeGoal.id;
                  return (
                    <li key={goal.id} className="cab-row" data-current={current ? '' : undefined}>
                      <button
                        type="button"
                        className="studio-pick"
                        aria-current={current ? 'true' : undefined}
                        onClick={() => select(goal.id)}
                      >
                        {goal.title || 'Sin título'}
                        <span className="cab-mono">
                          {fmt(goal.current)} de {fmt(goal.target)}
                        </span>
                      </button>
                      <input
                        type="checkbox"
                        className="cab-tog"
                        checked={goal.enabled}
                        aria-label={`Mostrar ${goal.title} en pantalla`}
                        onChange={(e) => updateGoalItem(goal.id, { enabled: e.target.checked })}
                      />
                    </li>
                  );
                })}
              </ul>
              <button type="button" className="cab-btn2" onClick={createGoal}>
                <Plus className="h-4 w-4" />
                <span>Nueva meta</span>
              </button>
              {undo.pending && <UndoNote label={undo.pending.label} onUndo={restoreGoal} />}
            </section>

            {/* ---------- En pantalla ---------- */}
            <section className="cab-mod" data-tour="goals-mode">
              <h2>En pantalla</h2>
              <Field label="Reparto" hint={layoutMeta.hint}>
                <div className="cab-seg" role="group" aria-label="Reparto de las metas en pantalla">
                  {LAYOUTS.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      aria-pressed={layout === entry.id}
                      onClick={() => updateSettings({ displayMode: entry.id })}
                    >
                      {entry.name}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Posición" hint="La Cinta ocupa el borde entero, arriba o abajo.">
                <div className="cab-pos" role="group" aria-label="Posición de las metas en pantalla">
                  {GOAL_POSITIONS.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      aria-label={entry.name}
                      title={entry.name}
                      aria-pressed={goalsSettings.position === entry.id}
                      onClick={() => updateSettings({ position: entry.id })}
                    />
                  ))}
                </div>
              </Field>
              {carouselApplies && (
                <Field label="Cada meta se queda">
                  <Range
                    label="Segundos que se queda cada meta"
                    min={3}
                    max={30}
                    value={goalsSettings.slideshowIntervalSec}
                    format={(value) => `${value} s`}
                    onChange={(value) => updateSettings({ slideshowIntervalSec: value })}
                  />
                </Field>
              )}
            </section>
          </div>

          {/* ---------- Editor ---------- */}
          <section className="cab-mod" data-tour="goals-editor">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2>{activeGoal.title || 'Sin título'}</h2>
              {goals.length > 1 && (
                <button type="button" className="cab-btn2 cab-btn-sm" onClick={removeGoal}>
                  <Trash2 className="h-4 w-4" />
                  <span>Eliminar</span>
                </button>
              )}
            </div>

            <Field label="Título" htmlFor={`${uid}-title`}>
              <input
                id={`${uid}-title`}
                className="cab-inp"
                value={activeGoal.title}
                onChange={(e) => patch({ title: e.target.value })}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Qué cuenta" htmlFor={`${uid}-type`}>
                <select
                  id={`${uid}-type`}
                  className="cab-inp"
                  value={activeGoal.type}
                  onChange={(e) => {
                    const type = GOAL_TYPES.find((entry) => entry.id === e.target.value);
                    if (type) patch({ type: type.id, unit: type.unit });
                  }}
                >
                  {GOAL_TYPES.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Va en" htmlFor={`${uid}-current`}>
                <input
                  id={`${uid}-current`}
                  type="number"
                  min={0}
                  className="cab-inp cab-mono"
                  value={activeGoal.current}
                  onChange={(e) => patch({ current: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                />
              </Field>
              <Field label="Meta" htmlFor={`${uid}-target`}>
                <input
                  id={`${uid}-target`}
                  type="number"
                  min={1}
                  className="cab-inp cab-mono"
                  value={activeGoal.target}
                  onChange={(e) => patch({ target: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
                />
              </Field>
            </div>

            <Field label="Diseño" hint={design.hint}>
              <div className="mt-designs" role="group" aria-label="Diseño de la meta">
                {GOAL_DESIGNS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className="mt-design"
                    aria-pressed={activeGoal.style === entry.id}
                    onClick={() => chooseDesign(entry.id)}
                  >
                    <span
                      className="mt-glyph"
                      data-g={entry.id}
                      aria-hidden="true"
                      style={{ '--c': activeGoal.accentColor } as React.CSSProperties}
                    >
                      <i />
                      {entry.id === 'custom' && (
                        <>
                          <i />
                          <i />
                        </>
                      )}
                    </span>
                    {entry.name}
                  </button>
                ))}
              </div>
              {goals.length > 1 && !sameDesignEverywhere && (
                <div>
                  <button type="button" className="cab-btn2 cab-btn-sm" onClick={applyDesignToAll}>
                    Usar en todas las metas
                  </button>
                </div>
              )}
            </Field>

            {activeGoal.style === 'custom' && (
              <div className="grid gap-4 rounded border border-[color:var(--cb-line)] p-3">
                <Field label="Forma" hint="La Cinta no se personaliza: ocupa el borde entero.">
                  <div className="cab-seg" role="group" aria-label="Forma del diseño personalizado">
                    {GOAL_CUSTOM_SHAPES.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        aria-pressed={custom.shape === entry.id}
                        onClick={() => patchCustom({ shape: entry.id })}
                      >
                        {entry.name}
                      </button>
                    ))}
                  </div>
                </Field>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Fondo" htmlFor={`${uid}-bg`}>
                    <input
                      id={`${uid}-bg`}
                      type="color"
                      className="mt-color"
                      value={custom.background}
                      onChange={(e) => patchCustom({ background: e.target.value })}
                    />
                  </Field>
                  <Field label="Texto" htmlFor={`${uid}-fg`}>
                    <input
                      id={`${uid}-fg`}
                      type="color"
                      className="mt-color"
                      value={custom.text}
                      onChange={(e) => patchCustom({ text: e.target.value })}
                    />
                  </Field>
                  <Field label="Tipografía" htmlFor={`${uid}-font`}>
                    <select
                      id={`${uid}-font`}
                      className="cab-inp"
                      value={custom.font}
                      onChange={(e) => patchCustom({ font: e.target.value as GoalFontId })}
                    >
                      {GOAL_FONTS.map((font) => (
                        <option key={font.id} value={font.id}>
                          {font.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Tamaño">
                  <Range
                    label="Tamaño de la meta"
                    min={GOAL_SIZE_MIN}
                    max={GOAL_SIZE_MAX}
                    step={5}
                    value={custom.size}
                    format={(value) => `${value}%`}
                    onChange={(value) => patchCustom({ size: value })}
                  />
                </Field>
                <Field label="Redondeo">
                  <Range
                    label="Redondeo de las esquinas"
                    min={0}
                    max={GOAL_RADIUS_MAX}
                    value={custom.radius}
                    format={(value) => String(value)}
                    onChange={(value) => patchCustom({ radius: value })}
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Toggle label="Título" checked={custom.showTitle} onChange={(next) => patchCustom({ showTitle: next })} />
                  <Toggle
                    label="Meta y unidad"
                    checked={custom.showTarget}
                    onChange={(next) => patchCustom({ showTarget: next })}
                  />
                </div>
              </div>
            )}

            <Field label="Color de avance" hint="El texto que va encima se aclara u oscurece solo para que se lea.">
              <div className="cab-sw">
                {ACCENTS.map((accent) => (
                  <button
                    key={accent.color}
                    type="button"
                    style={{ background: accent.color }}
                    aria-label={accent.name}
                    aria-pressed={activeGoal.accentColor === accent.color}
                    onClick={() => patch({ accentColor: accent.color })}
                  />
                ))}
                <input
                  type="color"
                  value={activeGoal.accentColor}
                  aria-label="Otro color"
                  onChange={(e) => patch({ accentColor: e.target.value })}
                />
              </div>
            </Field>

            <details className="studio-details">
              <summary>Al completar</summary>
              <div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Toggle
                    label="Confeti"
                    checked={activeGoal.confetti !== false}
                    onChange={(next) => patch({ confetti: next })}
                  />
                  <Toggle
                    label="Sacudir la pantalla"
                    checked={Boolean(activeGoal.victoryScreenShake)}
                    onChange={(next) => patch({ victoryScreenShake: next })}
                  />
                </div>

                <Field
                  label="Vídeo"
                  hint={
                    activeGoal.victoryVideoUrl
                      ? `Archivo: ${activeGoal.victoryVideoName || 'vídeo sin nombre'}`
                      : 'Sin vídeo. Acepta WebM y MP4; aparece en el centro de la pantalla.'
                  }
                >
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="cab-btn2 cab-btn-sm" onClick={() => setVault('video')}>
                      Elegir de la biblioteca
                    </button>
                    <label className="cab-btn2 cab-btn-sm" htmlFor={`${uid}-video-file`}>
                      Subir archivo
                    </label>
                    <input
                      id={`${uid}-video-file`}
                      type="file"
                      accept="video/webm,video/mp4"
                      className="studio-file"
                      onChange={handleVideoUpload}
                    />
                    {activeGoal.victoryVideoUrl && (
                      <button
                        type="button"
                        className="cab-btn2 cab-btn-sm"
                        onClick={() => patch({ victoryVideoUrl: undefined, victoryVideoName: undefined })}
                      >
                        Quitar vídeo
                      </button>
                    )}
                  </div>
                </Field>

                <Field label="Sonido" htmlFor={`${uid}-sound`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      id={`${uid}-sound`}
                      className="cab-inp flex-1 basis-48"
                      value={hasFile || wantsFile ? 'file' : activeGoal.victorySoundType}
                      onChange={(e) => chooseSound(e.target.value)}
                    >
                      {SOUNDS.map((sound) => (
                        <option key={sound.id} value={sound.id}>
                          {sound.name}
                        </option>
                      ))}
                      <option value="file">Archivo propio</option>
                    </select>
                    <button
                      type="button"
                      className="cab-btn2"
                      onClick={() =>
                        playAlertOrCustomSound(activeGoal.victoryCustomAudioUrl, activeGoal.victorySoundType, volume)
                      }
                    >
                      <Play className="h-4 w-4" />
                      <span>Escuchar</span>
                    </button>
                  </div>

                  {(hasFile || wantsFile) && (
                    <div className="grid gap-3 rounded border border-[color:var(--cb-line)] p-3">
                      <p className="cab-hint">
                        {hasFile
                          ? `Archivo: ${activeGoal.victoryCustomAudioName || 'sin nombre'}`
                          : `Elige un sonido de hasta ${MAX_AUDIO_DURATION_SECONDS} segundos.`}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="cab-btn2 cab-btn-sm" onClick={() => setVault('audio')}>
                          Elegir de la biblioteca
                        </button>
                        <label className="cab-btn2 cab-btn-sm" htmlFor={`${uid}-audio-file`}>
                          Subir archivo
                        </label>
                        <input
                          id={`${uid}-audio-file`}
                          type="file"
                          accept="audio/*"
                          className="studio-file"
                          onChange={handleAudioUpload}
                        />
                        {hasFile && (
                          <button
                            type="button"
                            className="cab-btn2 cab-btn-sm"
                            onClick={() => patch({ victoryCustomAudioUrl: undefined, victoryCustomAudioName: undefined })}
                          >
                            Quitar
                          </button>
                        )}
                      </div>
                      {audioError && (
                        <p className="cab-error" role="alert">
                          {audioError}
                        </p>
                      )}
                      {hasFile && (
                        <Range
                          label="Volumen del archivo"
                          min={0}
                          max={1}
                          step={0.05}
                          value={volume}
                          format={(value) => `${Math.round(value * 100)}%`}
                          onChange={(value) => patch({ victoryCustomAudioVolume: value })}
                        />
                      )}
                    </div>
                  )}
                </Field>
              </div>
            </details>

            <details className="studio-details">
              <summary>Voz</summary>
              <div>
                <Toggle
                  label="Anunciar cada avance"
                  checked={goalsSettings.announceProgress}
                  onChange={(next) => updateSettings({ announceProgress: next })}
                />
                <Toggle
                  label="Anunciar al llegar al 25, 50, 75 y 100 %"
                  checked={goalsSettings.announceMilestones}
                  onChange={(next) => updateSettings({ announceMilestones: next })}
                />
                <p className="cab-hint">Vale para todas las metas. Los anuncios usan la voz del navegador.</p>
              </div>
            </details>
          </section>

          {/* ---------- Monitor ---------- */}
          <section
            className="cab-mod max-[1199px]:order-first min-[1200px]:sticky min-[1200px]:top-4"
            data-tour="goals-monitor"
          >
            <h2>Monitor</h2>
            <div ref={stageRef} className="cab-stage items-start justify-center">
              <canvas ref={canvasRef} width={900} height={506} className="capas-cover z-20" />
              {monitorVideo && (
                <div className="capas-cover z-10" data-video="">
                  <video
                    src={monitorVideo}
                    autoPlay
                    playsInline
                    style={{ mixBlendMode: activeGoal.victoryBlendMode === 'screen' ? 'screen' : 'normal' }}
                  />
                </div>
              )}
              <GoalsOverlayView
                goals={previewGoals}
                activeGoalId={activeGoal.id}
                displayMode={goalsSettings.displayMode}
                slideshowIntervalSec={goalsSettings.slideshowIntervalSec}
                position={goalsSettings.position}
                recentProgressGoalId={recentGoalId}
                onSelectGoal={select}
                isStudio={true}
              />
            </div>

            <Field
              label="Probar"
              hint="Las pruebas mueven la meta elegida en este monitor y en las fuentes de OBS abiertas, sin cambiar lo guardado. Los hitos son el 25, 50 y 75 %."
            >
              <div className="flex flex-wrap gap-2">
                <button type="button" className="cab-btn2 cab-btn-sm" onClick={() => runTest(1)}>
                  Aporte +1
                </button>
                <button type="button" className="cab-btn2 cab-btn-sm" onClick={() => runTest(5)}>
                  Aporte +5
                </button>
                <button type="button" className="cab-btn2 cab-btn-sm" onClick={() => runTest('hito')}>
                  Hasta el siguiente hito
                </button>
                <button type="button" className="cab-btn2 cab-btn-sm" onClick={() => runTest('fin')}>
                  Completar
                </button>
                <button type="button" className="cab-btn2 cab-btn-sm" onClick={resetTest}>
                  Reiniciar
                </button>
                <button type="button" className="cab-btn2 cab-btn-sm" onClick={testCelebration}>
                  Probar celebración
                </button>
              </div>
            </Field>

            <button type="button" className="cab-btn2" onClick={copyWidgetUrl}>
              {copiedUrl ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              <span>{copiedUrl ? 'URL copiada' : 'Copiar URL para OBS'}</span>
            </button>
            <p className="cab-hint" role="status">
              {status ||
                (hasTest
                  ? 'El monitor y OBS muestran una prueba. Tus metas guardadas no han cambiado.'
                  : 'El monitor muestra tus metas tal como están guardadas.')}
            </p>
          </section>
        </div>

        <MediaLibraryModal
          isOpen={vault !== null}
          onClose={() => setVault(null)}
          onSelect={handleVaultSelect}
          allowedTypes={[vault || 'video']}
          title={vault === 'audio' ? 'Biblioteca · elegir sonido (máximo 30 s)' : 'Biblioteca · elegir vídeo'}
        />
      </div>

      {tourOpen && <GuidedTour steps={GOALS_TOUR_STEPS} onClose={() => setTourOpen(false)} id={TOUR_ID} appName="Metas" />}
    </div>
  );
};
