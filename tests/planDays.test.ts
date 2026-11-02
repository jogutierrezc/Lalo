/** summarizePlan: activo, por vencer, cobro fallido, vencido, regalo de fundador y gratis. */

import { describe, expect, it } from 'vitest';
import { daysLeftText, daysUntil, summarizePlan } from '../src/lib/planDays';
import type { BillingSubscription } from '../src/lib/billingTypes';

const NOW = Date.parse('2026-06-01T12:00:00Z');
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW + days * DAY).toISOString();

const sub = (over: Partial<BillingSubscription>): BillingSubscription => ({
  status: 'active',
  planId: 'pro',
  planName: 'Pro',
  months: 3,
  paidUntil: at(23),
  lastPaymentAt: at(-69),
  startedAt: at(-160),
  ...over,
});
const profile = { plan_expires_at: null, founder_number: null, founder_gift_claimed_at: null };

describe('daysUntil', () => {
  it('redondea hacia arriba y no baja de 0', () => {
    expect(daysUntil(NOW + 1, NOW)).toBe(1);
    expect(daysUntil(NOW + DAY * 2 + 1, NOW)).toBe(3);
    expect(daysUntil(NOW - DAY, NOW)).toBe(0);
    expect(daysUntil(null, NOW)).toBe(0);
  });
});

describe('summarizePlan', () => {
  it('suscripción activa con renovación', () => {
    const s = summarizePlan({ profile, subscription: sub({}), priceUsd: 30, now: NOW });
    expect(s).toMatchObject({ state: 'activo', origin: 'paypal', planName: 'Pro', days: 23, renews: true, nextChargeUsd: 30 });
    expect(s.nextChargeAt).toBe(at(23));
    expect(s.totalDays).toBe(92);
  });

  it('por vencer: 7 días o menos', () => {
    expect(summarizePlan({ profile, subscription: sub({ paidUntil: at(7) }), now: NOW }).state).toBe('porvencer');
  });

  it('por vencer: cancelada con días de acceso, sin renovación', () => {
    const s = summarizePlan({ profile, subscription: sub({ status: 'cancelled', paidUntil: at(20) }), now: NOW });
    expect(s).toMatchObject({ state: 'porvencer', renews: false, nextChargeAt: null, days: 20 });
  });

  it('cobro fallido (gracia)', () => {
    const s = summarizePlan({ profile, subscription: sub({ status: 'grace', paidUntil: at(2) }), now: NOW });
    expect(s).toMatchObject({ state: 'gracia', origin: 'paypal', days: 2 });
  });

  it('vencido: suscripción expirada o suspendida', () => {
    expect(summarizePlan({ profile, subscription: sub({ status: 'expired', paidUntil: at(-3) }), now: NOW })).toMatchObject({ state: 'vencido', days: 0 });
    expect(summarizePlan({ profile, subscription: sub({ status: 'suspended' }), now: NOW }).state).toBe('vencido');
  });

  it('regalo de fundador', () => {
    const p = { plan_expires_at: at(27), founder_number: 14, founder_gift_claimed_at: at(-3) };
    const s = summarizePlan({ profile: p, planName: 'Creadores Iniciales', now: NOW });
    expect(s).toMatchObject({ state: 'regalo', origin: 'founder', days: 27, renews: false });
  });

  it('acceso por código', () => {
    const s = summarizePlan({ profile, codeAccess: { planName: 'Pro', expiresAt: at(40) }, now: NOW });
    expect(s).toMatchObject({ state: 'activo', origin: 'code', days: 40 });
    expect(summarizePlan({ profile, codeAccess: { planName: 'Pro', expiresAt: at(3) }, now: NOW }).state).toBe('porvencer');
  });

  it('código vencido', () => {
    const s = summarizePlan({ profile: { ...profile, plan_expires_at: at(-1) }, now: NOW });
    expect(s).toMatchObject({ state: 'vencido', origin: 'code', days: 0 });
  });

  it('gratis', () => {
    expect(summarizePlan({ profile, now: NOW })).toMatchObject({ state: 'gratis', origin: 'free', days: 0 });
    expect(summarizePlan({ profile: null, subscription: sub({ status: 'pending' }), now: NOW }).state).toBe('gratis');
  });
});

describe('daysLeftText', () => {
  it('singular, plural y terminado', () => {
    expect(daysLeftText(summarizePlan({ profile, subscription: sub({ paidUntil: at(1) }), now: NOW }))).toBe('Te queda 1 día');
    expect(daysLeftText(summarizePlan({ profile, subscription: sub({}), now: NOW }))).toBe('Te quedan 23 días');
    expect(daysLeftText(summarizePlan({ profile, subscription: sub({ status: 'expired' }), now: NOW }))).toBe('Plan terminado');
  });
});

describe('summarizePlan con próximo cobro del servidor', () => {
  it('el nextCharge manda sobre el precio del catálogo y la fecha de fin', () => {
    const s = summarizePlan({ profile, subscription: sub({}), priceUsd: 30, nextCharge: { date: at(25), amount: 27 }, now: NOW });
    expect(s).toMatchObject({ state: 'activo', nextChargeUsd: 27, nextChargeAt: at(25), days: 23 });
  });

  it('sin nextCharge o con fecha inválida conserva el comportamiento anterior', () => {
    const s = summarizePlan({ profile, subscription: sub({}), priceUsd: 30, nextCharge: { date: 'no-fecha', amount: 27 }, now: NOW });
    expect(s.nextChargeAt).toBe(at(23));
    expect(s.nextChargeUsd).toBe(27);
  });
});
