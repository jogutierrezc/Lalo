/**
 * src/components/powerups/noticeRules.ts
 *
 * Reglas del aviso en pantalla y de la voz de un Power-up, sin DOM para poder
 * probarlas. Las comparten la fuente suelta de OBS (TwitchEventLayer) y la caja
 * «Aviso de Power-up» de Studio (estudio/boxes/fase2.tsx).
 */

import { findBlockedWord, normalizeUser } from '../../utils/moderation';

/** Segundos que un aviso se queda en pantalla y cuántos pueden esperar turno. */
export const NOTICE_SECONDS = 5;
export const NOTICE_QUEUE_MAX = 6;

export interface Notice {
  id: number;
  tag: string;
  text: string;
}

/**
 * Fuentes sueltas en las que TwitchEventLayer pinta el aviso y lee la voz. Una
 * escena de Studio (`scene`) no está en ninguna de las dos listas: allí lo hace
 * la caja «Aviso de Power-up», y así ninguna acción ocurre dos veces.
 */
export const NOTICE_APPS: readonly string[] = ['all', 'rewards', 'recompensas'];
export const VOICE_APPS: readonly string[] = ['', 'tts', 'all'];

/** Añade un aviso a la cola. Con la cola llena la devuelve igual: el aviso se descarta. */
export function enqueueNotice(queue: readonly Notice[], notice: Notice, max = NOTICE_QUEUE_MAX): Notice[] {
  return queue.length >= max ? [...queue] : [...queue, notice];
}

/** Lo que escribe el espectador pasa por los mismos bloqueos que la voz del chat. */
export function voiceAllowed(
  action: { login: string; viewerText: string },
  blockedUsers: readonly string[],
  blockedWords: readonly string[]
): boolean {
  if (action.login && blockedUsers.includes(normalizeUser(action.login))) return false;
  if (action.viewerText && findBlockedWord(action.viewerText, [...blockedWords])) return false;
  return true;
}
