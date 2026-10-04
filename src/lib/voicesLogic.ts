/**
 * src/lib/voicesLogic.ts
 *
 * Funciones puras del catálogo de voces: de dónde sale la lista que ve el
 * streamer (la nube o las cinco voces fijas), qué hacer cuando la voz que tenía
 * guardada ya no está y cómo se enseña cada voz en la consola. No tocan la red.
 */

import { PRESET_VOICES, type PresetVoice } from '../types/settings';
import type { AdminVoiceRow, PublicVoiceRow, VoiceState } from './cloudTypes';

// ---------- Catálogo del streamer ----------

export interface CatalogueVoice extends PresetVoice {
  isDefault: boolean;
}

export interface VoiceCatalogue {
  voices: CatalogueVoice[];
  /** Id de la voz por defecto. Siempre es una de `voices`. */
  defaultId: string;
  /** 'nube': leído de la base de datos. 'fijas': las cinco voces escritas en el código. */
  source: 'nube' | 'fijas';
}

/** Las cinco voces de siempre. La primera (Chispa) es la voz por defecto. */
export function presetCatalogue(): VoiceCatalogue {
  return {
    voices: PRESET_VOICES.map((voice, index) => ({ ...voice, isDefault: index === 0 })),
    defaultId: PRESET_VOICES[0].id,
    source: 'fijas',
  };
}

/**
 * Elige el catálogo: el de la nube si se pudo leer y trae una voz por defecto
 * visible; si no (nube apagada, tabla sin crear, fallo de red o respuesta
 * vacía), las cinco voces fijas.
 */
export function pickCatalogue(input: { cloudEnabled: boolean; rows: PublicVoiceRow[] | null }): VoiceCatalogue {
  if (!input.cloudEnabled || !input.rows) return presetCatalogue();
  const visible = input.rows
    .filter((row) => row.visible && row.reference_id && row.name)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const byDefault = visible.find((row) => row.is_default);
  if (!byDefault) return presetCatalogue();
  return {
    voices: visible.map((row) => ({
      id: row.reference_id,
      name: row.name,
      description: row.description,
      isDefault: row.is_default,
    })),
    defaultId: byDefault.reference_id,
    source: 'nube',
  };
}

export interface ResolvedVoice {
  /** El id con el que hay que hablar o que hay que marcar como elegido. */
  id: string;
  /** true si la voz guardada era del catálogo y ya no está: se usa la voz por defecto. */
  replaced: boolean;
  /** true si es un id propio del streamer, que nunca fue del catálogo. */
  custom: boolean;
}

/**
 * Qué voz usar a partir de la que el streamer tiene guardada.
 *   - Si está en el catálogo, esa.
 *   - Si era del catálogo y ya no está (lo dice la nube con 'retired', o es una
 *     de las cinco voces fijas que falta en el catálogo de la nube), la voz por
 *     defecto. La configuración guardada no se toca aquí.
 *   - Si no, es un id propio y se respeta.
 */
export function resolveSavedVoice(saved: string, catalogue: VoiceCatalogue, state: VoiceState | null): ResolvedVoice {
  const id = saved.trim();
  if (!id) return { id: catalogue.defaultId, replaced: false, custom: false };
  if (catalogue.voices.some((voice) => voice.id === id)) return { id, replaced: false, custom: false };
  const wasPreset = PRESET_VOICES.some((voice) => voice.id === id);
  const retired = state === 'retired' || (catalogue.source === 'nube' && wasPreset && state !== 'visible');
  if (retired) return { id: catalogue.defaultId, replaced: true, custom: false };
  return { id, replaced: false, custom: true };
}

// ---------- Consola ----------

/** Orden de la consola: primero las voces creadas (la más nueva arriba), después las iniciales en su orden. */
export function sortAdminVoices(rows: AdminVoiceRow[]): AdminVoiceRow[] {
  return [...rows].sort((a, b) => {
    const aInitial = a.origin === 'initial';
    const bInitial = b.origin === 'initial';
    if (aInitial !== bInitial) return aInitial ? 1 : -1;
    return aInitial ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at);
  });
}

export function originLabel(origin: AdminVoiceRow['origin']): string {
  if (origin === 'recorded') return 'Grabada con micrófono';
  if (origin === 'uploaded') return 'Audios subidos';
  return 'Inicial';
}

/** Lo que se sabe del permiso de una voz, o null si no hay registro (las iniciales). */
export function permissionLabel(row: Pick<AdminVoiceRow, 'voice_owner' | 'permission_by'>): string | null {
  if (row.voice_owner === 'own') return 'voz propia del administrador';
  if (row.voice_owner === 'other') return row.permission_by?.trim() || 'otra persona';
  return null;
}

/** «la tienen guardada 3 streamers». null si no se pudo contar. */
export function usageLabel(streamers: number | undefined): string | null {
  if (typeof streamers !== 'number' || !Number.isFinite(streamers)) return null;
  if (streamers === 0) return 'ningún streamer la tiene guardada';
  return streamers === 1 ? 'la tiene guardada 1 streamer' : `la tienen guardada ${streamers} streamers`;
}

/** Línea de datos de una voz: origen, uso y permiso. */
export function voiceMetaLine(row: AdminVoiceRow): string {
  const permission = permissionLabel(row);
  return [originLabel(row.origin), usageLabel(row.streamers), permission ? `permiso: ${permission}` : null]
    .filter((part): part is string => part !== null)
    .join(' · ');
}

/** Texto de la confirmación al eliminar. */
export function deleteWarning(row: Pick<AdminVoiceRow, 'streamers'>): string {
  const base = 'Se borra también en Fish Audio y no se puede recuperar.';
  const count = row.streamers ?? 0;
  if (count <= 0) return base;
  return `${base} ${count === 1 ? 'El streamer que la tiene guardada pasará' : `Los ${count} streamers que la tienen guardada pasarán`} a la voz por defecto.`;
}

/** «5 voces · 4 visibles» */
export function catalogueCount(rows: Pick<AdminVoiceRow, 'visible'>[]): string {
  const visible = rows.filter((row) => row.visible).length;
  return `${rows.length} ${rows.length === 1 ? 'voz' : 'voces'} · ${visible} ${visible === 1 ? 'visible' : 'visibles'}`;
}
