/**
 * widgetUrl.ts
 *
 * Construye la URL del widget para OBS. Lleva canal, voz, sonido, apariencia y
 * reglas, porque el navegador de OBS no comparte almacenamiento con el panel.
 * El sticker y las listas de bloqueo van al final, codificados.
 *
 * Cada fuente lleva lo que usa:
 *   - «Voz del chat» y «Todo en uno»: todo (voz, sonido, apariencia y reglas).
 *   - «Alertas»: la voz y la apariencia, porque la alerta sale en la misma tarjeta.
 *   - Ruleta, raid, batallas, metas y escenas: solo la voz con la que hablan.
 *   - Alertas de Ko-fi: solo la voz, que lee el mensaje del apoyo si el streamer quiere.
 *   - Mascota: solo la voz, la de reserva cuando la mascota no tiene una propia.
 *   - Torneo: solo la voz (motor y volumen); el narrador trae la suya en sus ajustes.
 *   - Chat, recompensas, «Ahora suena» y las capas fijas de Ko-fi: nada de la voz, no hablan.
 */

import { DEFAULT_SETTINGS, type TTSSettings } from '../types/settings';
import { encodeSticker } from './appearance';
import { encodeBlockLists, moderationToQuery } from './moderation';
import { preSoundToQuery } from './preSound';

/** Con qué voz habla la fuente y a qué volumen. */
function voiceQuery(settings: TTSSettings): Record<string, string> {
  return {
    voice: settings.referenceId,
    model: settings.model || 's2.1-pro-free',
    vol: String(settings.volume),
    speed: String(settings.speed),
  };
}

/** Cómo se ve la tarjeta: estilo, sitio, color, tamaño y energía. */
function appearanceQuery(settings: TTSSettings): Record<string, string> {
  return {
    style: settings.alertStyle,
    pos: settings.position,
    accent: settings.accent.startsWith('#') ? settings.accent.slice(1) : settings.accent,
    scale: String(settings.scale),
    energy: settings.energy,
  };
}

/** Todo lo que la voz del chat necesita: voz, anuncio, sonido previo, apariencia y reglas. */
function fullTtsQuery(settings: TTSSettings): Record<string, string> {
  const template = (settings.announceTemplate || '').trim() || DEFAULT_SETTINGS.announceTemplate;
  return {
    ...voiceQuery(settings),
    announce: settings.announceSender !== false ? '1' : '0',
    tpl: template,
    ...appearanceQuery(settings),
    ...preSoundToQuery(settings.preSound),
    ...moderationToQuery(settings),
  };
}

/** Sticker y listas de bloqueo, codificados. Van al final de la URL. */
function encodedTail(settings: TTSSettings, withLists: boolean): string {
  const tail = new URLSearchParams();
  if (settings.alertStyle === 'sticker' && settings.stickerSvg) tail.set('sticker', encodeSticker(settings.stickerSvg));
  const lists = withLists ? encodeBlockLists(settings) : '';
  if (lists) tail.set('block', lists);
  const text = tail.toString();
  return text ? `&${text}` : '';
}

export function buildWidgetUrl(origin: string, settings: TTSSettings): string {
  const query = new URLSearchParams({ channel: settings.channel, ...fullTtsQuery(settings) });
  return `${origin}/#widget?${query.toString()}${encodedTail(settings, true)}`;
}

export type WidgetAppType =
  | 'tts'
  | 'alerts'
  | 'roulette'
  | 'goals'
  | 'polls'
  | 'chat'
  | 'raid'
  | 'rewards'
  | 'scene'
  | 'music'
  | 'kofi'
  | 'kofigoal'
  | 'kofirecent'
  | 'pets'
  | 'game'
  | 'tournament'
  | 'all';

/** Fuentes que hablan con la voz del chat pero no leen el chat. */
const VOICE_ONLY_APPS: WidgetAppType[] = ['roulette', 'raid', 'polls', 'goals', 'scene', 'kofi', 'pets', 'game', 'tournament'];

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
    const extra = new URLSearchParams(extraParams || {}).toString();
    return `${buildWidgetUrl(origin, { ...ttsSettings, channel: activeChannel })}${extra ? `&${extra}` : ''}`;
  }

  const query = new URLSearchParams({ app, channel: activeChannel });
  let tail = '';

  if (ttsSettings) {
    let tts: Record<string, string> = {};
    if (app === 'all') {
      tts = fullTtsQuery(ttsSettings);
      tail = encodedTail(ttsSettings, true);
    } else if (app === 'alerts') {
      tts = { ...voiceQuery(ttsSettings), ...appearanceQuery(ttsSettings), ...preSoundToQuery(ttsSettings.preSound) };
      tail = encodedTail(ttsSettings, false);
    } else if (VOICE_ONLY_APPS.includes(app)) {
      tts = voiceQuery(ttsSettings);
    }
    Object.entries(tts).forEach(([key, value]) => query.set(key, value));
  }

  // Los ajustes de cada capa (y la clave de la cuenta) van detrás: son largos
  Object.entries(extraParams || {}).forEach(([key, value]) => query.set(key, value));

  return `${origin}/#widget?${query.toString()}${tail}`;
}
