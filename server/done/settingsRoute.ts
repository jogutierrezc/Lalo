/**
 * server/done/settingsRoute.ts
 *
 *   GET /api/done/settings   ajustes del creador + lo que el panel necesita (clave de lectura del overlay, estado del bot)
 *   PUT /api/done/settings   guarda un cambio parcial; todo pasa por validateDoneSettings
 *
 * La clave de lectura del overlay (readKey.ts) se deriva en el servidor de la widget_key y es lo único que sale:
 * la widget_key no se devuelve nunca.
 */

import { fail, type IntegrationRequest, type IntegrationResult } from '../integrations/http.js';
import type { Env } from '../integrations/store.js';
import { doneCommandWords, validateDoneSettings } from '../../src/lib/doneSettings.js';
import { visibleTo } from '../lux/modelLibrary.js';
import { riotModels } from '../lux/handlers.js';
import { settingsFromRow as luxSettingsFromRow } from '../lux/settings.js';
import { LUX_CHAT_WORD_DEFAULT } from '../lux/chatCommands.js';
import { RESERVED_BOT_WORDS } from '../chat/sharedRules.js';
import { botOnline, bodyOf, clock, doneFailure, type DoneDeps } from './core.js';
import { doneRowFromSettings } from './settings.js';
import { deriveReadKey } from './readKey.js';
import { doneDisabled, isSession, sessionOf } from './session.js';

export async function settingsRoute(req: IntegrationRequest, env: Env, deps: DoneDeps): Promise<IntegrationResult> {
  const method = req.method.toUpperCase();
  if (method !== 'GET' && method !== 'PUT') return fail(405, 'method', 'Esta ruta admite GET y PUT.');
  try {
    const session = await sessionOf(req, env, deps);
    if (!isSession(session)) return session;
    const { stores, actor } = session;
    const { profile } = actor;

    if (method === 'GET') {
      const widgetKey = await stores.done.widgetKeyOf(profile.id);
      return {
        status: 200,
        body: {
          settings: actor.settings,
          allowed: actor.allowed,
          // Solo la clave derivada de solo lectura; la widget_key no sale nunca
          readKey: widgetKey ? deriveReadKey(profile.id, widgetKey) : null,
          commandWords: doneCommandWords(actor.settings.commandWord, actor.settings.keepAlias),
          botOnline: await botOnline(stores.lux, profile.id, clock(deps)),
          // Qué bots pueden escribir con la cuenta del creador (writeAs 'creator'); el de Python escribe con la cuenta de su token
          writeAs: { creator: { cloudBot: true, pythonBot: false }, bot: { cloudBot: true, pythonBot: true } },
        },
      };
    }

    if (!actor.allowed) return doneDisabled();
    const raw = bodyOf(req.body);
    // La palabra de Lux y los comandos de la plataforma no se pueden tomar
    const luxWord = luxSettingsFromRow(await stores.lux.settingsRow(profile.id)).chatWord;
    const check = validateDoneSettings(raw, actor.settings, { extraReserved: [LUX_CHAT_WORD_DEFAULT, luxWord, ...RESERVED_BOT_WORDS] });
    if (!check.ok) return fail(400, 'bad_settings', check.message, { field: check.field });
    const next = check.value;

    // El modelo 3D tiene que ser de los que esta cuenta ve (biblioteca compartida con Lux)
    if (next.modelId !== actor.settings.modelId && next.modelId) {
      const characters = stores.lux.characters ? await stores.lux.characters() : [];
      const rows = stores.lux.libraryModels ? await stores.lux.libraryModels() : [];
      if (!visibleTo([...riotModels(characters), ...rows], profile.id).some((item) => item.id === next.modelId)) {
        return fail(400, 'bad_settings', 'El modelo elegido no está disponible para tu cuenta.', { field: 'modelId' });
      }
    }

    await stores.done.saveSettingsRow(doneRowFromSettings(profile.id, next));
    return { status: 200, body: { settings: next, commandWords: doneCommandWords(next.commandWord, next.keepAlias) } };
  } catch (err) {
    return doneFailure(err, 'done/settings');
  }
}
