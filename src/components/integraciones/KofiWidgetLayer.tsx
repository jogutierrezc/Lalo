/**
 * src/components/integraciones/KofiWidgetLayer.tsx
 *
 * Lado de OBS de Ko-fi. Va montada en el widget y:
 *
 * - Recibe los avisos de Ko-fi que TwitchEventLayer lee del canal de eventos
 *   (con la clave privada de la URL) y las pruebas que el panel envía por el bus.
 * - Lee del servidor lo recaudado y los últimos apoyos al abrirse, cada minuto
 *   y cuando el panel reinicia la meta.
 * - Con demo=1 enseña avisos de ejemplo (inventados), sin cuenta ni servidor.
 *
 * Qué piezas enseña lo decide la fuente: «Alertas de Ko-fi», «Meta de Ko-fi»,
 * «Últimos apoyos» o, en «Todo en uno», las que el streamer tenga encendidas.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { fetchKofiState } from '../../lib/integrationsApi';
import { isCloudEnabled } from '../../lib/supabase';
import { readWidgetKey } from '../../lib/widgetCloud';
import type { KofiSettings } from '../../types/kofi';
import { listenBus } from '../../utils/bus';
import { KOFI_DEMO_RAISED, KOFI_DEMO_RECENT, KOFI_DEMO_SEQUENCE, kofiSamplePayload } from '../../utils/kofiSamples';
import { KofiStage, type KofiParts, type KofiStageHandle } from './KofiStage';

const STATE_EVERY_MS = 60000;

export interface KofiWidgetLayerHandle {
  /** Un aviso de Ko-fi del canal de eventos, o una prueba del panel. */
  event: (payload: unknown, test: boolean) => void;
}

interface KofiWidgetLayerProps {
  settings: KofiSettings;
  parts: KofiParts;
  demo: boolean;
  blockedWords: string[];
  /** Pone una frase en la cola de voz de esta fuente. */
  speak?: (text: string) => void;
}

export const KofiWidgetLayer = forwardRef<KofiWidgetLayerHandle, KofiWidgetLayerProps>(({ settings, parts, demo, blockedWords, speak }, ref) => {
  const stage = useRef<KofiStageHandle | null>(null);
  const live = useRef(settings);
  live.current = settings;

  useImperativeHandle(ref, () => ({ event: (payload, test) => void stage.current?.event(payload, test) }), []);

  // Lo recaudado y los últimos apoyos, del servidor
  const refreshAt = settings.refreshAt;
  useEffect(() => {
    const key = !demo && isCloudEnabled ? readWidgetKey() : null;
    if (!key || (!parts.goal && !parts.recent)) return;
    let stopped = false;
    const read = async () => {
      const state = await fetchKofiState(key).catch(() => null);
      if (!stopped && state) stage.current?.setState(state);
    };
    read();
    const timer = setInterval(read, STATE_EVERY_MS);
    const stopBus = listenBus((message) => {
      if (message.type === 'KOFI_REFRESH') read();
    });
    return () => {
      stopped = true;
      clearInterval(timer);
      stopBus();
    };
  }, [demo, parts.goal, parts.recent, refreshAt]);

  // Avisos de ejemplo
  useEffect(() => {
    if (!demo) return;
    let index = 0;
    const fire = () => {
      stage.current?.event(kofiSamplePayload(KOFI_DEMO_SEQUENCE[index % KOFI_DEMO_SEQUENCE.length], live.current.goal.currency), true);
      index += 1;
    };
    const first = setTimeout(fire, 60);
    // Casi siempre hay una alerta en pantalla, para poder colocarla en OBS
    const timer = setInterval(fire, (live.current.hold + 1) * 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [demo]);

  return (
    <div className="itg-screen">
      <KofiStage
        ref={stage}
        settings={settings}
        parts={parts}
        blockedWords={blockedWords}
        speak={demo ? undefined : speak}
        muted={demo}
        initial={demo ? { raised: KOFI_DEMO_RAISED, recent: KOFI_DEMO_RECENT } : undefined}
      />
    </div>
  );
});

KofiWidgetLayer.displayName = 'KofiWidgetLayer';
