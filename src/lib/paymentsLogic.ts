/**
 * src/lib/paymentsLogic.ts
 *
 * Lógica PURA (sin red ni React) del historial de pagos: estado de una venta, texto del
 * concepto, número de recibo, formato de importes y agrupación por mes.
 * También la usa el servidor (server/paypal) para que creador y administrador vean el mismo recibo.
 *
 * Número de recibo: «R-<año>-<8 caracteres>». El año es el de la fecha de la venta (UTC) y los 8
 * caracteres son un hash FNV-1a de 32 bits del id de la venta, en hexadecimal mayúscula. Así es
 * estable (no depende del orden ni de un contador), no se puede deshacer hasta el id de PayPal
 * y no hace falta ninguna columna nueva. Los cobros fallidos no llevan recibo.
 */

import type { PaymentRow, PaymentStatus } from './paymentsApi';

export const PAYMENT_STATUSES: readonly PaymentStatus[] = ['paid', 'refunded', 'reversed', 'failed', 'pending'];

/** Hash FNV-1a de 32 bits, en 8 caracteres hexadecimales mayúsculas. */
export function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).toUpperCase().padStart(8, '0');
}

/** Recibo estable de una venta: R-<año UTC>-<hash del id de la venta>. */
export function receiptNumber(saleId: string, createdAt: string): string {
  const year = new Date(createdAt).getUTCFullYear();
  return `R-${Number.isFinite(year) ? year : 0}-${shortHash(saleId)}`;
}

/** Estado de una venta: un reverso manda sobre un reembolso, y un reembolso (total o parcial) sobre «pagado». */
export function saleStatus(sale: { reversedAt: string | null; refundedAmount: number }): PaymentStatus {
  if (sale.reversedAt) return 'reversed';
  if (sale.refundedAmount > 0) return 'refunded';
  return 'paid';
}

/** «Plan Pro · 3 meses». */
export function paymentConcept(planName: string, months: number): string {
  return `Plan ${planName} · ${months} ${months === 1 ? 'mes' : 'meses'}`;
}

const STATUS_LABELS: Record<PaymentStatus, string> = {
  paid: 'Pagado',
  refunded: 'Reembolsado',
  reversed: 'Revertido',
  failed: 'Fallido',
  pending: 'Pendiente',
};

export const paymentStatusLabel = (status: PaymentStatus): string => STATUS_LABELS[status] ?? STATUS_LABELS.pending;

/** «USD 27.00» (dos decimales; «—» si no hay importe). */
export function formatMoney(amount: number | null, currency: string): string {
  if (amount === null || !Number.isFinite(amount)) return '—';
  return `${currency || 'USD'} ${amount.toFixed(2)}`;
}

/** Importe que el creador conserva pagado: lo cobrado menos lo reembolsado; 0 si se revirtió. */
export function netAmount(row: Pick<PaymentRow, 'amount' | 'refundedAmount' | 'status'>): number {
  if (row.status !== 'paid' && row.status !== 'refunded') return 0;
  return Math.max(0, (row.amount ?? 0) - row.refundedAmount);
}

export interface PaymentGroup {
  /** «2026-11» */
  month: string;
  rows: PaymentRow[];
}

/** Agrupa por mes UTC (el más reciente primero) conservando el orden de entrada dentro de cada mes. */
export function groupPaymentsByMonth(rows: PaymentRow[]): PaymentGroup[] {
  const groups = new Map<string, PaymentRow[]>();
  for (const row of rows) {
    const month = row.date.slice(0, 7);
    groups.set(month, [...(groups.get(month) ?? []), row]);
  }
  return [...groups.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([month, list]) => ({ month, rows: list }));
}
