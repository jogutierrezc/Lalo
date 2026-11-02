/**
 * src/lib/adminBillingLogic.ts
 *
 * Lógica PURA (sin red ni React) de la bandeja de pagos y la facturación del administrador.
 * El servidor (server/paypal) reúne los datos de las tablas y llama aquí para decidir:
 *
 *   classifyInbox      qué ítems requieren atención y de qué tipo
 *   sortInbox          orden por urgencia
 *   inboxCounts        pendientes por tipo
 *   buildBillingSummary  ingresos por mes, variación, renovaciones, cobros fallidos, desglose y recibos
 *
 * Umbrales (documentados en el informe de la entrega):
 *   - «vence pronto»: 7 días.
 *   - «sys»: un aviso de PayPal reclamado («processing») hace más de 15 minutos (el servidor lo retoma a los 5).
 *   - «pendiente de pago»: una suscripción pending con entre 30 minutos y 14 días (antes es un pago en curso; después, abandonada).
 *   - reembolsos y reversos: los de los últimos 30 días.
 */

import { paymentConcept, receiptNumber, saleStatus, shortHash } from './paymentsLogic.js';
import type { PaymentStatus } from './paymentsApi';

export const SOON_DAYS = 7;
export const SYS_STUCK_MINUTES = 15;
export const PENDING_MIN_MINUTES = 30;
export const PENDING_MAX_DAYS = 14;
export const REFUND_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const HISTORY_MAX = 8;

export type InboxKind = 'fail' | 'pending' | 'soon' | 'refund' | 'sys';
export const INBOX_KINDS: readonly InboxKind[] = ['fail', 'refund', 'sys', 'soon', 'pending'];

export interface InboxHistoryEntry {
  type: string;
  at: string;
}

export interface InboxItem {
  /** Clave estable del ítem: sirve para marcarlo como resuelto. */
  key: string;
  kind: InboxKind;
  creator: string;
  plan: string;
  amount: number | null;
  currency: string;
  date: string;
  daysLeft: number | null;
  note: string;
  history: InboxHistoryEntry[];
  /** Id de PayPal (suscripción o aviso): solo lo ve el administrador. */
  paypalId: string | null;
}

// ---------- Entradas (datos ya leídos de las tablas) ----------

export interface InboxSub {
  id: string;
  paypalId: string;
  status: string;
  creator: string;
  planName: string;
  months: number;
  priceUsd: number;
  paidUntil: string | null;
  startedAt: string;
  updatedAt: string;
}

export interface InboxCode {
  profileId: string;
  creator: string;
  planName: string;
  expiresAt: string;
  /** true = acceso por código de invitación; false = regalo u otro acceso manual. */
  fromCode: boolean;
}

export interface InboxEvent {
  id: string;
  type: string;
  /** Id de la suscripción en PayPal. */
  paypalSubscriptionId: string | null;
  status: 'processing' | 'done';
  claimedAt: string;
  processedAt: string | null;
}

export interface InboxRefund {
  /** refund_id (reembolso) o sale_id (reverso): se usa para la clave. */
  ref: string;
  kind: 'refund' | 'reversal';
  at: string;
  amount: number | null;
  currency: string;
  creator: string;
  planName: string;
  months: number;
  paypalSubscriptionId: string | null;
}

export interface ClassifyInput {
  now: Date;
  subs: InboxSub[];
  codes: InboxCode[];
  events: InboxEvent[];
  refunds: InboxRefund[];
  /** Claves ya resueltas por un administrador. */
  resolved: ReadonlySet<string>;
}

const eventAt = (e: InboxEvent): string => e.processedAt ?? e.claimedAt;
const daysBetween = (to: string, now: Date): number => Math.ceil((Date.parse(to) - now.getTime()) / DAY_MS);
const dayOf = (iso: string): string => iso.slice(0, 10);

function historyOf(events: InboxEvent[], paypalSubscriptionId: string | null): InboxHistoryEntry[] {
  if (!paypalSubscriptionId) return [];
  return events
    .filter((e) => e.paypalSubscriptionId === paypalSubscriptionId)
    .map((e) => ({ type: e.type, at: eventAt(e) }))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, HISTORY_MAX);
}

/** Convierte lo leído de las tablas en los ítems que requieren atención (sin los ya resueltos), ordenados por urgencia. */
export function classifyInbox(input: ClassifyInput): InboxItem[] {
  const { now, subs, codes, events, refunds, resolved } = input;
  const items: InboxItem[] = [];
  const refundedSubs = new Set(refunds.map((r) => r.paypalSubscriptionId).filter((v): v is string => !!v));

  for (const sub of subs) {
    const history = historyOf(events, sub.paypalId);
    const base = { creator: sub.creator, plan: `${sub.planName} · ${sub.months} ${sub.months === 1 ? 'mes' : 'meses'}`, amount: sub.priceUsd, currency: 'USD', paypalId: sub.paypalId, history };

    if (sub.status === 'grace') {
      const failedAt = events.filter((e) => e.paypalSubscriptionId === sub.paypalId && e.type === 'PAYMENT.FAILED').map(eventAt).sort().pop() ?? sub.updatedAt;
      const left = sub.paidUntil ? daysBetween(sub.paidUntil, now) : null;
      items.push({
        ...base,
        key: `fail:${sub.id}:${Math.floor(Date.parse(failedAt) / 1000)}`,
        kind: 'fail',
        date: failedAt,
        daysLeft: left,
        note: left !== null && left > 0 ? `Cobro fallido. PayPal reintenta; conserva el plan ${left} ${left === 1 ? 'día' : 'días'} más.` : 'Cobro fallido. PayPal reintenta el cobro.',
      });
    } else if (sub.status === 'pending') {
      const age = now.getTime() - Date.parse(sub.startedAt);
      if (age >= PENDING_MIN_MINUTES * MINUTE_MS && age <= PENDING_MAX_DAYS * DAY_MS) {
        items.push({ ...base, key: `pending:${sub.id}`, kind: 'pending', date: sub.startedAt, daysLeft: null, note: 'Inició el pago en PayPal y no lo completó.' });
      }
    } else if (sub.status === 'cancelled' && sub.paidUntil) {
      const left = daysBetween(sub.paidUntil, now);
      if (left >= 0 && left <= SOON_DAYS) {
        items.push({ ...base, key: `soon:${sub.id}:${dayOf(sub.paidUntil)}`, kind: 'soon', date: sub.paidUntil, daysLeft: left, note: 'Canceló en PayPal: el plan vence y no se renueva.' });
      }
    } else if (sub.status === 'suspended' && !refundedSubs.has(sub.paypalId)) {
      items.push({ ...base, key: `refund:sus:${sub.id}:${dayOf(sub.updatedAt)}`, kind: 'refund', date: sub.updatedAt, daysLeft: null, note: 'Suscripción suspendida en PayPal.' });
    }
  }

  for (const code of codes) {
    const left = daysBetween(code.expiresAt, now);
    if (left < 0 || left > SOON_DAYS) continue;
    items.push({
      key: `soon:code:${code.profileId}:${dayOf(code.expiresAt)}`,
      kind: 'soon',
      creator: code.creator,
      plan: code.planName,
      amount: null,
      currency: 'USD',
      date: code.expiresAt,
      daysLeft: left,
      note: code.fromCode ? 'El plan de su código vence pronto.' : 'El plan de regalo vence pronto.',
      history: [],
      paypalId: null,
    });
  }

  for (const refund of refunds) {
    items.push({
      key: `refund:${shortHash(refund.ref)}`,
      kind: 'refund',
      creator: refund.creator,
      plan: `${refund.planName} · ${refund.months} ${refund.months === 1 ? 'mes' : 'meses'}`,
      amount: refund.amount,
      currency: refund.currency,
      date: refund.at,
      daysLeft: null,
      note: refund.kind === 'reversal' ? 'Contracargo o reverso: se quitó el periodo y se suspendió.' : 'Reembolso aplicado.',
      history: historyOf(events, refund.paypalSubscriptionId),
      paypalId: refund.paypalSubscriptionId,
    });
  }

  for (const event of events) {
    if (event.status !== 'processing') continue;
    const stuck = now.getTime() - Date.parse(event.claimedAt);
    if (stuck <= SYS_STUCK_MINUTES * MINUTE_MS) continue;
    items.push({
      key: `sys:${shortHash(event.id)}`,
      kind: 'sys',
      creator: '—',
      plan: '—',
      amount: null,
      currency: 'USD',
      date: event.claimedAt,
      daysLeft: null,
      note: `Aviso ${event.type} sin terminar hace ${Math.floor(stuck / MINUTE_MS)} min.`,
      history: [{ type: event.type, at: event.claimedAt }],
      paypalId: event.id,
    });
  }

  return sortInbox(items.filter((item) => !resolved.has(item.key)));
}

/** Más urgente primero: tipo (cobro fallido, reembolso, sistema, vence pronto, pendiente), luego menos días restantes y, al final, el más reciente. */
export function sortInbox(items: InboxItem[]): InboxItem[] {
  const rank = (kind: InboxKind) => INBOX_KINDS.indexOf(kind);
  return [...items].sort((a, b) => {
    if (a.kind !== b.kind) return rank(a.kind) - rank(b.kind);
    const da = a.daysLeft ?? Number.POSITIVE_INFINITY;
    const db = b.daysLeft ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
  });
}

export type InboxCounts = Record<InboxKind, number> & { total: number };

/** Cuántos ítems hay de cada tipo y en total. */
export function inboxCounts(items: Pick<InboxItem, 'kind'>[]): InboxCounts {
  const counts: InboxCounts = { fail: 0, pending: 0, soon: 0, refund: 0, sys: 0, total: 0 };
  for (const item of items) {
    counts[item.kind] += 1;
    counts.total += 1;
  }
  return counts;
}

const KIND_LABELS: Record<InboxKind, string> = {
  fail: 'Cobro fallido',
  pending: 'Pendiente de pago',
  soon: 'Vence pronto',
  refund: 'Reembolso o contracargo',
  sys: 'Aviso sin terminar',
};

export const inboxKindLabel = (kind: InboxKind): string => KIND_LABELS[kind] ?? kind;

// ---------- Facturación ----------

export interface SummarySale {
  saleId: string;
  createdAt: string;
  amount: number | null;
  currency: string | null;
  refundedAmount: number;
  reversedAt: string | null;
  months: number;
  planName: string;
  creator: string;
}

export interface SummarySub {
  status: string;
  planId: string;
  planName: string;
  months: number;
  priceUsd: number;
  paidUntil: string | null;
}

export interface MonthRevenue {
  /** «2026-11» */
  month: string;
  /** Ingresos netos (cobrado menos reembolsado; 0 si se revirtió), solo USD. */
  revenue: number;
  sales: number;
}

export interface BreakdownRow {
  planId: string;
  planName: string;
  months: number;
  count: number;
  amount: number;
}

export interface SummaryReceipt {
  receipt: string;
  date: string;
  creator: string;
  concept: string;
  amount: number | null;
  currency: string;
  status: PaymentStatus;
  refundedAmount: number;
}

export interface BillingSummary {
  currency: 'USD';
  /** Los 6 últimos meses, del más antiguo al actual. */
  months: MonthRevenue[];
  currentRevenue: number;
  previousRevenue: number;
  /** Variación porcentual frente al mes anterior; null si el anterior fue 0. */
  variationPct: number | null;
  activeSubscriptions: number;
  renewals30: { count: number; amount: number };
  /** Suscripciones en gracia (último cobro fallido) y su % sobre activas + en gracia; null si no hay ninguna. */
  failed: { count: number; pctOfActive: number | null };
  breakdown: BreakdownRow[];
  receipts: SummaryReceipt[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const monthKey = (d: Date): string => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/** Ingreso neto de una venta en USD: 0 si se revirtió, no es USD o no tiene importe. */
export function saleNetRevenue(sale: Pick<SummarySale, 'amount' | 'currency' | 'refundedAmount' | 'reversedAt'>): number {
  if (sale.reversedAt || sale.amount === null || (sale.currency ?? 'USD') !== 'USD') return 0;
  return Math.max(0, round2(sale.amount - sale.refundedAmount));
}

/** Los últimos `count` meses UTC terminando en el de `now`, del más antiguo al actual. */
export function lastMonths(now: Date, count: number): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) out.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  return out;
}

export function buildBillingSummary(input: { now: Date; sales: SummarySale[]; subs: SummarySub[]; receiptsLimit: number }): BillingSummary {
  const { now, sales, subs } = input;
  const keys = lastMonths(now, 6);
  const months: MonthRevenue[] = keys.map((month) => ({ month, revenue: 0, sales: 0 }));
  for (const sale of sales) {
    const row = months.find((m) => m.month === sale.createdAt.slice(0, 7));
    if (!row) continue;
    row.revenue = round2(row.revenue + saleNetRevenue(sale));
    row.sales += 1;
  }
  const currentRevenue = months[months.length - 1].revenue;
  const previousRevenue = months[months.length - 2].revenue;

  const active = subs.filter((s) => s.status === 'active');
  const grace = subs.filter((s) => s.status === 'grace');
  const horizon = now.getTime() + 30 * DAY_MS;
  const renewing = active.filter((s) => s.paidUntil && Date.parse(s.paidUntil) > now.getTime() && Date.parse(s.paidUntil) <= horizon);

  const breakdown = new Map<string, BreakdownRow>();
  for (const sub of [...active, ...grace]) {
    const id = `${sub.planId}:${sub.months}`;
    const row = breakdown.get(id) ?? { planId: sub.planId, planName: sub.planName, months: sub.months, count: 0, amount: 0 };
    row.count += 1;
    row.amount = round2(row.amount + sub.priceUsd);
    breakdown.set(id, row);
  }

  const receipts = [...sales]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, Math.max(0, input.receiptsLimit))
    .map(
      (sale): SummaryReceipt => ({
        receipt: receiptNumber(sale.saleId, sale.createdAt),
        date: sale.createdAt,
        creator: sale.creator,
        concept: paymentConcept(sale.planName, sale.months),
        amount: sale.amount,
        currency: sale.currency ?? 'USD',
        status: saleStatus({ reversedAt: sale.reversedAt, refundedAmount: sale.refundedAmount }),
        refundedAmount: sale.refundedAmount,
      })
    );

  return {
    currency: 'USD',
    months,
    currentRevenue,
    previousRevenue,
    variationPct: previousRevenue > 0 ? Math.round(((currentRevenue - previousRevenue) / previousRevenue) * 1000) / 10 : null,
    activeSubscriptions: active.length,
    renewals30: { count: renewing.length, amount: round2(renewing.reduce((sum, s) => sum + s.priceUsd, 0)) },
    failed: { count: grace.length, pctOfActive: active.length + grace.length > 0 ? Math.round((grace.length / (active.length + grace.length)) * 1000) / 10 : null },
    breakdown: [...breakdown.values()].sort((a, b) => a.planName.localeCompare(b.planName) || a.months - b.months),
    receipts,
  };
}
