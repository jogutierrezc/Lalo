/**
 * server/done/speechRoute.ts
 *
 *   GET /api/done/speech?k=<clave de lectura>&after=<id>   cola de frases para el overlay de OBS
 *   GET /api/done/model?k=<clave de lectura>[&m=<id>]      el GLB del personaje de la cuenta
 *
 * Las dos autorizan SOLO con la clave de lectura (readKey.ts), que sirve para leer y nada más: el enlace de la fuente
 * de OBS puede verse en pantalla sin regalar la clave que escribe en el chat.
 *
 * Sin `after`, devuelve la última frase vista (`last`) y ninguna frase: así el overlay no repite lo viejo al abrirse.
 */

import { fail, type IntegrationRequest, type IntegrationResult } from '../integrations/http.js';
import type { Env } from '../integrations/store.js';
import { fetchPrivateModel } from '../lux/mascotaModel.js';
import { riotModels } from '../lux/handlers.js';
import { visibleTo } from '../lux/modelLibrary.js';
import { doneCommandWords } from '../../src/lib/doneSettings.js';
import { doneFailure, loadActor, notConfigured, openStores, overlayCharacter, effectiveOf, characterOf, type Actor, type DoneDeps, type Stores } from './core.js';
import { profileIdOfReadKey, verifyReadKey } from './readKey.js';

const SPEECH_PAGE = 20;

/**
 * Cuenta dueña de la clave, o null. Vale la clave de lectura (`dr.…`) y también la clave de OBS (`k`): la fuente
 * única de OBS lleva `k` en su enlace, así que el overlay lee con ella. Para escribir en el chat (chatRoute) la
 * clave de lectura sigue siendo de solo lectura.
 */
export async function actorForReadKey(stores: Stores, key: string): Promise<Actor | null> {
  const id = profileIdOfReadKey(key);
  if (id) {
    const widgetKey = await stores.done.widgetKeyOf(id);
    if (!widgetKey || !verifyReadKey(key, id, widgetKey)) return null;
    const profile = await stores.lux.profile(id);
    return profile ? loadActor(stores, profile) : null;
  }
  if (!key || key.length > 128 || !stores.lux.profileByWidgetKey) return null;
  const profile = await stores.lux.profileByWidgetKey(key);
  return profile ? loadActor(stores, profile) : null;
}

/** Modelo de la biblioteca (de Riot, compartido, aprobado o propio, con archivo) que esta cuenta puede ver, o null. */
async function visibleLibraryModel(stores: Stores, profileId: string, id: string): Promise<{ id: string; modelKey: string } | null> {
  const characters = stores.lux.characters ? await stores.lux.characters() : [];
  const rows = stores.lux.libraryModels ? await stores.lux.libraryModels() : [];
  const found = visibleTo([...riotModels(characters), ...rows], profileId).find((model) => model.id === id);
  return found && found.modelKey ? { id: found.id, modelKey: found.modelKey } : null;
}

const badKey = (): IntegrationResult => fail(401, 'bad_read_key', 'El enlace de la fuente de OBS no es válido.');

export async function speechRoute(req: IntegrationRequest, env: Env, deps: DoneDeps): Promise<IntegrationResult> {
  if (req.method.toUpperCase() !== 'GET') return fail(405, 'method', 'Esta ruta solo admite GET.');
  const stores = openStores(env, deps);
  if (!stores) return notConfigured();
  try {
    const actor = await actorForReadKey(stores, (req.query.k ?? '').trim());
    if (!actor) return badKey();
    const { settings, profile } = actor;

    const afterRaw = req.query.after;
    const baseline = afterRaw === undefined || afterRaw === '';
    const after = baseline ? 0 : Number(afterRaw);
    if (!baseline && (!Number.isInteger(after) || after < 0)) return fail(400, 'bad_after', 'El parámetro after no es válido.');

    const live = actor.allowed && settings.enabled;
    const items = baseline || !live ? [] : await stores.done.speechSince(profile.id, after, SPEECH_PAGE);
    const last = items.length > 0 ? items[items.length - 1].id : baseline ? String(await stores.done.latestSpeechId(profile.id)) : String(after);
    const { view } = await overlayCharacter(stores.lux, actor);
    const tts = stores.lux.ttsVoice ? await stores.lux.ttsVoice(profile.id) : { referenceId: null, engine: null };

    return {
      status: 200,
      body: {
        items,
        last,
        enabled: live,
        settings: {
          obsSize: settings.obsSize,
          position: settings.position,
          voiceVolume: settings.voiceVolume,
          textStyle: settings.textStyle,
          showText: settings.showText,
          typingCps: settings.typingCps,
        },
        tts,
        character: view,
        command: { words: doneCommandWords(settings.commandWord, settings.keepAlias) },
      },
    };
  } catch (err) {
    return doneFailure(err, 'done/speech');
  }
}

/** El GLB del personaje: solo el modelo efectivo de esta cuenta, desde el bucket privado. Nunca una URL ni una clave. */
export async function modelRoute(req: IntegrationRequest, env: Env, deps: DoneDeps): Promise<IntegrationResult> {
  if (req.method.toUpperCase() !== 'GET') return fail(405, 'method', 'Esta ruta solo admite GET.');
  const stores = openStores(env, deps);
  if (!stores) return notConfigured();
  try {
    const actor = await actorForReadKey(stores, (req.query.k ?? '').trim());
    if (!actor) return badKey();
    if (!actor.allowed) return fail(403, 'done_disabled', 'Done no está activado para tu cuenta.');
    const asked = req.query.m;
    // Con ?m=<id> se sirve cualquier modelo de la biblioteca que esta cuenta puede ver (compartido, aprobado o suyo):
    // la galería y la vista previa piden varios. Sin ?m=, o si ese id no es visible, vale el modelo efectivo.
    let target: { id: string; modelKey: string } | null = asked ? await visibleLibraryModel(stores, actor.profile.id, asked) : null;
    if (!target) {
      const character = await characterOf(stores.lux, actor);
      const effective = await effectiveOf(stores.lux, actor, character);
      // Si piden otro id que no es visible, 404: así la caché del navegador no mezcla modelos
      if (!effective || (asked !== undefined && asked !== effective.id)) return fail(404, 'no_model', 'Esta cuenta no tiene un modelo 3D para su personaje.');
      target = effective;
    }
    const read = await (deps.modelBytes ?? fetchPrivateModel)(env, target.modelKey);
    if (!read.ok) {
      if (read.reason === 'not_configured') return fail(503, 'models_bucket', 'Falta el bucket privado de modelos en el servidor.');
      if (read.reason === 'missing') return fail(404, 'model_missing', 'El archivo del modelo no está en el almacenamiento.');
      return fail(502, 'model_read', 'No se pudo leer el modelo del almacenamiento.');
    }
    return { status: 200, body: {}, raw: { contentType: 'model/gltf-binary', body: read.bytes, cacheControl: 'private, max-age=86400' } };
  } catch (err) {
    return doneFailure(err, 'done/model');
  }
}
