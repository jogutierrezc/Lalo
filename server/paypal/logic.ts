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
  | { kind: 'payment'; subscriptionId: string; saleId: string; amount: number | null; currency: string | null }
  | { kind: 'failed'; subscriptionId: string }
  | { kind: 'cancelled'; subscriptionId: string }
  | { kind: 'suspended'; subscriptionId: string }
  | { kind: 'expired'; subscriptionId: string }
  /**
   * Reembolso (total o parcial): la venta original es saleId; la suscripción puede no venir en el aviso.
   * refundId = resource.id del reembolso ('' si el aviso no lo trae); amount ya validado (número finito >= 0).
   */
  | { kind: 'refund'; subscriptionId: string | null; saleId: string; refundId: string; amount: number; currency: string | null }
  /** Reverso o contracargo de una venta. */
  | { kind: 'reversal'; subscriptionId: string | null; saleId: string }
  /** Aviso que no cambia nada. `reason` explica por qué se descartó algo que parecía accionable (para el log). */
  | { kind: 'ignore'; subscriptionId: null; reason?: 'bad_refund_amount' };

const IGNORE: BillingTransition = { kind: 'ignore', subscriptionId: null };

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Moneda en la que se calculan totales y parciales. */
export const BILLING_CURRENCY = 'USD';

const DECIMAL = /^\d+(\.\d+)?$/;

/** Importe de un objeto `{ total }` de PayPal: solo decimal no negativo y finito; cualquier otra cosa (vacío, «abc», «-5», «1e999») es null. */
const moneyOf = (value: unknown): number | null => {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>).total : null;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && DECIMAL.test(raw.trim()) ? Number(raw.trim()) : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const currencyOf = (value: unknown): string | null => {
  const raw = value && typeof value === 'object' ? text((value as Record<string, unknown>).currency).toUpperCase() : '';
  return raw || null;
};

/**
 * Interpreta un evento de PayPal. Un pago solo cuenta con state «completed» y el id de la suscripción en
 * billing_agreement_id; el id de la venta (resource.id) es la clave para no acreditar dos veces el mismo pago.
 * Reembolsos y reversos traen la venta original en sale_id (en el reverso, a falta de sale_id, en id).
 */
export function transitionFor(eventType: string, resource: unknown): BillingTransition {
  const res = (resource && typeof resource === 'object' ? resource : {}) as Record<string, unknown>;
  switch (eventType) {
    case 'PAYMENT.SALE.COMPLETED': {
      const id = text(res.billing_agreement_id);
      if (!id || text(res.state).toLowerCase() !== 'completed') return IGNORE;
      const amount = res.amount && typeof res.amount === 'object' ? (res.amount as Record<string, unknown>) : null;
      return { kind: 'payment', subscriptionId: id, saleId: text(res.id), amount: moneyOf(amount), currency: currencyOf(amount) };
    }
    case 'PAYMENT.SALE.DENIED': {
      // Una venta denegada es un cobro fallido
      const id = text(res.billing_agreement_id);
      return id ? { kind: 'failed', subscriptionId: id } : IGNORE;
    }
    case 'PAYMENT.SALE.REFUNDED': {
      const saleId = text(res.sale_id);
      if (!saleId) return IGNORE;
      // Un importe que no es un número válido no se trata como reembolso (ni se asume total ni se suma)
      const amount = moneyOf(res.amount);
      if (amount === null) return { kind: 'ignore', subscriptionId: null, reason: 'bad_refund_amount' };
      return { kind: 'refund', saleId, refundId: text(res.id), subscriptionId: text(res.billing_agreement_id) || null, amount, currency: currencyOf(res.amount) };
    }
    case 'PAYMENT.SALE.REVERSED': {
      const saleId = text(res.sale_id) || text(res.id);
      return saleId ? { kind: 'reversal', saleId, subscriptionId: text(res.billing_agreement_id) || null } : IGNORE;
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

/** True si el evento es ESTRICTAMENTE más viejo que el último aplicado a la suscripción (no debe cambiar su estado). */
export function isStaleEvent(eventTime: Date, lastEventTime: Date | null): boolean {
  return lastEventTime !== null && eventTime.getTime() < lastEventTime.getTime();
}

/** Estado tras un pago (réplica de billing_apply_payment): activa salvo cancelada; un pago más viejo que el último evento no reabre una suscripción ya suspendida/expirada. */
export function statusAfterPayment(status: SubStatus, lastEventTime: Date | null, eventTime: Date): SubStatus {
  if (status === 'cancelled') return 'cancelled';
  if (status !== 'pending' && isStaleEvent(eventTime, lastEventTime)) return status;
  return 'active';
}

/** Resta el periodo acreditado por una venta; nunca por debajo de ahora. */
export function paidUntilAfterReversal(paidUntil: Date | null, months: number, now: Date): Date {
  if (!paidUntil) return now;
  const out = addMonths(paidUntil, -months);
  return out.getTime() < now.getTime() ? now : out;
}

/**
 * Reembolso total: lo reembolsado acumulado alcanza el importe de la venta. Sin importe conocido no se asume total,
 * y la moneda de la venta debe ser USD (la única en la que se suman reembolsos); sin moneda o con otra, nunca es total.
 */
export function isFullRefund(saleAmount: number | null, refundedTotal: number, saleCurrency: string | null = BILLING_CURRENCY): boolean {
  return (saleCurrency ?? '').toUpperCase() === BILLING_CURRENCY && saleAmount !== null && saleAmount > 0 && refundedTotal >= saleAmount;
}

export type PendingVerdict = 'abandoned' | 'gone' | 'live';

/**
 * Qué hacer con una suscripción local «pending» según su estado REAL en PayPal (GET /v1/billing/subscriptions/{id}):
 *   - APPROVAL_PENDING: el pagador nunca la aprobó (popup cerrado). 'abandoned': se puede cancelar y sustituir.
 *   - CANCELLED / EXPIRED: ya no cobrará. 'gone': solo se limpia la fila local.
 *   - cualquier otra (APPROVED, ACTIVE, SUSPENDED, desconocida o vacía): 'live'. NUNCA se cancela y bloquea una nueva.
 */
export function pendingVerdict(remoteStatus: string | null | undefined): PendingVerdict {
  const status = (remoteStatus ?? '').toUpperCase();
  if (status === 'APPROVAL_PENDING') return 'abandoned';
  if (status === 'CANCELLED' || status === 'EXPIRED') return 'gone';
  return 'live';
}

export type SubscribeBlock = 'active' | 'suspended' | 'paid';

/**
 * Por qué NO se puede crear otra suscripción (null = se puede). Bloquean: active, grace, suspended (PayPal puede
 * reactivarla y cobrar) y cancelled con periodo pagado aún vigente. Las «pending» NO se miran aquí: su antigüedad no
 * dice nada (el popup del SDK puede cancelarse al instante o aprobarse tarde); se consulta su estado real en PayPal.
 */
export function subscribeBlock(subs: { status: SubStatus; startedAt: Date; paidUntil: Date | null }[], now: Date): SubscribeBlock | null {
  const order: SubscribeBlock[] = ['active', 'suspended', 'paid'];
  const found = new Set<SubscribeBlock>();
  for (const s of subs) {
    if (s.status === 'active' || s.status === 'grace') found.add('active');
    else if (s.status === 'suspended') found.add('suspended');
    else if (s.status === 'cancelled' && hasAccess(s, now)) found.add('paid');
  }
  return order.find((b) => found.has(b)) ?? null;
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
      // Sobre una suspendida (PayPal la reactivó) vuelve a active si ya hubo pago; sin pago no abre nada
      return { ...sub, status: sub.status === 'suspended' ? (sub.paidUntil ? 'active' : 'pending') : sub.status, grantPlan: false };
    case 'failed':
      return { ...sub, status: ['cancelled', 'expired', 'suspended'].includes(sub.status) ? sub.status : sub.paidUntil ? 'grace' : sub.status, grantPlan: false };
    case 'cancelled':
      return { ...sub, status: 'cancelled', grantPlan: false };
    case 'suspended':
      return { ...sub, status: 'suspended', grantPlan: false };
    case 'expired':
      return { ...sub, status: 'expired', grantPlan: false };
    case 'reversal':
      // Reverso/contracargo: suspendida (no se resucita una cancelada o expirada). El periodo se resta en BD junto con la venta
      return { ...sub, status: sub.status === 'cancelled' || sub.status === 'expired' ? sub.status : 'suspended', grantPlan: false };
    default:
      return { ...sub, grantPlan: false };
  }
}

/** Acceso al plan de pago: hay pago confirmado (paid_until) que aún no venció, y la suscripción no está pendiente. */
export function hasAccess(sub: { status: SubStatus; paidUntil: Date | null } | null, now: Date): boolean {
  if (!sub || sub.status === 'pending' || !sub.paidUntil) return false;
  return sub.paidUntil.getTime() > now.getTime();
}

// ---------------------------------------------------------------------------
// Códigos con duración (réplica en TypeScript de redeem_invite, migración 0047)
// ---------------------------------------------------------------------------

/**
 * Vencimiento al canjear un código con plan_months: parte de hoy, o del vencimiento vigente
 * SI ES DEL MISMO plan (canjear dos códigos seguidos del mismo plan suma). Un plan distinto
 * o sin vencimiento empieza desde hoy.
 */
export function codeExpiry(input: {
  now: Date;
  currentPlanId: string | null;
  currentExpiresAt: Date | null;
  codePlanId: string;
  months: number;
}): Date {
  const sameLive =
    input.currentPlanId === input.codePlanId && input.currentExpiresAt && input.currentExpiresAt.getTime() > input.now.getTime();
  return addMonths(sameLive ? (input.currentExpiresAt as Date) : input.now, input.months);
}

export type RedeemRefusal = 'not_pending' | 'no_twitch' | 'has_paid_plan' | 'has_plan' | 'already_redeemed';

type SubAccess = { status: SubStatus; paidUntil: Date | null };

/** Paga ahora: active/grace y también cancelled/suspended mientras el periodo pagado siga vigente (alineado con redeem_invite, 0050). */
const paysNow = (subs: SubAccess[], now: Date): boolean =>
  subs.some((s) => (s.status === 'active' || s.status === 'grace' || s.status === 'cancelled' || s.status === 'suspended') && hasAccess(s, now));

/**
 * Reglas de convivencia al canjear un código (después de comprobar que el código sirve).
 * Devuelve el motivo del rechazo, o null si se puede canjear.
 *   - suspendido: not_pending; sin Twitch: no_twitch.
 *   - suscripción de PayPal con acceso vigente: has_paid_plan (el plan pagado manda).
 *   - ya canjeó ese código: already_redeemed.
 *   - activo con plan fijo (sin vencimiento) distinto del plan por defecto: has_plan.
 */
export function redeemRefusal(input: {
  profileStatus: string;
  hasTwitch: boolean;
  planId: string | null;
  planExpiresAt: Date | null;
  defaultPlanId: string | null;
  subscriptions: SubAccess[];
  alreadyRedeemed: boolean;
  now: Date;
}): RedeemRefusal | null {
  if (input.profileStatus !== 'pending' && input.profileStatus !== 'active') return 'not_pending';
  if (!input.hasTwitch) return 'no_twitch';
  if (paysNow(input.subscriptions, input.now)) return 'has_paid_plan';
  if (input.alreadyRedeemed) return 'already_redeemed';
  if (input.profileStatus === 'active' && input.planId && !input.planExpiresAt && input.planId !== input.defaultPlanId) return 'has_plan';
  return null;
}

/** Perfil con plan por código vigente: plan_expires_at futuro y sin suscripción de pago con acceso. */
export function isCodeAccess(planExpiresAt: Date | null, subscriptions: SubAccess[], now: Date): boolean {
  if (!planExpiresAt || planExpiresAt.getTime() <= now.getTime()) return false;
  return !paysNow(subscriptions, now);
}
