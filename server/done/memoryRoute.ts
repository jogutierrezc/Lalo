/**
 * server/done/memoryRoute.ts
 *
 *   GET    /api/done/memory                    lista los recuerdos de Done del creador
 *   POST   /api/done/memory   { kind, content }          crea uno (dato o estilo)
 *   PATCH  /api/done/memory   { id, content?, pinned? }  edita uno
 *   DELETE /api/done/memory   { id }                      lo borra
 *
 * El dueño es siempre quien hace la petición (su sesión) y cada operación filtra por él: el navegador no escribe en la
 * base de datos. Los límites son los de Lux (memory.ts): 300 caracteres por recuerdo y 100 en total.
 */

import { fail, type IntegrationRequest, type IntegrationResult } from '../integrations/http.js';
import type { Env } from '../integrations/store.js';
import { MEMORY_SAVED_MAX, MEMORY_USED_IN_REPLY, expiresAtFor, normalizeMemoryEdit, normalizeNewMemory } from '../lux/memory.js';
import { bodyOf, clock, doneFailure, type DoneDeps } from './core.js';
import { doneDisabled, isSession, sessionOf } from './session.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_LOCKED = 'Ese recuerdo lo puso el administrador. Solo él puede cambiarlo.';

export async function memoryRoute(req: IntegrationRequest, env: Env, deps: DoneDeps): Promise<IntegrationResult> {
  const method = req.method.toUpperCase();
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) return fail(405, 'method', 'Esta ruta admite GET, POST, PATCH y DELETE.');
  try {
    const session = await sessionOf(req, env, deps);
    if (!isSession(session)) return session;
    const { stores, actor } = session;
    if (!actor.allowed) return doneDisabled();
    const owner = actor.profile.id;
    const nowMs = clock(deps);

    if (method === 'GET') {
      await stores.done.memoryPrune(owner, new Date(nowMs).toISOString());
      const items = await stores.done.memoryList(owner);
      return {
        status: 200,
        body: {
          memories: items,
          saved: items.length,
          savedMax: MEMORY_SAVED_MAX,
          usedInReply: actor.settings.memoryEnabled ? Math.min(items.length, MEMORY_USED_IN_REPLY) : 0,
          usedMax: MEMORY_USED_IN_REPLY,
          memoryEnabled: actor.settings.memoryEnabled,
        },
      };
    }

    const raw = bodyOf(req.body);

    if (method === 'POST') {
      const check = normalizeNewMemory(raw);
      if (!check.ok) return fail(400, 'bad_memory', check.message, { field: check.field });
      const items = await stores.done.memoryList(owner);
      if (items.length >= MEMORY_SAVED_MAX) return fail(409, 'memory_full', `Done ya tiene ${MEMORY_SAVED_MAX} recuerdos guardados. Borra alguno para añadir más.`);
      await stores.done.memoryInsert(owner, [
        { kind: check.value.kind, subject: null, content: check.value.content, pinned: false, source: 'manual', expiresAt: expiresAtFor(check.value.kind, false, nowMs) },
      ]);
      return { status: 200, body: { ok: true } };
    }

    const id = typeof raw.id === 'string' ? raw.id.trim() : (req.query.id ?? '').trim();
    if (!UUID.test(id)) return fail(400, 'bad_id', 'El recuerdo no es válido.');
    // Lo que escribe el administrador (source 'admin') se ve, pero no lo edita ni lo borra el creador
    const current = await stores.done.memoryGet(owner, id);
    if (!current) return fail(404, 'memory_not_found', 'Ese recuerdo no existe.');
    if (current.source === 'admin') return fail(403, 'admin_memory', ADMIN_LOCKED);

    if (method === 'DELETE') {
      return (await stores.done.memoryDelete(owner, id)) ? { status: 200, body: { ok: true } } : fail(404, 'memory_not_found', 'Ese recuerdo no existe.');
    }

    const edit = normalizeMemoryEdit(raw);
    if (!edit.ok) return fail(400, 'bad_memory', edit.message, { field: edit.field });
    const patch: { content?: string; pinned?: boolean; expiresAt?: string | null } = {};
    if (edit.value.content !== undefined) patch.content = edit.value.content;
    if (edit.value.pinned !== undefined) {
      patch.pinned = edit.value.pinned;
      // Fijar quita la caducidad; desfijar un recuerdo del chat le da 30 días desde ahora
      patch.expiresAt = expiresAtFor(current.kind, edit.value.pinned, nowMs);
    }
    return (await stores.done.memoryUpdate(owner, id, patch)) ? { status: 200, body: { ok: true } } : fail(404, 'memory_not_found', 'Ese recuerdo no existe.');
  } catch (err) {
    return doneFailure(err, 'done/memory');
  }
}
