/**
 * server/done/handlers.ts
 *
 * Entrada única de Done AI: /api/done/<acción>. Cada acción vive en su propio archivo, pequeña y separada:
 *
 *   chat      POST  (clave de OBS o de lectura)  ask | on | off | outbox | outbox_done | spontaneous | event | summary   chat.ts
 *   speech    GET   (clave de lectura)           cola de frases para el overlay                                      speechRoute.ts
 *   model     GET   (clave de lectura)           el GLB del personaje                                                speechRoute.ts
 *   settings  GET/PUT (sesión del creador)       ajustes y clave de lectura del overlay                              settingsRoute.ts
 *   memory    GET/POST/PATCH/DELETE (sesión)     memoria de Done                                                     memoryRoute.ts
 *   say       GET/POST (sesión)                  decir en el chat                                                    sayRoute.ts
 *   release   GET (público) / POST (admin)       versión de los comandos para el bot de Python                       releaseRoute.ts
 *
 * Done usa el proveedor, las claves, los modelos y los créditos de Lux (ver core.ts). Nunca se devuelve una clave ni un
 * token; los errores de los proveedores se registran sin la clave ni el texto de la petición.
 */

import type { IntegrationRequest, IntegrationResult } from '../integrations/http.js';
import { fail } from '../integrations/http.js';
import type { Env } from '../integrations/store.js';
import { defaultDoneDeps, type DoneDeps } from './core.js';
import { chatRoute } from './chat.js';
import { modelRoute, speechRoute } from './speechRoute.js';
import { settingsRoute } from './settingsRoute.js';
import { memoryRoute } from './memoryRoute.js';
import { sayRoute } from './sayRoute.js';
import { releaseRoute } from './releaseRoute.js';

export const DONE_ACTIONS = ['chat', 'speech', 'model', 'settings', 'memory', 'say', 'release'] as const;
export type DoneAction = (typeof DONE_ACTIONS)[number];

/** `overrides` solo lo usan las pruebas. */
export async function handleDone(action: DoneAction, req: IntegrationRequest, env: Env = process.env, overrides: Partial<DoneDeps> = {}): Promise<IntegrationResult> {
  const deps: DoneDeps = { ...defaultDoneDeps, ...overrides };
  switch (action) {
    case 'chat':
      return chatRoute(req, env, deps);
    case 'speech':
      return speechRoute(req, env, deps);
    case 'model':
      return modelRoute(req, env, deps);
    case 'settings':
      return settingsRoute(req, env, deps);
    case 'memory':
      return memoryRoute(req, env, deps);
    case 'say':
      return sayRoute(req, env, deps);
    case 'release':
      return releaseRoute(req, env, deps);
    default:
      return fail(404, 'not_found', 'Ruta no encontrada.');
  }
}

export {
  doneAskForProfile,
  doneOutboxForProfile,
  doneProactiveStatusForProfile,
  doneRecordChannelEvent,
  doneSettingsForProfile,
  doneSpontaneousForProfile,
  doneSummaryForProfile,
  doneSwitchForProfile,
} from './forProfile.js';
export type { DoneEventInput, DoneProactiveStatus } from './forProfile.js';
