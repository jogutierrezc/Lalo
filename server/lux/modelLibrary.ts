/**
 * server/lux/modelLibrary.ts
 *
 * Biblioteca de modelos 3D de Mi AI (migración 0035). Reglas puras, sin base de datos:
 *   - la biblioteca compartida: los modelos de Riot Games (de lux_characters, con aviso de
 *     licencia) y los modelos de creadores que el administrador ha aprobado;
 *   - un creador ve la biblioteca compartida y sus propios modelos, en cualquier estado;
 *   - un creador solo puede elegir lo que ve;
 *   - cuota de modelos propios por plan (lux_max_models; null = 0).
 *
 * El archivo y su clave de R2 nunca salen: libraryView() los quita.
 */

import { RIOT_NOTICE } from './characters.js';

/** Estados de un modelo de creador. Los de Riot Games siempre están aprobados. */
export const REVIEW_STATUSES = ['privado', 'pendiente', 'aprobado'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Un modelo tal como lo lee la biblioteca (de Riot o de un creador). */
export interface LibraryModel {
  id: string;
  name: string;
  /** 'riot' = personaje de Riot Games (lux_characters); 'creador' = lux_models. */
  source: 'riot' | 'creador';
  /** Cuenta dueña. Null para los de Riot Games. */
  ownerProfileId: string | null;
  fileName: string | null;
  bytes: number | null;
  uploadedAt: string | null;
  reviewStatus: ReviewStatus;
  licenseConfirmed: boolean;
  /** Clave del archivo en el bucket privado. Solo el servidor la conoce: nunca sale. */
  modelKey: string | null;
}

/** Lo que sale del servidor: sin clave, con el aviso de licencia de Riot cuando corresponde. */
export type LibraryModelView = Omit<LibraryModel, 'modelKey'> & { licenseNotice: string | null };

/** Aviso que debe verse con un modelo: el de Riot Games, con su texto exacto. */
export function libraryLicenseNotice(model: Pick<LibraryModel, 'source'>): string | null {
  return model.source === 'riot' ? RIOT_NOTICE : null;
}

export function libraryView(model: LibraryModel): LibraryModelView {
  const { modelKey: _hidden, ...view } = model;
  return { ...view, licenseNotice: libraryLicenseNotice(model) };
}

/** Un modelo tiene archivo si su clave está confirmada. Sin archivo, no existe para la biblioteca. */
export function hasFile(model: Pick<LibraryModel, 'modelKey'>): boolean {
  return model.modelKey !== null;
}

/** true si el modelo es de la biblioteca compartida: de Riot Games o aprobado por el administrador. */
export function isShared(model: LibraryModel): boolean {
  return hasFile(model) && (model.source === 'riot' || model.reviewStatus === 'aprobado');
}

/** Modelos que una cuenta puede ver y elegir: los compartidos y los suyos (con archivo). */
export function visibleTo(models: LibraryModel[], profileId: string): LibraryModel[] {
  return models.filter((model) => hasFile(model) && (isShared(model) || model.ownerProfileId === profileId));
}

/** Modelos propios de la cuenta con archivo: son los que cuentan para la cuota. */
export function ownedWithFile(models: LibraryModel[], profileId: string): LibraryModel[] {
  return models.filter((model) => model.source === 'creador' && model.ownerProfileId === profileId && hasFile(model));
}

/** Nº máximo de modelos propios del plan. Sin plan o sin valor, cero. */
export function modelLimitOf(maxModels: number | null | undefined): number {
  return typeof maxModels === 'number' && Number.isInteger(maxModels) && maxModels >= 0 ? maxModels : 0;
}

/** Cuántos modelos propios le quedan a la cuenta. */
export function modelsLeft(limit: number, owned: number): number {
  return Math.max(0, limit - owned);
}

/** Estado en que queda un modelo que el dueño envía a revisión: solo desde privado y con archivo. */
export function canSubmit(model: LibraryModel): { ok: true } | { ok: false; message: string } {
  if (!hasFile(model)) return { ok: false, message: 'Sube el archivo antes de enviarlo a revisión.' };
  if (model.reviewStatus === 'aprobado') return { ok: false, message: 'Este modelo ya está en la biblioteca.' };
  return { ok: true };
}

/** El administrador solo aprueba con el archivo presente y la licencia confirmada. */
export function canApprove(model: LibraryModel, licenseConfirmed: unknown): { ok: true } | { ok: false; code: string; message: string } {
  if (!hasFile(model)) return { ok: false, code: 'no_file', message: 'Este modelo no tiene archivo subido.' };
  if (licenseConfirmed !== true) return { ok: false, code: 'license_required', message: 'Confirma la licencia del modelo antes de publicarlo en la biblioteca.' };
  return { ok: true };
}
