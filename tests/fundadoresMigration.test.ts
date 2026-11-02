/**
 * tests/fundadoresMigration.test.ts
 *
 * Guardia de CONTRATO sobre 0052_fundadores.sql (no ejecuta SQL): comprueba que el regalo
 * reutiliza el plan temporal vigente, no pisa un plan de pago y que las funciones llevan
 * search_path vacío y permisos acotados.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(resolve(__dirname, '../supabase/migrations/0052_fundadores.sql'), 'utf8');

function fnBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  if (start < 0) throw new Error(`no está la función ${name}`);
  const open = sql.indexOf('$$', start);
  const close = sql.indexOf('$$;', open + 2);
  return sql.slice(start, close + 3);
}

const fns = ['mark_welcome_seen', 'founder_gift_config', 'claim_founder_gift', 'admin_set_founder_gift'];

describe('0052_fundadores', () => {
  it.each(fns)('%s es security definer con search_path vacío y solo la ejecuta authenticated', (name) => {
    const body = fnBody(name);
    expect(body).toMatch(/security definer/i);
    expect(body).toMatch(/set search_path = ''/i);
    expect(sql).toMatch(new RegExp(`revoke execute on function public\\.${name}\\([^)]*\\) from public, anon, authenticated;`));
    expect(sql).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to authenticated;`));
  });

  it('claim_founder_gift no pisa un plan de pago ni un plan temporal o fijo', () => {
    const body = fnBody('claim_founder_gift');
    expect(body).toMatch(/billing_subscriptions/);
    expect(body).toMatch(/'active', 'grace', 'cancelled', 'suspended'/);
    expect(body).toMatch(/plan_expires_at > now\(\)/);
    expect(body).toMatch(/is distinct from v_default/);
    expect(body).toMatch(/return 'has_plan'/);
  });

  it('claim_founder_gift usa plan_expires_at con meses de calendario en UTC y es de una sola vez', () => {
    const body = fnBody('claim_founder_gift');
    expect(body).toMatch(/make_interval\(months => v_months\)/);
    expect(body).toMatch(/at time zone 'UTC'/);
    expect(body).toMatch(/founder_gift_claimed_at is not null/);
    expect(body).toMatch(/for update/);
  });

  it('los meses van de 1 a 36, igual que plan_months de los códigos', () => {
    expect(sql).toMatch(/check \(gift_months between 1 and 36\)/);
    expect(fnBody('admin_set_founder_gift')).toMatch(/p_months > 36/);
  });

  it('admin_set_founder_gift exige administrador, rechaza planes archivados y deja bitácora', () => {
    const body = fnBody('admin_set_founder_gift');
    expect(body).toMatch(/public\.is_admin\(\)/);
    expect(body).toMatch(/plan_archived/);
    expect(body).toMatch(/log_admin_action/);
  });

  it('founder_settings tiene RLS, sin escritura directa', () => {
    expect(sql).toMatch(/alter table public\.founder_settings enable row level security;/);
    expect(sql).toMatch(/revoke insert, update, delete on public\.founder_settings from authenticated;/);
  });

  it('el corte de fundadores está marcado como provisional', () => {
    expect(sql).toMatch(/CORTE PROVISIONAL: 2026-11-30/);
  });
});
