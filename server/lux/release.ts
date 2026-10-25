/**
 * server/lux/release.ts
 *
 * Versión publicada de Lux para los streams. El administrador la sube desde
 * Integraciones: el overlay de OBS se recarga solo al cambiar, y el bot avisa al
 * arrancar si su script es más viejo (el script de Python se regenera en el estudio).
 */

/** Versión del script de Python que genera el estudio de TwitchIO. Súbela al cambiar sus comandos. */
export const LUX_BOT_VERSION = 5;

export const RELEASE_SETTING = 'lux_release';

export interface LuxRelease {
  version: number;
  note: string;
  at: string | null;
}

export const NO_RELEASE: LuxRelease = { version: LUX_BOT_VERSION, note: '', at: null };

/** Lee la versión guardada. Un valor roto cae a la versión inicial. */
export function parseRelease(raw: string | null): LuxRelease {
  if (!raw) return { ...NO_RELEASE };
  try {
    const data = JSON.parse(raw) as Partial<LuxRelease>;
    const version = Number.isInteger(data.version) && (data.version as number) >= LUX_BOT_VERSION ? (data.version as number) : LUX_BOT_VERSION;
    return {
      version,
      note: typeof data.note === 'string' ? data.note.slice(0, 200) : '',
      at: typeof data.at === 'string' ? data.at : null,
    };
  } catch {
    return { ...NO_RELEASE };
  }
}

/** Siguiente versión publicada con su nota y la hora. */
export function nextRelease(current: LuxRelease, note: string, now: number): LuxRelease {
  return {
    version: current.version + 1,
    note: note.trim().slice(0, 200),
    at: new Date(now).toISOString(),
  };
}
