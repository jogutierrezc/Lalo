/**
 * src/components/recorrido/PrimerosPasos.tsx
 *
 * Las tres primeras tareas del streamer: copiar la fuente de OBS, probar la voz
 * y activar las alertas. Salen al final de la bienvenida y se quedan arriba en
 * Inicio hasta que cada una esté hecha o quitada.
 *
 * El estado se guarda en este navegador, por cuenta.
 */

import React, { useCallback, useState } from 'react';
import { Check } from 'lucide-react';
import { useCloudSession } from '../../hooks/useCloudSession';
import { loadSettings } from '../../types/settings';
import { buildSuiteWidgetUrl } from '../../utils/widgetUrl';
import { activarAlertas } from '../../lib/recorridoCanal';
import {
  TAREAS,
  claveTareas,
  hayPrimerosPasos,
  leerTareas,
  marcarTarea,
  type EstadoTarea,
  type EstadoTareas,
  type TareaId,
} from '../../lib/recorrido';
import { useReproductor } from './useReproductor';
import { voiceForSpeaking } from '../../lib/voicesCloud';
import '../../styles/recorrido.css';

const FRASE_DE_PRUEBA = 'Hola, soy la voz de tu canal. Así sonarán los mensajes de tu chat.';

function leerGuardadas(perfilId: string): EstadoTareas {
  try {
    return leerTareas(localStorage.getItem(claveTareas(perfilId)));
  } catch {
    return {};
  }
}

/** Marca una tarea desde fuera del componente (por ejemplo, al guardar «Tu canal»). */
export function anotarTarea(perfilId: string, id: TareaId, valor: EstadoTarea): EstadoTareas {
  const siguiente = marcarTarea(leerGuardadas(perfilId), id, valor);
  try {
    localStorage.setItem(claveTareas(perfilId), JSON.stringify(siguiente));
  } catch {
    // Sin almacenamiento: la tarea volverá a salir en la próxima visita
  }
  return siguiente;
}

interface PrimerosPasosProps {
  perfilId: string;
  /** 'recorrido': dentro de la bienvenida. 'inicio': módulo del panel, que se puede ir quitando. */
  variante: 'recorrido' | 'inicio';
}

export const PrimerosPasos: React.FC<PrimerosPasosProps> = ({ perfilId, variante }) => {
  const cloud = useCloudSession();
  const voz = useReproductor();
  const [tareas, setTareas] = useState<EstadoTareas>(() => leerGuardadas(perfilId));
  const [urlSinCopiar, setUrlSinCopiar] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const anotar = useCallback(
    (id: TareaId, valor: EstadoTarea) => setTareas(anotarTarea(perfilId, id, valor)),
    [perfilId]
  );

  const copiarFuente = async () => {
    const settings = loadSettings();
    const canal = settings.channel.trim();
    if (!canal) {
      setAviso('Falta el canal. Escríbelo en Inicio y vuelve a copiar.');
      return;
    }
    const url = buildSuiteWidgetUrl(
      window.location.origin,
      'all',
      canal,
      settings,
      cloud.profile?.status === 'active' ? { k: cloud.profile.widget_key } : undefined
    );
    setAviso(null);
    try {
      if (!navigator.clipboard) throw new Error('Portapapeles no disponible');
      await navigator.clipboard.writeText(url);
      setUrlSinCopiar(null);
      anotar('obs', 'hecha');
    } catch {
      setUrlSinCopiar(url);
    }
  };

  const probarVoz = async () => {
    if (voz.estado !== 'reposo') {
      voz.detener();
      return;
    }
    // Si la voz guardada ya no está en el catálogo, suena la voz por defecto
    const referencia = await voiceForSpeaking(loadSettings().referenceId);
    if (await voz.sonar({ texto: FRASE_DE_PRUEBA, voz: referencia })) anotar('voz', 'hecha');
  };

  const hacer = (id: TareaId) => {
    if (id === 'obs') void copiarFuente();
    else if (id === 'voz') void probarVoz();
    else {
      activarAlertas();
      anotar('alertas', 'hecha');
    }
  };

  if (variante === 'inicio' && !hayPrimerosPasos(tareas)) return null;

  const lista = (
    <ol className="rec-tareas">
      {TAREAS.filter((tarea) => variante === 'recorrido' || tareas[tarea.id] !== 'quitada').map((tarea, i) => {
        const hecha = tareas[tarea.id] === 'hecha';
        const sonando = tarea.id === 'voz' && voz.estado !== 'reposo';
        return (
          <li key={tarea.id} data-hecha={hecha}>
            <i aria-hidden="true">{hecha ? <Check className="h-3.5 w-3.5" /> : i + 1}</i>
            <div className="min-w-0">
              <b>{tarea.titulo}</b>
              <p>{tarea.texto}</p>
            </div>
            <div className="rec-tarea-acciones">
              {hecha && tarea.id !== 'voz' ? (
                <span className="cab-chip" data-status="read">
                  Hecho
                </span>
              ) : (
                <button
                  type="button"
                  className="cab-btn2 cab-btn-sm"
                  aria-label={`${sonando ? 'Detener' : tarea.accion}: ${tarea.titulo}`}
                  onClick={() => hacer(tarea.id)}
                >
                  {sonando ? 'Detener' : tarea.id === 'voz' && voz.estado === 'cargando' ? 'Preparando' : tarea.accion}
                </button>
              )}
              {variante === 'inicio' && !hecha && (
                <button
                  type="button"
                  className="studio-link"
                  aria-label={`Quitar de la lista: ${tarea.titulo}`}
                  onClick={() => anotar(tarea.id, 'quitada')}
                >
                  Quitar
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );

  const avisos = (
    <>
      {(aviso || voz.error) && (
        <p className="cab-error" role="alert">
          {aviso || voz.error}
        </p>
      )}
      {urlSinCopiar && (
        <div className="cab-field" role="alert">
          <p className="cab-error">El navegador no dejó copiar la URL. Selecciónala aquí y cópiala a mano:</p>
          <code className="cab-url cab-mono">{urlSinCopiar}</code>
          <button type="button" className="studio-link justify-self-start" onClick={() => anotar('obs', 'hecha')}>
            Ya la copié
          </button>
        </div>
      )}
    </>
  );

  if (variante === 'recorrido') {
    return (
      <>
        {lista}
        {avisos}
      </>
    );
  }

  return (
    <section className="cab-mod" aria-label="Primeros pasos">
      <h2>Primeros pasos</h2>
      <p className="cab-hint">Tres cosas para tu primer directo, en el orden en que conviene hacerlas.</p>
      {lista}
      {avisos}
    </section>
  );
};
