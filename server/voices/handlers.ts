/**
 * server/voices/handlers.ts
 *
 * Crear y eliminar voces del catálogo. Lógica compartida por las funciones de
 * Vercel (api/voices/*) y por el servidor local (server/index.ts).
 *
 *   POST /api/voices/create   solo administrador. Cuerpo binario (ver rules.ts)
 *   POST /api/voices/delete   solo administrador. Cuerpo JSON {id, catalogOnly?}
 *
 * Quién llama se comprueba igual que en el almacenamiento: con `identify` e
 * `isAdmin` de server/storage/handlers.ts (sesión de Supabase verificada con la
 * clave de servicio y perfil con rol 'admin' y estado 'active').
 *
 * Fish Audio, según su documentación (docs.fish.audio/api-reference, octubre de
 * 2026): POST https://api.fish.audio/model en multipart, con cabecera
 * Authorization: Bearer; la respuesta trae `_id`, que es el reference_id de la
 * síntesis, y `state` (created, training, trained, failed). DELETE /model/{id}
 * borra el modelo. Siempre se manda visibility=private.
 *
 * SIN PROBAR contra Fish Audio ni contra Supabase reales. La clave de Fish
 * Audio no se escribe nunca en los registros.
 */

import {
  fail,
  bodyOf,
  identify,
  isAdmin,
  isResult,
  type ApiRequest,
  type ApiResult,
  type Context,
  type NodeLikeRequest,
  type NodeLikeResponse,
} from '../storage/handlers.js';
import type { Env } from '../storage/r2.js';
import {
  VOICE_DESCRIPTION_MAX,
  VOICE_MAX_TOTAL_BYTES,
  VOICE_MAX_TOTAL_LABEL,
  checkVoiceFiles,
  decodeVoiceEnvelope,
  fishDeleteOutcome,
  fishProblem,
  permissionProblem,
  voiceNameProblem,
  type VoiceEnvelopeMeta,
} from './rules.js';

export type VoicesRoute = 'voices/create' | 'voices/delete';

const FISH_BASE = 'https://api.fish.audio';
/** Margen para la ficha que acompaña a los audios. */
const ENVELOPE_SLACK_BYTES = 32 * 1024;
const MIGRATION_HINT = 'Puede faltar la migración 0009_voices.sql en Supabase.';

type FetchLike = typeof fetch;

const describe = (err: unknown) => (err instanceof Error ? err.message : 'error desconocido');

/** La clave de Fish Audio, leída como en server/ttsHandler.ts. Cadena vacía si falta. */
function fishKey(env: Env): string {
  return (env.FISH_AUDIO_API_KEY ?? '').replace(/^["']|["']$/g, '').trim();
}

function bytesOf(body: unknown): Uint8Array | null {
  if (body instanceof Uint8Array) return body; // Buffer también lo es
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  return null;
}

const MIME_BY_EXTENSION: Record<string, string> = { wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4' };

function mimeOf(file: { name: string; type: string }): string {
  if (file.type.startsWith('audio/')) return file.type;
  return MIME_BY_EXTENSION[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

// ---------- Fish Audio ----------

async function fishCreateModel(
  doFetch: FetchLike,
  apiKey: string,
  meta: VoiceEnvelopeMeta,
  parts: Uint8Array[]
): Promise<Response> {
  const form = new FormData();
  form.append('type', 'tts');
  form.append('title', meta.name.trim());
  form.append('train_mode', 'fast');
  // Siempre privada: no debe aparecer en la biblioteca pública de Fish Audio
  form.append('visibility', 'private');
  if (meta.description.trim()) form.append('description', meta.description.trim());
  parts.forEach((part, index) => {
    const file = meta.files[index];
    form.append('voices', new Blob([part as unknown as BlobPart], { type: mimeOf(file) }), file.name || `audio-${index + 1}`);
  });
  // Sin Content-Type: fetch pone el de multipart con su separador
  return doFetch(`${FISH_BASE}/model`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form });
}

function fishDeleteModel(doFetch: FetchLike, apiKey: string, referenceId: string): Promise<Response> {
  return doFetch(`${FISH_BASE}/model/${encodeURIComponent(referenceId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

/** Intenta borrar un modelo recién creado que no llegó al catálogo. true si se borró. */
async function discardModel(doFetch: FetchLike, apiKey: string, referenceId: string): Promise<boolean> {
  try {
    return (await fishDeleteModel(doFetch, apiKey, referenceId)).ok;
  } catch {
    return false;
  }
}

// ---------- Crear ----------

async function createVoice(ctx: Context, req: ApiRequest, env: Env, doFetch: FetchLike): Promise<ApiResult> {
  if (!isAdmin(ctx.caller)) return fail(403, 'not_admin', 'Solo el administrador puede crear voces.');

  const apiKey = fishKey(env);
  if (!apiKey) {
    return fail(503, 'fish_not_configured', 'Al servidor le falta la clave de Fish Audio.', { missing: ['FISH_AUDIO_API_KEY'] });
  }

  const bytes = bytesOf(req.body);
  if (!bytes) return fail(400, 'bad_request', 'El envío no llegó con la forma esperada. Recarga la página y vuelve a probar.');
  if (bytes.byteLength > VOICE_MAX_TOTAL_BYTES + ENVELOPE_SLACK_BYTES) {
    return fail(413, 'too_large', `El audio pesa más de ${VOICE_MAX_TOTAL_LABEL}, que es lo máximo que acepta el servidor en un envío.`);
  }
  const envelope = decodeVoiceEnvelope(bytes);
  if (!envelope) return fail(400, 'bad_request', 'El envío no llegó con la forma esperada. Recarga la página y vuelve a probar.');
  const { meta, parts } = envelope;

  // Las mismas reglas que ya aplicó el navegador
  const files = checkVoiceFiles(meta.files);
  if (parts.length === 0 || !files.ok || files.ignored > 0) {
    const reason = files.problem ?? files.files.find((file) => file.problem)?.problem ?? 'Falta el audio.';
    return fail(400, 'bad_audio', files.ignored > 0 ? 'Solo se admiten cinco audios por voz.' : reason);
  }
  if (meta.origin === 'recorded' && parts.length !== 1) return fail(400, 'bad_audio', 'Una grabación es un solo audio.');
  if (meta.description.trim().length > VOICE_DESCRIPTION_MAX) {
    return fail(400, 'bad_description', `La descripción no puede pasar de ${VOICE_DESCRIPTION_MAX} letras.`);
  }
  // El permiso es obligatorio: lo pide la política de voces de la app (src/legal/voces.ts)
  const permission = permissionProblem(meta.owner, meta.permissionBy, meta.confirmed);
  if (permission) return fail(400, 'no_permission', permission);

  const existing = await ctx.db.from('voices').select('name');
  if (existing.error) return fail(502, 'catalog_read', `No se pudo leer el catálogo: ${existing.error.message}. ${MIGRATION_HINT}`);
  const nameProblem = voiceNameProblem(
    meta.name,
    (existing.data ?? []).map((row) => String((row as { name: unknown }).name))
  );
  if (nameProblem) return fail(409, 'bad_name', nameProblem);

  // 1. El modelo en Fish Audio
  let response: Response;
  try {
    response = await fishCreateModel(doFetch, apiKey, meta, parts);
  } catch (err) {
    return fail(502, 'fish_unreachable', `No se pudo llegar a Fish Audio: ${describe(err)}`, { stage: 'fish' });
  }
  const text = await response.text().catch(() => '');
  if (!response.ok) return fail(502, 'fish_failed', fishProblem('crear', response.status, text), { stage: 'fish' });

  let model: { _id?: unknown; state?: unknown } = {};
  try {
    model = JSON.parse(text) as typeof model;
  } catch {
    // Se trata abajo: sin id no hay voz
  }
  const referenceId = typeof model._id === 'string' ? model._id.trim() : '';
  const state = typeof model.state === 'string' ? model.state : 'desconocido';
  if (!referenceId) {
    return fail(502, 'fish_failed', 'Fish Audio aceptó el audio, pero no devolvió el id de la voz. No se guardó nada en el catálogo.', {
      stage: 'fish',
    });
  }
  if (state === 'failed') {
    const discarded = await discardModel(doFetch, apiKey, referenceId);
    return fail(
      502,
      'fish_failed',
      `Fish Audio no pudo preparar la voz con ese audio. Prueba con otra grabación, más clara y sin ruido.${
        discarded ? '' : ` El modelo fallido quedó en Fish Audio con el id ${referenceId}: bórralo desde su web.`
      }`,
      { stage: 'fish' }
    );
  }

  // 2. La fila del catálogo. Nace oculta.
  const inserted = await ctx.db
    .from('voices')
    .insert({
      name: meta.name.trim(),
      description: meta.description.trim(),
      reference_id: referenceId,
      visible: false,
      is_default: false,
      origin: meta.origin,
      voice_owner: meta.owner,
      permission_by: meta.owner === 'other' ? meta.permissionBy.trim() : null,
      permission_confirmed_at: new Date().toISOString(),
      created_by: ctx.caller.id,
    })
    .select('*')
    .maybeSingle();

  if (inserted.error || !inserted.data) {
    // Sin fila no debe quedar un modelo suelto en Fish Audio
    const discarded = await discardModel(doFetch, apiKey, referenceId);
    return fail(
      502,
      'catalog_failed',
      `La voz se creó en Fish Audio, pero no se pudo guardar en el catálogo: ${inserted.error?.message ?? 'sin respuesta'}. ${
        discarded
          ? 'El modelo se borró de Fish Audio, así que no queda nada a medias.'
          : `No se pudo borrar el modelo recién creado (id ${referenceId}): bórralo desde la web de Fish Audio.`
      } ${MIGRATION_HINT}`,
      { stage: 'catalogo' }
    );
  }

  return { status: 200, body: { voice: inserted.data, state, ready: state === 'trained' } };
}

// ---------- Eliminar ----------

async function deleteVoice(ctx: Context, req: ApiRequest, env: Env, doFetch: FetchLike): Promise<ApiResult> {
  if (!isAdmin(ctx.caller)) return fail(403, 'not_admin', 'Solo el administrador puede eliminar voces.');
  const body = bodyOf(req);
  const id = body.id;
  const catalogOnly = body.catalogOnly === true;
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return fail(400, 'bad_request', 'Falta la voz que hay que eliminar.');

  const found = await ctx.db.from('voices').select('id, name, reference_id, is_default').eq('id', id).maybeSingle();
  if (found.error) return fail(502, 'catalog_read', `No se pudo leer el catálogo: ${found.error.message}. ${MIGRATION_HINT}`);
  if (!found.data) return fail(404, 'not_found', 'Esa voz ya no está en el catálogo.');
  if (found.data.is_default) {
    return fail(409, 'is_default', 'La voz por defecto no se puede eliminar. Elige antes otra voz por defecto.');
  }
  const referenceId = String(found.data.reference_id);

  // 1. El modelo en Fish Audio
  let fish: 'deleted' | 'not_found' | 'not_owned' | 'skipped' = 'skipped';
  if (!catalogOnly) {
    const apiKey = fishKey(env);
    if (!apiKey) {
      return fail(503, 'fish_not_configured', 'Al servidor le falta la clave de Fish Audio, así que no puede borrar el modelo.', {
        missing: ['FISH_AUDIO_API_KEY'],
        canCatalogOnly: true,
      });
    }
    let response: Response;
    try {
      response = await fishDeleteModel(doFetch, apiKey, referenceId);
    } catch (err) {
      return fail(502, 'fish_unreachable', `No se pudo llegar a Fish Audio: ${describe(err)}`, { canCatalogOnly: true });
    }
    const outcome = fishDeleteOutcome(response.status);
    if (outcome === 'failed') {
      const text = await response.text().catch(() => '');
      return fail(502, 'fish_failed', fishProblem('borrar', response.status, text), { canCatalogOnly: true });
    }
    fish = outcome;
  }

  // 2. La fila del catálogo, dejando constancia
  const removed = await ctx.db.rpc('remove_voice', {
    p_voice: id,
    p_removed_by: ctx.caller.id,
    p_fish_deleted: fish === 'deleted',
  });
  if (removed.error || removed.data !== 'ok') {
    const why = removed.error?.message ?? (removed.data === 'is_default' ? 'es la voz por defecto' : 'ya no estaba');
    return fail(
      502,
      'catalog_failed',
      `${fish === 'deleted' ? 'El modelo se borró en Fish Audio, pero la voz sigue en el catálogo' : 'La voz no se pudo quitar del catálogo'}: ${why}.`
    );
  }

  const notice =
    fish === 'deleted'
      ? null
      : fish === 'not_found'
        ? 'Fish Audio dice que ese modelo no existe (404). Se quitó del catálogo; en Fish Audio no había nada que borrar con esta clave.'
        : fish === 'not_owned'
          ? 'Fish Audio dice que ese modelo no es de la cuenta de esta clave (403). Se quitó solo del catálogo: el modelo sigue en Fish Audio.'
          : 'Se quitó solo del catálogo. El modelo sigue en Fish Audio.';
  return { status: 200, body: { deleted: id, fish, notice } };
}

// ---------- Entrada ----------

export async function handleVoicesApi(
  route: VoicesRoute,
  req: ApiRequest,
  env: Env = process.env,
  doFetch: FetchLike = fetch
): Promise<ApiResult> {
  if (req.method.toUpperCase() !== 'POST') return fail(405, 'method', 'Esta ruta solo admite POST.');
  try {
    const ctx = await identify(req, env);
    if (isResult(ctx)) return ctx;
    return route === 'voices/create' ? await createVoice(ctx, req, env, doFetch) : await deleteVoice(ctx, req, env, doFetch);
  } catch (err) {
    console.error(`[Lalo voces] ${route}`, describe(err));
    return fail(500, 'server_error', 'El servidor tuvo un error inesperado.');
  }
}

/** Adaptador para Vercel y para Express: los dos entregan (req, res) con esta forma. */
export function voicesNodeHandler(route: VoicesRoute) {
  return async (req: NodeLikeRequest, res: NodeLikeResponse): Promise<void> => {
    const result = await handleVoicesApi(route, { method: req.method ?? 'GET', headers: req.headers, body: req.body });
    res.setHeader('Cache-Control', 'no-store');
    res.status(result.status).json(result.body);
  };
}
