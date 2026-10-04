/**
 * src/pages/RewardsStudio.tsx
 *
 * Estudio de Recompensas sobre la plantilla común del panel: lista de
 * recompensas, editor de la elegida y monitor 16:9 siempre a la vista.
 *
 * - Una recompensa se activa con puntos del canal o con bits, y puede ser solo
 *   sonido, sonido con placa o sonido con vídeo.
 * - El monitor pinta la misma capa que OBS (RewardsLayer). Las pruebas de debajo
 *   la disparan aquí y en las fuentes de OBS abiertas en este navegador, sin
 *   gastar puntos ni bits.
 * - Los archivos se suben al almacén de la cuenta para que OBS los cargue; sin
 *   cuenta se quedan en este navegador y se dice.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, Copy, Play, Plus, Trash2 } from 'lucide-react';
import { SuiteNav } from '../components/SuiteNav';
import { useRewardsSettings } from '../hooks/useRewardsSettings';
import {
  CustomRewardItem,
  DEFAULT_BITS_COOLDOWN_SECONDS,
  RewardsSettings,
  encodeRewardsSettings,
  normalizeReward,
  plateStyleFor,
} from '../types/rewards';
import { postBus } from '../utils/bus';
import { MediaLibraryModal } from '../components/MediaLibraryModal';
import { MediaItem, MediaType } from '../types/mediaLibrary';
import { GuidedTour, TourStep, isTourDone } from '../components/GuidedTour';
import { Field, Toggle, UndoNote, useUndo } from '../components/studio/StudioKit';
import { buildSuiteWidgetUrl } from '../utils/widgetUrl';
import { loadSettings } from '../types/settings';
import { useCloudSession } from '../hooks/useCloudSession';
import { releaseMedia } from '../lib/mediaRef';
import { matchBitsReward, triggerLabel } from '../utils/rewardsLogic';
import { RewardRequest, RewardsLayer, RewardsLayerHandle } from '../components/recompensas/RewardsLayer';
import { TriggerFields } from '../components/recompensas/TriggerFields';
import { SoundFields, VideoFields } from '../components/recompensas/MediaFields';
import { PlateFields } from '../components/recompensas/PlateFields';
import { GeneralRules } from '../components/recompensas/GeneralRules';
import '../styles/recompensas.css';

const TOUR_ID = 'recompensas';

const REWARDS_TOUR_STEPS: TourStep[] = [
  {
    badge: 'Bienvenida',
    title: 'Recompensas',
    body: 'Aquí decides qué suena y qué aparece cuando alguien canjea puntos del canal o envía bits.',
  },
  {
    target: 'rewards-list',
    badge: 'Lista',
    title: 'Elige una recompensa',
    body: 'Cada fila es una recompensa, con lo que la activa. Debajo puedes añadir otra, por puntos o por bits.',
  },
  {
    target: 'reward-editor',
    badge: 'Editor',
    title: 'Qué la activa y qué hace',
    body: 'Elige puntos o bits, el sonido, si sale una placa y con qué estilo, y un vídeo si quieres. Debajo están las reglas comunes a todas.',
  },
  {
    target: 'rewards-monitor',
    badge: 'Monitor',
    title: 'Prueba y copia la URL',
    body: 'Las pruebas disparan la capa aquí y en las fuentes de OBS abiertas, sin gastar nada. «Copiar URL para OBS» te da la fuente de navegador a 1920 × 1080.',
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

const DEMO_USERS = ['mar_ia', 'dani_gg', 'caro_tv', 'luz88'];
const DEMO_MESSAGE = '¡Vamos con todo!';
const LOG_LINES = 6;
/** Un archivo de una recompensa borrada se libera cuando ya no se puede deshacer. */
const RELEASE_AFTER_DELETE_MS = 9000;

const usesMedia = (settings: RewardsSettings, mediaId: string) =>
  settings.customPlate.mediaId === mediaId ||
  settings.rewards.some((entry) => entry.videoMediaId === mediaId || entry.customAudioMediaId === mediaId);

const whyFor = (reward: CustomRewardItem) =>
  reward.trigger === 'points' ? 'Canje de puntos' : `Cheer de ${reward.bitsMin} ${reward.bitsMin === 1 ? 'bit' : 'bits'}`;

export const RewardsStudio: React.FC = () => {
  const { rewardsSettings, updateRewards, updateRewardItem, addRewardItem, deleteRewardItem, saved } = useRewardsSettings();
  const cloud = useCloudSession();
  const uid = useId();
  const rewards = rewardsSettings.rewards;
  const cloudOn = cloud.enabled && cloud.profile?.status === 'active';

  const [selectedId, setSelectedId] = useState<string>(rewards[0]?.id || '');
  const [copied, setCopied] = useState<'url' | 'demo' | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [counts, setCounts] = useState({ waiting: 0, active: 0 });
  const [gates, setGates] = useState(false);
  const [cheer, setCheer] = useState(100);
  const [vault, setVault] = useState<MediaType | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const undo = useUndo<{ rewards: CustomRewardItem[]; id: string }>();

  const layerRef = useRef<RewardsLayerHandle | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsRef = useRef(rewardsSettings);
  settingsRef.current = rewardsSettings;
  const releasesRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // La guía se abre sola la primera vez; después se accede desde la cabecera
  useEffect(() => {
    if (isTourDone(TOUR_ID)) return;
    const timer = setTimeout(() => setTourOpen(true), 600);
    return () => clearTimeout(timer);
  }, []);

  // Al salir, lo que estaba pendiente de liberar se libera ya (si sigue sin usarse)
  useEffect(() => {
    const releases = releasesRef.current;
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
      releases.forEach((timer, mediaId) => {
        clearTimeout(timer);
        if (!usesMedia(settingsRef.current, mediaId)) void releaseMedia(mediaId);
      });
      releases.clear();
    };
  }, []);

  const say = (message: string) => setLog((prev) => [message, ...prev].slice(0, LOG_LINES));

  // Al abrir, una muestra sin sonido de la primera recompensa para que el monitor no esté vacío
  useEffect(() => {
    const first = settingsRef.current.rewards[0];
    if (!first) return;
    layerRef.current?.fire({ reward: { ...first, showPlate: true }, user: DEMO_USERS[0], why: whyFor(first), silent: true, holdSeconds: 6 }, false);
  }, []);

  /** Libera un archivo del almacén cuando ya ninguna recompensa lo usa. */
  const scheduleRelease = (mediaId: string, delay = 150) => {
    const previous = releasesRef.current.get(mediaId);
    if (previous) clearTimeout(previous);
    releasesRef.current.set(
      mediaId,
      setTimeout(() => {
        releasesRef.current.delete(mediaId);
        if (usesMedia(settingsRef.current, mediaId)) return;
        releaseMedia(mediaId).then((ok) => {
          if (!ok) say('No se pudo borrar el archivo anterior de tu espacio. Puedes borrarlo en «Mi cuenta».');
        });
      }, delay)
    );
  };

  // ---------- Recompensa seleccionada ----------
  const reward: CustomRewardItem | undefined = rewards.find((entry) => entry.id === selectedId) || rewards[0];

  const patch = (value: Partial<CustomRewardItem>) => {
    if (reward) updateRewardItem(reward.id, value);
  };

  const createReward = (trigger: 'points' | 'bits') => {
    const id = `custom-reward-${Date.now()}`;
    addRewardItem(
      normalizeReward({
        id,
        name: trigger === 'bits' ? 'Sonido por bits' : 'Recompensa nueva',
        cost: 500,
        trigger,
        bitsMode: 'exact',
        bitsMin: 100,
        cooldownSeconds: trigger === 'bits' ? DEFAULT_BITS_COOLDOWN_SECONDS : 30,
        showPlate: true,
        showNoticeText: false,
        soundType: 'arcade-chime',
      })
    );
    setSelectedId(id);
  };

  const removeReward = () => {
    if (!reward) return;
    const index = rewards.findIndex((entry) => entry.id === reward.id);
    const next = rewards[index + 1] || rewards[index - 1];
    undo.offer(`Se eliminó «${reward.name}».`, { rewards, id: reward.id });
    [reward.videoMediaId, reward.customAudioMediaId].forEach((mediaId) => mediaId && scheduleRelease(mediaId, RELEASE_AFTER_DELETE_MS));
    deleteRewardItem(reward.id);
    setSelectedId(next?.id || '');
  };

  const restoreReward = () => {
    if (!undo.pending) return;
    updateRewards({ rewards: undo.pending.snapshot.rewards });
    setSelectedId(undo.pending.snapshot.id);
    undo.clear();
  };

  const handleVaultSelect = (media: MediaItem) => {
    const type = vault;
    setVault(null);
    if (!reward) return;
    if (type === 'audio') {
      if (reward.customAudioMediaId) scheduleRelease(reward.customAudioMediaId);
      patch({ customAudioUrl: media.url, customAudioName: media.name, customAudioMediaId: undefined, customAudioVolume: reward.volume });
    } else {
      if (reward.videoMediaId) scheduleRelease(reward.videoMediaId);
      patch({ videoUrl: media.url, videoName: media.name, videoMediaId: undefined, blendMode: media.format === 'webm' ? 'transparent' : 'screen' });
    }
    say(`«${media.name}» asignado desde la biblioteca.`);
  };

  // ---------- Pruebas ----------
  const run = (item: CustomRewardItem, user: string, why: string, extra: Partial<RewardRequest> = {}) => {
    const accepted = layerRef.current?.fire({ reward: item, user, username: user.toLowerCase(), why, message: DEMO_MESSAGE, ...extra }, gates);
    // Las fuentes de OBS abiertas en este navegador reciben la misma prueba
    if (accepted && !extra.sampleVideo) postBus({ type: 'REWARD_TEST', test: { reward: item, user, why, amount: extra.amount, unit: extra.unit } });
  };

  const testCurrent = () => reward && run(reward, DEMO_USERS[0], whyFor(reward));

  const testPoints = () => {
    const item = reward?.trigger === 'points' ? reward : rewards.find((entry) => entry.trigger === 'points');
    if (!item) return say('No hay ninguna recompensa de puntos de canal en la lista.');
    run(item, DEMO_USERS[0], 'Canje de puntos');
  };

  const testCheer = () => {
    const item = matchBitsReward(rewards, cheer);
    if (!item) return say(`Ninguna recompensa encendida coincide con un cheer de ${cheer} ${cheer === 1 ? 'bit' : 'bits'}.`);
    run(item, DEMO_USERS[1], `Cheer de ${cheer} ${cheer === 1 ? 'bit' : 'bits'}`, { amount: String(cheer), unit: cheer === 1 ? 'bit' : 'bits' });
  };

  const testThree = () => {
    if (!rewards.length) return;
    // Si hay menos de tres, se repite la elegida con espectadores distintos
    const three = rewards.length >= 3 ? rewards.slice(0, 3) : [0, 1, 2].map(() => reward || rewards[0]);
    three.forEach((item, index) => run(item, DEMO_USERS[index + 1], whyFor(item)));
  };

  const testShort = () =>
    run(
      normalizeReward({
        id: 'prueba-clip-corto',
        name: 'Clip de 0,25 s',
        soundType: 'soft-pop',
        volume: reward?.volume ?? 0.85,
        showPlate: reward?.showPlate ?? true,
        showNoticeText: false,
        plateStyle: reward ? plateStyleFor(reward, rewardsSettings) : 'default',
        accentColor: reward?.accentColor,
      }),
      DEMO_USERS[0],
      'Prueba'
    );

  const testVideo = () => reward && run(reward, DEMO_USERS[0], whyFor(reward), { sampleVideo: true, silent: true, holdSeconds: 3 });

  const clearAll = () => {
    layerRef.current?.clear();
    postBus({ type: 'REWARD_TEST', test: { user: '', why: '', clear: true } });
  };

  // ---------- URL de OBS ----------
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const copyUrl = (withDemo: boolean) => {
    // Con cuenta va la clave y, de reserva, los ajustes: si la nube no responde, la fuente usa los de la URL
    const extra: Record<string, string> = {
      ...(cloudOn && cloud.profile ? { k: cloud.profile.widget_key } : {}),
      rw: encodeRewardsSettings(rewardsSettings),
    };
    if (withDemo) {
      extra.demo = '1';
      extra.plate = reward ? plateStyleFor(reward, rewardsSettings) : rewardsSettings.defaultPlateStyle;
    }
    const url = buildSuiteWidgetUrl(baseUrl, 'rewards', rewardsSettings.channel, loadSettings(), extra);
    navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopied(withDemo ? 'demo' : 'url');
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopied(null), 2200);
      })
      .catch(() => say('No se pudo copiar. Usa «Fuentes de OBS» en la cabecera.'));
  };

  const customInUse =
    rewardsSettings.defaultPlateStyle === 'custom' || rewards.some((entry) => entry.showPlate && entry.plateStyle === 'custom');
  const mediaCount = reward ? Number(Boolean(reward.customAudioUrl)) : 0;

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

        <div className="grid items-start gap-5 min-[1200px]:grid-cols-[220px_minmax(0,1fr)_minmax(0,410px)]">
          {/* ---------- Lista de recompensas ---------- */}
          <section className="cab-mod" data-tour="rewards-list">
            <h2>Recompensas</h2>
            {rewards.length > 0 && (
              <ul className="cab-rows !max-h-none">
                {rewards.map((entry) => {
                  const current = entry.id === reward?.id;
                  return (
                    <li key={entry.id} className="cab-row" data-current={current ? '' : undefined}>
                      <button type="button" className="studio-pick" aria-current={current ? 'true' : undefined} onClick={() => setSelectedId(entry.id)}>
                        {entry.name || 'Sin nombre'}
                        <span className="cab-mono">
                          {triggerLabel(entry)} · {entry.showPlate ? 'con placa' : entry.videoUrl ? 'vídeo' : 'solo sonido'}
                          {entry.enabled ? '' : ' · apagada'}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <span className="cab-label">Nueva recompensa</span>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="cab-btn2" onClick={() => createReward('points')}>
                <Plus className="h-4 w-4" />
                <span>Puntos</span>
              </button>
              <button type="button" className="cab-btn2" onClick={() => createReward('bits')}>
                <Plus className="h-4 w-4" />
                <span>Bits</span>
              </button>
            </div>
            {undo.pending && <UndoNote label={undo.pending.label} onUndo={restoreReward} />}
          </section>

          {/* ---------- Editor ---------- */}
          <div className="grid min-w-0 gap-5">
            <section className="cab-mod" data-tour="reward-editor">
              {!reward ? (
                <>
                  <h2>Sin recompensas</h2>
                  <p className="cab-note">
                    No hay ninguna recompensa. Crea una con «Puntos» o «Bits», bajo «Nueva recompensa», para elegir qué suena y
                    qué aparece al activarla.
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

                  <div className="rw-two">
                    <Field label="Nombre" htmlFor={`${uid}-name`} hint="Es el nombre del sonido que sale en la placa.">
                      <input
                        id={`${uid}-name`}
                        className="cab-inp"
                        maxLength={60}
                        value={reward.name}
                        onChange={(e) => patch({ name: e.target.value })}
                      />
                    </Field>
                    <Field label="Color">
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
                  </div>
                  <Toggle label="Encendida" checked={reward.enabled} onChange={(enabled) => patch({ enabled })} />

                  <TriggerFields key={reward.id} reward={reward} settings={rewardsSettings} patch={patch} onNote={say} />

                  <details className="studio-details" open>
                    <summary>Sonido{mediaCount ? ' · archivo propio' : ''}</summary>
                    <div>
                      <SoundFields reward={reward} cloudOn={cloudOn} patch={patch} onRelease={scheduleRelease} onOpenVault={setVault} />
                    </div>
                  </details>

                  <details className="studio-details" open>
                    <summary>Placa{reward.showPlate ? '' : ' · apagada, solo sonido'}</summary>
                    <div>
                      <PlateFields reward={reward} settings={rewardsSettings} patch={patch} />
                    </div>
                  </details>

                  <details className="studio-details">
                    <summary>Vídeo{reward.videoUrl ? ' · 1 vídeo' : ''}</summary>
                    <div>
                      <VideoFields reward={reward} cloudOn={cloudOn} patch={patch} onRelease={scheduleRelease} onOpenVault={setVault} />
                    </div>
                  </details>
                </>
              )}
            </section>

            <section className="cab-mod">
              <h2>Reglas para todas</h2>
              <GeneralRules
                settings={rewardsSettings}
                cloudOn={cloudOn}
                update={updateRewards}
                onRelease={scheduleRelease}
                customInUse={customInUse}
              />
            </section>
          </div>

          {/* ---------- Monitor ---------- */}
          <section className="cab-mod max-[1199px]:order-first min-[1200px]:sticky min-[1200px]:top-4" data-tour="rewards-monitor">
            <h2>Monitor</h2>
            <div className="cab-stage rw-stage">
              {reward?.position === 'random' && <div className="rw-safe" style={{ inset: `${reward.randomMargin}%` }} />}
              <RewardsLayer
                ref={layerRef}
                settings={rewardsSettings}
                isStudio
                onLog={say}
                onCounts={(waiting, active) => setCounts({ waiting, active })}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" className="cab-btn flex-1" disabled={!reward} onClick={testCurrent}>
                <Play className="h-4 w-4" />
                <span>Probar esta</span>
              </button>
              <button type="button" className="cab-btn2" onClick={clearAll}>
                Vaciar
              </button>
            </div>

            <div className="cab-field">
              <span className="cab-label">Qué la dispara</span>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="cab-btn2 cab-btn-sm" onClick={testPoints}>
                  Canje de puntos
                </button>
                <button type="button" className="cab-btn2 cab-btn-sm" onClick={testThree}>
                  Tres seguidos
                </button>
                <button type="button" className="cab-btn2 cab-btn-sm" onClick={testShort}>
                  Clip corto
                </button>
                {reward && (
                  <button type="button" className="cab-btn2 cab-btn-sm" onClick={testVideo}>
                    Posición del vídeo
                  </button>
                )}
              </div>
              <div className="rw-inline">
                <label htmlFor={`${uid}-cheer`}>Cheer de</label>
                <input
                  id={`${uid}-cheer`}
                  type="number"
                  min={1}
                  max={100000}
                  className="cab-inp cab-mono"
                  value={cheer}
                  onChange={(e) => setCheer(Math.min(100000, Math.max(1, Math.round(Number(e.target.value) || 1))))}
                />
                <button type="button" className="cab-btn2 cab-btn-sm" onClick={testCheer}>
                  Enviar {cheer === 1 ? 'bit' : 'bits'}
                </button>
              </div>
            </div>

            <div className="cab-field">
              <Toggle label="Aplicar esperas y límites en estas pruebas" checked={gates} onChange={setGates} />
              <span className="cab-hint">Apagado, puedes repetir una prueba sin esperar. En directo se aplican siempre.</span>
            </div>

            <p className="cab-hint" role="status">
              En cola: {counts.waiting}. Sonando: {counts.active}.
            </p>
            {log.length > 0 ? (
              <ul className="rw-log" aria-label="Registro de la capa">
                {log.map((line, index) => (
                  <li key={`${log.length}-${index}`}>{line}</li>
                ))}
              </ul>
            ) : (
              <p className="cab-hint">
                Las pruebas suenan aquí y en las fuentes de OBS abiertas en este navegador. No gastan puntos ni bits. Si no
                oyes nada, pulsa una vez en la página: el navegador pide un clic antes de dejar sonar.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <button type="button" className="cab-btn2 flex-1" onClick={() => copyUrl(false)}>
                {copied === 'url' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span>{copied === 'url' ? 'URL copiada' : 'Copiar URL para OBS'}</span>
              </button>
              <button type="button" className="cab-btn2 flex-1" onClick={() => copyUrl(true)}>
                {copied === 'demo' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span>{copied === 'demo' ? 'URL copiada' : 'URL con placa de muestra'}</span>
              </button>
            </div>
            {!cloudOn && (
              <p className="cab-note">
                Sin cuenta en la nube, los ajustes viajan dentro de la URL: vuelve a copiarla en OBS cuando cambies algo.
                Los archivos que subas se quedan en este navegador y no llegan a OBS.
              </p>
            )}
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
