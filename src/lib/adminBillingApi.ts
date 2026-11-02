/**
 * src/lib/adminBillingApi.ts
 *
 * Cliente de la bandeja de pagos y la facturación del administrador:
 *   GET  /api/paypal/admin-inbox            ítems que requieren atención
 *   POST /api/paypal/admin-inbox-resolve    marca un ítem como resuelto
 *   GET  /api/paypal/admin-billing-summary  ingresos, renovaciones, cobros fallidos, desglose y recibos
 * Mismo manejo de errores que billingApi.ts: el JSON se lee con cuidado y, si no cuadra, «bad_response».
 *
 * SIN PROBAR contra el servidor real: se desarrolló contra el contrato.
 */

import { call, type ApiOutcome } from './integrationsApi';
import { INBOX_KINDS, inboxCounts, type BillingSummary, type BreakdownRow, type InboxCounts, type InboxItem, type InboxKind, type MonthRevenue, type SummaryReceipt } from './adminBillingLogic';
import type { PaymentStatus } from './paymentsApi';

export type { BillingSummary, InboxCounts, InboxItem, InboxKind };

export interface AdminInbox {
  items: InboxItem[];
  counts: InboxCounts;
}

const STATUSES: PaymentStatus[] = ['paid', 'refunded', 'reversed', 'failed', 'pending'];
const BAD_ANSWER = 'El servidor respondió algo que no se entiende. Prueba otra vez en un momento.';

const asObject = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});
const asText = (value: unknown): string => (typeof value === 'string' ? value : '');
const asNumber = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const asNullableNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export function parseInbox(data: Record<string, unknown>): AdminInbox {
  const items = list(data.items)
    .map(asObject)
    .filter((i) => asText(i.key) && INBOX_KINDS.includes(i.kind as InboxKind))
    .map(
      (i): InboxItem => ({
        key: asText(i.key),
        kind: i.kind as InboxKind,
        creator: asText(i.creator) || '—',
        plan: asText(i.plan) || '—',
        amount: asNullableNumber(i.amount),
        currency: asText(i.currency) || 'USD',
        date: asText(i.date),
        daysLeft: asNullableNumber(i.daysLeft),
        note: asText(i.note),
        history: list(i.history)
          .map(asObject)
          .filter((h) => asText(h.type))
          .map((h) => ({ type: asText(h.type), at: asText(h.at) })),
        paypalId: asText(i.paypalId) || null,
      })
    );
  // Los contadores se recalculan de los ítems recibidos: nunca contradicen la lista
  return { items, counts: inboxCounts(items) };
}

export function parseSummary(data: Record<string, unknown>): BillingSummary {
  const renewals = asObject(data.renewals30);
  const failed = asObject(data.failed);
  return {
    currency: 'USD',
    months: list(data.months)
      .map(asObject)
      .filter((m) => asText(m.month))
      .map((m): MonthRevenue => ({ month: asText(m.month), revenue: asNumber(m.revenue), sales: asNumber(m.sales) })),
    currentRevenue: asNumber(data.currentRevenue),
    previousRevenue: asNumber(data.previousRevenue),
    variationPct: asNullableNumber(data.variationPct),
    activeSubscriptions: asNumber(data.activeSubscriptions),
    renewals30: { count: asNumber(renewals.count), amount: asNumber(renewals.amount) },
    failed: { count: asNumber(failed.count), pctOfActive: asNullableNumber(failed.pctOfActive) },
    breakdown: list(data.breakdown)
      .map(asObject)
      .filter((b) => asText(b.planId))
      .map((b): BreakdownRow => ({ planId: asText(b.planId), planName: asText(b.planName) || asText(b.planId), months: asNumber(b.months), count: asNumber(b.count), amount: asNumber(b.amount) })),
    receipts: list(data.receipts)
      .map(asObject)
      .filter((r) => asText(r.receipt))
      .map(
        (r): SummaryReceipt => ({
          receipt: asText(r.receipt),
          date: asText(r.date),
          creator: asText(r.creator) || '—',
          concept: asText(r.concept),
          amount: asNullableNumber(r.amount),
          currency: asText(r.currency) || 'USD',
          status: STATUSES.includes(r.status as PaymentStatus) ? (r.status as PaymentStatus) : 'pending',
          refundedAmount: asNumber(r.refundedAmount),
        })
      ),
  };
}

async function read<T>(path: string, method: 'GET' | 'POST', parse: (data: Record<string, unknown>) => T, body?: Record<string, unknown>): Promise<ApiOutcome<T>> {
  const res = await call(path, method, body);
  if (!res.ok) return res;
  try {
    return { ok: true, data: parse(res.data) };
  } catch {
    return { ok: false, code: 'bad_response', message: BAD_ANSWER, missing: [] };
  }
}

/** Bandeja de pagos: ítems pendientes por urgencia y su contador por tipo. */
export const fetchAdminInbox = () => read('/api/paypal/admin-inbox', 'GET', parseInbox);

/** Marca un ítem como resuelto; devuelve la bandeja que queda. */
export const resolveInboxItem = (key: string, note = '') => read('/api/paypal/admin-inbox-resolve', 'POST', parseInbox, { key, note });

/** Facturación del sistema; `receipts` = cuántos recibos recientes (1 a 50, por defecto 20). */
export const fetchAdminBillingSummary = (receipts?: number) =>
  read(receipts ? `/api/paypal/admin-billing-summary?receipts=${encodeURIComponent(String(receipts))}` : '/api/paypal/admin-billing-summary', 'GET', parseSummary);
