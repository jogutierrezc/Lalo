/**
 * src/legal/tipos.ts
 *
 * Forma de los documentos legales. Cada documento vive en su propio archivo de
 * esta carpeta, con su versión y su fecha. El texto es una función de los datos
 * del operador (src/legal/datos.ts) para que las frases se escriban bien aunque
 * falte alguno.
 *
 * Marcas dentro del texto:
 *   **negrita**
 *   [texto](legal:documento) o [texto](legal:documento/seccion): enlace a otro documento
 *   [texto](https://...): enlace externo
 *   [texto](mailto:...): correo
 */

import type { DatosLegales } from './datos';

export const DOC_IDS = ['terminos', 'voces', 'contenido', 'retirada', 'privacidad', 'paises', 'riot'] as const;
export type DocId = (typeof DOC_IDS)[number];

export type Bloque =
  | { tipo: 'p'; texto: string }
  | { tipo: 'ul' | 'ol'; items: string[] }
  | { tipo: 'h3'; texto: string };

export interface Seccion {
  /** Sirve de ancla: #legal/<documento>/<id>. */
  id: string;
  /** null: texto de entrada, sin título. */
  titulo: string | null;
  bloques: Bloque[];
}

export interface DocumentoLegal {
  /** También es la dirección: #legal/<id>. */
  id: DocId;
  titulo: string;
  /**
   * Versión con números y puntos («1.0», «1.1», «2.0»). Subirla hace que la app
   * vuelva a pedir la aceptación a todas las cuentas.
   */
  version: string;
  /** Fecha del último cambio, AAAA-MM-DD. */
  updatedAt: string;
  /**
   * Documento que no entra en la aceptación general: solo lo acepta quien usa
   * una función concreta, en el momento de usarla. El texto dice cuándo.
   */
  alUsar?: string;
  secciones: (datos: DatosLegales) => Seccion[];
}

export const p = (texto: string): Bloque => ({ tipo: 'p', texto });
export const ul = (...items: string[]): Bloque => ({ tipo: 'ul', items });
export const ol = (...items: string[]): Bloque => ({ tipo: 'ol', items });
export const h3 = (texto: string): Bloque => ({ tipo: 'h3', texto });

/** «escribe a correo» o, si aún no hay correo, una frase que se lee bien sin él. */
export function fraseContacto(datos: DatosLegales, verbo = 'escribe'): string {
  return datos.correoLegal
    ? `${verbo} a [${datos.correoLegal}](mailto:${datos.correoLegal})`
    : 'usa el canal de contacto que se publicará en esta página antes de abrir el servicio';
}
