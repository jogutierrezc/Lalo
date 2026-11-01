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
}

export interface PaypalDb {
  plans(): Promise<PlanRow[]>;
  /** Precios no archivados (activos o no). */
  prices(): Promise<PriceRow[]>;
  insertPrice(row: { plan_id: string; months: number; price_usd: number; active: boolean }): Promise<void>;
  updatePrice(id: string, patch: Partial<Pick<PriceRow, 'price_usd' | 'active' | 'paypal_plan_id' | 'archived'>>): Promise<void>;
  setting(key: string): Promise<string | null>;
  putSetting(key: string, value: string): Promise<void>;
  insertSubscription(row: Omit<SubscriptionRow, 'id' | 'paid_until' | 'last_payment_at'>): Promise<void>;
  subscriptionByPaypalId(paypalId: string): Promise<SubscriptionRow | null>;
  /** La suscripción más reciente del perfil que no esté pendiente; si no hay, la pendiente más reciente. */
  currentSubscription(profileId: string): Promise<SubscriptionRow | null>;
  updateSubscription(paypalId: string, patch: Partial<Pick<SubscriptionRow, 'status' | 'paid_until' | 'last_payment_at'>>): Promise<void>;
  /** Pone el plan de pago del perfil y hasta cuándo vale. */
  grantPlan(profileId: string, planId: string, expiresAt: string): Promise<void>;
  /** Reserva el id del evento. False si ya estaba (aviso repetido). */
  claimEvent(event: { id: string; type: string; subscriptionId: string | null; payload: Record<string, unknown> }): Promise<boolean>;
  releaseEvent(eventId: string): Promise<void>;
  /** Llama a billing_expire_due(). */
  expireDue(): Promise<number>;
}

const MISSING_CODES = ['42P01', '42883', 'PGRST205', 'PGRST202', '42703'];

function check(error: { code?: string; message: string } | null): void {
  if (!error) return;
  if (MISSING_CODES.includes(error.code ?? '')) throw new MigrationMissingError();
  throw new Error(`Supabase: ${error.code ?? 'error'}`);
}

const num = (value: unknown): number => Number(value);

export function supabasePaypalDb(env: Env): PaypalDb | null {
  const url = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '').trim();
  const key = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!url || !key) return null;
  const db: SupabaseClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const priceOf = (r: Record<string, unknown>): PriceRow => ({ ...(r as unknown as PriceRow), price_usd: num(r.price_usd) });
  const subOf = (r: Record<string, unknown>): SubscriptionRow => ({ ...(r as unknown as SubscriptionRow), price_usd: num(r.price_usd) });

  return {
    async plans() {
      const { data, error } = await db.from('plans').select('id, name, is_default').order('name');
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
    async grantPlan(profileId, planId, expiresAt) {
      const { error } = await db.from('profiles').update({ plan_id: planId, plan_expires_at: expiresAt }).eq('id', profileId);
      check(error);
    },
    async claimEvent(event) {
      const { error } = await db
        .from('billing_events')
        .insert({ paypal_event_id: event.id, type: event.type, subscription_id: event.subscriptionId, payload: event.payload });
      if (error?.code === '23505') return false;
      check(error);
      return true;
    },
    async releaseEvent(eventId) {
      await db.from('billing_events').delete().eq('paypal_event_id', eventId);
    },
    async expireDue() {
      const { data, error } = await db.rpc('billing_expire_due');
      check(error);
      return num(data) || 0;
    },
  };
}
