/**
 * src/pages/admin/StreamersSection.tsx
 *
 * Cuentas de los streamers: filtros, búsqueda por nombre y, al elegir una, su
 * detalle al lado con las acciones (cambiar plan, código de recuperación,
 * suspender o reactivar). Las filas se pueden recorrer y elegir con el teclado.
 */

import React, { useMemo, useState } from 'react';
import { UsageMeter } from '../../components/UsageMeter';
import { adminHref, filterProfiles, isNearlyFull, profileName, relativeDay, type ProfileFilter } from '../../lib/adminLogic';
import { formatBytes, rpc } from '../../lib/cloud';
import type { ProfileStatus } from '../../lib/cloudTypes';
import { formatDate } from './adminFormat';
import type { AdminData } from './useAdminData';
import { VERSIONES_ACTUALES } from '../../legal';
import { resumenAceptacion } from '../../legal/logica';

const STATUS_LABEL: Record<ProfileStatus, string> = { active: 'Activa', pending: 'Sin código', suspended: 'Suspendida' };
const STATUS_CHIP: Record<ProfileStatus, string> = { active: 'read', pending: 'skipped', suspended: 'rejected' };

const FILTERS: { id: ProfileFilter; label: string }[] = [
  { id: 'todas', label: 'Todas' },
  { id: 'activas', label: 'Activas' },
  { id: 'llenas', label: 'Casi llenas' },
  { id: 'suspendidas', label: 'Suspendidas' },
];

export const StreamersSection: React.FC<{ data: AdminData; ownId: string | null }> = ({ data, ownId }) => {
  const { overview, plans, invites, meta, acceptances, planName, reload, setError } = data;
  const [filter, setFilter] = useState<ProfileFilter>('todas');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<{ profileId: string; code: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  // El administrador no es un streamer: su propia cuenta no aparece en la lista
  const accounts = useMemo(
    () => (overview?.profiles ?? []).filter((row) => row.profile_id !== ownId && row.role !== 'admin'),
    [overview, ownId]
  );
  const rows = useMemo(() => filterProfiles(accounts, filter, search), [accounts, filter, search]);
  const selected = accounts.find((row) => row.profile_id === selectedId) ?? null;
  const now = Date.now();

  if (!overview) return null;

  const select = (id: string) => {
    setSelectedId(id);
    setCopied(false);
  };

  const change = async (id: string, patch: { status?: ProfileStatus; plan?: string }) => {
    setBusy(true);
    try {
      await rpc('admin_set_profile', { p_profile: id, p_status: patch.status ?? null, p_plan: patch.plan ?? null });
      setError(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar la cuenta.');
    } finally {
      setBusy(false);
    }
  };

  const createRecovery = async (id: string) => {
    setBusy(true);
    try {
      const code = await rpc('admin_create_recovery_code', { p_profile: id, p_ttl_hours: 24 });
      setRecovery({ profileId: id, code });
      setCopied(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el código de recuperación.');
    } finally {
      setBusy(false);
    }
  };

  const copyRecovery = (code: string) => {
    navigator.clipboard
      ?.writeText(code)
      .then(() => setCopied(true))
      .catch(() => setError('No se pudo copiar. Selecciona el código y cópialo a mano.'));
  };

  const selectedMeta = selected ? meta.get(selected.profile_id) : undefined;
  const enteredWith = selectedMeta?.invite_code_id
    ? invites.find((invite) => invite.id === selectedMeta.invite_code_id)?.code ?? 'Un código que ya no existe'
    : 'Sin código';
  // Solo lectura: si la cuenta aceptó los términos vigentes y cuándo
  const terms = selected && acceptances ? resumenAceptacion(acceptances.get(selected.profile_id) ?? [], VERSIONES_ACTUALES) : null;
  const termsText = !terms
    ? 'Sin datos: falta aplicar la migración 0008'
    : terms.estado === 'nunca'
      ? 'Sin aceptar'
      : `${terms.estado === 'al-dia' ? 'Aceptados' : 'Aceptó una versión anterior'} el ${formatDate(terms.fecha ?? '')}`;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <div className="cab-seg" role="group" aria-label="Filtrar cuentas">
          {FILTERS.map((entry) => (
            <button key={entry.id} type="button" aria-pressed={filter === entry.id} onClick={() => setFilter(entry.id)}>
              {entry.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="cab-inp adm-search"
          value={search}
          placeholder="Buscar por nombre"
          aria-label="Buscar streamer por nombre"
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="adm-detail-grid">
        {accounts.length === 0 ? (
          <p className="cab-note">
            Aún no hay streamers.{' '}
            <a className="studio-link" href={adminHref('codigos')}>
              Genera un código de invitación
            </a>{' '}
            y compártelo.
          </p>
        ) : (
          <div className="adm-table adm-pick">
            <table>
              <thead>
                <tr>
                  <th>Streamer</th>
                  <th>Plan</th>
                  <th>Archivos</th>
                  <th>Última vez</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5}>Ninguna cuenta con este filtro.</td>
                  </tr>
                )}
                {rows.map((row) => {
                  const who = profileName(row);
                  return (
                    <tr
                      key={row.profile_id}
                      tabIndex={0}
                      data-pick=""
                      aria-selected={row.profile_id === selectedId}
                      onClick={() => select(row.profile_id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          select(row.profile_id);
                        }
                      }}
                    >
                      <td>
                        <b>{who}</b>
                      </td>
                      <td>{planName(row.plan_id)}</td>
                      <td>
                        <span className="cab-mono">
                          {formatBytes(row.bytes_used)} de {formatBytes(row.storage_limit_bytes)}
                        </span>
                        <UsageMeter used={row.bytes_used} limit={row.storage_limit_bytes} label={`Espacio de ${who}`} />
                      </td>
                      <td>{relativeDay(meta.get(row.profile_id)?.last_seen_at, now)}</td>
                      <td>
                        <span className="cab-chip" data-status={STATUS_CHIP[row.status]}>
                          {STATUS_LABEL[row.status]}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <section className="cab-mod" aria-live="polite">
          {!selected ? (
            <>
              <h2>Detalle</h2>
              <p className="cab-hint">Elige una cuenta de la tabla para ver su uso y sus acciones.</p>
            </>
          ) : (
            <div key={selected.profile_id} className="adm-detail grid gap-4">
              <h2 className="adm-h2">
                {profileName(selected)}
                <b className="cab-chip" data-status={STATUS_CHIP[selected.status]}>
                  {STATUS_LABEL[selected.status]}
                </b>
              </h2>
              <dl className="adm-kv">
                <dt>Canal</dt>
                <dd>{selected.twitch_login ? `#${selected.twitch_login}` : 'Sin canal'}</dd>
                <dt>Espacio</dt>
                <dd className="cab-mono">
                  {formatBytes(selected.bytes_used)} de {formatBytes(selected.storage_limit_bytes)}
                </dd>
                <dt>Archivos</dt>
                <dd>
                  {selected.file_count} de {selected.max_files}
                </dd>
                <dt>Última vez</dt>
                <dd>{relativeDay(selectedMeta?.last_seen_at, now)}</dd>
                <dt>Alta</dt>
                <dd>{selectedMeta ? formatDate(selectedMeta.created_at) : 'Sin datos'}</dd>
                <dt>Entró con</dt>
                <dd className="cab-mono">{enteredWith}</dd>
                <dt>Términos</dt>
                <dd>{termsText}</dd>
              </dl>
              <UsageMeter used={selected.bytes_used} limit={selected.storage_limit_bytes} label={`Espacio de ${profileName(selected)}`} />
              {isNearlyFull(selected) && (
                <p className="cab-note">Esta cuenta está al 85% o más de su plan. Puedes pasarla a un plan mayor.</p>
              )}

              <div className="cab-field">
                <label className="cab-label" htmlFor="adm-plan">
                  Plan
                </label>
                <select
                  id="adm-plan"
                  className="cab-inp"
                  value={selected.plan_id || ''}
                  disabled={busy}
                  onChange={(e) => change(selected.profile_id, { plan: e.target.value })}
                >
                  {!selected.plan_id && <option value="">Sin plan</option>}
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name} ({formatBytes(plan.storage_limit_bytes)})
                    </option>
                  ))}
                </select>
                <span className="cab-hint">Cambiar el plan aplica los límites nuevos al instante.</span>
              </div>

              {selected.status === 'pending' ? (
                <p className="cab-note">Esta cuenta entró con Twitch pero aún no ha canjeado un código. No tiene acceso.</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="cab-btn2 cab-btn-sm" disabled={busy} onClick={() => createRecovery(selected.profile_id)}>
                      Código de recuperación
                    </button>
                    <button
                      type="button"
                      className={`cab-btn2 cab-btn-sm ${selected.status === 'active' ? 'adm-danger' : ''}`}
                      disabled={busy}
                      onClick={() => change(selected.profile_id, { status: selected.status === 'active' ? 'suspended' : 'active' })}
                    >
                      {selected.status === 'active' ? 'Suspender' : 'Reactivar'}
                    </button>
                  </div>
                  <p className="cab-hint">Suspender corta el panel y las capas de OBS sin borrar nada.</p>
                </>
              )}

              {recovery && recovery.profileId === selected.profile_id && (
                <div className="cab-note grid gap-2" role="status">
                  <p>Código de recuperación. Vale 24 horas y un solo uso. No se volverá a mostrar.</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="cab-url cab-mono">{recovery.code}</span>
                    <button type="button" className="cab-btn2 cab-btn-sm" onClick={() => copyRecovery(recovery.code)}>
                      {copied ? 'Copiado' : 'Copiar'}
                    </button>
                    <button type="button" className="cab-btn2 cab-btn-sm" onClick={() => setRecovery(null)}>
                      Ya lo guardé
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </>
  );
};
