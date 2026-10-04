/**
 * src/components/integraciones/widgetSettings.ts
 *
 * Ajustes de «Ahora suena» y de Ko-fi para una fuente de OBS. Llegan enteros en
 * `ms` y `kf`, que valen mientras la cuenta en la nube no haya entregado los
 * suyos. `design` permite cambiar el diseño a mano en la dirección, para ver
 * cada uno sin tocar nada (con demo=1 no hace falta cuenta ni servidor).
 */

import { cloudDelivered } from '../../lib/widgetCloud';
import { KOFI_DESIGNS, decodeKofiSettings, loadKofiSettings, type KofiDesign, type KofiSettings } from '../../types/kofi';
import { MUSIC_DESIGNS, decodeMusicSettings, loadMusicSettings, type MusicDesign, type MusicSettings } from '../../types/music';

type Get = (key: string) => string | null;

/** El diseño de la dirección manda sobre el guardado, si existe. */
export function withMusicDesign(settings: MusicSettings, get: Get): MusicSettings {
  const design = (get('design') || '').toLowerCase();
  return MUSIC_DESIGNS.some((item) => item.id === design) ? { ...settings, design: design as MusicDesign } : settings;
}

export function musicSettingsForWidget(get: Get, base: MusicSettings = loadMusicSettings(), delivered: boolean = cloudDelivered('music')): MusicSettings {
  return withMusicDesign((delivered ? null : decodeMusicSettings(get('ms'))) || base, get);
}

/** `design` es el diseño de la alerta en app=kofi, y la disposición en app=kofigoal y app=kofirecent. */
export function withKofiDesign(settings: KofiSettings, get: Get, app: string): KofiSettings {
  const design = (get('design') || '').toLowerCase();
  if (!design) return settings;
  if (app === 'kofigoal') return design === 'barra' || design === 'deposito' ? { ...settings, goal: { ...settings.goal, layout: design } } : settings;
  if (app === 'kofirecent') return design === 'lista' || design === 'cinta' ? { ...settings, recent: { ...settings.recent, layout: design } } : settings;
  return KOFI_DESIGNS.some((item) => item.id === design) ? { ...settings, design: design as KofiDesign } : settings;
}

export function kofiSettingsForWidget(get: Get, app: string, base: KofiSettings = loadKofiSettings(), delivered: boolean = cloudDelivered('kofi')): KofiSettings {
  return withKofiDesign((delivered ? null : decodeKofiSettings(get('kf'))) || base, get, app);
}
