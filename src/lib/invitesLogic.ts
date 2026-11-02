/**
 * src/lib/invitesLogic.ts
 *
 * Lógica pura de las invitaciones con plan temporal, los planes nuevos y la
 * tabla de suscripciones del administrador. Sin red ni React, para poder probarla.
 */

import type { AdminSubscription, CodeAccess, SubscriptionStatus, SubscriptionTotals } from './billingTypes';

// ---------- Meses de plan de un código ----------

export const MONTH_PRESETS = [1, 3, 6, 12] as const;
export const DEFAULT_CODE_MONTHS = 3;
export const MAX_CODE_MONTHS = 36;

/** «1 mes», «3 meses». */
export function monthsText(months: number): string {
  return months === 1 ? '1 mes' : `${months} meses`;
}

/** Lleva un valor escrito a un entero de 1 a 36; null si no se puede leer. */
export function parseCodeMonths(raw: string | number): number | null {
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim().replace(',', '.'));
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(MAX_CODE_MONTHS, Math.round(n));
}

/** Lo que dice la lista de códigos: «Plan Pro · 3 meses» o «Plan Pro · sin vencimiento». */
export function codePlanLabel(planName: string, planMonths: number | null | undefined): string {
  return `Plan ${planName} · ${planMonths ? monthsText(planMonths) : 'sin vencimiento'}`;
}

/** La frase que resume lo que va a dar el código. */
export function codeSummary(planName: string, months: number, uses: number): string {
  const who = uses === 1 ? 'Una persona recibe' : `${uses} personas reciben`;
  return `${who} Plan ${planName} por ${monthsText(months)} sin costo.`;
}

/** Texto del código ya comprobado en la pantalla de acceso. */
export function validCodePlanText(planName: string | null, planMonths: number | null | undefined): string {
  const name = planName || 'Tu plan';
  return planMonths ? `${monthsText(planMonths)} de ${name}` : name;
}

const RPC_MESSAGES: Record<string, string> = {
  invalid_plan_months: 'Los meses del plan deben estar entre 1 y 36.',
  plan_not_found: 'Ese plan ya no existe. Recarga la página y elige otro.',
  plan_archived: 'Ese plan está archivado. Elige un plan activo o restáuralo en Límites.',
  not_admin: 'Esta acción es solo para administradores. Vuelve a entrar con tu cuenta de administración.',
  plan_exists: 'Ya existe un plan con ese identificador. Cambia el nombre o edita el identificador.',
  invalid_plan_id: 'El identificador solo admite minúsculas, números y guiones (hasta 40).',
  invalid_plan_name: 'El nombre debe tener entre 1 y 40 caracteres.',
  invalid_plan_limits: 'Los límites deben ser números enteros de 0 o más.',
  cannot_archive_default: 'El plan por defecto no se puede archivar.',
};

/** Convierte el error de una función de la nube en un mensaje claro. */
export function rpcErrorMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const key = Object.keys(RPC_MESSAGES).find((code) => raw.includes(code));
  if (key) return RPC_MESSAGES[key];
  return raw ? `${fallback} (${raw})` : fallback;
}

// ---------- Planes ----------

/** Planes que se pueden regalar por código: los archivados no salen. */
export function activePlans<T extends { archived?: boolean }>(plans: T[]): T[] {
  return plans.filter((plan) => !plan.archived);
}

/** Plan del atajo «Plan gratis de 3 meses»: el primero de pago (no por defecto) visible, o el primero visible. */
export function quickPlan<T extends { id: string; archived?: boolean; is_default?: boolean }>(plans: T[]): T | null {
  const visible = activePlans(plans);
  return visible.find((plan) => !plan.is_default) ?? visible[0] ?? null;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

export type SizeUnit = 'MB' | 'GB';

/** Cantidad y unidad a bytes. */
export function toBytes(amount: number, unit: SizeUnit): number {
  return Math.round(amount * (unit === 'GB' ? GB : MB));
}

// ---------- Suscripciones del administrador ----------

export type SubFilter = 'all' | 'active' | 'code' | 'grace' | 'cancelled' | 'expired';
export const SUB_FILTERS: { id: SubFilter; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'active', label: 'Activas' },
  { id: 'code', label: 'Por código' },
  { id: 'grace', label: 'Cobro fallido' },
  { id: 'cancelled', label: 'Canceladas' },
  { id: 'expired', label: 'Vencidas' },
];

export type SubTone = 'ok' | 'warn' | 'bad' | 'code';

export const SUB_STATUS_LABEL: Record<SubscriptionStatus | 'code', { label: string; tone: SubTone }> = {
  active: { label: 'Activa', tone: 'ok' },
  grace: { label: 'Cobro fallido', tone: 'warn' },
  cancelled: { label: 'Cancelada', tone: 'warn' },
  suspended: { label: 'Suspendida', tone: 'bad' },
  expired: { label: 'Vencida', tone: 'bad' },
  pending: { label: 'Falta el pago', tone: 'warn' },
  code: { label: 'Por código', tone: 'code' },
};

export interface SubRow {
  key: string;
  name: string;
  login: string | null;
  planName: string;
  origin: string;
  status: SubscriptionStatus | 'code';
  lastPaymentAt: string | null;
  until: string | null;
}

const displayOf = (row: { displayName: string | null; twitchLogin: string | null }) => row.displayName || row.twitchLogin || 'Sin nombre';

export function subscriptionRow(sub: AdminSubscription): SubRow {
  return {
    key: `sub:${sub.id}`,
    name: displayOf(sub),
    login: sub.twitchLogin,
    planName: sub.planName,
    origin: `PayPal ${monthsText(sub.months)}`,
    status: sub.status,
    lastPaymentAt: sub.lastPaymentAt,
    until: sub.paidUntil,
  };
}

export function codeAccessRow(access: CodeAccess): SubRow {
  return {
    key: `code:${access.profileId}`,
    name: displayOf(access),
    login: access.twitchLogin,
    planName: access.planName,
    origin: access.inviteCode ? `Código ${access.inviteCode}` : 'Código',
    status: 'code',
    lastPaymentAt: null,
    until: access.expiresAt,
  };
}

/** Une los accesos por código (solo en la primera página) con las suscripciones. */
export function buildSubRows(subscriptions: AdminSubscription[], codeAccess: CodeAccess[]): SubRow[] {
  return [...codeAccess.map(codeAccessRow), ...subscriptions.map(subscriptionRow)];
}

export function filterSubRows(rows: SubRow[], filter: SubFilter): SubRow[] {
  return filter === 'all' ? rows : rows.filter((row) => row.status === filter);
}

/** Contadores de los filtros. Los de PayPal vienen del servidor (todas las páginas); «Por código» cuenta los accesos. */
export function filterCounts(totals: SubscriptionTotals, codeCount: number): Record<SubFilter, number> {
  const paypal = totals.active + totals.grace + totals.cancelled + totals.suspended + totals.expired + totals.pending;
  return {
    all: paypal + codeCount,
    active: totals.active,
    code: codeCount,
    grace: totals.grace,
    cancelled: totals.cancelled,
    expired: totals.expired,
  };
}

// ---------- Botones de PayPal (SDK de JavaScript) ----------

export const PAYPAL_SDK_ORIGIN = 'https://www.paypal.com/sdk/js';

/** Dirección del SDK de botones, con los parámetros escapados. null si no hay un identificador de cliente válido. */
export function buildPaypalSdkUrl(clientId: string | null | undefined): string | null {
  const id = (clientId ?? '').trim();
  // Los identificadores de PayPal son letras, números, guiones y guiones bajos
  if (!id || !/^[A-Za-z0-9_-]{8,200}$/.test(id)) return null;
  const params = new URLSearchParams({
    'client-id': id,
    vault: 'true',
    intent: 'subscription',
    components: 'buttons',
    'enable-funding': 'card',
    currency: 'USD',
  });
  return `${PAYPAL_SDK_ORIGIN}?${params.toString()}`;
}

/** Estilo de los botones de PayPal. */
export const PAYPAL_BUTTON_STYLE = { layout: 'vertical', shape: 'rect', color: 'gold', label: 'subscribe', height: 48 } as const;
