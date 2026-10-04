/**
 * src/lib/goalsCloud.ts
 *
 * Totales de las metas de bits tal como están en la nube.
 *
 * Con el canal de eventos de Twitch encendido, el servidor suma los Bits a las
 * metas directamente en la nube mientras el panel está abierto. Antes de editar
 * las metas, el panel trae esos totales para no guardar encima un número viejo.
 */

import { supabase } from './supabase';
import { countsBits, type GoalTotal } from '../utils/twitchEvents';

/** Totales actuales de las metas de bits de la cuenta abierta. null sin nube, sin sesión o si falla la lectura. */
export async function fetchCloudBitsGoalTotals(): Promise<GoalTotal[] | null> {
  if (!supabase) return null;
  try {
    const { data: auth } = await supabase.auth.getSession();
    const profileId = auth.session?.user.id;
    if (!profileId) return null;
    const { data, error } = await supabase.from('configs').select('data').eq('profile_id', profileId).eq('module', 'goals').maybeSingle();
    if (error || !data) return null;
    const goals = (data.data as { goals?: unknown } | null)?.goals;
    if (!Array.isArray(goals)) return null;
    return goals
      .filter((goal): goal is { id: string; type: string; current: number; enabled?: boolean; countBits?: boolean } =>
        typeof goal === 'object' && goal !== null && typeof goal.id === 'string' && typeof goal.current === 'number'
      )
      .filter(countsBits)
      .map((goal) => ({ id: goal.id, current: goal.current }));
  } catch {
    return null;
  }
}
