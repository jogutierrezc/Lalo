/** Mensajes de canje de códigos: todos los resultados de redeem_invite y redeem_recovery_code. */

import { describe, expect, it } from 'vitest';
import { INVITE_PROBLEM, outcomeMessage } from '../../src/lib/accesoMensajes';

describe('outcomeMessage', () => {
  it('null sin resultado o con ok', () => {
    expect(outcomeMessage(null)).toBeNull();
    expect(outcomeMessage({ kind: 'invite', result: 'ok' })).toBeNull();
    expect(outcomeMessage({ kind: 'recovery', result: 'ok' })).toBeNull();
  });

  it('error de red lleva el motivo', () => {
    expect(outcomeMessage({ kind: 'error', message: 'sin red' })).toBe('No se pudo canjear el código: sin red');
  });

  const invites = ['not_pending', 'no_twitch', 'has_paid_plan', 'has_plan', 'already_redeemed', 'not_found', 'expired', 'used_up', 'revoked'] as const;
  it.each(invites)('invitación %s tiene un mensaje propio', (result) => {
    const text = outcomeMessage({ kind: 'invite', result });
    expect(text).toBeTruthy();
    expect(text).not.toMatch(/undefined/);
  });

  it('los mensajes de invitación son todos distintos', () => {
    const texts = invites.map((result) => outcomeMessage({ kind: 'invite', result }));
    expect(new Set(texts).size).toBe(invites.length);
  });

  it('los problemas del código usan INVITE_PROBLEM', () => {
    for (const key of ['not_found', 'expired', 'used_up', 'revoked'] as const) {
      expect(outcomeMessage({ kind: 'invite', result: key })).toBe(INVITE_PROBLEM[key]);
    }
  });

  it('has_paid_plan avisa de que el código no se gastó', () => {
    expect(outcomeMessage({ kind: 'invite', result: 'has_paid_plan' })).toMatch(/no se ha gastado/);
  });

  const recoveries = ['not_found', 'expired', 'used', 'not_pending', 'same_profile'] as const;
  it.each(recoveries)('recuperación %s tiene mensaje', (result) => {
    expect(outcomeMessage({ kind: 'recovery', result })).toBeTruthy();
  });

  it('los mensajes de recuperación son distintos', () => {
    const texts = recoveries.map((result) => outcomeMessage({ kind: 'recovery', result }));
    expect(new Set(texts).size).toBe(recoveries.length);
  });
});
