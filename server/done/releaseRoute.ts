/**
 * server/done/releaseRoute.ts
 *
 * GET  /api/done/release   versión publicada de los comandos de Done (pública: la lee el bot al arrancar)
 * POST /api/done/release   (administrador) publica una versión nueva con su nota
 */

import { fail, isFail, type IntegrationRequest, type IntegrationResult } from '../integrations/http.js';
import type { Env } from '../integrations/store.js';
import { bodyOf, clock, doneFailure, notConfigured, openStores, type DoneDeps } from './core.js';
import { DONE_RELEASE_SETTING, nextDoneRelease, parseDoneRelease } from './release.js';

export async function releaseRoute(req: IntegrationRequest, env: Env, deps: DoneDeps): Promise<IntegrationResult> {
  const stores = openStores(env, deps);
  if (!stores) return notConfigured();
  const method = req.method.toUpperCase();
  try {
    if (method === 'GET') {
      const current = parseDoneRelease(await stores.lux.setting(DONE_RELEASE_SETTING));
      return { status: 200, body: { version: current.version, note: current.note, at: current.at } };
    }
    if (method !== 'POST') return fail(405, 'method', 'Esta ruta admite GET y POST.');
    const caller = await deps.auth(req, env);
    if (isFail(caller)) return caller;
    if (caller.role !== 'admin') return fail(403, 'not_admin', 'Solo para administradores.');
    const note = typeof bodyOf(req.body).note === 'string' ? (bodyOf(req.body).note as string) : '';
    const published = nextDoneRelease(parseDoneRelease(await stores.lux.setting(DONE_RELEASE_SETTING)), note, clock(deps));
    await stores.lux.putSetting(DONE_RELEASE_SETTING, JSON.stringify(published));
    return { status: 200, body: { version: published.version, note: published.note, at: published.at } };
  } catch (err) {
    return doneFailure(err, 'done/release');
  }
}
