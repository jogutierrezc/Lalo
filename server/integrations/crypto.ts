/**
 * server/integrations/crypto.ts
 *
 * Cifrado y firmas de las integraciones (Spotify y Ko-fi). Solo usa node:crypto.
 *
 * - Los permisos de larga duración (el refresh token de Spotify, la clave de
 *   verificación de Ko-fi y la dirección personal del webhook) se guardan
 *   cifrados con AES-256-GCM. La clave sale de INTEGRATIONS_ENC_KEY: 32 bytes en
 *   base64 o en hexadecimal. Para generarla:
 *     node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 * - El parámetro `state` de la vuelta de Spotify va firmado (HMAC-SHA256) con una
 *   clave derivada de la misma, lleva el perfil del streamer y caduca pronto.
 * - Las comparaciones de secretos no dependen de cuánto tardan.
 *
 * Nada de aquí escribe secretos en el registro ni en mensajes de error.
 */

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Minutos que vale el `state` de Spotify. */
export const STATE_TTL_MS = 10 * 60 * 1000;

const b64url = (buffer: Buffer): string => buffer.toString('base64url');

/** Clave de 32 bytes a partir del texto de la variable de entorno, o null si no vale. */
export function parseKey(raw: string | undefined | null): Buffer | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  if (/^[0-9a-f]{64}$/i.test(text)) return Buffer.from(text, 'hex');
  if (!/^[A-Za-z0-9+/_-]{43}=?$/.test(text)) return null;
  const key = Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return key.length === 32 ? key : null;
}

/** Cifra un texto. Formato: v1.<iv>.<etiqueta>.<cifrado>, todo en base64url. */
export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1.${b64url(iv)}.${b64url(cipher.getAuthTag())}.${b64url(data)}`;
}

/** Descifra lo que guardó encryptSecret. null si está manipulado, cortado o es de otra clave. */
export function decryptSecret(token: string | null | undefined, key: Buffer): string | null {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const iv = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export const sha256Hex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** Compara dos textos sin que el tiempo delate dónde difieren ni cuánto miden. */
export function safeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a, 'utf8').digest();
  const right = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(left, right);
}

/** Identificador aleatorio en base64url (32 bytes: 43 caracteres). */
export const randomId = (bytes = 32): string => b64url(randomBytes(bytes));

// ---------- state de Spotify ----------

export interface StateClaims {
  profileId: string;
  /** Valor que también viaja en una cookie del navegador que empezó la conexión. */
  nonce: string;
}

const stateKey = (key: Buffer): Buffer => createHmac('sha256', key).update('lalo-spotify-state-v1').digest();

/** `state` firmado y con caducidad para el perfil que empieza la conexión. */
export function signState(claims: StateClaims, key: Buffer, now: number): string {
  const body = b64url(Buffer.from(JSON.stringify({ p: claims.profileId, n: claims.nonce, e: now + STATE_TTL_MS }), 'utf8'));
  const mac = b64url(createHmac('sha256', stateKey(key)).update(body).digest());
  return `${body}.${mac}`;
}

/** Lo que decía el `state`, o null si la firma no coincide, caducó o no tiene la forma esperada. */
export function verifyState(state: string | null | undefined, key: Buffer, now: number): StateClaims | null {
  if (typeof state !== 'string' || state.length > 600) return null;
  const [body, mac, extra] = state.split('.');
  if (!body || !mac || extra !== undefined) return null;
  const expected = b64url(createHmac('sha256', stateKey(key)).update(body).digest());
  if (!safeEqual(expected, mac)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { p?: unknown; n?: unknown; e?: unknown };
    if (typeof parsed.p !== 'string' || typeof parsed.n !== 'string' || typeof parsed.e !== 'number') return null;
    if (!/^[0-9a-f-]{36}$/i.test(parsed.p) || parsed.e < now) return null;
    return { profileId: parsed.p, nonce: parsed.n };
  } catch {
    return null;
  }
}
