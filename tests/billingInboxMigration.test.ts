/**
 * tests/billingInboxMigration.test.ts
 *
 * Guardia de CONTRATO sobre 0053_billing_inbox.sql (no ejecuta SQL): RLS sin políticas, la función
 * de resolver solo para service_role con search_path vacío, bitácora e índices que usan las consultas.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(resolve(__dirname, '../supabase/migrations/0053_billing_inbox.sql'), 'utf8');

describe('0053_billing_inbox', () => {
  it('billing_inbox_resolutions tiene las columnas pedidas, RLS activada y ninguna política', () => {
    expect(sql).toMatch(/create table if not exists public\.billing_inbox_resolutions/);
    for (const column of ['item_key', 'resolved_by', 'resolved_at', 'note']) expect(sql).toMatch(new RegExp(`\\b${column}\\b`));
    expect(sql).toMatch(/alter table public\.billing_inbox_resolutions enable row level security;/);
    expect(sql).toMatch(/revoke all on public\.billing_inbox_resolutions from anon, authenticated;/);
    expect(sql).not.toMatch(/create policy/i);
  });

  it('billing_inbox_resolve es security definer con search_path vacío y solo la ejecuta service_role', () => {
    const start = sql.indexOf('create or replace function public.billing_inbox_resolve(');
    const body = sql.slice(start, sql.indexOf('$$;', sql.indexOf('$$', start) + 2) + 3);
    expect(body).toMatch(/security definer/i);
    expect(body).toMatch(/set search_path = ''/i);
    expect(sql).toMatch(/revoke execute on function public\.billing_inbox_resolve\(text, uuid, text\) from public, anon, authenticated;/);
    expect(sql).toMatch(/grant execute on function public\.billing_inbox_resolve\(text, uuid, text\) to service_role;/);
    expect(sql).not.toMatch(/grant execute[^;]*to authenticated/i);
  });

  it('es idempotente y deja bitácora solo la primera vez', () => {
    expect(sql).toMatch(/on conflict \(item_key\) do nothing/);
    expect(sql).toMatch(/return 'duplicate'/);
    expect(sql).toMatch(/return 'resolved'/);
    expect(sql).toMatch(/insert into public\.admin_audit_log/);
  });

  it('la bitácora respeta los límites de admin_audit_log (acción <= 60, detalle <= 240)', () => {
    expect(sql).toMatch(/'billing_inbox_resolve'/);
    expect(sql).toMatch(/left\('Bandeja de pagos: ítem resuelto ' \|\| v_key, 240\)/);
  });

  it('crea los índices de las consultas nuevas, todos idempotentes', () => {
    for (const name of ['billing_sales_created', 'billing_sales_reversed', 'billing_refunds_created', 'billing_events_subscription_type', 'billing_events_claimed', 'billing_subscriptions_status_paid_until']) {
      expect(sql).toMatch(new RegExp(`create index if not exists ${name}\\b`));
    }
  });
});
