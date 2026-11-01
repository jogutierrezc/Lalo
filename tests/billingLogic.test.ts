import { describe, expect, it } from 'vitest';
import {
  addMonths,
  availablePeriods,
  canCancel,
  canSubscribe,
  defaultPeriod,
  formatDateEs,
  formatMoney,
  isSafeApproveUrl,
  monthlyPrice,
  periodLabel,
  pollExpired,
  readPaypalReturn,
  savingsPercent,
  statusText,
  trackSteps,
} from '../src/lib/billingLogic';
import { parseCatalog, parseStatus } from '../src/lib/billingApi';
import type { BillingStatus, BillingSubscription, PriceMap } from '../src/lib/billingTypes';

const prices: PriceMap = { '1': 5, '3': 14, '6': 26, '12': 48 };

const sub = (patch: Partial<BillingSubscription> = {}): BillingSubscription => ({
  status: 'active',
  planId: 'pro',
  planName: 'Pro',
  months: 3,
  paidUntil: '2026-06-15T12:00:00Z',
  lastPaymentAt: '2026-03-15T12:00:00Z',
  startedAt: '2026-03-15T11:00:00Z',
  ...patch,
});

describe('dinero y ahorro', () => {
  it('da formato de dólares con dos decimales', () => {
    expect(formatMoney(5)).toBe('$5.00');
    expect(formatMoney(4.666)).toBe('$4.67');
  });

  it('calcula el precio mensual de un periodo', () => {
    expect(monthlyPrice(14, 3)).toBeCloseTo(4.6667, 3);
    expect(monthlyPrice(48, 12)).toBe(4);
  });

  it('calcula el ahorro frente a pagar mes a mes', () => {
    expect(savingsPercent(prices, 1)).toBe(0);
    expect(savingsPercent(prices, 3)).toBe(7);
    expect(savingsPercent(prices, 12)).toBe(20);
  });

  it('no inventa ahorro sin precio mensual, sin precio del periodo o con recargo', () => {
    expect(savingsPercent({ ...prices, '1': null }, 3)).toBe(0);
    expect(savingsPercent({ ...prices, '3': null }, 3)).toBe(0);
    expect(savingsPercent({ ...prices, '3': 20 }, 3)).toBe(0);
  });

  it('nombra los periodos', () => {
    expect(periodLabel(1)).toBe('1 mes');
    expect(periodLabel(6)).toBe('6 meses');
  });
});

describe('periodos disponibles', () => {
  it('solo ofrece los que tienen precio', () => {
    expect(availablePeriods({ '1': 5, '3': null, '6': 26, '12': null })).toEqual([1, 6]);
    expect(availablePeriods({ '1': null, '3': null, '6': null, '12': null })).toEqual([]);
  });

  it('abre en el periodo que ya tenía, o en 3 meses, o en el primero', () => {
    expect(defaultPeriod(prices, 12)).toBe(12);
    expect(defaultPeriod(prices)).toBe(3);
    expect(defaultPeriod({ '1': 5, '3': null, '6': 26, '12': null }, 3)).toBe(1);
    expect(defaultPeriod({ '1': null, '3': null, '6': null, '12': null })).toBeNull();
  });
});

describe('fechas', () => {
  it('suma meses sin pasarse de fin de mes', () => {
    expect(addMonths(new Date(2026, 0, 31), 1).getMonth()).toBe(1);
    expect(addMonths(new Date(2026, 0, 31), 1).getDate()).toBe(28);
    expect(addMonths(new Date(2028, 0, 31), 1).getDate()).toBe(29);
    expect(addMonths(new Date(2026, 10, 15), 3).getFullYear()).toBe(2027);
  });

  it('escribe la fecha en español', () => {
    expect(formatDateEs('2026-06-15T12:00:00Z', 'UTC')).toBe('15 de junio de 2026');
  });

  it('con fecha vacía o rota, un guion', () => {
    expect(formatDateEs(null)).toBe('—');
    expect(formatDateEs('no es una fecha')).toBe('—');
  });
});

describe('texto de estado', () => {
  it('sin suscripción, plan gratis', () => {
    expect(statusText({ subscription: null, hasAccess: false }).label).toBe('Plan gratis');
    expect(statusText(null).tone).toBe('neutral');
  });

  it('activo solo con acceso real', () => {
    expect(statusText({ subscription: sub(), hasAccess: true }).label).toBe('Activo');
    const sinAcceso = statusText({ subscription: sub(), hasAccess: false });
    expect(sinAcceso.label).not.toBe('Activo');
    expect(sinAcceso.tone).toBe('warn');
  });

  it('pendiente nunca se enseña como activo, ni con acceso mal informado', () => {
    expect(statusText({ subscription: sub({ status: 'pending' }), hasAccess: false }).label).toBe('Esperando el pago');
  });

  it('cobro fallido, cancelada y suspendida conservan lo pagado', () => {
    expect(statusText({ subscription: sub({ status: 'grace' }), hasAccess: true }).detail).toContain('Conservas el plan');
    expect(statusText({ subscription: sub({ status: 'cancelled' }), hasAccess: true }).detail).toContain('No se renovará');
    expect(statusText({ subscription: sub({ status: 'suspended' }), hasAccess: false }).tone).toBe('bad');
    expect(statusText({ subscription: sub({ status: 'expired' }), hasAccess: false }).label).toBe('Vencida');
  });

  it('decide cuándo se puede cancelar y cuándo contratar', () => {
    expect(canCancel(sub())).toBe(true);
    expect(canCancel(sub({ status: 'pending' }))).toBe(true);
    expect(canCancel(sub({ status: 'cancelled' }))).toBe(false);
    expect(canCancel(null)).toBe(false);
    expect(canSubscribe(null)).toBe(true);
    expect(canSubscribe(sub())).toBe(false);
    expect(canSubscribe(sub({ status: 'expired' }))).toBe(true);
  });
});

describe('pasos de seguimiento', () => {
  const states = (status: BillingStatus | null) => trackSteps(status, 'Pro', 3).map((s) => s.state);

  it('sin nada, el primero espera', () => {
    expect(states(null)).toEqual(['active', 'pending', 'pending', 'pending']);
  });

  it('suscripción creada sin pago', () => {
    const status = { subscription: sub({ status: 'pending', lastPaymentAt: null, paidUntil: null }), hasAccess: false };
    expect(states(status)).toEqual(['done', 'active', 'pending', 'pending']);
  });

  it('pagado pero el plan aún sin abrir', () => {
    const status = { subscription: sub(), hasAccess: false };
    expect(states(status)).toEqual(['done', 'done', 'done', 'active']);
  });

  it('todo hecho solo cuando hay acceso', () => {
    expect(states({ subscription: sub(), hasAccess: true })).toEqual(['done', 'done', 'done', 'done']);
  });
});

describe('regreso de PayPal', () => {
  it('lee el aviso en la dirección normal y en el hash', () => {
    expect(readPaypalReturn('?paypal=ok', '#cuenta')?.result).toBe('ok');
    expect(readPaypalReturn('', '#cuenta?paypal=cancel')?.result).toBe('cancel');
    expect(readPaypalReturn('?paypal=ok&subscription_id=I-ABC', '')?.subscriptionId).toBe('I-ABC');
  });

  it('ignora lo que no es ok ni cancel', () => {
    expect(readPaypalReturn('?paypal=otra', '#cuenta')).toBeNull();
    expect(readPaypalReturn('', '#cuenta')).toBeNull();
  });

  it('solo admite redirigir a PayPal por https', () => {
    expect(isSafeApproveUrl('https://www.paypal.com/webapps/billing/subscriptions?ba_token=BA-1')).toBe(true);
    expect(isSafeApproveUrl('https://www.sandbox.paypal.com/x')).toBe(true);
    expect(isSafeApproveUrl('http://www.paypal.com/x')).toBe(false);
    expect(isSafeApproveUrl('https://paypal.com.malo.example/x')).toBe(false);
    expect(isSafeApproveUrl('javascript:alert(1)')).toBe(false);
  });

  it('el seguimiento se rinde a los 60 segundos', () => {
    expect(pollExpired(0, 59_000)).toBe(false);
    expect(pollExpired(0, 60_000)).toBe(true);
  });
});

describe('lectura del contrato', () => {
  it('el acceso solo es cierto si el servidor manda true', () => {
    expect(parseStatus({ subscription: null }).hasAccess).toBe(false);
    expect(parseStatus({ subscription: null, hasAccess: 'true' }).hasAccess).toBe(false);
    expect(parseStatus({ subscription: null, hasAccess: true }).hasAccess).toBe(true);
  });

  it('un estado desconocido se trata como vencido', () => {
    expect(parseStatus({ subscription: { status: 'raro', planId: 'pro' }, hasAccess: false }).subscription?.status).toBe('expired');
  });

  it('lee el catálogo aunque falten datos', () => {
    const catalog = parseCatalog({ enabled: true, env: 'live', plans: [{ id: 'pro', name: 'Pro', prices: { '1': 5, '3': null } }, { name: 'sin id' }] });
    expect(catalog.plans).toHaveLength(1);
    expect(catalog.plans[0].prices).toEqual({ '1': 5, '3': null, '6': null, '12': null });
    expect(parseCatalog({}).enabled).toBe(false);
  });
});
