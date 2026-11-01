/**
 * src/lib/billingLogic.ts
 *
 * Lógica pura del cobro: dinero, ahorro, texto de estado, fechas en español y
 * los pasos de seguimiento. Sin red ni React, para poder probarla.
 */

import type {
  BillingPeriod,
  BillingStatus,
  BillingSubscription,
  PeriodKey,
  PriceMap,
  SubscriptionStatus,
} from './billingTypes';

export const periodKey = (months: number): PeriodKey => String(months) as PeriodKey;

/** «$5.00». Los precios son siempre en dólares. */
export function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/** Lo que cuesta cada mes dentro de un periodo. */
export function monthlyPrice(total: number, months: number): number {
  return months > 0 ? total / months : total;
}

/** Porcentaje que se ahorra frente a pagar mes a mes. 0 si no hay precio mensual o no hay descuento. */
export function savingsPercent(prices: PriceMap, months: number): number {
  const base = prices['1'];
  const total = prices[periodKey(months)];
  if (months <= 1 || base == null || base <= 0 || total == null) return 0;
  return Math.max(0, Math.round((1 - total / (base * months)) * 100));
}

export function periodLabel(months: number): string {
  return months === 1 ? '1 mes' : `${months} meses`;
}

/** Periodos que se pueden contratar (con precio), en orden. */
export function availablePeriods(prices: PriceMap): BillingPeriod[] {
  return ([1, 3, 6, 12] as const).filter((m) => {
    const value = prices[periodKey(m)];
    return value != null && value > 0;
  });
}

/** Periodo con el que abre la ventana: el que ya tenía, si sigue disponible; si no, 3 meses o el primero. */
export function defaultPeriod(prices: PriceMap, preferred?: number | null): BillingPeriod | null {
  const open = availablePeriods(prices);
  if (open.length === 0) return null;
  if (preferred && (open as number[]).includes(preferred)) return preferred as BillingPeriod;
  return open.includes(3) ? 3 : open[0];
}

/** Suma meses de calendario sin pasarse de fin de mes (31 ene + 1 mes = 28/29 feb). */
export function addMonths(date: Date, months: number): Date {
  const next = new Date(date.getTime());
  const day = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + months);
  const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, last));
  return next;
}

/** «3 de enero de 2026». Con fecha vacía o rota, un guion. */
export function formatDateEs(value: string | Date | null | undefined, timeZone?: string): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric', ...(timeZone ? { timeZone } : {}) });
}

export type StatusTone = 'ok' | 'warn' | 'bad' | 'neutral';

export interface StatusText {
  label: string;
  tone: StatusTone;
  detail: string;
}

/** Qué decirle al streamer según el estado real. Nunca «activo» sin acceso. */
export function statusText(status: BillingStatus | null): StatusText {
  const sub = status?.subscription ?? null;
  if (!sub) return { label: 'Plan gratis', tone: 'neutral', detail: 'Todavía no tienes una suscripción.' };
  const until = formatDateEs(sub.paidUntil);
  const access = status?.hasAccess === true;
  const map: Record<SubscriptionStatus, StatusText> = {
    pending: {
      label: 'Esperando el pago',
      tone: 'warn',
      detail: 'Aprobaste la suscripción, pero el plan se abre cuando PayPal confirme que el dinero llegó.',
    },
    active: access
      ? { label: 'Activo', tone: 'ok', detail: `Pagado hasta el ${until}. Se renueva solo.` }
      : { label: 'Esperando el pago', tone: 'warn', detail: 'Todavía no hay un pago confirmado, así que el plan no está abierto.' },
    grace: access
      ? { label: 'Cobro fallido', tone: 'warn', detail: `Tu tarjeta rechazó la renovación. Conservas el plan hasta el ${until} mientras PayPal reintenta.` }
      : { label: 'Cobro fallido', tone: 'bad', detail: 'PayPal no pudo cobrar la renovación.' },
    cancelled: access
      ? { label: 'Cancelada', tone: 'warn', detail: `No se renovará. Conservas el plan hasta el ${until}.` }
      : { label: 'Cancelada', tone: 'neutral', detail: 'No se renovará y ya terminó lo pagado.' },
    suspended: access
      ? { label: 'Suspendida', tone: 'bad', detail: `PayPal suspendió la suscripción. Conservas el plan hasta el ${until}.` }
      : { label: 'Suspendida', tone: 'bad', detail: 'PayPal suspendió la suscripción y ya terminó lo pagado.' },
    expired: { label: 'Vencida', tone: 'neutral', detail: 'Terminó lo pagado y volviste al plan gratis.' },
  };
  return map[sub.status] ?? map.expired;
}

/** Se puede cancelar mientras la suscripción siga viva en PayPal. */
export function canCancel(sub: BillingSubscription | null): boolean {
  return !!sub && (sub.status === 'active' || sub.status === 'grace' || sub.status === 'pending');
}

/** Contratar otra solo si no hay una viva: así no se paga dos veces. */
export function canSubscribe(sub: BillingSubscription | null): boolean {
  return !sub || sub.status === 'cancelled' || sub.status === 'suspended' || sub.status === 'expired';
}

export type StepState = 'done' | 'active' | 'pending';

export interface TrackStep {
  id: 'created' | 'paid' | 'received' | 'activated';
  title: string;
  detail: string;
  state: StepState;
}

/**
 * Los cuatro pasos del seguimiento, sacados de lo que dice `status`:
 * suscripción creada, pago realizado, dinero recibido y plan activado.
 * El servidor solo anota un pago cuando PayPal lo da por completado, así que
 * «dinero recibido» exige pago y fecha de vencimiento; «activado», acceso real.
 */
export function trackSteps(status: BillingStatus | null, planName: string, months: number): TrackStep[] {
  const sub = status?.subscription ?? null;
  const created = !!sub;
  const paid = !!sub?.lastPaymentAt;
  const received = paid && !!sub?.paidUntil;
  const activated = status?.hasAccess === true;
  const flags = [created, paid, received, activated];
  const firstOpen = flags.indexOf(false);
  const stateOf = (i: number): StepState => (flags[i] ? 'done' : i === firstOpen ? 'active' : 'pending');
  return [
    {
      id: 'created',
      title: 'Suscripción creada',
      detail: created ? 'Aprobaste el cobro en PayPal' : 'Esperando a PayPal',
      state: stateOf(0),
    },
    {
      id: 'paid',
      title: 'Pago realizado',
      detail: paid ? `Cobrado el ${formatDateEs(sub?.lastPaymentAt)}` : 'Todavía sin pago',
      state: stateOf(1),
    },
    {
      id: 'received',
      title: 'Dinero recibido en PayPal',
      detail: received ? 'PayPal confirma el abono a Lalo' : 'PayPal aún no lo confirma',
      state: stateOf(2),
    },
    {
      id: 'activated',
      title: 'Plan activado',
      detail: activated ? `Plan ${planName} por ${periodLabel(months)}` : 'Se abre cuando llega el dinero',
      state: stateOf(3),
    },
  ];
}

export interface PaypalReturn {
  result: 'ok' | 'cancel';
  /** PayPal lo añade a la dirección de vuelta como subscription_id. */
  subscriptionId: string | null;
}

/**
 * Lee el regreso de PayPal. Lalo navega con #, así que el aviso puede venir en
 * la dirección normal (?paypal=ok) o dentro del hash (#cuenta?paypal=ok).
 */
export function readPaypalReturn(search: string, hash: string): PaypalReturn | null {
  const inHash = hash.includes('?') ? hash.slice(hash.indexOf('?')) : '';
  for (const raw of [search, inHash]) {
    const params = new URLSearchParams(raw);
    const result = params.get('paypal');
    if (result === 'ok' || result === 'cancel') {
      const id = params.get('subscription_id') || params.get('subscriptionId');
      return { result, subscriptionId: id ? id.trim() : null };
    }
  }
  return null;
}

/** Solo se redirige a una dirección https de PayPal (real o sandbox). */
export function isSafeApproveUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (parsed.hostname === 'paypal.com' || parsed.hostname.endsWith('.paypal.com'));
  } catch {
    return false;
  }
}

/** Cada cuánto se pregunta a Lalo si ya llegó el aviso de PayPal, y hasta cuándo. */
export const POLL_EVERY_MS = 3000;
export const POLL_MAX_MS = 60000;

export function pollExpired(startedAt: number, now: number): boolean {
  return now - startedAt >= POLL_MAX_MS;
}
