import { describe, expect, it } from 'vitest';
import { CHECK_EVERY_MS } from '../src/lib/widgetCloud';
import { POLL_ACTIVE_MS, POLL_IDLE_MS, eventPollDelay } from '../src/components/powerups/TwitchEventLayer';

// Ritmos de sondeo de las capas de OBS: bajarlos gasta menos peticiones a Supabase.
describe('Sondeos de las capas de OBS', () => {
  it('la versión de la configuración se pregunta cada 30 s', () => {
    expect(CHECK_EVERY_MS).toBe(30000);
  });

  it('eventos: activo (canal encendido o Ko-fi) se mantiene en 4 s; inactivo sube a 45 s', () => {
    expect(POLL_ACTIVE_MS).toBe(4000);
    expect(POLL_IDLE_MS).toBe(45000);
    expect(eventPollDelay(true)).toBe(POLL_ACTIVE_MS);
    expect(eventPollDelay(false)).toBe(POLL_IDLE_MS);
  });
});
