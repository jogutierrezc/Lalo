/**
 * src/lib/cloud.ts
 *
 * Operaciones de la nube de Lalo sobre Supabase: entrar con Twitch, canjear
 * códigos, consultar el uso y las acciones del portal de administración.
 * Todas fallan con un Error legible si la nube no está configurada.
 */

import { supabase } from './supabase';
import { adminSignInProblem, type AuthErrorLike } from './access';
import type {
  InviteCodeRow,
  InviteRedemptionRow,
  MediaFileRow,
  PlanRow,
  ProfileRow,
  ProfileUsageRow,
  RpcArgs,
  RpcResult,
  TermsAcceptanceRow,
} from './cloudTypes';

function client() {
  if (!supabase) throw new Error('La nube no está configurada en este despliegue.');
  return supabase;
}

export async function rpc<K extends keyof RpcArgs>(name: K, args: RpcArgs[K]): Promise<RpcResult[K]> {
  const { data, error } = await client().rpc(name, args as Record<string, unknown>);
  if (error) throw new Error(error.message);
  return data as RpcResult[K];
}

// ---------- Código pendiente ----------
// El código se escribe antes de ir a Twitch y se canjea al volver, ya con sesión.

export type PendingCode = { kind: 'invite' | 'recovery'; code: string };
const PENDING_KEY = 'lalo_pending_code';

export function setPendingCode(pending: PendingCode | null): void {
  try {
    if (pending) sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Sin almacenamiento de sesión: el código se pedirá de nuevo al volver
  }
}

export function getPendingCode(): PendingCode | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingCode;
    return parsed && (parsed.kind === 'invite' || parsed.kind === 'recovery') && parsed.code ? parsed : null;
  } catch {
    return null;
  }
}

// ---------- Sesión ----------

/**
 * Permisos que se piden a Twitch. Deben coincidir con lo que explica el paso
 * «Conectar Twitch» de la pantalla de acceso. Nombres comprobados en
 * https://dev.twitch.tv/docs/authentication/scopes/ (un nombre mal escrito
 * rompe la entrada).
 *   - moderator:read:followers: saber de los seguidores nuevos.
 *   - user:write:chat: enviar mensajes al chat.
 *   - channel:bot: que el bot entre en el chat del canal y escriba como bot.
 */
export const TWITCH_SCOPES = ['moderator:read:followers', 'user:write:chat', 'channel:bot'] as const;

export async function signInWithTwitch(): Promise<void> {
  const { error } = await client().auth.signInWithOAuth({
    provider: 'twitch',
    options: {
      redirectTo: `${window.location.origin}/`,
      scopes: TWITCH_SCOPES.join(' '),
    },
  });
  if (error) throw new Error(error.message);
}

/** Camino elegido en la bienvenida. Se recuerda mientras se va a Twitch y se vuelve. */
const CAMINO_KEY = 'lalo_recorrido_camino';

export function setCaminoElegido(camino: 'tw' | 'co'): void {
  try {
    sessionStorage.setItem(CAMINO_KEY, camino);
  } catch {
    // Sin almacenamiento de sesión: al volver se usa el camino de Twitch
  }
}

export function getCaminoElegido(): 'tw' | 'co' {
  try {
    return sessionStorage.getItem(CAMINO_KEY) === 'co' ? 'co' : 'tw';
  } catch {
    return 'tw';
  }
}

/**
 * Guarda en la cuenta que el streamer terminó la bienvenida. Devuelve null si
 * se guardó, o el motivo. Si la migración 0006 aún no está aplicada, la función
 * no existe en la base de datos y se devuelve el motivo sin romper nada.
 */
export async function completeOnboarding(): Promise<string | null> {
  try {
    await rpc('complete_onboarding', {});
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'error desconocido';
  }
}

// ---------- Aceptación de términos (migración 0008) ----------

/**
 * Lo que la cuenta ha aceptado, según la nube. Lanza un Error si no se pudo
 * leer; pasa, por ejemplo, si la migración 0008 aún no está aplicada.
 */
export async function fetchOwnAcceptances(profileId: string): Promise<TermsAcceptanceRow[]> {
  const { data, error } = await client().from('terms_acceptances').select('*').eq('profile_id', profileId);
  if (error) throw new Error(error.message);
  return (data as TermsAcceptanceRow[]) || [];
}

/** Registra en la cuenta que aceptó esas versiones. Devuelve null si se guardó, o el motivo. */
export async function acceptTerms(versions: Record<string, string>): Promise<string | null> {
  try {
    await rpc('accept_terms', { p_versions: versions });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'error desconocido';
  }
}

/** Aceptaciones de todas las cuentas. Solo las lee un administrador. */
export async function fetchAllAcceptances(): Promise<TermsAcceptanceRow[]> {
  const { data, error } = await client().from('terms_acceptances').select('*');
  if (error) throw new Error(error.message);
  return (data as TermsAcceptanceRow[]) || [];
}

/** Plan y límites de la cuenta que ha entrado. null si no se pudieron leer. */
export async function fetchOwnPlan(): Promise<{ name: string; limits: ProfileUsageRow } | null> {
  try {
    const [usage] = await rpc('profile_usage', {});
    if (!usage) return null;
    const { data } = await client().from('plans').select('name').eq('id', usage.plan_id ?? '').maybeSingle();
    return { name: (data as { name?: string } | null)?.name || usage.plan_id || 'Tu plan', limits: usage };
  } catch {
    return null;
  }
}

/**
 * Entrada del administrador con correo y clave (sin Twitch). Devuelve null si
 * entró, o el motivo en texto para mostrarlo.
 */
export async function signInAdmin(email: string, password: string): Promise<string | null> {
  try {
    const { error } = await client().auth.signInWithPassword({ email: email.trim(), password });
    return error ? adminSignInProblem(error) : null;
  } catch (err) {
    return adminSignInProblem(err instanceof Error ? { message: err.message, name: err.name } : {});
  }
}

export async function signOut(): Promise<void> {
  setPendingCode(null);
  await client().auth.signOut();
}

export async function fetchOwnProfile(userId: string): Promise<ProfileRow | null> {
  const { data, error } = await client().from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ProfileRow | null) ?? null;
}

// ---------- Datos del streamer ----------

export async function fetchOwnMedia(profileId: string): Promise<MediaFileRow[]> {
  const { data, error } = await client()
    .from('media_files')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data as MediaFileRow[]) || [];
}

// ---------- Administración ----------

export async function fetchPlans(): Promise<PlanRow[]> {
  const { data, error } = await client().from('plans').select('*').order('storage_limit_bytes');
  if (error) throw new Error(error.message);
  return (data as PlanRow[]) || [];
}

export async function updatePlan(id: string, patch: Partial<Omit<PlanRow, 'id'>>): Promise<void> {
  const { error } = await client().from('plans').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function fetchInvites(): Promise<InviteCodeRow[]> {
  const { data, error } = await client().from('invite_codes').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data as InviteCodeRow[]) || [];
}

/** Canjes de códigos: quién usó cuál y cuándo. Solo los lee un administrador. */
export async function fetchRedemptions(): Promise<InviteRedemptionRow[]> {
  const { data, error } = await client()
    .from('invite_redemptions')
    .select('*')
    .order('redeemed_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data as InviteRedemptionRow[]) || [];
}

export type ProfileMeta = Pick<ProfileRow, 'id' | 'invite_code_id' | 'created_at' | 'last_seen_at'>;

/** Datos de cada perfil que admin_overview no trae: última visita, alta y código con el que entró. */
export async function fetchProfileMeta(): Promise<ProfileMeta[]> {
  const { data, error } = await client().from('profiles').select('id, invite_code_id, created_at, last_seen_at');
  if (error) throw new Error(error.message);
  return (data as ProfileMeta[]) || [];
}

/** Cambia la clave de quien ha entrado. Devuelve null si se cambió, o el error de Supabase. */
export async function updateOwnPassword(password: string): Promise<AuthErrorLike | null> {
  try {
    const { error } = await client().auth.updateUser({ password });
    return error ? { message: error.message, code: error.code, status: error.status, name: error.name } : null;
  } catch (err) {
    return err instanceof Error ? { message: err.message, name: err.name } : { message: '' };
  }
}

// ---------- Formato ----------

export const MB = 1024 * 1024;

export function formatBytes(bytes: number): string {
  const mb = bytes / MB;
  if (mb >= 1024) return `${(mb / 1024).toLocaleString('es', { maximumFractionDigits: 2 })} GB`;
  return `${mb.toLocaleString('es', { maximumFractionDigits: 1 })} MB`;
}
