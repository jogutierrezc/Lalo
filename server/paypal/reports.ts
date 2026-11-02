/**
 * server/paypal/reports.ts
 *
 * Cuerpos de respuesta del historial de pagos del creador y de la bandeja y la facturación del
 * administrador (rutas /api/paypal/payments, admin-inbox, admin-inbox-resolve y admin-billing-summary).
 * Las decisiones (clasificar, ordenar, sumar) viven en src/lib/*Logic.ts, que es lógica pura.
 *
 *   - Al creador NUNCA le llegan ids de PayPal, ni el payload de los avisos, ni datos del pagador.
 *   - Al administrador sí le llega el id de PayPal del ítem (suscripción o aviso), nada más.
 */

import { fail, type IntegrationRequest, type IntegrationResult } from '../integrations/http.js';
import { classifyInbox, buildBillingSummary, inboxCounts, REFUND_WINDOW_DAYS, type InboxCode, type InboxEvent, type InboxRefund, type InboxSub } from '../../src/lib/adminBillingLogic.js';
import { paymentConcept, receiptNumber, saleStatus, shortHash } from '../../src/lib/paymentsLogic.js';
import type { PaymentRow } from '../../src/lib/paymentsApi.js';
import type { PaypalDb } from './db.js';
import type { EventRecord, InboxSubRecord, ReportsDb, SaleRecord } from './reportsDb.js';

const PAYMENTS_LIMIT = 100;
/** Una suscripción pending reciente se muestra como pago pendiente; más vieja, es un intento abandonado. */
const PENDING_VISIBLE_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const EVENTS_WINDOW_DAYS = 90;
const SUMMARY_RECEIPTS_DEFAULT = 20;
const SUMMARY_RECEIPTS_MAX = 50;
const NOTE_MAX = 240;
const ITEM_KEY = /^[a-z]+(:[A-Za-z0-9_-]{1,64}){1,4}$/;

const channelName = (r: { display_name: string | null; twitch_login: string | null }): string => r.display_name?.trim() || r.twitch_login?.trim() || 'Sin nombre';
const eventAt = (e: EventRecord): string => e.processed_at ?? e.claimed_at;
const ago = (now: Date, ms: number): string => new Date(now.getTime() - ms).toISOString();

// ---------- Creador ----------

export async function paymentsBody(db: PaypalDb, reports: ReportsDb, profileId: string, now: Date): Promise<IntegrationResult> {
  const [sales, subs, plans] = await Promise.all([reports.salesForProfile(profileId, PAYMENTS_LIMIT), db.profileSubscriptions(profileId), db.plans()]);
  const planName = (id: string) => plans.find((p) => p.id === id)?.name ?? id;
  const failedEvents = await reports.eventsFor(
    subs.map((s) => s.paypal_subscription_id),
    'PAYMENT.FAILED',
    50
  );

  const rows: PaymentRow[] = sales.map((sale) => {
    const receipt = receiptNumber(sale.sale_id, sale.created_at);
    return {
      id: receipt,
      receipt,
      date: sale.created_at,
      concept: paymentConcept(sale.plan_name ?? planName(sale.plan_id), sale.months),
      amount: sale.amount,
      currency: sale.currency ?? 'USD',
      status: saleStatus({ reversedAt: sale.reversed_at, refundedAmount: sale.refunded_amount }),
      refundedAmount: sale.refunded_amount,
    };
  });

  for (const event of failedEvents) {
    const sub = subs.find((s) => s.paypal_subscription_id === event.subscription_id);
    if (!sub) continue;
    rows.push({
      id: `F-${shortHash(event.paypal_event_id)}`,
      receipt: null,
      date: eventAt(event),
      concept: paymentConcept(planName(sub.plan_id), sub.months),
      amount: sub.price_usd,
      currency: 'USD',
      status: 'failed',
      refundedAmount: 0,
    });
  }

  for (const sub of subs) {
    if (sub.status !== 'pending' || now.getTime() - Date.parse(sub.started_at) > PENDING_VISIBLE_MS) continue;
    rows.push({
      id: `P-${shortHash(sub.id)}`,
      receipt: null,
      date: sub.started_at,
      concept: paymentConcept(planName(sub.plan_id), sub.months),
      amount: sub.price_usd,
      currency: 'USD',
      status: 'pending',
      refundedAmount: 0,
    });
  }

  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  // Próximo cobro: la suscripción activa (con renovación automática) con fecha futura
  const upcoming = subs
    .filter((s) => s.status === 'active' && s.paid_until && Date.parse(s.paid_until) > now.getTime())
    .sort((a, b) => Date.parse(a.paid_until as string) - Date.parse(b.paid_until as string))[0];

  return {
    status: 200,
    body: {
      payments: rows.slice(0, PAYMENTS_LIMIT),
      nextCharge: upcoming ? { date: upcoming.paid_until, amount: upcoming.price_usd, currency: 'USD', concept: paymentConcept(planName(upcoming.plan_id), upcoming.months) } : null,
    },
  };
}

// ---------- Administrador: bandeja ----------

const toInboxSub = (r: InboxSubRecord): InboxSub => ({
  id: r.id,
  paypalId: r.paypal_subscription_id,
  status: r.status,
  creator: channelName(r),
  planName: r.plan_name ?? r.plan_id,
  months: r.months,
  priceUsd: r.price_usd,
  paidUntil: r.paid_until,
  startedAt: r.started_at,
  updatedAt: r.updated_at,
});

const toInboxEvent = (e: EventRecord): InboxEvent => ({
  id: e.paypal_event_id,
  type: e.type,
  paypalSubscriptionId: e.subscription_id,
  status: e.status,
  claimedAt: e.claimed_at,
  processedAt: e.processed_at,
});

const toInboxRefund = (r: { ref: string; kind: 'refund' | 'reversal'; at: string; amount: number | null; sale: SaleRecord }): InboxRefund => ({
  ref: r.ref,
  kind: r.kind,
  at: r.at,
  amount: r.amount,
  currency: r.sale.currency ?? 'USD',
  creator: channelName(r.sale),
  planName: r.sale.plan_name ?? r.sale.plan_id,
  months: r.sale.months,
  paypalSubscriptionId: r.sale.paypal_subscription_id || null,
});

async function loadInbox(db: PaypalDb, reports: ReportsDb, now: Date) {
  const [subs, codeAccess, events, refunds, resolved] = await Promise.all([
    reports.inboxSubscriptions(),
    db.codeAccess(now.toISOString(), 200),
    reports.eventsSince(ago(now, EVENTS_WINDOW_DAYS * DAY_MS), 1000),
    reports.refundsSince(ago(now, REFUND_WINDOW_DAYS * DAY_MS)),
    reports.resolvedKeys(),
  ]);
  const codes: InboxCode[] = codeAccess.map((c) => ({
    profileId: c.profile_id,
    creator: channelName(c),
    planName: c.plan_name ?? c.plan_id,
    expiresAt: c.expires_at,
    fromCode: !!c.invite_code,
  }));
  const items = classifyInbox({ now, subs: subs.map(toInboxSub), codes, events: events.map(toInboxEvent), refunds: refunds.map(toInboxRefund), resolved });
  return { items, resolved };
}

export async function adminInboxBody(db: PaypalDb, reports: ReportsDb, now: Date): Promise<IntegrationResult> {
  const { items } = await loadInbox(db, reports, now);
  return { status: 200, body: { items, counts: inboxCounts(items) } };
}

export async function adminInboxResolve(req: IntegrationRequest, db: PaypalDb, reports: ReportsDb, actorId: string, now: Date): Promise<IntegrationResult> {
  let raw: unknown = req.body;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = {};
    }
  }
  const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const key = typeof body.key === 'string' ? body.key.trim() : '';
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, NOTE_MAX) : '';
  if (!key || key.length > 160 || !ITEM_KEY.test(key)) return fail(400, 'bad_key', 'Ítem no válido.');

  const { items, resolved } = await loadInbox(db, reports, now);
  // Solo se resuelve lo que está en la bandeja (o ya estaba resuelto: idempotente)
  if (!items.some((item) => item.key === key) && !resolved.has(key)) return fail(404, 'not_found', 'Ese ítem ya no está en la bandeja.');
  const result = await reports.resolve({ key, actorId, note });
  const remaining = items.filter((item) => item.key !== key);
  return { status: 200, body: { ok: true, key, result, items: remaining, counts: inboxCounts(remaining) } };
}

// ---------- Administrador: facturación ----------

export async function adminBillingSummaryBody(req: IntegrationRequest, reports: ReportsDb, now: Date): Promise<IntegrationResult> {
  const requested = Number(typeof req.query?.receipts === 'string' ? req.query.receipts : SUMMARY_RECEIPTS_DEFAULT);
  const receiptsLimit = Number.isInteger(requested) && requested >= 1 ? Math.min(requested, SUMMARY_RECEIPTS_MAX) : SUMMARY_RECEIPTS_DEFAULT;
  // Desde el día 1 de hace 5 meses (UTC): los 6 meses del gráfico
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1)).toISOString();
  const [sales, subs] = await Promise.all([reports.salesSince(since), reports.payingSubscriptions()]);
  const summary = buildBillingSummary({
    now,
    sales: sales.map((s) => ({
      saleId: s.sale_id,
      createdAt: s.created_at,
      amount: s.amount,
      currency: s.currency,
      refundedAmount: s.refunded_amount,
      reversedAt: s.reversed_at,
      months: s.months,
      planName: s.plan_name ?? s.plan_id,
      creator: channelName(s),
    })),
    subs: subs.map((s) => ({ status: s.status, planId: s.plan_id, planName: s.plan_name ?? s.plan_id, months: s.months, priceUsd: s.price_usd, paidUntil: s.paid_until })),
    receiptsLimit,
  });
  return { status: 200, body: { ...summary } };
}
