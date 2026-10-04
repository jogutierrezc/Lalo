/**
 * src/components/admin/AdminShell.tsx
 *
 * Consola del administrador: su propio menú lateral y su propia cabecera. El
 * administrador no emite, así que aquí no hay módulos de directo, ni canal, ni
 * fuentes de OBS: solo códigos, límites, almacenamiento, voces, cuentas, integraciones y su acceso.
 *
 * La sección se elige por la dirección (#admin, #admin/codigos...). Cualquier
 * otra dirección lleva al Resumen. El menú marca con un número las secciones
 * que tienen algo pendiente.
 *
 * Reutiliza los estilos .shell-* del panel de streamer: se pliega en escritorio
 * y es un cajón en pantallas estrechas.
 */

import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Gauge, HardDrive, KeyRound, LayoutGrid, Menu, Mic, PanelLeftClose, PanelLeftOpen, Plug, Ticket, Users, X } from 'lucide-react';
import { ThemeSwitch } from '../ThemeSwitch';
import { useCloudSession } from '../../hooks/useCloudSession';
import {
  ADMIN_SECTIONS,
  adminHref,
  adminSectionFromHash,
  attentionCounts,
  buildAttention,
  storageHealth,
  type AdminSection,
  type StorageHealth,
} from '../../lib/adminLogic';
import { useAdminData } from '../../pages/admin/useAdminData';
import { ResumenSection } from '../../pages/admin/ResumenSection';
import { CodigosSection } from '../../pages/admin/CodigosSection';
import { LimitesSection } from '../../pages/admin/LimitesSection';
import { AlmacenamientoSection } from '../../pages/admin/AlmacenamientoSection';
import { StreamersSection } from '../../pages/admin/StreamersSection';
import { VocesSection } from '../../pages/admin/VocesSection';
import { AccesoSection } from '../../pages/admin/AccesoSection';
import { IntegracionesSection } from '../../pages/admin/IntegracionesSection';
import '../../styles/admin.css';

const ICONS: Record<AdminSection, React.ComponentType<{ className?: string }>> = {
  resumen: LayoutGrid,
  codigos: Ticket,
  limites: Gauge,
  almacenamiento: HardDrive,
  voces: Mic,
  streamers: Users,
  integraciones: Plug,
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
  const [section, setSection] = useState<AdminSection>(() => adminSectionFromHash(window.location.hash));
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const onChange = () => setSection(adminSectionFromHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    window.addEventListener('popstate', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
      window.removeEventListener('popstate', onChange);
    };
  }, []);

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

  // Escape cierra el cajón
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const { overview, invites, storage, storageError, storageLoading } = data;
  const attention = useMemo(
    () =>
      overview && !storageLoading
        ? buildAttention({
            storage,
            storageError: storageError?.message,
            profiles: overview.profiles.filter((row) => row.role !== 'admin'),
            invites,
            now: Date.now(),
          })
        : [],
    [overview, invites, storage, storageError, storageLoading]
  );
  const counts = attentionCounts(attention);
  const title = ADMIN_SECTIONS.find((entry) => entry.id === section)?.label ?? 'Resumen';
  const storageChip = STORAGE_CHIP[storageHealth(storage)];
  const email = session?.user.email || profile?.display_name || 'Administrador';

  const side = (
    <aside
      className="cab shell-side"
      data-collapsed={collapsed ? '' : undefined}
      data-open={drawerOpen ? '' : undefined}
      aria-label="Menú de administración"
    >
      <div className="shell-brand">
        <a href={adminHref('resumen')} className="shell-logo" title="Lalo Stream Suite, administración">
          <span>L</span>
          <b className="shell-lab adm-brand">
            Lalo<small>Administración</small>
          </b>
        </a>
        <button type="button" className="cab-icon shell-close" aria-label="Cerrar menú" onClick={() => setDrawerOpen(false)}>
          <X className="h-4 w-4" />
        </button>
      </div>

      <nav className="shell-nav" aria-label="Secciones de la consola">
        {ADMIN_SECTIONS.map((entry) => {
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
        })}
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
          {section === 'codigos' && overview && <CodigosSection data={data} />}
          {section === 'limites' && <LimitesSection data={data} />}
          {section === 'almacenamiento' && <AlmacenamientoSection data={data} />}
          {section === 'voces' && <VocesSection data={data} />}
          {section === 'streamers' && <StreamersSection data={data} ownId={profile?.id ?? null} />}
          {section === 'integraciones' && <IntegracionesSection data={data} />}
          {section === 'acceso' && <AccesoSection />}
        </main>
      </div>
    </div>
  );
};
