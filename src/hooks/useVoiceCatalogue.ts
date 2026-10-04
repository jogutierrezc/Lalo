/**
 * src/hooks/useVoiceCatalogue.ts
 *
 * Catálogo de voces para las pantallas donde el streamer elige o ve su voz.
 * Empieza con lo que ya se sabe (el catálogo leído antes en esta pestaña, o las
 * cinco voces fijas) y, si hay sesión en la nube, lo actualiza.
 *
 * Si la voz guardada era del catálogo y ya no está (oculta o eliminada), avisa
 * con `onReplace` para que la pantalla pase a la voz por defecto. Solo cambia la
 * configuración de quien tiene la pantalla abierta, nunca la de otras cuentas.
 */

import { useEffect, useRef, useState } from 'react';
import { useCloudSession } from './useCloudSession';
import { cachedVoiceCatalogue, checkSavedVoice, loadVoiceCatalogue } from '../lib/voicesCloud';
import { presetCatalogue, type VoiceCatalogue } from '../lib/voicesLogic';

export interface VoiceCatalogueState {
  catalogue: VoiceCatalogue;
  /** true mientras se pregunta a la nube por primera vez. */
  loading: boolean;
  /** Nombre de la voz por defecto a la que se pasó, si la guardada ya no estaba. */
  replacedBy: string | null;
}

export function useVoiceCatalogue(saved?: string, onReplace?: (defaultId: string) => void): VoiceCatalogueState {
  const cloud = useCloudSession();
  const userId = cloud.enabled ? (cloud.session?.user.id ?? null) : null;
  const [catalogue, setCatalogue] = useState<VoiceCatalogue>(() => cachedVoiceCatalogue() ?? presetCatalogue());
  const [loading, setLoading] = useState(() => userId !== null && cachedVoiceCatalogue() === null);
  const [replacedBy, setReplacedBy] = useState<string | null>(null);
  const onReplaceRef = useRef(onReplace);
  onReplaceRef.current = onReplace;

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    let alive = true;
    loadVoiceCatalogue().then((next) => {
      if (!alive) return;
      setCatalogue(next);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [userId]);

  // La voz guardada, contra el catálogo de la nube
  useEffect(() => {
    if (!userId || saved === undefined || catalogue.source !== 'nube') return;
    if (catalogue.voices.some((voice) => voice.id === saved)) return;
    let alive = true;
    checkSavedVoice(saved).then(({ catalogue: current, resolved }) => {
      if (!alive || !resolved.replaced) return;
      setReplacedBy(current.voices.find((voice) => voice.id === resolved.id)?.name ?? 'la voz por defecto');
      onReplaceRef.current?.(resolved.id);
    });
    return () => {
      alive = false;
    };
  }, [userId, saved, catalogue]);

  return { catalogue, loading, replacedBy };
}
