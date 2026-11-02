/**
 * src/components/billing/CheckoutWindow.tsx
 *
 * Ventana de pago: elegir plan y periodo, ver el resumen con el precio y pasar
 * a PayPal. Al volver de PayPal, la misma ventana enseña el seguimiento de
 * cuatro pasos con datos reales de `status`.
 *
 * Es un diálogo accesible: foco atrapado, Escape cierra y el foco vuelve a
 * donde estaba. El plan no se da por activo hasta que `hasAccess` sea true.
 */

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { Check, Lock } from 'lucide-react';
import { reduced } from '../../utils/alertMotion';
import { billingSubscribe } from '../../lib/billingApi';
import { PAYPAL_BUTTON_STYLE, buildPaypalSdkUrl } from '../../lib/invitesLogic';
import { loadPaypalSdk } from '../../lib/paypalSdk';
import {
  addMonths,
  availablePeriods,
  defaultPeriod,
  formatDateEs,
  formatMoney,
  isSafeApproveUrl,
  monthlyPrice,
  periodKey,
  periodLabel,
  savingsPercent,
  trackSteps,
} from '../../lib/billingLogic';
import { BILLING_PERIODS, type BillingCatalog, type BillingPeriod, type BillingStatus } from '../../lib/billingTypes';
import '../../styles/billing.css';

gsap.registerPlugin(useGSAP);

const SALIDA = 'expo.out';

/** Clave donde se guarda la suscripción creada, para confirmarla al volver de PayPal. */
export const PENDING_SUB_KEY = 'lalo.paypal.subscription';

export type TrackPhase = 'confirming' | 'waiting' | 'done' | 'timeout' | 'error';

export interface TrackState {
  phase: TrackPhase;
  status: BillingStatus | null;
  error: string | null;
  /** Plan y periodo que se estaban contratando, por si `status` aún no los trae. */
  planName: string;
  months: number;
}

interface Props {
  catalog: BillingCatalog;
  status: BillingStatus | null;
  /** Con valor, la ventana enseña el seguimiento en vez de la elección. */
  track: TrackState | null;
  onClose: () => void;
  /** Vuelve a preguntar por el estado (botón «Comprobar ahora»). */
  onRecheck?: () => void;
  /** PayPal aprobó la suscripción desde los botones: quien abre la ventana la confirma y sigue los pasos. */
  onApproved?: (subscriptionId: string, info: { planName: string; months: number }) => void;
}

type SdkState = 'loading' | 'ready' | 'failed';

/** Fallo de nuestro servidor al crear la suscripción (p. ej. 409 ya suscrito): ya se explicó en pantalla, no es un error de PayPal. */
class SubscribeFailure extends Error {}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

const PayPalMark: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M7.1 21.5H3.6c-.3 0-.5-.2-.4-.5L6 3.2c0-.2.2-.4.5-.4h6.6c3 0 5 1.6 4.6 4.3-.5 3.4-2.8 5-6 5H9.4c-.3 0-.5.2-.6.4l-1.2 8.3c0 .2-.1.3-.5.3z" />
    <path d="M9.1 15.5l-.9 6c0 .1.1.2.2.2h2.5c.3 0 .5-.2.6-.5l.7-4.5c0-.2.2-.4.5-.4h1.3c3.4 0 5.6-1.6 6.2-4.8.1-.4.1-.8.1-1.1-.7 1-2 2.6-6.1 2.6H9.6c-.3 0-.5.2-.5.5v2.2z" opacity=".7" />
  </svg>
);

export const CheckoutWindow: React.FC<Props> = ({ catalog, status, track, onClose, onRecheck, onApproved }) => {
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const indRef = useRef<HTMLSpanElement | null>(null);
  const priceRef = useRef<HTMLSpanElement | null>(null);
  const shownRef = useRef({ monto: 0 });

  const plans = useMemo(() => catalog.plans.filter((plan) => availablePeriods(plan.prices).length > 0), [catalog.plans]);
  const current = status?.subscription ?? null;
  const [planId, setPlanId] = useState(() => (plans.find((p) => p.id === current?.planId) ?? plans[0])?.id ?? '');
  const plan = plans.find((p) => p.id === planId) ?? plans[0] ?? null;
  const [months, setMonths] = useState<number>(() => (plan ? (defaultPeriod(plan.prices, current?.months) ?? 1) : 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const hasClientId = buildPaypalSdkUrl(catalog.clientId) !== null;
  const [sdk, setSdk] = useState<SdkState>(hasClientId ? 'loading' : 'failed');
  const buttonsRef = useRef<HTMLDivElement | null>(null);
  const onApprovedRef = useRef(onApproved);
  onApprovedRef.current = onApproved;

  // Si el periodo elegido no existe en este plan, se usa el primero disponible
  const period: BillingPeriod | null = plan ? defaultPeriod(plan.prices, months) : null;
  const total = plan && period ? plan.prices[periodKey(period)] : null;
  const savings = plan && period ? savingsPercent(plan.prices, period) : 0;
  const today = useMemo(() => new Date(), []);
  const until = period ? addMonths(today, period) : null;
  const tracking = track !== null;

  // Foco: entra al diálogo y vuelve al botón que lo abrió
  useEffect(() => {
    const opener = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!busy) onClose();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  // Entrada de la ventana
  useGSAP(
    () => {
      if (!dialogRef.current || !rootRef.current) return;
      if (reduced()) {
        gsap.fromTo([rootRef.current, dialogRef.current], { opacity: 0 }, { opacity: 1, duration: 0.2 });
        return;
      }
      gsap.fromTo(rootRef.current, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'power2.out' });
      gsap.fromTo(dialogRef.current, { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: SALIDA, clearProps: 'transform' });
    },
    { scope: rootRef }
  );

  // Selector deslizante de periodo
  const periodIndex = Math.max(0, BILLING_PERIODS.indexOf((period ?? 1) as BillingPeriod));
  useGSAP(
    () => {
      if (!indRef.current) return;
      gsap.to(indRef.current, { xPercent: periodIndex * 100, duration: reduced() ? 0.01 : 0.45, ease: SALIDA, overwrite: true });
    },
    { dependencies: [periodIndex, tracking] }
  );

  // Precio que cuenta hasta el nuevo valor
  useGSAP(
    () => {
      if (total == null) return;
      const el = priceRef.current;
      if (!el) return;
      const mark = shownRef.current;
      gsap.to(mark, {
        monto: total,
        duration: reduced() ? 0.01 : 0.55,
        ease: SALIDA,
        overwrite: true,
        onUpdate: () => {
          el.textContent = formatMoney(mark.monto);
        },
        onComplete: () => {
          el.textContent = formatMoney(total);
        },
      });
    },
    { dependencies: [total, tracking] }
  );

  // El SDK de PayPal se carga una sola vez; si no llega, queda el botón de redirección
  useEffect(() => {
    if (!hasClientId) return;
    let alive = true;
    loadPaypalSdk(catalog.clientId)
      .then(() => alive && setSdk('ready'))
      .catch(() => alive && setSdk('failed'));
    return () => {
      alive = false;
    };
  }, [catalog.clientId, hasClientId]);

  // Botones de PayPal: se destruyen y se crean de nuevo al cambiar de plan o de periodo
  const planIdNow = plan?.id ?? null;
  const planNameNow = plan?.name ?? '';
  useEffect(() => {
    const container = buttonsRef.current;
    if (sdk !== 'ready' || tracking || !container || !planIdNow || period == null || !window.paypal) return;
    let alive = true;
    const chosen = { planId: planIdNow, planName: planNameNow, months: period };
    const buttons = window.paypal.Buttons({
      style: { ...PAYPAL_BUTTON_STYLE },
      createSubscription: async () => {
        setError(null);
        setInfo(null);
        const res = await billingSubscribe(chosen.planId, chosen.months, 'sdk');
        if (!res.ok) {
          // El SDK llama luego a onError con este rechazo: se muestra tal cual, sin el prefijo de «PayPal no pudo»
          const message = res.code === 'already_subscribed' && !res.message ? 'Ya tienes una suscripción en curso. Revisa Mi plan antes de contratar otra.' : res.message;
          if (alive) setError(message);
          throw new SubscribeFailure(message);
        }
        try {
          sessionStorage.setItem(
            PENDING_SUB_KEY,
            JSON.stringify({ subscriptionId: res.data.subscriptionId, planName: chosen.planName, months: chosen.months })
          );
        } catch {
          // Sin almacenamiento de sesión: la suscripción se confirma igual al aprobar
        }
        return res.data.subscriptionId;
      },
      onApprove: async (data) => {
        const id = data.subscriptionID;
        if (!id) {
          if (alive) setError('PayPal aprobó el pago pero no devolvió la suscripción. No repitas el pago: avisa al administrador.');
          return;
        }
        onApprovedRef.current?.(id, { planName: chosen.planName, months: chosen.months });
      },
      onCancel: () => {
        if (alive) setInfo('Cerraste PayPal sin terminar. No se cobró nada; puedes intentarlo de nuevo cuando quieras.');
      },
      onError: (err) => {
        if (!alive || err instanceof SubscribeFailure) return;
        const detail = err instanceof Error && err.message ? err.message : '';
        setError(detail ? `PayPal no pudo completar el pago: ${detail}` : 'PayPal no pudo completar el pago. No se cobró nada; inténtalo otra vez.');
      },
    });
    buttons.render(container).catch(() => {
      if (alive) setSdk('failed');
    });
    return () => {
      alive = false;
      try {
        Promise.resolve(buttons.close()).catch(() => {});
      } catch {
        // Los botones ya no estaban
      }
      container.replaceChildren();
    };
  }, [sdk, tracking, planIdNow, planNameNow, period]);

  const choosePlan = (id: string) => {
    setPlanId(id);
    const next = plans.find((p) => p.id === id);
    if (next) setMonths(defaultPeriod(next.prices, months) ?? 1);
    setError(null);
    setInfo(null);
    if (!reduced()) gsap.fromTo('.bil-res-nombre', { y: 6, opacity: 0.4 }, { y: 0, opacity: 1, duration: 0.35, ease: SALIDA });
  };

  const pay = async () => {
    if (!plan || !period || busy) return;
    setBusy(true);
    setError(null);
    const res = await billingSubscribe(plan.id, period);
    if (!res.ok) {
      setError(res.message);
      setBusy(false);
      return;
    }
    if (!isSafeApproveUrl(res.data.approveUrl)) {
      setError('La dirección de PayPal que llegó no es segura, así que no te llevamos allí. Prueba otra vez o avisa al administrador.');
      setBusy(false);
      return;
    }
    try {
      sessionStorage.setItem(PENDING_SUB_KEY, JSON.stringify({ subscriptionId: res.data.subscriptionId, planName: plan.name, months: period }));
    } catch {
      // Sin almacenamiento de sesión: PayPal también devuelve el identificador en la dirección
    }
    window.location.assign(res.data.approveUrl);
  };

  return createPortal(
    <div className="cab bil-root" ref={rootRef} onKeyDown={onKeyDown}>
      <div className="bil-backdrop" onClick={() => !busy && onClose()} aria-hidden="true" />
      <div className="bil-win" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={dialogRef}>
        <div className="bil-top">
          <h1 id={titleId}>{tracking ? 'Tu pago' : 'Activa tu plan'}</h1>
          <span className="bil-caps">
            <Lock size={13} aria-hidden="true" />
            Pago seguro con PayPal
          </span>
          <button type="button" className="bil-x" onClick={onClose} disabled={busy} aria-label="Cerrar la ventana de pago">
            <span aria-hidden="true">×</span>
          </button>
        </div>

        {tracking && track ? (
          <Tracking track={track} onClose={onClose} onRecheck={onRecheck} />
        ) : !plan || period == null || total == null ? (
          <div className="bil-flujo">
            <p className="bil-nota">Todavía no hay planes con precio. Vuelve más tarde.</p>
          </div>
        ) : (
          <div className="bil-body">
            <div className="bil-izq">
              <fieldset className="bil-fs">
                <legend className="bil-caps">1 · Elige tu plan</legend>
                <div className="bil-planes">
                  {plans.map((p) => {
                    const lowest = Math.min(...availablePeriods(p.prices).map((m) => monthlyPrice(p.prices[periodKey(m)] as number, m)));
                    return (
                      <label className="bil-plan" key={p.id}>
                        <input type="radio" name={`${titleId}-plan`} value={p.id} checked={p.id === plan.id} onChange={() => choosePlan(p.id)} />
                        <span className="bil-plan-in">
                          <b>{p.name}</b>
                          <small>Desde {formatMoney(lowest)} al mes</small>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset className="bil-fs">
                <legend className="bil-caps">2 · Cada cuánto se cobra</legend>
                <div className="bil-seg">
                  <span className="bil-ind" ref={indRef} aria-hidden="true" />
                  {BILLING_PERIODS.map((m) => {
                    const price = plan.prices[periodKey(m)];
                    const ahorro = savingsPercent(plan.prices, m);
                    return (
                      <label className="bil-per" data-off={price == null} key={m}>
                        <input
                          type="radio"
                          name={`${titleId}-per`}
                          value={m}
                          checked={period === m}
                          disabled={price == null}
                          onChange={() => {
                            setMonths(m);
                            setError(null);
                          }}
                        />
                        <b>{periodLabel(m)}</b>
                        <span className="bil-num">{price == null ? 'No disponible' : `${formatMoney(monthlyPrice(price, m))}/mes`}</span>
                        <span className="bil-ahorro">{price != null && ahorro > 0 ? `−${ahorro}%` : ' '}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <p className="bil-nota">
                La suscripción se renueva sola con el mismo periodo. Puedes cancelarla cuando quieras y conservas el plan hasta que termine lo ya pagado.
              </p>
            </div>

            <div className="bil-der">
              <div className="bil-res-nombre">
                <h2>Plan {plan.name}</h2>
                <span className="bil-chip">{savings > 0 ? `Ahorras ${savings}%` : 'Sin descuento'}</span>
              </div>
              <div className="bil-precio">
                <span className="bil-monto bil-num" ref={priceRef}>
                  {formatMoney(total)}
                </span>
                <span className="bil-cada">USD cada {period === 1 ? 'mes' : `${period} meses`}</span>
              </div>
              <dl className="bil-filas">
                <div>
                  <dt>Equivale a</dt>
                  <dd className="bil-num">{formatMoney(monthlyPrice(total, period))} al mes</dd>
                </div>
                <div>
                  <dt>Primer cobro</dt>
                  <dd>{formatDateEs(today)}</dd>
                </div>
                <div>
                  <dt>Plan activo hasta</dt>
                  <dd>{formatDateEs(until)}</dd>
                </div>
                <div>
                  <dt>Próximo cobro</dt>
                  <dd>{formatDateEs(until)}</dd>
                </div>
              </dl>
              {error && (
                <p className="bil-error" role="alert">
                  {error}
                </p>
              )}
              {info && (
                <p className="bil-nota" role="status">
                  {info}
                </p>
              )}
              {sdk === 'failed' ? (
                <>
                  {hasClientId && (
                    <p className="bil-nota" role="status">
                      No pudimos cargar los botones de PayPal en esta página. Usa este botón: te lleva a PayPal para terminar el pago.
                    </p>
                  )}
                  <button type="button" className="bil-pp" onClick={pay} disabled={busy}>
                    <PayPalMark />
                    {busy ? 'Abriendo PayPal…' : 'Suscribirme con PayPal'}
                  </button>
                </>
              ) : (
                <div className="bil-sdk" data-state={sdk}>
                  {sdk === 'loading' && (
                    <p className="bil-nota" role="status">
                      Cargando los botones de PayPal…
                    </p>
                  )}
                  <div ref={buttonsRef} />
                </div>
              )}
              <p className="bil-nota">
                {sdk === 'failed'
                  ? 'Al continuar se abre PayPal para aprobar el cobro recurrente.'
                  : 'Paga con tu cuenta de PayPal o con tarjeta si PayPal la ofrece para ti.'}{' '}
                El plan se activa cuando PayPal confirma que el dinero llegó, no antes.
                {catalog.env === 'sandbox' && ' Estás en modo de pruebas: no se cobra dinero de verdad.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

// ---------- Seguimiento ----------

const Tracking: React.FC<{ track: TrackState; onClose: () => void; onRecheck?: () => void }> = ({ track, onClose, onRecheck }) => {
  const listRef = useRef<HTMLOListElement | null>(null);
  const planName = track.status?.subscription?.planName || track.planName;
  const months = track.status?.subscription?.months || track.months;
  const steps = trackSteps(track.status, planName, months);
  const active = track.status?.hasAccess === true;
  const stalled = track.phase === 'timeout' || track.phase === 'error';

  useGSAP(
    () => {
      if (!listRef.current) return;
      const items = listRef.current.querySelectorAll('.bil-paso');
      if (reduced()) {
        gsap.fromTo(items, { opacity: 0 }, { opacity: 1, duration: 0.2 });
        return;
      }
      gsap.fromTo(items, { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: SALIDA, stagger: 0.06, clearProps: 'transform' });
    },
    { scope: listRef }
  );

  let title = 'Confirmando con PayPal';
  let note: string | null = null;
  if (active) title = 'Tu plan ya está activo';
  else if (track.phase === 'error') title = 'No pudimos confirmar el pago';
  else if (track.phase === 'timeout') title = 'PayPal aún no confirma';
  else if (track.phase === 'waiting') title = 'Esperando la confirmación de PayPal';

  if (!active && track.phase === 'waiting') note = 'Puede tardar un minuto. No hace falta que repitas el pago ni que cierres la página.';
  if (!active && track.phase === 'timeout')
    note =
      'Pasó un minuto y PayPal todavía no avisó. No pierdes nada: el plan se activa solo cuando llegue la confirmación. Puedes volver a comprobarlo o cerrar esta ventana.';

  return (
    <div className="bil-flujo" role="status" aria-live="polite">
      <div>
        <span className="bil-caps">
          Plan {planName} · {periodLabel(months)}
        </span>
        <h2>{title}</h2>
      </div>
      <ol className="bil-pasos" ref={listRef}>
        {steps.map((step) => (
          <li className="bil-paso" data-state={step.state === 'active' && stalled ? 'pending' : step.state} key={step.id}>
            <span className="bil-pt" aria-hidden="true">
              <Check size={16} strokeWidth={3} />
            </span>
            <span>
              <b>{step.title}</b>
              <small>{step.detail}</small>
            </span>
            <span className="bil-sr">{step.state === 'done' ? 'Hecho' : step.state === 'active' ? 'En curso' : 'Pendiente'}</span>
          </li>
        ))}
      </ol>
      {track.error && (
        <p className="bil-error" role="alert">
          {track.error}
        </p>
      )}
      {note && <p className="bil-nota">{note}</p>}
      {active && track.status?.subscription && (
        <p>
          Plan {planName} activo hasta <b>{formatDateEs(track.status.subscription.paidUntil)}</b>
        </p>
      )}
      <div className="bil-acciones">
        {!active && stalled && onRecheck && (
          <button type="button" className="bil-btn" onClick={onRecheck}>
            Comprobar ahora
          </button>
        )}
        <button type="button" className={active ? 'bil-btn bil-pri' : 'bil-btn'} onClick={onClose}>
          {active ? 'Ir a Mi cuenta' : 'Cerrar'}
        </button>
      </div>
    </div>
  );
};
