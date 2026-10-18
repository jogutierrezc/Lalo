/**
 * src/lib/cloudTypes.ts
 *
 * Tipos de las tablas y RPCs de Supabase. Escritos a mano: deben coincidir con
 * supabase/migrations (0001 a 0016). Las fechas llegan como texto ISO.
 */

export type ProfileRole = 'streamer' | 'admin';
export type ProfileStatus = 'pending' | 'active' | 'suspended';
export type MediaKind = 'image' | 'video' | 'audio';

export const CONFIG_MODULES = [
  'tts', 'alerts', 'goals', 'roulette', 'polls', 'rewards', 'bot', 'marathon', 'focus', 'raid', 'chat', 'studio',
  'powerups', 'music', 'kofi', 'pets', 'game', 'tournament',
] as const;
export type ConfigModule = (typeof CONFIG_MODULES)[number];

/** Límite por módulo en la tabla configs (bytes del JSON como texto). */
export const CONFIG_MAX_BYTES = 200_000;

/** Tipos MIME que acepta el bucket "media". */
export const MEDIA_ALLOWED_MIME = [
  'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'video/webm', 'video/mp4',
  'audio/mpeg', 'audio/wav', 'audio/ogg',
] as const;

// --- Tablas -----------------------------------------------------------------

export interface PlanRow {
  id: string;
  name: string;
  storage_limit_bytes: number;
  max_file_bytes: number;
  max_files: number;
  is_default: boolean;
  /** Tope mensual de créditos de Mi AI (migración 0032). */
  lux_monthly_credits?: number;
}

export interface ProfileRow {
  id: string;
  twitch_user_id: string | null;
  twitch_login: string | null;
  display_name: string | null;
  avatar_url: string | null;
  role: ProfileRole;
  status: ProfileStatus;
  plan_id: string | null;
  widget_key: string;
  media_folder: string;
  invite_code_id: string | null;
  created_at: string;
  last_seen_at: string | null;
  /** Desde 0006: cuándo terminó la bienvenida. Falta si la migración no está aplicada. */
  onboarded_at?: string | null;
  /** Desde 0018: el administrador le activó ElevenLabs. */
  elevenlabs_enabled?: boolean;
  /** Desde 0023: el administrador activó Lux (personaje con IA) para la cuenta. */
  lux_enabled?: boolean;
  /** Desde 0018: cuándo cerró el aviso de invitación a ElevenLabs. */
  elevenlabs_invite_seen_at?: string | null;
  /** Desde 0019: última vez que una fuente de OBS consultó su llave. */
  last_widget_at?: string | null;
  /** Desde 0019: tope diario de caracteres en ElevenLabs (0 = sin límite). */
  elevenlabs_daily_chars?: number;
}

export interface InviteCodeRow {
  id: string;
  code: string;
  plan_id: string;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  revoked_at: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface InviteRedemptionRow {
  invite_code_id: string;
  profile_id: string;
  redeemed_at: string;
}

export interface RecoveryCodeRow {
  id: string;
  profile_id: string;
  code_hash: string;
  expires_at: string;
  used_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface ConfigRow<T = unknown> {
  profile_id: string;
  module: ConfigModule;
  data: T;
  updated_at: string;
}

export interface MediaFileRow {
  id: string;
  profile_id: string;
  path: string;
  name: string;
  kind: MediaKind;
  mime: string;
  size_bytes: number;
  created_at: string;
  /** Desde 0005: dónde está el archivo. Las filas antiguas son de Supabase Storage. */
  provider?: 'r2' | 'supabase';
  /** Desde 0005: nombre del objeto en R2. */
  object_key?: string | null;
}

/** Desde 0008: una fila por cuenta, documento y versión aceptada. */
export interface TermsAcceptanceRow {
  profile_id: string;
  document: string;
  version: string;
  accepted_at: string;
}

/** Desde 0009: lo que cualquier cuenta con sesión lee de una voz visible del catálogo. */
export interface PublicVoiceRow {
  id: string;
  name: string;
  description: string;
  /** Id del modelo en Fish Audio: lo que guarda cada streamer como su voz. */
  reference_id: string;
  visible: boolean;
  is_default: boolean;
  origin: 'initial' | 'recorded' | 'uploaded';
  created_at: string;
  /** Desde 0018: motor de la voz. Sin el campo, Fish Audio. */
  provider?: 'fish' | 'elevenlabs';
}

/** Desde 0009: una voz tal como la ve el administrador (admin_voices). */
export interface AdminVoiceRow extends PublicVoiceRow {
  voice_owner: 'own' | 'other' | 'unknown';
  permission_by: string | null;
  permission_confirmed_at: string | null;
  created_by: string | null;
  /** Cuántos streamers la tienen guardada en su configuración sincronizada. */
  streamers?: number;
}

/** voice_state(p_reference_id): qué pasa con el id de voz que alguien tiene guardado. */
export type VoiceState = 'visible' | 'retired' | 'unknown';

export type MediaProvider = NonNullable<MediaFileRow['provider']>;

// --- RPCs -------------------------------------------------------------------

export type InviteStatus = 'valid' | 'expired' | 'used_up' | 'revoked' | 'not_found';

/** check_invite(p_code): devuelve un arreglo con una sola fila. */
export interface CheckInviteRow {
  status: InviteStatus;
  plan_name: string | null;
}

/** redeem_invite(p_code) */
export type RedeemInviteResult = 'ok' | 'not_pending' | 'no_twitch' | Exclude<InviteStatus, 'valid'>;

/** redeem_recovery_code(p_code) */
export type RedeemRecoveryResult =
  | 'ok' | 'not_found' | 'expired' | 'used' | 'not_pending' | 'same_profile';

/** profile_usage(p_profile?, p_all?): una fila por perfil. */
export interface ProfileUsageRow {
  profile_id: string;
  twitch_login: string | null;
  display_name: string | null;
  status: ProfileStatus;
  role: ProfileRole;
  plan_id: string | null;
  bytes_used: number;
  file_count: number;
  storage_limit_bytes: number;
  max_file_bytes: number;
  max_files: number;
}

export interface WidgetBundleMedia {
  id: string;
  /** Filas antiguas, relativo al bucket de Supabase: <SUPABASE_URL>/storage/v1/object/public/media/<path> */
  path: string;
  name: string;
  kind: MediaKind;
  mime: string;
  /** Desde 0005. Con 'r2' la dirección es <VITE_R2_PUBLIC_BASE_URL>/<object_key> (ver mediaPublicUrl). */
  provider?: MediaProvider;
  object_key?: string | null;
}

/** widget_bundle(p_key): null si la llave no existe o el perfil no está activo. */
export interface WidgetBundle {
  profile: {
    twitch_login: string | null;
    display_name: string | null;
    avatar_url: string | null;
  };
  configs: Partial<Record<ConfigModule, unknown>>;
  media: WidgetBundleMedia[];
}
export type WidgetBundleResult = WidgetBundle | null;

export interface AdminTotals {
  profiles: number;
  active_profiles: number;
  pending_profiles: number;
  storage_bytes: number;
  storage_files: number;
  storage_committed_bytes: number;
  /** Desde 0005: capacidad total que el administrador ha indicado. */
  storage_capacity_bytes?: number | null;
  database_bytes: number;
  open_invites: number;
}

/** admin_overview() */
export interface AdminOverview {
  profiles: ProfileUsageRow[];
  totals: AdminTotals;
}

/** Desde 0019: adopción por módulo sincronizado en public.configs. */
export interface AdminUsageModuleRow {
  module: ConfigModule;
  streamers: number;
  last_updated_at: string | null;
}

export interface AdminTtsPeriodUsage {
  fish_requests: number;
  fish_chars: number;
  eleven_requests: number;
  eleven_chars: number;
}

export interface AdminProfileTournamentInfo {
  slug: string;
  name: string;
  signup_open: boolean;
  entries_count: number;
}

export interface AdminProfileUsageDetail {
  profile_id: string;
  last_widget_at: string | null;
  configs_updated_at: string | null;
  modules: ConfigModule[];
  integrations: ('spotify' | 'kofi' | 'riot')[];
  tournament: AdminProfileTournamentInfo | null;
  elevenlabs_daily_chars: number;
  tts_today: AdminTtsPeriodUsage;
  tts_7d: AdminTtsPeriodUsage;
}

export interface AdminUsageTotals {
  obs_active_24h: number;
  obs_active_7d: number;
  panel_active_7d: number;
  configured_streamers: number;
  tts_7d_requests: number;
  tts_7d_chars: number;
  eleven_7d_requests: number;
  eleven_7d_chars: number;
  eleven_today_chars: number;
  active_tournaments: number;
  total_tournament_entries: number;
}

export interface AdminAuditEntry {
  id: number;
  action: string;
  detail: string;
  created_at: string;
}

/** admin_usage_report() (migración 0019, o reconstruido desde configs si falta 0019). */
export interface AdminUsageReport {
  modules: AdminUsageModuleRow[];
  profiles: AdminProfileUsageDetail[];
  totals: AdminUsageTotals;
  audit_log: AdminAuditEntry[];
  /** true si viene de admin_usage_report (0019); false si se reconstruyó solo con configs. */
  full_telemetry?: boolean;
}

/** Argumentos de las RPCs (nombres exactos de los parámetros SQL). */
export interface RpcArgs {
  check_invite: { p_code: string };
  redeem_invite: { p_code: string };
  redeem_recovery_code: { p_code: string };
  rotate_widget_key: Record<string, never>;
  touch_profile: Record<string, never>;
  widget_bundle: { p_key: string };
  widget_version: { p_key: string };
  profile_usage: { p_profile?: string | null; p_all?: boolean };
  admin_overview: Record<string, never>;
  admin_usage_report: Record<string, never>;
  admin_create_invite: {
    p_plan?: string | null;
    p_max_uses?: number;
    p_expires_at?: string | null;
    p_note?: string | null;
  };
  admin_revoke_invite: { p_invite: string };
  admin_set_profile: {
    p_profile: string;
    p_status?: ProfileStatus | null;
    p_plan?: string | null;
    p_role?: ProfileRole | null;
  };
  admin_create_recovery_code: { p_profile: string; p_ttl_hours?: number };
  admin_set_storage_capacity: { p_bytes: number };
  storage_ready: Record<string, never>;
  complete_onboarding: Record<string, never>;
  accept_terms: { p_versions: Record<string, string> };
  voice_state: { p_reference_id: string };
  admin_voices: Record<string, never>;
  admin_set_voice_visible: { p_voice: string; p_visible: boolean };
  admin_set_default_voice: { p_voice: string };
  admin_set_elevenlabs: { p_profile: string; p_enabled: boolean };
  admin_set_elevenlabs_limit: { p_profile: string; p_daily_chars: number };
  admin_set_lux: { p_profile: string; p_enabled: boolean };
  eleven_active_slot: Record<string, never>;
  admin_set_eleven_active_slot: { p_slot: number };
  admin_set_streamer_voice: { p_profile: string; p_reference_id: string; p_engine: 'fish' | 'elevenlabs' };
  dismiss_elevenlabs_invite: Record<string, never>;
}

/** Resultado de cada RPC (lo que llega en `data`). */
export interface RpcResult {
  check_invite: CheckInviteRow[];
  redeem_invite: RedeemInviteResult;
  redeem_recovery_code: RedeemRecoveryResult;
  rotate_widget_key: string;
  touch_profile: null;
  widget_bundle: WidgetBundleResult;
  widget_version: string | null;
  profile_usage: ProfileUsageRow[];
  admin_overview: AdminOverview;
  admin_usage_report: AdminUsageReport;
  admin_create_invite: InviteCodeRow;
  admin_revoke_invite: null;
  admin_set_profile: ProfileRow;
  admin_set_elevenlabs: ProfileRow;
  admin_set_elevenlabs_limit: ProfileRow;
  admin_set_lux: ProfileRow;
  eleven_active_slot: number;
  admin_set_eleven_active_slot: number;
  admin_set_streamer_voice: null;
  dismiss_elevenlabs_invite: null;
  admin_create_recovery_code: string;
  admin_set_storage_capacity: number;
  storage_ready: boolean;
  /** Desde 0006: la fecha en que quedó terminada la bienvenida. */
  complete_onboarding: string;
  /** Desde 0008: la fecha en que quedó registrada la aceptación. */
  accept_terms: string;
  /** Desde 0009. */
  voice_state: VoiceState;
  admin_voices: AdminVoiceRow[];
  admin_set_voice_visible: null;
  admin_set_default_voice: null;
}
