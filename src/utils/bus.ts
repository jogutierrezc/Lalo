/**
 * bus.ts
 *
 * Canal BroadcastChannel entre el panel, el control en vivo y el widget.
 * Solo comunica pestañas del MISMO navegador: el navegador de OBS es otro, y
 * allí el control llega por comandos de chat (ver parseControl en moderation.ts).
 */

import type { ControlAction } from './moderation';
import type { TTSSettings } from '../types/settings';

export const BUS_NAME = 'lalo_tts_bus';

export interface LiveItem {
  id: string;
  user: string;
  username: string;
  text: string;
  trigger?: string;
  bits?: number;
  pending?: boolean; // espera aprobación manual
}

export interface LogItem extends LiveItem {
  at: number;
  status: 'read' | 'skipped' | 'rejected';
  reason?: string;
}

/** Contadores de la sesión del widget (se reinician al recargarlo). */
export interface SessionStats {
  read: number;
  skipped: number;
  rejected: number;
  paid: number; // leídos por puntos o bits
  byUser: Record<string, number>; // leídos por espectador
}

/** Estado que el widget publica para el control en vivo. */
export interface WidgetState {
  channel: string;
  connected: boolean;
  paused: boolean;
  approval: boolean;
  textOnly: boolean;
  timeouts: { user: string; until: number }[];
  stats: SessionStats;
  now: LiveItem | null;
  queue: LiveItem[];
  log: LogItem[];
  at: number;
}

export type BusMessage =
  | { type: 'SETTINGS_UPDATE'; settings: TTSSettings }
  | { type: 'ENQUEUE'; text: string; user?: string }
  | { type: 'FORCE_RELOAD' }
  | { type: 'CONTROL'; action: ControlAction | 'remove'; id?: string; user?: string; minutes?: number }
  | { type: 'STATE_REQUEST' }
  | { type: 'STATE'; state: WidgetState };

export function postBus(message: BusMessage): void {
  try {
    const bus = new BroadcastChannel(BUS_NAME);
    bus.postMessage(message);
    bus.close();
  } catch {
    // Ignorar si no está soportado
  }
}

/** Escucha el canal. Devuelve la función para dejar de escuchar. */
export function listenBus(handler: (message: BusMessage) => void): () => void {
  try {
    const bus = new BroadcastChannel(BUS_NAME);
    bus.onmessage = (event) => {
      if (event.data && typeof event.data.type === 'string') handler(event.data as BusMessage);
    };
    return () => bus.close();
  } catch {
    return () => {};
  }
}
