/**
 * src/components/billing/PaymentHistory.tsx
 *
 * Historial de pagos del creador: fecha, concepto, importe, estado y número de
 * recibo (con botón para copiarlo; aún no hay recibo en PDF). Recibe lo que
 * devuelve usePayments y explica cada estado: cargando, vacío, error o
 * «pendiente de conexión». Los errores van con borde discontinuo y texto.
 */

import React, { useState } from 'react';
import { Boton, Card, Pill, type TonoPill } from '../tally-ui';
import { formatDateEs } from '../../lib/billingLogic';
import { formatMoney } from '../../lib/paymentsLogic';
import type { PaymentRow, PaymentStatus, PaymentsState } from '../../lib/usePayments';

const LABEL: Record<PaymentStatus, string> = {
  paid: 'Pagado',
  refunded: 'Reembolsado',
  reversed: 'Revertido',
  failed: 'Falló el cobro',
  pending: 'Pendiente',
};
const TONE: Record<PaymentStatus, TonoPill> = { paid: 'ok', refunded: 'neutral', reversed: 'bad', failed: 'bad', pending: 'warn' };

interface Props {
  rows: PaymentRow[];
  state?: PaymentsState;
  error?: string | null;
  onRetry?: () => void;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const ReceiptCell: React.FC<{ receipt: string }> = ({ receipt }) => {
  const [done, setDone] = useState<'ok' | 'fail' | null>(null);
  return (
    <span className="tally-receipt">
      <code>{receipt}</code>{' '}
      <Boton
        pequeno
        aria-label={`Copiar nº de recibo ${receipt}`}
        onClick={async () => setDone((await copyText(receipt)) ? 'ok' : 'fail')}
      >
        {done === 'ok' ? 'Copiado' : done === 'fail' ? 'No se pudo copiar' : 'Copiar nº de recibo'}
      </Boton>
    </span>
  );
};

function message(state: PaymentsState, error?: string | null): string {
  switch (state) {
    case 'cargando':
      return 'Cargando tus pagos…';
    case 'pendiente-de-conexion':
      return 'El historial de pagos aún no está conectado. Cuando lo esté, verás aquí cada cobro con su recibo.';
    case 'error':
      return error || 'No se pudo cargar el historial de pagos.';
    default:
      return 'Todavía no hay pagos registrados.';
  }
}

export const PaymentHistory: React.FC<Props> = ({ rows, state = 'listo', error, onRetry }) => (
  <Card title="Historial de pagos" data-testid="historial-pagos">
    {rows.length === 0 ? (
      <div>
        <p role="status" data-estado={state} className={state === 'error' ? 'tally-note-bad' : undefined}>
          {message(state, error)}
        </p>
        {state === 'error' && onRetry && (
          <Boton variante="error" pequeno onClick={onRetry}>
            Reintentar
          </Boton>
        )}
      </div>
    ) : (
      <div className="tally-tw">
        <table className="tally-tbl">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Concepto</th>
              <th className="n">Importe</th>
              <th>Estado</th>
              <th>Recibo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{formatDateEs(row.date)}</td>
                <td>{row.concept}</td>
                <td className="n">{formatMoney(row.amount, row.currency)}</td>
                <td>
                  <Pill tone={TONE[row.status]}>{LABEL[row.status]}</Pill>
                  {row.status === 'refunded' && row.refundedAmount > 0 && (
                    <small> {formatMoney(row.refundedAmount, row.currency)}</small>
                  )}
                </td>
                <td>{row.receipt ? <ReceiptCell receipt={row.receipt} /> : <span aria-label="Sin recibo">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </Card>
);
