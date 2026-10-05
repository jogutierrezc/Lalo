/**
 * src/legal/index.ts
 *
 * Los documentos legales, en el orden en que se enseñan. Cambiar un texto es
 * cambiar su archivo y subir su `version` y su `updatedAt`: al subir la versión,
 * la app vuelve a pedir la aceptación y dice qué documento cambió.
 */

import { CONTENIDO } from './contenido';
import { PAISES } from './paises';
import { PRIVACIDAD } from './privacidad';
import { RETIRADA } from './retirada';
import { RIOT } from './riot';
import { TERMINOS } from './terminos';
import { VOCES } from './voces';
import type { VersionActual } from './logica';
import type { DocId, DocumentoLegal } from './tipos';

export const DOCUMENTOS: readonly DocumentoLegal[] = [TERMINOS, VOCES, CONTENIDO, RETIRADA, PRIVACIDAD, PAISES, RIOT];

/** Los que acepta toda cuenta al entrar. Los de `alUsar` se aceptan aparte, al usar su función. */
const GENERALES = DOCUMENTOS.filter((doc) => !doc.alUsar);

export const VERSIONES_ACTUALES: readonly VersionActual[] = GENERALES.map(({ id, version }) => ({ id, version }));

export function documento(id: DocId): DocumentoLegal {
  return DOCUMENTOS.find((doc) => doc.id === id) ?? DOCUMENTOS[0];
}

export const tituloDocumento = (id: DocId): string => documento(id).titulo;

/** Lo que se envía a la nube al aceptar: la versión vigente de cada documento de la aceptación general. */
export function versionesVigentes(): Partial<Record<DocId, string>> {
  return Object.fromEntries(GENERALES.map(({ id, version }) => [id, version]));
}
