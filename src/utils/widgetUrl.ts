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
    accent: settings.accent.slice(1),
    scale: String(settings.scale),
    energy: settings.energy,
    ...moderationToQuery(settings),
  });

  const fragment = new URLSearchParams();
  if (settings.alertStyle === 'sticker' && settings.stickerSvg) fragment.set('sticker', encodeSticker(settings.stickerSvg));
  const lists = encodeBlockLists(settings);
  if (lists) fragment.set('block', lists);
  const hash = fragment.toString();

  return `${origin}/widget?${query.toString()}${hash ? `#?${hash}` : ''}`;
}
