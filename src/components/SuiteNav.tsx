/**
 * src/components/SuiteNav.tsx
 *
 * Estructura común del panel: barra lateral con los módulos y cabecera con las
 * acciones de la página.
 *
 * - La barra lateral se pliega a solo iconos en escritorio y se convierte en un
 *   cajón que se abre y se cierra en pantallas estrechas.
 * - La cabecera reúne lo que es igual en todas las páginas: canal, actualizar
 *   OBS, las fuentes de navegador, la guía y el estado de guardado.
 *
 * La barra lateral se monta en <body> para que ninguna animación de la página
 * la desplace; por eso lleva la clase .cab, que le da los tokens del tema.
 */

import React, { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BellRing,
  Bot,
  Check,
  Clapperboard,
  CloudOff,
  Coins,
  Copy,
  ExternalLink,
  FileText,
  Gamepad2,
  Layers,
  LayoutGrid,
  Menu,
  MessagesSquare,
  Mic,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  RefreshCw,
  Swords,
  Target,
  Tv,
  UserRound,
  X,
  Zap,
} from 'lucide-react';
import { ThemeSwitch } from './ThemeSwitch';
import { buildSuiteWidgetUrl, WidgetAppType } from '../utils/widgetUrl';
import { loadSettings } from '../types/settings';
import { encodeChatSettings, loadChatSettings } from '../types/chat';
import { encodeRaidSettings, loadRaidSettings } from '../types/raid';
import { encodeRewardsSettings, loadRewardsSettings } from '../types/rewards';
import { encodeRouletteSettings, loadRouletteSettings } from '../types/roulette';
import { listenBus, postBus } from '../utils/bus';
import { playAlertAudio } from '../utils/alertsAudio';
import { ObsSyncNotice } from './ObsSyncNotice';
import { useCloudSession } from '../hooks/useCloudSession';
import { onCloudSyncMessage, pushAllNow } from '../lib/cloudConfig';

export type SuiteApp =
  | 'catalogo'
  | 'tts'
  | 'control'
  | 'alertas'
  | 'recompensas'
  | 'twitchio'
  | 'metas'
  | 'ruleta'
  | 'encuestas'
  | 'chat'
  | 'raid'
  | 'studio'
  | 'powerups'
  | 'cuenta'
  | 'admin'
  | 'nube';

interface SuiteNavProps {
  currentApp: SuiteApp;
  channel?: string;
  saved?: boolean;
  onOpenTour?: () => void;
  tourAvailable?: boolean;
}

interface NavItem {
  app: SuiteApp;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV: { group: string | null; items: NavItem[] }[] = [
  { group: null, items: [{ app: 'catalogo', label: 'Inicio', href: '#dashboard', icon: LayoutGrid }] },
  {
    group: 'En directo',
    items: [
      { app: 'control', label: 'En vivo', href: '#control', icon: Radio },
      { app: 'studio', label: 'Studio', href: '#studio', icon: Layers },
    ],
  },
  {
    group: 'Capas',
    items: [
      { app: 'tts', label: 'Voz del chat', href: '#tts', icon: Mic },
      { app: 'alertas', label: 'Alertas', href: '#alertas', icon: BellRing },
      { app: 'recompensas', label: 'Recompensas', href: '#recompensas', icon: Coins },
      { app: 'powerups', label: 'Power-ups', href: '#powerups', icon: Zap },
      { app: 'metas', label: 'Metas', href: '#metas', icon: Target },
      { app: 'ruleta', label: 'Ruleta', href: '#ruleta', icon: Gamepad2 },
      { app: 'encuestas', label: 'Batallas', href: '#encuestas', icon: Swords },
      { app: 'chat', label: 'Chat', href: '#chat', icon: MessagesSquare },
      { app: 'raid', label: 'Raids', href: '#raid', icon: Clapperboard },
    ],
  },
  { group: 'Chat', items: [{ app: 'twitchio', label: 'Bot', href: '#twitchio', icon: Bot }] },
];

const SOURCES: { mode: WidgetAppType; name: string; note: string }[] = [
  { mode: 'all', name: 'Todo en uno', note: 'Recomendada: una sola fuente con todas las capas' },
  { mode: 'tts', name: 'Voz del chat', note: 'Mensajes leídos en voz alta' },
  { mode: 'alerts', name: 'Alertas', note: 'Follows, suscripciones, bits y raids' },
  { mode: 'goals', name: 'Metas', note: 'Barras de progreso' },
  { mode: 'roulette', name: 'Ruleta', note: 'Rueda de castigos y retos' },
  { mode: 'polls', name: 'Batallas', note: 'Votación entre dos opciones' },
  { mode: 'chat', name: 'Chat', note: 'El chat de tu canal en pantalla' },
  { mode: 'raid', name: 'Saludo de raid', note: 'Placa de bienvenida con un corto del canal' },
  { mode: 'rewards', name: 'Recompensas', note: 'Sonidos, placas y vídeos por puntos de canal o bits' },
];

const SYNC_TARGET: Partial<Record<SuiteApp, WidgetAppType>> = {
  ruleta: 'roulette',
  alertas: 'alerts',
  metas: 'goals',
  encuestas: 'polls',
  chat: 'chat',
  raid: 'raid',
  recompensas: 'rewards',
  powerups: 'rewards',
  tts: 'tts',
};

const COLLAPSE_KEY = 'lalo_panel_side_collapsed';
const WIDGET_STALE_MS = 12000;

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

/** El widget solo responde por el bus si está abierto en este mismo navegador. */
function useWidgetOpenHere(): boolean {
  const [seenAt, setSeenAt] = useState(0);
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    const stop = listenBus((message) => {
      if (message.type === 'STATE') setSeenAt(Date.now());
    });
    postBus({ type: 'STATE_REQUEST' });
    const tick = setInterval(() => setClock(Date.now()), 4000);
    return () => {
      stop();
      clearInterval(tick);
    };
  }, []);

  return seenAt > 0 && clock - seenAt < WIDGET_STALE_MS;
}

export const SuiteNav: React.FC<SuiteNavProps> = ({
  currentApp,
  channel = 'laloplay_',
  saved = true,
  onOpenTour,
  tourAvailable = false,
}) => {
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [obsOpen, setObsOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [activeNotice, setActiveNotice] = useState<{ appType: string; url: string } | null>(null);
  const widgetOpenHere = useWidgetOpenHere();
  const cloud = useCloudSession();

  // La cuenta solo existe con la nube configurada; sin ella, «Nube» explica qué
  // falta para encenderla. El administrador tiene su propia consola (AdminShell)
  const nav = cloud.enabled
    ? [
        ...NAV,
        {
          group: 'Cuenta',
          items: [{ app: 'cuenta' as const, label: 'Mi cuenta', href: '#cuenta', icon: UserRound }],
        },
      ]
    : [...NAV, { group: 'Cuenta', items: [{ app: 'nube' as const, label: 'Nube', href: '#nube', icon: CloudOff }] }];

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  // Con cuenta en la nube, las URL de OBS llevan la clave privada del streamer
  const widgetKeyParam = cloud.profile?.status === 'active' ? { k: cloud.profile.widget_key } : undefined;

  // Avisos de la sincronización con la nube (null = todo guardado)
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  useEffect(() => onCloudSyncMessage(setSyncMessage), []);
  const current = nav.flatMap((section) => section.items).find((item) => item.app === currentApp);

  // Sin cuenta en la nube, los ajustes del chat, del saludo de raid, de las recompensas y de la ruleta viajan en la URL:
  // OBS no comparte almacenamiento con el panel
  const extraFor = (mode: WidgetAppType): Record<string, string> | undefined => {
    if (widgetKeyParam) return widgetKeyParam;
    if (mode === 'chat') return { cs: encodeChatSettings(loadChatSettings()) };
    if (mode === 'rewards') return { rw: encodeRewardsSettings(loadRewardsSettings()) };
    if (mode === 'raid') return { rs: encodeRaidSettings(loadRaidSettings()) };
    if (mode === 'roulette') return { rl: encodeRouletteSettings(loadRouletteSettings()) };
    if (mode === 'all') {
      return {
        rs: encodeRaidSettings(loadRaidSettings()),
        rw: encodeRewardsSettings(loadRewardsSettings()),
        rl: encodeRouletteSettings(loadRouletteSettings()),
      };
    }
    return undefined;
  };

  const getWidgetUrl = (mode: WidgetAppType) => {
    const ttsSettings = loadSettings();
    return buildSuiteWidgetUrl(baseUrl, mode, channel || ttsSettings.channel, ttsSettings, extraFor(mode));
  };

  // La página deja sitio a la barra lateral a través de clases en <body>
  useLayoutEffect(() => {
    document.body.classList.add('has-side');
    return () => {
      document.body.classList.remove('has-side', 'side-collapsed');
    };
  }, []);

  useLayoutEffect(() => {
    document.body.classList.toggle('side-collapsed', collapsed);
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      // Sin almacenamiento: la preferencia dura lo que dure la sesión
    }
  }, [collapsed]);

  // Escape cierra el cajón y el panel de fuentes
  useEffect(() => {
    if (!drawerOpen && !obsOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawerOpen(false);
        setObsOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen, obsOpen]);

  const handleCopy = (mode: WidgetAppType) => {
    navigator.clipboard
      ?.writeText(getWidgetUrl(mode))
      .then(() => {
        setCopiedKey(mode);
        setTimeout(() => setCopiedKey(null), 2000);
      })
      .catch(() => setCopiedKey(null));
  };

  // Envía los ajustes actuales a las fuentes de OBS y copia la URL vigente
  const triggerObsSync = async () => {
    if (syncState === 'busy') return;
    setSyncState('busy');

    const ttsSettings = loadSettings();
    const targetApp: WidgetAppType = SYNC_TARGET[currentApp] || 'all';
    const activeUrl = buildSuiteWidgetUrl(baseUrl, targetApp, channel || ttsSettings.channel, ttsSettings, extraFor(targetApp));

    postBus({ type: 'FORCE_RELOAD' });
    postBus({
      type: 'SETTINGS_UPDATE',
      settings: { ...ttsSettings, channel: channel || ttsSettings.channel },
    });

    // Con cuenta en la nube: se suben los ajustes ahora y las fuentes de OBS, en cualquier equipo,
    // los descargan en su siguiente consulta (unos diez segundos)
    try {
      await pushAllNow();
    } catch {
      // El aviso de sincronización del panel ya explica el fallo
    }

    // Servidor local: señal de recarga para las fuentes de este equipo
    try {
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        await fetch('/api/obs/reload', { method: 'POST' });
      }
    } catch {
      // Sin servidor local, el bus ya avisó a las fuentes abiertas en este navegador
    }

    try {
      await navigator.clipboard.writeText(activeUrl);
    } catch {
      // Portapapeles no disponible
    }

    setSyncState('done');
    playAlertAudio('synth-bell', 0.45);
    setActiveNotice({ appType: targetApp.toUpperCase(), url: activeUrl });
    setTimeout(() => setSyncState('idle'), 2800);
  };

  const side = (
    <aside
      className="cab shell-side"
      data-collapsed={collapsed ? '' : undefined}
      data-open={drawerOpen ? '' : undefined}
      aria-label="Módulos del panel"
    >
      <div className="shell-brand">
        <a href="#dashboard" className="shell-logo" title="Lalo Stream Suite">
          <span>L</span>
          <b className="shell-lab">Lalo Suite</b>
        </a>
        <button type="button" className="cab-icon shell-close" aria-label="Cerrar menú" onClick={() => setDrawerOpen(false)}>
          <X className="h-4 w-4" />
        </button>
      </div>

      <nav className="shell-nav" aria-label="Módulos" data-tour="nav">
        {nav.map((section) => (
          <React.Fragment key={section.group || 'inicio'}>
            {section.group && <p className="shell-group">{section.group}</p>}
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <a
                  key={item.app}
                  href={item.href}
                  className="shell-link"
                  aria-current={item.app === currentApp ? 'page' : undefined}
                  title={collapsed ? item.label : undefined}
                  onClick={() => setDrawerOpen(false)}
                >
                  <Icon className="h-4 w-4 flex-none" />
                  <span className="shell-lab">{item.label}</span>
                </a>
              );
            })}
          </React.Fragment>
        ))}
      </nav>

      <div className="shell-foot">
        <a href="#legal" className="shell-link" title={collapsed ? 'Términos y políticas' : undefined} onClick={() => setDrawerOpen(false)}>
          <FileText className="h-4 w-4 flex-none" />
          <span className="shell-lab">Términos y políticas</span>
        </a>
        <div className="shell-lab">
          <ThemeSwitch />
        </div>
        <button
          type="button"
          className="shell-link shell-collapse"
          onClick={() => setCollapsed(!collapsed)}
          aria-pressed={collapsed}
          title={collapsed ? 'Mostrar el menú completo' : undefined}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4 flex-none" /> : <PanelLeftClose className="h-4 w-4 flex-none" />}
          <span className="shell-lab">Ocultar menú</span>
        </button>
      </div>
    </aside>
  );

  return (
    <header className="shell-top">
      {createPortal(
        <>
          {drawerOpen && <div className="shell-scrim" onClick={() => setDrawerOpen(false)} />}
          {side}
        </>,
        document.body
      )}

      <div className="shell-head">
        <button
          type="button"
          className="cab-icon shell-menu"
          aria-label="Abrir menú"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="shell-title">{current?.label || 'Lalo Suite'}</h1>
      </div>

      <div className="shell-actions">
        <span className="shell-channel">
          Canal <b className="cab-mono">#{channel || 'sin canal'}</b>
        </span>
        {widgetOpenHere && (
          <span className="cab-chip" data-status="read" title="Hay un widget abierto en este navegador y responde">
            Widget abierto
          </span>
        )}

        <button
          type="button"
          className="cab-btn2 cab-btn-sm"
          onClick={triggerObsSync}
          disabled={syncState === 'busy'}
          title="Envía los ajustes actuales a las fuentes de OBS y copia la URL"
          data-tour="obs-sync"
        >
          {syncState === 'done' ? (
            <Check className="h-4 w-4" />
          ) : (
            <RefreshCw className={`h-4 w-4 ${syncState === 'busy' ? 'animate-spin' : ''}`} />
          )}
          <span>{syncState === 'busy' ? 'Enviando' : syncState === 'done' ? 'OBS actualizado' : 'Actualizar OBS'}</span>
        </button>

        <div className="relative" data-tour="obs-menu">
          <button
            type="button"
            className="cab-btn cab-btn-sm"
            aria-expanded={obsOpen}
            onClick={() => setObsOpen(!obsOpen)}
          >
            <Tv className="h-4 w-4" />
            <span>Fuentes de OBS</span>
          </button>

          {obsOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setObsOpen(false)} />
              <div className="shell-pop" role="dialog" aria-label="Fuentes de navegador para OBS">
                <div className="shell-pop-head">
                  <h2>Fuentes de navegador</h2>
                  <button type="button" className="cab-icon" aria-label="Cerrar" onClick={() => setObsOpen(false)}>
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <p className="cab-hint">
                  Pega una URL como fuente de navegador en OBS, a 1920 × 1080. Usa «Todo en uno» o una fuente por capa.
                </p>

                <ul className="cab-rows shell-sources">
                  {SOURCES.map((source) => (
                    <li key={source.mode} className="cab-row">
                      <div className="min-w-0">
                        <p className="shell-source-name">{source.name}</p>
                        <p className="cab-hint">{source.note}</p>
                      </div>
                      <div className="cab-row-actions">
                        <a
                          className="cab-icon"
                          href={getWidgetUrl(source.mode)}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Abrir ${source.name} en una pestaña`}
                          title="Abrir en una pestaña"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                        <button type="button" className="cab-btn2 cab-btn-sm" onClick={() => handleCopy(source.mode)}>
                          {copiedKey === source.mode ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                          <span>{copiedKey === source.mode ? 'Copiada' : 'Copiar URL'}</span>
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>

                <p className="cab-hint">
                  ¿Quieres colocar las capas a tu gusto? En{' '}
                  <a className="studio-link" href="#studio" onClick={() => setObsOpen(false)}>
                    Studio
                  </a>{' '}
                  montas escenas y cada una tiene su propia URL.
                </p>

                <p className="cab-note">
                  ¿Cambiaste voz, reglas o diseño? «Actualizar OBS» envía los cambios a las fuentes ya pegadas, sin
                  cortar el directo. En OBS conviene activar «Actualizar el navegador al activar escena».
                </p>
              </div>
            </>
          )}
        </div>

        {tourAvailable && onOpenTour && (
          <button type="button" className="cab-btn2 cab-btn-sm" onClick={onOpenTour}>
            Guía
          </button>
        )}

        <span className="shell-saved" role="status">
          {!saved ? 'Guardando' : syncMessage || (cloud.enabled ? 'Guardado en la nube' : 'Guardado')}
        </span>
      </div>

      {activeNotice && (
        <ObsSyncNotice appType={activeNotice.appType} url={activeNotice.url} onDismiss={() => setActiveNotice(null)} />
      )}
    </header>
  );
};
