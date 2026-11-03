/**
 * server/done/release.ts
 *
 * Versión publicada de los comandos de Done para el bot de Python. El administrador la sube; el bot avisa al arrancar
 * si su script es más viejo (el script se regenera en el estudio de TwitchIO). Misma idea que server/lux/release.ts,
 * con su propia numeración: Done y Lux no se pisan.
 */

/** Versión del script de Python que habla con Done. Súbela al cambiar sus comandos. */
export const DONE_BOT_VERSION = 1;

export const DONE_RELEASE_SETTING = 'done_release';

export interface DoneRelease {
  version: number;
  note: string;
  at: string | null;
}

export const NO_DONE_RELEASE: DoneRelease = { version: DONE_BOT_VERSION, note: '', at: null };

/** Lee la versión guardada. Un valor roto cae a la versión inicial. */
export function parseDoneRelease(raw: string | null): DoneRelease {
  if (!raw) return { ...NO_DONE_RELEASE };
  try {
    const data = JSON.parse(raw) as Partial<DoneRelease>;
    const version = Number.isInteger(data.version) && (data.version as number) >= DONE_BOT_VERSION ? (data.version as number) : DONE_BOT_VERSION;
    return { version, note: typeof data.note === 'string' ? data.note.slice(0, 200) : '', at: typeof data.at === 'string' ? data.at : null };
  } catch {
    return { ...NO_DONE_RELEASE };
  }
}

/** Siguiente versión publicada con su nota y la hora. */
export function nextDoneRelease(current: DoneRelease, note: string, now: number): DoneRelease {
  return { version: current.version + 1, note: note.trim().slice(0, 200), at: new Date(now).toISOString() };
}
