import { describe, expect, it } from 'vitest';
import { amzDate, encodePath, encodeRfc3986, presignUrl, signHeaders } from '../server/storage/sigv4';
import {
  UPLOAD_ALLOWED_MIME,
  buildObjectKey,
  checkUpload,
  isAllowedMime,
  keyBelongsTo,
  kindOfMime,
  safeFileName,
} from '../server/storage/limits';
import { presignPut, publicObjectUrl, readR2Config } from '../server/storage/r2';
import { missingSupabaseEnv, handleApi } from '../server/storage/handlers';
import { MEDIA_ALLOWED_MIME } from '../src/lib/cloudTypes';

// Credenciales de ejemplo publicadas por AWS en su documentación de Signature V4 para S3.
const AWS_EXAMPLE = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
};
const AWS_NOW = new Date('2013-05-24T00:00:00Z');

describe('firma AWS Signature V4', () => {
  it('reproduce la URL firmada del ejemplo de AWS (GET de test.txt, 24 horas)', () => {
    const url = presignUrl(
      { method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', region: 'us-east-1', service: 's3' },
      AWS_EXAMPLE,
      { now: AWS_NOW, expiresSeconds: 86400 }
    );
    expect(url).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt' +
        '?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
        '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request' +
        '&X-Amz-Date=20130524T000000Z' +
        '&X-Amz-Expires=86400' +
        '&X-Amz-SignedHeaders=host' +
        '&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404'
    );
  });

  it('reproduce la cabecera Authorization del ejemplo de AWS (GET con Range)', () => {
    const headers = signHeaders(
      {
        method: 'GET',
        host: 'examplebucket.s3.amazonaws.com',
        path: '/test.txt',
        region: 'us-east-1',
        service: 's3',
        headers: { range: 'bytes=0-9' },
      },
      AWS_EXAMPLE,
      { now: AWS_NOW }
    );
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'
    );
    expect(headers['x-amz-date']).toBe('20130524T000000Z');
  });

  it('reproduce el ejemplo de AWS con parámetros en la URL (lista con max-keys y prefix)', () => {
    const headers = signHeaders(
      {
        method: 'GET',
        host: 'examplebucket.s3.amazonaws.com',
        path: '/',
        region: 'us-east-1',
        service: 's3',
        query: { 'max-keys': '2', prefix: 'J' },
      },
      AWS_EXAMPLE,
      { now: AWS_NOW }
    );
    expect(headers.authorization).toContain('Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
  });

  it('codifica como pide AWS', () => {
    expect(encodeRfc3986("a b/c*(d)'!~")).toBe('a%20b%2Fc%2A%28d%29%27%21~');
    expect(encodePath('/cubo/carpeta/mi archivo.png')).toBe('/cubo/carpeta/mi%20archivo.png');
    expect(amzDate(new Date('2026-10-03T07:08:09.123Z'))).toBe('20261003T070809Z');
  });

  it('la firma cambia si cambia una cabecera firmada', () => {
    const base = { method: 'PUT', host: 'x.r2.cloudflarestorage.com', path: '/b/k', region: 'auto', service: 's3' };
    const options = { now: AWS_NOW, expiresSeconds: 300 };
    const a = presignUrl({ ...base, headers: { 'content-length': '100' } }, AWS_EXAMPLE, options);
    const b = presignUrl({ ...base, headers: { 'content-length': '101' } }, AWS_EXAMPLE, options);
    expect(a).toContain('X-Amz-SignedHeaders=content-length%3Bhost');
    expect(a.split('X-Amz-Signature=')[1]).not.toBe(b.split('X-Amz-Signature=')[1]);
  });
});

describe('configuración de R2', () => {
  const full = {
    R2_ACCOUNT_ID: 'abc123',
    R2_ACCESS_KEY_ID: 'id',
    R2_SECRET_ACCESS_KEY: 'secreto',
    R2_BUCKET: 'lalo',
    R2_PUBLIC_BASE_URL: 'https://pub-xyz.r2.dev/',
  };

  it('dice los nombres que faltan y nunca los valores', () => {
    const { config, missing } = readR2Config({ R2_BUCKET: 'lalo', R2_ACCOUNT_ID: '  ' });
    expect(config).toBeNull();
    expect(missing).toEqual(['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_PUBLIC_BASE_URL']);
  });

  it('con todo puesto quita la barra final de la dirección pública', () => {
    const { config, missing } = readR2Config(full);
    expect(missing).toEqual([]);
    expect(config?.publicBaseUrl).toBe('https://pub-xyz.r2.dev');
    expect(publicObjectUrl(config!.publicBaseUrl, 'carpeta/mi archivo.png')).toBe('https://pub-xyz.r2.dev/carpeta/mi%20archivo.png');
  });

  it('la URL de subida va al bucket, con región auto, y firma tipo y tamaño', () => {
    const { config } = readR2Config(full);
    const url = new URL(
      presignPut(config!, { key: 'carpeta/a.png', mime: 'image/png', size: 2048, now: AWS_NOW, expiresSeconds: 300 })
    );
    expect(url.origin + url.pathname).toBe('https://abc123.r2.cloudflarestorage.com/lalo/carpeta/a.png');
    expect(url.searchParams.get('X-Amz-Credential')).toBe('id/20130524/auto/s3/aws4_request');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(url.search).not.toContain('secreto');
  });
});

describe('límites de las subidas', () => {
  const MB = 1024 * 1024;
  const plan = { storage_limit_bytes: 40 * MB, max_file_bytes: 5 * MB, max_files: 30 };
  const empty = { bytes: 0, files: 0 };

  it('acepta un archivo que cabe', () => {
    expect(checkUpload(plan, empty, { size: 2 * MB, mime: 'image/png' })).toEqual({ ok: true });
    expect(checkUpload(plan, { bytes: 35 * MB, files: 29 }, { size: 5 * MB, mime: 'video/mp4' })).toEqual({ ok: true });
  });

  it('rechaza por tipo, por tamaño, por número de archivos y por espacio', () => {
    const reason = (usage: typeof empty, size: number, mime: string) => {
      const check = checkUpload(plan, usage, { size, mime });
      return check.ok ? 'ok' : check.reason;
    };
    expect(reason(empty, 0, 'image/png')).toBe('empty');
    expect(reason(empty, Number.NaN, 'image/png')).toBe('empty');
    expect(reason(empty, MB, 'application/pdf')).toBe('mime');
    expect(reason(empty, MB, '')).toBe('mime');
    expect(reason(empty, 5 * MB + 1, 'image/png')).toBe('file_too_large');
    expect(reason({ bytes: MB, files: 30 }, MB, 'image/png')).toBe('too_many_files');
    expect(reason({ bytes: 38 * MB, files: 3 }, 3 * MB, 'image/png')).toBe('storage_full');
  });

  it('explica el motivo con cifras', () => {
    const check = checkUpload(plan, { bytes: 38 * MB, files: 3 }, { size: 3 * MB, mime: 'image/png' });
    expect(check.ok ? '' : check.message).toContain('solo te quedan 2 MB');
  });

  it('la lista de tipos coincide con la de la app', () => {
    expect([...UPLOAD_ALLOWED_MIME]).toEqual([...MEDIA_ALLOWED_MIME]);
    expect(isAllowedMime(' IMAGE/PNG ')).toBe(true);
    expect(kindOfMime('audio/mpeg')).toBe('audio');
    expect(kindOfMime('text/plain')).toBeNull();
  });

  it('limpia los nombres y arma la clave del objeto', () => {
    expect(safeFileName('Mi Vídeo (final) ñ.MP4')).toBe('mi-video-final-n.mp4');
    expect(safeFileName('../../etc/passwd')).toBe('etc-passwd');
    expect(safeFileName('¿¡!?')).toBe('archivo');
    expect(safeFileName(`${'a'.repeat(200)}.png`)).toHaveLength(80);
    expect(buildObjectKey('carpeta-1', 'id', 'Hola Mundo.png')).toBe('carpeta-1/id-hola-mundo.png');
  });

  it('solo acepta claves dentro de la carpeta del streamer', () => {
    expect(keyBelongsTo('carpeta-1', 'carpeta-1/id-a.png')).toBe(true);
    expect(keyBelongsTo('carpeta-1', 'carpeta-2/id-a.png')).toBe(false);
    expect(keyBelongsTo('carpeta-1', 'carpeta-1/../carpeta-2/a.png')).toBe(false);
    expect(keyBelongsTo('carpeta-1', 'carpeta-1/sub/a.png')).toBe(false);
    expect(keyBelongsTo('carpeta-1', 'carpeta-10/a.png')).toBe(false);
    expect(keyBelongsTo('', '/a.png')).toBe(false);
  });
});

describe('rutas del servidor sin configurar', () => {
  it('dice qué variables de Supabase faltan', () => {
    expect(missingSupabaseEnv({})).toEqual(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
    expect(missingSupabaseEnv({ VITE_SUPABASE_URL: 'https://x.supabase.co' })).toEqual(['SUPABASE_SERVICE_ROLE_KEY']);
    expect(missingSupabaseEnv({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' })).toEqual([]);
  });

  it('responde 503 con los nombres, sin tocar la red', async () => {
    const result = await handleApi('storage/status', { method: 'GET', headers: {}, body: null }, {});
    expect(result.status).toBe(503);
    expect(result.body.code).toBe('server_not_configured');
    expect(result.body.missing).toEqual(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  });

  it('rechaza el método equivocado y la falta de sesión', async () => {
    const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };
    expect((await handleApi('media/delete', { method: 'GET', headers: {}, body: null }, env)).status).toBe(405);
    const noSession = await handleApi('media/upload-session', { method: 'POST', headers: {}, body: {} }, env);
    expect(noSession.status).toBe(401);
    expect(noSession.body.code).toBe('no_session');
  });
});
