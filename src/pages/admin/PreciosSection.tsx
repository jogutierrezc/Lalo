/**
 * src/pages/admin/PreciosSection.tsx
 *
 * Planes y precios: cuánto cuesta cada plan por 1, 3, 6 y 12 meses, qué
 * periodos se ofrecen y la sincronización con PayPal. Cada celda se guarda sola
 * al salir del campo; el servidor devuelve siempre la tabla completa.
 *
 * Un precio ya sincronizado no se edita en PayPal: se crea uno nuevo y el
 * anterior se archiva, así quien ya está suscrito conserva su tarifa.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { adminPrices, adminSavePrice, adminSync } from '../../lib/billingApi';
import { formatMoney, monthlyPrice, periodKey, periodLabel, savingsPercent } from '../../lib/billingLogic';
import { BILLING_PERIODS, type AdminPlan, type AdminPrices, type PriceMap } from '../../lib/billingTypes';
import '../../styles/billing.css';

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

export const PreciosSection: React.FC = () => {
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

  const load = useCallback(async () => {
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
    load();
  }, [load]);

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
      load();
    }
  };

  const state: SyncState = syncing ? 'creando' : table?.synced ? 'listo' : 'sin';
  const chipText = state === 'listo' ? 'Sincronizado con PayPal' : state === 'creando' ? 'Creando planes en PayPal…' : 'Cambios sin enviar a PayPal';

  return (
    <section className="cab-mod bil-admin" aria-labelledby="precios-titulo">
      <div className="bil-admin-top">
        <h2 id="precios-titulo">Planes y precios</h2>
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

      {table && table.plans.length === 0 && <p className="cab-note">Todavía no hay planes. Se crean en «Límites».</p>}

      {table && table.plans.length > 0 && (
        <div className="bil-tabla-wrap">
          <table className="bil-tabla">
            <thead>
              <tr>
                <th scope="col">Plan</th>
                {BILLING_PERIODS.map((m) => (
                  <th scope="col" key={m}>
                    {periodLabel(m)} · USD
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.plans.map((plan) => (
                <tr key={plan.id}>
                  <th scope="row" className="bil-plan-nombre">
                    {plan.name}
                  </th>
                  {BILLING_PERIODS.map((m) => (
                    <PriceCell key={m} plan={plan} months={m} feedback={feedback[cellKey(plan.id, m)]} onSave={saveCell} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="cab-hint">Los precios se guardan al salir de cada campo. Un periodo oculto no aparece en la ventana de pago.</p>
    </section>
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
    <td>
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
    </td>
  );
};
