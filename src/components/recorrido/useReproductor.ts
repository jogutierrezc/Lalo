/**
 * src/components/recorrido/useReproductor.ts
 *
 * Reproduce un audio de voz a petición (nunca solo). Lleva la cuenta de si está
 * cargando o sonando y deja un mensaje legible si falla. Al desmontar, calla.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { audioDeVoz, type PedidoDeVoz } from '../../lib/narracion';

export type EstadoVoz = 'reposo' | 'cargando' | 'sonando';

export function useReproductor() {
  const [estado, setEstado] = useState<EstadoVoz>('reposo');
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Cada petición tiene su turno: una respuesta que llega tarde no pisa a la siguiente
  const turno = useRef(0);

  const callar = useCallback(() => {
    turno.current += 1;
    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
    }
  }, []);

  const detener = useCallback(() => {
    callar();
    setEstado('reposo');
  }, [callar]);

  /** Devuelve true si el audio llegó a sonar. */
  const sonar = useCallback(
    async (pedido: PedidoDeVoz): Promise<boolean> => {
      callar();
      const mio = turno.current;
      setError(null);
      setEstado('cargando');
      try {
        const url = await audioDeVoz(pedido);
        if (turno.current !== mio) return false;
        const audio = new Audio(url);
        audioRef.current = audio;
        const fin = () => {
          if (audioRef.current !== audio) return;
          audioRef.current = null;
          setEstado('reposo');
        };
        audio.onended = fin;
        audio.onerror = () => {
          fin();
          setError('El audio no se pudo reproducir.');
        };
        await audio.play();
        if (turno.current !== mio) return false;
        setEstado('sonando');
        return true;
      } catch {
        if (turno.current !== mio) return false;
        audioRef.current = null;
        setEstado('reposo');
        setError('Ahora no se puede escuchar. Inténtalo de nuevo en un momento.');
        return false;
      }
    },
    [callar]
  );

  useEffect(() => callar, [callar]);

  return { estado, error, sonar, detener };
}
