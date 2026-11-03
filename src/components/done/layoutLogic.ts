/**
 * src/components/done/layoutLogic.ts
 *
 * Lógica pura de la pantalla de Done: tamaño de la vista previa (S/M/L, recordado en el
 * navegador) y qué muestra la franja de estado del bot. Sin DOM ni red para poder probarla.
 */

import { botSteps, type StepState } from '../../utils/botCloud';
import type { BotConnectionView } from '../../lib/botApi';

export type PreviewSize = 'S' | 'M' | 'L';
export const PREVIEW_SIZES: PreviewSize[] = ['S', 'M', 'L'];
/** Ancho en px de la columna de la vista previa (la altura sale del 16:9). */
export const PREVIEW_WIDTH: Record<PreviewSize, number> = { S: 260, M: 340, L: 440 };
export const PREVIEW_SIZE_LABEL: Record<PreviewSize, string> = { S: 'Pequeña', M: 'Mediana', L: 'Grande' };
export const PREVIEW_SIZE_KEY = 'tally_done_preview_size';
export const DEFAULT_PREVIEW_SIZE: PreviewSize = 'M';

export const parsePreviewSize = (value: unknown): PreviewSize => (value === 'S' || value === 'M' || value === 'L' ? value : DEFAULT_PREVIEW_SIZE);

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const defaultStorage = (): StorageLike | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** El tamaño elegido la última vez; sin almacenamiento (ventana privada) vale el de por defecto. */
export function readPreviewSize(storage: StorageLike | null = defaultStorage()): PreviewSize {
  try {
    return parsePreviewSize(storage?.getItem(PREVIEW_SIZE_KEY));
  } catch {
    return DEFAULT_PREVIEW_SIZE;
  }
}

export function savePreviewSize(size: PreviewSize, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(PREVIEW_SIZE_KEY, size);
  } catch {
    // Sin almacenamiento: la elección vale solo para esta sesión
  }
}

/** Altura (px) de la vista previa para un tamaño: 16:9. */
export const previewHeight = (size: PreviewSize): number => Math.round((PREVIEW_WIDTH[size] * 9) / 16);

// ---------- Franja del bot ----------

export type BotAction = 'connect' | 'disconnect' | 'open-bot' | 'none';

export interface BotStripView {
  steps: { id: 'account' | 'permission' | 'active'; label: string; ok: boolean; state: StepState }[];
  action: BotAction;
  /** Texto del botón; vacío si no hay acción. */
  actionLabel: string;
  /** Explicación cuando no hay acción posible. */
  hint: string;
}

/** Qué pinta la franja: los tres pasos del bot en la nube y el botón que toca. Se apoya en `botSteps`. */
export function botStripView(connection: BotConnectionView | null): BotStripView {
  const s = botSteps(connection);
  const steps: BotStripView['steps'] = [
    { id: 'account', label: 'Cuenta de Twitch', ok: s.account.state === 'done', state: s.account.state },
    { id: 'permission', label: 'Permiso del chat', ok: s.permission.state === 'done', state: s.permission.state },
    { id: 'active', label: s.active.state === 'done' ? 'Bot activo' : 'Bot apagado', ok: s.active.state === 'done', state: s.active.state },
  ];
  if (!connection) return { steps, action: 'none', actionLabel: '', hint: 'Comprobando el bot…' };
  // Falta el canal: el paso 1 se resuelve en la pantalla del bot
  if (s.account.state !== 'done') return { steps, action: 'open-bot', actionLabel: 'Conectar el bot', hint: '' };
  if (s.permission.state === 'unavailable') return { steps, action: 'none', actionLabel: '', hint: 'El bot en la nube todavía no está disponible en este servidor.' };
  if (s.active.state === 'done' || (connection.enabled && connection.chat === 'pending')) return { steps, action: 'disconnect', actionLabel: 'Apagar el bot', hint: '' };
  return { steps, action: 'connect', actionLabel: 'Conectar el bot', hint: '' };
}
