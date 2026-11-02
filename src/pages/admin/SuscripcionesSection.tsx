/**
 * src/pages/admin/SuscripcionesSection.tsx
 *
 * Suscripciones: quién paga por PayPal y quién tiene un plan por código, con
 * contadores que filtran la tabla. La primera página trae también los accesos
 * por código; «Cargar más» pide la siguiente con el cursor `nextBefore`.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adminSubscriptions } from '../../lib/billingApi';
import type { AdminSubscription, AdminSubscriptions, CodeAccess, SubscriptionTotals } from '../../lib/billingTypes';
import {
  SUB_FILTERS,
  SUB_STATUS_LABEL,
  buildSubRows,
  filterCounts,
  filterSubRows,
  type SubFilter,
  type SubTone,
} from '../../lib/invitesLogic';
import { formatDate } from './adminFormat';

const TONE_STATUS: Record<SubTone, string | undefined> = { ok: 'read', warn: 'skipped', bad: 'rejected', code: undefined };
const day = (iso: string | null) => (iso ? formatDate(iso) : '—');

const EMPTY_TOTALS: SubscriptionTotals = { active: 0, grace: 0, cancelled: 0, suspended: 0, expired: 0, pending: 0 };

export const SuscripcionesSection: React.FC = () => {
  const [subs, setSubs] = useState<AdminSubscription[]>([]);
  const [codeAccess, setCodeAccess] = useState<CodeAccess[]>([]);
  const [totals, setTotals] = useState<SubscriptionTotals>(EMPTY_TOTALS);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SubFilter>('all');
  const aliveRef = useRef(true);

  const apply = (page: AdminSubscriptions, append: boolean) => {
    setSubs((prev) => (append ? [...prev, ...page.subscriptions.filter((s) => !prev.some((p) => p.id === s.id))] : page.subscriptions));
    if (!append) {
      setCodeAccess(page.codeAccess);
      setTotals(page.totals);
    }
    setNextBefore(page.nextBefore);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await adminSubscriptions();
    if (!aliveRef.current) return;
    if (res.ok) {
      apply(res.data, false);
      setLoaded(true);
    } else {
      setError(res.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    load();
    return () => {
      aliveRef.current = false;
    };
  }, [load]);

  const loadMore = async () => {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    const res = await adminSubscriptions(nextBefore);
    if (!aliveRef.current) return;
    if (res.ok) apply(res.data, true);
    else setMoreError(res.message);
    setLoadingMore(false);
  };

  const rows = useMemo(() => buildSubRows(subs, codeAccess), [subs, codeAccess]);
  const visible = useMemo(() => filterSubRows(rows, filter), [rows, filter]);
  const counts = filterCounts(totals, codeAccess.length);

  return (
    <section className="cab-mod" aria-labelledby="adm-sus-titulo">
      <div className="grid gap-1">
        <span className="cab-label">Cobros</span>
        <h2 id="adm-sus-titulo">Suscripciones</h2>
      </div>

      {loading && !loaded && (
        <p className="cab-hint" role="status">
          Leyendo las suscripciones.
        </p>
      )}

      {error && !loaded && (
        <div className="grid gap-3">
          <p className="cab-error" role="alert">
            {error}
          </p>
          <div>
            <button type="button" className="cab-btn2" onClick={load} disabled={loading}>
              {loading ? 'Leyendo' : 'Reintentar'}
            </button>
          </div>
        </div>
      )}

      {loaded && (
        <>
          <div className="adm-tot" role="group" aria-label="Filtrar por estado">
            {SUB_FILTERS.map((entry) => (
              <button key={entry.id} type="button" aria-pressed={filter === entry.id} onClick={() => setFilter(entry.id)}>
                <b>{counts[entry.id]}</b>
                <span>{entry.label}</span>
              </button>
            ))}
          </div>

          {rows.length === 0 ? (
            <p className="cab-note adm-empty">
              Todavía nadie se ha suscrito ni tiene un plan por código. Cuando pase, aparecerá aquí.
            </p>
          ) : (
            <div className="adm-table adm-sub-table" role="region" aria-label="Tabla de suscripciones, con desplazamiento" tabIndex={0}>
              <table aria-label="Suscripciones y planes por código">
                <thead>
                  <tr>
                    <th scope="col">Streamer</th>
                    <th scope="col">Plan</th>
                    <th scope="col">Origen</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Último pago</th>
                    <th scope="col">Activo hasta</th>
                  </tr>
                </thead>
                <tbody key={filter}>
                  {visible.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="cab-hint adm-empty">
                        Nadie en este estado todavía.
                      </td>
                    </tr>
                  ) : (
                    visible.map((row) => {
                      const state = SUB_STATUS_LABEL[row.status];
                      return (
                        <tr key={row.key}>
                          <td>
                            <b>{row.name}</b>
                            {row.login && row.login.toLowerCase() !== row.name.toLowerCase() && (
                              <small className="cab-hint block">{row.login}</small>
                            )}
                          </td>
                          <td>{row.planName}</td>
                          <td>
                            <span className="adm-origen">{row.origin}</span>
                          </td>
                          <td>
                            <span className="cab-chip" data-status={TONE_STATUS[state.tone]} data-tone={state.tone === 'code' ? 'code' : undefined}>
                              {state.label}
                            </span>
                          </td>
                          <td>{day(row.lastPaymentAt)}</td>
                          <td>{day(row.until)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {moreError && (
            <p className="cab-error" role="alert">
              {moreError}
            </p>
          )}
          {error && (
            <p className="cab-error" role="alert">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {nextBefore && (
              <button type="button" className="cab-btn2" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Cargando' : 'Cargar más'}
              </button>
            )}
            <button type="button" className="cab-btn2" onClick={load} disabled={loading}>
              {loading ? 'Actualizando' : 'Actualizar'}
            </button>
          </div>
          <p className="cab-hint">
            Los streamers con plan por código aparecen con origen «Código» y su fecha de vencimiento. Cuando un streamer se suscribe con PayPal, el pago
            manda sobre el código. Los contadores cuentan todas las suscripciones; la tabla muestra las que ya cargaste.
          </p>
        </>
      )}
    </section>
  );
};
