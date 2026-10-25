/**
 * src/lib/luxBotRecord.ts
 *
 * Recuerda con qué palabra de Lux se copió por última vez el script del bot, para que
 * el panel de Mi AI avise cuando hay que volver a copiarlo. Es una comodidad de este
 * navegador: el script vive en el ordenador del streamer, así que el dato tampoco
 * sale de aquí. Si el almacenamiento no está disponible, no hay aviso; nada se rompe.
 */

import { LUX_BOT_VERSION } from '../../server/lux/release';
import { LUX_CHAT_WORD_DEFAULT } from '../../server/lux/chatCommands';

const KEY = 'lalo.lux.botRecord';

export interface LuxBotRecord {
  word: string;
  alias: boolean;
  /** Nombre visible con el que se copió (chatName). Los registros viejos no lo traen. */
  name?: string;
  /** Versión del script (LUX_BOT_VERSION) con la que se generó. */
  version: number;
}

/** Clave que compara palabra y alias. Con la palabra «lux» el alias no cambia nada. */
export function luxChatKey(word: string, alias: boolean, name = ''): string {
  const w = word.trim().toLowerCase() || LUX_CHAT_WORD_DEFAULT;
  const base = w === LUX_CHAT_WORD_DEFAULT ? w : `${w}${alias ? '+alias' : ''}`;
  // El nombre visible también va dentro del script: si cambia, hay que volver a copiarlo.
  const n = name.trim().toLowerCase();
  return n ? `${base}|${n}` : base;
}

export function rememberLuxBot(record: Omit<LuxBotRecord, 'version'>): void {
  try {
    const value: LuxBotRecord = { word: record.word, alias: record.alias, name: record.name ?? '', version: LUX_BOT_VERSION };
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Sin almacenamiento no hay aviso. El bot funciona igual.
  }
}

export function readLuxBot(): LuxBotRecord | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<LuxBotRecord>;
    if (typeof data.word !== 'string' || typeof data.alias !== 'boolean' || !Number.isInteger(data.version)) return null;
    return { word: data.word, alias: data.alias, name: typeof data.name === 'string' ? data.name : '', version: data.version as number };
  } catch {
    return null;
  }
}
