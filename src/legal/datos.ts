/**
 * src/legal/datos.ts
 *
 * Datos del operador que aparecen en los documentos legales. Es el único sitio
 * donde se escriben: los textos los leen de aquí.
 *
 * Lo que el dueño aún no haya decidido se deja VACÍO (cadena vacía o null),
 * nunca inventado. Mientras falte algo, la página legal enseña el aviso
 * «Borrador: faltan datos» y las frases afectadas se escriben sin ese dato.
 */

export interface DatosLegales {
  /** Razón social de quien opera la Plataforma. */
  operador: string;
  /** Correo para avisos legales y solicitudes sobre datos personales. */
  correoLegal: string;
  /** Edad mínima para usar el servicio. null: sin decidir. */
  edadMinima: number | null;
  /** Dirección para notificaciones. Vacía: los documentos no enseñan ni insinúan una dirección. */
  direccionPostal: string;
  /**
   * ¿Hay un agente designado y registrado ante la U.S. Copyright Office? Mientras
   * sea false, el apartado de Estados Unidos dice que no se invoca ese régimen.
   * No ponerlo en true hasta que el registro exista de verdad.
   */
  agenteDmcaRegistrado: boolean;
}

export const DATOS_LEGALES: DatosLegales = {
  operador: 'Legalify Colombia S.A.S.',
  correoLegal: 'jose.gutcont@gmail.com',
  // El dueño escribió «188»; se leyó como 18. Por confirmar con él.
  edadMinima: 18,
  // El dueño escribió «Bucaramanga, Colombia Carrera 26 35 170». El formato
  // «# 35-170» y el departamento «Santander» son una normalización por confirmar.
  direccionPostal: 'Carrera 26 # 35-170, Bucaramanga, Santander, Colombia',
  agenteDmcaRegistrado: false,
};

/** Todo lo publicado es un borrador hasta que lo revisen los abogados del dueño. */
export const ESTADO_LEGAL: 'borrador' | 'vigente' = 'borrador';
