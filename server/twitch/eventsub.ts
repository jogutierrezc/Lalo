/**
 * server/twitch/eventsub.ts
 *
 * POST /api/twitch/eventsub: la dirección a la que Twitch envía los avisos de
 * EventSub (bits, Power-ups y canjes de puntos). La usan la función de Vercel
 * (api/twitch/eventsub.ts) y el servidor local (server/index.ts).
 *
 * La ruta es pública y escribe en la base de datos con la clave de servicio.
 * Por eso, antes de mirar el contenido:
 *   1. Comprueba la firma HMAC-SHA256 de Twitch sobre el cuerpo TAL COMO LLEGÓ
 *      (id del mensaje + fecha + cuerpo), con el secreto TWITCH_EVENTSUB_SECRET.
 *   2. Descarta los mensajes con más de diez minutos (repeticiones).
 *   3. Descarta los mensajes ya vistos (por id): aquí en memoria y, de verdad,
 *      en la base de datos, donde el id del mensaje es único.
 * Solo después lee el cuerpo, lo reduce a lo mínimo y lo guarda para la capa de
 * OBS del streamer dueño de ese canal. Nunca se escribe el secreto ni el cuerpo
 * en el registro.
 *
 * Twitch (comprobado en dev.twitch.tv el 2026-10-04):
 *   - Cabeceras Twitch-Eventsub-Message-Id, -Timestamp, -Signature y -Type
 *     (notification, webhook_callback_verification, revocation).
 *     https://dev.twitch.tv/docs/eventsub/handling-webhook-events/
 *   - Firma: "sha256=" + HMAC-SHA256(secreto, id + fecha + cuerpo sin tocar).
 *   - Verificación: responder 200, text/plain, con el valor de `challenge`.
 *   - Repeticiones: fecha no mayor de 10 minutos e id no visto antes.
 *     https://dev.twitch.tv/docs/eventsub/#guarding-against-replay-attacks
 *   - Formas de los eventos: channel.bits.use, channel.custom_power_up_redemption.add
 *     y channel.channel_points_custom_reward_redemption.add en
 *     https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/
 *
 * SIN PROBAR contra Twitch ni contra Supabase reales.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type Env = Record<string, string | undefined>;

/** Antigüedad máxima de un mensaje. */
export const MAX_AGE_MS = 10 * 60 * 1000;
/** Margen para relojes desajustados: un mensaje «del futuro» por más de esto se descarta. */
export const MAX_FUTURE_MS = 2 * 60 * 1000;
/** Los avisos de Twitch son pequeños; nada mayor que esto se lee. */
export const MAX_BODY_BYTES = 64 * 1024;

export const EVENT_TYPES = {
  bits: 'channel.bits.use',
  powerup: 'channel.custom_power_up_redemption.add',
  points: 'channel.channel_points_custom_reward_redemption.add',
} as const;

// ---------- Firma ----------

/** Firma que Twitch pondría en la cabecera para ese mensaje. */
export function computeSignature(secret: string, messageId: string, timestamp: string, rawBody: string | Uint8Array): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(messageId);
  hmac.update(timestamp);
  hmac.update(rawBody);
  return `sha256=${hmac.digest('hex')}`;
}

/** Compara la firma recibida con la calculada, sin filtrar información por el tiempo que tarda. */
export function verifySignature(
  secret: string,
  messageId: string,
  timestamp: string,
  rawBody: string | Uint8Array,
  signature: string
): boolean {
  if (!secret || !messageId || !timestamp || !signature) return false;
  const expected = Buffer.from(computeSignature(secret, messageId, timestamp, rawBody), 'utf8');
  const received = Buffer.from(signature, 'utf8');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/** ¿La fecha del mensaje (RFC3339, con nanosegundos) está dentro de la ventana? */
export function timestampFresh(timestamp: string, now: number): boolean {
  if (typeof timestamp !== 'string' || timestamp.length > 40) return false;
  // Twitch envía nueve decimales; Date solo entiende tres con seguridad
  const at = Date.parse(timestamp.replace(/(\.\d{3})\d+/, '$1'));
  if (!Number.isFinite(at)) return false;
  return now - at <= MAX_AGE_MS && at - now <= MAX_FUTURE_MS;
}

/** El secreto debe tener entre 10 y 100 caracteres ASCII (regla de Twitch). */
export function validSecret(secret: string): boolean {
  return /^[\x21-\x7e]{10,100}$/.test(secret);
}

// ---------- Mensajes ya vistos ----------

export interface Deduper {
  /** true si el id ya se había visto; si no, lo apunta. */
  seen(id: string, now: number): boolean;
  forget(id: string): void;
  size(): number;
}

/** Memoria corta de ids. Sirve dentro de un proceso; entre procesos decide la base de datos. */
export function createDeduper(max = 1000, ttlMs = MAX_AGE_MS + MAX_FUTURE_MS): Deduper {
  const ids = new Map<string, number>();
  return {
    seen(id, now) {
      for (const [key, at] of ids) {
        if (now - at <= ttlMs) break;
        ids.delete(key);
      }
      if (ids.has(id)) return true;
      if (ids.size >= max) ids.delete(ids.keys().next().value as string);
      ids.set(id, now);
      return false;
    },
    forget: (id) => void ids.delete(id),
    size: () => ids.size,
  };
}

// ---------- Del aviso de Twitch a lo que guarda Lalo ----------

export type EventKind = 'bits' | 'powerup' | 'points';

export interface NormalizedEvent {
  kind: EventKind;
  /** Id de Twitch del canal: con él se busca al streamer dueño. */
  broadcasterId: string;
  /** Bits gastados (0 en los canjes de puntos). Solo `kind: 'bits'` suma a las metas. */
  bits: number;
  /** Lo mínimo que necesita la capa de OBS. Sin ids de espectadores. */
  payload: Record<string, unknown>;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Texto recortado y sin caracteres de control. */
const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';

const TWITCH_ID = /^\d{1,20}$/;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const LOGIN = /^[a-z0-9_]{1,25}$/;

const safeId = (value: unknown): string => (typeof value === 'string' && SAFE_ID.test(value) ? value : '');
const amount = (value: unknown, max: number): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? Math.min(value, max) : 0;

function viewer(event: Record<string, unknown>): { user: string; login: string } {
  const login = typeof event.user_login === 'string' && LOGIN.test(event.user_login) ? event.user_login : '';
  return { user: text(event.user_name, 40) || login || 'Espectador', login };
}

const BITS_TYPES = ['cheer', 'power_up', 'custom_power_up'] as const;
const BUILTIN_TYPES = ['message_effect', 'celebration', 'gigantify_an_emote'] as const;

/** Reduce un evento de Twitch a lo que Lalo guarda. null si el tipo no se usa o el evento no tiene la forma esperada. */
export function normalizeEvent(type: string, event: unknown): NormalizedEvent | null {
  if (!isObject(event)) return null;
  const broadcasterId = typeof event.broadcaster_user_id === 'string' && TWITCH_ID.test(event.broadcaster_user_id) ? event.broadcaster_user_id : '';
  if (!broadcasterId) return null;
  const who = viewer(event);

  if (type === EVENT_TYPES.bits) {
    const use = BITS_TYPES.find((item) => item === event.type);
    const bits = amount(event.bits, 1_000_000);
    if (!use || bits < 1) return null;
    const payload: Record<string, unknown> = { type: use, bits, ...who };
    const message = isObject(event.message) ? text(event.message.text, 500) : '';
    if (message) payload.text = message;
    if (use === 'power_up' && isObject(event.power_up)) {
      const builtin = BUILTIN_TYPES.find((item) => item === (event.power_up as Record<string, unknown>).type);
      if (builtin) {
        const emote = isObject(event.power_up.emote) ? event.power_up.emote : {};
        payload.powerUp = {
          type: builtin,
          emoteId: safeId(emote.id),
          emoteName: text(emote.name, 40),
          effectId: safeId(event.power_up.message_effect_id),
        };
      }
    }
    if (use === 'custom_power_up' && isObject(event.custom_power_up)) {
      payload.custom = { id: safeId(event.custom_power_up.reward_id), title: text(event.custom_power_up.title, 80) };
    }
    return { kind: 'bits', broadcasterId, bits, payload };
  }

  if (type === EVENT_TYPES.powerup) {
    const item = isObject(event.custom_power_up) ? event.custom_power_up : null;
    const id = item ? safeId(item.id) : '';
    if (!item || !id) return null;
    const bits = amount(item.bits, 1_000_000);
    return {
      kind: 'powerup',
      broadcasterId,
      // Los Bits de un Power-up personalizado ya llegan por channel.bits.use: aquí no se cuentan otra vez
      bits: 0,
      payload: { id, title: text(item.title, 80), bits, text: text(event.user_input, 500), ...who },
    };
  }

  if (type === EVENT_TYPES.points) {
    const reward = isObject(event.reward) ? event.reward : null;
    const rewardId = reward ? safeId(reward.id) : '';
    if (!reward || !rewardId) return null;
    return {
      kind: 'points',
      broadcasterId,
      bits: 0,
      payload: {
        rewardId: rewardId.toLowerCase(),
        title: text(reward.title, 80),
        cost: amount(reward.cost, 100_000_000),
        text: text(event.user_input, 500),
        ...who,
      },
    };
  }

  return null;
}

// ---------- Atención del aviso ----------

export interface WebhookInput {
  method: string;
  /** Lee una cabecera sin distinguir mayúsculas. */
  header: (name: string) => string;
  /** El cuerpo exactamente como llegó, o null si no se pudo leer así. */
  rawBody: string | Uint8Array | null;
}

export interface WebhookResult {
  status: number;
  body: string;
  contentType: 'text/plain' | 'application/json';
}

export type IngestOutcome = 'ok' | 'duplicate' | 'unknown_channel';
export type Ingest = (messageId: string, event: NormalizedEvent, env: Env) => Promise<IngestOutcome>;

interface Deps {
  now: () => number;
  ingest: Ingest;
  deduper: Deduper;
}

const json = (status: number, code: string): WebhookResult => ({
  status,
  body: JSON.stringify({ status: code }),
  contentType: 'application/json',
});

let serviceClient: { url: string; db: SupabaseClient } | null = null;

/** Guarda el evento con la clave de servicio, a través de la función SQL que hace todas las comprobaciones. */
const ingestWithSupabase: Ingest = async (messageId, event, env) => {
  const url = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '').trim();
  const key = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!url || !key) throw new Error('faltan las variables de Supabase del servidor');
  if (!serviceClient || serviceClient.url !== url) {
    serviceClient = { url, db: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) };
  }
  const { data, error } = await serviceClient.db.rpc('ingest_twitch_event', {
    p_message_id: messageId,
    p_twitch_user_id: event.broadcasterId,
    p_kind: event.kind,
    p_payload: event.payload,
    p_bits: event.bits,
  });
  if (error) throw new Error(error.message);
  return data === 'duplicate' || data === 'unknown_channel' ? data : 'ok';
};

const defaultDeps: Deps = { now: Date.now, ingest: ingestWithSupabase, deduper: createDeduper() };

const byteLength = (body: string | Uint8Array): number => (typeof body === 'string' ? Buffer.byteLength(body, 'utf8') : body.byteLength);
const bodyText = (body: string | Uint8Array): string => (typeof body === 'string' ? body : Buffer.from(body).toString('utf8'));

/** Atiende un aviso de Twitch. No lanza: siempre devuelve qué responder. */
export async function handleEventsub(input: WebhookInput, env: Env = process.env, deps: Partial<Deps> = {}): Promise<WebhookResult> {
  const { now, ingest, deduper } = { ...defaultDeps, ...deps };
  if (input.method.toUpperCase() !== 'POST') return json(405, 'method');

  const secret = (env.TWITCH_EVENTSUB_SECRET ?? '').trim();
  if (!validSecret(secret)) return json(503, 'not_configured');

  if (input.rawBody === null) return json(400, 'no_raw_body');
  if (byteLength(input.rawBody) > MAX_BODY_BYTES) return json(413, 'too_large');

  const messageId = input.header('twitch-eventsub-message-id');
  const timestamp = input.header('twitch-eventsub-message-timestamp');
  const signature = input.header('twitch-eventsub-message-signature');
  const messageType = input.header('twitch-eventsub-message-type');
  if (!messageId || messageId.length > 200 || !timestamp || !signature) return json(403, 'unsigned');
  if (!verifySignature(secret, messageId, timestamp, input.rawBody, signature)) return json(403, 'bad_signature');

  // Desde aquí el mensaje es de Twitch. Uno viejo o repetido se da por recibido sin hacer nada,
  // para que Twitch no lo cuente como fallo de entrega
  if (!timestampFresh(timestamp, now())) return json(200, 'stale');

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText(input.rawBody));
  } catch {
    return json(400, 'bad_json');
  }
  if (!isObject(parsed)) return json(400, 'bad_json');
  const subscription = isObject(parsed.subscription) ? parsed.subscription : {};
  const type = typeof subscription.type === 'string' ? subscription.type : '';

  if (messageType === 'webhook_callback_verification') {
    const challenge = typeof parsed.challenge === 'string' ? parsed.challenge : '';
    if (!challenge || challenge.length > 500) return json(400, 'bad_challenge');
    return { status: 200, body: challenge, contentType: 'text/plain' };
  }

  if (messageType === 'revocation') {
    // Twitch retiró la suscripción (permiso revocado, demasiados fallos...). El panel lo ve al listar las suscripciones
    console.warn(`[Lalo eventos] Twitch retiró una suscripción: ${type.slice(0, 80)} (${String(subscription.status).slice(0, 60)})`);
    return json(200, 'revoked');
  }

  if (messageType !== 'notification') return json(200, 'ignored');
  if (deduper.seen(messageId, now())) return json(200, 'duplicate');

  const event = normalizeEvent(type, parsed.event);
  if (!event) return json(200, 'ignored');
  // El canal del evento debe ser el mismo para el que se creó la suscripción
  const condition = isObject(subscription.condition) ? subscription.condition : {};
  if (condition.broadcaster_user_id !== event.broadcasterId) return json(200, 'ignored');

  try {
    const outcome = await ingest(messageId, event, env);
    return json(200, outcome);
  } catch (err) {
    // Que Twitch lo reintente: se olvida el id para que el reintento no se tome por repetido
    deduper.forget(messageId);
    console.error('[Lalo eventos] No se pudo guardar un evento:', err instanceof Error ? err.message : 'error desconocido');
    return json(500, 'store_failed');
  }
}

// ---------- Adaptadores ----------

/** Para la función de Vercel con firma web: el cuerpo se lee sin interpretar. */
export async function eventsubWebHandler(request: Request): Promise<Response> {
  let rawBody: string | null = null;
  try {
    const declared = Number(request.headers.get('content-length') ?? '0');
    if (!(declared > MAX_BODY_BYTES)) rawBody = await request.text();
  } catch {
    rawBody = null;
  }
  const result =
    rawBody === null && Number(request.headers.get('content-length') ?? '0') > MAX_BODY_BYTES
      ? json(413, 'too_large')
      : await handleEventsub({ method: request.method, header: (name) => request.headers.get(name) ?? '', rawBody });
  return new Response(result.body, {
    status: result.status,
    headers: { 'Content-Type': result.contentType, 'Cache-Control': 'no-store' },
  });
}

interface NodeLikeRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}
interface NodeLikeResponse {
  setHeader(name: string, value: string): unknown;
  status(code: number): { send(body: string): unknown };
}

/**
 * Para Express. La ruta debe montarse con express.raw({ type: () => true }) y ANTES de
 * express.json: si el cuerpo llega ya interpretado no se puede comprobar la firma.
 */
export async function eventsubNodeHandler(req: NodeLikeRequest, res: NodeLikeResponse): Promise<void> {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : typeof req.body === 'string' ? req.body : null;
  const result = await handleEventsub({
    method: req.method ?? 'GET',
    header: (name) => {
      const value = req.headers[name.toLowerCase()];
      return (Array.isArray(value) ? value[0] : value) ?? '';
    },
    rawBody,
  });
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Cache-Control', 'no-store');
  res.status(result.status).send(result.body);
}
