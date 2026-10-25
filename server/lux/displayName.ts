/**
 * server/lux/displayName.ts
 *
 * Nombre con el que la IA se presenta en el chat y ante el modelo. Lo define el
 * creador en su panel (chatName); si no lo define, vale la palabra de activación;
 * y si esa es la de por defecto («lux»), «MI AI». La IA no se llama «Lux» salvo
 * que el creador lo escriba a propósito.
 */

import { LUX_CHAT_WORD_DEFAULT } from './chatCommands.js';

export const LUX_NAME_LIMITS = { min: 1, max: 30 } as const;
/** Nombre de respaldo: ni nombre elegido ni palabra propia. */
export const LUX_NAME_FALLBACK = 'MI AI';

export type ChatNameCheck = { ok: true; name: string } | { ok: false; message: string };

/** Valida el nombre visible. Vacío vale: significa «usar la palabra de activación». */
export function validateChatName(raw: string): ChatNameCheck {
  // Sin saltos de línea ni caracteres de control: acaba en el chat y en el prompt.
  const name = raw.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (name.length > LUX_NAME_LIMITS.max) {
    return { ok: false, message: `El nombre admite hasta ${LUX_NAME_LIMITS.max} caracteres.` };
  }
  return { ok: true, name };
}

/** Nombre que se ve en el chat: el del creador, la palabra de activación, o «MI AI». */
export function luxDisplayName(chatName: string | null | undefined, chatWord: string | null | undefined): string {
  const named = typeof chatName === 'string' ? validateChatName(chatName) : null;
  if (named && named.ok && named.name) return named.name;
  const word = typeof chatWord === 'string' ? chatWord.trim() : '';
  if (word && word.toLowerCase() !== LUX_CHAT_WORD_DEFAULT) return word.charAt(0).toUpperCase() + word.slice(1);
  return LUX_NAME_FALLBACK;
}
