/**
 * api/storage.ts
 *
 * Una sola función de Vercel para todas las rutas de archivos:
 *   /api/storage/status, /api/storage/test,
 *   /api/media/upload-session, /api/media/complete, /api/media/delete
 *
 * El plan gratuito de Vercel admite pocas funciones por despliegue, así que las
 * rutas se agrupan aquí y vercel.json las redirige con los parámetros `g` y `a`.
 * La lógica vive en server/storage/handlers.ts, compartida con el servidor local.
 */

import { nodeHandler, type ApiRoute } from '../server/storage/handlers.js';
import { routeFromRequest } from '../server/apiRoute.js';

const ROUTES: ApiRoute[] = ['storage/status', 'storage/test', 'media/upload-session', 'media/complete', 'media/delete'];
const HANDLERS = new Map(ROUTES.map((route) => [route as string, nodeHandler(route)]));

export default async function handler(req: any, res: any): Promise<void> {
  const run = HANDLERS.get(routeFromRequest(req, ['storage', 'media']));
  if (!run) {
    res.status(404).json({ error: 'Ruta no encontrada.' });
    return;
  }
  await run(req, res);
}
