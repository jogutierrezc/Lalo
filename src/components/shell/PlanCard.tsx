/**
 * src/components/shell/PlanCard.tsx
 *
 * Tarjeta «Tu suscripción»: anillo con los días que quedan, el estado y una
 * frase que dice qué pasa a continuación. Se usa en Inicio y en Plan y pagos.
 * El anillo se dibuja con GSAP (salvo «reducir movimiento»). El estado malo se
 * dibuja con trazo discontinuo, además del color.
 */

import React, { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { reduced } from '../../utils/alertMotion';
import { formatDateEs, formatMoney } from '../../lib/billingLogic';
import { STATE_LABEL, STATE_TONE, type PlanSummary } from '../../lib/planDays';
import { Card, Pill } from '../tally-ui';
import { usePlanSummary } from './usePlanSummary';

gsap.registerPlugin(useGSAP);

const R = 56;
const C = 2 * Math.PI * R;
const TONE_COLOR = { ok: '#3ddc97', warn: '#ffb020', bad: '#ff8a8a', gift: '#f5f6f8', neutral: '#9aa1ab' } as const;

/** Frase que acompaña al anillo. */
export function planSentence(p: PlanSummary): string {
  const end = p.endsAt ? formatDateEs(p.endsAt) : '';
  switch (p.state) {
    case 'activo':
      if (p.origin === 'code') return `Acceso por código hasta el ${end}. No se renueva solo.`;
      return `Se renueva solo el ${end}${p.nextChargeUsd != null ? ` por ${formatMoney(p.nextChargeUsd)}` : ''} con PayPal.`;
    case 'porvencer':
      if (p.renews) return `Se renueva el ${end}${p.nextChargeUsd != null ? ` por ${formatMoney(p.nextChargeUsd)}` : ''} con PayPal.`;
      return `No se renueva. Tienes acceso hasta el ${end}.`;
    case 'gracia':
      return `No pudimos cobrar tu pago. Actualiza PayPal antes del ${end} para no perder el plan.`;
    case 'vencido':
      return 'Tu plan terminó. Sigues con el plan Gratis y tus capas básicas.';
    case 'regalo':
      return `Regalo de fundador hasta el ${end}. Al terminar pasas al plan Gratis.`;
    default:
      return 'Estás en el plan Gratis. Cuando quieras más, elige un plan.';
  }
}

const CTA: Record<PlanSummary['state'], string> = {
  activo: 'Ver pagos',
  porvencer: 'Ver plan',
  gracia: 'Resolver pago',
  vencido: 'Contratar de nuevo',
  regalo: 'Ver planes',
  gratis: 'Ver planes',
};

export const PlanRing: React.FC<{ plan: PlanSummary }> = ({ plan }) => {
  const arc = useRef<SVGCircleElement | null>(null);
  const num = useRef<HTMLElement | null>(null);
  const tone = STATE_TONE[plan.state];
  const frac = plan.totalDays > 0 ? Math.max(0, Math.min(1, plan.days / plan.totalDays)) : 0;
  const target = C * (1 - frac);

  useGSAP(
    () => {
      const el = arc.current;
      const label = num.current;
      if (!el || !label) return;
      if (reduced()) {
        el.setAttribute('stroke-dashoffset', target.toFixed(2));
        label.textContent = String(plan.days);
        return;
      }
      const o = { v: 0, d: C };
      gsap.to(o, {
        v: plan.days,
        d: target,
        duration: 0.9,
        ease: 'power3.out',
        onUpdate: () => {
          label.textContent = String(Math.round(o.v));
          el.setAttribute('stroke-dashoffset', o.d.toFixed(2));
        },
      });
    },
    { dependencies: [plan.days, plan.totalDays], revertOnUpdate: true }
  );

  return (
    <div className="tally-ring">
      <svg viewBox="0 0 132 132" aria-hidden="true">
        <circle cx="66" cy="66" r={R} fill="none" stroke="#2e343b" strokeWidth="10" />
        <circle
          ref={arc}
          cx="66"
          cy="66"
          r={R}
          fill="none"
          stroke={TONE_COLOR[tone]}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={tone === 'bad' ? '4 7' : C.toFixed(2)}
          strokeDashoffset={tone === 'bad' ? 0 : target.toFixed(2)}
        />
      </svg>
      <div className="tally-ring-num">
        <b ref={num}>{plan.days}</b>
        <small>{plan.days === 1 ? 'día' : 'días'}</small>
      </div>
    </div>
  );
};

interface Props {
  /** En Plan y pagos la acción real vive en «Mi plan», así que no se repite el botón. */
  showCta?: boolean;
}

export const PlanCard: React.FC<Props> = ({ showCta = true }) => {
  const plan = usePlanSummary();
  const tone = STATE_TONE[plan.state];
  return (
    <Card title="Tu suscripción" aside={<Pill tone={tone}>{STATE_LABEL[plan.state]}</Pill>} data-testid="tarjeta-plan">
      <div className="tally-days">
        {plan.state !== 'gratis' && <PlanRing plan={plan} />}
        <div>
          <h4>{plan.state === 'vencido' ? 'Plan Gratis' : plan.planName}</h4>
          <p className="tally-days-sub">{planSentence(plan)}</p>
          {showCta && (
            <div className="tally-days-row">
              <a className="tui-btn" data-variante="principal" href="#cuenta">
                {CTA[plan.state]}
              </a>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};
