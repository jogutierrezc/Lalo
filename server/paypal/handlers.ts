/**
 * server/paypal/handlers.ts
 *
 * Cobro con suscripciones recurrentes de PayPal: /api/paypal/<acción>.
 *
 *   catalog      GET   planes (no archivados) con precio activo y sincronizado con PayPal; incluye clientId público
 *   subscribe    POST  { planId, months, flow?: 'redirect'|'sdk' } crea la suscripción en PayPal (queda «pending»); 'redirect' devuelve approveUrl, 'sdk' solo subscriptionId
 *   confirm      POST  { subscriptionId } consulta a PayPal el estado real; NO activa el plan
 *   status       GET   estado de la suscripción del streamer y si tiene acceso
 *   cancel       POST  cancela en PayPal; el plan se conserva hasta paid_until
 *   admin-prices GET/POST (admin) precios por plan y periodo
 *   admin-subscriptions GET (admin) suscripciones, totales y accesos por código (?before=<nextBefore> para paginar; cursor opaco "<updated_at>|<id>")
 *   admin-sync   POST  (admin) crea en PayPal el Product y los Billing Plans que falten
 *   payments     GET   historial de pagos del creador (máx. 100) y su próximo cobro; sin ids de PayPal
 *   admin-inbox  GET   (admin) bandeja de pagos: ítems que requieren atención, por urgencia
 *   admin-inbox-resolve POST (admin) { key, note? } marca un ítem de la bandeja como resuelto (con bitácora)
 *   admin-billing-summary GET (admin) facturación: ingresos de 6 meses, renovaciones, cobros fallidos, desglose y recibos (?receipts=N, máx. 50)
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
import { DuplicateSubscriptionError, supabasePaypalDb, type AdminCursor, type PaypalDb, type PriceRow, type SubscriptionRow } from './db.js';
import { supabaseReportsDb, type ReportsDb } from './reportsDb.js';
import { adminBillingSummaryBody, adminInboxBody, adminInboxResolve, paymentsBody } from './reports.js';
import { BILLING_CURRENCY, PERIODS, applyTransition, hasAccess, isPeriod, isStaleEvent, pendingVerdict, subscribeBlock, transitionFor, type SubStatus, type SubscribeBlock } from './logic.js';

export const PAYPAL_ACTIONS = ['catalog', 'subscribe', 'confirm', 'status', 'cancel', 'admin-prices', 'admin-sync', 'admin-subscriptions', 'payments', 'admin-inbox', 'admin-inbox-resolve', 'admin-billing-summary', 'webhook', 'expire'] as const;
export type PaypalAction = (typeof PAYPAL_ACTIONS)[number];

const PRODUCT_SETTING = (mode: string) => `paypal_product_id_${mode}`;
const SYNC_ENV_SETTING = 'paypal_synced_env';
const PLAN_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const PAYPAL_ID = /^[A-Za-z0-9-]{3,64}$/;
const PRICE_MAX = 100000;
/** El webhook es anónimo: nada de cuerpos enormes ni de certificados que no sean de PayPal. */
const WEBHOOK_MAX_BYTES = 64 * 1024;
/** Un aviso de reembolso o reverso de una venta que sigue sin registrarse pasadas estas horas se da por hecho (no se reintenta eternamente). */
const UNKNOWN_SALE_GIVE_UP_MS = 72 * 60 * 60 * 1000;
/** Longitud máxima de sale_id / refund_id que aceptan las funciones SQL (billing_apply_payment lanza invalid_sale por encima). */
const ID_MAX = 100;
const clipId = (value: string): string => value.slice(0, ID_MAX);
const PAYPAL_CERT_HOSTS = new Set(['api.paypal.com', 'api.sandbox.paypal.com', 'api-m.paypal.com', 'api-m.sandbox.paypal.com']);

/** La URL del certificado debe ser https, sin credenciales ni puerto, de un host de API de PayPal. */
export function isPaypalCertUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && PAYPAL_CERT_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

const BLOCK_MESSAGES: Record<SubscribeBlock, string> = {
  active: 'Ya tienes una suscripción activa. Cancélala antes de contratar otra.',
  suspended: 'Tu suscripción está suspendida en PayPal. Cancélala antes de contratar otra.',
  paid: 'Tu suscripción cancelada sigue pagada hasta que termine el periodo. Podrás contratar otra cuando venza.',
};

/** Una pending local que PayPal da por aprobada o activa: el pago ya está hecho o en camino (el webhook aún no llegó). */
const PENDING_LIVE_MESSAGE = 'Tu suscripción en PayPal ya fue aprobada y se está procesando. Espera un momento y revisa tu plan antes de contratar otra.';
const PENDING_CHECK_FAILED_MESSAGE = 'No pudimos comprobar en PayPal el estado de tu intento de pago anterior. Prueba de nuevo en un momento.';

/** Cancela en PayPal. 422 = ya estaba cancelada o terminada (o nunca se aprobó): para nosotros es lo mismo. */
async function cancelInPaypal(client: PaypalClient, paypalId: string, reason: string): Promise<void> {
  try {
    await client.request('POST', `/v1/billing/subscriptions/${encodeURIComponent(paypalId)}/cancel`, { reason });
  } catch (err) {
    if (!(err instanceof PaypalError && err.status === 422)) throw err;
  }
}

function paypalFailure(err: unknown, where: string): IntegrationResult {
  if (err instanceof MigrationMissingError) return fail(503, 'migration_missing', 'Falta aplicar una migración de cobro (0046 a 0051) en Supabase.');
  if (err instanceof PaypalError) {
    console.error(`[Tally Studio paypal] ${where}: PayPal ${err.status} ${err.name}`);
    return fail(502, 'paypal_error', 'PayPal no pudo completar la operación. Prueba de nuevo en un momento.');
  }
  console.error(`[Tally Studio paypal] ${where}:`, err instanceof Error ? err.message : 'error desconocido');
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
  // El client id es público por diseño (lo usa el SDK de botones de PayPal en el navegador)
  const clientId = (env.PAYPAL_CLIENT_ID ?? '').trim();
  if (!enabled) return { status: 200, body: { enabled: false, env: mode, clientId: '', plans: [] } };
  // Los ids de plan de PayPal valen para un solo entorno: si se cambió de sandbox a live sin sincronizar, no se ofrece nada
  const syncedEnv = await db.setting(SYNC_ENV_SETTING);
  const [plans, prices] = await Promise.all([db.plans(), db.prices()]);
  const offered = syncedEnv === mode ? prices.filter((p) => p.active && p.paypal_plan_id) : [];
  const out = plans
    .filter((plan) => !plan.archived)
    .map((plan) => {
      const map: Record<string, number | null> = {};
      PERIODS.forEach((m) => {
        map[periodKey(m)] = offered.find((p) => p.plan_id === plan.id && p.months === m)?.price_usd ?? null;
      });
      return { id: plan.id, name: plan.name, prices: map };
    })
    .filter((plan) => Object.values(plan.prices).some((v) => v !== null));
  return { status: 200, body: { enabled: true, env: mode, clientId, plans: out } };
}

// ---------- Suscribirse, confirmar, cancelar ----------

async function subscribe(req: IntegrationRequest, env: Env, db: PaypalDb, client: PaypalClient, profileId: string, now: Date): Promise<IntegrationResult> {
  const body = bodyOf(req);
  const planId = typeof body.planId === 'string' ? body.planId.trim() : '';
  const months = typeof body.months === 'number' ? body.months : Number.NaN;
  if (!PLAN_ID.test(planId)) return fail(400, 'bad_plan', 'Plan no válido.');
  if (!isPeriod(months)) return fail(400, 'bad_months', 'El periodo debe ser 1, 3, 6 o 12 meses.');

  // 'sdk': los botones de PayPal aprueban la suscripción en su ventana; 'redirect' (por defecto): se redirige a approveUrl
  const flow = body.flow === 'sdk' ? 'sdk' : body.flow === undefined || body.flow === 'redirect' ? 'redirect' : null;
  if (!flow) return fail(400, 'bad_flow', "El flujo debe ser 'sdk' o 'redirect'.");

  // Los ids de plan de PayPal valen para un solo entorno: mismo criterio que catalog
  if ((await db.setting(SYNC_ENV_SETTING)) !== paypalEnvOf(env)) return fail(404, 'not_offered', 'Ese plan o periodo no está disponible.');
  const [prices, plans] = await Promise.all([db.prices(), db.plans()]);
  if (plans.find((p) => p.id === planId)?.archived) return fail(404, 'not_offered', 'Ese plan o periodo no está disponible.');
  const price = prices.find((p) => p.plan_id === planId && p.months === months && p.active && p.paypal_plan_id);
  if (!price || !price.paypal_plan_id) return fail(404, 'not_offered', 'Ese plan o periodo no está disponible.');

  // Cualquier suscripción viva del perfil bloquea otra (no solo la «actual»): evita cobrar dos veces
  const mine = await db.profileSubscriptions(profileId);
  const block = subscribeBlock(
    mine.map((r) => ({ status: r.status, startedAt: new Date(r.started_at), paidUntil: r.paid_until ? new Date(r.paid_until) : null })),
    now
  );
  if (block) return fail(409, 'already_subscribed', BLOCK_MESSAGES[block]);

  const origin = originOf(req, env);
  if (!origin && flow === 'redirect') return fail(400, 'no_origin', 'No se pudo saber la dirección del sitio para volver tras el pago.');

  // Una «pending» no se juzga por su antigüedad (el popup del SDK puede cerrarse al instante o aprobarse tarde): se pregunta a PayPal.
  // Primero se consultan TODAS; solo si ninguna está viva se limpia algo, y nunca se cancela una aprobada o activa.
  const toClean: { row: SubscriptionRow; cancelRemote: boolean }[] = [];
  for (const row of mine.filter((r) => r.status === 'pending')) {
    let remoteStatus: string | undefined;
    try {
      remoteStatus = (await client.request<{ status?: string }>('GET', `/v1/billing/subscriptions/${encodeURIComponent(row.paypal_subscription_id)}`)).status;
    } catch (err) {
      // 404: PayPal no la conoce (p. ej. quedó de otro entorno), no puede cobrar. Cualquier otro fallo: se bloquea por prudencia
      if (err instanceof PaypalError && err.status === 404) {
        remoteStatus = 'CANCELLED';
      } else {
        console.error('[Tally Studio paypal] subscribe: no se pudo consultar un intento pendiente:', err instanceof PaypalError ? `${err.status} ${err.name}` : 'error');
        return fail(503, 'pending_check_failed', PENDING_CHECK_FAILED_MESSAGE);
      }
    }
    const verdict = pendingVerdict(remoteStatus);
    if (verdict === 'live') return fail(409, 'already_subscribed', PENDING_LIVE_MESSAGE);
    toClean.push({ row, cancelRemote: verdict === 'abandoned' });
  }
  for (const { row, cancelRemote } of toClean) {
    await db.updateSubscription(row.paypal_subscription_id, { status: 'cancelled' });
    if (!cancelRemote) continue;
    try {
      await cancelInPaypal(client, row.paypal_subscription_id, 'Intento de pago abandonado');
    } catch (err) {
      console.error('[Tally Studio paypal] subscribe: no se pudo cancelar en PayPal un intento abandonado:', err instanceof PaypalError ? `${err.status} ${err.name}` : 'error');
    }
  }

  const created = await client.request<{ id?: string; links?: { rel?: string; href?: string }[] }>('POST', '/v1/billing/subscriptions', {
    plan_id: price.paypal_plan_id,
    custom_id: profileId,
    application_context: {
      brand_name: 'Tally Studio',
      user_action: 'SUBSCRIBE_NOW',
      shipping_preference: 'NO_SHIPPING',
      // En el flujo 'sdk' no hace falta, pero se manda si hay origen por si PayPal lo pide
      ...(origin ? { return_url: `${origin}/?paypal=ok#cuenta`, cancel_url: `${origin}/?paypal=cancel#cuenta` } : {}),
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
  const approveOk = approveHost === 'paypal.com' || approveHost.endsWith('.paypal.com');
  if (!PAYPAL_ID.test(subscriptionId) || (flow === 'redirect' && !approveOk)) {
    console.error('[Tally Studio paypal] subscribe: respuesta inesperada de PayPal');
    return fail(502, 'paypal_error', 'PayPal no devolvió una suscripción válida. Prueba de nuevo.');
  }

  try {
    await db.insertSubscription({
      profile_id: profileId,
      plan_id: planId,
      months,
      price_usd: price.price_usd,
      paypal_subscription_id: subscriptionId,
      status: 'pending',
      started_at: now.toISOString(),
    });
  } catch (err) {
    // Otra petición concurrente ganó (índice único parcial, 0051): la recién creada en PayPal no se aprobó, se cancela sin bloquear
    if (!(err instanceof DuplicateSubscriptionError)) throw err;
    try {
      await cancelInPaypal(client, subscriptionId, 'Suscripción duplicada');
    } catch (cancelErr) {
      console.error('[Tally Studio paypal] subscribe: no se pudo cancelar una suscripción duplicada:', cancelErr instanceof PaypalError ? `${cancelErr.status} ${cancelErr.name}` : 'error');
    }
    return fail(409, 'already_subscribed', BLOCK_MESSAGES.active);
  }
  // El plan solo lo activa el webhook; con 'sdk' el navegador usa subscriptionId en createSubscription y luego llama a confirm
  return { status: 200, body: flow === 'sdk' ? { subscriptionId } : { approveUrl, subscriptionId } };
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
  // Todas las filas no terminales, no solo la «actual»: si quedó una pendiente o suspendida, PayPal podría seguir cobrando
  const live = (await db.profileSubscriptions(profileId)).filter((r) => r.status !== 'cancelled' && r.status !== 'expired');
  if (live.length === 0) return fail(409, 'nothing_to_cancel', 'No tienes una suscripción que cancelar.');
  let cancelled = 0;
  let failed = 0;
  let firstError: unknown = null;
  for (const sub of live) {
    try {
      await cancelInPaypal(client, sub.paypal_subscription_id, 'Cancelada por el streamer desde Tally Studio');
      await db.updateSubscription(sub.paypal_subscription_id, { status: 'cancelled' });
      cancelled += 1;
    } catch (err) {
      failed += 1;
      firstError ??= err;
      console.error('[Tally Studio paypal] cancel: no se pudo cancelar una suscripción:', err instanceof PaypalError ? `${err.status} ${err.name}` : 'error');
    }
  }
  // Si no se pudo cancelar ninguna, error para que el streamer reintente
  if (cancelled === 0) throw firstError;
  return { status: 200, body: { ...(await statusBody(db, profileId, now)), cancelled, failed } };
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
      return { id: plan.id, name: plan.name, isDefault: plan.is_default, archived: plan.archived === true, prices: map };
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
      name: 'Tally Studio',
      description: 'Planes de Tally Studio para streamers',
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
        name: `Tally Studio ${planName} - ${row.months} ${row.months === 1 ? 'mes' : 'meses'}`.slice(0, 120),
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
      console.error('[Tally Studio paypal] admin-sync: no se pudo crear un plan:', err instanceof PaypalError ? `${err.status} ${err.name}` : 'error');
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

/** Tamaño aproximado del cuerpo recibido (ya interpretado o en texto). */
function bodySize(req: IntegrationRequest): number {
  const declared = Number(headerOf(req, 'content-length'));
  if (typeof req.body === 'string') return Math.max(req.body.length, Number.isFinite(declared) ? declared : 0);
  let own = 0;
  try {
    own = JSON.stringify(req.body ?? null).length;
  } catch {
    own = Number.POSITIVE_INFINITY;
  }
  return Math.max(own, Number.isFinite(declared) ? declared : 0);
}

/** Best-effort: cancela en PayPal la suscripción de una venta revertida. Los fallos se registran sin datos sensibles y no tumban el aviso. */
async function cancelAfterReversal(db: PaypalDb, client: PaypalClient, saleId: string): Promise<void> {
  try {
    const sub = await db.subscriptionBySale(saleId);
    if (sub) await cancelInPaypal(client, sub.paypal_subscription_id, 'Reverso o contracargo de un pago');
  } catch (err) {
    console.error('[Tally Studio paypal] webhook: reverso aplicado pero no se pudo cancelar en PayPal:', err instanceof PaypalError ? `${err.status} ${err.name}` : 'error');
  }
}

async function webhook(req: IntegrationRequest, deps: Deps, db: PaypalDb, client: PaypalClient, webhookId: string): Promise<IntegrationResult> {
  if (req.method.toUpperCase() !== 'POST') return fail(405, 'method', 'Esta ruta solo admite POST.');
  // Ruta anónima: antes de gastar una llamada a PayPal se descartan cuerpos enormes
  if (bodySize(req) > WEBHOOK_MAX_BYTES) return fail(413, 'too_large', 'Aviso demasiado grande.');
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
  // El certificado debe venir de PayPal: no se le pasa a PayPal una URL arbitraria
  if (!isPaypalCertUrl(headers.cert_url)) return fail(400, 'bad_signature', 'Firma no válida.');

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

  const now = new Date(deps.now());
  const createdAt = typeof event.create_time === 'string' ? Date.parse(event.create_time) : Number.NaN;
  const eventTime = Number.isFinite(createdAt) ? new Date(createdAt) : now;
  const transition = transitionFor(eventType, event.resource);

  const claim = await db.claimEvent({ id: eventId, type: eventType.slice(0, 100), subscriptionId: transition.subscriptionId, payload: auditPayload(event) }, now);
  if (claim === 'done') return { status: 200, body: { ok: true, duplicate: true } };
  // Otro proceso lo está aplicando: PayPal reintenta más tarde
  if (claim === 'busy') return fail(409, 'event_in_progress', 'Aviso en proceso. Reintenta.');

  // Un aviso que no se puede aplicar todavía (p. ej. la fila de la suscripción aún no existe) no se marca como hecho
  const retryLater = async (reason: string): Promise<IntegrationResult> => {
    await db.releaseEvent(eventId).catch(() => undefined);
    console.error(`[Tally Studio paypal] webhook: ${reason}; PayPal reintentará`);
    return fail(503, 'not_ready', 'Aún no se puede aplicar el aviso. Reintenta.');
  };

  try {
    switch (transition.kind) {
      case 'ignore':
        if (transition.reason === 'bad_refund_amount') console.error('[Tally Studio paypal] webhook: reembolso con importe no válido; no se trata como reembolso');
        break;
      case 'payment': {
        // La suscripción manda: una venta en otra moneda o sin importe acredita el periodo igual, pero no se guarda un importe comparable
        const usable = transition.amount !== null && transition.currency === BILLING_CURRENCY;
        if (!usable) console.error('[Tally Studio paypal] webhook: venta con importe o moneda no utilizables; se acredita el periodo igual');
        // Sin id de venta no hay forma de evitar el doble crédito por otro event.id: se usa el id del evento
        const result = await db.applyPayment({
          saleId: clipId(transition.saleId || `event-${eventId}`),
          paypalSubscriptionId: transition.subscriptionId,
          amount: usable ? transition.amount : null,
          currency: transition.currency,
          eventTime: eventTime.toISOString(),
        });
        if (result === 'unknown_subscription') return await retryLater('pago de una suscripción desconocida');
        break;
      }
      case 'refund':
      case 'reversal': {
        // Solo se suman reembolsos en USD; otra moneda no sirve para totales ni parciales
        let amount: number | null = null;
        if (transition.kind === 'refund') {
          if (transition.currency === BILLING_CURRENCY) amount = transition.amount;
          else console.error('[Tally Studio paypal] webhook: reembolso con importe o moneda no utilizables; no cuenta para totales');
        }
        const result = await db.reverseSale({
          saleId: clipId(transition.saleId),
          // Idempotencia del parcial: id del reembolso (o del evento si no lo trae); en un reverso, el id de la venta
          refundId: clipId(transition.kind === 'refund' ? transition.refundId || `event-${eventId}` : transition.saleId),
          amount,
          reversal: transition.kind === 'reversal',
          eventTime: eventTime.toISOString(),
        });
        if (result === 'unknown_sale') {
          // Pasadas 72 h la venta no va a aparecer (p. ej. anterior a 0050 sin backfill): se da por hecho en vez de un 503 eterno
          if (now.getTime() - eventTime.getTime() > UNKNOWN_SALE_GIVE_UP_MS) {
            console.error('[Tally Studio paypal] webhook: reembolso o reverso de una venta no registrada con más de 72 h; se descarta');
            break;
          }
          return await retryLater('reembolso o reverso de una venta no registrada');
        }
        if (result === 'applied') {
          await db.expireDue().catch(() => 0);
          // Un reverso o contracargo no debe seguir cobrando: además de suspended local, se cancela en PayPal (sin bloquear el aviso)
          if (transition.kind === 'reversal') await cancelAfterReversal(db, client, clipId(transition.saleId));
        }
        break;
      }
      default: {
        const sub = await db.subscriptionByPaypalId(transition.subscriptionId);
        if (!sub) return await retryLater('evento de una suscripción desconocida');
        const last = sub.last_event_time ? new Date(sub.last_event_time) : null;
        // Eventos fuera de orden: uno más viejo que el último aplicado no cambia el estado
        if (isStaleEvent(eventTime, last)) break;
        const next = applyTransition(
          { status: sub.status, months: sub.months, paidUntil: sub.paid_until ? new Date(sub.paid_until) : null, lastPaymentAt: sub.last_payment_at ? new Date(sub.last_payment_at) : null },
          transition,
          now
        );
        await db.updateSubscription(sub.paypal_subscription_id, { status: next.status as SubStatus, last_event_time: eventTime.toISOString() });
        await db.expireDue().catch(() => 0);
      }
    }
    await db.completeEvent(eventId);
  } catch (err) {
    // Se libera el id para que el reintento de PayPal pueda procesarlo (la venta ya registrada no se acredita dos veces)
    await db.releaseEvent(eventId).catch(() => undefined);
    return paypalFailure(err, 'webhook/apply');
  }
  return { status: 200, body: { ok: true } };
}

const SUBS_LIMIT = 200;

const CURSOR_TS = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}(:?\d{2})?)?$/;
const CURSOR_ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * `before`: «<updated_at>|<id>» (el nextBefore opaco) o, por compatibilidad, un ISO simple. null = primera página; 'bad' = inválido.
 * Los formatos se validan con listas cerradas porque el valor acaba dentro de un filtro de PostgREST.
 */
function parseBefore(raw: string): AdminCursor | null | 'bad' {
  if (!raw) return null;
  if (raw.includes('|')) {
    const parts = raw.split('|');
    if (parts.length !== 2) return 'bad';
    const [updatedAt, id] = parts;
    if (!CURSOR_TS.test(updatedAt) || Number.isNaN(Date.parse(updatedAt)) || !CURSOR_ID.test(id)) return 'bad';
    return { updatedAt, id };
  }
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? 'bad' : { updatedAt: new Date(ms).toISOString(), id: null };
}

/** Panel de suscripciones: las más recientes primero, totales por estado y perfiles con plan por código. */
async function adminSubscriptions(req: IntegrationRequest, db: PaypalDb, now: Date): Promise<IntegrationResult> {
  const rawBefore = typeof req.query?.before === 'string' ? req.query.before.trim() : '';
  const before = parseBefore(rawBefore);
  if (before === 'bad') return fail(400, 'bad_before', 'El cursor «before» no es válido.');
  // Pagina de a SUBS_LIMIT; se pide una de más para saber si hay otra página
  const [rows, totals, codeAccess] = await Promise.all([
    db.adminSubscriptions(SUBS_LIMIT + 1, before),
    db.subscriptionTotals(),
    before ? Promise.resolve([]) : db.codeAccess(now.toISOString(), SUBS_LIMIT),
  ]);
  const page = rows.slice(0, SUBS_LIMIT);
  return {
    status: 200,
    body: {
      subscriptions: page.map((r) => ({
        id: r.id,
        profileId: r.profile_id,
        twitchLogin: r.twitch_login,
        displayName: r.display_name,
        planId: r.plan_id,
        planName: r.plan_name ?? r.plan_id,
        months: r.months,
        status: r.status,
        startedAt: r.started_at,
        paidUntil: r.paid_until,
        lastPaymentAt: r.last_payment_at,
        priceUsd: r.price_usd,
      })),
      // Cursor opaco y compuesto: el updated_at tal cual lo dio la base (sin truncar) y el id para desempatar
      nextBefore: rows.length > SUBS_LIMIT ? `${page[page.length - 1].updated_at}|${page[page.length - 1].id}` : null,
      totals: {
        active: totals.active ?? 0,
        grace: totals.grace ?? 0,
        cancelled: totals.cancelled ?? 0,
        suspended: totals.suspended ?? 0,
        expired: totals.expired ?? 0,
        pending: totals.pending ?? 0,
      },
      // Solo en la primera página (sin «before»)
      codeAccess: codeAccess.map((c) => ({
        profileId: c.profile_id,
        twitchLogin: c.twitch_login,
        displayName: c.display_name,
        planId: c.plan_id,
        planName: c.plan_name ?? c.plan_id,
        expiresAt: c.expires_at,
        inviteCode: c.invite_code,
      })),
    },
  };
}

// ---------- Entrada ----------

export async function handlePaypal(
  action: PaypalAction,
  req: IntegrationRequest,
  env: Env,
  deps: Deps = defaultDeps,
  dbOverride?: PaypalDb | null,
  reportsOverride?: ReportsDb | null
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
      case 'payments': {
        if (method !== 'GET') return fail(405, 'method', 'Esta ruta solo admite GET.');
        const reports = reportsOverride === undefined ? supabaseReportsDb(env) : reportsOverride;
        if (!reports) return fail(503, 'not_configured', 'Al servidor le faltan variables para hablar con la base de datos.');
        return await paymentsBody(db, reports, caller.id, now);
      }
      case 'admin-inbox':
      case 'admin-inbox-resolve':
      case 'admin-billing-summary': {
        if (caller.role !== 'admin') return fail(403, 'not_admin', 'Solo para administradores.');
        if (method !== (action === 'admin-inbox-resolve' ? 'POST' : 'GET')) return fail(405, 'method', `Esta ruta solo admite ${action === 'admin-inbox-resolve' ? 'POST' : 'GET'}.`);
        const reports = reportsOverride === undefined ? supabaseReportsDb(env) : reportsOverride;
        if (!reports) return fail(503, 'not_configured', 'Al servidor le faltan variables para hablar con la base de datos.');
        if (action === 'admin-inbox') return await adminInboxBody(db, reports, now);
        if (action === 'admin-inbox-resolve') return await adminInboxResolve(req, db, reports, caller.id, now);
        return await adminBillingSummaryBody(req, reports, now);
      }
      case 'admin-prices':
      case 'admin-sync':
      case 'admin-subscriptions': {
        if (caller.role !== 'admin') return fail(403, 'not_admin', 'Solo para administradores.');
        if (action === 'admin-subscriptions') {
          if (method !== 'GET') return fail(405, 'method', 'Esta ruta solo admite GET.');
          return await adminSubscriptions(req, db, now);
        }
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
