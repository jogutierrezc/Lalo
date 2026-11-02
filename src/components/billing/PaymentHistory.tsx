/**
 * src/components/billing/PaymentHistory.tsx
 *
 * Historial de pagos del creador: fecha, concepto, importe, estado y recibo.
 * Recibe las filas ya listas (ver src/lib/usePayments.ts). Sin filas, explica
 * por qué: o aún no hay pagos o el historial todavía no está conectado.
 */

import React from 'react';
import { Card, Pill, type TonoPill } from '../tally-ui';
import { formatDateEs, formatMoney } from '../../lib/billingLogic';
import type { PaymentRow, PaymentStatus, PaymentsState } from '../../lib/usePayments';

const LABEL: Record<PaymentStatus, string> = {
  pagado: 'Pagado',
  reembolsado: 'Reembolsado',
  fallido: 'Falló el cobro',
  pendiente: 'Pendiente',
};
const TONE: Record<PaymentStatus, TonoPill> = { pagado: 'ok', reembolsado: 'neutral', fallido: 'bad', pendiente: 'warn' };

interface Props {
  rows: PaymentRow[];
  state?: PaymentsState;
}

export const PaymentHistory: React.FC<Props> = ({ rows, state = 'listo' }) => (
  <Card title="Historial de pagos" data-testid="historial-pagos">
    {rows.length === 0 ? (
      <p role="status">
        {state === 'pendiente-de-conexion'
          ? 'El historial de pagos aún no está conectado. Cuando lo esté, verás aquí cada cobro con su recibo.'
          : 'Todavía no hay pagos registrados.'}
      </p>
    ) : (
      <div className="tally-tw">
        <table className="tally-tbl">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Concepto</th>
              <th className="n">Importe</th>
              <th>Estado</th>
              <th>
                <span className="tally-sr">Recibo</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{formatDateEs(row.date)}</td>
                <td>{row.concept}</td>
                <td className="n">{formatMoney(row.amountUsd)}</td>
                <td>
                  <Pill tone={TONE[row.status]}>{LABEL[row.status]}</Pill>
                </td>
                <td className="n">
                  {row.receiptUrl && row.status !== 'fallido' && (
                    <a className="tally-link" href={row.receiptUrl} target="_blank" rel="noreferrer">
                      Recibo
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </Card>
);
