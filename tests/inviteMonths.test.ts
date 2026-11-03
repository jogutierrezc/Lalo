/**
 * tests/inviteMonths.test.ts
 *
 * Reglas puras de los códigos con duración (migración 0047) y de los planes nuevos (0048):
 * vencimiento por código, convivencia con pagos y validación de admin_create_plan.
 */

import { describe, expect, it } from 'vitest';
import { codeExpiry, isCodeAccess, redeemRefusal } from '../server/paypal/logic';
import { slugifyPlanId, validateNewPlan } from '../src/lib/adminLogic';

const d = (iso: string) => new Date(iso);
const day = (date: Date) => date.toISOString().slice(0, 10);
const NOW = d('2026-11-01T12:00:00Z');

describe('codeExpiry', () => {
  it('sin plan vigente, suma desde hoy', () => {
    expect(day(codeExpiry({ now: NOW, currentPlanId: 'basico', currentExpiresAt: null, codePlanId: 'plus', months: 3 }))).toBe('2027-02-01');
  });

  it('del mismo plan con vencimiento futuro, suma desde ese vencimiento', () => {
    expect(day(codeExpiry({ now: NOW, currentPlanId: 'plus', currentExpiresAt: d('2027-01-15T00:00:00Z'), codePlanId: 'plus', months: 3 }))).toBe('2027-04-15');
  });

  it('de otro plan, ignora el vencimiento vigente', () => {
    expect(day(codeExpiry({ now: NOW, currentPlanId: 'pro', currentExpiresAt: d('2027-06-01T00:00:00Z'), codePlanId: 'plus', months: 1 }))).toBe('2026-12-01');
  });

  it('un vencimiento ya pasado del mismo plan cuenta desde hoy', () => {
    expect(day(codeExpiry({ now: NOW, currentPlanId: 'plus', currentExpiresAt: d('2026-01-01T00:00:00Z'), codePlanId: 'plus', months: 1 }))).toBe('2026-12-01');
  });

  it('respeta el fin de mes', () => {
    expect(day(codeExpiry({ now: d('2026-12-31T00:00:00Z'), currentPlanId: null, currentExpiresAt: null, codePlanId: 'plus', months: 2 }))).toBe('2027-02-28');
  });
});

describe('redeemRefusal', () => {
  const base = {
    profileStatus: 'active',
    hasTwitch: true,
    planId: 'basico',
    planExpiresAt: null as Date | null,
    defaultPlanId: 'basico',
    subscriptions: [] as { status: 'active' | 'grace' | 'cancelled' | 'pending' | 'expired' | 'suspended'; paidUntil: Date | null }[],
    alreadyRedeemed: false,
    now: NOW,
  };

  it('un perfil en el plan por defecto puede canjear', () => {
    expect(redeemRefusal(base)).toBeNull();
    expect(redeemRefusal({ ...base, profileStatus: 'pending', planId: null })).toBeNull();
  });

  it('suspendido y sin Twitch se rechazan', () => {
    expect(redeemRefusal({ ...base, profileStatus: 'suspended' })).toBe('not_pending');
    expect(redeemRefusal({ ...base, hasTwitch: false })).toBe('no_twitch');
  });

  it('con suscripción de pago vigente (activa o en gracia) manda el plan pagado', () => {
    const future = d('2027-01-01T00:00:00Z');
    expect(redeemRefusal({ ...base, subscriptions: [{ status: 'active', paidUntil: future }] })).toBe('has_paid_plan');
    expect(redeemRefusal({ ...base, subscriptions: [{ status: 'grace', paidUntil: future }] })).toBe('has_paid_plan');
  });

  it('una suscripción vencida, cancelada y vencida o pendiente no bloquea; cancelada con periodo pagado vigente sí (0050)', () => {
    expect(redeemRefusal({ ...base, subscriptions: [{ status: 'active', paidUntil: d('2026-01-01T00:00:00Z') }] })).toBeNull();
    expect(redeemRefusal({ ...base, subscriptions: [{ status: 'cancelled', paidUntil: d('2026-01-01T00:00:00Z') }] })).toBeNull();
    expect(redeemRefusal({ ...base, subscriptions: [{ status: 'cancelled', paidUntil: d('2027-01-01T00:00:00Z') }] })).toBe('has_paid_plan');
    expect(redeemRefusal({ ...base, subscriptions: [{ status: 'pending', paidUntil: null }] })).toBeNull();
  });

  it('un plan fijo distinto del de por defecto no se degrada, pero uno temporal sí se puede mejorar', () => {
    expect(redeemRefusal({ ...base, planId: 'pro' })).toBe('has_plan');
    expect(redeemRefusal({ ...base, planId: 'pro', planExpiresAt: d('2027-01-01T00:00:00Z') })).toBeNull();
  });

  it('el mismo código dos veces se rechaza', () => {
    expect(redeemRefusal({ ...base, alreadyRedeemed: true })).toBe('already_redeemed');
  });
});

describe('isCodeAccess', () => {
  it('plan_expires_at futuro y sin pago vigente', () => {
    expect(isCodeAccess(d('2027-01-01T00:00:00Z'), [], NOW)).toBe(true);
  });
  it('vencido o sin fecha no cuenta', () => {
    expect(isCodeAccess(d('2026-01-01T00:00:00Z'), [], NOW)).toBe(false);
    expect(isCodeAccess(null, [], NOW)).toBe(false);
  });
  it('con suscripción de pago vigente no es acceso por código', () => {
    expect(isCodeAccess(d('2027-01-01T00:00:00Z'), [{ status: 'active', paidUntil: d('2027-01-01T00:00:00Z') }], NOW)).toBe(false);
  });
});

describe('validateNewPlan', () => {
  const ok = { id: 'pro-2', name: 'Pro', storageLimitBytes: 1000, maxFileBytes: 100, maxFiles: 10 };

  it('acepta un plan válido y normaliza id y nombre', () => {
    const r = validateNewPlan({ ...ok, id: ' Pro-2 ', name: ' Pro ' });
    expect(r).toEqual({ ok: true, value: { ...ok, luxMonthlyCredits: 0, luxMaxModels: null } });
  });

  it('rechaza ids que no son un slug', () => {
    for (const id of ['', 'Pro Plan', 'pro_plan', '-pro', 'ñu', 'a'.repeat(41)]) expect(validateNewPlan({ ...ok, id }).ok).toBe(false);
  });

  it('el nombre debe tener de 1 a 40 caracteres', () => {
    expect(validateNewPlan({ ...ok, name: '   ' }).ok).toBe(false);
    expect(validateNewPlan({ ...ok, name: 'x'.repeat(41) }).ok).toBe(false);
    expect(validateNewPlan({ ...ok, name: 'x'.repeat(40) }).ok).toBe(true);
  });

  it('los límites son enteros >= 0', () => {
    expect(validateNewPlan({ ...ok, storageLimitBytes: -1 }).ok).toBe(false);
    expect(validateNewPlan({ ...ok, maxFileBytes: 1.5 }).ok).toBe(false);
    expect(validateNewPlan({ ...ok, maxFiles: Number.NaN }).ok).toBe(false);
    expect(validateNewPlan({ ...ok, luxMonthlyCredits: -5 }).ok).toBe(false);
    expect(validateNewPlan({ ...ok, luxMaxModels: -1 }).ok).toBe(false);
    expect(validateNewPlan({ ...ok, storageLimitBytes: 0, maxFiles: 0, luxMaxModels: 0 }).ok).toBe(true);
  });
});

describe('slugifyPlanId', () => {
  it('convierte un nombre en un identificador válido', () => {
    expect(slugifyPlanId('Plan Pro Máximo!')).toBe('plan-pro-maximo');
    expect(slugifyPlanId('  --Ñandú--  ')).toBe('nandu');
  });
});
