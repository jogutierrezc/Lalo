/**
 * src/pages/admin/useAdminBilling.ts
 *
 * Carga de la bandeja de pagos y de la facturación del administrador, con los
 * cuatro estados que la interfaz sabe pintar:
 *   loading  leyendo
 *   ready    con datos (la lista puede estar vacía)
 *   pending  el servidor aún no tiene lo necesario (migración 0053 sin aplicar
 *            o ruta sin desplegar): «pendiente de conexión», no un error
 *   error    cualquier otro fallo, con «Reintentar»
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAdminBillingSummary, fetchAdminInbox, type AdminInbox, type BillingSummary } from '../../lib/adminBillingApi';
import type { ApiOutcome } from '../../lib/integrationsApi';

/** Códigos con los que el servidor dice «todavía no está conectado». */
export const PENDING_CODES = ['migration_missing', 'not_found', 'no_route'];

export type LoadState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'pending' }
  | { status: 'error'; message: string };

export function toLoadState<T>(res: ApiOutcome<T>): LoadState<T> {
  if (res.ok) return { status: 'ready', data: res.data };
  if (PENDING_CODES.includes(res.code)) return { status: 'pending' };
  return { status: 'error', message: res.message };
}

function useResource<T>(fetcher: () => Promise<ApiOutcome<T>>) {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' });
  const aliveRef = useRef(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    const res = await fetcherRef.current();
    if (aliveRef.current) setState(toLoadState(res));
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    load();
    return () => {
      aliveRef.current = false;
    };
  }, [load]);

  const replace = useCallback((data: T) => setState({ status: 'ready', data }), []);
  return { state, reload: load, replace };
}

export interface AdminInboxHook {
  state: LoadState<AdminInbox>;
  reload: () => Promise<void>;
  replace: (inbox: AdminInbox) => void;
}

export const useAdminInbox = (): AdminInboxHook => useResource(fetchAdminInbox);

export const useAdminBillingSummary = () => useResource<BillingSummary>(() => fetchAdminBillingSummary());
