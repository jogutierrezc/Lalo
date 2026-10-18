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

/** Avatares de dibujo fijo que existen. «lux» es el personaje de siempre. */
export const LUX_AVATARS = ['lux'] as const;
/**
 * Modelos GLB disponibles, en forma de avatar «glb:<id>». Copia de MODEL_AVATAR_IDS de
 * public/lux/mascota/logic.js (el overlay lo usa en el navegador); tests/luxMascota.test.ts
 * comprueba que las dos listas sean iguales.
 */
export const LUX_MODEL_AVATAR_IDS = ['warwick'] as const;
const MODEL_AVATAR = /^glb:([a-z0-9][a-z0-9-]{0,39})$/;
export type LuxAvatar = (typeof LUX_AVATARS)[number] | `glb:${string}`;

/** true si el avatar es un modelo GLB con un id que existe. */
export function isModelAvatar(avatar: unknown): avatar is `glb:${string}` {
  if (typeof avatar !== 'string') return false;
  const match = MODEL_AVATAR.exec(avatar);
  return match !== null && (LUX_MODEL_AVATAR_IDS as readonly string[]).includes(match[1]);
}

/** Avatares que el administrador puede elegir: los de dibujo y los modelos GLB. */
export const LUX_AVATAR_CHOICES: string[] = [...LUX_AVATARS, ...LUX_MODEL_AVATAR_IDS.map((id) => `glb:${id}`)];

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
  /** Cuenta dueña del personaje. Null = visible para todas las cuentas. Con dueño, solo ella lo ve y lo usa. */
  ownerProfileId: string | null;
  /**
   * Clave del archivo del modelo en el bucket privado (solo el servidor la conoce).
   * Nunca sale en las respuestas: characterView() la quita.
   */
  modelKey: string | null;
}

/** Lo que el administrador escribe para crear o editar un personaje. */
export interface LuxCharacterInput {
  name: string;
  avatar: LuxAvatar;
  color: string;
  gestures: LuxGestureId[];
  model: string | null;
  /** Cuenta dueña (null = para todas). Solo la fija el administrador. */
  ownerProfileId: string | null;
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
  ownerProfileId: null,
  modelKey: null,
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
  const knownAvatar = (LUX_AVATARS as readonly unknown[]).includes(avatar) || isModelAvatar(avatar);
  if (!knownAvatar) return { ok: false, field: 'avatar', message: 'Ese avatar no existe.' };

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

  let ownerProfileId: string | null = null;
  if (input.ownerProfileId !== undefined && input.ownerProfileId !== null && input.ownerProfileId !== '') {
    if (typeof input.ownerProfileId !== 'string' || !UUID.test(input.ownerProfileId)) {
      return { ok: false, field: 'owner', message: 'La cuenta dueña no es válida.' };
    }
    ownerProfileId = input.ownerProfileId.toLowerCase();
  }
  // Un modelo GLB es de una cuenta: sin dueño no se puede asignar a nadie.
  if (isModelAvatar(avatar) && ownerProfileId === null) {
    return { ok: false, field: 'owner', message: 'Un personaje con modelo propio tiene que tener una cuenta dueña.' };
  }

  return {
    ok: true,
    value: {
      name,
      avatar: avatar as LuxAvatar,
      color: color.toLowerCase(),
      gestures: [...new Set(gestures as LuxGestureId[])],
      model,
      ownerProfileId,
    },
  };
}

/**
 * Personajes que una cuenta puede ver y usar: los sin dueño y los suyos. Un personaje
 * de otra cuenta no aparece ni se puede asignar, y su modelo nunca se sirve.
 */
export function visibleCharacters(list: LuxCharacter[], profileId: string | null | undefined): LuxCharacter[] {
  return list.filter((character) => !character.ownerProfileId || character.ownerProfileId === profileId);
}

/** Quita lo que no debe salir del servidor (la clave del modelo). */
export function characterView(character: LuxCharacter): Omit<LuxCharacter, 'modelKey'> {
  const { modelKey: _hidden, ...view } = character;
  return view;
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
