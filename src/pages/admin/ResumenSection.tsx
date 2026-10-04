/**
 * src/pages/admin/ResumenSection.tsx
 *
 * Primera pantalla de la consola: lo que hay que resolver (con un botón que
 * lleva al sitio), las cifras del proyecto y la actividad que se puede
 * reconstruir con datos reales (canjes y códigos creados).
 */

import React from 'react';
import { UsageMeter } from '../../components/UsageMeter';
import { MB, formatBytes } from '../../lib/cloud';
import { adminHref, buildActivity, relativeDay, type AttentionItem } from '../../lib/adminLogic';
import type { AdminData } from './useAdminData';

/** Límite de la capa gratuita de Supabase (supabase.com/pricing, octubre de 2026). */
const FREE_DATABASE_BYTES = 500 * MB;

const LEVEL_CHIP: Record<AttentionItem['level'], { status?: string; label: string }> = {
  bad: { status: 'rejected', label: 'Urgente' },
  warn: { status: 'skipped', label: 'Aviso' },
  info: { label: 'Pendiente' },
};

export const ResumenSection: React.FC<{ data: AdminData; attention: AttentionItem[] }> = ({ data, attention }) => {
  const { overview, invites, redemptions } = data;
  if (!overview) return null;
  const totals = overview.totals;
  const suspended = overview.profiles.filter((row) => row.status === 'suspended').length;
  const activity = buildActivity(invites, redemptions, overview.profiles);
  const now = Date.now();

  return (
    <>
      <section className="cab-mod">
        <h2>Requiere tu atención</h2>
        {attention.length === 0 ? (
          <p className="cab-note">Nada pendiente. El almacenamiento funciona, ninguna cuenta está casi llena y ningún código caduca esta semana.</p>
        ) : (
          <ul className="cab-rows adm-list">
            {attention.map((item) => (
              <li key={`${item.section}:${item.text}`} className="adm-list-row">
                <span>
                  <span className="cab-chip" data-status={LEVEL_CHIP[item.level].status}>
                    {LEVEL_CHIP[item.level].label}
                  </span>{' '}
                  {item.text}
                </span>
                <a className="cab-btn2 cab-btn-sm" href={adminHref(item.section)}>
                  {item.action}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <dl className="cab-stats">
        <div>
          <dt>Cuentas activas</dt>
          <dd>{totals.active_profiles}</dd>
        </div>
        <div>
          <dt>Suspendidas</dt>
          <dd>{suspended}</dd>
        </div>
        <div>
          <dt>Sin código</dt>
          <dd>{totals.pending_profiles}</dd>
        </div>
        <div>
          <dt>Códigos vigentes</dt>
          <dd>{totals.open_invites}</dd>
        </div>
        <div>
          <dt>Espacio usado</dt>
          <dd>{formatBytes(totals.storage_bytes)}</dd>
        </div>
        <div>
          <dt>Espacio prometido</dt>
          <dd>{formatBytes(totals.storage_committed_bytes)}</dd>
        </div>
      </dl>

      <div className="adm-grid2">
        <section className="cab-mod">
          <h2>Actividad reciente</h2>
          {activity.length === 0 ? (
            <p className="cab-note">Todavía no hay canjes ni códigos creados.</p>
          ) : (
            <ul className="cab-rows adm-list">
              {activity.map((item) => (
                <li key={`${item.at}:${item.text}`} className="adm-list-row">
                  <span>{item.text}</span>
                  <span className="cab-hint cab-mono">{relativeDay(item.at, now)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="cab-hint">Solo aparecen canjes y códigos creados. Lalo no guarda un historial de suspensiones ni de cambios de plan.</p>
        </section>

        <section className="cab-mod">
          <h2>Base de datos</h2>
          <div className="grid gap-2">
            <span className="cab-mono">
              {formatBytes(totals.database_bytes)} de {formatBytes(FREE_DATABASE_BYTES)}
            </span>
            <UsageMeter used={totals.database_bytes} limit={FREE_DATABASE_BYTES} label="Base de datos usada" />
          </div>
          <p className="cab-hint">
            Aquí van las cuentas y la configuración de cada streamer, no sus archivos. La capa gratuita de Supabase pausa
            el proyecto tras una semana sin uso; se reactiva desde su panel.
          </p>
        </section>
      </div>
    </>
  );
};
