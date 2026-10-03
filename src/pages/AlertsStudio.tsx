/**
 * src/pages/AlertsStudio.tsx
 *
 * Estudio de configuración y pruebas en vivo para Alertas de Stream.
 * Permite personalizar eventos de Follows, Suscripciones, Bits y Raids,
 * elegir estilos visuales coherentes con la cabina, sonidos sintetizados
 * con Web Audio API y probar la física con GSAP en el monitor 16:9.
 */

import React, { useRef, useState, useEffect } from 'react';
import gsap from 'gsap';
import {
  Check,
  Copy,
  ExternalLink,
  Flame,
  FolderOpen,
  Heart,
  Mic,
  Music,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Tv,
  Upload,
  Video,
  Volume2,
  Zap,
  AlertCircle,
} from 'lucide-react';
import { SuiteNav } from '../components/SuiteNav';
import { useAlertsSettings } from '../hooks/useAlertsSettings';
import { GuidedTour, TourStep, isTourDone } from '../components/GuidedTour';
import {
  AlertEventType,
  AlertSoundType,
  AlertBlendMode,
  AlertAudioMode,
  CustomAlertRule,
  BitTierConfig,
  SubTierConfig,
} from '../types/alerts';
import {
  ALERT_POSITIONS,
  ALERT_STYLES,
  AlertPosition,
  inkFor,
} from '../utils/appearance';
import { AlertCard } from '../components/AlertCard';
import { playDemo, resetAlert } from '../utils/alertMotion';
import { playAlertAudio, playAlertOrCustomSound, playCustomAudio } from '../utils/alertsAudio';
import { postBus } from '../utils/bus';
import { MediaLibraryModal } from '../components/MediaLibraryModal';
import {
  inspectAudioFile,
  MediaItem,
  MediaType,
  MAX_AUDIO_DURATION_SECONDS,
} from '../types/mediaLibrary';

const TOUR_ID = 'alertas';

const ALERTS_TOUR_STEPS: TourStep[] = [
  {
    badge: 'Bienvenida',
    title: 'Estudio de Alertas Cinemáticas',
    body: (
      <>
        Bienvenido al Estudio de Alertas de Stream. Aquí puedes personalizar cómo reacciona tu transmisión en tiempo real ante nuevos seguidores, suscripciones, donaciones de bits y raids, con estética broadcast y física fluida en GSAP.
      </>
    ),
  },
  {
    target: 'alert-events',
    badge: 'Configuración',
    title: 'Selector de Eventos y Plantillas',
    body: 'Elige qué tipo de evento configurar: Seguidores, Suscripciones, Bits o Raids. Puedes activar o desactivar cada evento por separado y personalizar el mensaje en pantalla usando variables automáticas como {user}, {bits} o {viewers}.',
  },
  {
    target: 'alert-audio',
    badge: 'Audio Broadcast',
    title: 'Motor de Audio y Fanfarrias',
    body: 'Configura el sonido de la alerta: utiliza timbres sintéticos de latencia cero generados por Web Audio API (Campana Synth, Fanfarria Retro, Arcade) o sube clips de audio personalizados de hasta 30 segundos (MP3/WAV) con control de volumen independiente.',
  },
  {
    target: 'alert-video',
    badge: 'Efectos Visuales',
    title: 'Videos Transparentes (WebM Alfa)',
    body: 'Añade videos con canal alfa transparente o videos con fondo negro usando el modo Screen Blend. Las animaciones se superpondrán directamente sobre la alerta creando un efecto visual dinámico.',
  },
  {
    target: 'alert-tiers',
    badge: 'Acción del Sistema',
    title: 'Niveles de Bits, Subs y Eventos Especiales',
    body: 'Crea alertas diferenciadas según la magnitud del apoyo: por ejemplo, sonidos y sacudidas de pantalla más intensas para donaciones de más de 500 bits, o palabras clave especiales del chat como !hype o !meta.',
  },
  {
    target: 'alert-appearance',
    badge: 'Diseño Visual',
    title: 'Estilos Cabina, Bocadillo, Subtítulo y Sticker',
    body: 'Selecciona uno de los cuatro estilos visuales coherentes con la suite, asigna el color de acento de tu marca, ajusta el cuadrante de posición en OBS (16:9) y la duración en pantalla.',
  },
  {
    target: 'stage-monitor',
    badge: 'Previsualización',
    title: 'Monitor en Vivo 16:9 con Física GSAP',
    body: 'El monitor simula en tiempo real la escena de OBS Studio. Te permite apreciar la curva elástica de entrada, el tiempo de visualización y la salida suave calculada con física de resortes.',
  },
  {
    target: 'test-trigger',
    badge: 'Acción del Sistema',
    title: 'Banco de Pruebas Rápidas',
    body: 'Pulsa cualquiera de los botones de prueba rápida (Follow, Sub, Bits, Raid) para disparar la animación en tu monitor y enviarla al instante a OBS Studio a través del BroadcastChannel.',
  },
  {
    target: 'alert-obs',
    badge: 'Acción del Sistema',
    title: 'Enlace de Widget para OBS Studio',
    body: 'Copia la URL del overlay de alertas y agrégala en OBS Studio como Fuente de Navegador (1920 × 1080). Todas tus personalizaciones de audio, estilo y video se reflejarán automáticamente.',
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

const SOUND_PRESETS: { id: AlertSoundType; name: string; desc: string }[] = [
  { id: 'synth-bell', name: 'Campana Synth', desc: 'Limpio y cristalino' },
  { id: 'retro-fanfare', name: 'Fanfarria Retro', desc: 'Arpegio mayor triunfal' },
  { id: 'arcade-chime', name: 'Chime Arcade', desc: 'Brillante y dinámico 16-bit' },
  { id: 'soft-pop', name: 'Pop Cálido', desc: 'Sutil y redondeado' },
  { id: 'none', name: 'Silencioso', desc: 'Sin efecto de sonido' },
];

const BLEND_MODE_OPTIONS: { id: AlertBlendMode; label: string; desc: string }[] = [
  { id: 'transparent', label: 'WebM Transparente (Alfa)', desc: 'Canal alfa nativo sin fondo' },
  { id: 'screen', label: 'Screen Blend (Fondo Negro)', desc: 'Elimina fondos oscuros' },
  { id: 'chroma-green', label: 'Chroma Verde', desc: 'Filtro para pantalla verde (#00ff00)' },
];

const AUDIO_MODE_OPTIONS: {
  id: AlertAudioMode;
  label: string;
  desc: string;
  badge: string;
}[] = [
  {
    id: 'synth',
    label: 'Timbre Sintético',
    desc: 'Web Audio API cero-latencia sin descargas',
    badge: 'Cero-Latencia',
  },
  {
    id: 'custom_audio',
    label: 'Audio Clip (máx 30s)',
    desc: 'Archivo MP3, WAV u OGG de tu biblioteca',
    badge: '≤ 30s Max',
  },
  {
    id: 'tts',
    label: 'Voz TTS',
    desc: 'Lee el mensaje de alerta con la voz sintetizada',
    badge: 'Fish Audio',
  },
  {
    id: 'both',
    label: 'Intro + Voz TTS',
    desc: 'Fanfarria inicial seguida de locución hablada',
    badge: 'Híbrido',
  },
];

const STAGE_POSITION: Record<AlertPosition, string> = {
  tl: 'items-start justify-start',
  tc: 'items-start justify-center',
  tr: 'items-start justify-end',
  bl: 'items-end justify-start',
  bc: 'items-end justify-center',
  br: 'items-end justify-end',
};

export const AlertsStudio: React.FC = () => {
  const { alertsSettings, updateAlerts, saved } = useAlertsSettings();
  const [activeEventTab, setActiveEventTab] = useState<AlertEventType>('follow');
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [demoStatus, setDemoStatus] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [tourOpen, setTourOpen] = useState(false);

  // La guía se abre sola la primera vez; después se accede desde el botón en la cabecera
  useEffect(() => {
    if (isTourDone(TOUR_ID)) return;
    const timer = setTimeout(() => setTourOpen(true), 600);
    return () => clearTimeout(timer);
  }, []);

  // Modal de Biblioteca de Medios (Media Vault)
  const [isMediaModalOpen, setIsMediaModalOpen] = useState(false);
  const [mediaModalType, setMediaModalType] = useState<MediaType>('audio');
  const [mediaModalTarget, setMediaModalTarget] = useState<
    'activeEvent_audio' | 'activeEvent_video' | 'customEvent_audio' | 'customEvent_video'
  >('activeEvent_audio');
  const [targetCustomEventId, setTargetCustomEventId] = useState<string | null>(null);

  // Formulario de creación de eventos personalizados
  const [isCreatingCustom, setIsCreatingCustom] = useState(false);
  const [newCustomName, setNewCustomName] = useState('');
  const [newCustomKeyword, setNewCustomKeyword] = useState('!');
  const [newCustomTemplate, setNewCustomTemplate] = useState('¡{user} activó un evento especial!');
  const [newCustomAudioMode, setNewCustomAudioMode] = useState<AlertAudioMode>('both');
  const [newCustomSoundType, setNewCustomSoundType] = useState<AlertSoundType>('retro-fanfare');
  const [newCustomShake, setNewCustomShake] = useState(true);
  const [newCustomAccent, setNewCustomAccent] = useState('#9146ff');

  // Estado de la alerta que se muestra en el monitor de previsualización
  const [previewUser, setPreviewUser] = useState('GamerLegendario');
  const [previewText, setPreviewText] = useState('¡Acaba de seguir el canal!');
  const [previewDetail, setPreviewDetail] = useState<string | null>(null);

  const cardRef = useRef<HTMLDivElement | null>(null);
  const monitorStageRef = useRef<HTMLDivElement | null>(null);
  const [monitorVideoActive, setMonitorVideoActive] = useState<string | null>(null);
  const stopDemoRef = useRef<(() => void) | null>(null);

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const widgetUrl = `${baseUrl}/#widget?app=alerts&channel=${alertsSettings.channel}`;

  // Actualizar texto de previsualización al cambiar de evento
  useEffect(() => {
    const ev = alertsSettings.events[activeEventTab];
    if (!ev) return;
    if (activeEventTab === 'follow') {
      setPreviewUser('GamerLegendario');
      setPreviewText(ev.template.replace('{user}', 'GamerLegendario'));
      setPreviewDetail(null);
    } else if (activeEventTab === 'sub') {
      setPreviewUser('SuperSubscriptor');
      setPreviewText(
        ev.template
          .replace('{user}', 'SuperSubscriptor')
          .replace('{detail}', 'Nivel 1 · 3 meses')
      );
      setPreviewDetail('Tier 1 · 3 meses');
    } else if (activeEventTab === 'bits') {
      setPreviewUser('DonadorEstrella');
      setPreviewText(
        ev.template
          .replace('{user}', 'DonadorEstrella')
          .replace('{bits}', '500')
          .replace('{message}', '¡Gran directo sigue así!')
      );
      setPreviewDetail('500 Bits');
    } else if (activeEventTab === 'raid') {
      setPreviewUser('StreamerAmigo');
      setPreviewText(
        ev.template
          .replace('{user}', 'StreamerAmigo')
          .replace('{viewers}', '48')
      );
      setPreviewDetail('48 espectadores');
    }
  }, [activeEventTab, alertsSettings.events]);

  // Reproducir ciclo de demostración visual, sonoro y de video
  const runDemo = (
    eventType?: AlertEventType,
    override?: {
      sound?: AlertSoundType;
      customAudioUrl?: string;
      customAudioVolume?: number;
      screenShake?: boolean;
      accent?: string;
      videoUrl?: string;
      blendMode?: AlertBlendMode;
    }
  ) => {
    stopDemoRef.current?.();
    const type = eventType || activeEventTab;
    const evConfig = alertsSettings.events[type];

    // Reproducir audio personalizado o sintetizado
    const customAudio =
      override?.customAudioUrl !== undefined
        ? override.customAudioUrl
        : evConfig?.customAudioUrl;
    const sound = override?.sound || evConfig?.soundType || alertsSettings.soundType;
    const vol =
      override?.customAudioVolume ??
      evConfig?.customAudioVolume ??
      alertsSettings.soundVolume;
    playAlertOrCustomSound(customAudio, sound, vol);

    // Sacudida física de pantalla si está habilitada
    const hasShake =
      override?.screenShake !== undefined ? override.screenShake : evConfig?.screenShake;
    if (hasShake && monitorStageRef.current) {
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

    // Video transparente en el monitor
    const vid = override?.videoUrl !== undefined ? override.videoUrl : evConfig?.videoUrl;
    if (vid) {
      setMonitorVideoActive(vid);
      setTimeout(() => setMonitorVideoActive(null), alertsSettings.duration * 1000);
    } else {
      setMonitorVideoActive(null);
    }

    if (cardRef.current) {
      stopDemoRef.current = playDemo(
        cardRef.current,
        {
          style: alertsSettings.alertStyle,
          position: alertsSettings.position,
          energy: alertsSettings.energy,
          accent: override?.accent || alertsSettings.accent,
          emotion: type === 'bits' ? 'excited' : type === 'sub' ? 'happy' : null,
        },
        alertsSettings.duration
      );
    }
  };

  // Enviar alerta de prueba al bus (reproducirá en el OBS abierto)
  const broadcastTest = (type: AlertEventType) => {
    runDemo(type);
    const evConfig = alertsSettings.events[type];
    const user =
      type === 'follow'
        ? 'NuevoSeguidor'
        : type === 'sub'
        ? 'SubscriptorVIP'
        : type === 'bits'
        ? 'DonadorTop'
        : 'StreamerHost';

    let text = evConfig.template.replace('{user}', user);
    if (type === 'sub') text = text.replace('{detail}', 'Nivel 1 · 6 meses');
    if (type === 'bits') text = text.replace('{bits}', '500').replace('{message}', '¡Éxitos!');
    if (type === 'raid') text = text.replace('{viewers}', '35');

    postBus({
      type: 'ALERT_TRIGGER',
      alert: {
        id: `alert-${Date.now()}`,
        eventType: type,
        user,
        text,
        style: alertsSettings.alertStyle,
        accent: alertsSettings.accent,
        soundType: evConfig.soundType,
        duration: alertsSettings.duration,
        videoUrl: evConfig.videoUrl,
        blendMode: evConfig.blendMode,
        videoScale: evConfig.videoScale,
        screenShake: evConfig.screenShake,
        customAudioUrl: evConfig.customAudioUrl,
        customAudioVolume: evConfig.customAudioVolume ?? alertsSettings.soundVolume,
        audioMode: evConfig.audioMode || 'synth',
      },
    });

    setDemoStatus(`¡Alerta de ${type.toUpperCase()} enviada a OBS y al monitor!`);
    setTimeout(() => setDemoStatus(null), 3000);
  };

  // Disparar prueba para un Tier específico de Bits
  const broadcastTierBits = (tier: BitTierConfig) => {
    runDemo('bits', {
      sound: tier.soundType,
      customAudioUrl: tier.customAudioUrl,
      customAudioVolume: tier.customAudioVolume,
      screenShake: tier.screenShake,
      accent: tier.accent,
      videoUrl: tier.videoUrl,
      blendMode: tier.blendMode,
    });

    const user = 'DonadorHype';
    const text = tier.template
      .replace('{user}', user)
      .replace('{bits}', String(tier.minBits))
      .replace('{message}', '¡Hype total en el canal!');

    postBus({
      type: 'ALERT_TRIGGER',
      alert: {
        id: `alert-bits-${tier.id}-${Date.now()}`,
        eventType: 'bits',
        user,
        text,
        style: alertsSettings.alertStyle,
        accent: tier.accent,
        soundType: tier.soundType,
        duration: alertsSettings.duration,
        videoUrl: tier.videoUrl || activeEvent.videoUrl,
        blendMode: tier.blendMode || activeEvent.blendMode,
        videoScale: activeEvent.videoScale,
        screenShake: tier.screenShake,
        customAudioUrl: tier.customAudioUrl || activeEvent.customAudioUrl,
        customAudioVolume:
          tier.customAudioVolume ?? activeEvent.customAudioVolume ?? alertsSettings.soundVolume,
        audioMode: 'both',
      },
    });

    setDemoStatus(`¡Nivel de Bits «${tier.name}» disparado a OBS y monitor!`);
    setTimeout(() => setDemoStatus(null), 3000);
  };

  // Disparar prueba para un Tier específico de Subs
  const broadcastTierSub = (tier: SubTierConfig) => {
    runDemo('sub', {
      sound: tier.soundType,
      customAudioUrl: tier.customAudioUrl,
      customAudioVolume: tier.customAudioVolume,
      screenShake: tier.screenShake,
      accent: tier.accent,
      videoUrl: tier.videoUrl,
      blendMode: tier.blendMode,
    });

    const user = 'SuscriptorEstrella';
    const text = tier.template
      .replace('{user}', user)
      .replace(
        '{detail}',
        tier.tier === 'gift' ? 'Regaló 5 suscripciones' : 'Mes 12 de suscripción'
      );

    postBus({
      type: 'ALERT_TRIGGER',
      alert: {
        id: `alert-sub-${tier.id}-${Date.now()}`,
        eventType: 'sub',
        user,
        text,
        style: alertsSettings.alertStyle,
        accent: tier.accent,
        soundType: tier.soundType,
        duration: alertsSettings.duration,
        videoUrl: tier.videoUrl || activeEvent.videoUrl,
        blendMode: tier.blendMode || activeEvent.blendMode,
        videoScale: activeEvent.videoScale,
        screenShake: tier.screenShake,
        customAudioUrl: tier.customAudioUrl || activeEvent.customAudioUrl,
        customAudioVolume:
          tier.customAudioVolume ?? activeEvent.customAudioVolume ?? alertsSettings.soundVolume,
        audioMode: 'both',
      },
    });

    setDemoStatus(`¡Nivel de Sub «${tier.name}» disparado a OBS y monitor!`);
    setTimeout(() => setDemoStatus(null), 3000);
  };

  // Disparar evento personalizado en vivo
  const broadcastCustomEvent = (rule: CustomAlertRule) => {
    const user = 'EspectadorVIP';
    const text = rule.template.replace('{user}', user);

    runDemo(undefined, {
      sound: rule.soundType,
      customAudioUrl: rule.customAudioUrl,
      customAudioVolume: rule.customAudioVolume ?? alertsSettings.soundVolume,
      screenShake: rule.screenShake,
      accent: rule.accentColor,
      videoUrl: rule.videoUrl,
      blendMode: rule.blendMode,
    });

    postBus({
      type: 'ALERT_TRIGGER',
      alert: {
        id: `alert-custom-${rule.id}-${Date.now()}`,
        eventType: 'follow',
        user,
        text,
        style: alertsSettings.alertStyle,
        accent: rule.accentColor || alertsSettings.accent,
        soundType: rule.soundType,
        duration: alertsSettings.duration,
        videoUrl: rule.videoUrl,
        blendMode: rule.blendMode,
        videoScale: rule.videoScale || 1.0,
        screenShake: rule.screenShake,
        customAudioUrl: rule.customAudioUrl,
        customAudioVolume: rule.customAudioVolume ?? alertsSettings.soundVolume,
        audioMode: rule.audioMode,
      },
    });

    setDemoStatus(`¡Evento «${rule.name}» disparado a OBS y monitor!`);
    setTimeout(() => setDemoStatus(null), 3000);
  };

  // Abrir la Biblioteca de Medios (Media Vault)
  const openMediaVault = (
    type: MediaType,
    target: 'activeEvent_audio' | 'activeEvent_video' | 'customEvent_audio' | 'customEvent_video',
    customId?: string
  ) => {
    setMediaModalType(type);
    setMediaModalTarget(target);
    setTargetCustomEventId(customId || null);
    setIsMediaModalOpen(true);
  };

  // Manejar selección de elemento desde la Biblioteca de Medios
  const handleMediaModalSelect = (item: MediaItem) => {
    setIsMediaModalOpen(false);
    if (mediaModalTarget === 'activeEvent_audio') {
      updateCurrentEvent({
        customAudioUrl: item.url,
        customAudioName: item.name,
        customAudioDuration: item.duration,
        customAudioVolume: activeEvent.customAudioVolume ?? alertsSettings.soundVolume,
        audioMode: 'custom_audio',
      });
      setDemoStatus(`¡Audio «${item.name}» (${item.duration}s) asignado desde la Biblioteca!`);
    } else if (mediaModalTarget === 'activeEvent_video') {
      updateCurrentEvent({
        videoUrl: item.url,
        videoName: item.name,
        blendMode: item.format === 'webm' ? 'transparent' : 'screen',
      });
      setDemoStatus(`¡Video «${item.name}» asignado desde la Biblioteca!`);
    } else if (mediaModalTarget === 'customEvent_audio' && targetCustomEventId) {
      updateCustomEvent(targetCustomEventId, {
        customAudioUrl: item.url,
        customAudioName: item.name,
        customAudioDuration: item.duration,
        audioMode: 'custom_audio',
      });
      setDemoStatus(`¡Audio «${item.name}» asignado al evento personalizado!`);
    } else if (mediaModalTarget === 'customEvent_video' && targetCustomEventId) {
      updateCustomEvent(targetCustomEventId, {
        videoUrl: item.url,
        videoName: item.name,
        blendMode: item.format === 'webm' ? 'transparent' : 'screen',
      });
      setDemoStatus(`¡Video «${item.name}» asignado al evento personalizado!`);
    }
    setTimeout(() => setDemoStatus(null), 3000);
  };

  // Subir audio personalizado con validación estricta de <= 30s
  const handleAlertAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setAudioError(null);
      const { dataUrl, duration } = await inspectAudioFile(file);
      updateCurrentEvent({
        customAudioUrl: dataUrl,
        customAudioName: file.name,
        customAudioDuration: duration,
        customAudioVolume: activeEvent.customAudioVolume ?? alertsSettings.soundVolume,
        audioMode: 'custom_audio',
      });
      setDemoStatus(`¡Audio «${file.name}» (${duration}s) validado y asignado!`);
      setTimeout(() => setDemoStatus(null), 3000);
    } catch (err: any) {
      setAudioError(err?.message || `El archivo supera la duración máxima de ${MAX_AUDIO_DURATION_SECONDS}s.`);
      setTimeout(() => setAudioError(null), 6000);
    }
  };

  // Gestión de Eventos Personalizados
  const handleCreateCustomEvent = () => {
    if (!newCustomName.trim() || !newCustomKeyword.trim()) return;
    const cleanKeyword = newCustomKeyword.startsWith('!')
      ? newCustomKeyword.trim()
      : `!${newCustomKeyword.trim()}`;
    const newRule: CustomAlertRule = {
      id: `custom-${Date.now()}`,
      name: newCustomName.trim(),
      triggerKeyword: cleanKeyword,
      enabled: true,
      template: newCustomTemplate.trim() || '¡{user} activó un evento especial!',
      audioMode: newCustomAudioMode,
      soundType: newCustomSoundType,
      screenShake: newCustomShake,
      accentColor: newCustomAccent,
    };
    updateAlerts({
      customEvents: [...(alertsSettings.customEvents || []), newRule],
    });
    setIsCreatingCustom(false);
    setNewCustomName('');
    setNewCustomKeyword('!');
    setDemoStatus(`¡Evento personalizado «${newRule.name}» creado!`);
    setTimeout(() => setDemoStatus(null), 3000);
  };

  const deleteCustomEvent = (id: string) => {
    updateAlerts({
      customEvents: (alertsSettings.customEvents || []).filter((e) => e.id !== id),
    });
    setDemoStatus('Evento personalizado eliminado');
    setTimeout(() => setDemoStatus(null), 2500);
  };

  const updateCustomEvent = (id: string, patch: Partial<CustomAlertRule>) => {
    updateAlerts({
      customEvents: (alertsSettings.customEvents || []).map((e) =>
        e.id === id ? { ...e, ...patch } : e
      ),
    });
  };

  const handleAlertVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (uploadEv) => {
      const res = uploadEv.target?.result as string;
      const isWebM = file.name.toLowerCase().endsWith('.webm');
      updateCurrentEvent({
        videoUrl: res,
        videoName: file.name,
        blendMode: isWebM ? 'transparent' : 'screen',
      });
      setDemoStatus(`¡Video «${file.name}» asignado a la alerta de ${activeEventTab.toUpperCase()}!`);
      setTimeout(() => setDemoStatus(null), 3000);
    };
    reader.readAsDataURL(file);
  };

  const copyWidgetUrl = () => {
    navigator.clipboard?.writeText(widgetUrl).catch(() => {});
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2200);
  };

  const activeEvent = alertsSettings.events[activeEventTab];

  const updateCurrentEvent = (patch: Partial<typeof activeEvent>) => {
    updateAlerts({
      events: {
        ...alertsSettings.events,
        [activeEventTab]: {
          ...activeEvent,
          ...patch,
        },
      },
    });
  };

  const rootStyle = {
    '--acc': alertsSettings.accent,
    '--acc-ink': inkFor(alertsSettings.accent),
  } as React.CSSProperties;

  return (
    <div className="cab" style={{ ...rootStyle, paddingBottom: tourOpen ? 220 : undefined }}>
      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-6">
        {/* Barra superior unificada */}
        <SuiteNav
          currentApp="alertas"
          channel={alertsSettings.channel}
          saved={saved}
          onOpenTour={() => setTourOpen(true)}
          tourAvailable={!tourOpen}
        />

        {/* Encabezado del Estudio */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[color:var(--cb-line)] pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-[color:var(--ui,#9146ff)] px-1.5 py-0.5 text-[10px] font-black text-white">
                MÓDULO 2
              </span>
              <span className="cab-caps text-xs text-[color:var(--cb-mut)]">
                ESTUDIO DE ALERTAS
              </span>
            </div>
            <h1
              className="cab-caps mt-1 text-2xl font-extrabold"
              style={{ fontStretch: '70%', fontWeight: 800 }}
            >
              Alertas de Stream
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2" data-tour="alert-obs">
            <button
              type="button"
              className="cab-btn2 !h-8 !px-3 !text-xs font-bold"
              onClick={copyWidgetUrl}
              title="Copiar URL para OBS Studio"
            >
              {copiedUrl ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              <span>{copiedUrl ? '¡URL Copiada!' : 'Copiar URL para OBS'}</span>
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

        {/* Estado temporal */}
        {demoStatus && (
          <div className="flex items-center gap-2 rounded border border-emerald-500/40 bg-emerald-950/40 px-3 py-2 text-xs font-bold text-emerald-300">
            <Check className="h-4 w-4 text-emerald-400" />
            <span>{demoStatus}</span>
          </div>
        )}

        {/* Malla principal: Panel de Configuración + Monitor 16:9 */}
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Columna Izquierda: Configuración de Eventos y Apariencia (7 cols) */}
          <div className="grid gap-5 lg:col-span-7">
            {/* Módulo 1: Selector y Ajuste de Eventos */}
            <section className="cab-mod" data-tour="alert-events">
              <h2>
                <span>1</span>Eventos de Stream
              </h2>

              {/* Selector de tipo de evento */}
              <div className="cab-seg flex flex-wrap">
                <button
                  type="button"
                  aria-pressed={activeEventTab === 'follow'}
                  onClick={() => setActiveEventTab('follow')}
                  className="flex items-center gap-1.5"
                >
                  <Heart className="h-3.5 w-3.5 text-rose-400" />
                  <span>Seguidores</span>
                </button>
                <button
                  type="button"
                  aria-pressed={activeEventTab === 'sub'}
                  onClick={() => setActiveEventTab('sub')}
                  className="flex items-center gap-1.5"
                >
                  <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                  <span>Suscripciones</span>
                </button>
                <button
                  type="button"
                  aria-pressed={activeEventTab === 'bits'}
                  onClick={() => setActiveEventTab('bits')}
                  className="flex items-center gap-1.5"
                >
                  <Zap className="h-3.5 w-3.5 text-amber-400" />
                  <span>Bits / Cheers</span>
                </button>
                <button
                  type="button"
                  aria-pressed={activeEventTab === 'raid'}
                  onClick={() => setActiveEventTab('raid')}
                  className="flex items-center gap-1.5"
                >
                  <Flame className="h-3.5 w-3.5 text-red-500" />
                  <span>Raids</span>
                </button>
              </div>

              {/* Ajustes del evento activo */}
              <div className="grid gap-4 rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)]/60 p-4">
                {/* Interruptor Habilitado */}
                <div className="flex items-center justify-between border-b border-[color:var(--cb-line)] pb-3">
                  <div>
                    <span className="cab-label">Habilitar esta alerta</span>
                    <p className="cab-hint text-xs">
                      Mostrar en pantalla cuando ocurra un evento de {activeEventTab}.
                    </p>
                  </div>
                  <button
                    type="button"
                    className={`cab-btn2 !h-7 !px-3 !text-xs font-bold ${
                      activeEvent.enabled ? '!bg-emerald-500 !text-black' : ''
                    }`}
                    onClick={() => updateCurrentEvent({ enabled: !activeEvent.enabled })}
                  >
                    {activeEvent.enabled ? 'Activado' : 'Desactivado'}
                  </button>
                </div>

                {/* Plantilla de texto */}
                <div className="cab-field">
                  <label htmlFor="alert-template" className="cab-label">
                    Plantilla del Mensaje
                  </label>
                  <input
                    id="alert-template"
                    type="text"
                    value={activeEvent.template}
                    onChange={(e) => updateCurrentEvent({ template: e.target.value })}
                    className="cab-inp"
                    placeholder="Ej: ¡{user} te acaba de seguir!"
                  />
                  <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-[color:var(--cb-mut)]">
                    <span>Variables disponibles:</span>
                    <code className="rounded bg-[color:var(--cb-bg)] px-1 font-mono text-[color:var(--cb-fg)]">
                      {'{user}'}
                    </code>
                    {activeEventTab === 'sub' && (
                      <code className="rounded bg-[color:var(--cb-bg)] px-1 font-mono text-[color:var(--cb-fg)]">
                        {'{detail}'}
                      </code>
                    )}
                    {activeEventTab === 'bits' && (
                      <>
                        <code className="rounded bg-[color:var(--cb-bg)] px-1 font-mono text-[color:var(--cb-fg)]">
                          {'{bits}'}
                        </code>
                        <code className="rounded bg-[color:var(--cb-bg)] px-1 font-mono text-[color:var(--cb-fg)]">
                          {'{message}'}
                        </code>
                      </>
                    )}
                    {activeEventTab === 'raid' && (
                      <code className="rounded bg-[color:var(--cb-bg)] px-1 font-mono text-[color:var(--cb-fg)]">
                        {'{viewers}'}
                      </code>
                    )}
                  </div>
                </div>

                {/* Alerta de Error de Audio si supera 30s */}
                {audioError && (
                  <div className="flex items-center gap-2 rounded border border-rose-500/40 bg-rose-950/40 p-2.5 text-xs font-bold text-rose-300">
                    <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
                    <span>{audioError}</span>
                  </div>
                )}

                {/* Sonido de la alerta & Audio Personalizado */}
                <div className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-panel)] p-3.5" data-tour="alert-audio">
                  <div className="flex items-center justify-between">
                    <span className="cab-caps text-xs font-bold text-[color:var(--cb-fg)]">
                      CONFIGURACIÓN DE AUDIO & FANFARRIA
                    </span>
                    <span className="text-[10px] font-bold text-[color:var(--ui,#9146ff)]">
                      Web Audio + MP3/WAV (máx 30s) + TTS
                    </span>
                  </div>

                  {/* Selector de Modo de Audio */}
                  <div className="mt-3">
                    <label className="cab-caps mb-1.5 block text-[11px] font-bold text-[color:var(--cb-mut)]">
                      Modo de Reproducción Sonora
                    </label>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {AUDIO_MODE_OPTIONS.map((m) => {
                        const isSel = (activeEvent.audioMode || 'synth') === m.id;
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => updateCurrentEvent({ audioMode: m.id })}
                            className={`flex flex-col items-start rounded border p-2 text-left transition-all active:scale-[0.97] ${
                              isSel
                                ? 'border-[color:var(--cb-fg)] bg-[color:var(--cb-surface)] font-bold text-[color:var(--cb-fg)] shadow-sm'
                                : 'border-[color:var(--cb-line)] bg-[color:var(--cb-bg)] text-[color:var(--cb-mut)] hover:text-[color:var(--cb-fg)]'
                            }`}
                          >
                            <span className="text-xs">{m.label}</span>
                            <span className="text-[10px] opacity-70">{m.badge}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Sonido Sintetizado Prediseñado */}
                  {((activeEvent.audioMode || 'synth') === 'synth' ||
                    activeEvent.audioMode === 'both') && (
                    <div className="mt-3 border-t border-[color:var(--cb-line)]/60 pt-2.5">
                      <div className="flex items-center justify-between">
                        <label htmlFor="sound-select" className="cab-label !mb-1 text-[11px]">
                          Timbre Sintetizado (Cero-Latencia)
                        </label>
                        <button
                          type="button"
                          className="cab-btn2 !h-6 !px-2 !text-[11px] transition-transform active:scale-[0.97]"
                          onClick={() =>
                            playAlertAudio(activeEvent.soundType, alertsSettings.soundVolume)
                          }
                          title="Probar sonido seleccionado"
                        >
                          <Volume2 className="h-3 w-3 text-[color:var(--ui,#9146ff)]" />
                          <span>Escuchar</span>
                        </button>
                      </div>
                      <select
                        id="sound-select"
                        value={activeEvent.soundType}
                        onChange={(e) =>
                          updateCurrentEvent({ soundType: e.target.value as AlertSoundType })
                        }
                        className="cab-inp text-xs font-bold"
                      >
                        {SOUND_PRESETS.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.desc})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Carga de Audio Personalizado (.mp3, .wav, .ogg, máx 30s) */}
                  {(activeEvent.audioMode === 'custom_audio' || activeEvent.audioMode === 'both') && (
                    <div className="mt-3 border-t border-[color:var(--cb-line)]/60 pt-2.5">
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="cab-caps text-[11px] font-bold text-[color:var(--cb-mut)]">
                          Audio Personalizado (Clip ≤ 30s)
                        </span>
                        {activeEvent.customAudioUrl && (
                          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">
                            Audio Activo {activeEvent.customAudioDuration ? `(${activeEvent.customAudioDuration}s)` : ''}
                          </span>
                        )}
                      </div>

                      {activeEvent.customAudioUrl ? (
                        <div className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 truncate text-xs">
                              <Volume2 className="h-4 w-4 shrink-0 text-emerald-400" />
                              <span className="cab-mono truncate font-bold text-[color:var(--cb-fg)]">
                                {activeEvent.customAudioName || 'audio_personalizado.mp3'}
                              </span>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                className="cab-btn2 !h-6 !px-2 !text-[11px] transition-transform active:scale-[0.97]"
                                onClick={() =>
                                  playCustomAudio(
                                    activeEvent.customAudioUrl,
                                    activeEvent.customAudioVolume ?? alertsSettings.soundVolume
                                  )
                                }
                                title="Reproducir audio subido"
                              >
                                <Play className="h-2.5 w-2.5 fill-current text-emerald-400" />
                                <span>Escuchar</span>
                              </button>

                              <button
                                type="button"
                                className="cab-btn2 !h-6 !px-2 !text-[11px] text-amber-400 transition-transform active:scale-[0.97]"
                                onClick={() => openMediaVault('audio', 'activeEvent_audio')}
                                title="Cambiar desde la Biblioteca"
                              >
                                <FolderOpen className="h-3 w-3" />
                                <span>Cambiar</span>
                              </button>

                              <button
                                type="button"
                                className="cab-btn2 !h-6 !px-2 !text-[11px] text-rose-400 hover:text-rose-300 transition-transform active:scale-[0.97]"
                                onClick={() =>
                                  updateCurrentEvent({
                                    customAudioUrl: undefined,
                                    customAudioName: undefined,
                                    customAudioDuration: undefined,
                                  })
                                }
                                title="Quitar audio personalizado"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </div>

                          {/* Control de Volumen Individual */}
                          <div className="mt-2.5 border-t border-[color:var(--cb-line)]/50 pt-2">
                            <div className="flex items-center justify-between text-[11px] text-[color:var(--cb-mut)]">
                              <span>Volumen de este Audio</span>
                              <span className="cab-mono font-bold text-[color:var(--cb-fg)]">
                                {Math.round(
                                  (activeEvent.customAudioVolume ?? alertsSettings.soundVolume) * 100
                                )}
                                %
                              </span>
                            </div>
                            <input
                              type="range"
                              min={0}
                              max={1}
                              step={0.05}
                              value={activeEvent.customAudioVolume ?? alertsSettings.soundVolume}
                              onChange={(e) =>
                                updateCurrentEvent({
                                  customAudioVolume: parseFloat(e.target.value),
                                })
                              }
                              className="cab-range mt-1 w-full cursor-pointer"
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="grid gap-2 sm:grid-cols-2">
                          <button
                            type="button"
                            onClick={() => openMediaVault('audio', 'activeEvent_audio')}
                            className="flex items-center justify-center gap-2 rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-3 text-xs font-bold text-[color:var(--cb-fg)] transition-all hover:border-[color:var(--ui,#9146ff)] active:scale-[0.97]"
                          >
                            <FolderOpen className="h-4 w-4 text-[color:var(--ui,#9146ff)]" />
                            <span>Explorar Biblioteca (Vault)</span>
                          </button>

                          <label className="flex cursor-pointer items-center justify-center gap-2 rounded border border-dashed border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-3 text-xs font-bold text-[color:var(--cb-fg)] transition-colors hover:border-[color:var(--cb-fg)] active:scale-[0.97]">
                            <Upload className="h-4 w-4 text-emerald-400" />
                            <span>Subir Audio (máx 30s)</span>
                            <input
                              type="file"
                              accept="audio/mp3,audio/wav,audio/ogg,audio/mpeg,audio/webm,audio/m4a"
                              onChange={handleAlertAudioUpload}
                              className="hidden"
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Aviso de Síntesis TTS si el modo incluye voz */}
                  {(activeEvent.audioMode === 'tts' || activeEvent.audioMode === 'both') && (
                    <div className="mt-3 rounded border border-[color:var(--cb-line)]/60 bg-[color:var(--cb-surface)] p-2.5 text-[11px] text-[color:var(--cb-mut)]">
                      <div className="flex items-center gap-1.5 font-bold text-[color:var(--cb-fg)] mb-1">
                        <Mic className="h-3.5 w-3.5 text-[color:var(--ui,#9146ff)]" />
                        <span>Locución TTS Activada</span>
                      </div>
                      <span>
                        El texto de la alerta se reproducirá en directo en OBS utilizando el motor de síntesis de voz (Fish Audio / Speech API).
                      </span>
                    </div>
                  )}
                </div>

                {/* Video Transparente o Meme de Alerta */}
                <div className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-panel)] p-3.5" data-tour="alert-video">
                  <div className="flex items-center justify-between">
                    <span className="cab-caps text-xs font-bold text-[color:var(--cb-fg)]">
                      VIDEO TRANSPARENTE / MEME PARA ESTA ALERTA
                    </span>
                    <span className="text-[10px] font-bold text-amber-400">
                      Soporta .webm (alfa) y .mp4
                    </span>
                  </div>

                  {activeEvent.videoUrl ? (
                    <div className="mt-2.5 flex items-center justify-between rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-2">
                      <div className="flex items-center gap-2 text-xs">
                        <Video className="h-4 w-4 text-emerald-400" />
                        <span className="cab-mono font-bold truncate max-w-xs">
                          {activeEvent.videoName || 'video_alerta.webm'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          className="cab-btn2 !h-6 !px-2 !text-[11px] text-amber-400 transition-transform active:scale-[0.97]"
                          onClick={() => openMediaVault('video', 'activeEvent_video')}
                        >
                          <FolderOpen className="h-3 w-3" />
                          <span>Cambiar</span>
                        </button>
                        <button
                          type="button"
                          className="cab-btn2 !h-6 !px-2 !text-[11px] text-rose-400 hover:text-rose-300 transition-transform active:scale-[0.97]"
                          onClick={() =>
                            updateCurrentEvent({
                              videoUrl: undefined,
                              videoName: undefined,
                            })
                          }
                        >
                          Quitar video
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => openMediaVault('video', 'activeEvent_video')}
                        className="flex items-center justify-center gap-2 rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-3 text-xs font-bold text-[color:var(--cb-fg)] transition-all hover:border-amber-400 active:scale-[0.97]"
                      >
                        <FolderOpen className="h-4 w-4 text-amber-400" />
                        <span>Biblioteca de Videos (Vault)</span>
                      </button>

                      <label className="flex cursor-pointer items-center justify-center gap-2 rounded border border-dashed border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-3 text-xs font-bold text-[color:var(--cb-fg)] transition-colors hover:border-[color:var(--cb-fg)] active:scale-[0.97]">
                        <Upload className="h-4 w-4 text-amber-400" />
                        <span>Subir Video (.webm/.mp4)</span>
                        <input
                          type="file"
                          accept="video/webm,video/mp4"
                          onChange={handleAlertVideoUpload}
                          className="hidden"
                        />
                      </label>
                    </div>
                  )}

                  {/* Opciones del video si está configurado */}
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="cab-caps mb-1 block text-[11px] font-bold text-[color:var(--cb-mut)]">
                        Modo de Transparencia
                      </label>
                      <select
                        value={activeEvent.blendMode || 'transparent'}
                        onChange={(e) =>
                          updateCurrentEvent({ blendMode: e.target.value as AlertBlendMode })
                        }
                        className="cab-inp text-xs font-bold"
                      >
                        {BLEND_MODE_OPTIONS.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label} ({m.desc})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="cab-caps mb-1 block text-[11px] font-bold text-[color:var(--cb-mut)]">
                        Sacudida de Pantalla (Screen Shake)
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          updateCurrentEvent({ screenShake: !activeEvent.screenShake })
                        }
                        className={`flex w-full items-center justify-between rounded border p-2 text-xs font-bold transition-all active:scale-[0.97] ${
                          activeEvent.screenShake
                            ? 'border-rose-500 bg-rose-950/30 text-rose-300'
                            : 'border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] text-[color:var(--cb-mut)]'
                        }`}
                      >
                        <span>Efecto de impacto sísmico</span>
                        <span>{activeEvent.screenShake ? 'SÍ' : 'NO'}</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Escalonamiento de Bits (Tiers) */}
                {activeEventTab === 'bits' && (
                  <div className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-panel)] p-3.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Zap className="h-4 w-4 text-amber-400" />
                        <span className="cab-caps text-xs font-bold text-[color:var(--cb-fg)]">
                          ESCALONAMIENTO DE ALERTAS POR BITS (TIERS)
                        </span>
                      </div>
                      <span className="text-[10px] font-bold text-amber-400">
                        4 Niveles Preconfigurados
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-[color:var(--cb-mut)]">
                      Donaciones de diferentes cantidades activan efectos sonoros, colores e impactos visuales distintos en vivo.
                    </p>

                    <div className="mt-3 grid gap-2">
                      {(activeEvent.bitTiers || []).map((tier) => (
                        <div
                          key={tier.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-2.5 transition-colors hover:border-[color:var(--cb-fg)]"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className="h-3 w-3 rounded-full shrink-0"
                              style={{ backgroundColor: tier.accent }}
                            />
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-bold text-[color:var(--cb-fg)]">
                                  {tier.name}
                                </span>
                                <span className="cab-mono rounded bg-[color:var(--cb-bg)] px-1 py-0.2 text-[10px] text-[color:var(--cb-mut)]">
                                  min. {tier.minBits} bits
                                </span>
                                {tier.screenShake && (
                                  <span className="rounded bg-rose-500/20 px-1 py-0.2 text-[9px] font-black text-rose-300">
                                    SHAKE
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] text-[color:var(--cb-mut)] truncate block max-w-sm">
                                {tier.template}
                              </span>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => broadcastTierBits(tier)}
                            className="cab-btn2 !h-6 !px-2.5 !text-[11px] font-bold text-amber-400 transition-transform active:scale-[0.97]"
                            title={`Probar alerta de ${tier.name}`}
                          >
                            <Play className="h-2.5 w-2.5 fill-current" />
                            <span>Probar Nivel</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Escalonamiento de Suscripciones (Tiers & Gifts) */}
                {activeEventTab === 'sub' && (
                  <div className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-panel)] p-3.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="h-4 w-4 text-purple-400" />
                        <span className="cab-caps text-xs font-bold text-[color:var(--cb-fg)]">
                          NIVELES DE SUSCRIPCIÓN & REGALOS (TIERS)
                        </span>
                      </div>
                      <span className="text-[10px] font-bold text-purple-400">
                        Tier 1, 2, 3 y Gift Subs
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-[color:var(--cb-mut)]">
                      Personaliza y prueba avisos específicos según el rango de suscripción o paquetes comunitarios regalados.
                    </p>

                    <div className="mt-3 grid gap-2">
                      {(activeEvent.subTiers || []).map((tier) => (
                        <div
                          key={tier.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-2.5 transition-colors hover:border-[color:var(--cb-fg)]"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className="h-3 w-3 rounded-full shrink-0"
                              style={{ backgroundColor: tier.accent }}
                            />
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-bold text-[color:var(--cb-fg)]">
                                  {tier.name}
                                </span>
                                {tier.screenShake && (
                                  <span className="rounded bg-rose-500/20 px-1 py-0.2 text-[9px] font-black text-rose-300">
                                    SHAKE
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] text-[color:var(--cb-mut)] truncate block max-w-sm">
                                {tier.template}
                              </span>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => broadcastTierSub(tier)}
                            className="cab-btn2 !h-6 !px-2.5 !text-[11px] font-bold text-purple-300 transition-transform active:scale-[0.97]"
                            title={`Probar alerta de ${tier.name}`}
                          >
                            <Play className="h-2.5 w-2.5 fill-current" />
                            <span>Probar Nivel</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* Módulo 2: Eventos de Stream Personalizados */}
            <section className="cab-mod" aria-label="Eventos Personalizados de Stream" data-tour="alert-tiers">
              <div className="flex items-center justify-between border-b border-[color:var(--cb-line)] pb-3">
                <div>
                  <h2>
                    <span>2</span>Eventos de Stream Personalizados
                  </h2>
                  <p className="cab-hint text-xs">
                    Crea alertas activadas por palabras clave del chat (ej: !hype, !meta, !secreto) con
                    audio personalizado de hasta 30s, síntesis TTS, videos alfa y sacudida de pantalla.
                  </p>
                </div>

                <button
                  type="button"
                  className="cab-btn2 !h-7 !px-2.5 !text-xs font-bold transition-transform active:scale-[0.97]"
                  onClick={() => setIsCreatingCustom(!isCreatingCustom)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>{isCreatingCustom ? 'Cancelar' : 'Nuevo Evento'}</span>
                </button>
              </div>

              {/* Formulario de Creación de Nuevo Evento Personalizado */}
              {isCreatingCustom && (
                <div className="mt-3 rounded border border-[color:var(--ui,#9146ff)]/50 bg-[color:var(--cb-surface)] p-4 shadow-sm">
                  <h3 className="cab-caps text-xs font-black text-[color:var(--cb-fg)] mb-3">
                    + Configurar Nuevo Disparador de Alerta
                  </h3>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="cab-caps mb-1 block text-[11px] font-bold text-[color:var(--cb-mut)]">
                        Nombre del Evento
                      </label>
                      <input
                        type="text"
                        value={newCustomName}
                        onChange={(e) => setNewCustomName(e.target.value)}
                        placeholder="Ej: Alarma de Donación Épica"
                        className="cab-inp text-xs font-bold"
                      />
                    </div>

                    <div>
                      <label className="cab-caps mb-1 block text-[11px] font-bold text-[color:var(--cb-mut)]">
                        Comando o Palabra Clave
                      </label>
                      <input
                        type="text"
                        value={newCustomKeyword}
                        onChange={(e) => setNewCustomKeyword(e.target.value)}
                        placeholder="Ej: !alarma"
                        className="cab-inp cab-mono text-xs font-bold"
                      />
                    </div>
                  </div>

                  <div className="mt-3">
                    <label className="cab-caps mb-1 block text-[11px] font-bold text-[color:var(--cb-mut)]">
                      Plantilla del Mensaje de Aviso
                    </label>
                    <input
                      type="text"
                      value={newCustomTemplate}
                      onChange={(e) => setNewCustomTemplate(e.target.value)}
                      placeholder="¡{user} ha activado el evento especial!"
                      className="cab-inp text-xs"
                    />
                  </div>

                  {/* Selector de Modo de Audio */}
                  <div className="mt-3">
                    <label className="cab-caps mb-1.5 block text-[11px] font-bold text-[color:var(--cb-mut)]">
                      Modo de Audio & Locución
                    </label>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {AUDIO_MODE_OPTIONS.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setNewCustomAudioMode(opt.id)}
                          className={`flex flex-col items-start rounded border p-2 text-left transition-all active:scale-[0.97] ${
                            newCustomAudioMode === opt.id
                              ? 'border-[color:var(--cb-fg)] bg-[color:var(--cb-panel)] font-bold text-[color:var(--cb-fg)] shadow-sm'
                              : 'border-[color:var(--cb-line)] bg-[color:var(--cb-bg)] text-[color:var(--cb-mut)]'
                          }`}
                        >
                          <span className="text-xs">{opt.label}</span>
                          <span className="text-[10px] opacity-70">{opt.badge}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="cab-caps mb-1 block text-[11px] font-bold text-[color:var(--cb-mut)]">
                        Timbre Sintetizado (Fallback)
                      </label>
                      <select
                        value={newCustomSoundType}
                        onChange={(e) => setNewCustomSoundType(e.target.value as AlertSoundType)}
                        className="cab-inp text-xs font-bold"
                      >
                        {SOUND_PRESETS.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="cab-caps mb-1 block text-[11px] font-bold text-[color:var(--cb-mut)]">
                        Color de Acento
                      </label>
                      <div className="flex items-center gap-1.5 pt-0.5">
                        {ACCENTS.map((a) => (
                          <button
                            key={a.color}
                            type="button"
                            onClick={() => setNewCustomAccent(a.color)}
                            className={`h-6 w-6 rounded-full border border-black/30 transition-transform active:scale-95 ${
                              newCustomAccent === a.color
                                ? 'ring-2 ring-white ring-offset-1 ring-offset-black'
                                : ''
                            }`}
                            style={{ backgroundColor: a.color }}
                            title={a.name}
                          />
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-[color:var(--cb-line)] pt-3">
                    <button
                      type="button"
                      onClick={() => setNewCustomShake(!newCustomShake)}
                      className={`cab-btn2 !h-7 !px-2.5 !text-xs font-bold transition-transform active:scale-[0.97] ${
                        newCustomShake ? '!border-rose-500 !bg-rose-950/30 !text-rose-300' : ''
                      }`}
                    >
                      <span>Screen Shake: {newCustomShake ? 'SÍ' : 'NO'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleCreateCustomEvent}
                      disabled={!newCustomName.trim()}
                      className="cab-btn !h-8 !px-4 text-xs font-bold transition-transform active:scale-[0.97]"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Guardar Evento</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Lista de Eventos Personalizados Configurados */}
              <div className="mt-3 grid gap-2.5">
                {(alertsSettings.customEvents || []).map((rule) => (
                  <div
                    key={rule.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)]/70 p-3 transition-colors hover:border-[color:var(--cb-fg)]"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className="h-3 w-3 rounded-full shrink-0"
                        style={{ backgroundColor: rule.accentColor || '#9146ff' }}
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-bold text-[color:var(--cb-fg)] truncate">
                            {rule.name}
                          </span>
                          <span className="cab-mono rounded bg-[color:var(--cb-bg)] px-1.5 py-0.5 text-[10px] font-black text-amber-400">
                            {rule.triggerKeyword}
                          </span>
                          <span className="rounded bg-[color:var(--cb-bg)] px-1 py-0.5 text-[9px] font-bold text-[color:var(--cb-mut)] uppercase">
                            {rule.audioMode}
                          </span>
                          {rule.customAudioName && (
                            <span className="rounded bg-emerald-500/20 px-1 py-0.5 text-[9px] font-black text-emerald-300">
                              Audio: {rule.customAudioName}
                            </span>
                          )}
                          {rule.videoName && (
                            <span className="rounded bg-amber-500/20 px-1 py-0.5 text-[9px] font-black text-amber-300">
                              Video: {rule.videoName}
                            </span>
                          )}
                          {rule.screenShake && (
                            <span className="rounded bg-rose-500/20 px-1 py-0.5 text-[9px] font-black text-rose-300">
                              SHAKE
                            </span>
                          )}
                        </div>
                        <span className="block text-[11px] text-[color:var(--cb-mut)] truncate max-w-md">
                          {rule.template}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {/* Asignar Audio desde Biblioteca */}
                      <button
                        type="button"
                        onClick={() => openMediaVault('audio', 'customEvent_audio', rule.id)}
                        className="cab-btn2 !h-6 !px-2 !text-[11px] font-bold transition-transform active:scale-[0.97]"
                        title="Asignar audio de biblioteca (máx 30s)"
                      >
                        <Music className="h-3 w-3 text-emerald-400" />
                        <span>Audio</span>
                      </button>

                      {/* Asignar Video desde Biblioteca */}
                      <button
                        type="button"
                        onClick={() => openMediaVault('video', 'customEvent_video', rule.id)}
                        className="cab-btn2 !h-6 !px-2 !text-[11px] font-bold transition-transform active:scale-[0.97]"
                        title="Asignar video transparente de biblioteca"
                      >
                        <Video className="h-3 w-3 text-amber-400" />
                        <span>Video</span>
                      </button>

                      {/* Botón Probar en Vivo */}
                      <button
                        type="button"
                        onClick={() => broadcastCustomEvent(rule)}
                        className="cab-btn2 !h-6 !px-2.5 !text-[11px] font-bold text-emerald-300 transition-transform active:scale-[0.97]"
                        title="Probar en el monitor y en OBS"
                      >
                        <Play className="h-2.5 w-2.5 fill-current" />
                        <span>Probar</span>
                      </button>

                      {/* Eliminar evento */}
                      <button
                        type="button"
                        onClick={() => deleteCustomEvent(rule.id)}
                        className="cab-btn2 !h-6 !px-1.5 text-rose-400 hover:text-rose-300 transition-transform active:scale-[0.97]"
                        title="Eliminar evento personalizado"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Módulo 3: Apariencia Visual y Colores */}
            <section className="cab-mod" data-tour="alert-appearance">
              <h2>
                <span>3</span>Estilo Visual
              </h2>

              {/* Selector de Estilos (4 estilos) */}
              <div className="cab-styles">
                {ALERT_STYLES.map((style) => (
                  <button
                    key={style.id}
                    type="button"
                    aria-pressed={alertsSettings.alertStyle === style.id}
                    onClick={() => updateAlerts({ alertStyle: style.id })}
                    className="cab-style"
                  >
                    <div className={`cab-style-face cab-face-${style.id}`}>
                      {style.id === 'cabina' && <i />}
                      {style.name}
                    </div>
                    <div className="cab-style-body">
                      <b>{style.name}</b>
                      <span>{style.description}</span>
                    </div>
                  </button>
                ))}
              </div>

              {/* Color de acento */}
              <div className="cab-field">
                <span className="cab-label">Color de Acento</span>
                <div className="flex flex-wrap items-center gap-2">
                  {ACCENTS.map((acc) => (
                    <button
                      key={acc.color}
                      type="button"
                      onClick={() => updateAlerts({ accent: acc.color })}
                      className="relative h-8 w-8 rounded-full border border-black/30 transition-transform active:scale-95"
                      style={{ backgroundColor: acc.color }}
                      title={acc.name}
                      aria-label={`Color ${acc.name}`}
                    >
                      {alertsSettings.accent === acc.color && (
                        <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" />
                      )}
                    </button>
                  ))}
                  <input
                    type="color"
                    value={alertsSettings.accent}
                    onChange={(e) => updateAlerts({ accent: e.target.value })}
                    className="h-8 w-10 cursor-pointer rounded border border-[color:var(--cb-line)] bg-transparent p-0.5"
                    title="Color personalizado"
                  />
                </div>
              </div>

              {/* Controles de Posición y Tiempos */}
              <div className="grid gap-4 sm:grid-cols-2">
                {/* Cuadrante de pantalla */}
                <div className="cab-field">
                  <span className="cab-label">Posición en OBS</span>
                  <div className="cab-pos">
                    {ALERT_POSITIONS.map((pos) => (
                      <button
                        key={pos.id}
                        type="button"
                        aria-pressed={alertsSettings.position === pos.id}
                        onClick={() => updateAlerts({ position: pos.id })}
                        title={pos.name}
                        aria-label={pos.name}
                      />
                    ))}
                  </div>
                </div>

                {/* Duración y Volumen */}
                <div className="grid gap-3">
                  <div className="cab-field">
                    <label htmlFor="alert-duration" className="cab-label">
                      Duración: {alertsSettings.duration}s
                    </label>
                    <input
                      id="alert-duration"
                      type="range"
                      min={3}
                      max={15}
                      step={1}
                      value={alertsSettings.duration}
                      onChange={(e) => updateAlerts({ duration: Number(e.target.value) })}
                      className="cab-range w-full cursor-pointer"
                    />
                  </div>

                  <div className="cab-field">
                    <label htmlFor="alert-vol" className="cab-label">
                      Volumen de Sonido: {Math.round(alertsSettings.soundVolume * 100)}%
                    </label>
                    <input
                      id="alert-vol"
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={alertsSettings.soundVolume}
                      onChange={(e) => updateAlerts({ soundVolume: Number(e.target.value) })}
                      className="cab-range w-full cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            </section>
          </div>

          {/* Columna Derecha: Monitor en Vivo 16:9 y Pruebas (5 cols) */}
          <div className="grid gap-5 lg:col-span-5">
            <section className="cab-mod" data-tour="stage-monitor">
              <h2>
                <span>4</span>Monitor en Vivo
              </h2>

              <p className="cab-hint text-xs">
                Vista previa del comportamiento real de la alerta con su animación GSAP,
                posicionamiento y sonido sincronizado.
              </p>

              {/* Escenario 16:9 simulando la escena de OBS */}
              <div
                ref={monitorStageRef}
                className={`cab-stage ${STAGE_POSITION[alertsSettings.position]} relative overflow-hidden border border-[color:var(--cb-line)] shadow-inner`}
                style={{
                  background:
                    'radial-gradient(ellipse at 50% 30%, #1e2029 0%, #0d0e12 100%)',
                }}
              >
                {/* Rejilla técnica de broadcast de fondo */}
                <div
                  className="pointer-events-none absolute inset-0 opacity-15"
                  style={{
                    backgroundImage:
                      'linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)',
                    backgroundSize: '32px 32px',
                  }}
                />

                {/* Video transparente si está activo en la prueba */}
                {monitorVideoActive && (
                  <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
                    <video
                      src={monitorVideoActive}
                      autoPlay
                      playsInline
                      muted={false}
                      className="max-h-56 w-auto rounded object-contain shadow-lg"
                      style={{
                        mixBlendMode: activeEvent.blendMode === 'screen' ? 'screen' : 'normal',
                      }}
                    />
                  </div>
                )}

                {/* Tarjeta de alerta renderizada */}
                <AlertCard
                  ref={cardRef}
                  alertStyle={alertsSettings.alertStyle}
                  position={alertsSettings.position}
                  accent={alertsSettings.accent}
                  name={previewUser}
                  text={previewText}
                  emotionLabel={previewDetail || undefined}
                  stickerSvg={alertsSettings.stickerSvg}
                  fontSize="16px"
                />
              </div>

              {/* Banco de Pruebas de Simulación */}
              <div className="mt-2 grid gap-2" data-tour="test-trigger">
                <span className="cab-caps text-[11px] font-bold text-[color:var(--cb-mut)]">
                  BANCO DE PRUEBAS RÁPIDAS
                </span>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className="cab-btn2 !h-9 justify-start !text-xs font-bold"
                    onClick={() => broadcastTest('follow')}
                  >
                    <Heart className="h-3.5 w-3.5 text-rose-400" />
                    <span>Follow</span>
                  </button>

                  <button
                    type="button"
                    className="cab-btn2 !h-9 justify-start !text-xs font-bold"
                    onClick={() => broadcastTest('sub')}
                  >
                    <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                    <span>Suscripción</span>
                  </button>

                  <button
                    type="button"
                    className="cab-btn2 !h-9 justify-start !text-xs font-bold"
                    onClick={() => broadcastTest('bits')}
                  >
                    <Zap className="h-3.5 w-3.5 text-amber-400" />
                    <span>500 Bits</span>
                  </button>

                  <button
                    type="button"
                    className="cab-btn2 !h-9 justify-start !text-xs font-bold"
                    onClick={() => broadcastTest('raid')}
                  >
                    <Flame className="h-3.5 w-3.5 text-red-500" />
                    <span>Raid (48)</span>
                  </button>
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    className="cab-btn !h-9 flex-1 !text-xs font-bold"
                    onClick={() => runDemo()}
                  >
                    <Play className="h-3.5 w-3.5" />
                    <span>Reproducir Animación</span>
                  </button>
                  <button
                    type="button"
                    className="cab-btn2 !h-9 !px-3 !text-xs font-bold"
                    onClick={() => {
                      if (cardRef.current) resetAlert(cardRef.current);
                    }}
                    title="Reiniciar alerta al estado de reposo"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </section>

            {/* Tarjeta de estado de conexión OBS */}
            <div className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)]/40 p-4 text-xs text-[color:var(--cb-mut)]">
              <div className="flex items-center gap-2 font-bold text-[color:var(--cb-fg)]">
                <Tv className="h-4 w-4 text-[color:var(--ui,#9146ff)]" />
                <span>¿Cómo usarlo en OBS Studio?</span>
              </div>
              <ol className="mt-2 list-inside list-decimal space-y-1.5 leading-relaxed">
                <li>Copia la URL del overlay usando el botón superior.</li>
                <li>En OBS, añade una fuente de tipo <b>Navegador</b>.</li>
                <li>Establece el ancho en <b>1920</b> y el alto en <b>1080</b>.</li>
                <li>¡Listo! Los eventos aparecerán en pantalla con animación y sonido.</li>
              </ol>
            </div>
          </div>
        </div>

        {/* Modal de la Biblioteca de Medios (Media Vault) */}
        <MediaLibraryModal
          isOpen={isMediaModalOpen}
          onClose={() => setIsMediaModalOpen(false)}
          onSelect={handleMediaModalSelect}
          allowedTypes={[mediaModalType]}
          title={
            mediaModalType === 'audio'
              ? 'Media Vault · Seleccionar o Subir Audio (máx 30s)'
              : 'Media Vault · Seleccionar o Subir Video Transparente'
          }
        />
      </div>

      {/* Guía interactiva de primeros pasos para el Estudio de Alertas */}
      {tourOpen && (
        <GuidedTour
          steps={ALERTS_TOUR_STEPS}
          onClose={() => setTourOpen(false)}
          id={TOUR_ID}
          appName="Estudio de Alertas"
        />
      )}
    </div>
  );
};
