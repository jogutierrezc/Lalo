/**
 * src/pages/admin/PlanesSection.tsx
 *
 * Planes y precios en una sola pantalla, organizada por plan: en la tarjeta de
 * cada plan van sus límites (espacio, archivos, créditos de Mi AI, modelos 3D)
 * y, debajo, su precio por 1, 3, 6 y 12 meses. Arriba, la sincronización con
 * PayPal; abajo, «Crear plan nuevo» y la capacidad total del almacenamiento.
 *
 * Junta lo que antes eran «Límites» y «Planes y precios». Los límites se
 * guardan al salir de cada campo y afectan a todas las cuentas con ese plan.
 * Cada precio se guarda solo al salir del campo; el servidor devuelve siempre
 * la tabla completa. Un precio ya sincronizado no se edita en PayPal: se crea
 * uno nuevo y el anterior se archiva, así quien ya está suscrito conserva su tarifa.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { accountsThatFit, adminHref, capacitySplit, storageHealth } from '../../lib/adminLogic';
import { adminPrices, adminSavePrice, adminSync } from '../../lib/billingApi';
import { formatMoney, monthlyPrice, periodKey, periodLabel, savingsPercent } from '../../lib/billingLogic';
import { BILLING_PERIODS, type AdminPlan, type AdminPrices, type PriceMap } from '../../lib/billingTypes';
import { MB, archivePlan, formatBytes, rpc, updatePlan } from '../../lib/cloud';
import { rpcErrorMessage } from '../../lib/invitesLogic';
import { NuevoPlanForm } from './NuevoPlanForm';
import type { PlanRow } from '../../lib/cloudTypes';
import type { AdminData } from './useAdminData';
import '../../styles/billing.css';
import '../../styles/admin-tally.css';

const GB = 1024 * MB;

type SyncState = 'sin' | 'creando' | 'listo';
type CellFeedback = { kind: 'saving' | 'saved' | 'error'; text: string };

const cellKey = (planId: string, months: number) => `${planId}:${months}`;

function priceMap(plan: AdminPlan): PriceMap {
  return {
    '1': plan.prices['1'].priceUsd,
    '3': plan.prices['3'].priceUsd,
    '6': plan.prices['6'].priceUsd,
    '12': plan.prices['12'].priceUsd,
  };
}

export const PlanesSection: React.FC<{ data: AdminData }> = ({ data }) => {
  const { overview, plans, setPlans, storage, reload, reloadStorage, setError } = data;
  const [notice, setNotice] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [planProblem, setPlanProblem] = useState<string | null>(null);

  // Precios y sincronización con PayPal
  const [table, setTable] = useState<AdminPrices | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [feedback, setFeedback] = useState<Record<string, CellFeedback | undefined>>({});
  const [pending, setPending] = useState(0);
  // Los guardados van de uno en uno para que la tabla que vuelve sea siempre la última
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const loadPrices = useCallback(async () => {
    const res = await adminPrices();
    if (!aliveRef.current) return;
    if (res.ok) {
      setTable(res.data);
      setLoadError(null);
    } else {
      setLoadError(res.message);
    }
  }, []);

  useEffect(() => {
    loadPrices();
  }, [loadPrices]);

  if (!overview) return null;

  const health = storageHealth(storage);
  const known = storage !== null && health !== 'missing';
  const split = known ? capacitySplit(storage.capacityBytes, overview.totals.storage_bytes, overview.totals.storage_committed_bytes) : null;

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

  const toggleArchived = async (plan: PlanRow) => {
    if (plan.is_default || archiving) return;
    const next = !plan.archived;
    setArchiving(plan.id);
    setPlanProblem(null);
    try {
      await archivePlan(plan.id, next);
      setNotice(next ? `Plan ${plan.name} archivado. Quien ya lo tiene lo conserva.` : `Plan ${plan.name} restaurado.`);
      await reload();
      loadPrices();
    } catch (err) {
      setPlanProblem(rpcErrorMessage(err, next ? 'No se pudo archivar el plan.' : 'No se pudo restaurar el plan.'));
    }
    setArchiving(null);
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

  const saveCell = (plan: AdminPlan, months: number, priceUsd: number | null, active: boolean) => {
    const key = cellKey(plan.id, months);
    setFeedback((prev) => ({ ...prev, [key]: { kind: 'saving', text: 'Guardando…' } }));
    setPending((n) => n + 1);
    setSyncNote(null);
    queueRef.current = queueRef.current.then(async () => {
      const res = await adminSavePrice(plan.id, months, priceUsd, active);
      if (!aliveRef.current) return;
      setPending((n) => n - 1);
      if (res.ok) {
        setTable(res.data);
        setFeedback((prev) => ({ ...prev, [key]: { kind: 'saved', text: 'Guardado' } }));
        window.setTimeout(() => {
          if (aliveRef.current) setFeedback((prev) => (prev[key]?.kind === 'saved' ? { ...prev, [key]: undefined } : prev));
        }, 2200);
      } else {
        setFeedback((prev) => ({ ...prev, [key]: { kind: 'error', text: res.message } }));
      }
    });
  };

  const sync = async () => {
    setSyncing(true);
    setSyncNote(null);
    const res = await adminSync();
    if (!aliveRef.current) return;
    setSyncing(false);
    if (res.ok) {
      setTable(res.data);
      setSyncNote({ ok: true, text: 'Planes creados en PayPal. Ya se pueden contratar.' });
    } else {
      setSyncNote({ ok: false, text: res.message });
      // Si la respuesta tardó, PayPal puede haber creado algo: se vuelve a leer la tabla
      loadPrices();
    }
  };

  const state: SyncState = syncing ? 'creando' : table?.synced ? 'listo' : 'sin';
  const chipText = state === 'listo' ? 'Sincronizado con PayPal' : state === 'creando' ? 'Creando planes en PayPal…' : 'Cambios sin enviar a PayPal';
  const priced = (planId: string) => table?.plans.find((entry) => entry.id === planId);

  return (
    <div className="atl-page">
      <section className="cab-mod" aria-label="Sincronización con PayPal">
        <div className="bil-admin-top">
          <h2>Cobro con PayPal</h2>
          <div className="bil-acciones">
            <span className="bil-chip" data-tone={state === 'listo' ? 'ok' : state === 'creando' ? 'warn' : 'neutral'} role="status">
              {table ? chipText : 'Leyendo precios'}
            </span>
            <button type="button" className="cab-btn" onClick={sync} disabled={syncing || pending > 0 || !table}>
              {syncing ? 'Sincronizando' : 'Sincronizar con PayPal'}
            </button>
          </div>
        </div>
        <p className="cab-hint">
          Define cuánto cuesta cada plan para 1, 3, 6 y 12 meses. Al sincronizar, Lalo crea en PayPal un plan de facturación por cada precio activo y guarda su
          identificador. Un precio ya sincronizado no se edita: se crea uno nuevo y el anterior se archiva, así quien ya está suscrito conserva su tarifa.
        </p>
        {loadError && (
          <p className="cab-error" role="alert">
            {loadError}
          </p>
        )}
        {syncNote && (
          <p className={syncNote.ok ? 'cab-note adm-note-ok' : 'cab-error'} role={syncNote.ok ? 'status' : 'alert'}>
            {syncNote.text}
          </p>
        )}
      </section>

      {notice && (
        <p className="cab-hint" role="status">
          {notice}
        </p>
      )}

      {planProblem && (
        <p className="cab-error" role="alert">
          {planProblem}
        </p>
      )}

      {plans.length === 0 && <p className="cab-note">Todavía no hay planes. Se crean más abajo, en «Crear plan nuevo».</p>}

      <div className="adm-grid2">
        {plans.map((plan) => {
          const pricedPlan = priced(plan.id);
          return (
            <section key={plan.id} className="cab-mod" aria-label={`Plan ${plan.name}`}>
              <div className="adm-plan-head">
                <h2>{plan.name}</h2>
                {plan.archived && (
                  <span className="cab-chip" data-status="skipped">
                    Archivado
                  </span>
                )}
              </div>

              <h3 className="atl-sub-h">Límites</h3>
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
              <PlanNumber
                label="Créditos de Mi AI al mes"
                min={0}
                value={plan.lux_monthly_credits ?? 0}
                onCommit={(value) => savePlan(plan, { lux_monthly_credits: value })}
              />
              <PlanNumber
                label="Modelos 3D propios de Mi AI"
                min={0}
                value={plan.lux_max_models ?? 0}
                onCommit={(value) => savePlan(plan, { lux_max_models: value })}
              />
              <p className="cab-hint">Cuántos modelos 3D puede subir cada creador con su propia cuenta. Cero: ninguno. Los de la biblioteca compartida no cuentan.</p>
              <p className="cab-hint">
                Mi AI cuenta los créditos de cada respuesta con un modelo de pago. Si la cuenta llega al tope, sus personajes usan el modelo por defecto hasta el mes
                siguiente. Cero: sin modelos de pago.
              </p>

              <h3 className="atl-sub-h">Precio por periodo</h3>
              {pricedPlan ? (
                <div className="atl-periods">
                  {BILLING_PERIODS.map((m) => (
                    <PriceCell key={m} plan={pricedPlan} months={m} feedback={feedback[cellKey(plan.id, m)]} onSave={saveCell} />
                  ))}
                </div>
              ) : (
                <p className="cab-note">
                  {table ? 'Este plan aún no tiene tabla de precios. Sincroniza o vuelve a abrir la pantalla.' : loadError ? 'No se pudieron leer los precios.' : 'Leyendo precios'}
                </p>
              )}

              {!plan.is_default && (
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" className="cab-btn2" disabled={archiving !== null} onClick={() => toggleArchived(plan)}>
                    {archiving === plan.id ? 'Guardando' : plan.archived ? 'Restaurar plan' : 'Archivar plan'}
                  </button>
                  <span className="cab-hint">
                    {plan.archived ? 'No sale en el cobro ni en los códigos nuevos.' : 'Archivar lo oculta del cobro y de los códigos nuevos; quien ya lo tiene lo conserva.'}
                  </span>
                </div>
              )}
              <p className="cab-hint">
                {split
                  ? `Con el espacio que aún no has prometido (${formatBytes(split.free)}) caben ${accountsThatFit(split.free, plan.storage_limit_bytes)} cuentas ${plan.name} más.`
                  : 'Configura el almacenamiento para saber cuántas cuentas caben.'}
              </p>
            </section>
          );
        })}
      </div>
      <p className="cab-hint">
        Los límites y los precios se guardan al salir de cada campo; los límites afectan a todas las cuentas con ese plan. Un periodo oculto no aparece en la ventana de pago.
      </p>

      <NuevoPlanForm
        onCreated={async (name) => {
          setNotice(`Plan ${name} creado. Ponle precio en su tarjeta y sincronízalo con PayPal para cobrarlo.`);
          setError(null);
          await reload();
          await loadPrices();
        }}
      />

      <section className="cab-mod adm-narrow">
        <h2>Capacidad total</h2>
        {known ? (
          <>
            <PlanNumber label="Espacio del almacenamiento (GB)" value={Math.max(1, Math.round(storage.capacityBytes / GB))} onCommit={saveCapacity} />
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
    </div>
  );
};

export const PlanNumber: React.FC<{ label: string; value: number; min?: number; max?: number; onCommit: (value: number) => void }> = ({
  label,
  value,
  min = 1,
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
        min={min}
        max={max}
        className="cab-inp cab-mono w-28"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const next = Math.max(min, Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.round(Number(draft) || value)));
          setDraft(String(next));
          if (next !== value) onCommit(next);
        }}
      />
    </div>
  );
};

interface CellProps {
  plan: AdminPlan;
  months: number;
  feedback?: CellFeedback;
  onSave: (plan: AdminPlan, months: number, priceUsd: number | null, active: boolean) => void;
}

const PriceCell: React.FC<CellProps> = ({ plan, months, feedback, onSave }) => {
  const id = useId();
  const cell = plan.prices[periodKey(months)];
  const [draft, setDraft] = useState(cell.priceUsd == null ? '' : String(cell.priceUsd));
  const [active, setActive] = useState(cell.active);
  useEffect(() => setDraft(cell.priceUsd == null ? '' : String(cell.priceUsd)), [cell.priceUsd]);
  useEffect(() => setActive(cell.active), [cell.active]);

  const label = `${plan.name}, ${periodLabel(months)}`;
  const parsed = draft.trim() === '' ? null : Number(draft.replace(',', '.'));
  const invalid = parsed !== null && (!Number.isFinite(parsed) || parsed <= 0);
  const prices = priceMap(plan);
  const ahorro = active && cell.priceUsd != null ? savingsPercent(prices, months) : 0;

  const commitPrice = () => {
    if (invalid) return;
    const next = parsed === null ? null : Math.round(parsed * 100) / 100;
    if (next === cell.priceUsd) {
      setDraft(next === null ? '' : String(next));
      return;
    }
    setDraft(next === null ? '' : String(next));
    // Sin precio no se puede ofrecer: el periodo queda oculto
    const nextActive = next === null ? false : active;
    setActive(nextActive);
    onSave(plan, months, next, nextActive);
  };

  const toggle = (checked: boolean) => {
    setActive(checked);
    if (checked && cell.priceUsd == null && (parsed === null || invalid)) return; // primero hace falta un precio
    onSave(plan, months, invalid ? cell.priceUsd : parsed, checked);
  };

  const note = feedback?.text
    ? feedback.text
    : active && cell.priceUsd == null
      ? 'Escribe el precio'
      : !active
        ? 'Oculto'
        : `${formatMoney(monthlyPrice(cell.priceUsd ?? 0, months))}/mes${ahorro > 0 ? ` · −${ahorro}%` : ''}`;

  return (
    <div className="atl-period">
      <label className="atl-lbl" htmlFor={id}>
        {periodLabel(months)} · USD
      </label>
      <div className="bil-celda">
        <input
          type="checkbox"
          className="bil-check"
          checked={active}
          onChange={(e) => toggle(e.target.checked)}
          aria-label={`${label}: disponible`}
        />
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min="0.01"
          step="0.5"
          className="cab-inp cab-mono bil-precio-in"
          value={draft}
          disabled={!active}
          aria-label={`Precio de ${label} en dólares`}
          aria-invalid={invalid || undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitPrice}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </div>
      <span className="bil-sub" data-kind={feedback?.kind} role={feedback ? 'status' : undefined}>
        {invalid ? 'Escribe un número mayor que cero' : note}
      </span>
      {active && cell.paypalPlanId && <span className="bil-sub bil-pp-id">{cell.paypalPlanId}</span>}
    </div>
  );
};
