/**
 * src/utils/twitchEvents.ts
 *
 * Lógica pura del canal de eventos de Twitch y de los Power-ups, sin DOM ni red
 * para poder probarla: permisos que faltan, lectura de la lista de Power-ups de
 * Twitch, lectura de los eventos que entrega el servidor y qué hace Lalo con
 * cada uno.
 */

import {
  BUILTIN_POWERUPS,
  BuiltinPowerupId,
  CachedPowerup,
  DEFAULT_TEMPLATES,
  PowerupRule,
  PowerupsSettings,
  ruleFor,
} from '../types/powerups';
import type { RewardTriggerInput } from './rewardsEngine';

// ---------- Permisos ----------

/** Permisos de Twitch que necesita el canal de eventos y para qué. */
export const EVENT_SCOPES = [
  { scope: 'bits:read', what: 'leer los Bits y los Power-ups' },
  { scope: 'channel:read:redemptions', what: 'leer los canjes de puntos' },
] as const;

/** Permisos que faltan. Con `null` (no se pudo comprobar) devuelve null: no se sabe. */
export function missingScopes(granted: readonly string[] | null): string[] | null {
  if (granted === null) return null;
  const have = new Set(granted);
  return EVENT_SCOPES.map((item) => item.scope).filter((scope) => {
    // «Gestionar canjes» incluye leerlos
    if (scope === 'channel:read:redemptions' && have.has('channel:manage:redemptions')) return false;
    return !have.has(scope);
  });
}

export type ScopeState = 'unknown' | 'ok' | 'missing';
export function scopeState(granted: readonly string[] | null): ScopeState {
  const missing = missingScopes(granted);
  return missing === null ? 'unknown' : missing.length === 0 ? 'ok' : 'missing';
}

// ---------- Lista de Power-ups personalizados (Get Custom Power-up) ----------

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const clean = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';

/** Convierte el `data` de GET helix/bits/custom_power_ups en la lista que guarda el panel. */
export function parseCustomPowerups(data: unknown): CachedPowerup[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter(isObject)
    .filter((item) => typeof item.id === 'string' && SAFE_ID.test(item.id))
    .slice(0, 50)
    .map((item) => ({
      id: item.id as string,
      title: clean(item.title, 80) || 'Power-up',
      prompt: clean(item.prompt, 300),
      bits: typeof item.bits === 'number' && Number.isFinite(item.bits) ? Math.max(0, Math.round(item.bits)) : 0,
      inputRequired: item.is_user_input_required === true,
      enabled: item.is_enabled !== false,
      paused: item.is_paused === true,
      inStock: item.is_in_stock !== false,
    }));
}

// ---------- Eventos que entrega el servidor ----------

export interface GoalTotal {
  id: string;
  current: number;
}

interface EventBase {
  /** Prueba enviada desde el panel: no aplica esperas ni límites. */
  test: boolean;
  user: string;
  login: string;
  text: string;
}

export type TwitchEvent =
  | (EventBase & {
      kind: 'bits';
      use: 'cheer' | 'power_up' | 'custom_power_up';
      bits: number;
      builtin: BuiltinPowerupId | null;
      emoteId: string;
      effectId: string;
      /** Total nuevo de cada meta de bits, ya sumado por el servidor. */
      goals: GoalTotal[];
    })
  | (EventBase & { kind: 'powerup'; id: string; title: string; bits: number })
  | (EventBase & { kind: 'points'; rewardId: string; title: string; cost: number });

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0);
const BUILTIN_IDS = BUILTIN_POWERUPS.map((item) => item.id) as readonly string[];
const USES = ['cheer', 'power_up', 'custom_power_up'] as const;

/** Lee un evento tal como llega de widget_events o del bus. null si no tiene la forma esperada. */
export function parseTwitchEvent(kind: unknown, payload: unknown, test = false): TwitchEvent | null {
  if (!isObject(payload)) return null;
  const base: EventBase = {
    test: test || payload.test === true,
    user: clean(payload.user, 40) || 'Espectador',
    login: typeof payload.login === 'string' && /^[a-z0-9_]{1,25}$/.test(payload.login) ? payload.login : '',
    text: clean(payload.text, 500),
  };

  if (kind === 'bits') {
    const use = USES.find((item) => item === payload.type);
    const bits = count(payload.bits);
    if (!use || bits < 1) return null;
    const powerUp = isObject(payload.powerUp) ? payload.powerUp : {};
    const builtin = use === 'power_up' && BUILTIN_IDS.includes(powerUp.type as string) ? (powerUp.type as BuiltinPowerupId) : null;
    const goals = (Array.isArray(payload.goals) ? payload.goals : [])
      .filter(isObject)
      .filter((goal) => typeof goal.id === 'string' && typeof goal.current === 'number' && Number.isFinite(goal.current))
      .slice(0, 30)
      .map((goal) => ({ id: goal.id as string, current: Math.max(0, goal.current as number) }));
    return {
      ...base,
      kind: 'bits',
      use,
      bits,
      builtin,
      emoteId: typeof powerUp.emoteId === 'string' && SAFE_ID.test(powerUp.emoteId) ? powerUp.emoteId : '',
      effectId: typeof powerUp.effectId === 'string' && SAFE_ID.test(powerUp.effectId) ? powerUp.effectId : '',
      goals,
    };
  }

  if (kind === 'powerup') {
    if (typeof payload.id !== 'string' || !SAFE_ID.test(payload.id)) return null;
    return { ...base, kind: 'powerup', id: payload.id, title: clean(payload.title, 80) || 'Power-up', bits: count(payload.bits) };
  }

  if (kind === 'points') {
    if (typeof payload.rewardId !== 'string' || !SAFE_ID.test(payload.rewardId)) return null;
    return {
      ...base,
      kind: 'points',
      rewardId: payload.rewardId.toLowerCase(),
      title: clean(payload.title, 80) || 'Canje',
      cost: count(payload.cost),
    };
  }

  return null;
}

// ---------- Qué hace Lalo con cada evento ----------

export type PlannedAction =
  /** Lanza una recompensa de Lalo por la puerta común (src/utils/rewardsEngine.ts). */
  | { do: 'reward'; input: RewardTriggerInput }
  /** Aviso en pantalla con la placa de avisos de la suite. */
  | { do: 'plate'; tag: string; text: string; user: string }
  /** La voz lee el texto. `viewerText` es lo que escribió el espectador: pasa antes por las palabras bloqueadas. */
  | { do: 'voice'; text: string; user: string; login: string; viewerText: string }
  /** Pone el total nuevo de cada meta de bits. */
  | { do: 'goals'; goals: GoalTotal[]; bits: number; user: string };

/** Sustituye {user}, {powerup}, {bits} y {message}; sin mensaje no deja puntuación suelta. */
export function fillTemplate(template: string, values: { user: string; powerup: string; bits: number; message: string }): string {
  return template
    .replace(/\{user\}/g, values.user)
    .replace(/\{powerup\}/g, values.powerup)
    .replace(/\{bits\}/g, String(values.bits))
    .replace(/\{message\}/g, values.message)
    .replace(/\s+/g, ' ')
    .replace(/[\s:.,«»"]+$/u, (tail) => (values.message ? tail.trim() : ''))
    .trim();
}

function ruleActions(
  rule: PowerupRule,
  event: { test: boolean; user: string; login: string; text: string },
  powerup: { title: string; bits: number }
): PlannedAction[] {
  const values = { user: event.user, powerup: powerup.title, bits: powerup.bits, message: event.text };
  switch (rule.action) {
    case 'sound':
    case 'video':
      if (!rule.rewardId) return [];
      return [
        {
          do: 'reward',
          input: {
            source: event.test ? 'test' : 'powerup',
            rewardId: rule.rewardId,
            user: event.user,
            username: event.login || undefined,
            bits: powerup.bits,
            text: event.text || undefined,
            label: `Power-up · ${powerup.title}`,
          },
        },
      ];
    case 'plate':
      return [{ do: 'plate', tag: `Power-up · ${powerup.bits} bits`, text: fillTemplate(rule.template || DEFAULT_TEMPLATES.plate, values), user: event.user }];
    case 'voice': {
      const text = fillTemplate(rule.template || DEFAULT_TEMPLATES.voice, values);
      return text ? [{ do: 'voice', text, user: event.user, login: event.login, viewerText: event.text }] : [];
    }
    default:
      return [];
  }
}

/**
 * Lo que hay que hacer con un evento, en orden. No hace nada por sí misma.
 *
 * - Los Bits de un cheer no lanzan recompensas aquí: el chat ya trae el cheer y
 *   la capa «Recompensas» lo atiende; hacerlo otra vez las dispararía dos veces.
 * - Un Power-up personalizado llega dos veces desde Twitch (como gasto de Bits y
 *   como canje). La acción se hace con el canje, que trae el texto del
 *   espectador; el gasto de Bits solo cuenta para las metas.
 * - Un canje de puntos con texto ya llega por el chat: aquí solo se atienden los
 *   que no lo piden.
 */
export function planActions(event: TwitchEvent, settings: PowerupsSettings): PlannedAction[] {
  const actions: PlannedAction[] = [];

  if (event.kind === 'bits') {
    if (event.goals.length > 0) actions.push({ do: 'goals', goals: event.goals, bits: event.bits, user: event.user });
    if (settings.enabled && event.builtin) {
      const title = BUILTIN_POWERUPS.find((item) => item.id === event.builtin)?.name ?? 'Power-up';
      actions.push(...ruleActions(ruleFor(settings, event.builtin), event, { title, bits: event.bits }));
    }
    return actions;
  }

  if (event.kind === 'powerup') {
    if (!settings.enabled) return actions;
    return ruleActions(ruleFor(settings, event.id), event, { title: event.title, bits: event.bits });
  }

  if (settings.pointsViaChannel && event.text === '') {
    actions.push({
      do: 'reward',
      input: {
        source: event.test ? 'test' : 'points',
        twitchRewardId: event.rewardId,
        user: event.user,
        username: event.login || undefined,
      },
    });
  }
  return actions;
}

// ---------- Bits a las metas ----------

interface BitsGoal {
  id: string;
  type: string;
  current: number;
  enabled?: boolean;
  /** Apagado, la meta no suma los Bits que avisa Twitch. Sin valor cuenta como encendido. */
  countBits?: boolean;
}

/** ¿Suma esta meta los Bits que avisa Twitch? */
export const countsBits = (goal: Pick<BitsGoal, 'type' | 'enabled' | 'countBits'>): boolean =>
  goal.type === 'bits' && goal.enabled !== false && goal.countBits !== false;

/**
 * Suma `bits` a las metas de bits que lo tengan encendido. Es la misma regla que
 * aplica el servidor en ingest_twitch_event (0012): el servidor es quien suma de
 * verdad, una vez por mensaje de Twitch; esta copia sirve para las pruebas y
 * para explicar el resultado en el panel.
 */
export function addBitsToGoals<T extends BitsGoal>(goals: readonly T[], bits: number): T[] {
  if (!Number.isInteger(bits) || bits < 1) return [...goals];
  return goals.map((goal) => (countsBits(goal) ? { ...goal, current: (Number(goal.current) || 0) + bits } : goal));
}

/**
 * Pone en cada meta el total que trae el evento. Como es un total y no una
 * suma, aplicar el mismo evento dos veces (dos fuentes de OBS, un reintento)
 * deja el mismo número.
 */
export function applyGoalTotals<T extends { id: string; current: number }>(goals: readonly T[], totals: readonly GoalTotal[]): T[] {
  const byId = new Map(totals.map((total) => [total.id, total.current]));
  return goals.map((goal) => (byId.has(goal.id) ? { ...goal, current: byId.get(goal.id) as number } : goal));
}

/** Nombre legible de un tipo de suscripción de Twitch. */
export const SUBSCRIPTION_NAMES: Record<string, string> = {
  'channel.bits.use': 'Bits usados (cheers y Power-ups)',
  'channel.custom_power_up_redemption.add': 'Power-ups personalizados',
  'channel.channel_points_custom_reward_redemption.add': 'Canjes de puntos',
};

/** Estado de una suscripción en palabras llanas. `good` dice si funciona. */
export function subscriptionStatusText(status: string): { text: string; good: boolean } {
  switch (status) {
    case 'enabled':
      return { text: 'Funcionando', good: true };
    case 'webhook_callback_verification_pending':
      return { text: 'Twitch está comprobando la conexión. Vuelve a consultar en unos segundos.', good: true };
    case 'webhook_callback_verification_failed':
      return { text: 'Twitch no pudo llegar al servidor de Lalo. Avisa a quien lo administra.', good: false };
    case 'notification_failures_exceeded':
      return { text: 'Twitch la apagó porque el servidor de Lalo falló demasiadas veces. Enciéndela de nuevo.', good: false };
    case 'authorization_revoked':
      return { text: 'Se retiró el permiso en Twitch. Vuelve a autorizar y enciéndela de nuevo.', good: false };
    case 'user_removed':
      return { text: 'Twitch ya no encuentra el canal.', good: false };
    case 'version_removed':
      return { text: 'Twitch retiró esta versión del aviso. Hace falta actualizar Lalo.', good: false };
    case 'missing':
      return { text: 'Apagada', good: false };
    default:
      return { text: `Estado de Twitch: ${status}`, good: false };
  }
}
