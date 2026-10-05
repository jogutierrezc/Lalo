/**
 * src/components/estudio/boxes/torneo.tsx
 *
 * Caja de Studio del torneo (`tournament`). El contrato está en ./types.ts.
 *
 * - Lee los ajustes de su módulo y los refresca con el bus del panel (también
 *   cuando la nube entrega unos nuevos a la fuente de OBS).
 * - En OBS monta la misma capa que la fuente suelta: lee el estado del almacén,
 *   recibe los comandos de moderación por la señal `staff` y narra con
 *   `services.speak`, la cola de voz del widget.
 * - En el editor enseña la llave de muestra, fija: sin red, sin voz y sin nada
 *   que la cambie. Su prueba (registry.test) repite la entrada de la llave.
 * - La caja nace a pantalla completa (1920 × 1080): la capa trae su propio
 *   marco, con el logo arriba y los patrocinadores abajo.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadTournamentSettings, normalizeTournamentSettings, type TournamentSettings } from '../../../types/tournament';
import { listenBus } from '../../../utils/bus';
import { sampleTournamentState } from '../../../utils/tournamentLogic';
import { TournamentLayer, TournamentLiveLayer, type TournamentLiveHandle } from '../../torneo/TournamentLayer';
import type { BoxMap, BoxProps, SceneSignal } from './types';
import '../../../styles/torneo.css';

/**
 * Reparte una señal de la escena a la capa. Devuelve true si era un comando del
 * torneo, para que nadie más lo atienda.
 */
export function routeTournamentSignal(layer: TournamentLiveHandle | null, signal: SceneSignal): boolean {
  if (!layer) return false;
  if (signal.kind === 'staff') return layer.command(signal.message, signal.sender);
  if (signal.kind === 'bus' && signal.message.type === 'TOURNAMENT_TEST') layer.test(signal.message.say);
  return false;
}

/** En OBS: la capa de la fuente suelta, con los comandos de la escena y la cola de voz del widget. */
const TournamentLive: React.FC<BoxProps & { settings: TournamentSettings }> = ({ layer, registry, demo, services, settings }) => {
  const ref = useRef<TournamentLiveHandle | null>(null);
  const servicesRef = useRef(services);
  servicesRef.current = services;

  const speak = useCallback((text: string, options: { voiceId?: string }) => void servicesRef.current?.speak(text, 'Torneo', true, options), []);

  useEffect(() => {
    registry.sinks.set(layer.id, (signal) => routeTournamentSignal(ref.current, signal));
    registry.test.set(layer.id, () => ref.current?.test(false));
    return () => {
      registry.sinks.delete(layer.id);
      registry.test.delete(layer.id);
    };
  }, [registry, layer.id]);

  return <TournamentLiveLayer ref={ref} settings={settings} demo={demo} speak={speak} />;
};

/** En el editor: la llave de ejemplo, quieta. Su prueba repite la entrada. */
const TournamentSample: React.FC<BoxProps & { settings: TournamentSettings }> = ({ layer, registry, settings }) => {
  const [replay, setReplay] = useState(0);
  const sample = useMemo(() => sampleTournamentState(settings.size), [settings.size]);

  useEffect(() => {
    registry.test.set(layer.id, () => setReplay((n) => n + 1));
    return () => {
      registry.test.delete(layer.id);
    };
  }, [registry, layer.id]);

  // Hasta la primera prueba no se mueve nada
  return <TournamentLayer settings={settings} state={sample} scene="llave" still={replay === 0} replay={replay} />;
};

const TournamentBox: React.FC<BoxProps> = (props) => {
  const [settings, setSettings] = useState(loadTournamentSettings);
  useEffect(
    () =>
      listenBus((message) => {
        if (message.type === 'TOURNAMENT_SETTINGS_UPDATE') setSettings(normalizeTournamentSettings(message.settings));
      }),
    []
  );
  return (
    <div className="es-lalo" data-kind="tournament">
      {props.mode === 'live' ? <TournamentLive {...props} settings={settings} /> : <TournamentSample {...props} settings={settings} />}
    </div>
  );
};

export const TORNEO_BOXES: BoxMap = { tournament: TournamentBox };
