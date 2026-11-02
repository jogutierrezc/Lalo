/**
 * src/components/welcome/bienvenidaEvento.ts
 *
 * Aviso entre el botón «Ver bienvenida» (Mi cuenta) y el montaje de la
 * bienvenida (BienvenidaTally.tsx), que vive aparte de las páginas.
 */

export const EVENTO_VER_BIENVENIDA = 'tally:ver-bienvenida';

/** Pide repetir la bienvenida de la cuenta. */
export function verBienvenida(): void {
  window.dispatchEvent(new Event(EVENTO_VER_BIENVENIDA));
}
