/**
 * src/lib/usePayments.ts
 *
 * Historial de pagos del creador y su próximo cobro, leídos de GET /api/paypal/payments
 * (src/lib/paymentsApi.ts). Estados: cargando, listo, vacío, error y «pendiente de conexión»
 * (el servidor aún no tiene la migración 0046 a 0051 o la ruta no existe).
 */

import { useCallback, useEffect, useState } from 'react';
import { fetchPayments, type NextCharge, type PaymentRow, type PaymentStatus } from './paymentsApi';

export type { NextCharge, PaymentRow, PaymentStatus };

export type PaymentsState = 'cargando' | 'listo' | 'vacio' | 'error' | 'pendiente-de-conexion';

export interface PaymentsResult {
  rows: PaymentRow[];
  nextCharge: NextCharge | null;
  state: PaymentsState;
  /** Mensaje del servidor cuando state es «error». */
  error: string | null;
  reload: () => void;
}

/** Códigos del servidor que significan «todavía no está conectado»: falta la migración o la ruta no existe. */
const NOT_CONNECTED = ['migration_missing', 'not_found', 'no_route'];

export function isNotConnected(code: string): boolean {
  return NOT_CONNECTED.includes(code);
}

export function usePayments(enabled = true): PaymentsResult {
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [nextCharge, setNextCharge] = useState<NextCharge | null>(null);
  const [state, setState] = useState<PaymentsState>(enabled ? 'cargando' : 'vacio');
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setRows([]);
      setNextCharge(null);
      setError(null);
      setState('vacio');
      return;
    }
    let alive = true;
    setState('cargando');
    fetchPayments()
      .then((res) => {
        if (!alive) return;
        if (res.ok) {
          setRows(res.data.payments);
          setNextCharge(res.data.nextCharge);
          setError(null);
          setState(res.data.payments.length > 0 ? 'listo' : 'vacio');
        } else {
          setRows([]);
          setNextCharge(null);
          setError(isNotConnected(res.code) ? null : res.message);
          setState(isNotConnected(res.code) ? 'pendiente-de-conexion' : 'error');
        }
      })
      .catch(() => {
        if (!alive) return;
        setRows([]);
        setNextCharge(null);
        setError('No se pudo leer el historial de pagos. Prueba otra vez en un momento.');
        setState('error');
      });
    return () => {
      alive = false;
    };
  }, [enabled, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { rows, nextCharge, state, error, reload };
}
