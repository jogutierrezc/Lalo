/**
 * src/lib/serverMessage.ts
 *
 * Mensajes cuando el servidor de la app no responde. En producción (Vercel)
 * no hay nada que arrancar; la pista de «npm run dev:all» solo sale en local.
 */

const esLocal = (): boolean => {
  try {
    return typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  } catch {
    return false;
  }
};

const PISTA_LOCAL = ' En local hace falta arrancar también el servidor con «npm run dev:all».';

/** El servidor no contestó. */
export function noServerMessage(): string {
  return `Tally Studio no respondió. Prueba otra vez en unos segundos.${esLocal() ? PISTA_LOCAL : ''}`;
}

/** El servidor contestó, pero con algo que no es JSON (p. ej. un 500 en HTML): falló, no está apagado. */
export function serverFailedMessage(): string {
  return `El servidor de Tally Studio falló al responder. Prueba otra vez en unos segundos.${esLocal() ? PISTA_LOCAL : ''}`;
}
