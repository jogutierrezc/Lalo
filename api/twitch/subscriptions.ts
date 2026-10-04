/**
 * api/twitch/subscriptions.ts
 *
 * Función de Vercel para /api/twitch/subscriptions. La lógica vive en
 * server/twitch/subscriptions.ts, compartida con el servidor local.
 */

import { subscriptionsNodeHandler } from '../../server/twitch/subscriptions.js';

export default subscriptionsNodeHandler;
