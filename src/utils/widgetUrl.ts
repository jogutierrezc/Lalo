/**
 * widgetUrl.ts
 *
 * Construye la URL del widget para OBS. Lleva canal, voz, sonido, apariencia y
 * reglas, porque el navegador de OBS no comparte almacenamiento con el panel.
 * El sticker y las listas de bloqueo van en el fragmento (#), que no se envía
 * al servidor.
 */

import type { TTSSettings } from '../types/settings';
import { encodeSticker } from './appearance';
import { encodeBlockLists, moderationToQuery } from './moderation';

export function buildWidgetUrl(origin: string, settings: TTSSettings): string {
  const query = new URLSearchParams({
    channel: settings.channel,
    voice: settings.referenceId,
    model: settings.model || 's2.1-pro-free',
    announce: settings.announceSender !== false ? '1' : '0',
    vol: String(settings.volume),
    speed: String(settings.speed),
    style: settings.alertStyle,
    pos: settings.position,
    accent: settings.accent.startsWith('#') ? settings.accent.slice(1) : settings.accent,
    scale: String(settings.scale),
    energy: settings.energy,
    ...moderationToQuery(settings),
  });

  const fragment = new URLSearchParams();
  if (settings.alertStyle === 'sticker' && settings.stickerSvg) fragment.set('sticker', encodeSticker(settings.stickerSvg));
  const lists = encodeBlockLists(settings);
  if (lists) fragment.set('block', lists);
  const hash = fragment.toString();

  return `${origin}/#widget?${query.toString()}${hash ? `&${hash}` : ''}`;
}

export type WidgetAppType = 'tts' | 'alerts' | 'roulette' | 'goals' | 'polls' | 'all';

/**
 * Construye la URL completa y parametrizada para cualquier herramienta de Lalo Stream Suite en OBS Studio.
 */
export function buildSuiteWidgetUrl(
  origin: string,
  app: WidgetAppType,
  channel: string,
  ttsSettings?: TTSSettings,
  extraParams?: Record<string, string>
): string {
  const activeChannel = (channel || ttsSettings?.channel || 'laloplay_').trim();

  if (app === 'tts' && ttsSettings) {
    return buildWidgetUrl(origin, { ...ttsSettings, channel: activeChannel });
  }

  const query = new URLSearchParams({
    app,
    channel: activeChannel,
    ...(extraParams || {}),
  });

  if (app === 'all' && ttsSettings) {
    query.set('voice', ttsSettings.referenceId);
    query.set('model', ttsSettings.model || 's2.1-pro-free');
    query.set('vol', String(ttsSettings.volume));
    query.set('speed', String(ttsSettings.speed));
    query.set('style', ttsSettings.alertStyle);
    query.set('pos', ttsSettings.position);
    query.set('accent', ttsSettings.accent.startsWith('#') ? ttsSettings.accent.slice(1) : ttsSettings.accent);
  }

  return `${origin}/#widget?${query.toString()}`;
}
