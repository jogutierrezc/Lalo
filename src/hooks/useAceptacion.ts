/**
 * src/hooks/useAceptacion.ts
 *
 * Qué documentos legales le falta aceptar a la cuenta que ha entrado.
 *
 * Lo aceptado se lee de la nube (tabla terms_acceptances, migración 0008). Si
 * no se puede leer, por ejemplo porque la migración aún no está aplicada, vale
 * el recuerdo de este navegador: nadie se queda sin poder entrar. En cuanto la
 * nube responde, manda ella, y quien solo había aceptado en su navegador vuelve
 * a aceptar una vez para que quede registrado.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { acceptTerms, fetchOwnAcceptances } from '../lib/cloud';
import { VERSIONES_ACTUALES, versionesVigentes } from '../legal';
import {
  aceptoAlgunaVez,
  claveAceptacion,
  documentosPendientes,
  leerAceptacionLocal,
  versionesDeFilas,
  type VersionesAceptadas,
} from '../legal/logica';
import type { DocId } from '../legal/tipos';

export interface Aceptacion {
  /** Todavía no se sabe qué aceptó la cuenta. */
  cargando: boolean;
  /** Documentos que faltan por aceptar, en el orden de la página legal. */
  pendientes: DocId[];
  /** La cuenta ya había aceptado una versión anterior: es una renovación. */
  renovacion: boolean;
  /**
   * Guarda la aceptación en la cuenta. Devuelve null si quedó guardada. Si no,
   * la recuerda en este navegador y devuelve el aviso para enseñarlo; después
   * hay que llamar a `seguir`.
   */
  aceptar: () => Promise<string | null>;
  /** Da por aceptado en esta visita lo que solo se pudo recordar en el navegador. */
  seguir: () => void;
}

const AVISO_LOCAL =
  'No se pudo guardar tu aceptación en tu cuenta. La recordamos en este navegador, pero se te volverá a pedir en otro. Avisa a quien administra Lalo: falta aplicar una actualización de la base de datos.';

function leerLocal(perfilId: string): VersionesAceptadas {
  try {
    return leerAceptacionLocal(localStorage.getItem(claveAceptacion(perfilId)));
  } catch {
    return {};
  }
}

interface Estado {
  perfilId: string;
  aceptadas: VersionesAceptadas;
}

/** `perfilId` null: no hay cuenta a la que preguntar (sin nube, sin sesión o en una capa de OBS). */
export function useAceptacion(perfilId: string | null): Aceptacion {
  const [estado, setEstado] = useState<Estado | null>(null);

  useEffect(() => {
    if (!perfilId) {
      setEstado(null);
      return;
    }
    let alive = true;
    fetchOwnAcceptances(perfilId)
      .then((filas) => versionesDeFilas(filas))
      .catch(() => leerLocal(perfilId))
      .then((aceptadas) => {
        if (alive) setEstado({ perfilId, aceptadas });
      });
    return () => {
      alive = false;
    };
  }, [perfilId]);

  const aceptar = useCallback(async (): Promise<string | null> => {
    if (!perfilId) return null;
    const vigentes = versionesVigentes();
    const fallo = await acceptTerms(vigentes);
    if (!fallo) {
      setEstado({ perfilId, aceptadas: vigentes });
      return null;
    }
    try {
      localStorage.setItem(claveAceptacion(perfilId), JSON.stringify(vigentes));
    } catch {
      // Sin almacenamiento: vale para esta visita
    }
    return AVISO_LOCAL;
  }, [perfilId]);

  const seguir = useCallback(() => {
    if (perfilId) setEstado({ perfilId, aceptadas: versionesVigentes() });
  }, [perfilId]);

  return useMemo(() => {
    const listo = perfilId !== null && estado !== null && estado.perfilId === perfilId;
    const aceptadas = listo ? estado.aceptadas : {};
    return {
      cargando: perfilId !== null && !listo,
      pendientes: listo ? documentosPendientes(aceptadas, VERSIONES_ACTUALES) : [],
      renovacion: aceptoAlgunaVez(aceptadas),
      aceptar,
      seguir,
    };
  }, [perfilId, estado, aceptar, seguir]);
}
