/**
 * api/twitch/eventsub.ts
 *
 * Función de Vercel para POST /api/twitch/eventsub, la dirección a la que Twitch
 * envía los avisos de EventSub. La lógica vive en server/twitch/eventsub.ts,
 * compartida con el servidor local.
 *
 * Usa la firma web (Request y Response) en lugar de (req, res): así el cuerpo se
 * lee tal como llegó, sin que Vercel lo interprete antes, que es lo que hace
 * falta para comprobar la firma de Twitch.
 * https://vercel.com/docs/functions/runtimes/node-js (comprobado el 2026-10-04)
 */

import { eventsubWebHandler } from '../../server/twitch/eventsub.js';

export function POST(request: Request): Promise<Response> {
  return eventsubWebHandler(request);
}
