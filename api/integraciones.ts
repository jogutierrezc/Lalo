/**
 * api/integraciones.ts
 *
 * Una sola función de Vercel para todas las rutas de integraciones
 * (vercel.json las redirige aquí con los parámetros `g`, `a` e `id`):
 *
 *   /api/spotify/<acción>      login, callback, disconnect, status, test, now
 *   /api/kofi/<acción o id>    status, connect, token, regenerate, disconnect,
 *                              reset-goal, o el webhook de Ko-fi si es un id largo
 *   /api/riot/<acción>         status, link, unlink, state
 *   /api/integrations/status   estado del servidor para el administrador
 *
 * La lógica vive en server/integrations/, compartida con el servidor local.
 *
 * Cuerpo del webhook de Ko-fi: es un formulario (application/x-www-form-urlencoded).
 * Con la firma (req, res), Vercel entrega req.body ya interpretado como objeto para
 * ese tipo de contenido (https://vercel.com/docs/functions/runtimes/node-js, apartado
 * de los ayudantes de petición). Sirve así: Ko-fi no firma el cuerpo, la comprobación
 * es una clave dentro del JSON. parseKofiBody acepta además texto y bytes, por si acaso.
 */

import { integrationNodeHandler } from '../server/integrations/handlers.js';
import { routeFromRequest } from '../server/apiRoute.js';

const first = (value: unknown): string => (Array.isArray(value) ? String(value[0] ?? '') : typeof value === 'string' ? value : '');

export default async function handler(req: any, res: any): Promise<void> {
  const route = routeFromRequest(req, ['spotify', 'kofi', 'riot', 'integrations']);
  let [group, part] = route.split('/');
  const path = String(req.url ?? '').split('?')[0];
  if (group === 'kofi' || (!group && path.includes('/api/kofi/'))) {
    // El tramo final es una acción del panel o el id del webhook, que no cabe en las reglas de routeFromRequest
    group = 'kofi';
    part = first(req.query?.id) || (/\/api\/kofi\/([A-Za-z0-9_-]{1,80})$/.exec(path)?.[1] ?? '');
  }
  if (!group || !part) {
    res.status(404).json({ error: 'Ruta no encontrada.' });
    return;
  }
  await integrationNodeHandler(group, part, req, res);
}
