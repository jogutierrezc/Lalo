/**
 * src/types/powerups.ts
 *
 * Ajustes del módulo «Power-ups»: qué hace Lalo cuando alguien usa un Power-up
 * del canal, la lista de Power-ups personalizados leída de Twitch (guardada para
 * poder editar más tarde sin volver a preguntar) y el estado del canal de
 * eventos.
 *
 * Todo lo que se lee de localStorage o de la nube pasa por
 * normalizePowerupsSettings.
 */

import { queueCloudPush } from '../lib/cloudConfig';

/** Qué hace Lalo con un Power-up. `sound` y `video` lanzan una recompensa de Lalo, que es quien tiene el archivo. */
export type PowerupAction = 'none' | 'sound' | 'video' | 'plate' | 'voice';

export const POWERUP_ACTIONS: { id: PowerupAction; name: string }[] = [
  { id: 'none', name: 'No hacer nada' },
  { id: 'sound', name: 'Sonar un audio' },
  { id: 'video', name: 'Mostrar un vídeo' },
  { id: 'plate', name: 'Aviso en pantalla' },
  { id: 'voice', name: 'La voz lee un mensaje' },
];

/** Los tres Power-ups de serie, con el nombre que les da Twitch en channel.bits.use. */
export const BUILTIN_POWERUPS = [
  { id: 'gigantify_an_emote', name: 'Emote gigante' },
  { id: 'celebration', name: 'Celebración en pantalla' },
  { id: 'message_effect', name: 'Efecto de mensaje' },
] as const;
export type BuiltinPowerupId = (typeof BUILTIN_POWERUPS)[number]['id'];

export interface PowerupRule {
  action: PowerupAction;
  /** Recompensa de Lalo que pone el sonido o el vídeo (acciones `sound` y `video`). */
  rewardId: string;
  /** Qué dice la voz o el aviso. {user}, {powerup}, {bits} y {message} se sustituyen. */
  template: string;
}

/** Un Power-up personalizado tal como lo devolvió Twitch (solo lo que usa el panel). */
export interface CachedPowerup {
  id: string;
  title: string;
  prompt: string;
  bits: number;
  inputRequired: boolean;
  enabled: boolean;
  paused: boolean;
  inStock: boolean;
}

export interface PowerupsSettings {
  /** Apagado, Lalo no reacciona a ningún Power-up (las metas siguen contando los Bits). */
  enabled: boolean;
  /** Regla de cada Power-up: la clave es el id de Twitch o el id del de serie. */
  rules: Record<string, PowerupRule>;
  /** Última lista leída de Twitch y cuándo (ms). null: aún no se ha leído. */
  cached: CachedPowerup[];
  cachedAt: number | null;
  /** Permisos que tenía la conexión con Twitch la última vez que se pudo comprobar. null: sin comprobar. */
  scopes: string[] | null;
  /** El streamer encendió el canal de eventos: las capas de OBS preguntan por eventos nuevos. */
  channelActive: boolean;
  /** Los canjes de puntos que no piden texto también disparan su recompensa de Lalo. */
  pointsViaChannel: boolean;
}

export const POWERUPS_STORAGE_KEY = 'lalo_powerups_settings';
export const POWERUP_LIMITS = { template: 160, maxCached: 50, maxRules: 80 } as const;

export const DEFAULT_TEMPLATES: Record<'plate' | 'voice', string> = {
  plate: '{user} usó {powerup}',
  voice: '{user} usó {powerup}. {message}',
};

export const DEFAULT_RULE: PowerupRule = { action: 'none', rewardId: '', template: '' };

export const DEFAULT_POWERUPS_SETTINGS: PowerupsSettings = {
  enabled: true,
  rules: {},
  cached: [],
  cachedAt: null,
  scopes: null,
  channelActive: false,
  pointsViaChannel: true,
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '');
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ACTIONS = POWERUP_ACTIONS.map((item) => item.id);

export function normalizeRule(raw: unknown): PowerupRule {
  const src = isObject(raw) ? raw : {};
  return {
    action: ACTIONS.includes(src.action as PowerupAction) ? (src.action as PowerupAction) : 'none',
    rewardId: str(src.rewardId, 80),
    template: str(src.template, POWERUP_LIMITS.template),
  };
}

function normalizeCached(raw: unknown): CachedPowerup | null {
  if (!isObject(raw) || typeof raw.id !== 'string' || !SAFE_ID.test(raw.id)) return null;
  const bits = typeof raw.bits === 'number' && Number.isFinite(raw.bits) ? Math.max(0, Math.round(raw.bits)) : 0;
  return {
    id: raw.id,
    title: str(raw.title, 80) || 'Power-up',
    prompt: str(raw.prompt, 300),
    bits,
    inputRequired: bool(raw.inputRequired, false),
    enabled: bool(raw.enabled, true),
    paused: bool(raw.paused, false),
    inStock: bool(raw.inStock, true),
  };
}

export function normalizePowerupsSettings(raw: unknown): PowerupsSettings {
  const src = isObject(raw) ? raw : {};
  const d = DEFAULT_POWERUPS_SETTINGS;
  const rules: Record<string, PowerupRule> = {};
  if (isObject(src.rules)) {
    Object.entries(src.rules)
      .filter(([id]) => SAFE_ID.test(id))
      .slice(0, POWERUP_LIMITS.maxRules)
      .forEach(([id, rule]) => {
        rules[id] = normalizeRule(rule);
      });
  }
  const cached = (Array.isArray(src.cached) ? src.cached : [])
    .map(normalizeCached)
    .filter((item): item is CachedPowerup => item !== null)
    .slice(0, POWERUP_LIMITS.maxCached);
  return {
    enabled: bool(src.enabled, d.enabled),
    rules,
    cached,
    cachedAt: typeof src.cachedAt === 'number' && Number.isFinite(src.cachedAt) ? src.cachedAt : null,
    scopes: Array.isArray(src.scopes) ? src.scopes.filter((item): item is string => typeof item === 'string').slice(0, 40) : null,
    channelActive: bool(src.channelActive, d.channelActive),
    pointsViaChannel: bool(src.pointsViaChannel, d.pointsViaChannel),
  };
}

export function loadPowerupsSettings(): PowerupsSettings {
  try {
    const raw = localStorage.getItem(POWERUPS_STORAGE_KEY);
    return raw ? normalizePowerupsSettings(JSON.parse(raw)) : DEFAULT_POWERUPS_SETTINGS;
  } catch {
    return DEFAULT_POWERUPS_SETTINGS;
  }
}

export function savePowerupsSettings(settings: PowerupsSettings): void {
  try {
    localStorage.setItem(POWERUPS_STORAGE_KEY, JSON.stringify(settings));
    queueCloudPush('powerups', settings);
  } catch (err) {
    console.error('No se pudieron guardar los ajustes de Power-ups:', err);
  }
}

/** Regla de un Power-up, o la de «no hacer nada» si no tiene. */
export function ruleFor(settings: Pick<PowerupsSettings, 'rules'>, id: string): PowerupRule {
  return settings.rules[id] ?? DEFAULT_RULE;
}
