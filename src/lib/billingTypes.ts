/**
 * src/lib/billingTypes.ts
 *
 * Tipos del cobro con PayPal: lo que devuelven las rutas /api/paypal/*.
 * El servidor es quien decide el precio, el estado y el acceso; el navegador
 * solo lo enseña.
 */

export const BILLING_PERIODS = [1, 3, 6, 12] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];

/** Precio por periodo, con la clave en texto como llega en el JSON. */
export type PeriodKey = '1' | '3' | '6' | '12';
export type PriceMap = Record<PeriodKey, number | null>;

export type SubscriptionStatus = 'pending' | 'active' | 'grace' | 'cancelled' | 'suspended' | 'expired';

export interface CatalogPlan {
  id: string;
  name: string;
  prices: PriceMap;
}

export interface BillingCatalog {
  enabled: boolean;
  env: 'sandbox' | 'live';
  plans: CatalogPlan[];
}

export interface BillingSubscription {
  status: SubscriptionStatus;
  planId: string;
  planName: string;
  months: number;
  paidUntil: string | null;
  lastPaymentAt: string | null;
  startedAt: string | null;
}

export interface BillingStatus {
  subscription: BillingSubscription | null;
  hasAccess: boolean;
}

export interface AdminPriceCell {
  priceUsd: number | null;
  active: boolean;
  paypalPlanId: string | null;
}

export interface AdminPlan {
  id: string;
  name: string;
  prices: Record<PeriodKey, AdminPriceCell>;
}

export interface AdminPrices {
  plans: AdminPlan[];
  synced: boolean;
}

export interface SubscribeResult {
  approveUrl: string;
  subscriptionId: string;
}
