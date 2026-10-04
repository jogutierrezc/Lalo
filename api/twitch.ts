/**
 * api/twitch.ts
 *
 * Una sola función de Vercel para /api/twitch/clip y /api/twitch/subscriptions
 * (vercel.json las redirige aquí). La lógica vive en server/twitch/, compartida
 * con el servidor local.
 *
 * /api/twitch/eventsub sigue en su propio archivo: necesita leer el cuerpo tal
 * como llega para comprobar la firma de Twitch.
 */

import { clipNodeHandler } from '../server/twitch/clips.js';
import { subscriptionsNodeHandler } from '../server/twitch/subscriptions.js';
import { routeFromRequest } from '../server/apiRoute.js';

export default async function handler(req: any, res: any): Promise<void> {
  const route = routeFromRequest(req, ['twitch']);
  if (route === 'twitch/clip') return clipNodeHandler(req, res);
  if (route === 'twitch/subscriptions') return subscriptionsNodeHandler(req, res);
  res.status(404).json({ error: 'Ruta no encontrada.' });
}
