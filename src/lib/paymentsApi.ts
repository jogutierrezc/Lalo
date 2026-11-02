/**
 * src/lib/paymentsApi.ts
 *
 * Cliente del historial de pagos del creador (GET /api/paypal/payments). Mismo manejo de errores
 * que billingApi.ts: el JSON se lee con cuidado y, si no cuadra, se devuelve «bad_response».
 *
 * SIN PROBAR contra el servidor real: se desarrolló contra el contrato.
 */

import { call, type ApiOutcome } from './integrationsApi';

export type PaymentStatus = 'paid' | 'refunded' | 'reversed' | 'failed' | 'pending';

export interface PaymentRow {
  /** Id propio (no es de PayPal): el recibo, o un hash en cobros fallidos y pendientes. */
  id: string;
  /** null en cobros fallidos y pendientes. */
  receipt: string | null;
  date: string;
  /** «Plan Pro · 3 meses» */
  concept: string;
  amount: number | null;
  currency: string;
  status: PaymentStatus;
  refundedAmount: number;
}

export interface NextCharge {
  date: string;
  amount: number;
  currency: string;
  concept: string;
}

export interface PaymentsResponse {
  payments: PaymentRow[];
  nextCharge: NextCharge | null;
}

const STATUSES: PaymentStatus[] = ['paid', 'refunded', 'reversed', 'failed', 'pending'];
const BAD_ANSWER = 'El servidor respondió algo que no se entiende. Prueba otra vez en un momento.';

const asObject = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});
const asText = (value: unknown): string => (typeof value === 'string' ? value : '');
const asAmount = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

export function parsePayments(data: Record<string, unknown>): PaymentsResponse {
  const list = Array.isArray(data.payments) ? data.payments : [];
  const next = asObject(data.nextCharge);
  const nextAmount = asAmount(next.amount);
  return {
    payments: list
      .map(asObject)
      .filter((p) => asText(p.id) && asText(p.date))
      .map(
        (p): PaymentRow => ({
          id: asText(p.id),
          receipt: asText(p.receipt) || null,
          date: asText(p.date),
          concept: asText(p.concept),
          amount: asAmount(p.amount),
          currency: asText(p.currency) || 'USD',
          status: STATUSES.includes(p.status as PaymentStatus) ? (p.status as PaymentStatus) : 'pending',
          refundedAmount: asAmount(p.refundedAmount) ?? 0,
        })
      ),
    nextCharge:
      asText(next.date) && nextAmount !== null
        ? { date: asText(next.date), amount: nextAmount, currency: asText(next.currency) || 'USD', concept: asText(next.concept) }
        : null,
  };
}

/** Historial de pagos del creador autenticado (hasta 100, el más reciente primero) y su próximo cobro. */
export async function fetchPayments(): Promise<ApiOutcome<PaymentsResponse>> {
  const res = await call('/api/paypal/payments', 'GET');
  if (!res.ok) return res;
  try {
    return { ok: true, data: parsePayments(res.data) };
  } catch {
    return { ok: false, code: 'bad_response', message: BAD_ANSWER, missing: [] };
  }
}
