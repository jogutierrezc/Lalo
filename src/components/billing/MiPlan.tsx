/**
 * src/components/billing/MiPlan.tsx
 *
 * Sección «Mi plan» de Mi cuenta: estado real de la suscripción, botón para
 * elegir plan (abre la ventana de pago) y cancelación con confirmación en la
 * propia página.
 *
 * Al volver de PayPal (?paypal=ok) confirma la suscripción y pregunta por el
 * estado cada 3 s, hasta 60 s, mientras llega el aviso de PayPal. El plan solo
 * se enseña como activo cuando el servidor dice `hasAccess: true`.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useCloudSession } from '../../hooks/useCloudSession';
import { fetchOwnPlan } from '../../lib/cloud';
import { outcomeMessage } from '../../lib/accesoMensajes';
import { billingCancel, billingCatalog, billingConfirm, billingStatus } from '../../lib/billingApi';
import {
  POLL_EVERY_MS,
  POLL_MAX_MS,
  canCancel,
  canSubscribe,
  formatDateEs,
  periodLabel,
  readPaypalReturn,
  statusText,
} from '../../lib/billingLogic';
import type { BillingCatalog, BillingStatus } from '../../lib/billingTypes';
import { CheckoutWindow, PENDING_SUB_KEY, type TrackState } from './CheckoutWindow';
import '../../styles/billing.css';

interface Pending {
  subscriptionId: string | null;
  planName: string;
  months: number;
}

/** Sin catálogo (falló la lectura), la ventana aún puede enseñar el seguimiento de un pago. */
const NO_CATALOG: BillingCatalog = { enabled: false, env: 'sandbox', plans: [] };

function readPending(): Pending | null {
  try {
    const raw = sessionStorage.getItem(PENDING_SUB_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Pending>;
    return {
      subscriptionId: typeof parsed.subscriptionId === 'string' && parsed.subscriptionId ? parsed.subscriptionId : null,
      planName: typeof parsed.planName === 'string' ? parsed.planName : '',
      months: typeof parsed.months === 'number' ? parsed.months : 1,
    };
  } catch {
    return null;
  }
}

function clearPending() {
  try {
    sessionStorage.removeItem(PENDING_SUB_KEY);
  } catch {
    // Sin almacenamiento de sesión no hay nada que limpiar
  }
}

/** Quita ?paypal=... de la dirección sin recargar ni cambiar de pantalla. */
function cleanReturnUrl() {
  try {
    const url = new URL(window.location.href);
    ['paypal', 'subscription_id', 'subscriptionId', 'ba_token', 'token'].forEach((key) => url.searchParams.delete(key));
    const hashBase = url.hash.includes('?') ? url.hash.slice(0, url.hash.indexOf('?')) : url.hash;
    window.history.replaceState(null, '', `${url.pathname}${url.search}${hashBase || '#cuenta'}`);
  } catch {
    // Si el navegador no deja cambiar la dirección, no pasa nada: ya se procesó
  }
}

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export const MiPlan: React.FC = () => {
  const { refresh, profile, redeem } = useCloudSession();
  const codeId = useId();
  const [codeOpen, setCodeOpen] = useState(false);
  const [codeValue, setCodeValue] = useState('');
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeMsg, setCodeMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ownPlanName, setOwnPlanName] = useState<string | null>(null);
  const codeInputRef = useRef<HTMLInputElement | null>(null);
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [track, setTrack] = useState<TrackState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const returnRef = useRef<ReturnType<typeof readPaypalReturn>>(null);
  const aliveRef = useRef({ on: true });

  const loadAll = useCallback(async () => {
    const [cat, st] = await Promise.all([billingCatalog(), billingStatus()]);
    if (!aliveRef.current.on) return;
    if (cat.ok) setCatalog(cat.data);
    if (st.ok) setStatus(st.data);
    setError(!st.ok ? st.message : !cat.ok ? cat.message : null);
    setLoaded(true);
  }, []);

  // Confirma y espera la señal de PayPal. `alive` corta el bucle si se sale de la página.
  const follow = useCallback(
    async (subscriptionId: string | null, fallback: { planName: string; months: number }, alive: { on: boolean }) => {
      const base = { planName: fallback.planName, months: fallback.months };
      let current: BillingStatus | null = null;
      let failure: string | null = null;
      setTrack({ ...base, phase: 'confirming', status: null, error: null });

      if (subscriptionId) {
        const res = await billingConfirm(subscriptionId);
        if (!alive.on) return;
        if (res.ok) current = res.data;
        else failure = res.message;
      }
      const finish = (st: BillingStatus) => {
        setStatus(st);
        setTrack({ ...base, phase: 'done', status: st, error: null });
        clearPending();
        refresh();
      };
      if (current?.hasAccess) return finish(current);

      const startedAt = Date.now();
      setTrack({ ...base, phase: 'waiting', status: current, error: failure });
      while (Date.now() - startedAt < POLL_MAX_MS) {
        await wait(POLL_EVERY_MS);
        if (!alive.on) return;
        const res = await billingStatus();
        if (!alive.on) return;
        if (res.ok) {
          current = res.data;
          failure = null;
          if (current.hasAccess) return finish(current);
        } else {
          failure = res.message;
        }
        setTrack({ ...base, phase: 'waiting', status: current, error: failure });
      }
      if (current) setStatus(current);
      setTrack({ ...base, phase: current ? 'timeout' : 'error', status: current, error: failure });
    },
    [refresh]
  );

  useEffect(() => {
    const alive = { on: true };
    aliveRef.current = alive;
    loadAll();

    // Regreso de PayPal. La dirección se limpia en seguida; el resultado se guarda para no perderlo.
    const found = readPaypalReturn(window.location.search, window.location.hash) ?? returnRef.current;
    returnRef.current = found;
    if (found) {
      cleanReturnUrl();
      if (found.result === 'cancel') {
        setNotice('Cancelaste el pago en PayPal. No se cambió nada en tu plan.');
        clearPending();
      } else {
        const pending = readPending();
        setOpen(true);
        follow(found.subscriptionId ?? pending?.subscriptionId ?? null, { planName: pending?.planName ?? '', months: pending?.months ?? 1 }, alive);
      }
    }
    return () => {
      alive.on = false;
      aliveRef.current.on = false;
    };
  }, [loadAll, follow]);

  // Nombre del plan de la cuenta, para el plan que viene de un código
  const profilePlan = profile?.plan_id ?? null;
  const profileExpires = profile?.plan_expires_at ?? null;
  useEffect(() => {
    if (!profileExpires) {
      setOwnPlanName(null);
      return;
    }
    let alive = true;
    fetchOwnPlan().then((own) => {
      if (alive) setOwnPlanName(own?.name ?? null);
    });
    return () => {
      alive = false;
    };
  }, [profilePlan, profileExpires]);

  const openCode = () => {
    setCodeOpen(true);
    setCodeMsg(null);
    window.setTimeout(() => codeInputRef.current?.focus(), 0);
  };

  const redeemCode = async (event: React.FormEvent) => {
    event.preventDefault();
    const clean = codeValue.trim();
    if (!clean) {
      setCodeMsg({ ok: false, text: 'Escribe tu código para canjearlo.' });
      return;
    }
    setCodeBusy(true);
    setCodeMsg(null);
    const result = await redeem('invite', clean);
    const problem = outcomeMessage(result);
    if (!aliveRef.current.on) return;
    setCodeBusy(false);
    if (problem) {
      setCodeMsg({ ok: false, text: problem });
      return;
    }
    setCodeValue('');
    setCodeOpen(false);
    setCodeMsg({ ok: true, text: 'Código canjeado. Tu plan ya está activo.' });
    loadAll();
  };

  const closeWindow = () => {
    // Al cerrar se corta el seguimiento y se vuelve a leer lo que haya
    aliveRef.current.on = false;
    aliveRef.current = { on: true };
    setOpen(false);
    setTrack(null);
    loadAll();
    refresh();
  };

  const recheck = () => {
    const pending = readPending();
    aliveRef.current.on = false;
    const alive = { on: true };
    aliveRef.current = alive;
    follow(null, { planName: track?.planName ?? pending?.planName ?? '', months: track?.months ?? pending?.months ?? 1 }, alive);
  };

  // PayPal aprobó la suscripción desde los botones: se confirma y se siguen los pasos con datos reales
  const approved = (subscriptionId: string, info: { planName: string; months: number }) => {
    aliveRef.current.on = false;
    const alive = { on: true };
    aliveRef.current = alive;
    follow(subscriptionId, info, alive);
  };

  const cancel = async () => {
    setCancelling(true);
    setError(null);
    const res = await billingCancel();
    setCancelling(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setStatus(res.data);
    setConfirmCancel(false);
    setNotice('Suscripción cancelada. No habrá más cobros.');
    refresh();
  };

  const sub = status?.subscription ?? null;
  const text = statusText(status);
  const offersPayment = catalog?.enabled === true && catalog.plans.length > 0;
  const showChoose = offersPayment && canSubscribe(sub);
  // Plan que viene de un código: vale mientras no haya una suscripción de pago con acceso
  const codeUntil = !status?.hasAccess && profileExpires && new Date(profileExpires).getTime() > Date.now() ? profileExpires : null;

  return (
    <section className="cab-mod md:col-span-2" aria-labelledby="mi-plan-titulo">
      <h2 id="mi-plan-titulo">Mi plan</h2>
      {error && (
        <p className="cab-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="cab-note" role="status">
          {notice}
        </p>
      )}
      {!loaded ? (
        <p className="cab-hint">Leyendo tu plan.</p>
      ) : (
        <>
          <div className="bil-estado">
            <div className="cab-field">
              <span className="cab-label">Plan</span>
              <span>{sub && (status?.hasAccess || sub.status === 'pending') ? sub.planName : codeUntil && ownPlanName ? ownPlanName : 'Gratis'}</span>
            </div>
            <div className="cab-field">
              <span className="cab-label">Estado</span>
              <span>
                <span className="bil-chip" data-tone={text.tone}>
                  {text.label}
                </span>
              </span>
            </div>
            {sub && (
              <>
                <div className="cab-field">
                  <span className="cab-label">Periodo</span>
                  <span>{periodLabel(sub.months)}</span>
                </div>
                <div className="cab-field">
                  <span className="cab-label">Activo hasta</span>
                  <span>{formatDateEs(sub.paidUntil)}</span>
                </div>
                <div className="cab-field">
                  <span className="cab-label">Último pago</span>
                  <span>{formatDateEs(sub.lastPaymentAt)}</span>
                </div>
              </>
            )}
          </div>
          <p className="cab-hint">{text.detail}</p>
          {codeUntil && (
            <p className="cab-note" role="status">
              Plan {ownPlanName ?? 'de pago'} por código, hasta {formatDateEs(codeUntil)}. Si te suscribes con PayPal, el pago manda sobre el código.
            </p>
          )}

          {!offersPayment && !sub && <p className="cab-hint">El cobro con PayPal todavía no está disponible en este despliegue.</p>}

          <div className="flex flex-wrap gap-2">
            {showChoose && (
              <button type="button" className="cab-btn" onClick={() => setOpen(true)}>
                {sub ? 'Contratar de nuevo' : 'Elegir un plan'}
              </button>
            )}
            {canCancel(sub) && !confirmCancel && (
              <button type="button" className="cab-btn2" onClick={() => setConfirmCancel(true)}>
                Cancelar suscripción
              </button>
            )}
          </div>

          {!codeOpen && (
            <p>
              <button type="button" className="studio-link bil-codigo" aria-expanded={false} onClick={openCode}>
                Tengo un código
              </button>
            </p>
          )}
          {codeOpen && (
            <form className="grid gap-3" onSubmit={redeemCode} aria-label="Canjear un código">
              <div className="cab-field max-w-md">
                <label className="cab-label" htmlFor={codeId}>
                  Código de invitación
                </label>
                <input
                  id={codeId}
                  ref={codeInputRef}
                  className="cab-inp cab-mono"
                  value={codeValue}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="TALLY-"
                  onChange={(e) => setCodeValue(e.target.value.toUpperCase())}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="submit" className="cab-btn" disabled={codeBusy}>
                  {codeBusy ? 'Canjeando' : 'Canjear código'}
                </button>
                <button type="button" className="cab-btn2" disabled={codeBusy} onClick={() => setCodeOpen(false)}>
                  Cancelar
                </button>
              </div>
            </form>
          )}
          {codeMsg && (
            <p className={codeMsg.ok ? 'cab-note' : 'cab-error'} role={codeMsg.ok ? 'status' : 'alert'}>
              {codeMsg.text}
            </p>
          )}

          {confirmCancel && (
            <div className="cab-note grid gap-3" role="group" aria-label="Confirmar la cancelación">
              <p>
                Dejará de renovarse y no habrá más cobros.
                {sub?.paidUntil && status?.hasAccess ? ` Conservas el plan hasta el ${formatDateEs(sub.paidUntil)}.` : ''} Para volver a tenerlo
                tendrás que contratarlo otra vez.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="cab-btn cab-btn-danger" onClick={cancel} disabled={cancelling}>
                  {cancelling ? 'Cancelando' : 'Sí, cancelar la suscripción'}
                </button>
                <button type="button" className="cab-btn2" onClick={() => setConfirmCancel(false)} disabled={cancelling}>
                  Mantenerla
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {open && <CheckoutWindow catalog={catalog ?? NO_CATALOG} status={status} track={track} onClose={closeWindow} onRecheck={recheck} onApproved={approved} />}
    </section>
  );
};
