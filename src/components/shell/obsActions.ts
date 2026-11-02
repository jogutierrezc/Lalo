/**
 * src/components/shell/obsActions.ts
 *
 * Acciones de OBS compartidas por el cascarón (barra superior) y por la barra
 * de cada ventana: armar la URL de una fuente, copiarla y «Actualizar OBS»
 * (envía los ajustes a las fuentes ya pegadas). Antes vivían dentro de SuiteNav.
 */

import { useEffect, useRef, useState } from 'react';
import { buildSuiteWidgetUrl, type WidgetAppType } from '../../utils/widgetUrl';
import { loadSettings } from '../../types/settings';
import { encodeChatSettings, loadChatSettings } from '../../types/chat';
import { encodeRaidSettings, loadRaidSettings } from '../../types/raid';
import { encodeRewardsSettings, loadRewardsSettings } from '../../types/rewards';
import { encodeRouletteSettings, loadRouletteSettings } from '../../types/roulette';
import { encodeMusicSettings, loadMusicSettings } from '../../types/music';
import { encodeKofiSettings, loadKofiSettings } from '../../types/kofi';
import { encodePetsSettings, loadPetsSettings } from '../../types/pets';
import { encodeGameSettings, loadGameSettings } from '../../types/game';
import { encodeTournamentSettings, loadTournamentSettings } from '../../types/tournament';
import { tournamentStore } from '../../lib/tournamentStore';
import { listenBus, postBus } from '../../utils/bus';
import { playAlertAudio } from '../../utils/alertsAudio';
import { useCloudSession } from '../../hooks/useCloudSession';
import { onCloudSyncMessage, pushAllNow } from '../../lib/cloudConfig';
import { syncTargetFor } from '../../lib/tools';

const WIDGET_STALE_MS = 12000;

/** El widget solo responde por el bus si está abierto en este mismo navegador. */
export function useWidgetOpenHere(): boolean {
  const [seenAt, setSeenAt] = useState(0);
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    const stop = listenBus((message) => {
      if (message.type === 'STATE') setSeenAt(Date.now());
    });
    postBus({ type: 'STATE_REQUEST' });
    const tick = setInterval(() => setClock(Date.now()), 4000);
    return () => {
      stop();
      clearInterval(tick);
    };
  }, []);

  return seenAt > 0 && clock - seenAt < WIDGET_STALE_MS;
}

/**
 * Los ajustes del chat, del saludo de raid, de las recompensas y de la ruleta viajan en la URL: OBS no comparte
 * almacenamiento con el panel. Con cuenta en la nube va además la clave: la fuente usa lo de la cuenta y deja
 * lo de la URL de reserva, por si la nube no responde.
 */
export function layerParamsForWidget(mode: WidgetAppType): Record<string, string> {
  if (mode === 'chat') return { cs: encodeChatSettings(loadChatSettings()) };
  if (mode === 'rewards') return { rw: encodeRewardsSettings(loadRewardsSettings()) };
  if (mode === 'raid') return { rs: encodeRaidSettings(loadRaidSettings()) };
  if (mode === 'roulette') return { rl: encodeRouletteSettings(loadRouletteSettings()) };
  if (mode === 'music') return { ms: encodeMusicSettings(loadMusicSettings()) };
  if (mode === 'pets') return { ps: encodePetsSettings(loadPetsSettings()) };
  if (mode === 'game') return { gs: encodeGameSettings(loadGameSettings()) };
  if (mode === 'tournament') return { ts: encodeTournamentSettings(loadTournamentSettings(), tournamentStore().read()) };
  if (mode === 'kofi' || mode === 'kofigoal' || mode === 'kofirecent') return { kf: encodeKofiSettings(loadKofiSettings()) };
  if (mode === 'all') {
    return {
      cs: encodeChatSettings(loadChatSettings()),
      rs: encodeRaidSettings(loadRaidSettings()),
      rw: encodeRewardsSettings(loadRewardsSettings()),
      rl: encodeRouletteSettings(loadRouletteSettings()),
      ms: encodeMusicSettings(loadMusicSettings()),
      kf: encodeKofiSettings(loadKofiSettings()),
      ps: encodePetsSettings(loadPetsSettings()),
      gs: encodeGameSettings(loadGameSettings()),
      ts: encodeTournamentSettings(loadTournamentSettings(), tournamentStore().read()),
    };
  }
  return {};
}

/** Aviso de la sincronización con la nube (null = todo guardado). */
export function useCloudSyncMessage(): string | null {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => onCloudSyncMessage(setMessage), []);
  return message;
}

export function useObsActions(channel: string | undefined, toolId?: string | null) {
  const cloud = useCloudSession();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [notice, setNotice] = useState<{ appType: string; url: string } | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    },
    []
  );

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  // Con cuenta en la nube, las URL de OBS llevan la clave privada del streamer
  const widgetKeyParam = cloud.profile?.status === 'active' ? { k: cloud.profile.widget_key } : undefined;
  const extraFor = (mode: WidgetAppType): Record<string, string> => ({ ...widgetKeyParam, ...layerParamsForWidget(mode) });

  const getWidgetUrl = (mode: WidgetAppType) => {
    const ttsSettings = loadSettings();
    return buildSuiteWidgetUrl(baseUrl, mode, channel || ttsSettings.channel, ttsSettings, extraFor(mode));
  };

  const copy = async (mode: WidgetAppType): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(getWidgetUrl(mode));
      setCopiedKey(mode);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedKey(null), 2000);
      return true;
    } catch {
      setCopiedKey(null);
      return false;
    }
  };

  // Envía los ajustes actuales a las fuentes de OBS y copia la URL vigente
  const triggerObsSync = async () => {
    if (syncState === 'busy') return;
    setSyncState('busy');

    const ttsSettings = loadSettings();
    const targetApp: WidgetAppType = syncTargetFor(toolId);
    const activeUrl = buildSuiteWidgetUrl(baseUrl, targetApp, channel || ttsSettings.channel, ttsSettings, extraFor(targetApp));

    postBus({ type: 'FORCE_RELOAD' });
    postBus({
      type: 'SETTINGS_UPDATE',
      settings: { ...ttsSettings, channel: channel || ttsSettings.channel },
    });

    // Con cuenta en la nube: se suben los ajustes ahora y las fuentes de OBS, en cualquier equipo,
    // los descargan en su siguiente consulta (unos diez segundos)
    try {
      await pushAllNow();
    } catch {
      // El aviso de sincronización del panel ya explica el fallo
    }

    // Señal HTTP de recarga para fuentes de navegador de OBS conectadas al mismo servidor
    try {
      await fetch('/api/obs/reload', { method: 'POST' });
    } catch {
      // Sin servidor o fuera de línea, el bus y la nube ya avisaron a las fuentes
    }

    try {
      await navigator.clipboard.writeText(activeUrl);
    } catch {
      // Portapapeles no disponible
    }

    setSyncState('done');
    playAlertAudio('synth-bell', 0.45);
    setNotice({ appType: targetApp.toUpperCase(), url: activeUrl });
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => setSyncState('idle'), 2800);
  };

  return { cloud, copiedKey, copy, getWidgetUrl, syncState, triggerObsSync, notice, clearNotice: () => setNotice(null) };
}
