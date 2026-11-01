/**
 * server/paypal/handlers.ts
 *
 * Cobro con suscripciones recurrentes de PayPal: /api/paypal/<acción>.
 *
 *   catalog      GET   planes con precio activo y sincronizado con PayPal
 *   subscribe    POST  { planId, months } crea la suscripción en PayPal (queda «pending») y devuelve approveUrl
 *   confirm      POST  { subscriptionId } consulta a PayPal el estado real; NO activa el plan
 *   status       GET   estado de la suscripción del streamer y si tiene acceso
 *   cancel       POST  cancela en PayPal; el plan se conserva hasta paid_until
 *   admin-prices GET/POST (admin) precios por plan y periodo
 *   admin-sync   POST  (admin) crea en PayPal el Product y los Billing Plans que falten
 *   webhook      POST  avisos de PayPal (sin sesión; se verifica la firma con PayPal)
 *   expire       GET/POST  tarea diaria (Vercel Cron, con CRON_SECRET): devuelve al plan por defecto a quien venció
 *
 * El plan SOLO se activa con PAYMENT.SALE.COMPLETED verificado. Ni el navegador, ni return_url, ni
 * «confirm» lo activan. Nunca se registran secretos ni cuerpos de avisos completos.
 */

import { defaultDeps, fail, headerOf, isFail, type Deps, type IntegrationRequest, type IntegrationResult } from '../integrations/http.js';
import { safeEqual } from '../integrations/crypto.js';
import { publicBase } from '../integrations/kofi.js';
import { MigrationMissingError, type Env } from '../integrations/store.js';
import { createPaypalClient, paypalEnvOf, paypalMissing, PaypalError, readPaypalConfig, type PaypalClient } from './client.js';
import { supabasePaypalDb, type PaypalDb, type PriceRow, type SubscriptionRow } from './db.js';
import { PERIODS, applyTransition, hasAccess, isPeriod, transitionFor, type SubStatus } from './logic.js';

export const PAYPAL_ACTIONS = ['catalog', 'subscribe', 'confirm', 'status', 'cancel', 'admin-prices', 'admin-sync', 'webhook', 'expire'] as const;
export type PaypalAction = (typeof PAYPAL_ACTIONS)[number];

const PRODUCT_SETTING = (mode: string) => `paypal_product_id_${mode}`;
const SYNC_ENV_SETTING = 'paypal_synced_env';
const PLAN_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const PAYPAL_ID = /^[A-Za-z0-9-]{3,64}$/;
const PRICE_MAX = 100000;

function paypalFailure(err: unknown, where: string): IntegrationResult {
  if (err instanceof MigrationMissingError) return fail(503, 'migration_missing', 'Falta aplicar la migración 0046 (cobro con PayPal) en Supabase.');
  if (err instanceof PaypalError) {
    console.error(`[Lalo paypal] ${where}: PayPal ${err.status} ${err.name}`);
    return fail(502, 'paypal_error', 'PayPal no pudo completar la operación. Prueba de nuevo en un momento.');
  }
  console.error(`[Lalo paypal] ${where}:`, err instanceof Error ? err.message : 'error desconocido');
  return fail(502, 'server_error', 'El servidor no pudo completar la operación. Prueba de nuevo en un momento.');
}

function bodyOf(req: IntegrationRequest): Record<string, unknown> {
  let value = req.body;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const periodKey = (months: number): string => String(months);

/** Origen al que PayPal devuelve al streamer: el del sitio configurado, o el de la petición. */
function originOf(req: IntegrationRequest, env: Env): string {
  const base = publicBase(env);
  if (base) return base;
  const origin = headerOf(req, 'origin');
  try {
    const url = new URL(origin);
    if (url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1') return url.origin;
  } catch {
    /* sin origen válido */
  }
  return '';
}

const subscriptionView = (sub: SubscriptionRow | null, planName: string | null, now: Date) => {
  if (!sub) return { subscription: null, hasAccess: false };
  const paidUntil = sub.paid_until ? new Date(sub.paid_until) : null;
  return {
    subscription: {
      status: sub.status,
      planId: sub.plan_id,
      planName: planName ?? sub.plan_id,
      months: sub.months,
      paidUntil: sub.paid_until,
      lastPaymentAt: sub.last_payment_at,
      startedAt: sub.started_at,
    },
    hasAccess: hasAccess({ status: sub.status, paidUntil }, now),
  };
};

async function statusBody(db: PaypalDb, profileId: string, now: Date): Promise<Record<string, unknown>> {
  // Si el cron falló, aquí nadie ve acceso caducado
  await db.expireDue().catch((err) => {
    if (err instanceof MigrationMissingError) throw err;
  });
  const sub = await db.currentSubscription(profileId);
  const plans = sub ? await db.plans() : [];
  return subscriptionView(sub, plans.find((p) => p.id === sub?.plan_id)?.name ?? null, now);
}

// ---------- Catálogo ----------

async function catalog(db: PaypalDb, env: Env): Promise<IntegrationResult> {
  const mode = paypalEnvOf(env);
  const enabled = paypalMissing(env).length === 0;
  if (!enabled) return { status: 200, body: { enabled: false, env: mode, plans: [] } };
  // Los ids de plan de PayPal valen para un solo entorno: si se cambió de sandbox a live sin sincronizar, no se ofrece nada
  const syncedEnv = await db.setting(SYNC_ENV_SETTING);
  const [plans, prices] = await Promise.all([db.plans(), db.prices()]);
  const offered = syncedEnv === mode ? prices.filter((p) => p.active && p.paypal_plan_id) : [];
  const out = plans
    .map((plan) => {
      const map: Record<string, number | null> = {};
      PERIODS.forEach((m) => {
        map[periodKey(m)] = offered.find((p) => p.plan_id === plan.id && p.months === m)?.price_usd ?? null;
      });
      return { id: plan.id, name: plan.name, prices: map };
    })
    .filter((plan) => Object.values(plan.prices).some((v) => v !== null));
  return { status: 200, body: { enabled: true, env: mode, plans: out } };
}

// ---------- Suscribirse, confirmar, cancelar ----------

async function subscribe(req: IntegrationRequest, env: Env, db: PaypalDb, client: PaypalClient, profileId: string, now: Date): Promise<IntegrationResult> {
  const body = bodyOf(req);
  const planId = typeof body.planId === 'string' ? body.planId.trim() : '';
  const months = typeof body.months === 'number' ? body.months : Number.NaN;
  if (!PLAN_ID.test(planId)) return fail(400, 'bad_plan', 'Plan no válido.');
  if (!isPeriod(months)) return fail(400, 'bad_months', 'El periodo debe ser 1, 3, 6 o 12 meses.');

  const prices = await db.prices();
  const price = prices.find((p) => p.plan_id === planId && p.months === months && p.active && p.paypal_plan_id);
  if (!price || !price.paypal_plan_id) return fail(404, 'not_offered', 'Ese plan o periodo no está disponible.');

  const current = await db.currentSubscription(profileId);
  if (current && (current.status === 'active' || current.status === 'grace') && hasAccess({ status: current.status, paidUntil: current.paid_until ? new Date(current.paid_until) : null }, now)) {
    return fail(409, 'already_subscribed', 'Ya tienes una suscripción activa. Cancélala antes de cambiar de plan.');
  }

  const origin = originOf(req, env);
  if (!origin) return fail(400, 'no_origin', 'No se pudo saber la dirección del sitio para volver tras el pago.');

  const created = await client.request<{ id?: string; links?: { rel?: string; href?: string }[] }>('POST', '/v1/billing/subscriptions', {
    plan_id: price.paypal_plan_id,
    custom_id: profileId,
    application_context: {
      brand_name: 'Lalo',
      user_action: 'SUBSCRIBE_NOW',
      shipping_preference: 'NO_SHIPPING',
      return_url: `${origin}/?paypal=ok#cuenta`,
      cancel_url: `${origin}/?paypal=cancel#cuenta`,
    },
  });
  const subscriptionId = created.id ?? '';
  const approveUrl = created.links?.find((l) => l.rel === 'approve')?.href ?? '';
  let approveHost = '';
  try {
    approveHost = new URL(approveUrl).hostname;
  } catch {
    /* url inválida */
  }
  if (!PAYPAL_ID.test(subscriptionId) || !(approveHost === 'paypal.com' || approveHost.endsWith('.paypal.com'))) {
    console.error('[Lalo paypal] subscribe: respuesta inesperada de PayPal');
    return fail(502, 'paypal_error', 'PayPal no devolvió una suscripción válida. Prueba de nuevo.');
  }

  await db.insertSubscription({
    profile_id: profileId,
    plan_id: planId,
    months,
    price_usd: price.price_usd,
    paypal_subscription_id: subscriptionId,
    status: 'pending',
    started_at: now.toISOString(),
  });
  return { status: 200, body: { approveUrl, subscriptionId } };
}

async function confirm(req: IntegrationRequest, db: PaypalDb, client: PaypalClient, profileId: string, now: Date): Promise<IntegrationResult> {
  const subscriptionId = typeof bodyOf(req).subscriptionId === 'string' ? (bodyOf(req).subscriptionId as string).trim() : '';
  if (!PAYPAL_ID.test(subscriptionId)) return fail(400, 'bad_subscription', 'Suscripción no válida.');
  const sub = await db.subscriptionByPaypalId(subscriptionId);
  // Una suscripción ajena se responde igual que una inexistente
  if (!sub || sub.profile_id !== profileId) return fail(404, 'not_found', 'No se encontró esa suscripción.');

  const remote = await client.request<{ status?: string }>('GET', `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`);
  // Solo se reflejan estados que QUITAN renovación. «ACTIVE» no abre nada: el acceso lo da el pago confirmado por webhook
  const kind = ({ CANCELLED: 'cancelled', SUSPENDED: 'suspended', EXPIRED: 'expired' } as Record<string, 'cancelled' | 'suspended' | 'expired'>)[String(remote.status ?? '')];
  if (kind && sub.status !== kind) {
    const next = applyTransition(
      { status: sub.status, months: sub.months, paidUntil: sub.paid_until ? new Date(sub.paid_until) : null, lastPaymentAt: sub.last_payment_at ? new Date(sub.last_payment_at) : null },
      { kind, subscriptionId },
      now
    );
    await db.updateSubscription(subscriptionId, { status: next.status });
  }
  return { status: 200, body: await statusBody(db, profileId, now) };
}

async function cancel(db: PaypalDb, client: PaypalClient, profileId: string, now: Date): Promise<IntegrationResult> {
  const sub = await db.currentSubscription(profileId);
  if (!sub || sub.status === 'cancelled' || sub.status === 'expired') return fail(409, 'nothing_to_cancel', 'No tienes una suscripción que cancelar.');
  try {
    await client.request('POST', `/v1/billing/subscriptions/${encodeURIComponent(sub.paypal_subscription_id)}/cancel`, { reason: 'Cancelada por el streamer desde Lalo' });
  } catch (err) {
    // 422: PayPal ya la tenía cancelada o terminada. Para el streamer el resultado es el mismo
    if (!(err instanceof PaypalError && err.status === 422)) throw err;
  }
  await db.updateSubscription(sub.paypal_subscription_id, { status: 'cancelled' });
  return { status: 200, body: await statusBody(db, profileId, now) };
}

// ---------- Administración ----------

async function adminView(db: PaypalDb, env: Env): Promise<Record<string, unknown>> {
  const [plans, prices, productId, syncedEnv] = await Promise.all([db.plans(), db.prices(), db.setting(PRODUCT_SETTING(paypalEnvOf(env))), db.setting(SYNC_ENV_SETTING)]);
  return {
    enabled: paypalMissing(env).length === 0,
    missing: paypalMissing(env),
    env: paypalEnvOf(env),
    syncedEnv,
    productId,
    plans: plans.map((plan) => {
      const map: Record<string, { priceUsd: number; active: boolean; paypalPlanId: string | null } | null> = {};
      PERIODS.forEach((m) => {
        const row = prices.find((p) => p.plan_id === plan.id && p.months === m);
        map[periodKey(m)] = row ? { priceUsd: row.price_usd, active: row.active, paypalPlanId: row.paypal_plan_id } : null;
      });
      return { id: plan.id, name: plan.name, isDefault: plan.is_default, prices: map };
    }),
  };
}

async function adminSetPrice(req: IntegrationRequest, env: Env, db: PaypalDb): Promise<IntegrationResult> {
  const body = bodyOf(req);
  const planId = typeof body.planId === 'string' ? body.planId.trim() : '';
  const months = typeof body.months === 'number' ? body.months : Number.NaN;
  if (!PLAN_ID.test(planId)) return fail(400, 'bad_plan', 'Plan no válido.');
  if (!isPeriod(months)) return fail(400, 'bad_months', 'El periodo debe ser 1, 3, 6 o 12 meses.');
  if (typeof body.active !== 'boolean') return fail(400, 'bad_active', 'Falta indicar si el precio está activo.');
  let priceUsd: number | null = null;
  if (body.priceUsd !== null && body.priceUsd !== undefined) {
    const raw = typeof body.priceUsd === 'number' ? body.priceUsd : Number.NaN;
    if (!Number.isFinite(raw) || raw <= 0 || raw > PRICE_MAX) return fail(400, 'bad_price', `El precio debe ser mayor que 0 y como mucho ${PRICE_MAX}.`);
    priceUsd = Math.round(raw * 100) / 100;
  }
  const plans = await db.plans();
  if (!plans.some((p) => p.id === planId)) return fail(404, 'plan_not_found', 'Ese plan no existe.');

  const live: PriceRow | undefined = (await db.prices()).find((p) => p.plan_id === planId && p.months === months);
  if (priceUsd === null) {
    // Sin precio: se oculta lo que hubiera
    if (live && live.active) await db.updatePrice(live.id, { active: false });
  } else if (!live) {
    await db.insertPrice({ plan_id: planId, months, price_usd: priceUsd, active: body.active });
  } else if (live.paypal_plan_id && live.price_usd !== priceUsd) {
    // PayPal no deja cambiar el precio de un plan ya creado: se archiva y nace uno nuevo, pendiente de sincronizar
    await db.updatePrice(live.id, { archived: true, active: false });
    await db.insertPrice({ plan_id: planId, months, price_usd: priceUsd, active: body.active });
  } else {
    await db.updatePrice(live.id, { price_usd: priceUsd, active: body.active });
  }
  return { status: 200, body: await adminView(db, env) };
}

async function adminSync(env: Env, db: PaypalDb, client: PaypalClient): Promise<IntegrationResult> {
  const mode = paypalEnvOf(env);
  // Los ids de PayPal de sandbox no valen en live: al cambiar de entorno se vuelve a empezar
  const syncedEnv = await db.setting(SYNC_ENV_SETTING);
  let prices = await db.prices();
  if (syncedEnv && syncedEnv !== mode) {
    for (const row of prices.filter((p) => p.paypal_plan_id)) await db.updatePrice(row.id, { paypal_plan_id: null });
    prices = await db.prices();
  }

  let productId = await db.setting(PRODUCT_SETTING(mode));
  const pending = prices.filter((p) => p.active && !p.paypal_plan_id);
  if (pending.length > 0 && !productId) {
    const product = await client.request<{ id?: string }>('POST', '/v1/catalogs/products', {
      name: 'Lalo',
      description: 'Planes de Lalo para streamers',
      type: 'SERVICE',
      category: 'SOFTWARE',
    });
    if (!product.id) return fail(502, 'paypal_error', 'PayPal no devolvió el producto.');
    productId = product.id;
    await db.putSetting(PRODUCT_SETTING(mode), productId);
  }

  const plans = await db.plans();
  let failed = 0;
  for (const row of pending) {
    try {
      const planName = plans.find((p) => p.id === row.plan_id)?.name ?? row.plan_id;
      const created = await client.request<{ id?: string; status?: string }>('POST', '/v1/billing/plans', {
        product_id: productId,
        name: `Lalo ${planName} - ${row.months} ${row.months === 1 ? 'mes' : 'meses'}`.slice(0, 120),
        status: 'ACTIVE',
        billing_cycles: [
          {
            frequency: { interval_unit: 'MONTH', interval_count: row.months },
            tenure_type: 'REGULAR',
            sequence: 1,
            total_cycles: 0,
            pricing_scheme: { fixed_price: { value: row.price_usd.toFixed(2), currency_code: 'USD' } },
          },
        ],
        payment_preferences: {
          auto_bill_outstanding: true,
          setup_fee: { value: '0', currency_code: 'USD' },
          setup_fee_failure_action: 'CANCEL',
          payment_failure_threshold: 3,
        },
      });
      if (!created.id) throw new PaypalError(502, 'NO_PLAN_ID');
      if (created.status !== 'ACTIVE') await client.request('POST', `/v1/billing/plans/${encodeURIComponent(created.id)}/activate`);
      await db.updatePrice(row.id, { paypal_plan_id: created.id });
    } catch (err) {
      failed += 1;
      console.error('[Lalo paypal] admin-sync: no se pudo crear un plan:', err instanceof PaypalError ? `${err.status} ${err.name}` : 'error');
    }
  }
  await db.putSetting(SYNC_ENV_SETTING, mode);
  const view = await adminView(db, env);
  return { status: 200, body: { ...view, synced: pending.length - failed, failed } };
}

// ---------- Webhook ----------

/** Solo lo necesario para auditar: nada de datos personales del pagador. */
function auditPayload(event: Record<string, unknown>): Record<string, unknown> {
  const res = (event.resource && typeof event.resource === 'object' ? event.resource : {}) as Record<string, unknown>;
  const pick = (v: unknown) => (typeof v === 'string' ? v.slice(0, 80) : null);
  return { event_type: pick(event.event_type), create_time: pick(event.create_time), resource_id: pick(res.id), state: pick(res.state), status: pick(res.status), billing_agreement_id: pick(res.billing_agreement_id) };
}

async function webhook(req: IntegrationRequest, deps: Deps, db: PaypalDb, client: PaypalClient, webhookId: string): Promise<IntegrationResult> {
  if (req.method.toUpperCase() !== 'POST') return fail(405, 'method', 'Esta ruta solo admite POST.');
  const event = bodyOf(req);
  const eventId = typeof event.id === 'string' ? event.id.trim() : '';
  const eventType = typeof event.event_type === 'string' ? event.event_type : '';
  if (!eventId || !eventType || eventId.length > 100) return fail(400, 'bad_event', 'Aviso no válido.');

  const headers = {
    auth_algo: headerOf(req, 'paypal-auth-algo'),
    cert_url: headerOf(req, 'paypal-cert-url'),
    transmission_id: headerOf(req, 'paypal-transmission-id'),
    transmission_sig: headerOf(req, 'paypal-transmission-sig'),
    transmission_time: headerOf(req, 'paypal-transmission-time'),
  };
  if (Object.values(headers).some((v) => !v)) return fail(400, 'bad_signature', 'Firma no válida.');

  // La firma la comprueba PayPal. Un fallo de red no es una firma mala: se responde 503 para que PayPal reintente
  let verification: { verification_status?: string };
  try {
    verification = await client.request('POST', '/v1/notifications/verify-webhook-signature', { ...headers, webhook_id: webhookId, webhook_event: event });
  } catch (err) {
    if (err instanceof PaypalError && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 429) {
      return fail(400, 'bad_signature', 'Firma no válida.');
    }
    return paypalFailure(err, 'webhook/verify');
  }
  if (verification.verification_status !== 'SUCCESS') return fail(400, 'bad_signature', 'Firma no válida.');

  const transition = transitionFor(eventType, event.resource);
  const claimed = await db.claimEvent({ id: eventId, type: eventType.slice(0, 100), subscriptionId: transition.subscriptionId, payload: auditPayload(event) });
  if (!claimed) return { status: 200, body: { ok: true, duplicate: true } };

  try {
    if (transition.kind !== 'ignore') {
      const sub = await db.subscriptionByPaypalId(transition.subscriptionId);
      if (sub) {
        const now = new Date(deps.now());
        const next = applyTransition(
          { status: sub.status, months: sub.months, paidUntil: sub.paid_until ? new Date(sub.paid_until) : null, lastPaymentAt: sub.last_payment_at ? new Date(sub.last_payment_at) : null },
          transition,
          now
        );
        const patch: Partial<Pick<SubscriptionRow, 'status' | 'paid_until' | 'last_payment_at'>> = { status: next.status as SubStatus };
        if (next.grantPlan && next.paidUntil) {
          patch.paid_until = next.paidUntil.toISOString();
          patch.last_payment_at = (next.lastPaymentAt ?? now).toISOString();
        }
        await db.updateSubscription(sub.paypal_subscription_id, patch);
        if (next.grantPlan && next.paidUntil) await db.grantPlan(sub.profile_id, sub.plan_id, next.paidUntil.toISOString());
        else await db.expireDue().catch(() => 0);
      }
    }
  } catch (err) {
    // Se libera el id para que el reintento de PayPal pueda procesarlo
    await db.releaseEvent(eventId).catch(() => undefined);
    return paypalFailure(err, 'webhook/apply');
  }
  return { status: 200, body: { ok: true } };
}

// ---------- Entrada ----------

export async function handlePaypal(
  action: PaypalAction,
  req: IntegrationRequest,
  env: Env,
  deps: Deps = defaultDeps,
  dbOverride?: PaypalDb | null
): Promise<IntegrationResult> {
  const method = req.method.toUpperCase();
  try {
    const db = dbOverride === undefined ? supabasePaypalDb(env) : dbOverride;
    if (!db) return fail(503, 'not_configured', 'Al servidor le faltan variables para hablar con la base de datos.');
    const config = readPaypalConfig(env);
    const client = config ? createPaypalClient(config, (input, init) => deps.fetch(input, init), deps.now) : null;
    const now = new Date(deps.now());

    if (action === 'expire') {
      const secret = (env.CRON_SECRET ?? '').trim();
      const given = headerOf(req, 'authorization').replace(/^Bearer\s+/i, '').trim();
      if (!secret) return fail(503, 'not_configured', 'Falta CRON_SECRET en el servidor.');
      if (!given || !safeEqual(given, secret)) return fail(401, 'unauthorized', 'No autorizado.');
      return { status: 200, body: { expired: await db.expireDue() } };
    }

    if (action === 'webhook') {
      if (!config || !client) return fail(503, 'not_configured', 'El cobro con PayPal no está configurado.');
      return await webhook(req, deps, db, client, config.webhookId);
    }

    const caller = await deps.auth(req, env);
    if (isFail(caller)) return caller;

    switch (action) {
      case 'catalog':
        if (method !== 'GET') return fail(405, 'method', 'Esta ruta solo admite GET.');
        return await catalog(db, env);
      case 'status':
        if (method !== 'GET') return fail(405, 'method', 'Esta ruta solo admite GET.');
        return { status: 200, body: await statusBody(db, caller.id, now) };
      case 'subscribe':
      case 'confirm':
      case 'cancel': {
        if (method !== 'POST') return fail(405, 'method', 'Esta ruta solo admite POST.');
        if (!client) return fail(503, 'not_configured', 'El cobro con PayPal no está configurado.');
        if (action === 'subscribe') return await subscribe(req, env, db, client, caller.id, now);
        if (action === 'confirm') return await confirm(req, db, client, caller.id, now);
        return await cancel(db, client, caller.id, now);
      }
      case 'admin-prices':
      case 'admin-sync': {
        if (caller.role !== 'admin') return fail(403, 'not_admin', 'Solo para administradores.');
        if (action === 'admin-prices') {
          if (method === 'GET') return { status: 200, body: await adminView(db, env) };
          if (method === 'POST') return await adminSetPrice(req, env, db);
          return fail(405, 'method', 'Esta ruta solo admite GET y POST.');
        }
        if (method !== 'POST') return fail(405, 'method', 'Esta ruta solo admite POST.');
        if (!client) return fail(503, 'not_configured', 'El cobro con PayPal no está configurado.');
        return await adminSync(env, db, client);
      }
      default:
        return fail(404, 'not_found', 'Ruta no encontrada.');
    }
  } catch (err) {
    return paypalFailure(err, action);
  }
}
