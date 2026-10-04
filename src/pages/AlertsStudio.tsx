/**
 * src/pages/AlertsStudio.tsx
 *
 * Estudio de Alertas de Stream sobre la plantilla común del panel:
 * lista de eventos, editor del evento elegido y monitor 16:9 siempre a la vista.
 *
 * - Follow, suscripción, bits, raid y los eventos personalizados comparten el
 *   mismo editor: mensaje, sonido y «leer con voz». Vídeo, niveles y apariencia
 *   van plegados.
 * - Hay una sola forma de probar: el botón bajo el monitor (y «Probar» en cada
 *   nivel). La prueba suena aquí y se envía a las fuentes de OBS abiertas.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import gsap from 'gsap';
import { Check, Copy, Play, Plus, Trash2 } from 'lucide-react';
import { SuiteNav } from '../components/SuiteNav';
import { useAlertsSettings } from '../hooks/useAlertsSettings';
import { GuidedTour, TourStep, isTourDone } from '../components/GuidedTour';
import {
  AlertAudioMode,
  AlertBlendMode,
  AlertEventType,
  AlertSoundType,
  BitTierConfig,
  CustomAlertRule,
  DEFAULT_BIT_TIERS,
  DEFAULT_SUB_TIERS,
  EventRuleConfig,
  SubTierConfig,
} from '../types/alerts';
import { ALERT_POSITIONS, ALERT_STYLES, AlertPosition, inkFor } from '../utils/appearance';
import { AlertCard } from '../components/AlertCard';
import { playDemo } from '../utils/alertMotion';
import { playAlertOrCustomSound } from '../utils/alertsAudio';
import { postBus } from '../utils/bus';
import { MediaLibraryModal } from '../components/MediaLibraryModal';
import { inspectAudioFile, MediaItem, MediaType, MAX_AUDIO_DURATION_SECONDS } from '../types/mediaLibrary';
import { buildSuiteWidgetUrl } from '../utils/widgetUrl';
import { loadSettings } from '../types/settings';
import { useCloudSession } from '../hooks/useCloudSession';

const TOUR_ID = 'alertas';

const ALERTS_TOUR_STEPS: TourStep[] = [
  {
    badge: 'Bienvenida',
    title: 'Alertas de stream',
    body: 'Aquí decides qué aparece y qué suena cuando alguien te sigue, se suscribe, envía bits o hace un raid.',
  },
  {
    target: 'alert-events',
    badge: 'Eventos',
    title: 'Elige un evento',
    body: 'Cada evento se activa o desactiva con su interruptor. «Nuevo evento» crea uno propio que se dispara con una palabra del chat.',
  },
  {
    target: 'alert-editor',
    badge: 'Editor',
    title: 'Mensaje y sonido',
    body: 'Escribe el mensaje, elige un sonido y decide si se lee con la voz del chat. El vídeo, los niveles y la apariencia están plegados debajo.',
  },
  {
    target: 'stage-monitor',
    badge: 'Monitor',
    title: 'Prueba y copia la URL',
    body: '«Probar» reproduce la alerta aquí y en las fuentes de OBS abiertas. «Copiar URL para OBS» te da la fuente de navegador a 1920 × 1080.',
  },
];

const ACCENTS = [
  { color: '#9146ff', name: 'Morado' },
  { color: '#ff2d46', name: 'Rojo' },
  { color: '#53fc18', name: 'Verde' },
  { color: '#ff6b4a', name: 'Coral' },
  { color: '#22c7e0', name: 'Cian' },
  { color: '#ffb020', name: 'Ámbar' },
];

const SOUNDS: { id: AlertSoundType; name: string }[] = [
  { id: 'synth-bell', name: 'Campana' },
  { id: 'retro-fanfare', name: 'Fanfarria' },
  { id: 'arcade-chime', name: 'Arcade' },
  { id: 'soft-pop', name: 'Pop suave' },
  { id: 'none', name: 'Sin sonido' },
];

const BLEND_MODES: { id: AlertBlendMode; label: string }[] = [
  { id: 'transparent', label: 'Vídeo con transparencia (WebM)' },
  { id: 'screen', label: 'Quitar el fondo negro' },
  { id: 'chroma-green', label: 'Quitar el fondo verde' },
];

const EVENTS: { type: AlertEventType; label: string; vars: string }[] = [
  { type: 'follow', label: 'Follow', vars: '{user}' },
  { type: 'sub', label: 'Suscripción', vars: '{user}, {detail}' },
  { type: 'bits', label: 'Bits', vars: '{user}, {bits}, {message}' },
  { type: 'raid', label: 'Raid', vars: '{user}, {viewers}' },
];

const SAMPLE: Record<AlertEventType, { user: string; detail: string | null; vars: Record<string, string> }> = {
  follow: { user: 'NuevoSeguidor', detail: null, vars: {} },
  sub: { user: 'SubscriptorVIP', detail: 'Nivel 1 · 6 meses', vars: { detail: 'Nivel 1 · 6 meses' } },
  bits: { user: 'DonadorTop', detail: '500 bits', vars: { bits: '500', message: '¡Éxitos!' } },
  raid: { user: 'StreamerHost', detail: '35 espectadores', vars: { viewers: '35' } },
};

const STAGE_POSITION: Record<AlertPosition, string> = {
  tl: 'items-start justify-start',
  tc: 'items-start justify-center',
  tr: 'items-start justify-end',
  bl: 'items-end justify-start',
  bc: 'items-end justify-center',
  br: 'items-end justify-end',
};

type Selection = { kind: 'event'; type: AlertEventType } | { kind: 'custom'; id: string };
type ItemPatch = Partial<EventRuleConfig> & Partial<CustomAlertRule>;

interface Shot {
  key: number;
  eventType: AlertEventType;
  user: string;
  text: string;
  detail: string | null;
  accent: string;
}

const fill = (template: string, user: string, vars: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (match, key) => (key === 'user' ? user : vars[key] ?? match));

/** Sonido + «leer con voz» → modo de audio que entiende el widget. */
const audioModeFor = (tts: boolean, hasFile: boolean, sound: AlertSoundType): AlertAudioMode =>
  tts ? (hasFile || sound !== 'none' ? 'both' : 'tts') : hasFile ? 'custom_audio' : 'synth';

const usesTts = (mode?: AlertAudioMode) => mode === 'tts' || mode === 'both';

const Field: React.FC<{ label: string; htmlFor?: string; hint?: React.ReactNode; children: React.ReactNode }> = ({
  label,
  htmlFor,
  hint,
  children,
}) => (
  <div className="cab-field">
    {htmlFor ? (
      <label className="cab-label" htmlFor={htmlFor}>
        {label}
      </label>
    ) : (
      <span className="cab-label">{label}</span>
    )}
    {children}
    {hint && <span className="cab-hint">{hint}</span>}
  </div>
);

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

export const AlertsStudio: React.FC = () => {
  const { alertsSettings, updateAlerts, saved } = useAlertsSettings();
  const cloud = useCloudSession();
  const uid = useId();
  const customEvents = alertsSettings.customEvents || [];

  const [selection, setSelection] = useState<Selection>({ kind: 'event', type: 'follow' });
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [wantsFile, setWantsFile] = useState(false);
  const [undo, setUndo] = useState<{ rule: CustomAlertRule; index: number } | null>(null);
  const [vault, setVault] = useState<MediaType | null>(null);
  const [shot, setShot] = useState<Shot | null>(null);
  const [monitorVideo, setMonitorVideo] = useState<{ url: string; blend?: AlertBlendMode } | null>(null);
  const [tourOpen, setTourOpen] = useState(false);

  const cardRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const stopDemoRef = useRef<(() => void) | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // La guía se abre sola la primera vez; después se accede desde la cabecera
  useEffect(() => {
    if (isTourDone(TOUR_ID)) return;
    const timer = setTimeout(() => setTourOpen(true), 600);
    return () => clearTimeout(timer);
  }, []);

  useEffect(
    () => () => {
      stopDemoRef.current?.();
      if (statusTimer.current) clearTimeout(statusTimer.current);
    },
    []
  );

  const say = (message: string) => {
    setStatus(message);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(null), 3500);
  };

  // ---------- Elemento seleccionado ----------
  const custom = selection.kind === 'custom' ? customEvents.find((rule) => rule.id === selection.id) || null : null;
  const eventType: AlertEventType = selection.kind === 'event' ? selection.type : 'follow';
  const eventConfig = alertsSettings.events[eventType];
  const item: EventRuleConfig | CustomAlertRule = custom || eventConfig;
  const eventMeta = EVENTS.find((entry) => entry.type === eventType)!;
  const itemLabel = custom ? custom.name : eventMeta.label;
  const itemAccent = custom?.accentColor || alertsSettings.accent;
  const hasFile = Boolean(item.customAudioUrl);
  const volume = item.customAudioVolume ?? alertsSettings.soundVolume;

  const select = (next: Selection) => {
    setSelection(next);
    setShot(null);
    setWantsFile(false);
    setAudioError(null);
  };

  const updateEvent = (type: AlertEventType, patch: Partial<EventRuleConfig>) => {
    updateAlerts({ events: { ...alertsSettings.events, [type]: { ...alertsSettings.events[type], ...patch } } });
  };
  const updateCustom = (id: string, patch: Partial<CustomAlertRule>) => {
    updateAlerts({ customEvents: customEvents.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)) });
  };
  const patchItem = (patch: ItemPatch) => {
    if (custom) updateCustom(custom.id, patch as Partial<CustomAlertRule>);
    else updateEvent(eventType, patch as Partial<EventRuleConfig>);
  };

  // ---------- Sonido ----------
  const chooseSound = (value: string) => {
    if (value === 'file') {
      setWantsFile(true);
      return;
    }
    const soundType = value as AlertSoundType;
    setWantsFile(false);
    patchItem({
      soundType,
      customAudioUrl: undefined,
      customAudioName: undefined,
      customAudioDuration: undefined,
      audioMode: audioModeFor(usesTts(item.audioMode), false, soundType),
    });
  };

  const assignAudio = (url: string, name: string, duration?: number) => {
    setWantsFile(false);
    setAudioError(null);
    patchItem({
      customAudioUrl: url,
      customAudioName: name,
      customAudioDuration: duration,
      customAudioVolume: volume,
      audioMode: audioModeFor(usesTts(item.audioMode), true, item.soundType),
    });
    say(`Sonido «${name}» asignado a ${itemLabel}.`);
  };

  const handleAudioUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const { dataUrl, duration } = await inspectAudioFile(file);
      assignAudio(dataUrl, file.name, duration);
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
    patchItem({ videoUrl: url, videoName: name, blendMode: isWebm ? 'transparent' : 'screen' });
    say(`Vídeo «${name}» asignado a ${itemLabel}.`);
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
    if (type === 'audio') assignAudio(media.url, media.name, media.duration);
    else assignVideo(media.url, media.name, media.format === 'webm');
  };

  // ---------- Eventos personalizados ----------
  const createCustom = () => {
    const rule: CustomAlertRule = {
      id: `custom-${Date.now()}`,
      name: 'Evento nuevo',
      triggerKeyword: '!evento',
      enabled: true,
      template: '¡{user} activó un evento especial!',
      audioMode: 'both',
      soundType: 'retro-fanfare',
      screenShake: false,
      accentColor: alertsSettings.accent,
    };
    updateAlerts({ customEvents: [...customEvents, rule] });
    select({ kind: 'custom', id: rule.id });
  };

  const deleteCustom = (rule: CustomAlertRule) => {
    const index = customEvents.findIndex((entry) => entry.id === rule.id);
    updateAlerts({ customEvents: customEvents.filter((entry) => entry.id !== rule.id) });
    setUndo({ rule, index });
    select({ kind: 'event', type: 'follow' });
  };

  const restoreCustom = () => {
    if (!undo) return;
    const next = [...customEvents];
    next.splice(Math.min(undo.index, next.length), 0, undo.rule);
    updateAlerts({ customEvents: next });
    select({ kind: 'custom', id: undo.rule.id });
    setUndo(null);
  };

  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), 8000);
    return () => clearTimeout(timer);
  }, [undo]);

  // ---------- Niveles ----------
  const bitTiers = alertsSettings.events.bits.bitTiers || DEFAULT_BIT_TIERS;
  const subTiers = alertsSettings.events.sub.subTiers || DEFAULT_SUB_TIERS;
  const updateBitTier = (id: string, patch: Partial<BitTierConfig>) =>
    updateEvent('bits', { bitTiers: bitTiers.map((tier) => (tier.id === id ? { ...tier, ...patch } : tier)) });
  const updateSubTier = (id: string, patch: Partial<SubTierConfig>) =>
    updateEvent('sub', { subTiers: subTiers.map((tier) => (tier.id === id ? { ...tier, ...patch } : tier)) });

  // ---------- Probar ----------
  interface FireOptions {
    label: string;
    eventType: AlertEventType;
    user: string;
    text: string;
    detail: string | null;
    accent: string;
    soundType: AlertSoundType;
    audioMode: AlertAudioMode;
    customAudioUrl?: string;
    customAudioVolume: number;
    videoUrl?: string;
    blendMode?: AlertBlendMode;
    videoScale?: number;
    screenShake?: boolean;
  }

  const fire = (options: FireOptions) => {
    playAlertOrCustomSound(options.customAudioUrl, options.soundType, options.customAudioVolume);

    setMonitorVideo(options.videoUrl ? { url: options.videoUrl, blend: options.blendMode } : null);
    if (options.videoUrl) setTimeout(() => setMonitorVideo(null), alertsSettings.duration * 1000);

    setShot({
      key: Date.now(),
      eventType: options.eventType,
      user: options.user,
      text: options.text,
      detail: options.detail,
      accent: options.accent,
    });

    postBus({
      type: 'ALERT_TRIGGER',
      alert: {
        id: `alert-${Date.now()}`,
        eventType: options.eventType,
        user: options.user,
        text: options.text,
        style: alertsSettings.alertStyle,
        accent: options.accent,
        soundType: options.soundType,
        duration: alertsSettings.duration,
        videoUrl: options.videoUrl,
        blendMode: options.blendMode,
        videoScale: options.videoScale,
        screenShake: options.screenShake,
        customAudioUrl: options.customAudioUrl,
        customAudioVolume: options.customAudioVolume,
        audioMode: options.audioMode,
      },
    });

    if (options.screenShake && stageRef.current) {
      gsap.fromTo(
        stageRef.current,
        { x: -14, y: 10, rotate: -0.8 },
        { x: 0, y: 0, rotate: 0, duration: 0.65, ease: 'elastic.out(1.2, 0.2)', clearProps: 'transform' }
      );
    }
    say(`Prueba de ${options.label} enviada al monitor y a OBS.`);
  };

  // La animación arranca cuando la tarjeta ya tiene el texto de la prueba
  useEffect(() => {
    if (!shot || !cardRef.current) return;
    stopDemoRef.current?.();
    stopDemoRef.current = playDemo(
      cardRef.current,
      {
        style: alertsSettings.alertStyle,
        position: alertsSettings.position,
        energy: alertsSettings.energy,
        accent: shot.accent,
        emotion: shot.eventType === 'bits' ? 'excited' : shot.eventType === 'sub' ? 'happy' : null,
      },
      alertsSettings.duration
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot?.key]);

  const testSelected = () => {
    if (custom) {
      fire({
        label: custom.name,
        eventType: 'follow',
        user: 'EspectadorVIP',
        text: fill(custom.template, 'EspectadorVIP', {}),
        detail: custom.triggerKeyword,
        accent: custom.accentColor || alertsSettings.accent,
        soundType: custom.soundType,
        audioMode: custom.audioMode,
        customAudioUrl: custom.customAudioUrl,
        customAudioVolume: custom.customAudioVolume ?? alertsSettings.soundVolume,
        videoUrl: custom.videoUrl,
        blendMode: custom.blendMode,
        videoScale: custom.videoScale || 1,
        screenShake: custom.screenShake,
      });
      return;
    }
    const sample = SAMPLE[eventType];
    fire({
      label: eventMeta.label,
      eventType,
      user: sample.user,
      text: fill(eventConfig.template, sample.user, sample.vars),
      detail: sample.detail,
      accent: alertsSettings.accent,
      soundType: eventConfig.soundType,
      audioMode: eventConfig.audioMode || 'synth',
      customAudioUrl: eventConfig.customAudioUrl,
      customAudioVolume: eventConfig.customAudioVolume ?? alertsSettings.soundVolume,
      videoUrl: eventConfig.videoUrl,
      blendMode: eventConfig.blendMode,
      videoScale: eventConfig.videoScale,
      screenShake: eventConfig.screenShake,
    });
  };

  const testTier = (tier: BitTierConfig | SubTierConfig, type: 'bits' | 'sub') => {
    const base = alertsSettings.events[type];
    const isGift = 'tier' in tier && tier.tier === 'gift';
    const vars: Record<string, string> =
      type === 'bits'
        ? { bits: String((tier as BitTierConfig).minBits), message: '¡Hype total!' }
        : { detail: isGift ? 'Regaló 5 suscripciones' : 'Mes 12 de suscripción' };
    const user = type === 'bits' ? 'DonadorHype' : 'SuscriptorEstrella';
    fire({
      label: tier.name,
      eventType: type,
      user,
      text: fill(tier.template, user, vars),
      detail: type === 'bits' ? `${(tier as BitTierConfig).minBits} bits` : vars.detail || null,
      accent: tier.accent,
      soundType: tier.soundType,
      audioMode: 'both',
      customAudioUrl: tier.customAudioUrl || base.customAudioUrl,
      customAudioVolume: tier.customAudioVolume ?? base.customAudioVolume ?? alertsSettings.soundVolume,
      videoUrl: tier.videoUrl || base.videoUrl,
      blendMode: tier.blendMode || base.blendMode,
      videoScale: base.videoScale,
      screenShake: tier.screenShake,
    });
  };

  // ---------- URL de OBS ----------
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const copyWidgetUrl = () => {
    const url = buildSuiteWidgetUrl(
      baseUrl,
      'alerts',
      alertsSettings.channel,
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

  // ---------- Vista previa en reposo ----------
  const restSample = SAMPLE[eventType];
  const preview = shot || {
    user: custom ? 'EspectadorVIP' : restSample.user,
    text: custom ? fill(custom.template, 'EspectadorVIP', {}) : fill(eventConfig.template, restSample.user, restSample.vars),
    detail: custom ? custom.triggerKeyword : restSample.detail,
    accent: itemAccent,
  };

  const rootStyle = {
    '--acc': alertsSettings.accent,
    '--acc-ink': inkFor(alertsSettings.accent),
  } as React.CSSProperties;

  const tiers: { type: 'bits' | 'sub'; list: (BitTierConfig | SubTierConfig)[] } | null =
    custom || (eventType !== 'bits' && eventType !== 'sub')
      ? null
      : eventType === 'bits'
      ? { type: 'bits', list: bitTiers }
      : { type: 'sub', list: subTiers };

  return (
    <div className="cab" style={{ ...rootStyle, paddingBottom: tourOpen ? 220 : undefined }}>
      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-6">
        <SuiteNav
          currentApp="alertas"
          channel={alertsSettings.channel}
          saved={saved}
          onOpenTour={() => setTourOpen(true)}
          tourAvailable={!tourOpen}
        />

        <div className="grid items-start gap-5 min-[1200px]:grid-cols-[230px_minmax(0,1fr)_minmax(0,350px)]">
          {/* ---------- Lista de eventos ---------- */}
          <section className="cab-mod" data-tour="alert-events">
            <h2>Eventos</h2>
            <ul className="cab-rows !max-h-none">
              {EVENTS.map((entry) => {
                const config = alertsSettings.events[entry.type];
                const current = selection.kind === 'event' && selection.type === entry.type;
                return (
                  <li key={entry.type} className="cab-row" data-current={current ? '' : undefined}>
                    <button
                      type="button"
                      className="studio-pick"
                      aria-current={current ? 'true' : undefined}
                      onClick={() => select({ kind: 'event', type: entry.type })}
                    >
                      {entry.label}
                    </button>
                    <input
                      type="checkbox"
                      className="cab-tog"
                      checked={config.enabled}
                      aria-label={`Activar ${entry.label}`}
                      onChange={(e) => updateEvent(entry.type, { enabled: e.target.checked })}
                    />
                  </li>
                );
              })}
              {customEvents.map((rule) => {
                const current = selection.kind === 'custom' && selection.id === rule.id;
                return (
                  <li key={rule.id} className="cab-row" data-current={current ? '' : undefined}>
                    <button
                      type="button"
                      className="studio-pick"
                      aria-current={current ? 'true' : undefined}
                      onClick={() => select({ kind: 'custom', id: rule.id })}
                    >
                      {rule.name}
                      <span className="cab-mono">{rule.triggerKeyword}</span>
                    </button>
                    <input
                      type="checkbox"
                      className="cab-tog"
                      checked={rule.enabled}
                      aria-label={`Activar ${rule.name}`}
                      onChange={(e) => updateCustom(rule.id, { enabled: e.target.checked })}
                    />
                  </li>
                );
              })}
            </ul>
            <button type="button" className="cab-btn2" onClick={createCustom}>
              <Plus className="h-4 w-4" />
              <span>Nuevo evento</span>
            </button>
            {undo && (
              <p className="cab-note" role="status">
                Se eliminó «{undo.rule.name}».{' '}
                <button type="button" className="studio-link" onClick={restoreCustom}>
                  Deshacer
                </button>
              </p>
            )}
          </section>

          {/* ---------- Editor ---------- */}
          <section className="cab-mod" data-tour="alert-editor">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2>{itemLabel}</h2>
              {custom && (
                <button type="button" className="cab-btn2 cab-btn-sm" onClick={() => deleteCustom(custom)}>
                  <Trash2 className="h-4 w-4" />
                  <span>Eliminar</span>
                </button>
              )}
            </div>

            {custom && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nombre" htmlFor={`${uid}-name`}>
                  <input
                    id={`${uid}-name`}
                    className="cab-inp"
                    value={custom.name}
                    onChange={(e) => updateCustom(custom.id, { name: e.target.value })}
                  />
                </Field>
                <Field label="Palabra del chat" htmlFor={`${uid}-keyword`} hint="El evento se dispara cuando alguien la escribe.">
                  <input
                    id={`${uid}-keyword`}
                    className="cab-inp cab-mono"
                    value={custom.triggerKeyword}
                    onChange={(e) => updateCustom(custom.id, { triggerKeyword: e.target.value.trim() })}
                  />
                </Field>
              </div>
            )}

            <Field
              label="Mensaje"
              htmlFor={`${uid}-template`}
              hint={
                <>
                  Variables: <span className="cab-mono">{custom ? '{user}' : eventMeta.vars}</span>
                </>
              }
            >
              <input
                id={`${uid}-template`}
                className="cab-inp"
                value={item.template}
                onChange={(e) => patchItem({ template: e.target.value })}
              />
            </Field>

            {!custom && (eventType === 'bits' || eventType === 'raid') && (
              <Field
                label={eventType === 'bits' ? 'Bits mínimos' : 'Espectadores mínimos'}
                htmlFor={`${uid}-min`}
                hint="Por debajo de esta cantidad la alerta no aparece."
              >
                <input
                  id={`${uid}-min`}
                  type="number"
                  min={0}
                  className="cab-inp sm:max-w-[160px]"
                  value={eventConfig.minAmount ?? 0}
                  onChange={(e) => updateEvent(eventType, { minAmount: Math.max(0, Number(e.target.value) || 0) })}
                />
              </Field>
            )}

            <Field label="Sonido" htmlFor={`${uid}-sound`}>
              <div className="flex flex-wrap items-center gap-2" data-tour="alert-audio">
                <select
                  id={`${uid}-sound`}
                  className="cab-inp flex-1 basis-48"
                  value={hasFile || wantsFile ? 'file' : item.soundType}
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
                  onClick={() => playAlertOrCustomSound(item.customAudioUrl, item.soundType, volume)}
                >
                  <Play className="h-4 w-4" />
                  <span>Escuchar</span>
                </button>
              </div>

              {(hasFile || wantsFile) && (
                <div className="grid gap-3 rounded border border-[color:var(--cb-line)] p-3">
                  <p className="cab-hint">
                    {hasFile
                      ? `Archivo: ${item.customAudioName || 'sin nombre'}${
                          item.customAudioDuration ? ` · ${item.customAudioDuration} s` : ''
                        }`
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
                  </div>
                  {audioError && (
                    <p className="cab-error" role="alert">
                      {audioError}
                    </p>
                  )}
                  {hasFile && (
                    <div className="cab-range">
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={volume}
                        aria-label="Volumen del archivo"
                        onChange={(e) => patchItem({ customAudioVolume: Number(e.target.value) })}
                      />
                      <output>{Math.round(volume * 100)}%</output>
                    </div>
                  )}
                </div>
              )}
            </Field>

            <Toggle
              label="Leer el mensaje con la voz del chat"
              checked={usesTts(item.audioMode)}
              onChange={(next) => patchItem({ audioMode: audioModeFor(next, hasFile, item.soundType) })}
            />
            <Toggle
              label="Sacudir la pantalla"
              checked={Boolean(item.screenShake)}
              onChange={(next) => patchItem({ screenShake: next })}
            />

            {custom && (
              <Field label="Color del evento">
                <div className="cab-sw">
                  {ACCENTS.map((accent) => (
                    <button
                      key={accent.color}
                      type="button"
                      style={{ background: accent.color }}
                      aria-label={accent.name}
                      aria-pressed={custom.accentColor === accent.color}
                      onClick={() => updateCustom(custom.id, { accentColor: accent.color })}
                    />
                  ))}
                </div>
              </Field>
            )}

            <details className="studio-details" data-tour="alert-video">
              <summary>Vídeo o meme{item.videoUrl ? ' · 1 archivo' : ''}</summary>
              <div>
                <p className="cab-hint">
                  {item.videoUrl
                    ? `Archivo: ${item.videoName || 'vídeo sin nombre'}`
                    : 'Sin vídeo. Se reproduce encima de la alerta mientras está en pantalla.'}
                </p>
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
                  {item.videoUrl && (
                    <button
                      type="button"
                      className="cab-btn2 cab-btn-sm"
                      onClick={() => patchItem({ videoUrl: undefined, videoName: undefined })}
                    >
                      Quitar vídeo
                    </button>
                  )}
                </div>
                {item.videoUrl && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Fondo del vídeo" htmlFor={`${uid}-blend`}>
                      <select
                        id={`${uid}-blend`}
                        className="cab-inp"
                        value={item.blendMode || 'transparent'}
                        onChange={(e) => patchItem({ blendMode: e.target.value as AlertBlendMode })}
                      >
                        {BLEND_MODES.map((mode) => (
                          <option key={mode.id} value={mode.id}>
                            {mode.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Tamaño del vídeo">
                      <div className="cab-range">
                        <input
                          type="range"
                          min={0.5}
                          max={2}
                          step={0.05}
                          value={item.videoScale ?? 1}
                          aria-label="Tamaño del vídeo"
                          onChange={(e) => patchItem({ videoScale: Number(e.target.value) })}
                        />
                        <output>{Math.round((item.videoScale ?? 1) * 100)}%</output>
                      </div>
                    </Field>
                  </div>
                )}
              </div>
            </details>

            {tiers && (
              <details className="studio-details" data-tour="alert-tiers">
                <summary>Niveles · {tiers.list.length}</summary>
                <div>
                  <p className="cab-hint">
                    {tiers.type === 'bits'
                      ? 'Cada nivel se aplica desde su cantidad de bits y cambia mensaje, color y sonido.'
                      : 'Cada tipo de suscripción puede tener su propio mensaje, color y sonido.'}
                  </p>
                  {tiers.list.map((tier) => {
                    const patch = (value: Partial<BitTierConfig & SubTierConfig>) =>
                      tiers.type === 'bits' ? updateBitTier(tier.id, value) : updateSubTier(tier.id, value);
                    return (
                      <fieldset key={tier.id} className="studio-tier">
                        <legend className="sr-only">{tier.name}</legend>
                        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                          <input
                            className="cab-inp"
                            value={tier.name}
                            aria-label="Nombre del nivel"
                            onChange={(e) => patch({ name: e.target.value })}
                          />
                          {'minBits' in tier && (
                            <input
                              type="number"
                              min={1}
                              className="cab-inp sm:w-28"
                              value={tier.minBits}
                              aria-label="Desde cuántos bits"
                              onChange={(e) => patch({ minBits: Math.max(1, Number(e.target.value) || 1) })}
                            />
                          )}
                        </div>
                        <input
                          className="cab-inp"
                          value={tier.template}
                          aria-label={`Mensaje de ${tier.name}`}
                          onChange={(e) => patch({ template: e.target.value })}
                        />
                        <div className="flex flex-wrap items-center gap-3">
                          <input
                            type="color"
                            className="studio-color"
                            value={tier.accent}
                            aria-label={`Color de ${tier.name}`}
                            onChange={(e) => patch({ accent: e.target.value })}
                          />
                          <select
                            className="cab-inp flex-1 basis-36"
                            value={tier.soundType}
                            aria-label={`Sonido de ${tier.name}`}
                            onChange={(e) => patch({ soundType: e.target.value as AlertSoundType })}
                          >
                            {SOUNDS.map((sound) => (
                              <option key={sound.id} value={sound.id}>
                                {sound.name}
                              </option>
                            ))}
                          </select>
                          <Toggle
                            label="Sacudir"
                            checked={Boolean(tier.screenShake)}
                            onChange={(next) => patch({ screenShake: next })}
                          />
                          <button type="button" className="cab-btn2 cab-btn-sm" onClick={() => testTier(tier, tiers.type)}>
                            Probar
                          </button>
                        </div>
                      </fieldset>
                    );
                  })}
                </div>
              </details>
            )}

            <details className="studio-details" data-tour="alert-appearance">
              <summary>Apariencia de todas las alertas</summary>
              <div>
                <Field label="Estilo">
                  <div className="cab-seg" role="group" aria-label="Estilo de las alertas">
                    {ALERT_STYLES.map((style) => (
                      <button
                        key={style.id}
                        type="button"
                        aria-pressed={alertsSettings.alertStyle === style.id}
                        title={style.description}
                        onClick={() => updateAlerts({ alertStyle: style.id })}
                      >
                        {style.name}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Color">
                  <div className="cab-sw">
                    {ACCENTS.map((accent) => (
                      <button
                        key={accent.color}
                        type="button"
                        style={{ background: accent.color }}
                        aria-label={accent.name}
                        aria-pressed={alertsSettings.accent === accent.color}
                        onClick={() => updateAlerts({ accent: accent.color })}
                      />
                    ))}
                    <input
                      type="color"
                      value={alertsSettings.accent}
                      aria-label="Otro color"
                      onChange={(e) => updateAlerts({ accent: e.target.value })}
                    />
                  </div>
                </Field>
                <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
                  <Field label="Posición">
                    <div className="cab-pos" role="group" aria-label="Posición en pantalla">
                      {ALERT_POSITIONS.map((position) => (
                        <button
                          key={position.id}
                          type="button"
                          aria-label={position.name}
                          aria-pressed={alertsSettings.position === position.id}
                          onClick={() => updateAlerts({ position: position.id })}
                        />
                      ))}
                    </div>
                  </Field>
                  <div className="grid content-start gap-4">
                    <Field label="Tiempo en pantalla">
                      <div className="cab-range">
                        <input
                          type="range"
                          min={2}
                          max={15}
                          step={1}
                          value={alertsSettings.duration}
                          aria-label="Tiempo en pantalla"
                          onChange={(e) => updateAlerts({ duration: Number(e.target.value) })}
                        />
                        <output>{alertsSettings.duration} s</output>
                      </div>
                    </Field>
                    <Field label="Volumen general">
                      <div className="cab-range">
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={alertsSettings.soundVolume}
                          aria-label="Volumen general"
                          onChange={(e) => updateAlerts({ soundVolume: Number(e.target.value) })}
                        />
                        <output>{Math.round(alertsSettings.soundVolume * 100)}%</output>
                      </div>
                    </Field>
                  </div>
                </div>
              </div>
            </details>
          </section>

          {/* ---------- Monitor ---------- */}
          <section className="cab-mod max-[1199px]:order-first min-[1200px]:sticky min-[1200px]:top-4" data-tour="stage-monitor">
            <h2>Monitor</h2>
            <div ref={stageRef} className={`cab-stage ${STAGE_POSITION[alertsSettings.position]}`}>
              {monitorVideo && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
                  <video
                    src={monitorVideo.url}
                    autoPlay
                    playsInline
                    className="max-h-full w-auto object-contain"
                    style={{ mixBlendMode: monitorVideo.blend === 'screen' ? 'screen' : 'normal' }}
                  />
                </div>
              )}
              <AlertCard
                ref={cardRef}
                alertStyle={alertsSettings.alertStyle}
                position={alertsSettings.position}
                accent={preview.accent}
                name={preview.user}
                text={preview.text}
                emotionLabel={preview.detail || undefined}
                stickerSvg={alertsSettings.stickerSvg}
                fontSize="clamp(8px, 3.1cqw, 16px)"
              />
            </div>

            <div className="flex flex-wrap gap-2" data-tour="test-trigger">
              <button type="button" className="cab-btn flex-1" onClick={testSelected}>
                <Play className="h-4 w-4" />
                <span>Probar {itemLabel}</span>
              </button>
              <button type="button" className="cab-btn2 flex-1" onClick={copyWidgetUrl} data-tour="alert-obs">
                {copiedUrl ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span>{copiedUrl ? 'URL copiada' : 'Copiar URL para OBS'}</span>
              </button>
            </div>
            <p className="cab-hint" role="status">
              {status || 'La prueba suena aquí y aparece en las fuentes de OBS que estén abiertas.'}
            </p>
          </section>
        </div>

        <MediaLibraryModal
          isOpen={vault !== null}
          onClose={() => setVault(null)}
          onSelect={handleVaultSelect}
          allowedTypes={[vault || 'audio']}
          title={vault === 'video' ? 'Biblioteca · elegir vídeo' : 'Biblioteca · elegir sonido (máximo 30 s)'}
        />
      </div>

      {tourOpen && (
        <GuidedTour steps={ALERTS_TOUR_STEPS} onClose={() => setTourOpen(false)} id={TOUR_ID} appName="Alertas" />
      )}
    </div>
  );
};
