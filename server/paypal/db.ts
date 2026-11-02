/**
 * server/paypal/db.ts
 *
 * Lo que el cobro lee y escribe en Supabase, siempre con la clave de servicio.
 * Va detrás de una interfaz para que las pruebas usen una memoria.
 *
 * SIN PROBAR contra Supabase real.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { MigrationMissingError, type Env } from '../integrations/store.js';
import type { SubStatus } from './logic.js';

export interface PlanRow {
  id: string;
  name: string;
  is_default: boolean;
  /** Desde 0048: archivado = fuera del catálogo y de las suscripciones nuevas. */
  archived?: boolean;
}

export interface PriceRow {
  id: string;
  plan_id: string;
  months: number;
  price_usd: number;
  active: boolean;
  paypal_plan_id: string | null;
  archived: boolean;
}

export interface SubscriptionRow {
  id: string;
  profile_id: string;
  plan_id: string;
  months: number;
  price_usd: number;
  paypal_subscription_id: string;
  status: SubStatus;
  started_at: string;
  paid_until: string | null;
  last_payment_at: string | null;
  /** Momento del último evento de PayPal aplicado (0050): los eventos más viejos no cambian el estado. */
  last_event_time?: string | null;
}

export interface AdminSubscriptionRow {
  id: string;
  profile_id: string;
  twitch_login: string | null;
  display_name: string | null;
  plan_id: string;
  plan_name: string | null;
  months: number;
  status: SubStatus;
  started_at: string;
  paid_until: string | null;
  last_payment_at: string | null;
  price_usd: number;
  /** updated_at: criterio de orden («actividad reciente») y cursor de paginación. */
  updated_at: string;
}

export interface CodeAccessRow {
  profile_id: string;
  twitch_login: string | null;
  display_name: string | null;
  plan_id: string;
  plan_name: string | null;
  expires_at: string;
  invite_code: string | null;
}

/** Cursor de paginación del panel: (updated_at, id). `updatedAt` se conserva como lo dio la base (sin truncar a ms); `id` null = cursor antiguo (solo fecha). */
export interface AdminCursor {
  updatedAt: string;
  id: string | null;
}

/** El índice único parcial de 0051 saltó: el perfil ya tiene una suscripción pending/active/grace/suspended. */
export class DuplicateSubscriptionError extends Error {
  constructor() {
    super('duplicate_subscription');
  }
}

/** Un evento «processing» más viejo que esto se considera abandonado (corte a mitad) y se retoma. */
export const EVENT_CLAIM_TTL_MS = 5 * 60 * 1000;

export interface PaypalDb {
  plans(): Promise<PlanRow[]>;
  /** Precios no archivados (activos o no). */
  prices(): Promise<PriceRow[]>;
  insertPrice(row: { plan_id: string; months: number; price_usd: number; active: boolean }): Promise<void>;
  updatePrice(id: string, patch: Partial<Pick<PriceRow, 'price_usd' | 'active' | 'paypal_plan_id' | 'archived'>>): Promise<void>;
  setting(key: string): Promise<string | null>;
  putSetting(key: string, value: string): Promise<void>;
  insertSubscription(row: Omit<SubscriptionRow, 'id' | 'paid_until' | 'last_payment_at' | 'last_event_time'>): Promise<void>;
  subscriptionByPaypalId(paypalId: string): Promise<SubscriptionRow | null>;
  /** La suscripción más reciente del perfil que no esté pendiente; si no hay, la pendiente más reciente. */
  currentSubscription(profileId: string): Promise<SubscriptionRow | null>;
  /** Todas las suscripciones del perfil, de la más reciente a la más antigua. */
  profileSubscriptions(profileId: string): Promise<SubscriptionRow[]>;
  updateSubscription(paypalId: string, patch: Partial<Pick<SubscriptionRow, 'status' | 'paid_until' | 'last_payment_at' | 'last_event_time'>>): Promise<void>;
  /**
   * Acredita una venta de forma atómica (billing_apply_payment): registra la venta, suma el periodo y da el plan al perfil.
   * Una venta ya registrada no suma de nuevo.
   */
  applyPayment(input: { saleId: string; paypalSubscriptionId: string; amount: number | null; currency: string | null; eventTime: string }): Promise<'applied' | 'duplicate' | 'unknown_subscription'>;
  /**
   * Reembolso o reverso de una venta (billing_reverse_sale, 0051). Total/reverso: resta el periodo acreditado; parcial: solo registra.
   * `refundId` (resource.id del REFUNDED; en un reverso, el id de la venta) hace idempotente la suma de lo reembolsado.
   */
  reverseSale(input: { saleId: string; refundId: string; amount: number | null; reversal: boolean; eventTime: string }): Promise<'applied' | 'partial' | 'duplicate' | 'unknown_sale'>;
  /** Suscripción a la que pertenece una venta registrada, o null. */
  subscriptionBySale(saleId: string): Promise<SubscriptionRow | null>;
  /** Reserva el evento como «processing». «done»: ya aplicado; «busy»: otro lo está procesando hace menos de 5 min. Retoma uno «processing» viejo. */
  claimEvent(event: { id: string; type: string; subscriptionId: string | null; payload: Record<string, unknown> }, now: Date): Promise<'claimed' | 'done' | 'busy'>;
  /** Marca el evento como «done» tras aplicarlo. */
  completeEvent(eventId: string): Promise<void>;
  /** Libera un evento «processing» para que el reintento de PayPal pueda procesarlo. */
  releaseEvent(eventId: string): Promise<void>;
  /** Llama a billing_expire_due(). */
  expireDue(): Promise<number>;
  /** Suscripciones con perfil y plan, de la más reciente a la más antigua (updated_at desc, id desc), posteriores en ese orden al cursor `before`. */
  adminSubscriptions(limit: number, before: AdminCursor | null): Promise<AdminSubscriptionRow[]>;
  /** Cuántas suscripciones hay en cada estado. */
  subscriptionTotals(): Promise<Record<SubStatus, number>>;
  /** Perfiles con plan por código vigente (plan_expires_at futuro y sin suscripción de pago con acceso); el filtro va en la consulta, antes del límite. */
  codeAccess(nowIso: string, limit: number): Promise<CodeAccessRow[]>;
}

const MISSING_CODES = ['42P01', '42883', 'PGRST205', 'PGRST202', '42703'];

function check(error: { code?: string; message: string } | null): void {
  if (!error) return;
  if (MISSING_CODES.includes(error.code ?? '')) throw new MigrationMissingError();
  throw new Error(`Supabase: ${error.code ?? 'error'}`);
}

const num = (value: unknown): number => Number(value);
/** supabase-js devuelve una relación como objeto o como arreglo de uno según la inferencia. */
const one = <T>(value: unknown): T | null => (Array.isArray(value) ? ((value[0] as T) ?? null) : ((value as T) ?? null));

export function supabasePaypalDb(env: Env): PaypalDb | null {
  const url = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '').trim();
  const key = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!url || !key) return null;
  const db: SupabaseClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const priceOf = (r: Record<string, unknown>): PriceRow => ({ ...(r as unknown as PriceRow), price_usd: num(r.price_usd) });
  const subOf = (r: Record<string, unknown>): SubscriptionRow => ({ ...(r as unknown as SubscriptionRow), price_usd: num(r.price_usd) });

  return {
    async plans() {
      const { data, error } = await db.from('plans').select('id, name, is_default, archived').order('name');
      check(error);
      return (data ?? []) as PlanRow[];
    },
    async prices() {
      const { data, error } = await db.from('billing_prices').select('*').eq('archived', false);
      check(error);
      return ((data ?? []) as Record<string, unknown>[]).map(priceOf);
    },
    async insertPrice(row) {
      const { error } = await db.from('billing_prices').insert(row);
      check(error);
    },
    async updatePrice(id, patch) {
      const { error } = await db.from('billing_prices').update(patch).eq('id', id);
      check(error);
    },
    async setting(name) {
      const { data, error } = await db.from('app_settings').select('value').eq('key', name).maybeSingle();
      check(error);
      return (data as { value: string } | null)?.value ?? null;
    },
    async putSetting(name, value) {
      const { error } = await db.from('app_settings').upsert({ key: name, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      check(error);
    },
    async insertSubscription(row) {
      const { error } = await db.from('billing_subscriptions').insert(row);
      // Índice único parcial (0051): dos suscripciones vivas del mismo perfil
      if (error?.code === '23505') throw new DuplicateSubscriptionError();
      check(error);
    },
    async subscriptionByPaypalId(paypalId) {
      const { data, error } = await db.from('billing_subscriptions').select('*').eq('paypal_subscription_id', paypalId).maybeSingle();
      check(error);
      return data ? subOf(data as Record<string, unknown>) : null;
    },
    async currentSubscription(profileId) {
      const { data, error } = await db
        .from('billing_subscriptions')
        .select('*')
        .eq('profile_id', profileId)
        .order('created_at', { ascending: false })
        .limit(20);
      check(error);
      const rows = ((data ?? []) as Record<string, unknown>[]).map(subOf);
      return rows.find((r) => r.status !== 'pending') ?? rows[0] ?? null;
    },
    async updateSubscription(paypalId, patch) {
      const { error } = await db
        .from('billing_subscriptions')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('paypal_subscription_id', paypalId);
      check(error);
    },
    async profileSubscriptions(profileId) {
      const { data, error } = await db.from('billing_subscriptions').select('*').eq('profile_id', profileId).order('created_at', { ascending: false }).limit(100);
      check(error);
      return ((data ?? []) as Record<string, unknown>[]).map(subOf);
    },
    async applyPayment(input) {
      const { data, error } = await db.rpc('billing_apply_payment', {
        p_sale_id: input.saleId,
        p_paypal_subscription_id: input.paypalSubscriptionId,
        p_amount: input.amount,
        p_currency: input.currency,
        p_event_time: input.eventTime,
      });
      check(error);
      if (data !== 'applied' && data !== 'duplicate' && data !== 'unknown_subscription') throw new Error('Supabase: respuesta inesperada');
      return data;
    },
    async reverseSale(input) {
      const { data, error } = await db.rpc('billing_reverse_sale', {
        p_sale_id: input.saleId,
        p_refund_id: input.refundId,
        p_amount: input.amount,
        p_reversal: input.reversal,
        p_event_time: input.eventTime,
      });
      check(error);
      if (data !== 'applied' && data !== 'partial' && data !== 'duplicate' && data !== 'unknown_sale') throw new Error('Supabase: respuesta inesperada');
      return data;
    },
    async subscriptionBySale(saleId) {
      const { data: sale, error } = await db.from('billing_sales').select('subscription_id').eq('sale_id', saleId).maybeSingle();
      check(error);
      const subscriptionId = (sale as { subscription_id: string } | null)?.subscription_id;
      if (!subscriptionId) return null;
      const { data, error: subError } = await db.from('billing_subscriptions').select('*').eq('id', subscriptionId).maybeSingle();
      check(subError);
      return data ? subOf(data as Record<string, unknown>) : null;
    },
    async claimEvent(event, now) {
      const nowIso = now.toISOString();
      const { error } = await db
        .from('billing_events')
        .insert({ paypal_event_id: event.id, type: event.type, subscription_id: event.subscriptionId, payload: event.payload, status: 'processing', claimed_at: nowIso });
      if (!error) return 'claimed';
      if (error.code !== '23505') check(error);
      const { data, error: readError } = await db.from('billing_events').select('status, claimed_at').eq('paypal_event_id', event.id).maybeSingle();
      check(readError);
      // Se liberó entre medias: que PayPal reintente
      if (!data) return 'busy';
      const row = data as { status: string; claimed_at: string };
      if (row.status === 'done') return 'done';
      if (now.getTime() - Date.parse(row.claimed_at) < EVENT_CLAIM_TTL_MS) return 'busy';
      // «processing» abandonado: se retoma con una actualización condicional (solo uno gana)
      const { data: taken, error: takeError } = await db
        .from('billing_events')
        .update({ claimed_at: nowIso })
        .eq('paypal_event_id', event.id)
        .eq('status', 'processing')
        .eq('claimed_at', row.claimed_at)
        .select('paypal_event_id');
      check(takeError);
      return (taken ?? []).length > 0 ? 'claimed' : 'busy';
    },
    async completeEvent(eventId) {
      const { error } = await db.from('billing_events').update({ status: 'done', processed_at: new Date().toISOString() }).eq('paypal_event_id', eventId);
      check(error);
    },
    async releaseEvent(eventId) {
      await db.from('billing_events').delete().eq('paypal_event_id', eventId).eq('status', 'processing');
    },
    async adminSubscriptions(limit, before) {
      let q = db
        .from('billing_subscriptions')
        .select('id, profile_id, plan_id, months, status, started_at, paid_until, last_payment_at, price_usd, updated_at, profiles(twitch_login, display_name), plans(name)')
        .order('updated_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit);
      if (before?.id) {
        // Cursor compuesto: el string de updated_at va tal cual (microsegundos incluidos); el handler ya validó el formato
        q = q.or(`updated_at.lt.${before.updatedAt},and(updated_at.eq.${before.updatedAt},id.lt.${before.id})`);
      } else if (before) {
        q = q.lt('updated_at', before.updatedAt);
      }
      const { data, error } = await q;
      check(error);
      return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => {
        const prof = one<{ twitch_login: string | null; display_name: string | null }>(r.profiles);
        const plan = one<{ name: string }>(r.plans);
        return {
          id: String(r.id),
          profile_id: String(r.profile_id),
          twitch_login: prof?.twitch_login ?? null,
          display_name: prof?.display_name ?? null,
          plan_id: String(r.plan_id),
          plan_name: plan?.name ?? null,
          months: num(r.months),
          status: r.status as SubStatus,
          started_at: String(r.started_at),
          paid_until: (r.paid_until as string | null) ?? null,
          last_payment_at: (r.last_payment_at as string | null) ?? null,
          price_usd: num(r.price_usd),
          updated_at: String(r.updated_at),
        };
      });
    },
    async subscriptionTotals() {
      const statuses: SubStatus[] = ['active', 'grace', 'cancelled', 'suspended', 'expired', 'pending'];
      const counts = await Promise.all(
        statuses.map(async (status) => {
          const { count, error } = await db.from('billing_subscriptions').select('id', { count: 'exact', head: true }).eq('status', status);
          check(error);
          return count ?? 0;
        })
      );
      return Object.fromEntries(statuses.map((s, i) => [s, counts[i]])) as Record<SubStatus, number>;
    },
    async codeAccess(nowIso, limit) {
      // billing_code_access (0051) excluye con NOT EXISTS a quien paga y SOLO después limita: 200 suscriptores de pago no tapan los accesos por código
      const { data, error } = await db.rpc('billing_code_access', { p_now: nowIso, p_limit: limit });
      check(error);
      return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        profile_id: String(r.profile_id),
        twitch_login: (r.twitch_login as string | null) ?? null,
        display_name: (r.display_name as string | null) ?? null,
        plan_id: String(r.plan_id),
        plan_name: (r.plan_name as string | null) ?? null,
        expires_at: String(r.plan_expires_at),
        invite_code: (r.invite_code as string | null) ?? null,
      }));
    },
    async expireDue() {
      const { data, error } = await db.rpc('billing_expire_due');
      check(error);
      return num(data) || 0;
    },
  };
}
