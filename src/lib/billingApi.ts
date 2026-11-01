/**
 * src/lib/billingApi.ts
 *
 * Llamadas del navegador a las rutas de cobro del servidor (/api/paypal/*).
 * Van con la sesión de Supabase (mismo patrón que luxApi y storageApi). El
 * precio, el estado y el acceso los decide el servidor: aquí solo se piden y
 * se leen con cuidado, sin fiarse de que el JSON venga completo.
 *
 * SIN PROBAR contra el servidor real: se desarrolló contra el contrato.
 */

import { call, type ApiOutcome } from './integrationsApi';
import type {
  AdminPlan,
  AdminPriceCell,
  AdminPrices,
  BillingCatalog,
  BillingStatus,
  BillingSubscription,
  PeriodKey,
  PriceMap,
  SubscribeResult,
  SubscriptionStatus,
} from './billingTypes';

const KEYS: PeriodKey[] = ['1', '3', '6', '12'];
const STATUSES: SubscriptionStatus[] = ['pending', 'active', 'grace', 'cancelled', 'suspended', 'expired'];
const BAD_ANSWER = 'El servidor respondió algo que no se entiende. Prueba otra vez en un momento.';

const asObject = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});
const asText = (value: unknown): string => (typeof value === 'string' ? value : '');
const asDate = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);
const asPrice = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);
const bad = <T>(): ApiOutcome<T> => ({ ok: false, code: 'bad_response', message: BAD_ANSWER, missing: [] });

function parsePrices(value: unknown): PriceMap {
  const raw = asObject(value);
  return { '1': asPrice(raw['1']), '3': asPrice(raw['3']), '6': asPrice(raw['6']), '12': asPrice(raw['12']) };
}

export function parseCatalog(data: Record<string, unknown>): BillingCatalog {
  const plans = Array.isArray(data.plans) ? data.plans : [];
  return {
    enabled: data.enabled === true,
    env: data.env === 'live' ? 'live' : 'sandbox',
    plans: plans
      .map(asObject)
      .filter((plan) => asText(plan.id))
      .map((plan) => ({ id: asText(plan.id), name: asText(plan.name) || asText(plan.id), prices: parsePrices(plan.prices) })),
  };
}

export function parseStatus(data: Record<string, unknown>): BillingStatus {
  const raw = data.subscription;
  let subscription: BillingSubscription | null = null;
  if (raw && typeof raw === 'object') {
    const sub = raw as Record<string, unknown>;
    subscription = {
      status: STATUSES.includes(sub.status as SubscriptionStatus) ? (sub.status as SubscriptionStatus) : 'expired',
      planId: asText(sub.planId),
      planName: asText(sub.planName) || asText(sub.planId),
      months: typeof sub.months === 'number' ? sub.months : 1,
      paidUntil: asDate(sub.paidUntil),
      lastPaymentAt: asDate(sub.lastPaymentAt),
      startedAt: asDate(sub.startedAt),
    };
  }
  // El acceso solo es cierto si el servidor lo dice con un true
  return { subscription, hasAccess: data.hasAccess === true };
}

export function parseAdminPrices(data: Record<string, unknown>): AdminPrices {
  const plans = Array.isArray(data.plans) ? data.plans : [];
  return {
    synced: data.synced === true,
    plans: plans
      .map(asObject)
      .filter((plan) => asText(plan.id))
      .map((plan): AdminPlan => {
        const raw = asObject(plan.prices);
        const prices = {} as Record<PeriodKey, AdminPriceCell>;
        for (const key of KEYS) {
          const cell = asObject(raw[key]);
          prices[key] = {
            priceUsd: asPrice(cell.priceUsd),
            active: cell.active === true,
            paypalPlanId: asText(cell.paypalPlanId) || null,
          };
        }
        return { id: asText(plan.id), name: asText(plan.name) || asText(plan.id), prices };
      }),
  };
}

async function read<T>(path: string, method: 'GET' | 'POST', parse: (data: Record<string, unknown>) => T, body?: Record<string, unknown>): Promise<ApiOutcome<T>> {
  const res = await call(path, method, body);
  if (!res.ok) return res;
  try {
    return { ok: true, data: parse(res.data) };
  } catch {
    return bad<T>();
  }
}

// ---------- Streamer ----------

export const billingCatalog = () => read('/api/paypal/catalog', 'GET', parseCatalog);

export async function billingSubscribe(planId: string, months: number): Promise<ApiOutcome<SubscribeResult>> {
  const res = await call('/api/paypal/subscribe', 'POST', { planId, months });
  if (!res.ok) return res;
  const approveUrl = asText(res.data.approveUrl);
  const subscriptionId = asText(res.data.subscriptionId);
  if (!approveUrl) return bad<SubscribeResult>();
  return { ok: true, data: { approveUrl, subscriptionId } };
}

export const billingConfirm = (subscriptionId: string) => read('/api/paypal/confirm', 'POST', parseStatus, { subscriptionId });
export const billingStatus = () => read('/api/paypal/status', 'GET', parseStatus);
export const billingCancel = () => read('/api/paypal/cancel', 'POST', parseStatus);

// ---------- Administrador ----------

export const adminPrices = () => read('/api/paypal/admin-prices', 'GET', parseAdminPrices);

export const adminSavePrice = (planId: string, months: number, priceUsd: number | null, active: boolean) =>
  read('/api/paypal/admin-prices', 'POST', parseAdminPrices, { planId, months, priceUsd, active });

export const adminSync = () => read('/api/paypal/admin-sync', 'POST', parseAdminPrices);
