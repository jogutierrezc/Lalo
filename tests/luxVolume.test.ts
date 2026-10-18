/**
 * tests/luxVolume.test.ts
 *
 * Volumen de la voz de Lux: validación 0-100 y que llega a la fila de la base de datos.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_LUX_SETTINGS, normalizeLuxSettings, rowFromSettings, settingsFromRow } from '../server/lux/settings';

describe('volumen de la voz', () => {
  it('por defecto es 100', () => {
    expect(DEFAULT_LUX_SETTINGS.voiceVolume).toBe(100);
  });

  it('acepta valores de 0 a 100 y rechaza el resto', () => {
    expect(normalizeLuxSettings({ voiceVolume: 0 }).ok).toBe(true);
    expect(normalizeLuxSettings({ voiceVolume: 65 }).ok).toBe(true);
    expect(normalizeLuxSettings({ voiceVolume: 101 })).toMatchObject({ ok: false, field: 'voiceVolume' });
    expect(normalizeLuxSettings({ voiceVolume: -5 })).toMatchObject({ ok: false, field: 'voiceVolume' });
    expect(normalizeLuxSettings({ voiceVolume: 50.5 })).toMatchObject({ ok: false, field: 'voiceVolume' });
  });

  it('se guarda y vuelve a leer igual', () => {
    const check = normalizeLuxSettings({ voiceVolume: 30 });
    if (!check.ok) throw new Error('volumen inválido');
    expect(settingsFromRow(rowFromSettings('p1', check.value)).voiceVolume).toBe(30);
  });
});
