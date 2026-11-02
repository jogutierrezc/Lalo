/**
 * src/pages/admin/BandejaSection.tsx
 *
 * Bandeja de pagos: todo lo que necesita atención en un solo lugar (cobros
 * fallidos, vencimientos próximos, reembolsos, avisos de PayPal sin procesar y
 * pagos sin completar). Lista con filtros a la izquierda y detalle a la derecha.
 *
 * Solo ofrece lo que el servidor soporta: «Marcar resuelto» (con nota opcional).
 * Enviar recordatorio y extender días no tienen endpoint: salen deshabilitados
 * con «Próximamente». El id de PayPal solo lo ve el administrador.
 *
 * Estados: leyendo, pendiente de conexión (migración 0053), error con
 * «Reintentar», vacío («Todo al día») y filtro sin resultados.
 */

import React, { useId, useMemo, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Boton, Pill, type TonoPill } from '../../components/tally-ui';
import { EstadoCarga } from '../../components/admin/EstadoCarga';
import { resolveInboxItem, type InboxItem } from '../../lib/adminBillingApi';
import { inboxKindLabel } from '../../lib/adminBillingLogic';
import {
  INBOX_FILTERS,
  daysText,
  eventLabel,
  filterInbox,
  inboxTone,
  nextSelection,
  pickSelection,
  type InboxFilter,
} from '../../lib/adminBillingView';
import { formatDateEs } from '../../lib/billingLogic';
import { formatMoney } from '../../lib/paymentsLogic';
import { reduced } from '../../utils/alertMotion';
import { formatDateTime } from './adminFormat';
import type { AdminInboxHook } from './useAdminBilling';
import '../../styles/admin-tally.css';

const EASE = 'expo.out';
const PILL_TONE: Record<ReturnType<typeof inboxTone>, TonoPill> = { bad: 'bad', warn: 'warn', neutral: 'neutral' };

export const BandejaSection: React.FC<{ inbox: AdminInboxHook }> = ({ inbox }) => {
  const { state, reload, replace } = inbox;
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [wanted, setWanted] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [resolving, setResolving] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ key: string; text: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const noteId = useId();

  const items = state.status === 'ready' ? state.data.items : [];
  const counts = state.status === 'ready' ? state.data.counts : null;
  const visible = useMemo(() => filterInbox(items, filter), [items, filter]);
  const selectedKey = pickSelection(visible, wanted);
  const selected = visible.find((item) => item.key === selectedKey) ?? null;

  // Al cambiar de ítem el detalle entra con un fundido corto (sin movimiento si se pidió reducirlo)
  useGSAP(
    () => {
      if (!detailRef.current || !selectedKey || reduced()) return;
      gsap.fromTo(detailRef.current, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.22, ease: EASE, clearProps: 'transform,opacity' });
    },
    { dependencies: [selectedKey], scope: detailRef }
  );

  const select = (key: string) => {
    setWanted(key);
    setNote('');
    setProblem(null);
  };

  const resolve = async (item: InboxItem) => {
    if (resolving) return;
    setResolving(item.key);
    setProblem(null);
    const res = await resolveInboxItem(item.key, note.trim());
    if (!res.ok) {
      setResolving(null);
      setProblem({ key: item.key, text: res.message });
      return;
    }
    const after = nextSelection(visible, item.key);
    const row = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-key]') ?? []).find((el) => el.dataset.key === item.key);
    const finish = () => {
      replace(res.data);
      setWanted(after);
      setNote('');
      setResolving(null);
      setNotice(`Resuelto: ${item.creator}.`);
    };
    if (row && !reduced()) {
      // Salida: el ítem se desliza y se pliega; después la lista y el contador se actualizan
      gsap.to(row, { opacity: 0, x: -14, height: 0, paddingTop: 0, paddingBottom: 0, duration: 0.26, ease: EASE, onComplete: finish });
    } else {
      finish();
    }
  };

  const status = (
    <EstadoCarga
      state={state}
      what="la bandeja de pagos"
      pendingText="El servidor todavía no tiene la bandeja de pagos: falta aplicar la migración 0053 en Supabase. Cuando esté lista, los pagos que necesiten atención aparecerán aquí."
      onRetry={reload}
    />
  );

  return (
    <div className="atl-page">
      <p className="atl-lede">
        Todo lo que necesita atención en un solo lugar: cobros fallidos, vencimientos próximos, reembolsos, avisos de PayPal sin procesar y pagos sin completar.
      </p>

      {state.status !== 'ready' ? (
        status
      ) : (
        <div className="atl-inbox">
          <div className="atl-ilist" ref={listRef}>
            <div className="atl-filters" role="group" aria-label="Filtrar la bandeja">
              {INBOX_FILTERS.map((entry) => {
                const n = entry.id === 'all' ? counts?.total ?? 0 : counts?.[entry.id] ?? 0;
                return (
                  <button key={entry.id} type="button" className="atl-fchip" aria-pressed={filter === entry.id} onClick={() => setFilter(entry.id)}>
                    {entry.label}
                    <span className="atl-fn">{n}</span>
                  </button>
                );
              })}
            </div>
            {notice && (
              <p className="atl-notice" role="status">
                <CheckCircle2 size={14} aria-hidden="true" /> {notice}
              </p>
            )}
            {items.length === 0 ? (
              <div className="atl-vacio">
                <b>Todo al día</b>
                <span>No hay pagos que requieran atención.</span>
              </div>
            ) : visible.length === 0 ? (
              <div className="atl-vacio">
                <b>Nada en este filtro</b>
                <span>Prueba con «Todo» para ver el resto de pendientes.</span>
              </div>
            ) : (
              <ul className="atl-rows" aria-label="Pagos que requieren atención">
                {visible.map((item) => {
                  const tone = inboxTone(item.kind);
                  return (
                    <li key={item.key} data-key={item.key}>
                      <button type="button" className="atl-irow" aria-current={item.key === selectedKey ? 'true' : undefined} onClick={() => select(item.key)}>
                        <span className="atl-dot" data-tone={tone} aria-hidden="true" />
                        <span className="atl-irow-main">
                          <b>{item.creator}</b>
                          <small>
                            {inboxKindLabel(item.kind)}
                            {item.note ? ` · ${item.note}` : ''}
                          </small>
                        </span>
                        <span className="atl-when">{item.date ? formatDateEs(item.date) : '—'}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="atl-idet" aria-live="polite">
            {selected ? (
              <div className="atl-detail" ref={detailRef}>
                <div>
                  <Pill tone={PILL_TONE[inboxTone(selected.kind)]}>{inboxKindLabel(selected.kind)}</Pill>
                </div>
                <h3>{selected.creator}</h3>
                {selected.note && <p className="atl-note">{selected.note}</p>}
                <dl className="atl-kv">
                  <dt>Plan</dt>
                  <dd>{selected.plan}</dd>
                  <dt>Importe</dt>
                  <dd>{formatMoney(selected.amount, selected.currency)}</dd>
                  <dt>Fecha</dt>
                  <dd>{selected.date ? formatDateEs(selected.date) : '—'}</dd>
                  <dt>Días de acceso</dt>
                  <dd>{daysText(selected.daysLeft) ?? '—'}</dd>
                  <dt>Id de PayPal</dt>
                  <dd className="atl-mono">{selected.paypalId ?? '—'}</dd>
                </dl>
                {selected.paypalId && <p className="atl-hint">El id de PayPal solo lo ve la administración.</p>}

                <div>
                  <div className="atl-lbl">Historial de eventos</div>
                  {selected.history.length === 0 ? (
                    <p className="atl-hint">Este pago no tiene eventos de PayPal asociados.</p>
                  ) : (
                    <ol className="atl-tl">
                      {selected.history.map((event, index) => (
                        <li key={`${event.type}:${event.at}:${index}`}>
                          {eventLabel(event.type)}
                          <small className="atl-mono">{event.at ? formatDateTime(event.at) : '—'}</small>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>

                <div className="atl-field">
                  <label htmlFor={noteId} className="atl-lbl">
                    Nota al resolver (opcional)
                  </label>
                  <input id={noteId} className="atl-input" value={note} maxLength={200} placeholder="Por ejemplo, el creador ya pagó por otro medio" onChange={(e) => setNote(e.target.value)} />
                </div>

                {problem?.key === selected.key && (
                  <p className="atl-error" role="alert">
                    <AlertTriangle size={16} aria-hidden="true" /> {problem.text}
                  </p>
                )}

                <div className="atl-acts">
                  <Boton pequeno disabled title="Próximamente">
                    Enviar recordatorio · Próximamente
                  </Boton>
                  <Boton pequeno disabled title="Próximamente">
                    Extender días · Próximamente
                  </Boton>
                  <Boton variante="principal" pequeno disabled={resolving !== null} onClick={() => resolve(selected)}>
                    {resolving === selected.key ? 'Guardando' : 'Marcar resuelto'}
                  </Boton>
                </div>
              </div>
            ) : (
              <div className="atl-vacio">
                <b>{items.length === 0 ? 'Nada que revisar' : 'Sin selección'}</b>
                <span>{items.length === 0 ? 'Cuando un pago necesite atención, su detalle saldrá aquí.' : 'Elige un pago de la lista.'}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
