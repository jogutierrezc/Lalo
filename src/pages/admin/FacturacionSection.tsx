/**
 * src/pages/admin/FacturacionSection.tsx
 *
 * Facturación del sistema: cuatro cifras (ingresos del mes con su variación,
 * suscripciones activas, renovaciones de los próximos 30 días y cobros
 * fallidos), la gráfica de ingresos de 6 meses a escala, el desglose por plan
 * y periodo y la tabla de recibos recientes.
 *
 * No hay «Exportar»: el servidor no tiene endpoint para ello. Estados:
 * leyendo, pendiente de conexión, error con «Reintentar» y vacío.
 */

import React, { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { Card, Pill } from '../../components/tally-ui';
import { EstadoCarga } from '../../components/admin/EstadoCarga';
import type { BillingSummary } from '../../lib/adminBillingApi';
import { buildChart, chartLabel, hasAnyRevenue, percentText, receiptTone, tickText, usd, variationText } from '../../lib/adminBillingView';
import { formatDateEs, periodLabel } from '../../lib/billingLogic';
import { formatMoney, paymentStatusLabel } from '../../lib/paymentsLogic';
import { reduced } from '../../utils/alertMotion';
import type { useAdminBillingSummary } from './useAdminBilling';
import '../../styles/admin-tally.css';

type SummaryHook = ReturnType<typeof useAdminBillingSummary>;

export const FacturacionSection: React.FC<{ summary: SummaryHook }> = ({ summary }) => {
  const { state, reload } = summary;
  return (
    <div className="atl-page">
      <p className="atl-lede">
        Lo que cobra el sistema por PayPal: ingresos netos de reembolsos (solo cobros en dólares), suscripciones vivas y cobros que han fallado.
      </p>
      <EstadoCarga
        state={state}
        what="la facturación"
        pendingText="El servidor todavía no tiene el resumen de facturación: falta aplicar la migración 0053 en Supabase. Cuando esté lista, aquí verás ingresos, renovaciones y recibos."
        onRetry={reload}
      />
      {state.status === 'ready' &&
        (hasAnyRevenue(state.data) ? (
          <Resumen data={state.data} />
        ) : (
          <div className="atl-vacio atl-card-vacio">
            <b>Aún no hay cobros</b>
            <span>Cuando un creador pague un plan, sus ingresos y su recibo aparecerán aquí.</span>
          </div>
        ))}
    </div>
  );
};

const Resumen: React.FC<{ data: BillingSummary }> = ({ data }) => {
  const root = useRef<HTMLDivElement>(null);
  const chart = buildChart(data.months);
  const variation = variationText(data.variationPct);

  // Las barras entran desde la base con un fundido corto (parten de un 92 % de altura, nunca de cero)
  useGSAP(
    () => {
      if (reduced()) return;
      gsap.from('.atl-bar', { scaleY: 0.92, opacity: 0, transformOrigin: '50% 100%', duration: 0.3, ease: 'expo.out', stagger: 0.03, clearProps: 'transform,opacity' });
    },
    { scope: root }
  );

  return (
    <div ref={root} className="atl-stack">
      <div className="atl-kpis">
        <div className="atl-kpi">
          <small>Ingresos del mes</small>
          <b>{usd(data.currentRevenue)}</b>
          {variation ? (
            <span className="atl-delta" data-dir={data.variationPct !== null && data.variationPct < 0 ? 'down' : 'up'}>
              {variation} vs. mes anterior
            </span>
          ) : (
            <span className="atl-delta" data-dir="flat">
              Sin mes anterior con que comparar
            </span>
          )}
        </div>
        <div className="atl-kpi">
          <small>Suscripciones activas</small>
          <b>{data.activeSubscriptions}</b>
          <span className="atl-delta" data-dir="flat">
            Con acceso pagado hoy
          </span>
        </div>
        <div className="atl-kpi">
          <small>Renuevan en 30 días</small>
          <b>{data.renewals30.count}</b>
          <span className="atl-delta" data-dir="flat">
            {usd(data.renewals30.amount)} previstos
          </span>
        </div>
        <div className="atl-kpi">
          <small>Cobros fallidos</small>
          <b>{data.failed.count}</b>
          <span className="atl-delta" data-dir={data.failed.count > 0 ? 'down' : 'flat'}>
            {percentText(data.failed.pctOfActive)}
          </span>
        </div>
      </div>

      <div className="atl-grid2">
        <Card title="Ingresos por mes (USD)">
          <svg className="atl-chart" viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label={chartLabel(data)}>
            {chart.ticks.map((tick) => (
              <g key={tick.value}>
                <line x1={chart.left} x2={chart.width} y1={tick.y} y2={tick.y} className="atl-grid" />
                <text x={chart.left - 8} y={tick.y + 4} textAnchor="end">
                  {tickText(tick.value)}
                </text>
              </g>
            ))}
            {chart.bars.map((bar) => (
              <g key={bar.month} className="atl-bar" data-current={bar.current ? '' : undefined}>
                <rect x={bar.x} y={bar.y} width={bar.width} height={Math.max(bar.height, bar.value > 0 ? 1 : 0)} rx={4} />
                <text x={bar.x + bar.width / 2} y={chart.height - 8} textAnchor="middle">
                  {bar.label}
                </text>
                {(bar.current || bar.value > 0) && (
                  <text x={bar.x + bar.width / 2} y={bar.y - 6} textAnchor="middle" className="atl-bar-val" data-current={bar.current ? '' : undefined}>
                    {tickText(bar.value)}
                  </text>
                )}
              </g>
            ))}
          </svg>
        </Card>

        <Card title="Por plan y periodo">
          {data.breakdown.length === 0 ? (
            <p>Todavía no hay suscripciones activas.</p>
          ) : (
            <dl className="atl-kv">
              {data.breakdown.map((row) => (
                <React.Fragment key={`${row.planId}:${row.months}`}>
                  <dt>
                    {row.planName} · {periodLabel(row.months)}
                  </dt>
                  <dd>
                    {row.count} · {usd(row.amount)}
                  </dd>
                </React.Fragment>
              ))}
            </dl>
          )}
          <p className="atl-hint">Cuenta suscripciones activas y en gracia con el precio de su periodo. Los accesos por código o regalo no tienen ingreso.</p>
        </Card>
      </div>

      <Card title="Recibos recientes">
        {data.receipts.length === 0 ? (
          <p>Todavía no hay recibos.</p>
        ) : (
          <div className="atl-tablewrap" tabIndex={0} role="region" aria-label="Recibos recientes">
            <table className="atl-table">
              <thead>
                <tr>
                  <th scope="col">Nº</th>
                  <th scope="col">Fecha</th>
                  <th scope="col">Creador</th>
                  <th scope="col">Concepto</th>
                  <th scope="col" className="atl-n">
                    Importe
                  </th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                {data.receipts.map((r) => (
                  <tr key={r.receipt}>
                    <td className="atl-mono">{r.receipt}</td>
                    <td>{formatDateEs(r.date)}</td>
                    <td>{r.creator}</td>
                    <td>{r.concept}</td>
                    <td className="atl-n">{formatMoney(r.amount, r.currency)}</td>
                    <td>
                      <Pill tone={receiptTone(r.status)}>{paymentStatusLabel(r.status)}</Pill>
                      {r.refundedAmount > 0 && <small className="atl-sub">Reembolsado {formatMoney(r.refundedAmount, r.currency)}</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};
