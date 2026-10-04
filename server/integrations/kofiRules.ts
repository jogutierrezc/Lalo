/**
 * server/integrations/kofiRules.ts
 *
 * Reglas puras de Ko-fi, compartidas por el servidor (webhook) y por el
 * navegador (capas y panel). No importa nada de Node ni del navegador.
 *
 * Ko-fi envía un POST con formulario (application/x-www-form-urlencoded) cuyo
 * campo `data` es un JSON con: verification_token, message_id, timestamp, type
 * (Donation, Subscription, Commission, Shop Order), is_public, from_name,
 * message, amount, currency, url, email, is_subscription_payment,
 * is_first_subscription_payment, kofi_transaction_id, tier_name, shop_items y
 * shipping. La página oficial de ayuda no se pudo abrir (error 403): por eso
 * aquí se tolera cualquier campo ausente o con otro tipo.
 *
 * De todo eso Lalo solo conserva el tipo, el nombre, el mensaje, la cantidad,
 * la moneda y el nivel. El correo, la dirección de envío, los artículos y los
 * identificadores de pago se descartan aquí mismo.
 */

export type KofiKind = 'don' | 'mem' | 'ren' | 'shop' | 'com';
export const KOFI_KINDS: KofiKind[] = ['don', 'mem', 'ren', 'shop', 'com'];

export const KOFI_KIND_NAMES: Record<KofiKind, string> = {
  don: 'Donación',
  mem: 'Nueva membresía',
  ren: 'Renovación',
  shop: 'Pedido de tienda',
  com: 'Comisión',
};

/** Nombre que sale cuando el apoyo es privado. */
export const PRIVATE_NAME = 'Alguien';

export interface KofiEvent {
  kind: KofiKind;
  /** Ya con la privacidad aplicada: «Alguien» si el apoyo no es público. */
  name: string;
  /** Vacío si el apoyo no es público. */
  message: string;
  amount: number;
  currency: string;
  tier: string;
  isPublic: boolean;
}

export interface KofiHookPayload {
  token: string;
  messageId: string;
  event: KofiEvent;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const clean = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const truthy = (value: unknown): boolean => value === true || value === 'true' || value === 'True' || value === 1 || value === '1';

/** Tope del cuerpo del webhook. Los avisos de Ko-fi son pequeños. */
export const KOFI_MAX_BODY_BYTES = 32 * 1024;

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * El JSON de `data`, llegue como llegue el cuerpo: ya interpretado por Vercel o
 * Express (objeto con `data`), como texto de formulario, como JSON o en bytes.
 */
export function parseKofiBody(body: unknown): Record<string, unknown> | null {
  if (body instanceof Uint8Array) {
    if (body.byteLength > KOFI_MAX_BODY_BYTES) return null;
    return parseKofiBody(new TextDecoder().decode(body));
  }
  if (typeof body === 'string') {
    if (body.length > KOFI_MAX_BODY_BYTES) return null;
    const trimmed = body.trim();
    if (trimmed.startsWith('{')) {
      const parsed = parseJson(trimmed);
      return parsed ? parseKofiBody(parsed) : null;
    }
    let data: string | null = null;
    try {
      data = new URLSearchParams(trimmed).get('data');
    } catch {
      data = null;
    }
    return data ? parseJson(data) : null;
  }
  if (!isObject(body)) return null;
  if (typeof body.data === 'string') return body.data.length > KOFI_MAX_BODY_BYTES ? null : parseJson(body.data);
  if (isObject(body.data)) return body.data;
  // Por si algún día Ko-fi envía el JSON sin envolver
  return 'verification_token' in body ? body : null;
}

export function kofiKindOf(type: unknown, isSubscription: unknown, isFirst: unknown): KofiKind {
  const name = typeof type === 'string' ? type.trim().toLowerCase() : '';
  if (name === 'subscription' || truthy(isSubscription)) return truthy(isFirst) ? 'mem' : 'ren';
  if (name === 'shop order') return 'shop';
  if (name === 'commission') return 'com';
  return 'don';
}

export function kofiAmount(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value.replace(',', '.')) : NaN;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(1_000_000, Math.round(n * 100) / 100);
}

/** Del JSON de Ko-fi a lo que Lalo usa. null si falta la clave o el identificador del mensaje. */
export function normalizeKofiPayload(data: unknown): KofiHookPayload | null {
  if (!isObject(data)) return null;
  const token = typeof data.verification_token === 'string' ? data.verification_token.trim() : '';
  const messageId = typeof data.message_id === 'string' ? data.message_id.trim() : '';
  if (!token || token.length > 200 || !/^[A-Za-z0-9._:-]{1,100}$/.test(messageId)) return null;
  // Sin el dato de si es público, se trata como privado
  const isPublic = truthy(data.is_public);
  const currency = typeof data.currency === 'string' && /^[A-Za-z]{3}$/.test(data.currency.trim()) ? data.currency.trim().toUpperCase() : '';
  return {
    token,
    messageId,
    event: {
      kind: kofiKindOf(data.type, data.is_subscription_payment, data.is_first_subscription_payment),
      name: isPublic ? clean(data.from_name, 60) || PRIVATE_NAME : PRIVATE_NAME,
      message: isPublic ? clean(data.message, 500) : '',
      amount: kofiAmount(data.amount),
      currency,
      tier: clean(data.tier_name, 60),
      isPublic,
    },
  };
}

/** Lo que se guarda en el canal de eventos y recibe la capa de OBS. */
export function kofiEventToStored(event: KofiEvent): Record<string, unknown> {
  return { ev: event.kind, name: event.name, msg: event.message, amount: event.amount, currency: event.currency, tier: event.tier, pub: event.isPublic };
}

export interface ReceivedKofiEvent extends KofiEvent {
  /** Total recaudado de la meta después de este aviso, si el servidor lo sumó. */
  raised: number | null;
  /** Solo en las pruebas del panel: simula un mensaje con una palabra bloqueada. */
  blockedSample: boolean;
  test: boolean;
}

/** Lee un evento del canal (o una prueba del panel). null si no tiene la forma esperada. */
export function parseStoredKofiEvent(payload: unknown, test = false): ReceivedKofiEvent | null {
  if (!isObject(payload) || !KOFI_KINDS.includes(payload.ev as KofiKind)) return null;
  const isPublic = payload.pub === true;
  return {
    kind: payload.ev as KofiKind,
    name: isPublic ? clean(payload.name, 60) || PRIVATE_NAME : PRIVATE_NAME,
    message: isPublic ? clean(payload.msg, 500) : '',
    amount: kofiAmount(payload.amount),
    currency: typeof payload.currency === 'string' && /^[A-Z]{3}$/.test(payload.currency) ? payload.currency : '',
    tier: clean(payload.tier, 60),
    isPublic,
    raised: typeof payload.raised === 'number' && Number.isFinite(payload.raised) ? payload.raised : null,
    blockedSample: (test || payload.test === true) && payload.blk === true,
    test: test || payload.test === true,
  };
}

// ---------- Reglas por tipo de aviso ----------

export type KofiSound = 'none' | 'synth-bell' | 'arcade-chime' | 'retro-fanfare' | 'custom';
export const KOFI_SOUNDS: { id: KofiSound; name: string }[] = [
  { id: 'none', name: 'Ninguno' },
  { id: 'synth-bell', name: 'Campana' },
  { id: 'arcade-chime', name: 'Monedas' },
  { id: 'retro-fanfare', name: 'Fanfarria' },
  { id: 'custom', name: 'Mi archivo' },
];

export interface KofiEventRule {
  on: boolean;
  /** Texto con {nombre}, {cantidad}, {moneda}, {mensaje} y {nivel}. */
  tpl: string;
  snd: KofiSound;
  /** Archivo subido, cuando snd es `custom`. */
  sndUrl: string;
  /** Nombre del archivo y su id en el almacén, para poder liberarlo. */
  sndName: string;
  sndId: string;
  voz: boolean;
  min: number;
  meta: boolean;
  /** Solo donaciones: desde qué cantidad la alerta es grande. */
  big: number;
  /** Solo membresías: nombre del nivel que lanza la alerta; vacío, todos. */
  tier: string;
}

export const DEFAULT_KOFI_RULES: Record<KofiKind, KofiEventRule> = {
  don: { on: true, tpl: 'Gracias, {nombre}', snd: 'arcade-chime', sndUrl: '', sndName: '', sndId: '', voz: true, min: 1, meta: true, big: 20, tier: '' },
  mem: { on: true, tpl: '{nombre} se une a {nivel}', snd: 'retro-fanfare', sndUrl: '', sndName: '', sndId: '', voz: true, min: 0, meta: true, big: 0, tier: '' },
  ren: { on: true, tpl: '{nombre} renueva {nivel}', snd: 'synth-bell', sndUrl: '', sndName: '', sndId: '', voz: false, min: 0, meta: true, big: 0, tier: '' },
  shop: { on: true, tpl: '{nombre} compró en la tienda', snd: 'synth-bell', sndUrl: '', sndName: '', sndId: '', voz: false, min: 0, meta: false, big: 0, tier: '' },
  com: { on: true, tpl: '{nombre} encargó una comisión', snd: 'synth-bell', sndUrl: '', sndName: '', sndId: '', voz: false, min: 0, meta: false, big: 0, tier: '' },
};

export const DEFAULT_GOAL_CURRENCY = 'EUR';
export const KOFI_TEMPLATE_MAX = 80;

const num = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

export function normalizeKofiRule(kind: KofiKind, raw: unknown): KofiEventRule {
  const src = isObject(raw) ? raw : {};
  const d = DEFAULT_KOFI_RULES[kind];
  const tpl = typeof src.tpl === 'string' ? src.tpl.slice(0, KOFI_TEMPLATE_MAX) : d.tpl;
  // Un archivo incrustado (data:) solo vive en este navegador y es largo; una dirección, corta
  const rawUrl = typeof src.sndUrl === 'string' ? src.sndUrl : '';
  const sndUrl = rawUrl.startsWith('data:') ? rawUrl.slice(0, 600_000) : rawUrl.slice(0, 600);
  return {
    on: bool(src.on, d.on),
    tpl,
    snd: KOFI_SOUNDS.some((item) => item.id === src.snd) ? (src.snd as KofiSound) : d.snd,
    sndUrl,
    sndName: clean(src.sndName, 120),
    sndId: clean(src.sndId, 80),
    voz: bool(src.voz, d.voz),
    min: Math.round(num(src.min, 0, 10000, d.min) * 100) / 100,
    meta: bool(src.meta, d.meta),
    big: kind === 'don' ? Math.round(num(src.big, 1, 10000, d.big) * 100) / 100 : 0,
    tier: kind === 'mem' || kind === 'ren' ? clean(src.tier, 40) : '',
  };
}

export interface KofiRuleSet {
  events: Record<KofiKind, KofiEventRule>;
  goalCurrency: string;
}

/** Las reglas que hay dentro de los ajustes sincronizados del módulo «kofi», con sus valores por defecto. */
export function readKofiRules(config: unknown): KofiRuleSet {
  const src = isObject(config) ? config : {};
  const events = isObject(src.events) ? src.events : {};
  const goal = isObject(src.goal) ? src.goal : {};
  const currency = typeof goal.currency === 'string' && /^[A-Za-z]{3}$/.test(goal.currency.trim()) ? goal.currency.trim().toUpperCase() : DEFAULT_GOAL_CURRENCY;
  return {
    events: Object.fromEntries(KOFI_KINDS.map((kind) => [kind, normalizeKofiRule(kind, events[kind])])) as Record<KofiKind, KofiEventRule>,
    goalCurrency: currency,
  };
}

export type KofiSkip = 'tier' | 'min';

/** ¿El aviso cuenta? Un nivel que no es el elegido o una cantidad por debajo del mínimo no cuentan para nada. */
export function kofiSkip(event: Pick<KofiEvent, 'kind' | 'amount' | 'tier'>, rule: KofiEventRule): KofiSkip | null {
  const wanted = rule.tier.trim().toLowerCase();
  if (wanted && event.tier && wanted !== event.tier.trim().toLowerCase()) return 'tier';
  if (event.amount < rule.min) return 'min';
  return null;
}

/** Cuánto suma el aviso a la meta: su cantidad, solo si el tipo suma y la moneda es la de la meta. */
export function kofiGoalAdd(event: Pick<KofiEvent, 'kind' | 'amount' | 'tier' | 'currency'>, rules: KofiRuleSet): number {
  const rule = rules.events[event.kind];
  if (!rule.meta || kofiSkip(event, rule)) return 0;
  return event.currency === rules.goalCurrency ? event.amount : 0;
}

export const isBigDonation = (event: Pick<KofiEvent, 'kind' | 'amount'>, rule: KofiEventRule): boolean =>
  event.kind === 'don' && rule.big > 0 && event.amount >= rule.big;

/** 12,5 -> «12,50». */
export const kofiMoney = (amount: number): string => (Math.round(amount * 100) / 100).toFixed(2).replace('.', ',');

export function fillKofiTemplate(template: string, values: { nombre: string; cantidad: string; moneda: string; mensaje: string; nivel: string }): string {
  const filled = template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? values[key as keyof typeof values] : match));
  return filled.replace(/\s+/g, ' ').trim();
}

export interface KofiDecision {
  /** Por qué no cuenta, o null si cuenta (últimos apoyos y, si toca, meta). */
  skip: KofiSkip | null;
  /** Sale la alerta. */
  alert: boolean;
  big: boolean;
  /** Segundos en pantalla. */
  hold: number;
  title: string;
  /** Mensaje que se enseña: vacío si es privado o lo retuvo el filtro. */
  message: string;
  /** La voz lee el mensaje. */
  voice: boolean;
  goalAdd: number;
}

/**
 * Qué hace Lalo con un aviso. `blocked` es true si el mensaje tiene una palabra
 * bloqueada: entonces ni se ve ni se lee.
 */
export function decideKofi(event: KofiEvent, rules: KofiRuleSet, holdSeconds: number, blocked: boolean): KofiDecision {
  const rule = rules.events[event.kind];
  const skip = kofiSkip(event, rule);
  const big = isBigDonation(event, rule);
  const message = event.isPublic && !blocked ? event.message : '';
  const title =
    fillKofiTemplate(rule.tpl, {
      nombre: event.name,
      cantidad: kofiMoney(event.amount),
      moneda: event.currency,
      mensaje: message,
      nivel: event.tier,
    }) || event.name;
  return {
    skip,
    alert: !skip && rule.on,
    big,
    hold: holdSeconds * (big ? 1.5 : 1),
    title,
    message,
    voice: !skip && rule.on && rule.voz && Boolean(message),
    goalAdd: kofiGoalAdd(event, rules),
  };
}

/** Avisos que pueden esperar su turno. Los que no caben se descartan. */
export const KOFI_QUEUE_MAX = 8;
export function enqueueKofi<T>(queue: readonly T[], item: T, max = KOFI_QUEUE_MAX): T[] {
  return queue.length >= max ? [...queue] : [...queue, item];
}

export interface KofiRecent {
  name: string;
  amount: number;
  currency: string;
  kind: KofiKind;
}

export const KOFI_RECENT_MAX = 5;

export function readKofiRecent(raw: unknown): KofiRecent[] {
  return (Array.isArray(raw) ? raw : [])
    .filter(isObject)
    .filter((item) => KOFI_KINDS.includes(item.kind as KofiKind))
    .map((item) => ({
      name: clean(item.name, 60) || PRIVATE_NAME,
      amount: kofiAmount(item.amount),
      currency: typeof item.currency === 'string' ? item.currency.slice(0, 3) : '',
      kind: item.kind as KofiKind,
    }))
    .slice(0, KOFI_RECENT_MAX);
}

export const pushKofiRecent = (list: readonly KofiRecent[], item: KofiRecent): KofiRecent[] => [item, ...list].slice(0, KOFI_RECENT_MAX);
