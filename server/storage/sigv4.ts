/**
 * server/storage/sigv4.ts
 *
 * Firma AWS Signature V4 hecha a mano con el módulo crypto de Node, para hablar
 * con Cloudflare R2 (compatible con S3) sin instalar el SDK de AWS.
 *
 * Dos usos:
 *   - presignUrl: una URL firmada que el navegador usa para subir un archivo
 *     directo a R2 durante unos minutos.
 *   - signHeaders: cabeceras firmadas para las peticiones que hace el servidor
 *     (comprobar, leer y borrar objetos).
 *
 * Son funciones puras: reciben la hora como argumento. Los tests las comparan
 * con los ejemplos publicados por AWS para S3.
 */

import { createHash, createHmac } from 'node:crypto';

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface SigV4Target {
  method: string;
  host: string;
  /** Ruta sin codificar, empezando por "/". */
  path: string;
  query?: Record<string, string>;
  /** Cabeceras que entran en la firma, además de host. */
  headers?: Record<string, string>;
  region: string;
  service: string;
}

export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';
export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

const hmac = (key: string | Buffer, data: string): Buffer => createHmac('sha256', key).update(data).digest();

/** Codificación de URL como la pide AWS: solo quedan sin tocar letras, números y - _ . ~ */
export function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Codifica cada tramo de la ruta y conserva las barras. */
export function encodePath(path: string): string {
  return path.split('/').map(encodeRfc3986).join('/');
}

/** Fecha en el formato de AWS: 20130524T000000Z. */
export function amzDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function canonicalQuery(query: Record<string, string>): string {
  return Object.keys(query)
    .map((key) => [encodeRfc3986(key), encodeRfc3986(query[key])] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function canonicalHeaders(target: SigV4Target, extra: Record<string, string> = {}): { text: string; signed: string } {
  const all: Record<string, string> = { host: target.host };
  for (const [name, value] of Object.entries({ ...target.headers, ...extra })) {
    all[name.toLowerCase()] = String(value).trim().replace(/\s+/g, ' ');
  }
  const names = Object.keys(all).sort();
  return {
    text: names.map((name) => `${name}:${all[name]}\n`).join(''),
    signed: names.join(';'),
  };
}

function signature(
  target: SigV4Target,
  credentials: SigV4Credentials,
  stamp: string,
  query: string,
  headers: { text: string; signed: string },
  payloadHash: string
): string {
  const day = stamp.slice(0, 8);
  const scope = `${day}/${target.region}/${target.service}/aws4_request`;
  const canonicalRequest = [
    target.method.toUpperCase(),
    encodePath(target.path),
    query,
    headers.text,
    headers.signed,
    payloadHash,
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${credentials.secretAccessKey}`, day);
  const kRegion = hmac(kDate, target.region);
  const kService = hmac(kRegion, target.service);
  const kSigning = hmac(kService, 'aws4_request');
  return hmac(kSigning, stringToSign).toString('hex');
}

/**
 * URL firmada. Quien la use debe enviar exactamente las cabeceras de
 * `target.headers` con esos mismos valores; si cambia una, R2 responde 403.
 */
export function presignUrl(
  target: SigV4Target,
  credentials: SigV4Credentials,
  options: { now: Date; expiresSeconds: number }
): string {
  const stamp = amzDate(options.now);
  const scope = `${stamp.slice(0, 8)}/${target.region}/${target.service}/aws4_request`;
  const headers = canonicalHeaders(target);
  const query = canonicalQuery({
    ...target.query,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${credentials.accessKeyId}/${scope}`,
    'X-Amz-Date': stamp,
    'X-Amz-Expires': String(Math.round(options.expiresSeconds)),
    'X-Amz-SignedHeaders': headers.signed,
  });
  const signed = signature(target, credentials, stamp, query, headers, UNSIGNED_PAYLOAD);
  return `https://${target.host}${encodePath(target.path)}?${query}&X-Amz-Signature=${signed}`;
}

/**
 * Cabeceras para una petición firmada desde el servidor. Devuelve todas las
 * que hay que enviar (las de `target.headers` más las de la firma), sin host.
 */
export function signHeaders(
  target: SigV4Target,
  credentials: SigV4Credentials,
  options: { now: Date; payloadHash?: string }
): Record<string, string> {
  const stamp = amzDate(options.now);
  const payloadHash = options.payloadHash ?? EMPTY_SHA256;
  const scope = `${stamp.slice(0, 8)}/${target.region}/${target.service}/aws4_request`;
  const amz = { 'x-amz-content-sha256': payloadHash, 'x-amz-date': stamp };
  const headers = canonicalHeaders(target, amz);
  const signed = signature(target, credentials, stamp, canonicalQuery(target.query ?? {}), headers, payloadHash);
  return {
    ...target.headers,
    ...amz,
    authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${headers.signed}, Signature=${signed}`,
  };
}

/** La misma cadena de consulta que entró en la firma, para montar la URL de una petición con signHeaders. */
export function queryString(query: Record<string, string> = {}): string {
  return canonicalQuery(query);
}
