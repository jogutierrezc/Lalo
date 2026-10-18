/**
 * server/lux/effectiveModel.ts
 *
 * Modelo 3D efectivo de una cuenta para su personaje de Mi AI (overlay de OBS).
 * Reglas, en orden:
 *   1. el modelo de la biblioteca que la cuenta eligió (profiles.lux_model_id), si lo ve;
 *   2. si no, el modelo propio del personaje (avatar «glb:<id>» con archivo, de su dueña o de Riot);
 *   3. si no, ninguno: el overlay dibuja a Lux.
 * Pura: no lee la base. El manejador le pasa el personaje, la cuenta y el modelo elegido.
 *
 * El id del modelo es el que va en el avatar «glb:<id>» y en ?m= de /api/lux/mascota-model.
 * La clave del archivo (modelKey) es interna: nunca sale en una respuesta.
 */

import { licenseNoticeFor, type LuxCharacter } from './characters.js';
import { libraryLicenseNotice, type LibraryModel } from './modelLibrary.js';

/** Formato de un id de modelo que el overlay acepta del servidor: minúsculas, dígitos y guiones. */
export const OVERLAY_MODEL_ID = /^[a-z0-9-]{1,64}$/;
/** Avatar de modelo «glb:<id>» con el formato de arriba. El servidor decide si el id es visible. */
export const OVERLAY_MODEL_AVATAR = /^glb:([a-z0-9-]{1,64})$/;

/** Id del modelo de un avatar «glb:<id>», o null si el avatar no es de modelo. */
export function modelIdFromAvatar(avatar: unknown): string | null {
  if (typeof avatar !== 'string') return null;
  const match = OVERLAY_MODEL_AVATAR.exec(avatar);
  return match ? match[1] : null;
}

export interface EffectiveModel {
  /** Id del modelo: va en el avatar «glb:<id>» y en ?m= de la ruta del GLB. */
  id: string;
  /** Clave del archivo en el bucket privado. Interna. */
  modelKey: string;
  /** Aviso de licencia que debe verse con este modelo (Riot Games), o null. */
  licenseNotice: string | null;
}

/**
 * Modelo efectivo de la cuenta. `chosen` es el modelo de la biblioteca que la cuenta
 * eligió y ya pasó el filtro de visibilidad (modelLibrary.visibleTo); si es null, cuenta
 * el modelo propio del personaje.
 */
export function effectiveModel(character: LuxCharacter, profileId: string, chosen: LibraryModel | null): EffectiveModel | null {
  if (chosen && chosen.modelKey) {
    return { id: chosen.id, modelKey: chosen.modelKey, licenseNotice: libraryLicenseNotice(chosen) };
  }
  const id = modelIdFromAvatar(character.avatar);
  if (!id || !character.modelKey) return null;
  // El modelo propio del personaje solo lo usa su dueña; el de Riot Games lo ve cualquiera (S3).
  const visible = character.ownerProfileId === profileId || character.modelOrigin === 'riot';
  if (!visible) return null;
  return { id, modelKey: character.modelKey, licenseNotice: licenseNoticeFor(character) };
}

/** Lo que el overlay necesita del personaje, con el avatar y el aviso del modelo efectivo. Sin claves. */
export function overlayViewFor(
  character: LuxCharacter,
  effective: EffectiveModel | null
): { avatar: string; color: string; gestures: LuxCharacter['gestures']; licenseNotice: string | null } {
  return {
    avatar: effective ? `glb:${effective.id}` : character.avatar,
    color: character.color,
    gestures: character.gestures,
    licenseNotice: effective ? effective.licenseNotice : null,
  };
}
