/**
 * src/lib/adminBillingView.ts
 *
 * Lógica PURA de lo que se ve en la bandeja de pagos y en la facturación del
 * administrador: filtros, tonos, textos y la geometría de la gráfica de ingresos.
 * Los datos y las reglas de negocio viven en adminBillingLogic.ts; aquí solo se
 * decide cómo mostrarlos. Sin red ni React.
 */

import type { BillingSummary, InboxItem, InboxKind, MonthRevenue } from './adminBillingLogic';
import type { PaymentStatus } from './paymentsApi';

// ---------- Bandeja: filtros ----------

export type InboxFilter = 'all' | InboxKind;

export const INBOX_FILTERS: { id: InboxFilter; label: string }[] = [
  { id: 'all', label: 'Todo' },
  { id: 'fail', label: 'Cobros fallidos' },
  { id: 'soon', label: 'Por vencer' },
  { id: 'refund', label: 'Reembolsos' },
  { id: 'sys', label: 'Sistema' },
  { id: 'pending', label: 'Sin completar' },
];

export function filterInbox(items: InboxItem[], filter: InboxFilter): InboxItem[] {
  return filter === 'all' ? items : items.filter((item) => item.kind === filter);
}

/**
 * Qué ítem queda seleccionado: el pedido si sigue en la lista; si no, el primero.
 * null cuando la lista está vacía.
 */
export function pickSelection(visible: InboxItem[], wantedKey: string | null): string | null {
  if (visible.length === 0) return null;
  return visible.some((item) => item.key === wantedKey) ? wantedKey : visible[0].key;
}

/** A quién pasa la selección al resolver un ítem: el siguiente de la lista o, si era el último, el anterior. */
export function nextSelection(visible: InboxItem[], resolvedKey: string): string | null {
  const index = visible.findIndex((item) => item.key === resolvedKey);
  if (index < 0) return visible[0]?.key ?? null;
  return (visible[index + 1] ?? visible[index - 1])?.key ?? null;
}

export type InboxTone = 'bad' | 'warn' | 'neutral';

/** Cobro fallido y reembolso/contracargo son los casos con dinero en riesgo. */
export const inboxTone = (kind: InboxKind): InboxTone => (kind === 'fail' || kind === 'refund' ? 'bad' : kind === 'sys' ? 'neutral' : 'warn');

const EVENT_LABELS: Record<string, string> = {
  'BILLING.SUBSCRIPTION.ACTIVATED': 'Suscripción activada',
  'BILLING.SUBSCRIPTION.CANCELLED': 'Suscripción cancelada',
  'BILLING.SUBSCRIPTION.SUSPENDED': 'Suscripción suspendida',
  'BILLING.SUBSCRIPTION.EXPIRED': 'Suscripción vencida',
  'BILLING.SUBSCRIPTION.RENEWED': 'Suscripción renovada',
  'BILLING.SUBSCRIPTION.PAYMENT.FAILED': 'Cobro fallido',
  'PAYMENT.SALE.COMPLETED': 'Cobro completado',
  'PAYMENT.SALE.REFUNDED': 'Reembolso aplicado',
  'PAYMENT.SALE.REVERSED': 'Cobro revertido',
  'PAYMENT.FAILED': 'Cobro fallido',
};

/** Nombre legible de un evento de PayPal; si no se conoce, el código tal cual. */
export const eventLabel = (type: string): string => EVENT_LABELS[type] ?? type;

/** «Quedan 3 días», «Vence hoy», «Vencido hace 2 días» o null si no aplica. */
export function daysText(daysLeft: number | null): string | null {
  if (daysLeft === null) return null;
  if (daysLeft === 0) return 'Vence hoy';
  if (daysLeft === 1) return '1 día';
  if (daysLeft > 1) return `${daysLeft} días`;
  return `Vencido hace ${Math.abs(daysLeft)} ${Math.abs(daysLeft) === 1 ? 'día' : 'días'}`;
}

// ---------- Facturación ----------

const MONTH_NAMES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** «2026-11» -> «nov». */
export function monthShort(month: string): string {
  const index = Number(month.slice(5, 7)) - 1;
  return MONTH_NAMES[index] ?? month;
}

export const usd = (amount: number): string =>
  `$ ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** «+12,4 %», «−3,0 %» o null si el mes anterior fue 0. */
export function variationText(pct: number | null): string | null {
  if (pct === null) return null;
  const abs = Math.abs(pct).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${pct >= 0 ? '+' : '−'}${abs} %`;
}

export const percentText = (pct: number | null): string =>
  pct === null ? 'Sin suscripciones' : `${pct.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} % de las activas`;

/** Primer valor «redondo» (1, 2, 2.5, 5 x 10^n) que cubre `value`; la escala de la gráfica. */
export function niceMax(value: number): number {
  if (!(value > 0)) return 10;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  const f = value / exp;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return step * exp;
}

export interface ChartBar {
  month: string;
  label: string;
  value: number;
  x: number;
  y: number;
  width: number;
  height: number;
  current: boolean;
}

export interface ChartGeometry {
  width: number;
  height: number;
  left: number;
  baseline: number;
  max: number;
  ticks: { value: number; y: number }[];
  bars: ChartBar[];
}

/** Barras y ejes (sin escala inventada: el máximo sale de los valores reales). El último mes es el actual. */
export function buildChart(months: MonthRevenue[], width = 560, height = 220): ChartGeometry {
  const left = 48;
  const bottom = 28;
  const top = 14;
  const right = 8;
  const baseline = height - bottom;
  const plotH = baseline - top;
  const max = niceMax(Math.max(0, ...months.map((m) => m.revenue)));
  const count = Math.max(1, months.length);
  const slot = (width - left - right) / count;
  const barW = Math.min(46, slot * 0.62);
  const ticks = [0, 1, 2, 3, 4].map((i) => {
    const value = (max / 4) * i;
    return { value, y: baseline - (value / max) * plotH };
  });
  const bars = months.map((m, i): ChartBar => {
    const h = (m.revenue / max) * plotH;
    return {
      month: m.month,
      label: monthShort(m.month),
      value: m.revenue,
      x: left + i * slot + (slot - barW) / 2,
      y: baseline - h,
      width: barW,
      height: h,
      current: i === months.length - 1,
    };
  });
  return { width, height, left, baseline, max, ticks, bars };
}

export const tickText = (value: number): string => (Number.isInteger(value) ? String(value) : value.toFixed(1));

/** Descripción accesible de la gráfica, con los valores reales. */
export function chartLabel(summary: Pick<BillingSummary, 'months'>): string {
  if (summary.months.length === 0) return 'Sin ingresos registrados.';
  const parts = summary.months.map((m) => `${monthShort(m.month)} ${usd(m.revenue)}`);
  return `Ingresos de los últimos ${summary.months.length} meses en dólares: ${parts.join(', ')}.`;
}

export const hasAnyRevenue = (summary: BillingSummary): boolean =>
  summary.months.some((m) => m.revenue > 0 || m.sales > 0) || summary.receipts.length > 0 || summary.activeSubscriptions > 0;

export type ReceiptTone = 'ok' | 'neutral' | 'bad' | 'warn';

export const receiptTone = (status: PaymentStatus): ReceiptTone =>
  status === 'paid' ? 'ok' : status === 'refunded' ? 'neutral' : status === 'pending' ? 'warn' : 'bad';
