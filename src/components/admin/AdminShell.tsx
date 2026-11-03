/**
 * src/components/admin/AdminShell.tsx
 *
 * Consola del administrador: su propio menú lateral y su propia cabecera. El
 * administrador no emite, así que aquí no hay módulos de directo, ni canal, ni
 * fuentes de OBS: solo códigos, límites, almacenamiento, voces, cuentas, integraciones y su acceso.
 *
 * La sección se elige por la dirección (#admin, #admin/codigos...). Cualquier
 * otra dirección lleva al Resumen. El menú va en cuatro grupos (Cobros,
 * Creadores, Contenido y Sistema) bajo «Resumen», y marca con un número las
 * secciones que tienen algo pendiente. Las rutas antiguas (#admin/limites,
 * #admin/personajes, #admin/streamers) siguen llevando a su sección nueva.
 *
 * Reutiliza los estilos .shell-* del panel de streamer: se pliega en escritorio
 * y es un cajón en pantallas estrechas.
 */

import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  BarChart3,
  CreditCard,
  FileText,
  DatabaseBackup,
  HardDrive,
  Inbox,
  KeyRound,
  LayoutGrid,
  Menu,
  Mic,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Receipt,
  Ticket,
  Users,
  X,
} from 'lucide-react';
import { ThemeSwitch } from '../ThemeSwitch';
import { TallyLogo } from '../brand/TallyLogo';
import { useCloudSession } from '../../hooks/useCloudSession';
import {
  ADMIN_GROUPS,
  ADMIN_HOME,
  ADMIN_SECTIONS,
  adminHref,
  adminRouteFromHash,
  attentionCounts,
  buildAttention,
  navCounts,
  storageHealth,
  type AdminRoute,
  type AdminSection,
  type AttentionItem,
  type StorageHealth,
} from '../../lib/adminLogic';
import { useAdminData } from '../../pages/admin/useAdminData';
import { ResumenSection } from '../../pages/admin/ResumenSection';
import { UsoSection } from '../../pages/admin/UsoSection';
import { CodigosRegalosSection } from '../../pages/admin/CodigosRegalosSection';
import { PlanesSection } from '../../pages/admin/PlanesSection';
import { SuscripcionesSection } from '../../pages/admin/SuscripcionesSection';
import { AlmacenamientoSection } from '../../pages/admin/AlmacenamientoSection';
import { StreamersSection } from '../../pages/admin/StreamersSection';
import { VocesPersonajesSection } from '../../pages/admin/VocesPersonajesSection';
import { AccesoSection } from '../../pages/admin/AccesoSection';
import { IntegracionesSection } from '../../pages/admin/IntegracionesSection';
import { MigrarSection } from '../../pages/admin/MigrarSection';
import { BandejaSection } from '../../pages/admin/BandejaSection';
import { FacturacionSection } from '../../pages/admin/FacturacionSection';
import { useAdminBillingSummary, useAdminInbox } from '../../pages/admin/useAdminBilling';
import '../../styles/admin.css';
import '../../styles/admin-tally.css';

const ICONS: Record<AdminSection, React.ComponentType<{ className?: string }>> = {
  resumen: LayoutGrid,
  bandeja: Inbox,
  facturacion: BarChart3,
  suscripciones: Receipt,
  precios: CreditCard,
  codigos: Ticket,
  cuentas: Users,
  uso: Activity,
  voces: Mic,
  almacenamiento: HardDrive,
  integraciones: Plug,
  migrar: DatabaseBackup,
  acceso: KeyRound,
};

const STORAGE_CHIP: Record<StorageHealth, { status?: string; label: string }> = {
  unknown: { status: 'rejected', label: 'Almacenamiento sin respuesta' },
  missing: { status: 'skipped', label: 'Almacenamiento sin configurar' },
  untested: { status: 'skipped', label: 'Almacenamiento sin probar' },
  failed: { status: 'rejected', label: 'Almacenamiento con fallo' },
  ok: { status: 'read', label: 'Almacenamiento en marcha' },
};

// La misma preferencia que el panel de streamer
const COLLAPSE_KEY = 'lalo_panel_side_collapsed';

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

export const AdminShell: React.FC = () => {
  const { session, profile } = useCloudSession();
  const data = useAdminData();
  const [route, setRoute] = useState<AdminRoute>(() => adminRouteFromHash(window.location.hash));
  const section = route.section;
  const inbox = useAdminInbox();
  const summary = useAdminBillingSummary();
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const onChange = () => setRoute(adminRouteFromHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    window.addEventListener('popstate', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
      window.removeEventListener('popstate', onChange);
    };
  }, []);

  // La página deja sitio a la barra lateral a través de clases en <body>
  // y el tema Tally Studio se activa con la clase .tally (ver src/styles/tally.css)
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

  // Escape cierra el cajón
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const { overview, invites, usage, storage, storageError, storageLoading } = data;
  const baseAttention = useMemo(
    () =>
      overview && !storageLoading
        ? buildAttention({
            storage,
            storageError: storageError?.message,
            profiles: overview.profiles.filter((row) => row.role !== 'admin'),
            invites,
            usage,
            now: Date.now(),
          })
        : [],
    [overview, invites, usage, storage, storageError, storageLoading]
  );
  // Los pagos por atender: el número del menú es su total; en el Resumen entran como un aviso más
  const inboxCounts = inbox.state.status === 'ready' ? inbox.state.data.counts : null;
  const attention = useMemo((): AttentionItem[] => {
    if (!inboxCounts || inboxCounts.total === 0) return baseAttention;
    const text = `${inboxCounts.total === 1 ? '1 pago requiere' : `${inboxCounts.total} pagos requieren`} atención en la bandeja de pagos.`;
    return [{ level: inboxCounts.fail > 0 ? 'bad' : 'warn', text, section: 'bandeja', action: 'Abrir la bandeja' }, ...baseAttention];
  }, [baseAttention, inboxCounts]);
  const counts = useMemo(() => {
    const out = navCounts(attentionCounts(baseAttention));
    if (inboxCounts && inboxCounts.total > 0) out.bandeja = inboxCounts.total;
    return out;
  }, [baseAttention, inboxCounts]);
  const title = ADMIN_SECTIONS.find((entry) => entry.id === section)?.label ?? ADMIN_HOME.label;
  const storageChip = STORAGE_CHIP[storageHealth(storage)];
  const email = session?.user.email || profile?.display_name || 'Administrador';

  const navLink = (entry: { id: AdminSection; label: string }) => {
    const Icon = ICONS[entry.id];
    const count = counts[entry.id] ?? 0;
    return (
      <a
        key={entry.id}
        href={adminHref(entry.id)}
        className="shell-link adm-link"
        aria-current={entry.id === section ? 'page' : undefined}
        title={collapsed ? entry.label : undefined}
        onClick={() => setDrawerOpen(false)}
      >
        <Icon className="h-4 w-4 flex-none" />
        <span className="shell-lab">{entry.label}</span>
        {count > 0 && (
          <b className="adm-badge" title="Requiere atención">
            {count}
            <span className="adm-sr"> {count === 1 ? 'aviso' : 'avisos'}</span>
          </b>
        )}
      </a>
    );
  };

  const side = (
    <aside
      className="cab shell-side"
      data-collapsed={collapsed ? '' : undefined}
      data-open={drawerOpen ? '' : undefined}
      aria-label="Menú de administración"
    >
      <div className="shell-brand">
        <a href={adminHref('resumen')} className="tally-brand" aria-label="Tally Studio, administración" title="Tally Studio, administración">
          <TallyLogo size={20} decorativo />
          <span className="tally-brand-sub">Administración</span>
        </a>
        <button type="button" className="cab-icon shell-close" aria-label="Cerrar menú" onClick={() => setDrawerOpen(false)}>
          <X className="h-4 w-4" />
        </button>
      </div>

      <nav className="shell-nav" aria-label="Secciones de la consola">
        {navLink(ADMIN_HOME)}
        {ADMIN_GROUPS.map((group) => (
          <div key={group.id} role="group" aria-label={group.label} className="atl-nav-group">
            <p className="shell-group shell-lab" aria-hidden="true">
              {group.label}
            </p>
            {group.sections.map(navLink)}
          </div>
        ))}
      </nav>

      <div className="shell-foot">
        <p className="shell-lab adm-who">
          {email}
          <br />
          Sin canal de Twitch
        </p>
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
    <div className="cab">
      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-6">
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
            <h1 className="shell-title">{title}</h1>
          </div>
          <div className="shell-actions">
            {overview && (
              <span className="cab-chip" data-status="read">
                Nube en línea
              </span>
            )}
            {!storageLoading && (
              <a className="cab-chip adm-chip-link" data-status={storageChip.status} href={adminHref('almacenamiento')}>
                {storageChip.label}
              </a>
            )}
          </div>
        </header>

        {data.error && (
          <p className="cab-error" role="alert">
            {data.error}
          </p>
        )}
        {!overview && !data.error && section !== 'acceso' && <p className="cab-hint">Leyendo la consola.</p>}

        <main key={section} className="adm-view">
          {section === 'resumen' && <ResumenSection data={data} attention={attention} />}
          {section === 'bandeja' && <BandejaSection inbox={inbox} />}
          {section === 'facturacion' && <FacturacionSection summary={summary} />}
          {section === 'suscripciones' && <SuscripcionesSection />}
          {section === 'precios' && <PlanesSection data={data} />}
          {section === 'codigos' && overview && <CodigosRegalosSection data={data} />}
          {section === 'cuentas' && <StreamersSection data={data} ownId={profile?.id ?? null} />}
          {section === 'uso' && <UsoSection data={data} ownId={profile?.id ?? null} />}
          {section === 'voces' && <VocesPersonajesSection data={data} tab={route.tab} />}
          {section === 'almacenamiento' && <AlmacenamientoSection data={data} />}
          {section === 'integraciones' && <IntegracionesSection data={data} />}
          {section === 'migrar' && <MigrarSection />}
          {section === 'acceso' && <AccesoSection />}
        </main>
      </div>
    </div>
  );
};
