/**
 * src/pages/admin/LimitesSection.tsx
 *
 * Límites: lo que permite cada plan, cuántas cuentas más caben con el espacio
 * que queda y la capacidad total del almacenamiento.
 */

import React, { useEffect, useId, useState } from 'react';
import { accountsThatFit, adminHref, capacitySplit, storageHealth } from '../../lib/adminLogic';
import { MB, formatBytes, rpc, updatePlan } from '../../lib/cloud';
import type { PlanRow } from '../../lib/cloudTypes';
import type { AdminData } from './useAdminData';

const GB = 1024 * MB;

export const LimitesSection: React.FC<{ data: AdminData }> = ({ data }) => {
  const { overview, plans, setPlans, storage, reload, reloadStorage, setError } = data;
  const [notice, setNotice] = useState<string | null>(null);
  if (!overview) return null;

  const health = storageHealth(storage);
  const known = storage !== null && health !== 'missing';
  const split = known
    ? capacitySplit(storage.capacityBytes, overview.totals.storage_bytes, overview.totals.storage_committed_bytes)
    : null;

  const savePlan = async (plan: PlanRow, patch: Partial<PlanRow>) => {
    setPlans((prev) => prev.map((entry) => (entry.id === plan.id ? { ...entry, ...patch } : entry)));
    try {
      await updatePlan(plan.id, patch);
      setNotice(`Plan ${plan.name} guardado.`);
      setError(null);
      // Lo prometido a las cuentas cambia con el plan
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el plan.');
      reload();
    }
  };

  const saveCapacity = async (gigabytes: number) => {
    try {
      await rpc('admin_set_storage_capacity', { p_bytes: gigabytes * GB });
      setNotice(`Capacidad total guardada: ${gigabytes} GB.`);
      setError(null);
      await reloadStorage();
    } catch (err) {
      setError(
        err instanceof Error
          ? `No se pudo guardar la capacidad: ${err.message}. Puede faltar la migración 0005 en Supabase.`
          : 'No se pudo guardar la capacidad.'
      );
    }
  };

  return (
    <>
      {notice && (
        <p className="cab-hint" role="status">
          {notice}
        </p>
      )}

      <div className="adm-grid2">
        {plans.map((plan) => (
          <section key={plan.id} className="cab-mod">
            <h2>{plan.name}</h2>
            <PlanNumber
              label="Espacio total (MB)"
              value={Math.round(plan.storage_limit_bytes / MB)}
              onCommit={(value) => savePlan(plan, { storage_limit_bytes: value * MB })}
            />
            <PlanNumber
              label="Máximo por archivo (MB)"
              value={Math.round(plan.max_file_bytes / MB)}
              max={50}
              onCommit={(value) => savePlan(plan, { max_file_bytes: value * MB })}
            />
            <PlanNumber label="Número de archivos" value={plan.max_files} onCommit={(value) => savePlan(plan, { max_files: value })} />
            <p className="cab-hint">
              {split
                ? `Con el espacio que aún no has prometido (${formatBytes(split.free)}) caben ${accountsThatFit(split.free, plan.storage_limit_bytes)} cuentas ${plan.name} más.`
                : 'Configura el almacenamiento para saber cuántas cuentas caben.'}
            </p>
          </section>
        ))}
      </div>
      <p className="cab-hint">Los cambios se guardan al salir de cada campo y afectan a todas las cuentas con ese plan.</p>

      <section className="cab-mod adm-narrow">
        <h2>Capacidad total</h2>
        {known ? (
          <>
            <PlanNumber
              label="Espacio del almacenamiento (GB)"
              value={Math.max(1, Math.round(storage.capacityBytes / GB))}
              onCommit={saveCapacity}
            />
            <p className="cab-hint">
              Es el espacio que tienes contratado para los archivos de todos los streamers. Lalo lo usa para calcular
              cuánto queda libre; no cambia nada en Cloudflare. Por defecto son 10 GB, lo que incluye la capa gratuita de
              R2.
            </p>
            {split?.overcommitted && (
              <p className="cab-error" role="status">
                Has prometido más espacio del que hay: {formatBytes(overview.totals.storage_committed_bytes)} entre las
                cuentas activas, con {formatBytes(storage.capacityBytes)} de capacidad.
              </p>
            )}
          </>
        ) : (
          <p className="cab-note">
            La capacidad se podrá ajustar cuando el almacenamiento esté configurado.{' '}
            <a className="studio-link" href={adminHref('almacenamiento')}>
              Ir a Almacenamiento
            </a>
          </p>
        )}
      </section>
    </>
  );
};

export const PlanNumber: React.FC<{ label: string; value: number; max?: number; onCommit: (value: number) => void }> = ({
  label,
  value,
  max,
  onCommit,
}) => {
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <div className="flex items-center justify-between gap-4">
      <label className="cab-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={1}
        max={max}
        className="cab-inp cab-mono w-28"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const next = Math.max(1, Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.round(Number(draft) || value)));
          setDraft(String(next));
          if (next !== value) onCommit(next);
        }}
      />
    </div>
  );
};
