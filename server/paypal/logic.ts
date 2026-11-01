/**
 * server/paypal/logic.ts
 *
 * Reglas de cobro: funciones PURAS (sin red ni base de datos), fáciles de probar.
 *
 *   - addMonths: suma meses de calendario respetando el fin de mes (31 ene + 1 mes = 28/29 feb).
 *   - paidUntilAfterPayment: cada pago suma el periodo desde hoy, o desde el vencimiento si aún hay plan.
 *   - transitionFor: qué evento de PayPal cambia qué en la suscripción.
 *   - hasAccess: acceso al plan de pago (solo con pago confirmado y hasta paid_until).
 *   - savingPercent: ahorro de un periodo largo frente a pagar mes a mes.
 */

export const PERIODS = [1, 3, 6, 12] as const;
export type Period = (typeof PERIODS)[number];

export type SubStatus = 'pending' | 'active' | 'grace' | 'cancelled' | 'suspended' | 'expired';

export const isPeriod = (value: unknown): value is Period => typeof value === 'number' && (PERIODS as readonly number[]).includes(value);

/** Suma meses de calendario en UTC. Si el día no existe en el mes destino, se queda en el último día de ese mes. */
export function addMonths(date: Date, months: number): Date {
  const out = new Date(date.getTime());
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, last));
  return out;
}

/** Nuevo «activo hasta» tras un pago: parte de paid_until si es futuro; si no, de ahora. */
export function paidUntilAfterPayment(paidUntil: Date | null, months: number, now: Date): Date {
  const base = paidUntil && paidUntil.getTime() > now.getTime() ? paidUntil : now;
  return addMonths(base, months);
}

/** Porcentaje de ahorro de pagar `months` de una vez frente a pagar el mes suelto. 0 si no hay base o no ahorra. */
export function savingPercent(monthlyPrice: number | null | undefined, price: number | null | undefined, months: number): number {
  if (!monthlyPrice || !price || months <= 1) return 0;
  return Math.max(0, Math.round((1 - price / (monthlyPrice * months)) * 100));
}

export type BillingTransition =
  | { kind: 'activated'; subscriptionId: string }
  | { kind: 'payment'; subscriptionId: string }
  | { kind: 'failed'; subscriptionId: string }
  | { kind: 'cancelled'; subscriptionId: string }
  | { kind: 'suspended'; subscriptionId: string }
  | { kind: 'expired'; subscriptionId: string }
  | { kind: 'ignore'; subscriptionId: null };

const IGNORE: BillingTransition = { kind: 'ignore', subscriptionId: null };

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Interpreta un evento de PayPal. Un pago solo cuenta con state «completed» y el id de la suscripción en billing_agreement_id. */
export function transitionFor(eventType: string, resource: unknown): BillingTransition {
  const res = (resource && typeof resource === 'object' ? resource : {}) as Record<string, unknown>;
  switch (eventType) {
    case 'PAYMENT.SALE.COMPLETED': {
      const id = text(res.billing_agreement_id);
      return id && text(res.state).toLowerCase() === 'completed' ? { kind: 'payment', subscriptionId: id } : IGNORE;
    }
    case 'BILLING.SUBSCRIPTION.ACTIVATED':
    case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED':
    case 'BILLING.SUBSCRIPTION.CANCELLED':
    case 'BILLING.SUBSCRIPTION.SUSPENDED':
    case 'BILLING.SUBSCRIPTION.EXPIRED': {
      // En los eventos de suscripción el recurso es la propia suscripción
      const id = text(res.id);
      if (!id) return IGNORE;
      const kind = {
        'BILLING.SUBSCRIPTION.ACTIVATED': 'activated',
        'BILLING.SUBSCRIPTION.PAYMENT.FAILED': 'failed',
        'BILLING.SUBSCRIPTION.CANCELLED': 'cancelled',
        'BILLING.SUBSCRIPTION.SUSPENDED': 'suspended',
        'BILLING.SUBSCRIPTION.EXPIRED': 'expired',
      }[eventType] as 'activated' | 'failed' | 'cancelled' | 'suspended' | 'expired';
      return { kind, subscriptionId: id };
    }
    default:
      return IGNORE;
  }
}

export interface SubState {
  status: SubStatus;
  months: number;
  paidUntil: Date | null;
  lastPaymentAt: Date | null;
}

export interface AppliedTransition extends SubState {
  /** True solo cuando hay que dar el plan al perfil (pago confirmado). */
  grantPlan: boolean;
}

/**
 * Aplica una transición a la suscripción. Reglas:
 *   - activated: no abre acceso. Si el pago ya llegó antes (el orden no está garantizado), no degrada el estado.
 *   - payment: suma el periodo y deja la suscripción activa (una cancelada sigue cancelada: no se renueva, pero lo pagado cuenta).
 *   - failed: «grace» si ya hubo pago; conserva el acceso hasta paid_until. Una cancelada o expirada no vuelve a grace.
 *   - cancelled / suspended / expired: cambian el estado; el acceso depende de paid_until.
 */
export function applyTransition(sub: SubState, transition: BillingTransition, now: Date): AppliedTransition {
  switch (transition.kind) {
    case 'payment': {
      const paidUntil = paidUntilAfterPayment(sub.paidUntil, sub.months, now);
      const status: SubStatus = sub.status === 'cancelled' ? 'cancelled' : 'active';
      return { ...sub, status, paidUntil, lastPaymentAt: now, grantPlan: true };
    }
    case 'activated':
      return { ...sub, status: sub.status, grantPlan: false };
    case 'failed':
      return { ...sub, status: ['cancelled', 'expired', 'suspended'].includes(sub.status) ? sub.status : sub.paidUntil ? 'grace' : sub.status, grantPlan: false };
    case 'cancelled':
      return { ...sub, status: 'cancelled', grantPlan: false };
    case 'suspended':
      return { ...sub, status: 'suspended', grantPlan: false };
    case 'expired':
      return { ...sub, status: 'expired', grantPlan: false };
    default:
      return { ...sub, grantPlan: false };
  }
}

/** Acceso al plan de pago: hay pago confirmado (paid_until) que aún no venció, y la suscripción no está pendiente. */
export function hasAccess(sub: { status: SubStatus; paidUntil: Date | null } | null, now: Date): boolean {
  if (!sub || sub.status === 'pending' || !sub.paidUntil) return false;
  return sub.paidUntil.getTime() > now.getTime();
}
