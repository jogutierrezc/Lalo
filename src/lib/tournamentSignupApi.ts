/**
 * src/lib/tournamentSignupApi.ts
 *
 * Llamadas del navegador para la inscripción por enlace de «Torneos»
 * (supabase/migrations/0017_tournament_cloud.sql):
 *
 * - Sin sesión (la página pública `#torneo/<slug>`): lo público de un torneo
 *   y el envío de una inscripción, por las funciones tournament_public y
 *   tournament_register.
 * - Con la sesión del streamer (la pestaña «Torneo» del panel): su fila de
 *   `tournaments` (el enlace y lo que publica) y las solicitudes de
 *   `tournament_entries`. La RLS solo le deja las suyas.
 *
 * Ninguna función lanza errores: devuelven qué pasó para que la página lo
 * explique. Todo lo que llega pasa por utils/tournamentSignup.ts.
 *
 * SIN PROBAR contra Supabase real: la migración 0017 no se ha ejecutado.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './supabase';
import {
  type EntryStatus,
  type PublicTournament,
  type RegisterCode,
  type SignupForm,
  type TournamentEntry,
  type TournamentRow,
  SLUG_RE,
  normalizeEntries,
  normalizePublicTournament,
  registerCodeOf,
} from '../utils/tournamentSignup';

// ---------- Página pública ----------

export type PublicResult =
  | { kind: 'ok'; tournament: PublicTournament }
  | { kind: 'not_found' }
  /** Este despliegue no tiene la nube configurada. */
  | { kind: 'no_cloud' }
  | { kind: 'error' };

/** Lo público de un torneo por su slug. */
export async function fetchPublicTournament(slug: string, client: SupabaseClient | null = supabase): Promise<PublicResult> {
  if (!client) return { kind: 'no_cloud' };
  if (!SLUG_RE.test(slug)) return { kind: 'not_found' };
  try {
    const { data, error } = await client.rpc('tournament_public', { p_slug: slug });
    if (error) return { kind: 'error' };
    const tournament = normalizePublicTournament(data);
    return tournament ? { kind: 'ok', tournament } : { kind: 'not_found' };
  } catch {
    return { kind: 'error' };
  }
}

/** Envía una inscripción ya revisada (validateSignup). Devuelve el código de la respuesta. */
export async function registerTeam(slug: string, form: SignupForm, client: SupabaseClient | null = supabase): Promise<RegisterCode> {
  if (!client) return 'error';
  try {
    const { data, error } = await client.rpc('tournament_register', {
      p_slug: slug,
      p_team: form.team,
      p_captain: form.captain,
      p_players: form.players,
    });
    return error ? 'error' : registerCodeOf(data);
  } catch {
    return 'error';
  }
}

// ---------- Panel: el enlace ----------

export interface OwnTournament {
  slug: string;
  open: boolean;
}

/** El enlace del streamer, o null si aún no lo ha creado. `ok: false`: no se pudo preguntar. */
export async function loadOwnTournament(profileId: string, client: SupabaseClient | null = supabase): Promise<{ ok: true; own: OwnTournament | null } | { ok: false }> {
  if (!client) return { ok: false };
  const { data, error } = await client.from('tournaments').select('slug, signup_open').eq('profile_id', profileId).maybeSingle();
  if (error) return { ok: false };
  const row = data as { slug?: unknown; signup_open?: unknown } | null;
  return { ok: true, own: row && typeof row.slug === 'string' ? { slug: row.slug, open: row.signup_open === true } : null };
}

/** Código de PostgreSQL para «ya existe una fila con esa clave»: aquí, el slug de otro streamer. */
const UNIQUE_VIOLATION = '23505';

/** Crea o actualiza lo que el streamer publica. `taken`: ese slug ya es de otro torneo. */
export async function saveOwnTournament(profileId: string, row: TournamentRow, client: SupabaseClient | null = supabase): Promise<'ok' | 'taken' | 'error'> {
  if (!client) return 'error';
  const { error } = await client.from('tournaments').upsert({ profile_id: profileId, ...row }, { onConflict: 'profile_id' });
  if (!error) return 'ok';
  return error.code === UNIQUE_VIOLATION ? 'taken' : 'error';
}

/** Borra el enlace y, con él, todas sus inscripciones (la base las borra en cascada). */
export async function deleteOwnTournament(profileId: string, client: SupabaseClient | null = supabase): Promise<boolean> {
  if (!client) return false;
  const { error } = await client.from('tournaments').delete().eq('profile_id', profileId);
  return !error;
}

// ---------- Panel: las solicitudes ----------

/** Las inscripciones del streamer, las más antiguas primero. null si no se pudo preguntar. */
export async function listEntries(profileId: string, client: SupabaseClient | null = supabase): Promise<TournamentEntry[] | null> {
  if (!client) return null;
  const { data, error } = await client
    .from('tournament_entries')
    .select('id, team, captain, players, status, created_at')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: true })
    .limit(200);
  return error ? null : normalizeEntries(data);
}

export async function setEntryStatus(id: number, status: EntryStatus, client: SupabaseClient | null = supabase): Promise<boolean> {
  if (!client) return false;
  const { error } = await client.from('tournament_entries').update({ status }).eq('id', id);
  return !error;
}

export async function deleteEntry(id: number, client: SupabaseClient | null = supabase): Promise<boolean> {
  if (!client) return false;
  const { error } = await client.from('tournament_entries').delete().eq('id', id);
  return !error;
}
