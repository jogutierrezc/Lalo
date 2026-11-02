/**
 * server/done/readKey.ts
 *
 * Clave de SOLO LECTURA del overlay de Done. El enlace de la fuente de OBS se ve en pantalla y en capturas:
 * si llevara la clave de OBS completa (profiles.widget_key), cualquiera con el enlace podría hablar con el bot
 * como el creador. Por eso el overlay recibe otra clave que solo sirve para leer la cola de frases de Done, el
 * modelo 3D del personaje y para sintetizar voz.
 *
 * Cómo se deriva, sin guardar nada nuevo y sin romper `rotate_widget_key`:
 *
 *     clave = "dr." + <id del perfil> + "." + base64url( HMAC-SHA256( clave = widget_key, mensaje = "done-read-v1:" + id ) )[0..32]
 *
 *   - Es de un solo sentido: de la clave de lectura no se puede obtener la widget_key.
 *   - El servidor la comprueba buscando la widget_key del perfil que indica el id y recalculándola.
 *   - Al rotar la widget_key (rotate_widget_key), la clave de lectura cambia sola y la antigua deja de valer:
 *     no hay una segunda columna que mantener sincronizada.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const READ_KEY_PREFIX = 'dr.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAC_LENGTH = 32;

/** La clave de lectura que corresponde a un perfil y a su widget_key actual. */
export function deriveReadKey(profileId: string, widgetKey: string): string {
  const mac = createHmac('sha256', widgetKey).update(`done-read-v1:${profileId.toLowerCase()}`).digest('base64url').slice(0, MAC_LENGTH);
  return `${READ_KEY_PREFIX}${profileId.toLowerCase()}.${mac}`;
}

/** Id de perfil que anuncia una clave de lectura, o null si no tiene la forma. NO la da por buena: hay que verificarla. */
export function profileIdOfReadKey(raw: string): string | null {
  const text = raw.trim();
  if (!text.startsWith(READ_KEY_PREFIX) || text.length > 128) return null;
  const [id, mac] = text.slice(READ_KEY_PREFIX.length).split('.');
  return id && mac && UUID.test(id) && mac.length === MAC_LENGTH ? id.toLowerCase() : null;
}

/** true si la clave de lectura coincide con la derivada de la widget_key (comparación en tiempo constante). */
export function verifyReadKey(raw: string, profileId: string, widgetKey: string): boolean {
  const expected = Buffer.from(deriveReadKey(profileId, widgetKey));
  const given = Buffer.from(raw.trim());
  return expected.length === given.length && timingSafeEqual(expected, given);
}
