/**
 * src/components/shell/AppShell.tsx
 *
 * Cascarón único del creador, montado una sola vez en App.tsx (antes cada
 * página montaba su propia barra: 21 monturas).
 *
 * - Barra lateral con 5 destinos (Inicio, En vivo, Herramientas, Conexiones,
 *   Plan y pagos), el logotipo y el mini-plan con los días que quedan.
 * - Barra superior con el título, «Canal en directo» (solo con señal real: un
 *   widget abierto en este navegador que responde), el chip del plan, las
 *   fuentes de OBS y «Copiar fuente OBS».
 * - Las herramientas se abren en ventanas internas (WindowHost) que persisten
 *   al cambiar de vista.
 *
 * Conserva el plegado de la barra, el cajón en pantallas estrechas y las clases
 * de <body> (`has-side`, `side-collapsed`, `tally`) que ya usaban las páginas.
 */

import React, { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CreditCard, FileText, Home, LayoutGrid, Menu, PanelLeftClose, PanelLeftOpen, Plug, Radio, Tv, X } from 'lucide-react';
import { ThemeSwitch } from '../ThemeSwitch';
import { TallyLogo } from '../brand/TallyLogo';
import { Boton, Pill, ToastProvider, useToast } from '../tally-ui';
import { useCloudSession } from '../../hooks/useCloudSession';
import { loadSettings } from '../../types/settings';
import { daysLeftText, daysShort, STATE_TONE, type PlanSummary } from '../../lib/planDays';
import { OBS_SOURCES } from '../../lib/tools';
import { useObsActions, useWidgetOpenHere } from './obsActions';
import { ObsSourcesPanel } from './ObsSourcesPanel';
import { PlanProvider, usePlanSummary } from './usePlanSummary';
import { DESTINATIONS, VIEW_TITLE, viewForRoute, type ShellView } from './routes';
import { WindowHost } from './WindowHost';
import { WindowsProvider, useWindows } from './windowStore';
import { ConexionesView, PlanView, ToolsView } from './views';
import { EmbeddedProvider } from './ShellContext';
import '../../styles/shell.css';

const Catalog = lazy(() => import('../../pages/Catalog').then((m) => ({ default: m.Catalog })));
const Control = lazy(() => import('../../pages/Control').then((m) => ({ default: m.Control })));
const CloudSetup = lazy(() => import('../../pages/CloudSetup').then((m) => ({ default: m.CloudSetup })));

const COLLAPSE_KEY = 'lalo_panel_side_collapsed';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  inicio: Home,
  vivo: Radio,
  herramientas: LayoutGrid,
  conexiones: Plug,
  plan: CreditCard,
};

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

const MiniPlan: React.FC<{ plan: PlanSummary }> = ({ plan }) => {
  const tone = STATE_TONE[plan.state];
  const frac = plan.totalDays > 0 ? Math.max(0.02, Math.min(1, plan.days / plan.totalDays)) : 0;
  return (
    <a href="#cuenta" className="tally-plan-mini" data-tone={tone} aria-label="Ver plan y pagos">
      <b>
        <span>{plan.planName}</span>
        <span className="tally-pm-days">{daysShort(plan)}</span>
      </b>
      <span className="tally-meter">
        <i style={{ transform: `scaleX(${frac})` }} />
      </span>
      <small>{daysLeftText(plan)}</small>
    </a>
  );
};

const ShellInner: React.FC<{ route: string; layerRef: React.RefObject<HTMLDivElement | null> }> = ({ route, layerRef }) => {
  const cloud = useCloudSession();
  const plan = usePlanSummary();
  const windows = useWindows();
  const toast = useToast();
  const widgetOpen = useWidgetOpenHere();
  const obs = useObsActions(undefined, null);
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [obsOpen, setObsOpen] = useState(false);

  const target = viewForRoute(route);
  const view: ShellView = target.view === 'nube' && cloud.enabled ? 'inicio' : target.view;

  // La página deja sitio a la barra lateral a través de clases en <body>
  // y el tema Tally Studio se activa con la clase .tally, solo mientras el cascarón está montado
  useLayoutEffect(() => {
    document.body.classList.add('has-side', 'tally');
    return () => {
      document.body.classList.remove('has-side', 'side-collapsed', 'tally');
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

  // Enlace directo: #alertas abre Herramientas con la ventana de Alertas
  useEffect(() => {
    if (!target.tool) return;
    if (!windows.open(target.tool)) toast('Cierra una ventana para abrir otra (máximo 3).');
    // Solo cuando cambia la ruta
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

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

  const copyAll = async () => {
    if (!loadSettings().channel.trim()) {
      toast('Escribe tu canal en Inicio para poder copiar la fuente.');
      return;
    }
    toast((await obs.copy('all')) ? 'Fuente de OBS copiada' : 'El navegador no dejó copiar. Ábrela desde «Fuentes de OBS».');
  };

  const planChip =
    plan.state === 'gratis' ? 'Plan gratis' : plan.days > 0 ? `${plan.planName} · ${plan.days} ${plan.days === 1 ? 'día' : 'días'}` : 'Plan terminado';

  const content = (() => {
    switch (view) {
      case 'vivo':
        return <Control />;
      case 'herramientas':
        return <ToolsView />;
      case 'conexiones':
        return <ConexionesView />;
      case 'plan':
        return <PlanView />;
      case 'nube':
        return <CloudSetup />;
      default:
        return <Catalog />;
    }
  })();

  return (
    <div className="tally-app">
      <aside
        className="cab shell-side"
        data-collapsed={collapsed ? '' : undefined}
        data-open={drawerOpen ? '' : undefined}
        aria-label="Navegación principal"
      >
        <div className="shell-brand">
          <a href="#dashboard" className="tally-brand" aria-label="Tally Studio, ir al inicio" title="Tally Studio">
            <TallyLogo size={20} decorativo />
          </a>
          <button type="button" className="cab-icon shell-close" aria-label="Cerrar menú" onClick={() => setDrawerOpen(false)}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="shell-nav" aria-label="Destinos" data-tour="nav">
          {DESTINATIONS.map((d) => {
            const Icon = ICONS[d.id];
            return (
              <a
                key={d.id}
                href={d.href}
                className="shell-link"
                aria-current={d.id === view ? 'page' : undefined}
                title={collapsed ? d.label : undefined}
                onClick={() => setDrawerOpen(false)}
              >
                <Icon className="h-4 w-4 flex-none" />
                <span className="shell-lab">{d.label}</span>
              </a>
            );
          })}
        </nav>

        <div className="shell-foot">
          <div className="shell-lab">
            <MiniPlan plan={plan} />
          </div>
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
      {drawerOpen && <div className="shell-scrim" onClick={() => setDrawerOpen(false)} />}

      <div className="tally-main">
        <header className="tally-top">
          <button type="button" className="cab-icon shell-menu" aria-label="Abrir menú" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}>
            <Menu className="h-5 w-5" />
          </button>
          <h1>{VIEW_TITLE[view]}</h1>
          <span className="tally-sp" />
          {widgetOpen && (
            <Pill tone="live" dot role="status">
              Canal en directo
            </Pill>
          )}
          <a href="#cuenta" className="tally-chip-link" aria-label={`Estado del plan: ${planChip}`}>
            <Pill tone={STATE_TONE[plan.state]} dot>
              {planChip}
            </Pill>
          </a>
          <div className="relative">
            <Boton pequeno aria-expanded={obsOpen} onClick={() => setObsOpen(!obsOpen)}>
              <Tv className="h-4 w-4" />
              Fuentes de OBS
            </Boton>
            {obsOpen && (
              <ObsSourcesPanel
                obs={obs}
                onClose={() => setObsOpen(false)}
                onOpenStudio={() => {
                  setObsOpen(false);
                  if (!windows.open('studio')) toast('Cierra una ventana para abrir otra (máximo 3).');
                }}
              />
            )}
          </div>
          <Boton pequeno variante="principal" onClick={copyAll} title={`Copia la fuente «${OBS_SOURCES[0].name}»`}>
            Copiar fuente OBS
          </Boton>
        </header>

        <main className="tally-view" data-view={view}>
          <EmbeddedProvider>
            <Suspense fallback={null}>{content}</Suspense>
          </EmbeddedProvider>
        </main>
      </div>

      <WindowHost ref={layerRef} />
    </div>
  );
};

export const AppShell: React.FC<{ route: string }> = ({ route }) => {
  const layerRef = useRef<HTMLDivElement | null>(null);
  return (
    <ToastProvider>
      <PlanProvider>
        <WindowsProvider layerRef={layerRef}>
          <ShellInner route={route} layerRef={layerRef} />
        </WindowsProvider>
      </PlanProvider>
    </ToastProvider>
  );
};
