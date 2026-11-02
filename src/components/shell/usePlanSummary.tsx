/**
 * src/components/shell/usePlanSummary.tsx
 *
 * Resumen del plan del creador (días restantes, estado, origen) para todo el
 * cascarón. Lee el estado de la suscripción y el catálogo del servidor (solo
 * lectura) y lo combina con el perfil mediante summarizePlan. Sin nube o sin
 * cuenta activa, el plan es el gratis.
 */

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useCloudSession } from '../../hooks/useCloudSession';
import { fetchPlans } from '../../lib/cloud';
import { billingCatalog, billingStatus } from '../../lib/billingApi';
import type { BillingCatalog, BillingStatus } from '../../lib/billingTypes';
import { summarizePlan, type PlanSummary } from '../../lib/planDays';
import { usePayments, type PaymentsResult } from '../../lib/usePayments';

const FREE: PlanSummary = summarizePlan({ profile: null });
const PlanContext = createContext<PlanSummary>(FREE);

export const usePlanSummary = (): PlanSummary => useContext(PlanContext);

const NO_PAYMENTS: PaymentsResult = { rows: [], nextCharge: null, state: 'vacio', error: null, reload: () => {} };
const PaymentsContext = createContext<PaymentsResult>(NO_PAYMENTS);

/** Historial de pagos compartido (lo lee PlanProvider una sola vez). */
export const usePaymentsData = (): PaymentsResult => useContext(PaymentsContext);

export const PlanProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const cloud = useCloudSession();
  const profile = cloud.profile;
  const active = cloud.enabled && profile?.status === 'active';
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
  const [planName, setPlanName] = useState<string | null>(null);
  const profileId = profile?.id ?? null;
  const planId = profile?.plan_id ?? null;
  const expires = profile?.plan_expires_at ?? null;

  useEffect(() => {
    if (!active) {
      setStatus(null);
      return;
    }
    let alive = true;
    Promise.all([billingStatus(), billingCatalog()])
      .then(([st, cat]) => {
        if (!alive) return;
        setStatus(st.ok ? st.data : null);
        setCatalog(cat.ok ? cat.data : null);
      })
      .catch(() => {});
    fetchPlans()
      .then((rows) => {
        if (alive) setPlanName(rows.find((p) => p.id === planId)?.name ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [active, profileId, planId, expires]);

  // Una sola lectura del historial para toda la ventana: alimenta la tarjeta de días y Plan y pagos.
  const payments = usePayments(active);
  const nextCharge = payments.nextCharge;

  const summary = useMemo(() => {
    if (!active || !profile) return FREE;
    const subscription = status?.subscription ?? null;
    const price = subscription ? catalog?.plans.find((p) => p.id === subscription.planId)?.prices[String(subscription.months) as '1'] : null;
    return summarizePlan({
      profile,
      planName,
      subscription,
      priceUsd: price ?? null,
      nextCharge: nextCharge ? { date: nextCharge.date, amount: nextCharge.amount } : null,
    });
  }, [active, profile, status, catalog, planName, nextCharge]);

  return (
    <PlanContext.Provider value={summary}>
      <PaymentsContext.Provider value={payments}>{children}</PaymentsContext.Provider>
    </PlanContext.Provider>
  );
};
