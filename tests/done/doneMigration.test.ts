/**
 * Contrato de la migración 0054 (Done AI): solo columnas e índices, sin tablas nuevas, sin tocar RLS.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(new URL('../../supabase/migrations/0054_done_ai.sql', import.meta.url), 'utf8');
const code = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')
  .toLowerCase();

describe('migración 0054_done_ai', () => {
  it('no crea tablas', () => {
    expect(code).not.toMatch(/create\s+table/);
  });

  it('cada alter table add column lleva if not exists', () => {
    const adds = code.match(/add\s+column[^;]*/g) ?? [];
    expect(adds.length).toBeGreaterThanOrEqual(6);
    for (const add of adds) expect(add).toMatch(/add\s+column\s+if\s+not\s+exists/);
  });

  it('los índices llevan if not exists', () => {
    for (const index of code.match(/create\s+index[^;]*/g) ?? []) expect(index).toMatch(/if\s+not\s+exists/);
  });

  it('no modifica RLS, políticas ni permisos de las tablas existentes', () => {
    expect(code).not.toMatch(/row\s+level\s+security|create\s+policy|drop\s+policy|\bgrant\b|\brevoke\b|drop\s+table|drop\s+column/);
  });

  it('añade las columnas que usa el código', () => {
    expect(code).toMatch(/lux_settings[\s\S]*done_settings\s+jsonb/);
    expect(code).toMatch(/profiles[\s\S]*done_enabled\s+boolean\s+not\s+null\s+default\s+true/);
    expect(code).toMatch(/lux_speech[\s\S]*agent\s+text\s+not\s+null\s+default\s+'lux'/);
    expect(code).toMatch(/lux_outbox[\s\S]*agent\s+text\s+not\s+null\s+default\s+'lux'/);
  });
});
