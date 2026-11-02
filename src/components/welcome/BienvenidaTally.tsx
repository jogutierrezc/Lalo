/**
 * src/components/welcome/BienvenidaTally.tsx
 *
 * Montaje de la bienvenida de Tally Studio sobre el panel. Decide, con la
 * lógica pura de src/lib/fundadores.ts, si toca enseñarla y en qué variante:
 *   - Fundador (cuenta anterior al despliegue): una sola vez por cuenta.
 *   - Cuenta nueva: una sola vez, al terminar el recorrido de Bienvenida.tsx.
 *   - «Ver bienvenida» en Mi cuenta: la repite cuando se pida.
 * Al cerrarla se recuerda en la cuenta (migración 0047) y en este navegador; si la
 * columna aún no existe, queda solo en el navegador y el panel sigue igual.
 *
 * Demostración sin cuenta ni nube: `?bienvenida=fundador` o `?bienvenida=nueva`
 * (opcionales `&nombre=Gaby&n=14&meses=3`). No guarda nada.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useCloudSession } from '../../hooks/useCloudSession';
import {
  bienvenidaNuevaPendiente,
  bienvenidaVistaAqui,
  leerDemo,
  numeroFundador,
  recordarBienvenidaVista,
  varianteAMostrar,
  type VarianteBienvenida,
} from '../../lib/fundadores';
import { marcarBienvenidaVista } from '../../lib/fundadoresApi';
import { BienvenidaOverlay } from './BienvenidaOverlay';
import { EVENTO_VER_BIENVENIDA } from './bienvenidaEvento';
import { useRegaloFundador } from './useRegaloFundador';

export const BienvenidaTally: React.FC = () => {
  const cloud = useCloudSession();
  const demo = useMemo(() => leerDemo(window.location.search, window.location.hash), []);
  const [repeticion, setRepeticion] = useState(false);
  const [cerrada, setCerrada] = useState(false);
  const regalo = useRegaloFundador(demo);

  useEffect(() => {
    const alPedir = () => {
      setCerrada(false);
      setRepeticion(true);
    };
    window.addEventListener(EVENTO_VER_BIENVENIDA, alPedir);
    return () => window.removeEventListener(EVENTO_VER_BIENVENIDA, alPedir);
  }, []);

  const perfil = cloud.enabled && cloud.session ? cloud.profile : null;
  const variante: VarianteBienvenida | null = demo
    ? demo.variante
    : varianteAMostrar({
        perfil,
        vista: perfil ? bienvenidaVistaAqui(perfil.id) : false,
        recorridoRecienTerminado: perfil ? bienvenidaNuevaPendiente(perfil.id) : false,
        repeticion,
      });

  const terminar = useCallback(async () => {
    setCerrada(true);
    setRepeticion(false);
    if (demo || !perfil) return;
    // Primero en este navegador (no se vuelve a enseñar aunque la nube falle) y luego en la cuenta
    recordarBienvenidaVista(perfil.id);
    if (!perfil.welcome_seen_at && (await marcarBienvenidaVista())) await cloud.refresh();
  }, [demo, perfil, cloud]);

  if (!variante || cerrada) return null;

  const nombre = demo ? demo.nombre : perfil?.display_name || perfil?.twitch_login || 'creador';
  const numero = demo ? demo.numero : numeroFundador(perfil);

  return (
    <BienvenidaOverlay
      variante={variante}
      nombre={nombre}
      numero={numero}
      meses={regalo.config.meses}
      planNombre={regalo.config.planNombre}
      estadoRegalo={regalo.estado}
      onActivarRegalo={regalo.activar}
      onTerminar={terminar}
    />
  );
};
