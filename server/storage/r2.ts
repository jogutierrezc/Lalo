/**
 * server/storage/r2.ts
 *
 * Cliente mínimo de Cloudflare R2 por su API compatible con S3, con fetch y la
 * firma de sigv4.ts. Solo vive en el servidor: aquí se leen las claves de R2.
 *
 * SIN PROBAR contra un bucket real. Lo comprobado en la documentación oficial
 * de Cloudflare está citado en supabase/CLOUDFLARE-R2.md.
 */

import { presignUrl, queryString, sha256Hex, signHeaders, encodePath, type SigV4Target } from './sigv4.js';

export const R2_ENV_NAMES = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'R2_PUBLIC_BASE_URL',
] as const;

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
}

export type Env = Record<string, string | undefined>;

/** Lee la configuración. Devuelve los NOMBRES de las variables que faltan, nunca sus valores. */
export function readR2Config(env: Env): { config: R2Config | null; missing: string[] } {
  const value = (name: string) => (env[name] ?? '').trim();
  const missing = R2_ENV_NAMES.filter((name) => value(name).length === 0);
  if (missing.length > 0) return { config: null, missing };
  return {
    missing: [],
    config: {
      accountId: value('R2_ACCOUNT_ID'),
      accessKeyId: value('R2_ACCESS_KEY_ID'),
      secretAccessKey: value('R2_SECRET_ACCESS_KEY'),
      bucket: value('R2_BUCKET'),
      publicBaseUrl: value('R2_PUBLIC_BASE_URL').replace(/\/+$/, ''),
    },
  };
}

export function r2Host(config: R2Config): string {
  return `${config.accountId}.r2.cloudflarestorage.com`;
}

function target(config: R2Config, method: string, key: string | null, extra: Partial<SigV4Target> = {}): SigV4Target {
  return {
    method,
    host: r2Host(config),
    path: key === null ? `/${config.bucket}` : `/${config.bucket}/${key}`,
    region: 'auto',
    service: 's3',
    ...extra,
  };
}

/** Dirección pública de un objeto: la que usan las capas de OBS. */
export function publicObjectUrl(publicBaseUrl: string, key: string): string {
  return `${publicBaseUrl.replace(/\/+$/, '')}${encodePath(`/${key}`)}`;
}

/** Dirección del objeto en la API de S3, sin firma (para la comprobación de CORS). */
export function objectApiUrl(config: R2Config, key: string): string {
  return `https://${r2Host(config)}${encodePath(`/${config.bucket}/${key}`)}`;
}

/**
 * URL firmada para que el navegador suba un archivo con PUT. El tipo y el
 * tamaño van dentro de la firma: una subida con otro tamaño u otro tipo recibe
 * un 403 de R2.
 */
export function presignPut(
  config: R2Config,
  input: { key: string; mime: string; size: number; now: Date; expiresSeconds: number }
): string {
  return presignUrl(
    target(config, 'PUT', input.key, {
      headers: { 'content-type': input.mime, 'content-length': String(input.size) },
    }),
    config,
    { now: input.now, expiresSeconds: input.expiresSeconds }
  );
}

async function signedFetch(
  config: R2Config,
  method: string,
  key: string | null,
  options: { body?: string; contentType?: string; query?: Record<string, string> } = {}
): Promise<Response> {
  const signedTarget = target(config, method, key, {
    query: options.query,
    headers: options.contentType ? { 'content-type': options.contentType } : undefined,
  });
  const headers = signHeaders(signedTarget, config, {
    now: new Date(),
    payloadHash: sha256Hex(options.body ?? ''),
  });
  const query = queryString(options.query);
  const url = `https://${signedTarget.host}${encodePath(signedTarget.path)}${query ? `?${query}` : ''}`;
  return fetch(url, { method, headers, body: options.body });
}

/** Pide un solo objeto de la lista: sirve para saber si el bucket existe y las claves valen. */
export function listOne(config: R2Config): Promise<Response> {
  return signedFetch(config, 'GET', null, { query: { 'list-type': '2', 'max-keys': '1' } });
}

export function putSmallObject(config: R2Config, key: string, body: string, contentType: string): Promise<Response> {
  return signedFetch(config, 'PUT', key, { body, contentType });
}

export function headObject(config: R2Config, key: string): Promise<Response> {
  return signedFetch(config, 'HEAD', key);
}

export function deleteObject(config: R2Config, key: string): Promise<Response> {
  return signedFetch(config, 'DELETE', key);
}
