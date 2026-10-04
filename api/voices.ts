/**
 * api/voices.ts
 *
 * Una sola función de Vercel para /api/voices/create y /api/voices/delete
 * (vercel.json las redirige aquí). La lógica vive en server/voices/handlers.ts,
 * compartida con el servidor local.
 *
 * El cuerpo de «create» llega como application/octet-stream, que Vercel entrega
 * como Buffer en req.body. Una función de Vercel no acepta cuerpos de más de
 * 4,5 MB; por eso el audio de una voz no pasa de 4 MB (server/voices/rules.ts).
 */

import { voicesNodeHandler, type VoicesRoute } from '../server/voices/handlers.js';
import { routeFromRequest } from '../server/apiRoute.js';

const ROUTES: VoicesRoute[] = ['voices/create', 'voices/delete'];
const HANDLERS = new Map(ROUTES.map((route) => [route as string, voicesNodeHandler(route)]));

export default async function handler(req: any, res: any): Promise<void> {
  const run = HANDLERS.get(routeFromRequest(req, ['voices']));
  if (!run) {
    res.status(404).json({ error: 'Ruta no encontrada.' });
    return;
  }
  await run(req, res);
}
