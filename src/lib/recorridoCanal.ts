/**
 * src/lib/recorridoCanal.ts
 *
 * Lo que guarda el paso «Tu canal» de la bienvenida. Escribe con las mismas
 * funciones de guardado que usa cada pantalla, así llega también a la nube.
 * El canal no se pregunta: es el de Twitch, y se pone en todos los módulos.
 */

import { loadSettings, saveSettings } from '../types/settings';
import { loadAlertsSettings, saveAlertsSettings, type StreamAlertsSettings } from '../types/alerts';
import { loadGoalsSettings, saveGoalsSettings } from '../types/goals';
import { loadRouletteSettings, saveRouletteSettings } from '../types/roulette';
import { loadPollSettings, savePollSettings } from '../types/polls';
import { loadRewardsSettings, saveRewardsSettings } from '../types/rewards';
import { loadTwitchIOSettings, saveTwitchIOSettings } from '../types/twitchio';
import type { AlertStyle } from '../utils/appearance';
import { postBus } from '../utils/bus';

export interface EleccionCanal {
  /** Id de la voz que lee el chat. */
  voz: string;
  /** Cómo se ven los mensajes. */
  estilo: AlertStyle;
  /** Leer los mensajes que empiecen por !s. */
  comando: boolean;
  /** Avisar de suscripciones, bits y raids. */
  avisos: boolean;
}

/** Canal de Twitch tal como lo usan los módulos: en minúsculas y sin espacios. */
export const limpiarCanal = (login: string | null | undefined) => (login ?? '').trim().toLowerCase();

function conAvisos(alerts: StreamAlertsSettings, activos: boolean): StreamAlertsSettings {
  return {
    ...alerts,
    events: {
      ...alerts.events,
      sub: { ...alerts.events.sub, enabled: activos },
      bits: { ...alerts.events.bits, enabled: activos },
      raid: { ...alerts.events.raid, enabled: activos },
    },
  };
}

/**
 * Pone el canal en todos los módulos que lo guardan. Con `eleccion` guarda
 * además la voz, el estilo y los dos interruptores; sin ella («Lo configuro
 * después») solo cambia el canal y deja el resto como estaba.
 */
export function guardarCanal(login: string, eleccion?: EleccionCanal): void {
  const channel = limpiarCanal(login);
  if (!channel) return;

  const tts = {
    ...loadSettings(),
    channel,
    ...(eleccion ? { referenceId: eleccion.voz, alertStyle: eleccion.estilo, commandEnabled: eleccion.comando } : {}),
  };
  saveSettings(tts);
  // Las capas abiertas en este navegador se enteran al momento
  postBus({ type: 'SETTINGS_UPDATE', settings: tts });

  const alerts = { ...loadAlertsSettings(), channel };
  saveAlertsSettings(eleccion ? conAvisos(alerts, eleccion.avisos) : alerts);

  saveGoalsSettings({ ...loadGoalsSettings(), channel });
  saveRouletteSettings({ ...loadRouletteSettings(), channel });
  savePollSettings({ ...loadPollSettings(), channel });
  saveRewardsSettings({ ...loadRewardsSettings(), channel });
  saveTwitchIOSettings({ ...loadTwitchIOSettings(), channel });
}

/** ¿Están encendidos los avisos de seguidores, suscripciones, bits y raids? */
export function alertasActivas(): boolean {
  const { events } = loadAlertsSettings();
  return events.follow.enabled && events.sub.enabled && events.bits.enabled && events.raid.enabled;
}

/** Enciende los cuatro avisos sin tocar nada más de las alertas. */
export function activarAlertas(): void {
  const alerts = conAvisos(loadAlertsSettings(), true);
  saveAlertsSettings({ ...alerts, events: { ...alerts.events, follow: { ...alerts.events.follow, enabled: true } } });
}
