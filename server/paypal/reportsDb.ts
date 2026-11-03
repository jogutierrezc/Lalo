/**
 * server/paypal/reportsDb.ts
 *
 * Lecturas (y la única escritura: resolver un ítem) del historial de pagos, la bandeja y la
 * facturación. Siempre con la clave de servicio; va detrás de una interfaz para que las pruebas
 * usen una memoria. Es aparte de PaypalDb para no tocar el contrato del webhook.
 *
 * Los registros incluyen ids de PayPal: el manejador decide qué sale al creador (nada) y al administrador.
 *
 * SIN PROBAR contra Supabase real.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { MigrationMissingError, type Env } from '../integrations/store.js';

/** Una venta (billing_sales) con su suscripción, plan y perfil. */
export interface SaleRecord {
  sale_id: string;
  created_at: string;
  amount: number | null;
  currency: string | null;
  refunded_amount: number;
  reversed_at: string | null;
  months: number;
  plan_id: string;
  plan_name: string | null;
  profile_id: string;
  twitch_login: string | null;
  display_name: string | null;
  paypal_subscription_id: string;
}

export interface EventRecord {
  paypal_event_id: string;
  type: string;
  subscription_id: string | null;
  status: 'processing' | 'done';
  claimed_at: string;
  processed_at: string | null;
}

export interface InboxSubRecord {
  id: string;
  paypal_subscription_id: string;
  status: string;
  months: number;
  price_usd: number;
  plan_id: string;
  plan_name: string | null;
  twitch_login: string | null;
  display_name: string | null;
  paid_until: string | null;
  started_at: string;
  updated_at: string;
}

/** Un reembolso (billing_refunds) o un reverso (billing_sales.reversed_at) reciente, con su venta. */
export interface RefundRecord {
  ref: string;
  kind: 'refund' | 'reversal';
  at: string;
  amount: number | null;
  sale: SaleRecord;
}

export interface ReportsDb {
  /** Ventas del perfil, de la más reciente a la más antigua. */
  salesForProfile(profileId: string, limit: number): Promise<SaleRecord[]>;
  /** Ventas desde la fecha (todas las páginas, con tope), de la más reciente a la más antigua. */
  salesSince(sinceIso: string): Promise<SaleRecord[]>;
  /** Avisos de ese tipo de las suscripciones de PayPal dadas, del más reciente al más antiguo. */
  eventsFor(paypalSubscriptionIds: string[], type: string, limit: number): Promise<EventRecord[]>;
  /** Avisos reclamados desde la fecha, del más reciente al más antiguo. */
  eventsSince(sinceIso: string, limit: number): Promise<EventRecord[]>;
  /** Suscripciones que pueden requerir atención: pending, active, grace, suspended y cancelled. */
  inboxSubscriptions(): Promise<InboxSubRecord[]>;
  /** Suscripciones active y grace (facturación). */
  payingSubscriptions(): Promise<InboxSubRecord[]>;
  /** Reembolsos y reversos desde la fecha. */
  refundsSince(sinceIso: string): Promise<RefundRecord[]>;
  /** Claves de ítems de la bandeja ya resueltos. */
  resolvedKeys(): Promise<Set<string>>;
  /** Marca un ítem como resuelto (billing_inbox_resolve): idempotente. */
  resolve(input: { key: string; actorId: string; note: string }): Promise<'resolved' | 'duplicate'>;
}

const MISSING_CODES = ['42P01', '42883', 'PGRST205', 'PGRST202', '42703'];
const PAGE = 1000;
const MAX_PAGES = 20;

function check(error: { code?: string; message: string } | null): void {
  if (!error) return;
  if (MISSING_CODES.includes(error.code ?? '')) throw new MigrationMissingError();
  throw new Error(`Supabase: ${error.code ?? 'error'}`);
}

const num = (value: unknown): number => Number(value);
const one = <T>(value: unknown): T | null => (Array.isArray(value) ? ((value[0] as T) ?? null) : ((value as T) ?? null));

const SALE_SELECT =
  'sale_id, created_at, amount, currency, refunded_amount, reversed_at, months_credited, billing_subscriptions!inner(months, plan_id, profile_id, paypal_subscription_id, profiles(twitch_login, display_name), plans(name))';

function saleOf(r: Record<string, unknown>): SaleRecord {
  const sub = one<Record<string, unknown>>(r.billing_subscriptions) ?? {};
  const prof = one<{ twitch_login: string | null; display_name: string | null }>(sub.profiles);
  const plan = one<{ name: string }>(sub.plans);
  return {
    sale_id: String(r.sale_id),
    created_at: String(r.created_at),
    amount: r.amount === null || r.amount === undefined ? null : num(r.amount),
    currency: (r.currency as string | null) ?? null,
    refunded_amount: num(r.refunded_amount) || 0,
    reversed_at: (r.reversed_at as string | null) ?? null,
    months: num(sub.months) || num(r.months_credited) || 1,
    plan_id: String(sub.plan_id ?? ''),
    plan_name: plan?.name ?? null,
    profile_id: String(sub.profile_id ?? ''),
    twitch_login: prof?.twitch_login ?? null,
    display_name: prof?.display_name ?? null,
    paypal_subscription_id: String(sub.paypal_subscription_id ?? ''),
  };
}

function eventOf(r: Record<string, unknown>): EventRecord {
  return {
    paypal_event_id: String(r.paypal_event_id),
    type: String(r.type),
    subscription_id: (r.subscription_id as string | null) ?? null,
    status: r.status === 'processing' ? 'processing' : 'done',
    claimed_at: String(r.claimed_at),
    processed_at: (r.processed_at as string | null) ?? null,
  };
}

const SUB_SELECT = 'id, paypal_subscription_id, status, months, price_usd, plan_id, paid_until, started_at, updated_at, profiles(twitch_login, display_name), plans(name)';

function subOf(r: Record<string, unknown>): InboxSubRecord {
  const prof = one<{ twitch_login: string | null; display_name: string | null }>(r.profiles);
  const plan = one<{ name: string }>(r.plans);
  return {
    id: String(r.id),
    paypal_subscription_id: String(r.paypal_subscription_id),
    status: String(r.status),
    months: num(r.months),
    price_usd: num(r.price_usd),
    plan_id: String(r.plan_id),
    plan_name: plan?.name ?? null,
    twitch_login: prof?.twitch_login ?? null,
    display_name: prof?.display_name ?? null,
    paid_until: (r.paid_until as string | null) ?? null,
    started_at: String(r.started_at),
    updated_at: String(r.updated_at),
  };
}

export function supabaseReportsDb(env: Env): ReportsDb | null {
  const url = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '').trim();
  const key = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!url || !key) return null;
  const db: SupabaseClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  return {
    async salesForProfile(profileId, limit) {
      const { data, error } = await db
        .from('billing_sales')
        .select(SALE_SELECT)
        .eq('billing_subscriptions.profile_id', profileId)
        .order('created_at', { ascending: false })
        .limit(limit);
      check(error);
      return ((data ?? []) as unknown as Record<string, unknown>[]).map(saleOf);
    },
    async salesSince(sinceIso) {
      const out: SaleRecord[] = [];
      // PostgREST devuelve como mucho 1000 filas por petición: se pagina con range()
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const { data, error } = await db
          .from('billing_sales')
          .select(SALE_SELECT)
          .gte('created_at', sinceIso)
          .order('created_at', { ascending: false })
          .order('sale_id', { ascending: false })
          .range(page * PAGE, page * PAGE + PAGE - 1);
        check(error);
        const rows = (data ?? []) as unknown as Record<string, unknown>[];
        out.push(...rows.map(saleOf));
        if (rows.length < PAGE) break;
      }
      return out;
    },
    async eventsFor(paypalSubscriptionIds, type, limit) {
      if (paypalSubscriptionIds.length === 0) return [];
      const { data, error } = await db
        .from('billing_events')
        .select('paypal_event_id, type, subscription_id, status, claimed_at, processed_at')
        .eq('type', type)
        .in('subscription_id', paypalSubscriptionIds)
        .order('claimed_at', { ascending: false })
        .limit(limit);
      check(error);
      return ((data ?? []) as Record<string, unknown>[]).map(eventOf);
    },
    async eventsSince(sinceIso, limit) {
      const { data, error } = await db
        .from('billing_events')
        .select('paypal_event_id, type, subscription_id, status, claimed_at, processed_at')
        .gte('claimed_at', sinceIso)
        .order('claimed_at', { ascending: false })
        .limit(limit);
      check(error);
      return ((data ?? []) as Record<string, unknown>[]).map(eventOf);
    },
    async inboxSubscriptions() {
      const { data, error } = await db
        .from('billing_subscriptions')
        .select(SUB_SELECT)
        .in('status', ['pending', 'active', 'grace', 'suspended', 'cancelled'])
        .order('updated_at', { ascending: false })
        .limit(1000);
      check(error);
      return ((data ?? []) as unknown as Record<string, unknown>[]).map(subOf);
    },
    async payingSubscriptions() {
      const out: InboxSubRecord[] = [];
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const { data, error } = await db
          .from('billing_subscriptions')
          .select(SUB_SELECT)
          .in('status', ['active', 'grace'])
          .order('id')
          .range(page * PAGE, page * PAGE + PAGE - 1);
        check(error);
        const rows = (data ?? []) as unknown as Record<string, unknown>[];
        out.push(...rows.map(subOf));
        if (rows.length < PAGE) break;
      }
      return out;
    },
    async refundsSince(sinceIso) {
      const refunds = await db
        .from('billing_refunds')
        .select(`refund_id, amount, created_at, billing_sales!inner(${SALE_SELECT})`)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(200);
      check(refunds.error);
      const reversals = await db.from('billing_sales').select(SALE_SELECT).gte('reversed_at', sinceIso).order('reversed_at', { ascending: false }).limit(200);
      check(reversals.error);
      const out: RefundRecord[] = [];
      for (const r of (refunds.data ?? []) as unknown as Record<string, unknown>[]) {
        const sale = one<Record<string, unknown>>(r.billing_sales);
        if (!sale) continue;
        out.push({ ref: String(r.refund_id), kind: 'refund', at: String(r.created_at), amount: num(r.amount), sale: saleOf(sale) });
      }
      for (const r of (reversals.data ?? []) as unknown as Record<string, unknown>[]) {
        const sale = saleOf(r);
        out.push({ ref: sale.sale_id, kind: 'reversal', at: sale.reversed_at ?? sale.created_at, amount: sale.amount, sale });
      }
      return out;
    },
    async resolvedKeys() {
      const { data, error } = await db.from('billing_inbox_resolutions').select('item_key').order('resolved_at', { ascending: false }).limit(5000);
      check(error);
      return new Set(((data ?? []) as { item_key: string }[]).map((r) => r.item_key));
    },
    async resolve(input) {
      const { data, error } = await db.rpc('billing_inbox_resolve', { p_item_key: input.key, p_actor: input.actorId, p_note: input.note });
      check(error);
      if (data !== 'resolved' && data !== 'duplicate') throw new Error('Supabase: respuesta inesperada');
      return data;
    },
  };
}
