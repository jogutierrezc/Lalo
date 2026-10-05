/**
 * src/components/juego/GameWidgetLayer.tsx
 *
 * Lado de OBS de «Alertas de juego». Va montada en el widget y:
 *
 * - Pregunta al servidor de Lalo cada medio minuto por la «foto» de la cuenta de
 *   Riot del streamer, con la clave privada `k` de la URL. El servidor es quien
 *   habla con Riot; aquí nunca llega la clave de Riot ni el PUUID.
 * - Compara la foto con la anterior (utils/gameAlerts.ts) y manda a la placa las
 *   alertas que salgan. La primera foto solo fija el punto de partida.
 * - Guarda la última foto en localStorage para que recargar la fuente no pierda
 *   el punto de partida ni repita una alerta. Cada fuente compara con su propia
 *   memoria, así que varias fuentes abiertas no se pisan ni duplican nada dentro
 *   de una misma fuente. Si el almacenamiento falla, sigue solo con la memoria.
 * - Si la cuenta no está vinculada o el servidor no está configurado, no enseña
 *   nada y pregunta mucho más despacio.
 * - Atiende las pruebas que el panel envía por el bus a las fuentes abiertas en
 *   este mismo navegador. Con demo=1 enseña alertas de ejemplo, sin servidor.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { fetchRiotState } from '../../lib/integrationsApi';
import { readWidgetKey } from '../../lib/widgetCloud';
import type { GameAlertId, GameSettings } from '../../types/game';
import { listenBus } from '../../utils/bus';
import { advanceGame, readGameState, type GameAlert, type GameState } from '../../utils/gameAlerts';
import { GameAlertLayer, type GameAlertLayerHandle } from './GameAlertLayer';

/** El servidor guarda cada foto 45 s: preguntar más a menudo no trae nada nuevo. */
export const GAME_POLL_MS = 30000;
/** Riot pidió esperar. */
const GAME_LIMITED_POLL_MS = 60000;
/** Sin cuenta vinculada o sin configurar: se pregunta de tarde en tarde, por si se vincula. */
export const GAME_IDLE_POLL_MS = 5 * 60000;
export const GAME_STATE_KEY = 'lalo_game_snapshot';
const IDLE = ['not_linked', 'not_configured', 'unknown_key', 'bad_key', 'migration_missing', 'key_invalid'];

function loadState(): GameState | null {
  try {
    return readGameState(localStorage.getItem(GAME_STATE_KEY), Date.now());
  } catch {
    return null;
  }
}

function saveState(state: GameState): void {
  try {
    localStorage.setItem(GAME_STATE_KEY, JSON.stringify(state));
  } catch {
    // Sin almacenamiento (modo privado, cuota): la fuente sigue con lo que tiene en memoria
  }
}

export interface GameWidgetLayerHandle {
  test: (id: GameAlertId) => void;
}

interface GameWidgetLayerProps {
  settings: GameSettings;
  demo: boolean;
  /** La frase de la alerta, con su etiqueta de emoción, para quien la anuncie. */
  onAnnounce: (text: string, alert: GameAlert) => void;
}

export const GameWidgetLayer = forwardRef<GameWidgetLayerHandle, GameWidgetLayerProps>(({ settings, demo, onAnnounce }, ref) => {
  const layer = useRef<GameAlertLayerHandle | null>(null);
  const live = useRef(settings);
  live.current = settings;

  useImperativeHandle(ref, () => ({ test: (id) => layer.current?.test(id) }), []);

  // Pruebas del panel a las fuentes de este navegador
  useEffect(
    () =>
      listenBus((message) => {
        if (message.type === 'GAME_TEST') layer.current?.test(message.alert);
      }),
    []
  );

  // La cuenta de verdad
  useEffect(() => {
    const key = demo ? null : readWidgetKey();
    if (!key) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // La memoria de esta fuente; lo guardado solo sirve de punto de partida al abrirla
    let state = loadState();

    const tick = async () => {
      const next = await fetchRiotState(key);
      if (stopped) return;
      const step = advanceGame(state, next, Date.now(), live.current.streakMin);
      state = step.state;
      if (next.status === 'ok' && state) saveState(state);
      step.alerts.forEach((alert) => layer.current?.push(alert));
      const wait = IDLE.includes(next.status) ? GAME_IDLE_POLL_MS : next.status === 'limited' || next.status === 'busy' ? GAME_LIMITED_POLL_MS : GAME_POLL_MS;
      timer = setTimeout(tick, wait);
    };
    tick();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [demo]);

  return <GameAlertLayer ref={layer} settings={settings} demo={demo} onAnnounce={onAnnounce} />;
});

GameWidgetLayer.displayName = 'GameWidgetLayer';
