/**
 * src/lib/recorrido.ts
 *
 * Lógica pura de la bienvenida de streamers: el orden de los pasos según el
 * camino elegido (empezar con Twitch o con el código de invitación), qué paso
 * toca, qué le falta a un perfil y el estado de las tres primeras tareas.
 * No toca la red ni el navegador, para poder probarla.
 */

import narracion from './recorridoNarracion.json';

export type Camino = 'tw' | 'co';
export type PasoId = 'entrar' | 'permisos' | 'datos' | 'codigo' | 'canal' | 'bienvenida' | 'panel';

/** Mismos pasos en los dos caminos; solo cambia cuál va primero. */
export const ORDEN: Record<Camino, PasoId[]> = {
  tw: ['entrar', 'permisos', 'datos', 'codigo', 'canal', 'bienvenida', 'panel'],
  co: ['entrar', 'codigo', 'permisos', 'datos', 'canal', 'bienvenida', 'panel'],
};

export const ETIQUETA: Record<PasoId, string> = {
  entrar: 'Entrar',
  permisos: 'Conectar Twitch',
  datos: 'Lo que tomamos',
  codigo: 'Código de invitación',
  canal: 'Tu canal',
  bienvenida: 'Bienvenida',
  panel: 'Tu panel',
};

/** Pasos que tienen explicación de Teemo. */
export type PasoNarrado = keyof typeof narracion;

/** Lo que dice Teemo en cada paso. El mismo texto se usa para generar los audios. */
export const NARRACION: Record<PasoNarrado, string> = narracion;

export const esCamino = (value: unknown): value is Camino => value === 'tw' || value === 'co';

/** Pasos que se enseñan en la lista de progreso (el panel no es un paso más). */
export function pasosVisibles(camino: Camino): PasoId[] {
  return ORDEN[camino].filter((paso) => paso !== 'panel');
}

export function pasoSiguiente(camino: Camino, paso: PasoId): PasoId | null {
  const orden = ORDEN[camino];
  const i = orden.indexOf(paso);
  return i >= 0 && i < orden.length - 1 ? orden[i + 1] : null;
}

export function pasoAnterior(camino: Camino, paso: PasoId): PasoId | null {
  const orden = ORDEN[camino];
  const i = orden.indexOf(paso);
  return i > 0 ? orden[i - 1] : null;
}

export type EstadoPaso = 'hecho' | 'actual' | 'pendiente';

export function estadoPaso(camino: Camino, actual: PasoId, paso: PasoId): EstadoPaso {
  const orden = ORDEN[camino];
  const a = orden.indexOf(actual);
  const p = orden.indexOf(paso);
  if (p === a) return 'actual';
  return p < a ? 'hecho' : 'pendiente';
}

// ---------- Qué le falta a un perfil ----------

export interface PerfilRecorrido {
  role: 'streamer' | 'admin';
  status: 'pending' | 'active' | 'suspended';
  onboarded_at?: string | null;
}

/**
 * ¿Hay que enseñar la bienvenida? Solo a streamers que entraron con Twitch, sin
 * suspender y que aún no la terminaron. `hechaAqui` es el recuerdo de este
 * navegador, para cuando la cuenta no pudo guardarlo.
 */
export function necesitaRecorrido(perfil: PerfilRecorrido | null, conTwitch: boolean, hechaAqui: boolean): boolean {
  if (!perfil || !conTwitch) return false;
  if (perfil.role === 'admin' || perfil.status === 'suspended') return false;
  if (perfil.status === 'pending') return true;
  return !perfil.onboarded_at && !hechaAqui;
}

export interface AvanceConSesion {
  /** La cuenta ya está activa: el código de invitación ya se canjeó. */
  activo: boolean;
  /** El streamer ya confirmó que los datos de Twitch son los suyos. */
  datosConfirmados: boolean;
  /** Ya guardó o saltó la configuración del canal. */
  canalListo: boolean;
}

/** Pasos que quedan por hacer una vez que existe la sesión de Twitch, en el orden del camino. */
export function pasosPendientes(camino: Camino, avance: AvanceConSesion): PasoId[] {
  return ORDEN[camino].filter((paso) => {
    if (paso === 'entrar' || paso === 'permisos' || paso === 'panel') return false;
    if (paso === 'codigo') return !avance.activo;
    if (paso === 'datos') return !avance.datosConfirmados;
    if (paso === 'canal') return !avance.canalListo;
    return true;
  });
}

/** Paso que toca con la sesión ya abierta. Siempre hay uno: la bienvenida es el último. */
export function pasoConSesion(camino: Camino, avance: AvanceConSesion): PasoId {
  return pasosPendientes(camino, avance)[0] ?? 'bienvenida';
}

// ---------- Plan ----------

export interface LimitesPlan {
  storage_limit_bytes: number;
  max_file_bytes: number;
  max_files: number;
}

const MB = 1024 * 1024;
const enMegas = (bytes: number) => {
  const mb = bytes / MB;
  return mb >= 1024
    ? `${(mb / 1024).toLocaleString('es', { maximumFractionDigits: 2 })} GB`
    : `${mb.toLocaleString('es', { maximumFractionDigits: 1 })} MB`;
};

/** Los límites del plan escritos para leer. */
export function lineasDelPlan(limites: LimitesPlan): string[] {
  return [
    `${enMegas(limites.storage_limit_bytes)} para tus archivos`,
    `${enMegas(limites.max_file_bytes)} por archivo`,
    `${limites.max_files} ${limites.max_files === 1 ? 'archivo' : 'archivos'}`,
  ];
}

// ---------- Primeros pasos ----------

export type TareaId = 'obs' | 'voz' | 'alertas';
export type EstadoTarea = 'hecha' | 'quitada';
export type EstadoTareas = Partial<Record<TareaId, EstadoTarea>>;

export const TAREAS: { id: TareaId; titulo: string; texto: string; accion: string }[] = [
  { id: 'obs', titulo: 'Copia tu fuente de OBS', texto: 'Una sola URL con todas las capas.', accion: 'Copiar' },
  { id: 'voz', titulo: 'Prueba la voz', texto: 'Escucha un mensaje de prueba con la voz de tu canal.', accion: 'Probar' },
  {
    id: 'alertas',
    titulo: 'Activa tus alertas',
    texto: 'Avisos de seguidores, suscripciones, bits y raids. Lo que suena con cada uno se elige en Alertas.',
    accion: 'Activar',
  },
];

/** Clave de este navegador donde se guardan las tareas de una cuenta. */
export const claveTareas = (perfilId: string) => `lalo_primeros_pasos_${perfilId}`;
/** Clave de este navegador que recuerda la bienvenida terminada si la cuenta no pudo guardarlo. */
export const claveBienvenida = (perfilId: string) => `lalo_bienvenida_hecha_${perfilId}`;

/** Lee el estado guardado. Lo que no se reconoce se ignora. */
export function leerTareas(raw: string | null | undefined): EstadoTareas {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const estado: EstadoTareas = {};
    for (const { id } of TAREAS) {
      const value = (parsed as Record<string, unknown>)[id];
      if (value === 'hecha' || value === 'quitada') estado[id] = value;
    }
    return estado;
  } catch {
    return {};
  }
}

export function marcarTarea(estado: EstadoTareas, id: TareaId, valor: EstadoTarea): EstadoTareas {
  // Una tarea hecha no vuelve a «quitada»
  if (estado[id] === 'hecha') return estado;
  return { ...estado, [id]: valor };
}

/** Tareas que siguen a la vista: ni hechas ni quitadas. */
export function tareasPendientes(estado: EstadoTareas): TareaId[] {
  return TAREAS.filter((tarea) => !estado[tarea.id]).map((tarea) => tarea.id);
}

/** El módulo «Primeros pasos» se enseña mientras quede alguna tarea a la vista. */
export function hayPrimerosPasos(estado: EstadoTareas): boolean {
  return tareasPendientes(estado).length > 0;
}
