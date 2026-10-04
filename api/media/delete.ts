/**
 * api/media/delete.ts
 *
 * Función de Vercel para POST /api/media/delete. La lógica vive en
 * server/storage/handlers.ts, compartida con el servidor local.
 */

import { nodeHandler } from '../../server/storage/handlers.js';

export default nodeHandler('media/delete');
