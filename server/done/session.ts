/**
 * server/done/session.ts
 *
 * Quién llama a las rutas del panel (ajustes, memoria, decir en el chat): el creador, por su sesión de Supabase.
 * El id del perfil sale de la sesión, NUNCA del cuerpo de la petición: un creador no puede tocar los datos de otro.
 */

import { fail, isFail, type IntegrationRequest, type IntegrationResult } from '../integrations/http.js';
import type { Env } from '../integrations/store.js';
import { loadActor, notConfigured, openStores, type Actor, type DoneDeps, type Stores } from './core.js';

export interface Session {
  stores: Stores;
  actor: Actor;
}

export async function sessionOf(req: IntegrationRequest, env: Env, deps: DoneDeps): Promise<Session | IntegrationResult> {
  const caller = await deps.auth(req, env);
  if (isFail(caller)) return caller;
  const stores = openStores(env, deps);
  if (!stores) return notConfigured();
  const profile = await stores.lux.profile(caller.id);
  if (!profile) return fail(403, 'no_profile', 'No se encontró tu perfil.');
  return { stores, actor: await loadActor(stores, profile) };
}

export const isSession = (value: Session | IntegrationResult): value is Session => 'actor' in value;

/** Done tiene que estar permitido para la cuenta (el administrador puede apagarlo por cuenta). */
export const doneDisabled = (): IntegrationResult => fail(403, 'done_disabled', 'Done no está activado para tu cuenta.');
