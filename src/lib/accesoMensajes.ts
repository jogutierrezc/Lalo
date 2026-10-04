/**
 * src/lib/accesoMensajes.ts
 *
 * Mensajes de los códigos de invitación y de recuperación. Los comparten la
 * pantalla de acceso y la bienvenida, para que digan lo mismo en los dos sitios.
 */

import type { InviteStatus, RedeemInviteResult, RedeemRecoveryResult } from './cloudTypes';

/** Resultado de canjear un código (lo produce useCloudSession). */
export type ResultadoCanje =
  | { kind: 'invite'; result: RedeemInviteResult }
  | { kind: 'recovery'; result: RedeemRecoveryResult }
  | { kind: 'error'; message: string };

export const INVITE_PROBLEM: Record<Exclude<InviteStatus, 'valid'>, string> = {
  not_found: 'No existe ningún código así. Revisa que esté bien escrito.',
  expired: 'Este código ha caducado. Pide uno nuevo a quien administra Lalo.',
  used_up: 'Este código ya se usó todas las veces que permitía. Pide uno nuevo.',
  revoked: 'Este código fue anulado. Pide uno nuevo.',
};

/** Explica un canje que no salió bien. null si no hay nada que decir. */
export function outcomeMessage(outcome: ResultadoCanje | null): string | null {
  if (!outcome) return null;
  if (outcome.kind === 'error') return `No se pudo canjear el código: ${outcome.message}`;
  if (outcome.result === 'ok') return null;
  if (outcome.kind === 'invite') {
    if (outcome.result === 'no_twitch') {
      return 'Los códigos de invitación son para cuentas que entran con Twitch. Cierra sesión y entra con Twitch.';
    }
    return outcome.result === 'not_pending'
      ? 'Tu cuenta ya estaba registrada; el código no se ha gastado.'
      : INVITE_PROBLEM[outcome.result];
  }
  switch (outcome.result) {
    case 'expired':
      return 'El código de recuperación ha caducado. Pide otro.';
    case 'used':
      return 'Ese código de recuperación ya se usó. Pide otro.';
    case 'same_profile':
      return 'Ese código es de esta misma cuenta: no hay nada que recuperar.';
    case 'not_pending':
      return 'Esta cuenta de Twitch ya tiene un perfil en Lalo. La recuperación solo sirve para una cuenta nueva.';
    default:
      return 'Ese código de recuperación no existe. Revisa que esté bien escrito.';
  }
}
