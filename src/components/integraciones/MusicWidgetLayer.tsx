/**
 * src/components/integraciones/MusicWidgetLayer.tsx
 *
 * Lado de OBS de «Ahora suena». Va montada en el widget y:
 *
 * - Pregunta al servidor de Lalo cada cinco segundos qué suena, con la clave
 *   privada `k` de la URL. El servidor es quien habla con Spotify; aquí nunca
 *   llega un permiso. Entre preguntas la barra avanza por cálculo local.
 * - Un cambio de canción hace la transición del diseño. Un anuncio o «no suena
 *   nada» retiran la capa. Un archivo local sale sin portada.
 * - Si la cuenta no está conectada o el servidor no está configurado, no enseña
 *   nada y pregunta mucho más despacio.
 * - Atiende las pruebas que el panel envía por el bus a las fuentes abiertas en
 *   este mismo navegador, y los comandos del chat del streamer y sus moderadores.
 * - Con demo=1 enseña canciones de ejemplo (inventadas), sin servidor ni cuenta.
 */

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { fetchNowPlaying } from '../../lib/integrationsApi';
import { readWidgetKey } from '../../lib/widgetCloud';
import { parseMusicCommand, type MusicSettings } from '../../types/music';
import { listenBus } from '../../utils/bus';
import type { UserRole } from '../../utils/moderation';
import { SAMPLE_TRACKS, inputsFromReading } from '../../utils/musicRules';
import { MusicOverlay, type MusicOverlayHandle } from './MusicOverlay';

export const MUSIC_POLL_MS = 5000;
/** Sin cuenta conectada o sin configurar: se pregunta de tarde en tarde, por si se conecta. */
export const MUSIC_IDLE_POLL_MS = 60000;
/** Lecturas fallidas seguidas antes de retirar la capa. Un fallo suelto no la quita. */
const MAX_ERRORS = 3;
const DEMO_SONG_MS = 12000;

export interface MusicWidgetLayerHandle {
  /** Mensaje del streamer o de un moderador. true si era un comando de esta capa. */
  command: (message: string, sender: { name: string; role: UserRole }) => boolean;
}

export const MusicWidgetLayer = forwardRef<MusicWidgetLayerHandle, { settings: MusicSettings; demo: boolean }>(({ settings, demo }, ref) => {
  const overlay = useRef<MusicOverlayHandle | null>(null);
  const live = useRef(settings);
  live.current = settings;

  // En demo la capa se queda en pantalla, para poder colocarla en OBS
  const shown = useMemo<MusicSettings>(() => (demo ? { ...settings, show: 'siempre', pause: 'atenuar' } : settings), [demo, settings]);

  useImperativeHandle(
    ref,
    () => ({
      command: (message, sender) => {
        if (sender.role !== 'broadcaster' && sender.role !== 'mod') return false;
        const action = parseMusicCommand(message, live.current.commands);
        if (!action) return false;
        overlay.current?.input({ type: 'live', action });
        return true;
      },
    }),
    []
  );

  // Pruebas del panel a las fuentes de este navegador
  useEffect(
    () =>
      listenBus((message) => {
        if (message.type !== 'MUSIC_TEST' || !overlay.current) return;
        const layer = overlay.current;
        if (message.action === 'song') {
          const track = SAMPLE_TRACKS[(message.sample ?? 0) % SAMPLE_TRACKS.length];
          layer.input({ type: 'song', trackId: track.id }, track, 0);
        } else if (message.action === 'show' || message.action === 'hide') layer.input({ type: 'live', action: message.action });
        else layer.input({ type: message.action });
      }),
    []
  );

  // Canciones de ejemplo
  useEffect(() => {
    if (!demo) return;
    let index = 0;
    const play = () => {
      const track = SAMPLE_TRACKS[index % 3];
      overlay.current?.input({ type: 'song', trackId: track.id }, track, index === 0 ? 62000 : 0);
      index += 1;
    };
    const first = setTimeout(play, 50);
    const timer = setInterval(play, DEMO_SONG_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [demo]);

  // Lo que suena de verdad
  useEffect(() => {
    const key = demo ? null : readWidgetKey();
    if (!key) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let errors = 0;

    const tick = async () => {
      const now = await fetchNowPlaying(key);
      if (stopped) return;
      const layer = overlay.current;
      let wait = MUSIC_POLL_MS;
      if (layer) {
        const idle = ['not_configured', 'not_connected', 'expired', 'forbidden', 'unknown_key', 'bad_key', 'migration_missing'].includes(now.status);
        if (now.status === 'error' || now.status === 'busy') {
          errors += 1;
          if (errors >= MAX_ERRORS) inputsFromReading(layer.state(), { track: null, playing: false }).forEach((input) => layer.input(input));
        } else {
          errors = 0;
          const { track } = now.reading;
          const inputs = inputsFromReading(layer.state(), now.reading);
          inputs.forEach((input) => layer.input(input, track ?? undefined, now.progressMs));
          // Misma canción: solo se corrige por dónde va
          if (track && !inputs.some((input) => input.type === 'song')) layer.sync(now.progressMs);
          if (idle) wait = MUSIC_IDLE_POLL_MS;
        }
      }
      timer = setTimeout(tick, wait);
    };
    tick();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [demo]);

  return (
    <div className="itg-screen">
      <MusicOverlay ref={overlay} settings={shown} />
    </div>
  );
});

MusicWidgetLayer.displayName = 'MusicWidgetLayer';
