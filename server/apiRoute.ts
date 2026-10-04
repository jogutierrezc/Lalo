/**
 * server/apiRoute.ts
 *
 * Averigua qué ruta pidió el navegador cuando varias comparten una función de
 * Vercel. vercel.json redirige, por ejemplo, /api/media/complete a
 * /api/storage?g=media&a=complete; aquí se vuelve a componer «media/complete».
 * Si los parámetros no llegan, se lee de la dirección original.
 */

interface RoutedRequest {
  query?: Record<string, unknown>;
  url?: string;
}

const SAFE = /^[a-z][a-z-]{0,30}$/;

const first = (value: unknown): string => (Array.isArray(value) ? String(value[0] ?? '') : typeof value === 'string' ? value : '');

/** Devuelve «grupo/acción», o cadena vacía si no es una ruta de los grupos permitidos. */
export function routeFromRequest(req: RoutedRequest, groups: string[]): string {
  let group = first(req.query?.g);
  let action = first(req.query?.a);
  if (!group || !action) {
    const match = /\/api\/([a-z-]+)\/([a-z-]+)/.exec((req.url ?? '').split('?')[0]);
    if (match) {
      group = group || match[1];
      action = action || match[2];
    }
  }
  if (!SAFE.test(group) || !SAFE.test(action) || !groups.includes(group)) return '';
  return `${group}/${action}`;
}
