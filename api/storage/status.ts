/**
 * api/storage/status.ts
 *
 * Función de Vercel para GET /api/storage/status. La lógica vive en
 * server/storage/handlers.ts, compartida con el servidor local.
 */

import { nodeHandler } from '../../server/storage/handlers.js';

export default nodeHandler('storage/status');
