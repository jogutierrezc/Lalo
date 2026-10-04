/**
 * api/voices/create.ts
 *
 * Función de Vercel para POST /api/voices/create. La lógica vive en
 * server/voices/handlers.ts, compartida con el servidor local.
 *
 * El cuerpo llega como application/octet-stream, que Vercel entrega como Buffer
 * en req.body. Una función de Vercel no acepta cuerpos de más de 4,5 MB; por
 * eso el audio de una voz no pasa de 4 MB (server/voices/rules.ts).
 */

import { voicesNodeHandler } from '../../server/voices/handlers.js';

export default voicesNodeHandler('voices/create');
