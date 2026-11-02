/**
 * src/components/welcome/useRegaloFundador.ts
 *
 * Estado del regalo del plan Creadores Iniciales para la cuenta que ha entrado:
 * trae el plan y los meses de la nube, sabe si ya se activó y expone `activar`.
 * Lo comparten la bienvenida y la tarjeta de Mi cuenta. Con una demostración
 * (`?bienvenida=fundador`) todo es simulado y no toca la nube.
 */

import { useCallback, useEffect, useState } from 'react';
import { useCloudSession } from '../../hooks/useCloudSession';
import {
  REGALO_POR_DEFECTO,
  esFundador,
  estadoDesdeResultado,
  estadoInicialRegalo,
  type ConfigRegalo,
  type Demo,
  type EstadoRegalo,
} from '../../lib/fundadores';
import { reclamarRegalo, traerConfigRegalo } from '../../lib/fundadoresApi';

export function useRegaloFundador(simulado: Demo | null = null) {
  const { profile, refresh } = useCloudSession();
  const [config, setConfig] = useState<ConfigRegalo>({ ...REGALO_POR_DEFECTO, meses: simulado?.meses ?? REGALO_POR_DEFECTO.meses });
  const [estado, setEstado] = useState<EstadoRegalo>(() => (simulado ? 'disponible' : estadoInicialRegalo(profile)));
  const fundadora = simulado ? true : esFundador(profile);
  const reclamado = Boolean(profile?.founder_gift_claimed_at);

  // El plan y los meses los fija el administrador en la nube
  useEffect(() => {
    if (simulado || !fundadora) return;
    let viva = true;
    traerConfigRegalo().then((c) => {
      if (viva) setConfig(c);
    });
    return () => {
      viva = false;
    };
  }, [simulado, fundadora]);

  // Si el perfil cambia (por ejemplo, tras refrescarlo), el estado sigue a la cuenta
  useEffect(() => {
    if (simulado) return;
    if (reclamado) setEstado('activado');
    else setEstado((actual) => (actual === 'activando' ? actual : estadoInicialRegalo(profile)));
  }, [simulado, reclamado, profile]);

  const activar = useCallback(async () => {
    if (estado !== 'disponible') return;
    setEstado('activando');
    if (simulado) {
      window.setTimeout(() => setEstado('activado'), 600);
      return;
    }
    const resultado = await reclamarRegalo();
    setEstado(estadoDesdeResultado(resultado));
    if (resultado === 'ok') await refresh();
  }, [estado, simulado, refresh]);

  return { config, estado, activar, fundadora };
}
