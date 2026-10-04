/**
 * src/types/kofi.ts
 *
 * Ajustes del módulo «Ko-fi»: el diseño y la colocación de las alertas, lo que
 * hace cada tipo de aviso, la meta de dinero y la lista de últimos apoyos. Se
 * guardan en este navegador y, con cuenta abierta, en la nube; el servidor lee
 * de ahí qué tipos suman a la meta y en qué moneda (server/integrations/kofiRules.ts).
 *
 * Lo recaudado NO vive aquí: lo lleva el servidor, una vez por aviso, para que
 * no dependa de qué fuentes de OBS estén abiertas ni se pise al guardar ajustes.
 */

import { queueCloudPush } from '../lib/cloudConfig';
import {
  DEFAULT_GOAL_CURRENCY,
  KOFI_KINDS,
  normalizeKofiRule,
  type KofiEventRule,
  type KofiKind,
  type KofiRuleSet,
} from '../../server/integrations/kofiRules';
import { decodeBase64Url, encodeBase64Url, normalizeAccent, type AlertPosition } from '../utils/appearance';
import { SIX_POSITIONS } from './music';

export type KofiDesign = 'recibo' | 'rotulo' | 'sello' | 'burbuja' | 'cinta' | 'cartel';
export type KofiGoalLayout = 'barra' | 'deposito';
export type KofiRecentLayout = 'lista' | 'cinta';

export const KOFI_DESIGNS: { id: KofiDesign; name: string; note: string; hint: string }[] = [
  {
    id: 'recibo',
    name: 'Recibo',
    note: 'Tique de papel que se imprime',
    hint: 'Papel claro que se imprime hacia abajo, con la cantidad en grande y borde dentado. Sale hacia arriba.',
  },
  {
    id: 'rotulo',
    name: 'Rótulo',
    note: 'Barra ancha con el tipo a la izquierda',
    hint: 'Barra ancha: el tipo de aviso en un bloque a la izquierda, el fondo se despliega y la cantidad entra por la derecha.',
  },
  {
    id: 'sello',
    name: 'Sello',
    note: 'Bloque inclinado que cae de golpe',
    hint: 'Bloque inclinado con doble marco que cae de golpe sobre la escena. El texto aparece después.',
  },
  {
    id: 'burbuja',
    name: 'Burbuja',
    note: 'El mensaje manda, como un bocadillo',
    hint: 'Un bocadillo que crece desde su esquina. El mensaje va en grande: para canales donde lo importante es lo que dicen.',
  },
  {
    id: 'cinta',
    name: 'Cinta',
    note: 'Una línea fina que se abre',
    hint: 'Una línea que se abre desde el centro. El mensaje largo se desliza. Lo menos invasivo.',
  },
  {
    id: 'cartel',
    name: 'Cartel',
    note: 'Grande, con la cantidad enorme',
    hint: 'Franja grande con la cantidad enorme: el fondo se abre en vertical y las líneas suben una a una.',
  },
];

export interface KofiGoalSettings {
  on: boolean;
  layout: KofiGoalLayout;
  title: string;
  target: number;
  currency: string;
}

export interface KofiRecentSettings {
  on: boolean;
  layout: KofiRecentLayout;
}

export interface KofiSettings {
  design: KofiDesign;
  pos: AlertPosition;
  /** Tamaño en tanto por ciento. */
  size: number;
  /** Segundos en pantalla. */
  hold: number;
  color: string;
  showAmount: boolean;
  showMessage: boolean;
  events: Record<KofiKind, KofiEventRule>;
  goal: KofiGoalSettings;
  recent: KofiRecentSettings;
  /** Las alertas y las capas fijas encendidas aparecen también en «Todo en uno». */
  inAll: boolean;
  /** Cambia al reiniciar la meta: las capas de OBS vuelven a leer lo recaudado. */
  refreshAt: number;
}

export const KOFI_LIMITS = { size: { min: 70, max: 130 }, hold: { min: 3, max: 15 }, target: { min: 1, max: 100000 }, title: 40 } as const;

export const DEFAULT_KOFI_SETTINGS: KofiSettings = {
  design: 'recibo',
  pos: 'tr',
  size: 100,
  hold: 6,
  color: '#ff9a6b',
  showAmount: true,
  showMessage: true,
  events: Object.fromEntries(KOFI_KINDS.map((kind) => [kind, normalizeKofiRule(kind, null)])) as Record<KofiKind, KofiEventRule>,
  goal: { on: true, layout: 'barra', title: 'Micrófono nuevo', target: 200, currency: DEFAULT_GOAL_CURRENCY },
  recent: { on: true, layout: 'lista' },
  inAll: false,
  refreshAt: 0,
};

export const KOFI_STORAGE_KEY = 'lalo_kofi_settings';

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
const int = (value: unknown, limits: { min: number; max: number }, fallback: number): number => {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? Math.round(Math.min(limits.max, Math.max(limits.min, n))) : fallback;
};
const oneOf = <T extends string>(value: unknown, list: readonly T[], fallback: T): T => (list.includes(value as T) ? (value as T) : fallback);

export function normalizeKofiSettings(raw: unknown): KofiSettings {
  const src = isObject(raw) ? raw : {};
  const d = DEFAULT_KOFI_SETTINGS;
  const events = isObject(src.events) ? src.events : {};
  const goal = isObject(src.goal) ? src.goal : {};
  const recent = isObject(src.recent) ? src.recent : {};
  const currency = typeof goal.currency === 'string' && /^[A-Za-z]{3}$/.test(goal.currency.trim()) ? goal.currency.trim().toUpperCase() : d.goal.currency;
  return {
    design: oneOf(src.design, KOFI_DESIGNS.map((item) => item.id), d.design),
    pos: oneOf(src.pos, SIX_POSITIONS.map((item) => item.id), d.pos),
    size: int(src.size, KOFI_LIMITS.size, d.size),
    hold: int(src.hold, KOFI_LIMITS.hold, d.hold),
    color: normalizeAccent(src.color) ?? d.color,
    showAmount: bool(src.showAmount, d.showAmount),
    showMessage: bool(src.showMessage, d.showMessage),
    events: Object.fromEntries(KOFI_KINDS.map((kind) => [kind, normalizeKofiRule(kind, events[kind])])) as Record<KofiKind, KofiEventRule>,
    goal: {
      on: bool(goal.on, d.goal.on),
      layout: oneOf(goal.layout, ['barra', 'deposito'] as const, d.goal.layout),
      title: typeof goal.title === 'string' ? goal.title.slice(0, KOFI_LIMITS.title) : d.goal.title,
      target: int(goal.target, KOFI_LIMITS.target, d.goal.target),
      currency,
    },
    recent: { on: bool(recent.on, d.recent.on), layout: oneOf(recent.layout, ['lista', 'cinta'] as const, d.recent.layout) },
    inAll: bool(src.inAll, d.inAll),
    refreshAt: typeof src.refreshAt === 'number' && Number.isFinite(src.refreshAt) ? src.refreshAt : 0,
  };
}

/** Las reglas tal como las entiende decideKofi. */
export const kofiRuleSet = (settings: KofiSettings): KofiRuleSet => ({ events: settings.events, goalCurrency: settings.goal.currency });

export function loadKofiSettings(): KofiSettings {
  try {
    const raw = localStorage.getItem(KOFI_STORAGE_KEY);
    return raw ? normalizeKofiSettings(JSON.parse(raw)) : DEFAULT_KOFI_SETTINGS;
  } catch {
    return DEFAULT_KOFI_SETTINGS;
  }
}

export function saveKofiSettings(settings: KofiSettings): void {
  try {
    localStorage.setItem(KOFI_STORAGE_KEY, JSON.stringify(settings));
    queueCloudPush('kofi', settings);
  } catch (err) {
    console.error('No se pudieron guardar los ajustes de Ko-fi:', err);
  }
}

/** Ajustes compactos para la URL de OBS cuando no hay cuenta en la nube. */
export function encodeKofiSettings(settings: KofiSettings): string {
  // Un sonido incrustado solo vive en este navegador: no cabe en una dirección
  const events = Object.fromEntries(
    KOFI_KINDS.map((kind) => [kind, { ...settings.events[kind], sndUrl: settings.events[kind].sndUrl.startsWith('data:') ? '' : settings.events[kind].sndUrl }])
  );
  return encodeBase64Url(JSON.stringify({ ...settings, events }));
}

export function decodeKofiSettings(param: string | null | undefined): KofiSettings | null {
  const text = decodeBase64Url(param);
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return isObject(parsed) ? normalizeKofiSettings(parsed) : null;
  } catch {
    return null;
  }
}
