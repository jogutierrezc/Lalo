/**
 * api/storage/test.ts
 *
 * Función de Vercel para POST /api/storage/test. La lógica vive en
 * server/storage/handlers.ts, compartida con el servidor local.
 */

import { nodeHandler } from '../../server/storage/handlers.js';

export default nodeHandler('storage/test');
