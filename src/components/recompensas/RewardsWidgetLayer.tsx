/**
 * src/components/recompensas/RewardsWidgetLayer.tsx
 *
 * La capa «Recompensas» tal como va en la fuente de navegador de OBS. Lee sus
 * ajustes sola en cada evento: de la nube (el widget ya los dejó en
 * localStorage con la clave `k`) o, sin cuenta, del parámetro `rw` de la URL.
 *
 * Parámetros para comprobarla a la vista, con demo=1:
 *   plate=cabina|cinta|boleto|comic|cristal|custom   una placa de muestra fija
 *   video=random|center|top-left|...|fullscreen      un recuadro de vídeo de muestra
 * Ejemplo: #widget?app=rewards&demo=1&plate=cinta
 */

import { forwardRef, useMemo } from 'react';
import {
  PLATE_STYLES,
  PlateStyleId,
  REWARD_GRID_POSITIONS,
  RewardVideoPosition,
  RewardsSettings,
  decodeRewardsSettings,
  loadRewardsSettings,
} from '../../types/rewards';
import { RewardsLayer, RewardsLayerHandle } from './RewardsLayer';
import { cloudDelivered } from '../../lib/widgetCloud';
import '../../styles/recompensas.css';

function urlParam(key: string): string | null {
  const fromSearch = new URLSearchParams(window.location.search).get(key);
  if (fromSearch) return fromSearch.trim();
  const hash = window.location.hash;
  const at = hash.indexOf('?');
  return at === -1 ? null : (new URLSearchParams(hash.slice(at)).get(key) || '').trim() || null;
}

/**
 * Ajustes de las recompensas para esta fuente. Si la cuenta en la nube ya entregó los suyos,
 * mandan esos; si no (sin cuenta, o la nube no respondió), los de la URL (`rw`).
 */
export function rewardsSettingsForWidget(): RewardsSettings {
  return (cloudDelivered('rewards') ? null : decodeRewardsSettings(urlParam('rw'))) || loadRewardsSettings();
}

const VIDEO_POSITIONS: readonly string[] = [...REWARD_GRID_POSITIONS, 'fullscreen', 'random'];

export const RewardsWidgetLayer = forwardRef<RewardsLayerHandle>((_props, ref) => {
  const demo = useMemo(() => {
    if (urlParam('demo') !== '1') return { plate: null, video: null };
    const plate = (urlParam('plate') || '').toLowerCase();
    const video = (urlParam('video') || '').toLowerCase();
    const videoPosition = VIDEO_POSITIONS.includes(video) ? (video as RewardVideoPosition) : null;
    const plateStyle = PLATE_STYLES.some((style) => style.id === plate) ? (plate as PlateStyleId) : null;
    // Con demo=1 y nada más, sale la placa de partida del streamer
    return { plate: plateStyle ?? (videoPosition ? null : rewardsSettingsForWidget().defaultPlateStyle), video: videoPosition };
  }, []);

  return <RewardsLayer ref={ref} getSettings={rewardsSettingsForWidget} bus demoPlate={demo.plate} demoVideo={demo.video} />;
});

RewardsWidgetLayer.displayName = 'RewardsWidgetLayer';
