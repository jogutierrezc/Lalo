/**
 * src/lib/adminLogic.ts
 *
 * Funciones puras de la consola de administración: qué sección corresponde a
 * una dirección, qué requiere atención, cómo se reparte el almacenamiento y la
 * validación de la clave. No tocan la red ni el navegador.
 */

import type { AuthErrorLike } from './access';
import type { InviteCodeRow, InviteRedemptionRow, ProfileUsageRow } from './cloudTypes';

// ---------- Secciones ----------

export type AdminSection = 'resumen' | 'codigos' | 'limites' | 'almacenamiento' | 'streamers' | 'acceso';

export const ADMIN_SECTIONS: { id: AdminSection; label: string }[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'codigos', label: 'Códigos de invitación' },
  { id: 'limites', label: 'Límites' },
  { id: 'almacenamiento', label: 'Almacenamiento' },
  { id: 'streamers', label: 'Streamers' },
  { id: 'acceso', label: 'Mi acceso' },
];

/**
 * Sección de la consola para una dirección (#admin, #admin/codigos...).
 * Cualquier otra dirección, incluidas las de los módulos de streamer (#tts,
 * #ruleta...), lleva al Resumen: el administrador no tiene esas pantallas.
 */
export function adminSectionFromHash(hash: string): AdminSection {
  const clean = hash.toLowerCase().replace(/^#\/?/, '').split('?')[0].replace(/\/+$/, '');
  const [root, section] = clean.split('/');
  if (root !== 'admin') return 'resumen';
  return ADMIN_SECTIONS.find((entry) => entry.id === section)?.id ?? 'resumen';
}

export function adminHref(section: AdminSection): string {
  return section === 'resumen' ? '#admin' : `#admin/${section}`;
}

// ---------- Códigos ----------

export interface InviteState {
  label: string;
  chip?: 'read' | 'skipped' | 'rejected';
  open: boolean;
}

export function inviteState(invite: InviteCodeRow, now: number = Date.now()): InviteState {
  if (invite.revoked_at) return { label: 'Revocado', chip: 'rejected', open: false };
  if (invite.expires_at && new Date(invite.expires_at).getTime() <= now) return { label: 'Caducado', chip: 'skipped', open: false };
  if (invite.used_count >= invite.max_uses) return { label: 'Agotado', open: false };
  return { label: 'Vigente', chip: 'read', open: true };
}

const DAY_MS = 86400000;

/** Días enteros que le quedan a un código vigente, o null si no caduca. */
export function daysLeft(invite: InviteCodeRow, now: number): number | null {
  if (!invite.expires_at) return null;
  return Math.max(0, Math.ceil((new Date(invite.expires_at).getTime() - now) / DAY_MS));
}

/** Códigos vigentes que caducan dentro de `days` días. */
export function invitesExpiringSoon(invites: InviteCodeRow[], now: number, days = 7): InviteCodeRow[] {
  return invites.filter((invite) => {
    if (!inviteState(invite, now).open || !invite.expires_at) return false;
    return new Date(invite.expires_at).getTime() - now <= days * DAY_MS;
  });
}

// ---------- Cuentas ----------

export const NEARLY_FULL = 0.85;

export function usageRatio(row: Pick<ProfileUsageRow, 'bytes_used' | 'storage_limit_bytes'>): number {
  return row.storage_limit_bytes > 0 ? row.bytes_used / row.storage_limit_bytes : 0;
}

/** Cuenta activa que ha usado el 85% o más del espacio de su plan. */
export function isNearlyFull(row: ProfileUsageRow): boolean {
  return row.status === 'active' && usageRatio(row) >= NEARLY_FULL;
}

export const profileName = (row: Pick<ProfileUsageRow, 'display_name' | 'twitch_login'>) =>
  row.display_name || row.twitch_login || 'Sin nombre';

export type ProfileFilter = 'todas' | 'activas' | 'llenas' | 'suspendidas';

export function filterProfiles(rows: ProfileUsageRow[], filter: ProfileFilter, search: string): ProfileUsageRow[] {
  const query = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter === 'activas' && row.status !== 'active') return false;
    if (filter === 'suspendidas' && row.status !== 'suspended') return false;
    if (filter === 'llenas' && !isNearlyFull(row)) return false;
    if (!query) return true;
    return `${row.display_name ?? ''} ${row.twitch_login ?? ''}`.toLowerCase().includes(query);
  });
}

// ---------- Almacenamiento ----------

/** Lo que la consola necesita saber del almacenamiento (lo da el servidor en /api/storage/status). */
export interface StorageSummary {
  configured: boolean;
  missing: string[];
  capacityBytes: number;
  lastTest: { ok: boolean; step: string | null; detail: string | null } | null;
}

/**
 * - unknown: no se pudo preguntar al servidor
 * - missing: faltan variables en el servidor
 * - untested: está configurado, pero nadie ha hecho la prueba
 * - failed: la última prueba falló
 * - ok: la última prueba pasó
 */
export type StorageHealth = 'unknown' | 'missing' | 'untested' | 'failed' | 'ok';

export function storageHealth(storage: StorageSummary | null): StorageHealth {
  if (!storage) return 'unknown';
  if (!storage.configured) return 'missing';
  if (!storage.lastTest) return 'untested';
  return storage.lastTest.ok ? 'ok' : 'failed';
}

export interface CapacitySplit {
  capacity: number;
  /** Lo que ocupan hoy los archivos. */
  used: number;
  /** Lo prometido a las cuentas activas por su plan y que aún no han usado. */
  promised: number;
  /** Lo que no está ni usado ni prometido. */
  free: number;
  /** true si se ha prometido (o usado) más de lo que hay. */
  overcommitted: boolean;
}

export function capacitySplit(capacity: number, used: number, committed: number): CapacitySplit {
  const total = Math.max(0, capacity);
  const usedShown = Math.min(total, Math.max(0, used));
  const reserved = Math.max(used, committed);
  const promised = Math.max(0, Math.min(total, reserved) - usedShown);
  return {
    capacity: total,
    used: usedShown,
    promised,
    free: Math.max(0, total - usedShown - promised),
    overcommitted: reserved > total,
  };
}

/** Cuántas cuentas más de un plan caben en el espacio libre. */
export function accountsThatFit(freeBytes: number, planBytes: number): number {
  if (planBytes <= 0 || freeBytes <= 0) return 0;
  return Math.floor(freeBytes / planBytes);
}

// ---------- Requiere tu atención ----------

export interface AttentionItem {
  level: 'bad' | 'warn' | 'info';
  text: string;
  section: AdminSection;
  action: string;
}

export function buildAttention(input: {
  storage: StorageSummary | null;
  storageError?: string | null;
  profiles: ProfileUsageRow[];
  invites: InviteCodeRow[];
  now: number;
}): AttentionItem[] {
  const items: AttentionItem[] = [];
  const toStorage = { section: 'almacenamiento' as const, action: 'Ir a Almacenamiento' };

  switch (storageHealth(input.storage)) {
    case 'unknown':
      items.push({
        level: 'bad',
        text: `No se pudo comprobar el almacenamiento de archivos.${input.storageError ? ` ${input.storageError}` : ''}`,
        ...toStorage,
      });
      break;
    case 'missing':
      items.push({
        level: 'bad',
        text: 'El almacenamiento de archivos no está configurado. Los streamers no pueden subir archivos.',
        ...toStorage,
      });
      break;
    case 'untested':
      items.push({
        level: 'warn',
        text: 'El almacenamiento está configurado, pero falta probarlo. Hasta que pase la prueba, los streamers no pueden subir archivos.',
        ...toStorage,
      });
      break;
    case 'failed':
      items.push({
        level: 'bad',
        text: 'La última prueba del almacenamiento falló. Los streamers no pueden subir archivos hasta que se arregle.',
        ...toStorage,
      });
      break;
    case 'ok':
      break;
  }

  const full = input.profiles.filter(isNearlyFull);
  if (full.length > 0) {
    items.push({
      level: 'warn',
      text: `${full.length === 1 ? '1 cuenta está' : `${full.length} cuentas están`} al 85% o más de su plan: ${full.map(profileName).join(', ')}.`,
      section: 'streamers',
      action: 'Ver cuentas',
    });
  }

  for (const invite of invitesExpiringSoon(input.invites, input.now)) {
    const days = daysLeft(invite, input.now) ?? 0;
    const when = days <= 1 ? 'caduca en menos de un día' : `caduca en ${days} días`;
    const uses = invite.used_count === 0 ? 'sigue sin usar' : `lleva ${invite.used_count} de ${invite.max_uses} usos`;
    items.push({ level: 'info', text: `El código ${invite.code} ${when} y ${uses}.`, section: 'codigos', action: 'Ver códigos' });
  }

  return items;
}

/** Cuántos avisos tiene cada sección, para el número del menú. */
export function attentionCounts(items: AttentionItem[]): Partial<Record<AdminSection, number>> {
  const counts: Partial<Record<AdminSection, number>> = {};
  for (const item of items) counts[item.section] = (counts[item.section] ?? 0) + 1;
  return counts;
}

// ---------- Actividad reciente ----------

export interface ActivityItem {
  at: string;
  text: string;
}

/**
 * Actividad que se puede reconstruir con filas reales: canjes de códigos y
 * códigos creados. No hay registro de suspensiones ni de cambios de plan.
 */
export function buildActivity(
  invites: InviteCodeRow[],
  redemptions: InviteRedemptionRow[],
  profiles: ProfileUsageRow[],
  limit = 8
): ActivityItem[] {
  const codeOf = new Map(invites.map((invite) => [invite.id, invite.code]));
  const nameOf = new Map(profiles.map((row) => [row.profile_id, profileName(row)]));
  const items: ActivityItem[] = [
    ...redemptions.map((entry) => ({
      at: entry.redeemed_at,
      text: `${nameOf.get(entry.profile_id) ?? 'Una cuenta'} canjeó ${codeOf.get(entry.invite_code_id) ?? 'un código'}`,
    })),
    ...invites.map((invite) => ({
      at: invite.created_at,
      text: `Se creó el código ${invite.code}${invite.note ? ` para ${invite.note}` : ''}`,
    })),
  ];
  return items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, limit);
}

/** «hoy», «ayer», «hace 9 días»... a partir de una fecha ISO. */
export function relativeDay(iso: string | null | undefined, now: number): string {
  if (!iso) return 'Nunca';
  const then = new Date(iso);
  const today = new Date(now);
  const startOf = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(then)) / DAY_MS);
  if (days <= 0) return 'Hoy';
  if (days === 1) return 'Ayer';
  if (days < 14) return `Hace ${days} días`;
  if (days < 60) return `Hace ${Math.round(days / 7)} semanas`;
  return `Hace ${Math.round(days / 30)} meses`;
}

// ---------- Clave ----------

export const PASSWORD_MIN = 8;

/** Problema de la clave nueva antes de enviarla, o null si vale. */
export function passwordProblem(password: string, repeat: string): string | null {
  if (password.length < PASSWORD_MIN) return `La clave debe tener al menos ${PASSWORD_MIN} caracteres.`;
  if (password.trim() !== password) return 'La clave no puede empezar ni terminar con espacios.';
  if (password !== repeat) return 'Las dos claves no coinciden.';
  return null;
}

/** Explica por qué Supabase no cambió la clave. */
export function passwordChangeProblem(error: AuthErrorLike): string {
  const message = (error.message || '').toLowerCase();
  if (error.code === 'same_password' || message.includes('different from the old password')) {
    return 'La clave nueva es igual a la que ya tenías. Escribe otra.';
  }
  if (error.code === 'weak_password' || message.includes('weak') || message.includes('at least')) {
    return 'Supabase considera esa clave demasiado débil. Usa una más larga, con letras y números.';
  }
  if (error.code === 'reauthentication_needed' || message.includes('reauthentication')) {
    return 'Por seguridad, Supabase pide haber entrado hace poco. Cierra sesión, vuelve a entrar y cámbiala de nuevo.';
  }
  if (error.code === 'session_not_found' || error.status === 401 || error.status === 403) {
    return 'Tu sesión ha caducado. Cierra sesión, vuelve a entrar y cámbiala de nuevo.';
  }
  if (error.status === 429 || error.code === 'over_request_rate_limit') {
    return 'Demasiados intentos seguidos. Espera un minuto y vuelve a probar.';
  }
  if (
    error.name === 'AuthRetryableFetchError' ||
    error.status === 0 ||
    message.includes('failed to fetch') ||
    message.includes('networkerror')
  ) {
    return 'No se pudo conectar con la nube. Revisa tu conexión y vuelve a probar.';
  }
  return `No se pudo cambiar la clave: ${error.message || 'error desconocido'}`;
}
