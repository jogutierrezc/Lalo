/**
 * tests/paypalMigrations.test.ts
 *
 * Guardia de CONTRATO sobre el SQL de cobro (0050 y 0051). No ejecuta SQL (no hay Postgres en las
 * pruebas): lee los .sql y comprueba las cláusulas críticas, para que una edición descuidada no
 * quite en silencio el search_path, los permisos, la RLS o la idempotencia.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = (name: string): string => readFileSync(resolve(__dirname, '../supabase/migrations', name), 'utf8');
const m50 = sql('0050_billing_hardening.sql');
const m51 = sql('0051_qg_fixes.sql');

/** Cuerpo completo de `create or replace function public.<name>(` hasta su `$$;` de cierre. */
function fnBody(source: string, name: string): string {
  const start = source.indexOf(`create or replace function public.${name}(`);
  if (start < 0) throw new Error(`no está la función ${name}`);
  const open = source.indexOf('$$', start);
  const close = source.indexOf('$$;', open + 2);
  return source.slice(start, close + 3);
}

const billingFns = (source: string): string[] => [...source.matchAll(/create or replace function public\.(billing_\w+)\(/g)].map((m) => m[1]);

describe('funciones billing_* (0050 y 0051)', () => {
  const all: [string, string][] = [
    ...billingFns(m50).map((n): [string, string] => [n, m50]),
    ...billingFns(m51).map((n): [string, string] => [n, m51]),
  ];

  it('hay funciones que comprobar en cada migración', () => {
    expect(billingFns(m50)).toEqual(expect.arrayContaining(['billing_apply_payment', 'billing_reverse_sale']));
    expect(billingFns(m51)).toEqual(expect.arrayContaining(['billing_reverse_sale', 'billing_code_access']));
  });

  it.each(all)('%s es security definer con search_path vacío', (name, source) => {
    const body = fnBody(source, name);
    expect(body).toMatch(/security definer/i);
    expect(body).toMatch(/set search_path = ''/i);
  });

  it.each(all)('%s: revoke a public/anon/authenticated y grant solo a service_role', (name, source) => {
    expect(source).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated;`));
    expect(source).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to service_role;`));
    expect(source).not.toMatch(new RegExp(`grant[^;]*on function public\\.${name}\\([^)]*\\) to[^;]*\\b(anon|authenticated|public)\\b`, 'i'));
  });
});

describe('0050: ventas', () => {
  it('billing_sales tiene RLS activada, permisos quitados y ninguna política', () => {
    expect(m50).toMatch(/alter table public\.billing_sales enable row level security;/);
    expect(m50).toMatch(/revoke all on public\.billing_sales from anon, authenticated;/);
    expect(m50).not.toMatch(/create policy[^;]*on public\.billing_sales/i);
  });
  it('apply_payment valida el id de venta y es idempotente por sale_id', () => {
    const body = fnBody(m50, 'billing_apply_payment');
    expect(body).toMatch(/raise exception 'invalid_sale'/);
    expect(body).toMatch(/length\(p_sale_id\) > 100/);
    expect(body).toMatch(/on conflict \(sale_id\) do nothing/);
    expect(body).toMatch(/v_stale/);
  });
});

describe('0051', () => {
  it('billing_refunds: clave refund_id, RLS activada, sin permisos y sin políticas', () => {
    expect(m51).toMatch(/create table if not exists public\.billing_refunds \(\s*refund_id\s+text primary key/);
    expect(m51).toMatch(/alter table public\.billing_refunds enable row level security;/);
    expect(m51).toMatch(/revoke all on public\.billing_refunds from anon, authenticated;/);
    expect(m51).not.toMatch(/create policy[^;]*on public\.billing_refunds/i);
  });

  it('billing_reverse_sale: recibe p_refund_id, inserta el reembolso con on conflict y suma solo si es nuevo', () => {
    const body = fnBody(m51, 'billing_reverse_sale');
    expect(body).toMatch(/p_refund_id\s+text/);
    expect(body).toMatch(/insert into public\.billing_refunds/);
    expect(body).toMatch(/on conflict \(refund_id\) do nothing/);
    expect(body).toMatch(/get diagnostics v_rows = row_count/);
    expect(body).toMatch(/v_stale/);
    expect(body).toMatch(/unknown_sale/);
  });

  it('billing_reverse_sale: el reembolso total exige moneda USD', () => {
    expect(fnBody(m51, 'billing_reverse_sale')).toMatch(/upper\(coalesce\(v_sale\.currency, ''\)\) = 'USD'/);
  });

  it('retira la firma antigua de billing_reverse_sale (4 argumentos) para que no quede ejecutable', () => {
    expect(m51).toMatch(/drop function if exists public\.billing_reverse_sale\(text, numeric, boolean, timestamptz\);/);
  });

  it('billing_code_access excluye a quien paga con NOT EXISTS ANTES del limit', () => {
    const body = fnBody(m51, 'billing_code_access');
    const notExists = body.search(/not exists/i);
    const limit = body.search(/\blimit\b/i);
    expect(notExists).toBeGreaterThan(-1);
    expect(limit).toBeGreaterThan(notExists);
    expect(body).toMatch(/s\.status in \('active', 'grace', 'cancelled', 'suspended'\)/);
  });

  it('índice único parcial de una suscripción viva por perfil, creado tras limpiar duplicados pendientes', () => {
    const index = m51.search(/create unique index if not exists billing_subscriptions_one_live\s+on public\.billing_subscriptions \(profile_id\)\s+where status in \('pending', 'active', 'grace', 'suspended'\);/);
    expect(index).toBeGreaterThan(-1);
    const cleanup = m51.search(/set status = 'cancelled'/);
    expect(cleanup).toBeGreaterThan(-1);
    expect(cleanup).toBeLessThan(index);
  });

  it('backfill de ventas previas con sale_id legacy-<id>, solo si hubo pago, sin duplicar', () => {
    expect(m51).toMatch(/'legacy-' \|\| s\.id::text/);
    expect(m51).toMatch(/s\.last_payment_at is not null/);
    expect(m51).toMatch(/on conflict \(sale_id\) do nothing/);
  });
});
