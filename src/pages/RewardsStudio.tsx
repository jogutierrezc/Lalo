/**
 * src/pages/RewardsStudio.tsx
 *
 * Estudio de Recompensas sobre la plantilla común del panel: lista de
 * recompensas, editor de la elegida y monitor 16:9 siempre a la vista.
 *
 * - Lo básico (nombre, costo, texto y color) está abierto; vídeo, sonido y el
 *   resto van plegados.
 * - Hay una sola forma de probar: el botón bajo el monitor. La prueba suena
 *   aquí y se envía a las fuentes de OBS abiertas, sin gastar puntos.
 * - El color de una recompensa solo tiñe su aviso, no el panel.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import gsap from 'gsap';
import { Check, Copy, Play, Plus, Trash2 } from 'lucide-react';
import { SuiteNav } from '../components/SuiteNav';
import { useRewardsSettings } from '../hooks/useRewardsSettings';
import {
  CustomRewardItem,
  RewardBlendMode,
  RewardVideoPosition,
  buildRewardNotice,
} from '../types/rewards';
import { AlertSoundType } from '../types/alerts';
import { playAlertOrCustomSound } from '../utils/alertsAudio';
import { postBus } from '../utils/bus';
import { inkFor } from '../utils/appearance';
import { MediaLibraryModal } from '../components/MediaLibraryModal';
import { MediaItem, MediaType, inspectAudioFile, MAX_AUDIO_DURATION_SECONDS } from '../types/mediaLibrary';
import { GuidedTour, TourStep, isTourDone } from '../components/GuidedTour';
import { Field, Range, Toggle, UndoNote, useUndo } from '../components/studio/StudioKit';
import { buildSuiteWidgetUrl } from '../utils/widgetUrl';
import { loadSettings } from '../types/settings';
import { useCloudSession } from '../hooks/useCloudSession';
import '../styles/capas.css';

const TOUR_ID = 'recompensas';

const REWARDS_TOUR_STEPS: TourStep[] = [
  {
    badge: 'Bienvenida',
    title: 'Recompensas',
    body: 'Aquí decides qué aparece y qué suena cuando alguien canjea puntos del canal.',
  },
  {
    target: 'rewards-list',
    badge: 'Lista',
    title: 'Elige una recompensa',
    body: 'Cada fila es una recompensa con su costo. «Nueva recompensa» añade otra.',
  },
  {
    target: 'reward-editor',
    badge: 'Editor',
    title: 'Nombre, costo y texto',
    body: 'Lo básico está a la vista. El vídeo, el sonido, la posición y el resto están plegados debajo.',
  },
  {
    target: 'rewards-monitor',
    badge: 'Monitor',
    title: 'Prueba y copia la URL',
    body: '«Probar» muestra el aviso aquí y en las fuentes de OBS abiertas, sin gastar puntos. «Copiar URL para OBS» te da la fuente de navegador a 1920 × 1080.',
  },
];

const ACCENTS = [
  { color: '#9146ff', name: 'Morado' },
  { color: '#ff2d46', name: 'Rojo' },
  { color: '#53fc18', name: 'Verde' },
  { color: '#ffb020', name: 'Ámbar' },
  { color: '#22c7e0', name: 'Cian' },
  { color: '#ff6b4a', name: 'Coral' },
];

const SOUNDS: { id: AlertSoundType; name: string }[] = [
  { id: 'arcade-chime', name: 'Arcade' },
  { id: 'retro-fanfare', name: 'Fanfarria' },
  { id: 'synth-bell', name: 'Campana' },
  { id: 'soft-pop', name: 'Pop suave' },
  { id: 'none', name: 'Sin sonido' },
];

const POSITIONS: { id: RewardVideoPosition; name: string }[] = [
  { id: 'center', name: 'Centro' },
  { id: 'fullscreen', name: 'Pantalla completa' },
  { id: 'top-left', name: 'Arriba a la izquierda' },
  { id: 'top-right', name: 'Arriba a la derecha' },
  { id: 'bottom-left', name: 'Abajo a la izquierda' },
  { id: 'bottom-right', name: 'Abajo a la derecha' },
];

const BLEND_MODES: { id: RewardBlendMode; label: string }[] = [
  { id: 'transparent', label: 'Vídeo con transparencia (WebM)' },
  { id: 'screen', label: 'Quitar el fondo negro' },
  { id: 'chroma-green', label: 'Quitar el fondo verde' },
];

const STAGE_POSITION: Record<RewardVideoPosition, string> = {
  center: 'items-center justify-center',
  fullscreen: 'items-center justify-center',
  'top-left': 'items-start justify-start',
  'top-right': 'items-start justify-end',
  'bottom-left': 'items-end justify-start',
  'bottom-right': 'items-end justify-end',
};

const DEMO_USER = 'EspectadorFan';
const DEMO_MESSAGE = '¡Vamos con todo!';
const DEFAULT_VOLUME = 0.85;
const DEFAULT_DURATION = 5;

export const RewardsStudio: React.FC = () => {
  const { rewardsSettings, updateRewards, updateRewardItem, addRewardItem, deleteRewardItem, saved } =
    useRewardsSettings();
  const cloud = useCloudSession();
  const uid = useId();
  const rewards = rewardsSettings.rewards;

  const [selectedId, setSelectedId] = useState<string>(rewards[0]?.id || '');
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [wantsFile, setWantsFile] = useState(false);
  const [vault, setVault] = useState<MediaType | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const undo = useUndo<{ rewards: CustomRewardItem[]; id: string }>();

  const stageRef = useRef<HTMLDivElement | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // La guía se abre sola la primera vez; después se accede desde la cabecera
  useEffect(() => {
    if (isTourDone(TOUR_ID)) return;
    const timer = setTimeout(() => setTourOpen(true), 600);
    return () => clearTimeout(timer);
  }, []);

  useEffect(
    () => () => {
      if (statusTimer.current) clearTimeout(statusTimer.current);
      if (playTimer.current) clearTimeout(playTimer.current);
    },
    []
  );

  const say = (message: string) => {
    setStatus(message);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(null), 3500);
  };

  // ---------- Recompensa seleccionada ----------
  const reward: CustomRewardItem | undefined = rewards.find((entry) => entry.id === selectedId) || rewards[0];
  const hasFile = Boolean(reward?.customAudioUrl);
  const volume = reward?.customAudioVolume ?? reward?.volume ?? DEFAULT_VOLUME;
  const duration = reward?.duration || DEFAULT_DURATION;

  const stopPlaying = () => {
    if (playTimer.current) clearTimeout(playTimer.current);
    setPlaying(null);
  };

  const select = (id: string) => {
    setSelectedId(id);
    setWantsFile(false);
    setAudioError(null);
    stopPlaying();
  };

  const patch = (value: Partial<CustomRewardItem>) => {
    if (reward) updateRewardItem(reward.id, value);
  };

  const createReward = () => {
    const id = `custom-reward-${Date.now()}`;
    addRewardItem({
      id,
      name: 'Recompensa nueva',
      cost: 500,
      description: '',
      enabled: true,
      cooldownSeconds: 30,
      userInputRequired: false,
      blendMode: 'transparent',
      position: 'center',
      scale: 1,
      volume: DEFAULT_VOLUME,
      showNoticeText: true,
      noticeTemplate: '¡{user} canjeó {reward}!',
      duration: DEFAULT_DURATION,
      screenShake: false,
      soundType: 'arcade-chime',
      accentColor: '#9146ff',
    });
    select(id);
  };

  const removeReward = () => {
    if (!reward) return;
    const index = rewards.findIndex((entry) => entry.id === reward.id);
    const next = rewards[index + 1] || rewards[index - 1];
    undo.offer(`Se eliminó «${reward.name}».`, { rewards, id: reward.id });
    deleteRewardItem(reward.id);
    select(next?.id || '');
  };

  const restoreReward = () => {
    if (!undo.pending) return;
    updateRewards({ rewards: undo.pending.snapshot.rewards });
    select(undo.pending.snapshot.id);
    undo.clear();
  };

  // ---------- Sonido ----------
  const chooseSound = (value: string) => {
    if (value === 'file') {
      setWantsFile(true);
      return;
    }
    setWantsFile(false);
    setAudioError(null);
    patch({ soundType: value as AlertSoundType, customAudioUrl: undefined, customAudioName: undefined });
  };

  const assignAudio = (url: string, name: string) => {
    setWantsFile(false);
    setAudioError(null);
    patch({ customAudioUrl: url, customAudioName: name, customAudioVolume: volume });
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
    patch({ videoUrl: url, videoName: name, blendMode: isWebm ? 'transparent' : 'screen' });
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
  const noticeFor = (item: CustomRewardItem) =>
    item.showNoticeText ? buildRewardNotice(item.noticeTemplate, DEMO_USER, item.name, DEMO_MESSAGE) : '';

  const test = () => {
    if (!reward) return;
    playAlertOrCustomSound(reward.customAudioUrl, reward.soundType || 'arcade-chime', volume);

    if (reward.screenShake && stageRef.current) {
      gsap.fromTo(
        stageRef.current,
        { x: -14, y: 10, rotate: -0.8 },
        { x: 0, y: 0, rotate: 0, duration: 0.65, ease: 'elastic.out(1.2, 0.2)', clearProps: 'transform' }
      );
    }

    if (playTimer.current) clearTimeout(playTimer.current);
    setPlaying(Date.now());
    playTimer.current = setTimeout(() => setPlaying(null), duration * 1000);

    postBus({
      type: 'REWARD_TRIGGER',
      reward: {
        id: `reward-run-${Date.now()}`,
        user: DEMO_USER,
        rewardName: reward.name,
        noticeText: noticeFor(reward),
        videoUrl: reward.videoUrl,
        blendMode: reward.blendMode,
        position: reward.position,
        scale: reward.scale,
        volume: reward.volume,
        screenShake: reward.screenShake,
        accentColor: reward.accentColor,
        soundType: reward.soundType,
        duration,
        customAudioUrl: reward.customAudioUrl,
        customAudioVolume: volume,
      },
    });
    say(`Prueba de «${reward.name}» enviada al monitor y a OBS.`);
  };

  // ---------- URL de OBS ----------
  // Los avisos de recompensa salen en la capa general de la suite
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const copyWidgetUrl = () => {
    const url = buildSuiteWidgetUrl(
      baseUrl,
      'all',
      rewardsSettings.channel,
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

  // ---------- Vista previa ----------
  const showVideo = Boolean(reward?.videoUrl) && playing !== null;
  const showNotice = Boolean(reward) && (reward!.showNoticeText || !reward!.videoUrl);
  const previewText = reward ? noticeFor(reward) || `Canjeado por ${DEMO_USER}` : '';

  return (
    <div className="cab" style={{ paddingBottom: tourOpen ? 220 : undefined }}>
      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-6">
        <SuiteNav
          currentApp="recompensas"
          channel={rewardsSettings.channel}
          saved={saved}
          onOpenTour={() => setTourOpen(true)}
          tourAvailable={!tourOpen}
        />

        <div className="grid items-start gap-5 min-[1200px]:grid-cols-[230px_minmax(0,1fr)_minmax(0,350px)]">
          {/* ---------- Lista de recompensas ---------- */}
          <section className="cab-mod" data-tour="rewards-list">
            <h2>Recompensas</h2>
            {rewards.length > 0 && (
              <ul className="cab-rows !max-h-none">
                {rewards.map((entry) => {
                  const current = entry.id === reward?.id;
                  return (
                    <li key={entry.id} className="cab-row" data-current={current ? '' : undefined}>
                      <button
                        type="button"
                        className="studio-pick"
                        aria-current={current ? 'true' : undefined}
                        onClick={() => select(entry.id)}
                      >
                        {entry.name || 'Sin nombre'}
                        <span className="cab-mono">{entry.cost.toLocaleString('es')} puntos</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <button type="button" className="cab-btn2" onClick={createReward}>
              <Plus className="h-4 w-4" />
              <span>Nueva recompensa</span>
            </button>
            {undo.pending && <UndoNote label={undo.pending.label} onUndo={restoreReward} />}
          </section>

          {/* ---------- Editor ---------- */}
          <section className="cab-mod" data-tour="reward-editor">
            {!reward ? (
              <>
                <h2>Sin recompensas</h2>
                <p className="cab-note">
                  No hay ninguna recompensa. Crea una con «Nueva recompensa» para elegir qué aparece y qué suena al
                  canjearla.
                </p>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2>{reward.name || 'Sin nombre'}</h2>
                  <button type="button" className="cab-btn2 cab-btn-sm" onClick={removeReward}>
                    <Trash2 className="h-4 w-4" />
                    <span>Eliminar</span>
                  </button>
                </div>

                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
                  <Field label="Nombre" htmlFor={`${uid}-name`}>
                    <input
                      id={`${uid}-name`}
                      className="cab-inp"
                      value={reward.name}
                      onChange={(e) => patch({ name: e.target.value })}
                    />
                  </Field>
                  <Field label="Costo en puntos" htmlFor={`${uid}-cost`}>
                    <input
                      id={`${uid}-cost`}
                      type="number"
                      min={0}
                      step={50}
                      className="cab-inp cab-mono"
                      value={reward.cost}
                      onChange={(e) => patch({ cost: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                    />
                  </Field>
                </div>

                <Toggle
                  label="Mostrar texto en pantalla"
                  checked={reward.showNoticeText}
                  onChange={(next) => patch({ showNoticeText: next })}
                />
                {reward.showNoticeText && (
                  <Field
                    label="Texto"
                    htmlFor={`${uid}-template`}
                    hint={
                      <>
                        Variables: <span className="cab-mono">{'{user}, {reward}, {message}'}</span>
                      </>
                    }
                  >
                    <input
                      id={`${uid}-template`}
                      className="cab-inp"
                      value={reward.noticeTemplate}
                      onChange={(e) => patch({ noticeTemplate: e.target.value })}
                    />
                  </Field>
                )}

                <Field label="Color del aviso">
                  <div className="cab-sw">
                    {ACCENTS.map((accent) => (
                      <button
                        key={accent.color}
                        type="button"
                        style={{ background: accent.color }}
                        aria-label={accent.name}
                        aria-pressed={reward.accentColor === accent.color}
                        onClick={() => patch({ accentColor: accent.color })}
                      />
                    ))}
                    <input
                      type="color"
                      value={reward.accentColor}
                      aria-label="Otro color"
                      onChange={(e) => patch({ accentColor: e.target.value })}
                    />
                  </div>
                </Field>

                <details className="studio-details">
                  <summary>Vídeo y sonido{reward.videoUrl ? ' · 1 vídeo' : ''}</summary>
                  <div>
                    <Field
                      label="Vídeo"
                      hint={
                        reward.videoUrl
                          ? `Archivo: ${reward.videoName || 'vídeo sin nombre'}`
                          : 'Sin vídeo. Acepta WebM y MP4; se reproduce junto al aviso.'
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
                        {reward.videoUrl && (
                          <button
                            type="button"
                            className="cab-btn2 cab-btn-sm"
                            onClick={() => patch({ videoUrl: undefined, videoName: undefined })}
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
                          value={hasFile || wantsFile ? 'file' : reward.soundType}
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
                          onClick={() => playAlertOrCustomSound(reward.customAudioUrl, reward.soundType, volume)}
                        >
                          <Play className="h-4 w-4" />
                          <span>Escuchar</span>
                        </button>
                      </div>

                      {(hasFile || wantsFile) && (
                        <div className="grid gap-3 rounded border border-[color:var(--cb-line)] p-3">
                          <p className="cab-hint">
                            {hasFile
                              ? `Archivo: ${reward.customAudioName || 'sin nombre'}`
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
                                onClick={() => patch({ customAudioUrl: undefined, customAudioName: undefined })}
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
                        </div>
                      )}
                    </Field>
                  </div>
                </details>

                <details className="studio-details">
                  <summary>Avanzado</summary>
                  <div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Posición" htmlFor={`${uid}-position`}>
                        <select
                          id={`${uid}-position`}
                          className="cab-inp"
                          value={reward.position}
                          onChange={(e) => patch({ position: e.target.value as RewardVideoPosition })}
                        >
                          {POSITIONS.map((position) => (
                            <option key={position.id} value={position.id}>
                              {position.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Fondo del vídeo" htmlFor={`${uid}-blend`}>
                        <select
                          id={`${uid}-blend`}
                          className="cab-inp"
                          value={reward.blendMode}
                          onChange={(e) => patch({ blendMode: e.target.value as RewardBlendMode })}
                        >
                          {BLEND_MODES.map((mode) => (
                            <option key={mode.id} value={mode.id}>
                              {mode.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Tamaño">
                        <Range
                          label="Tamaño"
                          min={0.5}
                          max={2}
                          step={0.05}
                          value={reward.scale}
                          format={(value) => `${Math.round(value * 100)}%`}
                          onChange={(value) => patch({ scale: value })}
                        />
                      </Field>
                      <Field label="Tiempo en pantalla">
                        <Range
                          label="Tiempo en pantalla"
                          min={2}
                          max={20}
                          value={duration}
                          format={(value) => `${value} s`}
                          onChange={(value) => patch({ duration: value })}
                        />
                      </Field>
                      <Field label="Volumen">
                        <Range
                          label="Volumen"
                          min={0}
                          max={1}
                          step={0.05}
                          value={volume}
                          format={(value) => `${Math.round(value * 100)}%`}
                          onChange={(value) => patch({ volume: value, customAudioVolume: value })}
                        />
                      </Field>
                      <Field
                        label="Espera entre canjes"
                        htmlFor={`${uid}-cooldown`}
                        hint="En segundos. Con 0 no hay espera."
                      >
                        <input
                          id={`${uid}-cooldown`}
                          type="number"
                          min={0}
                          max={3600}
                          className="cab-inp cab-mono sm:max-w-[160px]"
                          value={reward.cooldownSeconds}
                          onChange={(e) =>
                            patch({ cooldownSeconds: Math.max(0, Math.round(Number(e.target.value) || 0)) })
                          }
                        />
                      </Field>
                    </div>
                    <Toggle
                      label="Sacudir la pantalla"
                      checked={reward.screenShake}
                      onChange={(next) => patch({ screenShake: next })}
                    />
                  </div>
                </details>
              </>
            )}
          </section>

          {/* ---------- Monitor ---------- */}
          <section
            className="cab-mod max-[1199px]:order-first min-[1200px]:sticky min-[1200px]:top-4"
            data-tour="rewards-monitor"
          >
            <h2>Monitor</h2>
            <div ref={stageRef} className={`cab-stage ${STAGE_POSITION[reward?.position || 'center']}`}>
              {reward && (
                <div
                  className="ovl capas-reward"
                  data-studio=""
                  data-full={reward.position === 'fullscreen' ? '' : undefined}
                  style={{
                    transform: `scale(${reward.scale || 1})`,
                    transformOrigin: reward.position === 'bottom-right' ? 'bottom right' : 'center',
                  }}
                >
                  {showVideo && (
                    <video
                      key={playing}
                      ref={(element) => {
                        if (element) element.volume = Math.max(0, Math.min(1, volume));
                      }}
                      src={reward.videoUrl}
                      autoPlay
                      playsInline
                      style={{ mixBlendMode: reward.blendMode === 'screen' ? 'screen' : 'normal' }}
                    />
                  )}
                  {showNotice ? (
                    <div
                      className="ovl-plate nt"
                      data-big={reward.videoUrl ? undefined : ''}
                      style={
                        {
                          '--c': reward.accentColor || '#9146ff',
                          '--c-ink': inkFor(reward.accentColor || '#9146ff'),
                        } as React.CSSProperties
                      }
                    >
                      <span className="nt-tag ovl-caps">{reward.name}</span>
                      <span className="nt-text">{previewText}</span>
                    </div>
                  ) : (
                    !showVideo && <p className="capas-rest">Pulsa «Probar» para ver el vídeo.</p>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" className="cab-btn flex-1" disabled={!reward} onClick={test}>
                <Play className="h-4 w-4" />
                <span>Probar</span>
              </button>
              <button type="button" className="cab-btn2 flex-1" onClick={copyWidgetUrl}>
                {copiedUrl ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span>{copiedUrl ? 'URL copiada' : 'Copiar URL para OBS'}</span>
              </button>
            </div>
            <p className="cab-hint" role="status">
              {status || 'La prueba suena aquí y aparece en las fuentes de OBS que estén abiertas. No gasta puntos.'}
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

      {tourOpen && (
        <GuidedTour steps={REWARDS_TOUR_STEPS} onClose={() => setTourOpen(false)} id={TOUR_ID} appName="Recompensas" />
      )}
    </div>
  );
};
