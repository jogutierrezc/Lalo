/**
 * src/lib/usePayments.ts
 *
 * Historial de pagos del creador.
 *
 * TODO (fase posterior): conectar con src/lib/paymentsApi.ts cuando el agente
 * de pagos del servidor lo entregue. Hasta entonces no hay datos reales: el
 * hook devuelve una lista vacía y el estado «pendiente de conexión», para que
 * la vista lo diga con claridad en vez de inventar pagos.
 */

export type PaymentStatus = 'pagado' | 'reembolsado' | 'fallido' | 'pendiente';

export interface PaymentRow {
  id: string;
  /** Fecha ISO del cobro. */
  date: string;
  concept: string;
  amountUsd: number;
  status: PaymentStatus;
  receiptUrl?: string | null;
}

export type PaymentsState = 'pendiente-de-conexion' | 'listo';

export interface PaymentsResult {
  rows: PaymentRow[];
  state: PaymentsState;
}

export function usePayments(): PaymentsResult {
  return { rows: [], state: 'pendiente-de-conexion' };
}
