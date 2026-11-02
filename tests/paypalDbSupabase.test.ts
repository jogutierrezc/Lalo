/**
 * tests/paypalDbSupabase.test.ts
 *
 * supabasePaypalDb con un cliente de Supabase simulado: comprueba QUÉ consultas y RPC construye
 * (cursor compuesto, filtro de accesos por código antes de limitar, refund_id, violación única).
 * No prueba el SQL real (las migraciones siguen sin probarse contra Supabase): eso lo guarda
 * tests/paypalMigrations.test.ts como contrato estático.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Call {
  target: string;
  fn: string;
  args: unknown[];
}

const h = vi.hoisted(() => ({
  calls: [] as { target: string; fn: string; args: unknown[] }[],
  rpc: {} as Record<string, { data: unknown; error: { code?: string; message: string } | null }>,
  tables: {} as Record<string, { data: unknown; error: { code?: string; message: string } | null }[]>,
}));

vi.mock('@supabase/supabase-js', () => {
  const builder = (target: string, result: () => unknown) => {
    const proxy: unknown = new Proxy(() => undefined, {
      get(_t, prop) {
        if (prop === 'then') return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject);
        return (...args: unknown[]) => {
          h.calls.push({ target, fn: String(prop), args });
          return proxy;
        };
      },
    });
    return proxy;
  };
  return {
    createClient: () => ({
      from: (table: string) => {
        h.calls.push({ target: table, fn: 'from', args: [table] });
        return builder(table, () => {
          const queue = h.tables[table] ?? [{ data: [], error: null }];
          return queue.length > 1 ? queue.shift() : queue[0];
        });
      },
      rpc: (name: string, args: unknown) => {
        h.calls.push({ target: name, fn: 'rpc', args: [args] });
        return builder(name, () => h.rpc[name] ?? { data: null, error: null });
      },
    }),
  };
});

import { DuplicateSubscriptionError, supabasePaypalDb } from '../server/paypal/db';
import { MigrationMissingError } from '../server/integrations/store';

const db = () => {
  const out = supabasePaypalDb({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service' });
  if (!out) throw new Error('sin db');
  return out;
};
const callsOn = (target: string): Call[] => h.calls.filter((c) => c.target === target);

beforeEach(() => {
  h.calls.length = 0;
  h.rpc = {};
  h.tables = {};
});

describe('codeAccess (#6): se filtra en la consulta, antes de limitar', () => {
  it('usa la función billing_code_access con ahora y el límite, sin leer profiles y filtrar después', async () => {
    h.rpc.billing_code_access = {
      data: [{ profile_id: 'p1', twitch_login: 'ana', display_name: 'Ana', plan_id: 'plus', plan_name: 'Plus', plan_expires_at: '2027-01-01T00:00:00+00:00', invite_code: 'LALO-1' }],
      error: null,
    };
    const rows = await db().codeAccess('2026-11-01T12:00:00.000Z', 200);
    expect(callsOn('billing_code_access')).toEqual([{ target: 'billing_code_access', fn: 'rpc', args: [{ p_now: '2026-11-01T12:00:00.000Z', p_limit: 200 }] }]);
    expect(h.calls.some((c) => c.fn === 'from' && c.target === 'profiles')).toBe(false);
    expect(rows).toEqual([{ profile_id: 'p1', twitch_login: 'ana', display_name: 'Ana', plan_id: 'plus', plan_name: 'Plus', expires_at: '2027-01-01T00:00:00+00:00', invite_code: 'LALO-1' }]);
  });

  it('si la función no existe (migración 0051 sin aplicar) falla con MigrationMissingError', async () => {
    h.rpc.billing_code_access = { data: null, error: { code: 'PGRST202', message: 'no function' } };
    await expect(db().codeAccess('2026-11-01T12:00:00.000Z', 200)).rejects.toBeInstanceOf(MigrationMissingError);
  });
});

describe('adminSubscriptions (#5): orden y cursor compuesto', () => {
  it('ordena por updated_at desc e id desc y sin cursor no filtra', async () => {
    await db().adminSubscriptions(201, null);
    const orders = callsOn('billing_subscriptions').filter((c) => c.fn === 'order');
    expect(orders.map((c) => [c.args[0], (c.args[1] as { ascending: boolean }).ascending])).toEqual([['updated_at', false], ['id', false]]);
    expect(callsOn('billing_subscriptions').some((c) => c.fn === 'or' || c.fn === 'lt')).toBe(false);
  });

  it('con cursor (updated_at, id) usa or(lt, and(eq, lt id)) con el string de updated_at sin tocar', async () => {
    const ts = '2026-10-01T10:00:00.123456+00:00';
    await db().adminSubscriptions(201, { updatedAt: ts, id: '0b9c3f1e-0000-4000-8000-000000000001' });
    const or = callsOn('billing_subscriptions').find((c) => c.fn === 'or');
    expect(or?.args[0]).toBe(`updated_at.lt.${ts},and(updated_at.eq.${ts},id.lt.0b9c3f1e-0000-4000-8000-000000000001)`);
  });

  it('un cursor sin id (ISO simple) conserva la comparación estricta anterior', async () => {
    await db().adminSubscriptions(201, { updatedAt: '2026-10-01T10:00:00.000Z', id: null });
    const q = callsOn('billing_subscriptions');
    expect(q.find((c) => c.fn === 'lt')?.args).toEqual(['updated_at', '2026-10-01T10:00:00.000Z']);
    expect(q.some((c) => c.fn === 'or')).toBe(false);
  });
});

describe('reverseSale (#3): manda p_refund_id', () => {
  it('pasa sale, refund, importe, reverso y hora al RPC', async () => {
    h.rpc.billing_reverse_sale = { data: 'partial', error: null };
    const res = await db().reverseSale({ saleId: 'S-1', refundId: 'R-1', amount: 5, reversal: false, eventTime: '2026-11-01T12:00:00.000Z' });
    expect(res).toBe('partial');
    expect(callsOn('billing_reverse_sale')[0].args[0]).toEqual({ p_sale_id: 'S-1', p_refund_id: 'R-1', p_amount: 5, p_reversal: false, p_event_time: '2026-11-01T12:00:00.000Z' });
  });
});

describe('insertSubscription (#25): violación única', () => {
  it('23505 se convierte en DuplicateSubscriptionError; otro error, en un error genérico sin detalles', async () => {
    const row = { profile_id: 'p', plan_id: 'plus', months: 3, price_usd: 27, paypal_subscription_id: 'I-1', status: 'pending' as const, started_at: '2026-11-01T12:00:00.000Z' };
    h.tables.billing_subscriptions = [{ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }];
    await expect(db().insertSubscription(row)).rejects.toBeInstanceOf(DuplicateSubscriptionError);
    h.tables.billing_subscriptions = [{ data: null, error: { code: '23514', message: 'check violation' } }];
    await expect(db().insertSubscription(row)).rejects.toThrow('Supabase: 23514');
  });
});

describe('subscriptionBySale (#7)', () => {
  it('busca la venta y luego su suscripción; una venta desconocida devuelve null', async () => {
    h.tables.billing_sales = [{ data: { subscription_id: 'sub-1' }, error: null }];
    h.tables.billing_subscriptions = [{ data: { id: 'sub-1', paypal_subscription_id: 'I-9', price_usd: '27' }, error: null }];
    const sub = await db().subscriptionBySale('S-1');
    expect(sub).toMatchObject({ id: 'sub-1', paypal_subscription_id: 'I-9', price_usd: 27 });

    h.tables.billing_sales = [{ data: null, error: null }];
    expect(await db().subscriptionBySale('S-NO')).toBeNull();
  });
});
