/**
 * src/lib/planDays.ts
 *
 * Días restantes del plan del creador. Lógica pura: sin red ni React.
 *
 * Toma el perfil, la suscripción de PayPal (si hay) y el acceso por código, y
 * dice en qué estado está el plan, de dónde viene, cuántos días quedan y
 * cuándo es el próximo cobro. Días = ceil((fecha - ahora) / 86400000), con
 * mínimo 0. «Por vencer» es 7 días o menos, o un plan que no se renueva.
 */

import type { BillingSubscription } from './billingTypes';
import type { ProfileRow } from './cloudTypes';

export type PlanState = 'activo' | 'porvencer' | 'gracia' | 'vencido' | 'regalo' | 'gratis';
export type PlanOrigin = 'paypal' | 'code' | 'founder' | 'gift' | 'free';

export interface PlanSummary {
  state: PlanState;
  origin: PlanOrigin;
  planName: string;
  days: number;
  /** Duración del periodo en días, para el anillo. */
  totalDays: number;
  endsAt: string | null;
  renews: boolean;
  nextChargeAt: string | null;
  nextChargeUsd: number | null;
}

export interface CodeAccessInfo {
  planName?: string | null;
  expiresAt: string;
}

export interface SummarizeInput {
  profile: Pick<ProfileRow, 'plan_expires_at' | 'founder_number' | 'founder_gift_claimed_at'> | null;
  planName?: string | null;
  subscription?: BillingSubscription | null;
  codeAccess?: CodeAccessInfo | null;
  /** Precio del periodo en dólares, si se conoce (para el próximo cobro). */
  priceUsd?: number | null;
  /** Próximo cobro según el servidor (GET /api/paypal/payments). Manda sobre priceUsd y paidUntil. */
  nextCharge?: { date: string; amount: number } | null;
  now?: number | Date;
}

export const DAY_MS = 86_400_000;
export const SOON_DAYS = 7;
const FREE_NAME = 'Gratis';

function toMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** Días enteros hasta una fecha, redondeando hacia arriba. Nunca negativo. */
export function daysUntil(endMs: number | null, nowMs: number): number {
  if (endMs == null) return 0;
  return Math.max(0, Math.ceil((endMs - nowMs) / DAY_MS));
}

function totalFor(days: number, endMs: number | null, startMs: number | null, fallback: number): number {
  const span = endMs != null && startMs != null && endMs > startMs ? Math.ceil((endMs - startMs) / DAY_MS) : fallback;
  return Math.max(span, days, 1);
}

export function summarizePlan(input: SummarizeInput): PlanSummary {
  const nowMs = input.now instanceof Date ? input.now.getTime() : (input.now ?? Date.now());
  const { profile, subscription: sub } = input;
  const named = (fallback: string) => input.planName || fallback;

  // 1. Suscripción de PayPal
  if (sub) {
    const endMs = toMs(sub.paidUntil);
    const startMs = toMs(sub.lastPaymentAt) ?? toMs(sub.startedAt);
    const days = daysUntil(endMs, nowMs);
    const name = sub.planName || named(FREE_NAME);
    const total = totalFor(days, endMs, startMs, Math.max(sub.months, 1) * 30);
    const endsAt = endMs != null ? new Date(endMs).toISOString() : null;

    if (sub.status === 'grace') {
      return { state: 'gracia', origin: 'paypal', planName: name, days, totalDays: total, endsAt, renews: true, nextChargeAt: null, nextChargeUsd: null };
    }
    if (sub.status === 'active' && days > 0) {
      const soon = days <= SOON_DAYS;
      return {
        state: soon ? 'porvencer' : 'activo',
        origin: 'paypal',
        planName: name,
        days,
        totalDays: total,
        endsAt,
        renews: true,
        nextChargeAt: toMs(input.nextCharge?.date) != null ? input.nextCharge!.date : endsAt,
        nextChargeUsd: input.nextCharge?.amount ?? input.priceUsd ?? null,
      };
    }
    if (sub.status === 'cancelled' && days > 0) {
      return { state: 'porvencer', origin: 'paypal', planName: name, days, totalDays: total, endsAt, renews: false, nextChargeAt: null, nextChargeUsd: null };
    }
    if (sub.status !== 'pending') {
      // Terminada, suspendida, vencida o cancelada sin días: sigue con el plan gratis
      return { state: 'vencido', origin: 'paypal', planName: name, days: 0, totalDays: total, endsAt, renews: false, nextChargeAt: null, nextChargeUsd: null };
    }
  }

  // 2. Plan con fecha de fin sin suscripción: regalo de fundador o acceso por código
  const expiresMs = toMs(input.codeAccess?.expiresAt) ?? toMs(profile?.plan_expires_at);
  if (expiresMs != null) {
    const days = daysUntil(expiresMs, nowMs);
    const endsAt = new Date(expiresMs).toISOString();
    const founderGift = !!profile?.founder_gift_claimed_at;
    const origin: PlanOrigin = founderGift ? (profile?.founder_number != null ? 'founder' : 'gift') : 'code';
    const name = input.codeAccess?.planName || named(FREE_NAME);
    const total = totalFor(days, expiresMs, toMs(profile?.founder_gift_claimed_at), 30);
    const base = { origin, planName: name, totalDays: total, endsAt, renews: false, nextChargeAt: null, nextChargeUsd: null };
    if (days <= 0) return { ...base, state: 'vencido', days: 0 };
    if (founderGift) return { ...base, state: 'regalo', days };
    return { ...base, state: days <= SOON_DAYS ? 'porvencer' : 'activo', days };
  }

  // 3. Sin nada de pago
  return { state: 'gratis', origin: 'free', planName: named(FREE_NAME), days: 0, totalDays: 0, endsAt: null, renews: false, nextChargeAt: null, nextChargeUsd: null };
}

/** «Te quedan 5 días», «Te queda 1 día», «Plan terminado». */
export function daysLeftText(summary: PlanSummary): string {
  if (summary.state === 'gratis') return 'Plan gratis';
  if (summary.days <= 0) return 'Plan terminado';
  return summary.days === 1 ? 'Te queda 1 día' : `Te quedan ${summary.days} días`;
}

/** Número y unidad cortos para el chip: «23 d». */
export function daysShort(summary: PlanSummary): string {
  return summary.state === 'gratis' ? 'Gratis' : `${summary.days} d`;
}

/** Etiqueta del estado, en español. */
export const STATE_LABEL: Record<PlanState, string> = {
  activo: 'Activo',
  porvencer: 'Por vencer',
  gracia: 'Cobro fallido',
  vencido: 'Vencido',
  regalo: 'Regalo',
  gratis: 'Gratis',
};

/** Tono del estado para pills y anillo. El malo usa borde discontinuo en la interfaz. */
export const STATE_TONE: Record<PlanState, 'ok' | 'warn' | 'bad' | 'gift' | 'neutral'> = {
  activo: 'ok',
  porvencer: 'warn',
  gracia: 'bad',
  vencido: 'bad',
  regalo: 'gift',
  gratis: 'neutral',
};
