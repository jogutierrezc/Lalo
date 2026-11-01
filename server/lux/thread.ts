/**
 * server/lux/thread.ts
 *
 * Hilo por espectador (migración 0044): los últimos mensajes de un espectador y las respuestas de Lux, para que
 * un «¿y por qué?» tenga contexto. Es efímero: pocos turnos y pocos minutos. Aquí vive la regla de retención,
 * pura y sin base de datos, para poder probarla; luxDb.ts la aplica al leer y al podar.
 */

/** Turnos que se conservan por espectador (un turno = un mensaje o una respuesta). */
export const LUX_THREAD_TURNS = 6;
/** Un turno de más de 10 minutos ya no cuenta. */
export const LUX_THREAD_TTL_MS = 10 * 60 * 1000;
/** Tope de caracteres de cada turno guardado (la base de datos admite 1000). */
export const LUX_THREAD_CONTENT_MAX = 600;

export interface LuxThreadMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LuxThreadRow extends LuxThreadMessage {
  /** Marca de tiempo en ms. */
  at: number;
}

/** Clave del espectador en el hilo: sin mayúsculas ni arroba. */
export function threadViewerKey(viewer: string): string {
  return viewer.trim().replace(/^@/, '').toLowerCase();
}

/**
 * Del conjunto de filas de un espectador, los turnos que valen: sin los caducados, los últimos LUX_THREAD_TURNS,
 * en orden cronológico y empezando por un mensaje del espectador (así el hilo no abre con una respuesta suelta).
 */
export function trimThread(rows: readonly LuxThreadRow[], nowMs: number): LuxThreadMessage[] {
  const fresh = rows
    .filter((row) => nowMs - row.at <= LUX_THREAD_TTL_MS && row.content.trim() !== '')
    .sort((a, b) => a.at - b.at)
    .slice(-LUX_THREAD_TURNS);
  while (fresh.length > 0 && fresh[0].role !== 'user') fresh.shift();
  return fresh.map(({ role, content }) => ({ role, content }));
}
