/**
 * api/twitch/clip.ts
 *
 * Función de Vercel para GET /api/twitch/clip. La lógica vive en
 * server/twitch/clips.ts, compartida con el servidor local.
 */

import { clipNodeHandler } from '../../server/twitch/clips.js';

export default clipNodeHandler;
