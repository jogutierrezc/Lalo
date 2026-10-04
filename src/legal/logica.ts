/**
 * src/legal/logica.ts
 *
 * Lógica pura de la parte legal: qué datos del operador faltan, a qué documento
 * apunta una dirección, qué documentos cambiaron respecto a lo que una cuenta
 * aceptó y si hay que pedir la aceptación. No toca la red ni el navegador.
 */

import type { DatosLegales } from './datos';
import { DOC_IDS, type DocId } from './tipos';

// ---------- Datos que faltan ----------

/** Lo que el dueño aún no ha dado, escrito para leer. Vacío: no falta nada. */
export function datosFaltantes(datos: DatosLegales): string[] {
  const faltan: string[] = [];
  if (!datos.correoLegal.trim()) faltan.push('Correo de contacto para avisos legales y datos personales');
  if (datos.edadMinima === null || !Number.isFinite(datos.edadMinima) || datos.edadMinima <= 0) {
    faltan.push('Edad mínima para usar el servicio');
  }
  if (!datos.direccionPostal.trim()) faltan.push('Dirección para notificaciones');
  return faltan;
}

// ---------- Direcciones ----------

export interface RutaLegal {
  doc: DocId;
  /** Ancla dentro del documento, si la dirección la trae. */
  seccion: string | null;
}

const esDocId = (value: string): value is DocId => (DOC_IDS as readonly string[]).includes(value);

/**
 * Lee #legal, #legal/voces o #legal/paises/mexico. Devuelve null si la dirección
 * no es de la página legal. Un documento desconocido lleva al primero.
 */
export function parseRutaLegal(hash: string): RutaLegal | null {
  const limpio = hash.trim().toLowerCase().replace(/^#\/?/, '').replace(/\/+$/, '');
  const [raiz, doc = '', ...resto] = limpio.split('?')[0].split('/');
  if (raiz !== 'legal') return null;
  if (!esDocId(doc)) return { doc: DOC_IDS[0], seccion: null };
  const seccion = resto.join('/').replace(/[^a-z0-9-]/g, '');
  return { doc, seccion: seccion || null };
}

export function hrefLegal(doc?: DocId, seccion?: string): string {
  if (!doc) return '#legal';
  return seccion ? `#legal/${doc}/${seccion}` : `#legal/${doc}`;
}

// ---------- Texto con marcas ----------

export type Trozo =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'negrita'; texto: string }
  | { tipo: 'enlace'; texto: string; href: string; externo: boolean };

const MARCA = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Parte un texto en trozos: texto llano, negrita y enlaces. Un destino que no se reconoce queda como texto. */
export function partirTexto(texto: string): Trozo[] {
  const trozos: Trozo[] = [];
  let desde = 0;
  for (const hallado of texto.matchAll(MARCA)) {
    const inicio = hallado.index ?? 0;
    if (inicio > desde) trozos.push({ tipo: 'texto', texto: texto.slice(desde, inicio) });
    desde = inicio + hallado[0].length;
    if (hallado[1] !== undefined) {
      trozos.push({ tipo: 'negrita', texto: hallado[1] });
      continue;
    }
    const etiqueta = hallado[2];
    const destino = hallado[3];
    if (destino.startsWith('legal:')) {
      const [doc, seccion] = destino.slice('legal:'.length).split('/');
      if (esDocId(doc)) {
        trozos.push({ tipo: 'enlace', texto: etiqueta, href: hrefLegal(doc, seccion), externo: false });
        continue;
      }
    } else if (/^https:\/\//.test(destino) || destino.startsWith('mailto:')) {
      trozos.push({ tipo: 'enlace', texto: etiqueta, href: destino, externo: destino.startsWith('https://') });
      continue;
    }
    trozos.push({ tipo: 'texto', texto: etiqueta });
  }
  if (desde < texto.length) trozos.push({ tipo: 'texto', texto: texto.slice(desde) });
  return trozos;
}

// ---------- Versiones y aceptación ----------

/** Versión aceptada de cada documento. Un documento que falta nunca se aceptó. */
export type VersionesAceptadas = Partial<Record<DocId, string>>;

/** Compara «1.2» con «1.10» por números. Negativo si a es anterior a b. Lo que no es número cuenta como 0. */
export function compararVersiones(a: string, b: string): number {
  const partes = (version: string) => version.split('.').map((parte) => Number.parseInt(parte, 10) || 0);
  const pa = partes(a);
  const pb = partes(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diferencia = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diferencia !== 0) return diferencia;
  }
  return 0;
}

export interface VersionActual {
  id: DocId;
  version: string;
}

/**
 * Documentos cuya versión vigente es posterior a la que la cuenta aceptó, o que
 * nunca aceptó. En el orden de `actuales`.
 */
export function documentosPendientes(aceptadas: VersionesAceptadas, actuales: readonly VersionActual[]): DocId[] {
  return actuales
    .filter(({ id, version }) => {
      const aceptada = aceptadas[id];
      return !aceptada || compararVersiones(aceptada, version) < 0;
    })
    .map(({ id }) => id);
}

/** ¿La cuenta aceptó algo alguna vez? Distingue la primera aceptación de una renovación. */
export function aceptoAlgunaVez(aceptadas: VersionesAceptadas): boolean {
  return Object.values(aceptadas).some(Boolean);
}

/** Fila de la tabla terms_acceptances (migración 0008), con lo que aquí hace falta. */
export interface FilaAceptacion {
  document: string;
  version: string;
  accepted_at: string;
}

/** La versión más alta aceptada de cada documento conocido. Lo demás se ignora. */
export function versionesDeFilas(filas: readonly FilaAceptacion[]): VersionesAceptadas {
  const aceptadas: VersionesAceptadas = {};
  for (const fila of filas) {
    if (!esDocId(fila.document) || typeof fila.version !== 'string' || !fila.version) continue;
    const previa = aceptadas[fila.document];
    if (!previa || compararVersiones(previa, fila.version) < 0) aceptadas[fila.document] = fila.version;
  }
  return aceptadas;
}

export interface ResumenAceptacion {
  /** al-dia: aceptó todo lo vigente. anterior: aceptó versiones viejas. nunca: sin registro. */
  estado: 'al-dia' | 'anterior' | 'nunca';
  /** Fecha de la última aceptación registrada. */
  fecha: string | null;
}

/** Lo que se enseña al administrador sobre una cuenta. */
export function resumenAceptacion(filas: readonly FilaAceptacion[], actuales: readonly VersionActual[]): ResumenAceptacion {
  const validas = filas.filter((fila) => esDocId(fila.document));
  if (validas.length === 0) return { estado: 'nunca', fecha: null };
  const fecha = validas.reduce((ultima, fila) => (fila.accepted_at > ultima ? fila.accepted_at : ultima), validas[0].accepted_at);
  const pendientes = documentosPendientes(versionesDeFilas(validas), actuales);
  return { estado: pendientes.length === 0 ? 'al-dia' : 'anterior', fecha };
}

// ---------- Recuerdo en este navegador ----------

/** Clave de este navegador con lo aceptado por una cuenta, para cuando la nube no pudo guardarlo. */
export const claveAceptacion = (perfilId: string) => `lalo_terminos_aceptados_${perfilId}`;

/** Lee el recuerdo local. Lo que no se reconoce se ignora. */
export function leerAceptacionLocal(raw: string | null | undefined): VersionesAceptadas {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const aceptadas: VersionesAceptadas = {};
    for (const id of DOC_IDS) {
      const value = (parsed as Record<string, unknown>)[id];
      if (typeof value === 'string' && /^\d+(\.\d+)*$/.test(value)) aceptadas[id] = value;
    }
    return aceptadas;
  } catch {
    return {};
  }
}
