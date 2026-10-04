/**
 * Control.tsx
 *
 * En vivo: la página para manejar la voz del chat durante el directo.
 *   - Al aire: qué suena, pausar, saltar, aprobación manual y solo texto.
 *   - Emergencia: vaciar la cola y silencio total, con cuenta atrás cancelable.
 *   - En cola: lo que espera, con sus acciones por mensaje.
 *   - Sesión y Registro: lo que ya pasó.
 * Las reglas (quién puede usarla, bloqueos, puntos y bits) están en Voz del chat.
 *
 * Los botones hablan con el widget por BroadcastChannel, que solo une pestañas
 * del mismo navegador. En OBS, el streamer y los mods controlan lo mismo con
 * comandos de chat (!s skip, !s pausa, !s block usuario...).
 */

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { Pause, Play, SkipForward, X } from 'lucide-react';
import { useSettings } from '../hooks/useSettings';
import { useCloudSession } from '../hooks/useCloudSession';
import { inkFor } from '../utils/appearance';
import { DEFAULT_TIMEOUT_MINUTES, normalizeUser } from '../utils/moderation';
import { LiveItem, LogItem, WidgetState, listenBus, postBus } from '../utils/bus';
import { buildSuiteWidgetUrl } from '../utils/widgetUrl';
import { SuiteNav } from '../components/SuiteNav';
import { GuidedTour, TourStep, isTourDone } from '../components/GuidedTour';
import { Toggle, UndoNote, useUndo } from '../components/studio/StudioKit';
import { useDelayedAction } from '../components/envivo/useDelayedAction';
import '../styles/voz-envivo.css';

const TRIGGER_LABEL: Record<string, string> = { reward: 'Puntos', bits: 'Bits', test: 'Prueba' };
const STATUS_LABEL: Record<LogItem['status'], string> = { read: 'Leído', skipped: 'Saltado', rejected: 'Descartado' };
const STALE_MS = 12000;
const CONFIRM_SECONDS = 5;

// Guía de En vivo: qué mirar y qué tocar durante el directo
const TOUR_ID = 'control';
const TOUR_STEPS: TourStep[] = [
  {
    title: 'La página para el directo',
    body: 'Aquí decides, con el directo en marcha, qué mensajes se leen y cuáles no. Son cuatro pasos y puedes usar el panel mientras tanto.',
  },
  {
    target: 'al-aire',
    title: 'Lo que suena ahora',
    body: 'Ves el mensaje que se está leyendo. «Pausar cola» deja terminar el mensaje actual y detiene los siguientes; «Saltar mensaje» lo corta al instante. Con la aprobación manual, cada mensaje espera tu visto bueno.',
  },
  {
    target: 'emergencia',
    title: 'Si algo se tuerce',
    body: '«Vaciar cola» y «Silencio total» no se pueden deshacer, así que cuentan cinco segundos antes de actuar. Puedes cancelar o pulsar «ahora» si no quieres esperar.',
  },
  {
    target: 'cola',
    title: 'Lo que espera',
    body: 'Cada mensaje en espera se puede aprobar. «Más» muestra el resto: quitarlo, silenciar a su autor diez minutos o bloquearlo.',
  },
  {
    target: 'comandos',
    title: 'En OBS, el control va por el chat',
    body: (
      <>
        El widget de OBS es otro navegador y no recibe estos botones. Allí tú y tus mods escribís <code>!s skip</code>, <code>!s pausa</code> o{' '}
        <code>!s block usuario</code>.
      </>
    ),
  },
];

type Where = 'cola' | 'registro';
type Emergency = 'clear' | 'panic';

const EMERGENCY_COPY: Record<Emergency, { warning: string; now: string; sent: string }> = {
  clear: {
    warning: 'Se va a vaciar la cola. Los mensajes que esperan no se leerán.',
    now: 'Vaciar ahora',
    sent: 'Cola vaciada. Los mensajes quedan en Registro como saltados; desde ahí puedes volver a leer uno.',
  },
  panic: {
    warning: 'Silencio total: se corta la voz, se vacía la cola y queda en pausa.',
    now: 'Silenciar ahora',
    sent: 'Silencio total enviado. La cola queda en pausa: pulsa «Reanudar cola» para volver a leer mensajes.',
  },
};

const reduced = () => !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const TriggerChip: React.FC<{ item: LiveItem }> = ({ item }) =>
  item.trigger && TRIGGER_LABEL[item.trigger] ? (
    <span className="cab-chip">{item.trigger === 'bits' && item.bits ? `${item.bits} bits` : TRIGGER_LABEL[item.trigger]}</span>
  ) : null;

export const Control: React.FC = () => {
  const { settings, update, saved } = useSettings();
  const cloud = useCloudSession();
  const uid = useId();
  const [live, setLive] = useState<WidgetState | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [tourOpen, setTourOpen] = useState(false);
  // Fila con sus acciones desplegadas («Más»)
  const [openRow, setOpenRow] = useState<string | null>(null);
  // Aviso de lo último que se hizo en una fila; si fue un bloqueo, se puede deshacer
  const feedback = useUndo<{ where: Where; blocked?: string }>();
  const emergency = useDelayedAction<Emergency>(CONFIRM_SECONDS);
  const emergencySent = useUndo<null>();

  // La guía se abre sola la primera vez; después solo desde el botón de la cabecera
  useEffect(() => {
    if (isTourDone(TOUR_ID)) return;
    const timer = setTimeout(() => setTourOpen(true), 600);
    return () => clearTimeout(timer);
  }, []);

  const nowRef = useRef<HTMLDivElement | null>(null);
  const listsRef = useRef<HTMLDivElement | null>(null);
  const seenRowsRef = useRef<Set<string> | null>(null);

  // Estado que publica el widget abierto en este navegador
  useEffect(() => {
    const stop = listenBus((message) => {
      if (message.type === 'STATE') setLive(message.state);
    });
    postBus({ type: 'STATE_REQUEST' });
    const timer = setInterval(() => setClock(Date.now()), 3000);
    return () => {
      stop();
      clearInterval(timer);
    };
  }, []);

  const online = !!live && clock - live.at < STALE_MS;
  const now = online ? live.now : null;
  const queue = online ? live.queue : [];
  const log = online ? live.log : [];
  const paused = online && live.paused;
  // Con widget abierto manda su estado real (puede haber cambiado desde el chat); sin él, lo guardado
  const approval = online ? live.approval : settings.approvalMode;
  const textOnly = online ? live.textOnly : settings.textOnly;
  const stats = online ? live.stats : null;
  const timeouts = online ? live.timeouts : [];
  const pendingCount = queue.filter((item) => item.pending).length;
  const topUsers = stats
    ? Object.entries(stats.byUser)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
    : [];

  const widgetUrl = buildSuiteWidgetUrl(
    typeof window !== 'undefined' ? window.location.origin : '',
    'tts',
    settings.channel,
    settings,
    cloud.profile?.status === 'active' ? { k: cloud.profile.widget_key } : undefined
  );

  const setApproval = (on: boolean) => {
    update({ approvalMode: on });
    postBus({ type: 'CONTROL', action: on ? 'manual' : 'auto' });
  };
  const setTextOnly = (on: boolean) => {
    update({ textOnly: on });
    postBus({ type: 'CONTROL', action: on ? 'mute' : 'unmute' });
  };

  // El mensaje al aire releva al anterior con un fundido corto
  useLayoutEffect(() => {
    if (nowRef.current && !reduced()) {
      gsap.fromTo(
        nowRef.current,
        { opacity: 0, y: 6, filter: 'blur(2px)' },
        { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.25, ease: 'power2.out', clearProps: 'filter' }
      );
    }
  }, [now?.id]);

  // Las filas nuevas de la cola y del registro entran escalonadas; las que ya estaban no se mueven
  useLayoutEffect(() => {
    if (!listsRef.current) return;
    const rows = Array.from(listsRef.current.querySelectorAll<HTMLElement>('[data-row]'));
    const first = seenRowsRef.current === null;
    const seen = seenRowsRef.current || new Set<string>();
    const fresh = rows.filter((row) => !seen.has(row.dataset.row || ''));
    seenRowsRef.current = new Set(rows.map((row) => row.dataset.row || ''));
    if (!first && fresh.length && !reduced()) {
      gsap.fromTo(fresh, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.25, ease: 'power3.out', stagger: 0.04, clearProps: 'transform,opacity' });
    }
  }, [queue, log]);

  // ---------- Acciones por mensaje ----------
  const blockUser = (where: Where, item: LiveItem) => {
    setOpenRow(null);
    const user = normalizeUser(item.username);
    if (!user) return;
    if (settings.blockedUsers.includes(user)) {
      feedback.offer(`${item.user} ya estaba en la lista de bloqueados.`, { where });
      return;
    }
    update({ blockedUsers: [...settings.blockedUsers, user] });
    feedback.offer(`Se bloqueó a ${item.user}. Sus mensajes ya no se leerán.`, { where, blocked: user });
  };
  const undoBlock = () => {
    const user = feedback.pending?.snapshot.blocked;
    if (user) update({ blockedUsers: settings.blockedUsers.filter((entry) => entry !== user) });
    feedback.clear();
  };
  const timeoutUser = (where: Where, item: LiveItem) => {
    setOpenRow(null);
    postBus({ type: 'CONTROL', action: 'timeout', user: item.username, minutes: DEFAULT_TIMEOUT_MINUTES });
    feedback.offer(`Se silenció a ${item.user} durante ${DEFAULT_TIMEOUT_MINUTES} minutos. Puedes quitarlo en Sesión.`, { where });
  };
  const removeFromQueue = (item: LiveItem) => {
    setOpenRow(null);
    postBus({ type: 'CONTROL', action: 'remove', id: item.id });
    feedback.offer(`Se quitó el mensaje de ${item.user}. Queda en Registro, desde donde puedes volver a leerlo.`, { where: 'cola' });
  };
  const readAgain = (item: LogItem) => {
    postBus({ type: 'ENQUEUE', text: item.text, user: item.user });
    feedback.offer(`El mensaje de ${item.user} volvió a la cola.`, { where: 'registro' });
  };

  const renderFeedback = (where: Where) => {
    const pending = feedback.pending;
    if (!pending || pending.snapshot.where !== where) return null;
    return pending.snapshot.blocked ? (
      <UndoNote label={pending.label} onUndo={undoBlock} />
    ) : (
      <p className="cab-note" role="status">
        {pending.label}
      </p>
    );
  };

  const renderMore = (where: Where, rowKey: string, item: LiveItem, canRemove: boolean) => (
    <div id={`${uid}-${rowKey}`} className="ev-more" role="group" aria-label={`Acciones para el mensaje de ${item.user}`}>
      {canRemove && (
        <button type="button" className="cab-btn2 cab-btn-sm" onClick={() => removeFromQueue(item)}>
          Quitar
        </button>
      )}
      <button type="button" className="cab-btn2 cab-btn-sm" onClick={() => timeoutUser(where, item)}>
        Silenciar {DEFAULT_TIMEOUT_MINUTES} min
      </button>
      <button type="button" className="cab-btn2 cab-btn-sm" onClick={() => blockUser(where, item)}>
        Bloquear
      </button>
    </div>
  );

  const renderMoreButton = (rowKey: string, item: LiveItem) => (
    <button
      type="button"
      className="cab-btn2 cab-btn-sm"
      aria-expanded={openRow === rowKey}
      aria-controls={`${uid}-${rowKey}`}
      aria-label={`Más acciones para el mensaje de ${item.user}`}
      onClick={() => setOpenRow(openRow === rowKey ? null : rowKey)}
    >
      Más
    </button>
  );

  // ---------- Emergencia ----------
  // El widget no sabe devolver una cola vaciada ni un mensaje cortado, así que en vez de
  // prometer un «deshacer» la orden espera cinco segundos y se puede cancelar.
  const armEmergency = (action: Emergency) => {
    emergencySent.clear();
    emergency.arm(action, () => {
      postBus({ type: 'CONTROL', action });
      emergencySent.offer(EMERGENCY_COPY[action].sent, null);
    });
  };

  const rootStyle = { '--acc': settings.accent, '--acc-ink': inkFor(settings.accent) } as React.CSSProperties;

  return (
    <div className="cab" style={{ ...rootStyle, paddingBottom: tourOpen ? 220 : undefined }}>
      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-6">
        <SuiteNav
          currentApp="control"
          channel={settings.channel}
          saved={saved}
          onOpenTour={() => setTourOpen(true)}
          tourAvailable={!tourOpen}
        />

        <div ref={listsRef} className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          {/* Columna izquierda: lo que se maneja ahora */}
          <div className="grid gap-5">
            <section className="cab-mod" data-tour="al-aire">
              <h2>Al aire</h2>

              {!online && (
                <div className="cab-note">
                  <p>
                    No hay ningún widget abierto en este navegador, así que estos botones no tienen a quién avisar. Abre el widget en otra pestaña
                    y déjala abierta. Con el widget que corre dentro de OBS, tú y tus mods controláis lo mismo con los comandos de chat de esta
                    página.
                  </p>
                  <p className="mt-3">
                    <a className="cab-btn2 cab-btn-sm" href={widgetUrl} target="_blank" rel="noreferrer">
                      Abrir widget
                    </a>
                  </p>
                </div>
              )}

              <p className="cab-tally" data-state={!online ? 'off' : paused ? 'paused' : 'on'} role="status">
                <i />
                {!online
                  ? 'Sin widget abierto en este navegador'
                  : `${paused ? 'Cola en pausa' : live.connected ? 'Conectado' : 'Conectando'} · #${live.channel}`}
              </p>

              <div ref={nowRef} className="cab-now">
                {now ? (
                  <>
                    <p className="cab-now-user">
                      {now.user} <TriggerChip item={now} />
                    </p>
                    <p className="cab-now-text">{now.text}</p>
                  </>
                ) : (
                  <p className="cab-hint">{online ? 'Nada sonando ahora. El siguiente mensaje aparecerá aquí.' : 'Aquí verás el mensaje que está sonando.'}</p>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="cab-btn"
                  disabled={!online}
                  onClick={() => postBus({ type: 'CONTROL', action: paused ? 'resume' : 'pause' })}
                >
                  {paused ? <Play className="h-4 w-4 fill-current" aria-hidden="true" /> : <Pause className="h-4 w-4 fill-current" aria-hidden="true" />}
                  <span>{paused ? 'Reanudar cola' : 'Pausar cola'}</span>
                </button>
                <button type="button" className="cab-btn2" disabled={!now} onClick={() => postBus({ type: 'CONTROL', action: 'skip' })}>
                  <SkipForward className="h-4 w-4" aria-hidden="true" />
                  <span>Saltar mensaje</span>
                </button>
              </div>

              <div className="grid gap-x-8 gap-y-[18px] sm:grid-cols-2">
                <div className="cab-field">
                  <Toggle label="Aprobación manual" checked={approval} onChange={setApproval} />
                  <span className="cab-hint">
                    {approval ? 'Cada mensaje espera tu visto bueno. Los tuyos y los de tus mods pasan solos.' : 'Los mensajes se leen según llegan.'}
                  </span>
                </div>
                <div className="cab-field">
                  <Toggle label="Solo texto" checked={textOnly} onChange={setTextOnly} />
                  <span className="cab-hint">{textOnly ? 'La alerta aparece sin voz.' : 'La alerta aparece y se lee en voz alta.'}</span>
                </div>
              </div>
            </section>

            <section className="cab-mod" data-tour="emergencia">
              <h2>Emergencia</h2>
              {emergency.pending ? (
                <div className="ev-armed">
                  <p role="status">{EMERGENCY_COPY[emergency.pending.key].warning} No se puede deshacer.</p>
                  <p className="ev-count" aria-hidden="true">
                    {emergency.pending.left} s
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="cab-btn2" autoFocus onClick={emergency.cancel}>
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className={emergency.pending.key === 'panic' ? 'cab-btn cab-btn-danger' : 'cab-btn'}
                      onClick={emergency.runNow}
                    >
                      {EMERGENCY_COPY[emergency.pending.key].now}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="cab-btn2" disabled={!queue.length} onClick={() => armEmergency('clear')}>
                      Vaciar cola
                    </button>
                    <button type="button" className="cab-btn cab-btn-danger" disabled={!online} onClick={() => armEmergency('panic')}>
                      Silencio total
                    </button>
                  </div>
                  <p className="cab-hint">
                    «Silencio total» corta la voz, vacía la cola y la deja en pausa. Las dos acciones esperan {CONFIRM_SECONDS} segundos antes de
                    actuar, por si quieres cancelar.
                  </p>
                </>
              )}
              {emergencySent.pending && !emergency.pending && (
                <p className="cab-note" role="status">
                  {emergencySent.pending.label}
                </p>
              )}
            </section>

            <section className="cab-mod" data-tour="cola">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2>En cola</h2>
                <span className="cab-hint">
                  {pendingCount > 0 && (
                    <>
                      <span className="cab-chip" data-status="skipped">
                        {pendingCount} por aprobar
                      </span>{' '}
                    </>
                  )}
                  {queue.length} de {settings.maxQueueSize}
                </span>
              </div>
              {renderFeedback('cola')}
              {queue.length ? (
                <ul className="cab-rows">
                  {queue.map((item) => {
                    const rowKey = `q-${item.id}`;
                    return (
                      <li key={item.id} data-row={rowKey} className="cab-row">
                        <div className="min-w-0">
                          <p className="cab-row-user">
                            {item.user} <TriggerChip item={item} />{' '}
                            {item.pending && (
                              <span className="cab-chip" data-status="skipped">
                                Por aprobar
                              </span>
                            )}
                          </p>
                          <p className="cab-row-text">{item.text}</p>
                        </div>
                        <div className="cab-row-actions">
                          {item.pending && (
                            <button
                              type="button"
                              className="cab-btn cab-btn-sm"
                              aria-label={`Aprobar el mensaje de ${item.user}`}
                              onClick={() => postBus({ type: 'CONTROL', action: 'approve', id: item.id })}
                            >
                              Aprobar
                            </button>
                          )}
                          {renderMoreButton(rowKey, item)}
                        </div>
                        {openRow === rowKey && renderMore('cola', rowKey, item, true)}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <span className="cab-hint">La cola está vacía.</span>
              )}
            </section>
          </div>

          {/* Columna derecha: lo que ya pasó y la ayuda */}
          <div className="grid gap-5">
            <section className="cab-mod" data-tour="sesion">
              <h2>Sesión</h2>
              {stats ? (
                <>
                  <dl className="cab-stats">
                    <div>
                      <dt>Leídos</dt>
                      <dd>{stats.read}</dd>
                    </div>
                    <div>
                      <dt>Por puntos o bits</dt>
                      <dd>{stats.paid}</dd>
                    </div>
                    <div>
                      <dt>Saltados</dt>
                      <dd>{stats.skipped}</dd>
                    </div>
                    <div>
                      <dt>Descartados</dt>
                      <dd>{stats.rejected}</dd>
                    </div>
                  </dl>
                  <div className="cab-field">
                    <span className="cab-label">Quién más ha participado</span>
                    {topUsers.length ? (
                      <ol className="cab-cmds">
                        {topUsers.map(([user, count]) => (
                          <li key={user}>
                            <b className="vz-code">{user}</b> · {count} {count === 1 ? 'mensaje' : 'mensajes'}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <span className="cab-hint">Todavía no se ha leído ningún mensaje.</span>
                    )}
                  </div>
                  <div className="cab-field">
                    <span className="cab-label">Silenciados por un rato</span>
                    {timeouts.length ? (
                      <ul className="flex flex-wrap gap-2">
                        {timeouts.map((item) => (
                          <li key={item.user} className="cab-chip cab-chip-lg">
                            <span className="cab-mono">{item.user}</span>
                            <span className="cab-hint">{Math.max(1, Math.ceil((item.until - clock) / 60000))} min</span>
                            <button
                              type="button"
                              aria-label={`Quitar el silencio a ${item.user}`}
                              title="Quitar el silencio"
                              onClick={() => postBus({ type: 'CONTROL', action: 'unblock', user: item.user })}
                            >
                              <X className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="cab-hint">
                        Nadie. «Silenciar {DEFAULT_TIMEOUT_MINUTES} min», dentro de «Más» en cada mensaje, calla a su autor ese tiempo.
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <span className="cab-hint">Los contadores de la sesión aparecen cuando hay un widget abierto en este navegador. Se reinician al recargarlo.</span>
              )}
            </section>

            <section className="cab-mod" data-tour="registro">
              <h2>Registro</h2>
              {renderFeedback('registro')}
              {log.length ? (
                <ul className="cab-rows">
                  {log.map((item) => {
                    const rowKey = `l-${item.id}-${item.at}`;
                    return (
                      <li key={rowKey} data-row={rowKey} className="cab-row">
                        <div className="min-w-0">
                          <p className="cab-row-user">
                            {item.user}{' '}
                            <span className="cab-chip" data-status={item.status}>
                              {STATUS_LABEL[item.status]}
                            </span>
                            {item.reason && <span className="cab-hint"> {item.reason}</span>}
                          </p>
                          <p className="cab-row-text">{item.text}</p>
                        </div>
                        <div className="cab-row-actions">
                          <button
                            type="button"
                            className="cab-btn2 cab-btn-sm"
                            aria-label={`Volver a leer el mensaje de ${item.user}`}
                            onClick={() => readAgain(item)}
                          >
                            Volver a leer
                          </button>
                          {renderMoreButton(rowKey, item)}
                        </div>
                        {openRow === rowKey && renderMore('registro', rowKey, item, false)}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <span className="cab-hint">
                  Aquí quedan los últimos mensajes leídos, saltados y descartados, con el motivo. Se vacía al recargar el widget.
                </span>
              )}
            </section>

            <section className="cab-mod" data-tour="comandos">
              <h2>Desde el chat</h2>
              <p className="cab-hint">
                Tú y tus mods podéis manejar la cola escribiendo en el chat. Es la forma de hacerlo cuando el widget está dentro de OBS.
              </p>
              <details className="studio-details">
                <summary>Comandos de chat para ti y tus mods</summary>
                <div>
                  <ul className="cab-cmds">
                    <li>
                      <code className="cab-mono">!s skip</code> salta el mensaje que suena
                    </li>
                    <li>
                      <code className="cab-mono">!s pausa</code> y <code className="cab-mono">!s reanudar</code> detienen y retoman la cola
                    </li>
                    <li>
                      <code className="cab-mono">!s vaciar</code> borra la cola
                    </li>
                    <li>
                      <code className="cab-mono">!s block usuario</code> y <code className="cab-mono">!s unblock usuario</code> bloquean y
                      desbloquean al instante
                    </li>
                    <li>
                      <code className="cab-mono">!s silencio</code> corta la voz, vacía la cola y pausa
                    </li>
                    <li>
                      <code className="cab-mono">!s manual</code> y <code className="cab-mono">!s auto</code> activan y quitan la aprobación manual;{' '}
                      <code className="cab-mono">!s ok</code> y <code className="cab-mono">!s no</code> aprueban o rechazan el mensaje más antiguo
                    </li>
                    <li>
                      <code className="cab-mono">!s mudo</code> y <code className="cab-mono">!s voz</code> ponen y quitan el modo solo texto
                    </li>
                    <li>
                      <code className="cab-mono">!s timeout usuario 10</code> silencia a alguien durante esos minutos
                    </li>
                    <li>
                      <code className="cab-mono">!s reload</code> recarga la capa
                    </li>
                  </ul>
                </div>
              </details>
              <p className="cab-hint">
                Las reglas están en{' '}
                <a className="studio-link" href="#tts">
                  Voz del chat
                </a>
                .
              </p>
            </section>
          </div>
        </div>
      </div>
      {tourOpen && <GuidedTour id={TOUR_ID} steps={TOUR_STEPS} onClose={() => setTourOpen(false)} />}
    </div>
  );
};
