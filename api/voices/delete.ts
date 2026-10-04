/**
 * api/voices/delete.ts
 *
 * Función de Vercel para POST /api/voices/delete. La lógica vive en
 * server/voices/handlers.ts, compartida con el servidor local.
 */

import { voicesNodeHandler } from '../../server/voices/handlers.js';

export default voicesNodeHandler('voices/delete');
