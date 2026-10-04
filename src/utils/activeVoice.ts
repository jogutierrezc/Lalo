/**
 * src/utils/activeVoice.ts
 *
 * La voz con la que habla esta página. En una fuente de OBS los ajustes pueden
 * venir de la URL y no estar guardados en el navegador, así que quien habla por
 * su cuenta (las frases de las batallas) pregunta aquí en vez de leer lo guardado.
 */

import { loadSettings, type TTSSettings } from '../types/settings';

export type ActiveVoice = Pick<TTSSettings, 'referenceId' | 'model' | 'volume' | 'speed'>;

let active: ActiveVoice | null = null;

/** La fuente de OBS deja aquí los ajustes con los que trabaja. */
export function setActiveVoice(settings: ActiveVoice | null): void {
  active = settings;
}

/** Ajustes de la voz vigentes: los de la fuente si los hay; si no, los guardados (el panel). */
export function getActiveVoice(): ActiveVoice {
  return active ?? loadSettings();
}
