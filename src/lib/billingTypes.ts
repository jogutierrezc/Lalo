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
  /** PAYPAL_CLIENT_ID (público): para cargar el SDK de botones. Vacío si el cobro no está activo. */
  clientId?: string;
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
  archived: boolean;
  prices: Record<PeriodKey, AdminPriceCell>;
}

export interface AdminPrices {
  plans: AdminPlan[];
  synced: boolean;
}

export type SubscribeFlow = 'redirect' | 'sdk';

export interface SubscribeResult {
  /** Vacío en el flujo 'sdk'. */
  approveUrl: string;
  subscriptionId: string;
}

export interface AdminSubscription {
  id: string;
  profileId: string;
  twitchLogin: string | null;
  displayName: string | null;
  planId: string;
  planName: string;
  months: number;
  status: SubscriptionStatus;
  startedAt: string | null;
  paidUntil: string | null;
  lastPaymentAt: string | null;
  priceUsd: number;
}

export type SubscriptionTotals = Record<SubscriptionStatus, number>;

/** Perfil con plan por código vigente (plan_expires_at futuro y sin suscripción de pago). */
export interface CodeAccess {
  profileId: string;
  twitchLogin: string | null;
  displayName: string | null;
  planId: string;
  planName: string;
  expiresAt: string;
  inviteCode: string | null;
}

export interface AdminSubscriptions {
  subscriptions: AdminSubscription[];
  totals: SubscriptionTotals;
  /** Solo viene relleno en la primera página (sin before). */
  codeAccess: CodeAccess[];
  /** Cursor para pedir la página siguiente (before); null si no hay más. */
  nextBefore: string | null;
}
