/**
 * src/pages/RouletteStudio.tsx
 *
 * Estudio de la Ruleta de Castigos sobre la plantilla común del panel:
 * a la izquierda se edita, a la derecha el monitor 16:9 queda siempre a la vista.
 *
 * - Cada segmento se edita en su propia fila.
 * - «Cargar plantilla» reemplaza los segmentos, lo avisa y se puede deshacer.
 * - «Cómo se gira»: la ruleta se abre y se cierra (aquí o con un comando y su
 *   nombre) y la giran los puntos del canal o los bits. Nadie la gira con un
 *   comando.
 * - Para probar: Girar, y un canje o un cheer simulados que pasan por las mismas
 *   reglas que en directo. El giro también llega a las fuentes de la ruleta
 *   abiertas en este navegador.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import gsap from 'gsap';
import { Check, Copy, Play, Plus, RotateCw, Trash2 } from 'lucide-react';
import { RouletteTriggerFields } from '../components/roulette/RouletteTriggerFields';
import { SuiteNav } from '../components/SuiteNav';
import { useRouletteSettings } from '../hooks/useRouletteSettings';
import {
  CATEGORY_LABELS,
  PenaltyCategory,
  ROULETTE_PRESETS,
  ROULETTE_STYLE_PRESETS,
  RouletteSegment,
  VIBRANT_SEGMENT_COLORS,
  encodeRouletteSettings,
} from '../types/roulette';
import { AlertSoundType } from '../types/alerts';
import { playAlertOrCustomSound } from '../utils/alertsAudio';
import { RouletteOverlayView } from '../components/roulette/RouletteOverlayView';
import { speakRoulettePreview, stopRoulettePreview } from '../utils/rouletteAudio';
import { IncomingTrigger, judgeTrigger, spinAnnouncement, triggerRuleText, winnerAnnouncement } from '../utils/rouletteLogic';
import { emptyGate } from '../utils/rewardsLogic';
import { loadSettings, saveSettings } from '../types/settings';
import { useVoiceCatalogue } from '../hooks/useVoiceCatalogue';
import { MediaLibraryModal } from '../components/MediaLibraryModal';
import { MediaItem } from '../types/mediaLibrary';
import { GuidedTour, TourStep, isTourDone } from '../components/GuidedTour';
import { buildSuiteWidgetUrl } from '../utils/widgetUrl';
import { useCloudSession } from '../hooks/useCloudSession';

const TOUR_ID = 'ruleta';

const ROULETTE_TOUR_STEPS: TourStep[] = [
  {
    badge: 'Bienvenida',
    title: 'Ruleta de castigos',
    body: 'Aquí preparas la rueda de retos y castigos que gira en tu directo.',
  },
  {
    target: 'roulette-segments',
    badge: 'Segmentos',
    title: 'Lo que puede salir',
    body: 'Cada fila es un segmento: cambia el texto, el color, la categoría o los segundos del reto. El interruptor lo saca de la rueda sin borrarlo.',
  },
  {
    target: 'roulette-trigger',
    badge: 'Giros',
    title: 'Cómo se gira',
    body: 'Abre la ruleta aquí o con tu comando y su nombre. Mientras está abierta la giran los puntos del canal o los bits, lo que elijas.',
  },
  {
    target: 'roulette-actions',
    badge: 'Al caer',
    title: 'Qué pasa cuando se detiene',
    body: 'Sacudida, confeti, sonido y la voz que anuncia el giro y el resultado.',
  },
  {
    target: 'roulette-monitor',
    badge: 'Monitor',
    title: 'Gira y copia la URL',
    body: '«Girar» prueba la rueda aquí. «Simular canje» y «Simular cheer» comprueban lo que pasaría en directo. «Copiar URL para OBS» te da la fuente de navegador a 1920 × 1080.',
  },
];

const SOUNDS: { id: AlertSoundType; name: string }[] = [
  { id: 'arcade-chime', name: 'Arcade' },
  { id: 'retro-fanfare', name: 'Fanfarria' },
  { id: 'synth-bell', name: 'Campana' },
  { id: 'soft-pop', name: 'Pop suave' },
  { id: 'none', name: 'Sin sonido' },
];

const CATEGORIES = Object.entries(CATEGORY_LABELS) as [PenaltyCategory, { label: string }][];

const Toggle: React.FC<{ label: string; checked: boolean; onChange: (next: boolean) => void }> = ({
  label,
  checked,
  onChange,
}) => {
  const id = useId();
  return (
    <div className="flex items-center gap-3">
      <input id={id} type="checkbox" className="cab-tog" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id}>{label}</label>
    </div>
  );
};

export const RouletteStudio: React.FC = () => {
  const { rouletteSettings, saved, updateSettings, updateSegment, addSegment, loadPreset, triggerSpin } =
    useRouletteSettings();
  const cloud = useCloudSession();
  const uid = useId();

  const [copiedUrl, setCopiedUrl] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const [startRotation, setStartRotation] = useState(0);
  const [currentRotation, setCurrentRotation] = useState(0);
  const [targetWinner, setTargetWinner] = useState<RouletteSegment | undefined>(undefined);
  const [activeWinner, setActiveWinner] = useState<{ segment: RouletteSegment; user: string } | null>(null);
  // Quién gira en el monitor: el streamer en una prueba o el espectador de un canje simulado
  const [spinUser, setSpinUser] = useState('Streamer');
  const [confettiActive, setConfettiActive] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [presetChoice, setPresetChoice] = useState('');
  // Segmentos anteriores a la última acción destructiva, para deshacerla
  const [undo, setUndo] = useState<{ label: string; segments: RouletteSegment[] } | null>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const segments = rouletteSettings.segments;
  const activeCount = segments.filter((segment) => segment.enabled).length;
  const canSpin = activeCount >= 2;

  // La guía se abre sola la primera vez
  useEffect(() => {
    if (isTourDone(TOUR_ID)) return;
    const timer = setTimeout(() => setTourOpen(true), 600);
    return () => clearTimeout(timer);
  }, []);

  useEffect(
    () => () => {
      if (statusTimer.current) clearTimeout(statusTimer.current);
      stopRoulettePreview();
    },
    []
  );

  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), 8000);
    return () => clearTimeout(timer);
  }, [undo]);

  const say = (message: string) => {
    setStatus(message);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(null), 4000);
  };

  // Lluvia de confeti sobre el monitor
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
      color: VIBRANT_SEGMENT_COLORS[Math.floor(Math.random() * VIBRANT_SEGMENT_COLORS.length)],
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

  // ---------- Girar ----------
  // La voz de la prueba: una sola frase a la vez, con la voz de «Voz del chat». Si hay una fuente de
  // la ruleta abierta en este navegador, la dice ella por su cola de voz y el panel calla
  const announce = (text: string) => {
    speakRoulettePreview(text).then((who) => {
      if (who === 'none') say('El servicio de voz no respondió: la prueba sigue sin voz.');
    });
  };

  const startSpin = (user: string, why: string | undefined, note: string) => {
    if (isSpinning || !canSpin) return;
    setActiveWinner(null);
    const spinEvent = triggerSpin(user, undefined, why);
    if (!spinEvent) {
      say('No se pudo iniciar el giro. Comprueba que hay segmentos activos.');
      return;
    }
    setSpinUser(user);
    setIsSpinning(true);
    setStartRotation(spinEvent.startRotation ?? currentRotation % 360);
    setCurrentRotation(spinEvent.finalRotation);
    setTargetWinner(spinEvent.winnerSegment);
    say(note);
    if (rouletteSettings.ttsAnnounceSpin !== false) announce(spinAnnouncement(user, rouletteSettings.title));
  };

  const spin = () => startSpin('Streamer', undefined, 'Girando aquí y en las fuentes de la ruleta abiertas en este navegador.');

  /** Un canje o un cheer de mentira que pasa por las mismas reglas que uno de verdad. */
  const simulate = (kind: 'points' | 'bits') => {
    if (isSpinning || !canSpin) return;
    if (rouletteSettings.triggerKind !== kind) {
      say(
        kind === 'points'
          ? 'La ruleta está puesta para girar con bits: un canje de puntos no la mueve.'
          : 'La ruleta está puesta para girar con puntos de canal: un cheer no la mueve.'
      );
      return;
    }
    if (kind === 'points' && !rouletteSettings.twitchRewardId) {
      say('Aún no hay recompensa de Twitch enlazada: en directo ningún canje la giraría. Pulsa «Detectar».');
      return;
    }
    const who = { user: 'mar_ia', username: 'mar_ia', role: 'viewer' as const, via: 'test' as const };
    const incoming: IncomingTrigger =
      kind === 'points'
        ? { kind: 'points', rewardId: rouletteSettings.twitchRewardId, ...who }
        : { kind: 'bits', bits: rouletteSettings.bitsMin, ...who };
    const verdict = judgeTrigger(rouletteSettings, incoming, {
      active: rouletteSettings.active,
      activeSegments: activeCount,
      gate: emptyGate(),
      now: Date.now(),
    });
    if (!verdict.ok) {
      say(
        verdict.reason === 'closed'
          ? 'La ruleta está cerrada: en directo este giro se descartaría. Ábrela en «Cómo se gira» y prueba otra vez.'
          : verdict.message || 'Ese disparo no gira la ruleta.'
      );
      return;
    }
    startSpin(who.user, verdict.why, `${verdict.why} de ${who.user}: gira como en directo.`);
  };

  const handleWheelComplete = (winner: RouletteSegment) => {
    setIsSpinning(false);
    // La rueda descansa donde cayó
    setStartRotation(((currentRotation % 360) + 360) % 360);
    setActiveWinner({ segment: winner, user: spinUser });

    playAlertOrCustomSound(
      rouletteSettings.victoryCustomAudioUrl,
      rouletteSettings.victorySoundType,
      rouletteSettings.victoryCustomAudioVolume ?? 0.85
    );
    if (rouletteSettings.ttsAnnounceWinner !== false) announce(winnerAnnouncement(winner, spinUser));
    if (rouletteSettings.confetti) setConfettiActive(true);
    if (rouletteSettings.screenShake && stageRef.current) {
      gsap.fromTo(
        stageRef.current,
        { x: -16, y: 12, rotate: -1.2 },
        { x: 0, y: 0, rotate: 0, duration: 0.75, ease: 'elastic.out(1.2, 0.18)', clearProps: 'transform' }
      );
    }
    say(`Salió «${winner.text}».`);
  };

  // ---------- Segmentos ----------
  const addBlank = () => {
    const color = VIBRANT_SEGMENT_COLORS[segments.length % VIBRANT_SEGMENT_COLORS.length];
    addSegment({
      id: `seg-${Date.now()}`,
      text: 'Nuevo castigo',
      category: 'custom',
      color,
      intensity: 'medium',
      enabled: true,
    });
  };

  const removeSegment = (segment: RouletteSegment) => {
    setUndo({ label: `Se quitó «${segment.text}».`, segments });
    updateSettings({ segments: segments.filter((entry) => entry.id !== segment.id) });
  };

  const applyPreset = () => {
    const preset = ROULETTE_PRESETS.find((entry) => entry.id === presetChoice);
    if (!preset) return;
    setUndo({ label: `Se cargó la plantilla «${preset.name}» y reemplazó tus segmentos.`, segments });
    loadPreset(preset.id);
    setPresetChoice('');
  };

  const restore = () => {
    if (!undo) return;
    updateSettings({ segments: undo.segments });
    setUndo(null);
  };

  // ---------- Sonido ----------
  const hasFile = Boolean(rouletteSettings.victoryCustomAudioUrl);
  const chooseSound = (value: string) => {
    if (value === 'file') {
      setVaultOpen(true);
      return;
    }
    updateSettings({ victorySoundType: value as AlertSoundType, victoryCustomAudioUrl: undefined });
  };
  const handleVaultSelect = (media: MediaItem) => {
    setVaultOpen(false);
    updateSettings({ victoryCustomAudioUrl: media.url, victorySoundType: 'none' });
    say(`Sonido «${media.name}» asignado.`);
  };

  // ---------- URL de OBS ----------
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const copyWidgetUrl = () => {
    // Con cuenta en la nube viaja la clave; sin ella, los ajustes enteros van en la URL
    const url = buildSuiteWidgetUrl(
      baseUrl,
      'roulette',
      rouletteSettings.channel,
      loadSettings(),
      // Con cuenta va la clave y, de reserva, los ajustes: si la nube no responde, la fuente usa los de la URL
      { ...(cloud.profile?.status === 'active' ? { k: cloud.profile.widget_key } : {}), rl: encodeRouletteSettings(rouletteSettings) }
    );
    navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopiedUrl(true);
        setTimeout(() => setCopiedUrl(false), 2200);
      })
      .catch(() => say('No se pudo copiar. Usa «Fuentes de OBS» en la cabecera.'));
  };

  // El nombre sale del catálogo. Si la voz guardada ya no está en él, se pasa a la voz por defecto
  const voiceList = useVoiceCatalogue(loadSettings().referenceId, (defaultId) =>
    saveSettings({ ...loadSettings(), referenceId: defaultId })
  );
  const voiceName =
    voiceList.catalogue.voices.find((voice) => voice.id === loadSettings().referenceId)?.name || 'voz personalizada';

  return (
    <div className="cab" style={{ paddingBottom: tourOpen ? 220 : undefined }}>
      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-6">
        <SuiteNav
          currentApp="ruleta"
          channel={rouletteSettings.channel}
          saved={saved}
          onOpenTour={() => setTourOpen(true)}
          tourAvailable={!tourOpen}
        />

        <div className="grid items-start gap-5 min-[1100px]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <div className="grid gap-5">
            {/* ---------- Segmentos ---------- */}
            <section className="cab-mod" data-tour="roulette-segments">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2>Segmentos</h2>
                <span className="cab-hint">
                  {activeCount} de {segments.length} activos
                </span>
              </div>

              {segments.length === 0 ? (
                <p className="cab-note">La rueda está vacía. Añade un segmento o carga una plantilla.</p>
              ) : (
                <ul className="cab-rows studio-segs !max-h-none">
                  {segments.map((segment) => (
                    <li key={segment.id} className="studio-seg" data-off={segment.enabled ? undefined : ''}>
                      <input
                        type="color"
                        className="studio-color"
                        value={segment.color}
                        aria-label={`Color de ${segment.text}`}
                        onChange={(e) => updateSegment(segment.id, { color: e.target.value })}
                      />
                      <input
                        className="cab-inp studio-seg-text"
                        value={segment.text}
                        aria-label="Texto del segmento"
                        onChange={(e) => updateSegment(segment.id, { text: e.target.value })}
                      />
                      <select
                        className="cab-inp studio-seg-cat"
                        value={segment.category}
                        aria-label={`Categoría de ${segment.text}`}
                        onChange={(e) => updateSegment(segment.id, { category: e.target.value as PenaltyCategory })}
                      >
                        {CATEGORIES.map(([id, meta]) => (
                          <option key={id} value={id}>
                            {meta.label}
                          </option>
                        ))}
                      </select>
                      <label className="studio-seg-time">
                        <input
                          type="number"
                          min={0}
                          max={3600}
                          className="cab-inp cab-mono"
                          title="Segundos del reto. Con 0 no hay cuenta atrás."
                          value={segment.durationSec ?? 0}
                          aria-label={`Segundos del reto ${segment.text}`}
                          onChange={(e) => {
                            const seconds = Math.max(0, Math.round(Number(e.target.value) || 0));
                            updateSegment(segment.id, { durationSec: seconds > 0 ? seconds : undefined });
                          }}
                        />
                        <span className="cab-hint">s</span>
                      </label>
                      <input
                        type="checkbox"
                        className="cab-tog"
                        checked={segment.enabled}
                        aria-label={`Incluir ${segment.text} en la rueda`}
                        onChange={(e) => updateSegment(segment.id, { enabled: e.target.checked })}
                      />
                      <button
                        type="button"
                        className="cab-icon"
                        aria-label={`Quitar ${segment.text}`}
                        title="Quitar"
                        onClick={() => removeSegment(segment)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <p className="cab-hint">Los segundos son la cuenta atrás del reto; con 0 no hay temporizador.</p>

              {undo && (
                <p className="cab-note" role="status">
                  {undo.label}{' '}
                  <button type="button" className="studio-link" onClick={restore}>
                    Deshacer
                  </button>
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2" data-tour="roulette-presets">
                <button type="button" className="cab-btn2" onClick={addBlank}>
                  <Plus className="h-4 w-4" />
                  <span>Añadir segmento</span>
                </button>
                <select
                  className="cab-inp w-auto flex-1 basis-52"
                  value={presetChoice}
                  aria-label="Plantilla de segmentos"
                  onChange={(e) => setPresetChoice(e.target.value)}
                >
                  <option value="">Cargar una plantilla</option>
                  {ROULETTE_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
                {presetChoice && (
                  <button type="button" className="cab-btn2" onClick={applyPreset}>
                    Reemplazar mis segmentos
                  </button>
                )}
              </div>
            </section>

            {/* ---------- Cómo se gira ---------- */}
            <section className="cab-mod" data-tour="roulette-trigger">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2>Cómo se gira</h2>
                <span className="cab-hint">Con {triggerRuleText(rouletteSettings)}</span>
              </div>
              <RouletteTriggerFields settings={rouletteSettings} update={updateSettings} onNote={say} />
            </section>

            {/* ---------- Al caer ---------- */}
            <section className="cab-mod" data-tour="roulette-actions">
              <h2>Al caer</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <Toggle
                  label="Mostrar el resultado en pantalla"
                  checked={rouletteSettings.showWinnerBanner}
                  onChange={(next) => updateSettings({ showWinnerBanner: next })}
                />
                <Toggle
                  label="Sacudir la pantalla"
                  checked={rouletteSettings.screenShake}
                  onChange={(next) => updateSettings({ screenShake: next })}
                />
                <Toggle label="Confeti" checked={rouletteSettings.confetti} onChange={(next) => updateSettings({ confetti: next })} />
                <Toggle
                  label="Anunciar el giro con voz"
                  checked={rouletteSettings.ttsAnnounceSpin !== false}
                  onChange={(next) => updateSettings({ ttsAnnounceSpin: next })}
                />
                <Toggle
                  label="Anunciar el resultado con voz"
                  checked={rouletteSettings.ttsAnnounceWinner !== false}
                  onChange={(next) => updateSettings({ ttsAnnounceWinner: next })}
                />
              </div>
              <p className="cab-hint">
                La voz es la de «Voz del chat»: {voiceName}.{' '}
                <a className="studio-link" href="#tts">
                  Cambiarla
                </a>
              </p>

              <div className="cab-field">
                <label className="cab-label" htmlFor={`${uid}-sound`}>
                  Sonido
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    id={`${uid}-sound`}
                    className="cab-inp flex-1 basis-48"
                    value={hasFile ? 'file' : rouletteSettings.victorySoundType}
                    onChange={(e) => chooseSound(e.target.value)}
                  >
                    {SOUNDS.map((sound) => (
                      <option key={sound.id} value={sound.id}>
                        {sound.name}
                      </option>
                    ))}
                    <option value="file">Archivo de la biblioteca</option>
                  </select>
                  <button
                    type="button"
                    className="cab-btn2"
                    onClick={() =>
                      playAlertOrCustomSound(
                        rouletteSettings.victoryCustomAudioUrl,
                        rouletteSettings.victorySoundType,
                        rouletteSettings.victoryCustomAudioVolume ?? 0.85
                      )
                    }
                  >
                    <Play className="h-4 w-4" />
                    <span>Escuchar</span>
                  </button>
                </div>
                {hasFile && (
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="cab-range flex-1 basis-48">
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={rouletteSettings.victoryCustomAudioVolume ?? 0.85}
                        aria-label="Volumen del archivo"
                        onChange={(e) => updateSettings({ victoryCustomAudioVolume: Number(e.target.value) })}
                      />
                      <output>{Math.round((rouletteSettings.victoryCustomAudioVolume ?? 0.85) * 100)}%</output>
                    </div>
                    <button type="button" className="cab-btn2 cab-btn-sm" onClick={() => setVaultOpen(true)}>
                      Cambiar archivo
                    </button>
                  </div>
                )}
              </div>

              <details className="studio-details" data-tour="roulette-appearance">
                <summary>Avanzado</summary>
                <div>
                  <div className="cab-field">
                    <label className="cab-label" htmlFor={`${uid}-title`}>
                      Título
                    </label>
                    <input
                      id={`${uid}-title`}
                      className="cab-inp"
                      value={rouletteSettings.title}
                      onChange={(e) => updateSettings({ title: e.target.value })}
                    />
                    <span className="cab-hint">Aparece bajo la rueda y es lo que dice la voz al anunciar el giro.</span>
                  </div>
                  <div className="cab-field">
                    <span className="cab-label">Estilo</span>
                    <div className="cab-seg" role="group" aria-label="Estilo de la ruleta">
                      {ROULETTE_STYLE_PRESETS.map((style) => (
                        <button
                          key={style.id}
                          type="button"
                          aria-pressed={rouletteSettings.style === style.id}
                          onClick={() => updateSettings({ style: style.id })}
                        >
                          {style.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="cab-field">
                      <span className="cab-label">Duración del giro</span>
                      <div className="cab-range">
                        <input
                          type="range"
                          min={3}
                          max={12}
                          step={0.5}
                          value={rouletteSettings.spinDurationSec}
                          aria-label="Duración del giro"
                          onChange={(e) => updateSettings({ spinDurationSec: Number(e.target.value) })}
                        />
                        <output>{rouletteSettings.spinDurationSec} s</output>
                      </div>
                    </div>
                    <div className="cab-field">
                      <span className="cab-label">Resultado en pantalla</span>
                      <div className="cab-range">
                        <input
                          type="range"
                          min={3}
                          max={30}
                          step={1}
                          value={rouletteSettings.winnerBannerDurationSec || 8}
                          aria-label="Segundos que dura el resultado en pantalla"
                          onChange={(e) => updateSettings({ winnerBannerDurationSec: Number(e.target.value) })}
                        />
                        <output>{rouletteSettings.winnerBannerDurationSec || 8} s</output>
                      </div>
                    </div>
                  </div>
                  <Toggle
                    label="Sonido de la rueda al girar"
                    checked={rouletteSettings.soundEnabled}
                    onChange={(next) => updateSettings({ soundEnabled: next })}
                  />
                  {rouletteSettings.soundEnabled && (
                    <div className="cab-field">
                      <span className="cab-label">Volumen de la rueda</span>
                      <div className="cab-range">
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={rouletteSettings.tickVolume}
                          aria-label="Volumen de la rueda"
                          onChange={(e) => updateSettings({ tickVolume: Number(e.target.value) })}
                        />
                        <output>{Math.round(rouletteSettings.tickVolume * 100)}%</output>
                      </div>
                    </div>
                  )}
                </div>
              </details>
            </section>
          </div>

          {/* ---------- Monitor ---------- */}
          <section
            className="cab-mod max-[1099px]:order-first min-[1100px]:sticky min-[1100px]:top-4"
            data-tour="roulette-monitor"
          >
            <h2>Monitor</h2>
            <div ref={stageRef} className="cab-stage items-center justify-center">
              <canvas ref={canvasRef} width={900} height={506} className="pointer-events-none absolute inset-0 z-20 h-full w-full" />
              <RouletteOverlayView
                settings={rouletteSettings}
                targetRotation={currentRotation}
                startRotation={startRotation}
                targetWinner={targetWinner}
                isSpinning={isSpinning}
                activeUser={spinUser}
                winnerBanner={rouletteSettings.showWinnerBanner ? activeWinner : null}
                onSpinComplete={handleWheelComplete}
                onBannerDismiss={() => setActiveWinner(null)}
                isStudio={true}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" className="cab-btn flex-1" disabled={isSpinning || !canSpin} onClick={spin}>
                <RotateCw className={`h-4 w-4 ${isSpinning ? 'animate-spin' : ''}`} />
                <span>{isSpinning ? 'Girando' : 'Girar'}</span>
              </button>
              <button type="button" className="cab-btn2 flex-1" onClick={copyWidgetUrl} data-tour="roulette-obs">
                {copiedUrl ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span>{copiedUrl ? 'URL copiada' : 'Copiar URL para OBS'}</span>
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="cab-btn2 cab-btn-sm flex-1" disabled={isSpinning || !canSpin} onClick={() => simulate('points')}>
                Simular canje
              </button>
              <button type="button" className="cab-btn2 cab-btn-sm flex-1" disabled={isSpinning || !canSpin} onClick={() => simulate('bits')}>
                Simular cheer
              </button>
            </div>
            <p className="cab-hint" role="status">
              {!canSpin
                ? 'Para girar hacen falta al menos dos segmentos activos.'
                : status ||
                  (cloud.profile?.status === 'active'
                    ? 'La prueba suena aquí. A OBS le llegan los ajustes solos, por la nube.'
                    : 'La prueba suena aquí. Sin cuenta en la nube, los ajustes viajan en la URL: cópiala otra vez en OBS cuando cambies algo.')}
            </p>
          </section>
        </div>

        <MediaLibraryModal
          isOpen={vaultOpen}
          onClose={() => setVaultOpen(false)}
          onSelect={handleVaultSelect}
          allowedTypes={['audio']}
          title="Biblioteca · elegir sonido (máximo 30 s)"
        />
      </div>

      {tourOpen && (
        <GuidedTour steps={ROULETTE_TOUR_STEPS} onClose={() => setTourOpen(false)} id={TOUR_ID} appName="Ruleta" />
      )}
    </div>
  );
};
