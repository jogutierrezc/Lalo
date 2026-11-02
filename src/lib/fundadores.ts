/**
 * src/lib/fundadores.ts
 *
 * Lógica pura de la bienvenida de Tally Studio y de los Creadores Fundadores:
 * quién es fundador, qué variante de la bienvenida toca (cuenta nueva o
 * fundador), cuándo ya se vio, cómo se numera el emblema, los meses del regalo
 * y el estado del botón «Activar mi regalo». Los textos editables (Done,
 * Integraciones, etc.) también viven aquí como constantes.
 * No toca la red ni React, para poder probarla. Solo lee y escribe localStorage
 * y sessionStorage dentro de try/catch, como src/lib/recorrido.ts.
 */

export type VarianteBienvenida = 'nueva' | 'fundador';

// ---------- Regalo ----------

/**
 * Valores de respaldo del regalo cuando la nube no responde (migración 0052
 * sin aplicar). La fuente de verdad es la tabla public.founder_settings, que
 * edita el administrador con admin_set_founder_gift(plan, meses).
 */
export const REGALO_POR_DEFECTO = {
  planId: 'creadores-iniciales',
  planNombre: 'Creadores Iniciales',
  meses: 1,
} as const;

export interface ConfigRegalo {
  planId: string;
  planNombre: string;
  meses: number;
}

/** Lee la respuesta de founder_gift_config(). Lo que no se reconoce cae en los valores de respaldo. */
export function leerConfigRegalo(raw: unknown): ConfigRegalo {
  const base: ConfigRegalo = { ...REGALO_POR_DEFECTO };
  if (typeof raw !== 'object' || raw === null) return base;
  const r = raw as Record<string, unknown>;
  const meses = typeof r.months === 'number' && Number.isInteger(r.months) && r.months >= 1 && r.months <= 36 ? r.months : base.meses;
  const planId = typeof r.plan_id === 'string' && r.plan_id ? r.plan_id : base.planId;
  const planNombre = typeof r.plan_name === 'string' && r.plan_name ? r.plan_name : base.planNombre;
  return { planId, planNombre, meses };
}

/** «1 mes», «3 meses». */
export const textoMeses = (meses: number): string => `${meses} ${meses === 1 ? 'mes' : 'meses'}`;

/** Fecha en que vence el regalo si se activa en `desde`. Si el día no existe en el mes destino, queda el último. */
export function fechaVencimiento(desde: Date, meses: number): Date {
  const out = new Date(desde.getTime());
  const dia = out.getDate();
  out.setDate(1);
  out.setMonth(out.getMonth() + meses);
  const ultimo = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
  out.setDate(Math.min(dia, ultimo));
  return out;
}

export function fechaCorta(fecha: Date): string {
  return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long' }).format(fecha);
}

/** Lo que devuelve claim_founder_gift(); `null` si la función no existe o falló. */
export type ResultadoRegalo = 'ok' | 'already_claimed' | 'not_founder' | 'has_plan' | 'not_active' | null;

export type EstadoRegalo =
  | 'oculto' // no es fundador: no hay regalo
  | 'disponible'
  | 'activando'
  | 'activado'
  | 'tiene-plan' // ya tiene un plan de pago o asignado: no se pisa
  | 'pendiente-admin'; // la función de la nube aún no existe en este entorno

export function estadoDesdeResultado(resultado: unknown): EstadoRegalo {
  switch (resultado) {
    case 'ok':
    case 'already_claimed':
      return 'activado';
    case 'has_plan':
      return 'tiene-plan';
    case 'not_founder':
    case 'not_active':
      return 'oculto';
    default:
      return 'pendiente-admin';
  }
}

/** Estado inicial del regalo según lo que ya dice el perfil. */
export function estadoInicialRegalo(perfil: PerfilFundador | null): EstadoRegalo {
  if (!esFundador(perfil)) return 'oculto';
  return perfil?.founder_gift_claimed_at ? 'activado' : 'disponible';
}

/** Texto del botón y del aviso de cada estado del regalo. */
export function textoRegalo(estado: EstadoRegalo): { boton: string; aviso: string | null; habilitado: boolean } {
  switch (estado) {
    case 'disponible':
      return { boton: 'Activar mi regalo', aviso: null, habilitado: true };
    case 'activando':
      return { boton: 'Activando', aviso: null, habilitado: false };
    case 'activado':
      return { boton: 'Regalo activado', aviso: 'Tu plan ya está activo. Lo verás en Mi cuenta.', habilitado: false };
    case 'tiene-plan':
      return {
        boton: 'Ya tienes un plan',
        aviso: 'Tu cuenta ya tiene un plan vigente y no lo cambiamos. Escribe a quien administra si quieres usar el regalo.',
        habilitado: false,
      };
    case 'pendiente-admin':
      return {
        boton: 'Pendiente de activar por el administrador',
        aviso: 'El regalo aún no se puede activar desde aquí. Quien administra lo activará y te avisará.',
        habilitado: false,
      };
    default:
      return { boton: '', aviso: null, habilitado: false };
  }
}

// ---------- Fundador ----------

/** Lo que la lógica necesita del perfil. Los campos de la 0052 faltan mientras no se aplique. */
export interface PerfilFundador {
  role?: 'streamer' | 'admin';
  status?: 'pending' | 'active' | 'suspended';
  founder_number?: number | null;
  welcome_seen_at?: string | null;
  founder_gift_claimed_at?: string | null;
}

export function numeroFundador(perfil: PerfilFundador | null | undefined): number | null {
  const n = perfil?.founder_number;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
}

export const esFundador = (perfil: PerfilFundador | null | undefined): boolean => numeroFundador(perfil) !== null;

/** «014». */
export const numeroConCeros = (n: number): string => String(n).padStart(3, '0');

/** «Nº 014». */
export const etiquetaNumero = (n: number): string => `Nº ${numeroConCeros(n)}`;

/** «Creador Fundador Nº 014». */
export const nombreEmblema = (n: number): string => `Creador Fundador ${etiquetaNumero(n)}`;

// ---------- Qué variante mostrar ----------

export const claveBienvenidaVista = (perfilId: string) => `tally_bienvenida_vista_${perfilId}`;
export const clavePendienteNueva = (perfilId: string) => `tally_bienvenida_pendiente_${perfilId}`;

export function bienvenidaVistaAqui(perfilId: string): boolean {
  try {
    return localStorage.getItem(claveBienvenidaVista(perfilId)) === '1';
  } catch {
    return false;
  }
}

export function recordarBienvenidaVista(perfilId: string): void {
  try {
    localStorage.setItem(claveBienvenidaVista(perfilId), '1');
  } catch {
    // Sin almacenamiento: vale para esta visita
  }
  try {
    sessionStorage.removeItem(clavePendienteNueva(perfilId));
  } catch {
    // Sin almacenamiento de sesión
  }
}

/** La llama Bienvenida.tsx al terminar el recorrido: la cuenta nueva verá la bienvenida de la app. */
export function pedirBienvenidaNueva(perfilId: string): void {
  try {
    sessionStorage.setItem(clavePendienteNueva(perfilId), '1');
  } catch {
    // Sin almacenamiento de sesión: la bienvenida de la app no sale esta vez
  }
}

export function bienvenidaNuevaPendiente(perfilId: string): boolean {
  try {
    return sessionStorage.getItem(clavePendienteNueva(perfilId)) === '1';
  } catch {
    return false;
  }
}

export interface ContextoBienvenida {
  perfil: PerfilFundador | null;
  /** La cuenta o este navegador ya recuerdan haberla visto. */
  vista: boolean;
  /** El recorrido de Bienvenida.tsx terminó en esta pestaña. */
  recorridoRecienTerminado: boolean;
  /** El creador pulsó «Ver bienvenida» en el panel. */
  repeticion: boolean;
}

/**
 * Qué variante toca enseñar ahora, o null si ninguna.
 *  - Repetición pedida a mano: la de su cuenta (fundador o nueva), siempre.
 *  - Fundador que aún no la vio: variante «fundador», una sola vez por cuenta.
 *  - Cuenta nueva: «nueva» solo al terminar el recorrido, una sola vez.
 * Administradores y cuentas no activas nunca la ven.
 */
export function varianteAMostrar(ctx: ContextoBienvenida): VarianteBienvenida | null {
  const { perfil } = ctx;
  if (!perfil || perfil.role === 'admin' || perfil.status !== 'active') return null;
  const propia: VarianteBienvenida = esFundador(perfil) ? 'fundador' : 'nueva';
  if (ctx.repeticion) return propia;
  const yaVista = ctx.vista || Boolean(perfil.welcome_seen_at);
  if (yaVista) return null;
  if (propia === 'fundador') return 'fundador';
  return ctx.recorridoRecienTerminado ? 'nueva' : null;
}

// ---------- Demostración por URL ----------

export interface Demo {
  variante: VarianteBienvenida;
  nombre: string;
  numero: number;
  meses: number;
}

/**
 * `?bienvenida=fundador|nueva` (también dentro del hash) fuerza la bienvenida con
 * datos de muestra, sin guardar nada. Opcionales: `nombre`, `n` y `meses`.
 */
export function leerDemo(search: string, hash = ''): Demo | null {
  const trozos = [search, hash.includes('?') ? hash.slice(hash.indexOf('?')) : ''];
  for (const trozo of trozos) {
    if (!trozo) continue;
    const params = new URLSearchParams(trozo.startsWith('?') ? trozo.slice(1) : trozo);
    const variante = params.get('bienvenida');
    if (variante !== 'fundador' && variante !== 'nueva') continue;
    const n = Number(params.get('n'));
    const meses = Number(params.get('meses'));
    return {
      variante,
      nombre: (params.get('nombre') || 'Gaby').slice(0, 24),
      numero: Number.isInteger(n) && n > 0 ? n : 14,
      meses: Number.isInteger(meses) && meses >= 1 && meses <= 36 ? meses : REGALO_POR_DEFECTO.meses,
    };
  }
  return null;
}

// ---------- Escenas ----------

export type EscenaId = 'standby' | 'revelacion' | 'porque' | 'manifiesto' | 'saludo' | 'ventajas' | 'cierre';

/** Orden de las escenas de cada variante. La última («cierre») se queda hasta que el creador pulsa. */
export function escenasDe(variante: VarianteBienvenida): EscenaId[] {
  return variante === 'fundador'
    ? ['standby', 'revelacion', 'porque', 'manifiesto', 'saludo', 'ventajas', 'cierre']
    : ['saludo', 'ventajas', 'cierre'];
}

/** Segundos en que empieza cada escena (guion de los artifacts aprobados) y, en `fin`, cuándo llega al cierre. */
export const INICIO_ESCENAS: Record<EscenaId, number> = {
  standby: 0,
  revelacion: 2.5,
  porque: 6.8,
  manifiesto: 11,
  saludo: 16,
  ventajas: 20.4,
  cierre: 25,
};
/** Duración de las escenas propias de la bienvenida (saludo, ventajas) en segundos. */
export const DURACION = { saludo: 4.4, ventajas: 4.6 } as const;

/** Segundos de inicio de cada escena de una variante. La cuenta nueva empieza directamente en el saludo. */
export function inicios(variante: VarianteBienvenida): Partial<Record<EscenaId, number>> {
  const orden = escenasDe(variante);
  if (variante === 'fundador') return Object.fromEntries(orden.map((id) => [id, INICIO_ESCENAS[id]]));
  const saludo = 0;
  const ventajas = saludo + DURACION.saludo;
  return { saludo, ventajas, cierre: ventajas + DURACION.ventajas };
}

// ---------- Textos editables ----------
// El usuario aún debe confirmar qué hace Done y el alcance de las integraciones:
// cambia solo estas constantes, no el diseño.

export const TEXTOS = {
  marca: 'Tally Studio',
  eslogan: 'Professional tools for rising creators',
  esloganEs: 'Herramientas profesionales para creadores en crecimiento.',
  ventajas: {
    titulo: 'Un estudio completo para tu canal.',
    voz: {
      titulo: 'Voz con TTS',
      texto: 'Tu chat habla con voces clonadas por IA y con emociones, directo en tu stream.',
    },
    done: {
      titulo: 'Done · Asistente del canal',
      // POR CONFIRMAR: descripción genérica del artifact; no añadir capacidades sin confirmar.
      texto: 'Un asistente que te acompaña en el directo y se encarga de lo repetitivo para que te dediques a crear.',
      etiqueta: 'Nuevo',
    },
    overlays: {
      titulo: 'Overlays y artifacts',
      texto: 'Más de 15 capas para OBS, como alertas, metas, ruleta, batallas y chat, en una sola fuente.',
    },
    integraciones: {
      titulo: 'Integraciones',
      // POR CONFIRMAR: alcance real de las integraciones.
      texto: 'Más conexiones para unir tu canal con las herramientas que ya usas.',
      etiqueta: 'Próximamente',
    },
  },
} as const;
