/**
 * src/lib/fundadoresApi.ts
 *
 * Llamadas a la nube de la bienvenida y del regalo de fundador (migración 0052).
 * Todas degradan sin romper nada: si la migración aún no está aplicada, las
 * funciones no existen y se devuelve el valor de respaldo.
 */

import { rpc } from './cloud';
import { supabase } from './supabase';
import { leerConfigRegalo, type ConfigRegalo, type ResultadoRegalo } from './fundadores';

/** Guarda en la cuenta que vio la bienvenida. true si se guardó; false si no (se recuerda en el navegador). */
export async function marcarBienvenidaVista(): Promise<boolean> {
  try {
    await rpc('mark_welcome_seen', {});
    return true;
  } catch {
    return false;
  }
}

/** Plan y meses del regalo. Si la nube no responde, los valores de respaldo. */
export async function traerConfigRegalo(): Promise<ConfigRegalo> {
  try {
    return leerConfigRegalo(await rpc('founder_gift_config', {}));
  } catch {
    return leerConfigRegalo(null);
  }
}

/** Activa el regalo. null si la función no existe o falló (el botón queda «Pendiente de activar por el administrador»). */
export async function reclamarRegalo(): Promise<ResultadoRegalo> {
  try {
    const res = await rpc('claim_founder_gift', {});
    return res === 'ok' || res === 'already_claimed' || res === 'not_founder' || res === 'has_plan' || res === 'not_active' ? res : null;
  } catch {
    return null;
  }
}

/**
 * Número de fundador de cada cuenta (solo lo lee un administrador con la lista completa).
 * Va en una consulta aparte: si la 0052 no está aplicada, la columna no existe y se
 * devuelve un mapa vacío sin afectar al resto del listado.
 */
export async function traerNumerosFundador(): Promise<Map<string, number>> {
  const numeros = new Map<string, number>();
  if (!supabase) return numeros;
  try {
    const { data, error } = await supabase.from('profiles').select('id, founder_number').not('founder_number', 'is', null);
    if (error || !data) return numeros;
    for (const fila of data as { id: string; founder_number: number | null }[]) {
      if (typeof fila.founder_number === 'number') numeros.set(fila.id, fila.founder_number);
    }
  } catch {
    // Sin la columna o sin red: sin insignias en el listado
  }
  return numeros;
}

/** El administrador cambia el plan y los meses del regalo. Lanza un Error legible si falla. */
export async function guardarConfigRegalo(planId: string, meses: number): Promise<void> {
  await rpc('admin_set_founder_gift', { p_plan: planId, p_months: meses });
}
