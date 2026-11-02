/**
 * tests/invitesLogic.test.ts
 *
 * Lógica pura de invitaciones con plan temporal, planes archivados, la tabla de
 * suscripciones del administrador y la dirección del SDK de botones de PayPal.
 */

import { describe, expect, it } from 'vitest';
import {
  activePlans,
  buildPaypalSdkUrl,
  buildSubRows,
  codePlanLabel,
  codeSummary,
  filterCounts,
  filterSubRows,
  monthsText,
  parseCodeMonths,
  quickPlan,
  rpcErrorMessage,
  toBytes,
  validCodePlanText,
} from '../src/lib/invitesLogic';
import type { AdminSubscription, CodeAccess } from '../src/lib/billingTypes';

describe('meses de un código', () => {
  it('escribe 1 mes y N meses', () => {
    expect(monthsText(1)).toBe('1 mes');
    expect(monthsText(3)).toBe('3 meses');
  });

  it('lee los meses y los limita a 1..36', () => {
    expect(parseCodeMonths('6')).toBe(6);
    expect(parseCodeMonths(' 12 ')).toBe(12);
    expect(parseCodeMonths('99')).toBe(36);
    expect(parseCodeMonths('2,4')).toBe(2);
    expect(parseCodeMonths('0')).toBeNull();
    expect(parseCodeMonths('')).toBeNull();
    expect(parseCodeMonths('abc')).toBeNull();
  });

  it('describe el plan del código y el resumen', () => {
    expect(codePlanLabel('Pro', 3)).toBe('Plan Pro · 3 meses');
    expect(codePlanLabel('Pro', 1)).toBe('Plan Pro · 1 mes');
    expect(codePlanLabel('Pro', null)).toBe('Plan Pro · sin vencimiento');
    expect(codePlanLabel('Pro', undefined)).toBe('Plan Pro · sin vencimiento');
    expect(codeSummary('Pro', 3, 1)).toBe('Una persona recibe Plan Pro por 3 meses sin costo.');
    expect(codeSummary('Max', 12, 5)).toBe('5 personas reciben Plan Max por 12 meses sin costo.');
  });

  it('el código válido muestra los meses solo si los hay', () => {
    expect(validCodePlanText('Pro', 3)).toBe('3 meses de Pro');
    expect(validCodePlanText('Pro', null)).toBe('Pro');
    expect(validCodePlanText(null, null)).toBe('Tu plan');
  });
});

describe('planes', () => {
  const plans = [
    { id: 'gratis', is_default: true, archived: false },
    { id: 'viejo', is_default: false, archived: true },
    { id: 'pro', is_default: false },
  ];

  it('los archivados no se ofrecen', () => {
    expect(activePlans(plans).map((p) => p.id)).toEqual(['gratis', 'pro']);
  });

  it('el atajo usa el primer plan de pago visible', () => {
    expect(quickPlan(plans)?.id).toBe('pro');
    expect(quickPlan([{ id: 'gratis', is_default: true }])?.id).toBe('gratis');
    expect(quickPlan([{ id: 'x', archived: true }])).toBeNull();
  });

  it('pasa MB y GB a bytes', () => {
    expect(toBytes(10, 'MB')).toBe(10 * 1024 * 1024);
    expect(toBytes(1.5, 'GB')).toBe(1.5 * 1024 * 1024 * 1024);
  });
});

describe('mensajes de error de la nube', () => {
  it('traduce las excepciones conocidas', () => {
    for (const code of [
      'invalid_plan_months',
      'plan_not_found',
      'plan_archived',
      'not_admin',
      'plan_exists',
      'invalid_plan_id',
      'invalid_plan_name',
      'invalid_plan_limits',
      'cannot_archive_default',
    ]) {
      const message = rpcErrorMessage(new Error(code), 'x');
      expect(message).not.toContain(code);
      expect(message.length).toBeGreaterThan(10);
    }
  });

  it('usa el texto de respaldo para lo desconocido', () => {
    expect(rpcErrorMessage(new Error(''), 'No se pudo.')).toBe('No se pudo.');
    expect(rpcErrorMessage(new Error('boom'), 'No se pudo.')).toBe('No se pudo. (boom)');
  });
});

describe('tabla de suscripciones', () => {
  const sub = (over: Partial<AdminSubscription>): AdminSubscription => ({
    id: 's1',
    profileId: 'p1',
    twitchLogin: 'uno',
    displayName: 'Uno',
    planId: 'pro',
    planName: 'Pro',
    months: 3,
    status: 'active',
    startedAt: null,
    paidUntil: '2027-01-01T00:00:00Z',
    lastPaymentAt: '2026-10-01T00:00:00Z',
    priceUsd: 10,
    ...over,
  });
  const access: CodeAccess = {
    profileId: 'p9',
    twitchLogin: 'nueve',
    displayName: null,
    planId: 'max',
    planName: 'Max',
    expiresAt: '2027-02-01T00:00:00Z',
    inviteCode: 'LALO-ABC',
  };

  it('une accesos por código y suscripciones', () => {
    const rows = buildSubRows([sub({}), sub({ id: 's2', status: 'grace', months: 1 })], [access]);
    expect(rows.map((r) => r.origin)).toEqual(['Código LALO-ABC', 'PayPal 3 meses', 'PayPal 1 mes']);
    expect(rows[0]).toMatchObject({ name: 'nueve', status: 'code', until: '2027-02-01T00:00:00Z', lastPaymentAt: null });
  });

  it('filtra por estado', () => {
    const rows = buildSubRows([sub({}), sub({ id: 's2', status: 'grace' }), sub({ id: 's3', status: 'expired' })], [access]);
    expect(filterSubRows(rows, 'all')).toHaveLength(4);
    expect(filterSubRows(rows, 'code')).toHaveLength(1);
    expect(filterSubRows(rows, 'grace').map((r) => r.key)).toEqual(['sub:s2']);
    expect(filterSubRows(rows, 'cancelled')).toHaveLength(0);
  });

  it('suma los contadores con los accesos por código', () => {
    const counts = filterCounts({ active: 2, grace: 1, cancelled: 1, suspended: 1, expired: 3, pending: 1 }, 4);
    expect(counts).toEqual({ all: 13, active: 2, code: 4, grace: 1, cancelled: 1, expired: 3 });
  });
});

describe('dirección del SDK de PayPal', () => {
  it('construye la dirección con los parámetros de suscripción y tarjeta', () => {
    const url = new URL(buildPaypalSdkUrl('AbC123_def-456xyz') as string);
    expect(url.origin + url.pathname).toBe('https://www.paypal.com/sdk/js');
    expect(url.searchParams.get('client-id')).toBe('AbC123_def-456xyz');
    expect(url.searchParams.get('vault')).toBe('true');
    expect(url.searchParams.get('intent')).toBe('subscription');
    expect(url.searchParams.get('components')).toBe('buttons');
    expect(url.searchParams.get('enable-funding')).toBe('card');
    expect(url.searchParams.get('currency')).toBe('USD');
  });

  it('no construye nada sin un identificador válido', () => {
    expect(buildPaypalSdkUrl('')).toBeNull();
    expect(buildPaypalSdkUrl(undefined)).toBeNull();
    expect(buildPaypalSdkUrl('   ')).toBeNull();
    expect(buildPaypalSdkUrl('corto')).toBeNull();
  });

  it('rechaza identificadores que intentan colar parámetros', () => {
    expect(buildPaypalSdkUrl('abcdefgh&components=evil')).toBeNull();
    expect(buildPaypalSdkUrl('abcdefgh"><script>')).toBeNull();
    expect(buildPaypalSdkUrl('abcdefgh#frag')).toBeNull();
  });
});
