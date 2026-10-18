/**
 * server/lux/characters.ts
 *
 * Personajes de Mi AI (antes «Lux AI»): el catálogo que gestiona solo el
 * administrador y el personaje activo de cada streamer. El streamer no crea,
 * duplica ni borra personajes; solo usa el que le asigna el administrador.
 *
 * Un personaje tiene avatar, color, gestos y modelo propio. Sus recuerdos
 * (memory.ts) también son suyos: cambiar de personaje no borra nada, solo cambia
 * a quién se le escribe y de quién se leen los recuerdos.
 */

import type { Check } from './memory.js';

/** Avatares que existen hoy. Subir avatares nuevos no entra en esta versión. */
export const LUX_AVATARS = ['lux'] as const;
export type LuxAvatar = (typeof LUX_AVATARS)[number];

/** Gestos que el overlay sabe reproducir (public/lux/overlay.html, GESTURES). */
export const LUX_GESTURES = ['wave', 'spin', 'dance', 'jump', 'sing', 'bow', 'ult', 'pride', 'nod', 'shrug', 'arms_up'] as const;
export type LuxGestureId = (typeof LUX_GESTURES)[number];

export const CHARACTER_NAME_MAX = 40;
export const DEFAULT_CHARACTER_COLOR = '#f59e0b';

export interface LuxCharacter {
  id: string;
  name: string;
  avatar: LuxAvatar;
  /** Color del pelo y del acento (hex, #rrggbb). */
  color: string;
  /** Gestos que el personaje puede hacer en el overlay. */
  gestures: LuxGestureId[];
  /** Id del modelo propio, o null para el modelo por defecto del proveedor. */
  model: string | null;
  isDefault: boolean;
}

/** Lo que el administrador escribe para crear o editar un personaje. */
export interface LuxCharacterInput {
  name: string;
  avatar: LuxAvatar;
  color: string;
  gestures: LuxGestureId[];
  model: string | null;
}

/**
 * Personaje de respaldo cuando la base de datos no tiene catálogo (instalaciones
 * sin la migración 0032 aplicada o pruebas sin tabla). Es el mismo «Lux» de la migración.
 */
export const BUILTIN_CHARACTER: LuxCharacter = {
  id: 'lux-default',
  name: 'Lux',
  avatar: 'lux',
  color: DEFAULT_CHARACTER_COLOR,
  gestures: [...LUX_GESTURES],
  model: null,
  isDefault: true,
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const isGesture = (value: unknown): value is LuxGestureId => (LUX_GESTURES as readonly string[]).includes(value as string);

/**
 * Valida lo que escribe el administrador. El modelo solo se comprueba que sea
 * texto corto: que exista en el catálogo lo mira el servidor con models.ts.
 */
export function normalizeCharacterInput(input: Record<string, unknown>): Check<LuxCharacterInput> {
  if (typeof input.name !== 'string') return { ok: false, field: 'name', message: 'El nombre tiene que ser texto.' };
  const name = input.name.trim();
  if (!name || name.length > CHARACTER_NAME_MAX) {
    return { ok: false, field: 'name', message: `El nombre va de 1 a ${CHARACTER_NAME_MAX} caracteres.` };
  }

  const avatar = input.avatar ?? 'lux';
  if (!(LUX_AVATARS as readonly unknown[]).includes(avatar)) return { ok: false, field: 'avatar', message: 'Ese avatar no existe.' };

  const color = input.color ?? DEFAULT_CHARACTER_COLOR;
  if (typeof color !== 'string' || !HEX_COLOR.test(color)) return { ok: false, field: 'color', message: 'El color tiene que ser hexadecimal, como #f59e0b.' };

  const gestures = input.gestures ?? [...LUX_GESTURES];
  if (!Array.isArray(gestures) || !gestures.every(isGesture)) return { ok: false, field: 'gestures', message: 'Hay un gesto que el overlay no conoce.' };

  let model: string | null = null;
  if (input.model !== undefined && input.model !== null) {
    if (typeof input.model !== 'string' || input.model.trim().length === 0 || input.model.length > 120) {
      return { ok: false, field: 'model', message: 'El modelo no es válido.' };
    }
    model = input.model.trim();
  }

  return {
    ok: true,
    value: {
      name,
      avatar: avatar as LuxAvatar,
      color: color.toLowerCase(),
      gestures: [...new Set(gestures as LuxGestureId[])],
      model,
    },
  };
}

/**
 * El personaje activo de un streamer: el que le asignó el administrador, o el
 * que está marcado por defecto si no tiene ninguno (o si ya no existe).
 */
export function pickCharacter(list: LuxCharacter[], assignedId: string | null | undefined): LuxCharacter {
  if (list.length === 0) return BUILTIN_CHARACTER;
  return list.find((item) => item.id === assignedId) ?? list.find((item) => item.isDefault) ?? list[0];
}

/** Lo que ve el overlay del personaje: solo lo que dibuja, nada del modelo ni del catálogo. */
export function overlayView(character: LuxCharacter): { avatar: LuxAvatar; color: string; gestures: LuxGestureId[] } {
  return { avatar: character.avatar, color: character.color, gestures: character.gestures };
}
