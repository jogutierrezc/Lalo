/**
 * Control.tsx
 *
 * Control en vivo de las alertas, en estilo Cabina. Es la mesa que el streamer
 * usa durante el directo, separada de los ajustes:
 *   - Al aire: qué suena, la cola, pausar, saltar y vaciar.
 *   - Reglas: quién puede usar el TTS, espera, longitud, cola y bloqueos.
 *   - Disparadores: comando !s, puntos del canal y bits.
 *   - Registro: lo leído, lo saltado y lo descartado, con el motivo.
 *
 * Los botones de "Al aire" hablan con el widget por BroadcastChannel, que solo
 * une pestañas del mismo navegador. En OBS, el streamer y los mods controlan lo
 * mismo con comandos de chat (!s skip, !s pausa, !s block usuario...).
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import tmi from 'tmi.js';
import { Ban, Check, Clock, Copy, Pause, VolumeX, Play, Radar, RotateCcw, SkipForward, Trash2, X } from 'lucide-react';
import { useSettings } from '../hooks/useSettings';
import { inkFor } from '../utils/appearance';
import { DEFAULT_TIMEOUT_MINUTES, LIMITS, MIN_ROLES, normalizeUser, parseWordList } from '../utils/moderation';
import { LiveItem, LogItem, WidgetState, listenBus, postBus } from '../utils/bus';
import { buildWidgetUrl } from '../utils/widgetUrl';
import { SuiteNav } from '../components/SuiteNav';
import { GuidedTour, TourStep, isTourDone } from '../components/GuidedTour';

const TRIGGER_LABEL: Record<string, string> = { reward: 'Puntos', bits: 'Bits', test: 'Prueba' };
const STATUS_LABEL: Record<LogItem['status'], string> = { read: 'Leído', skipped: 'Saltado', rejected: 'Descartado' };
const STALE_MS = 12000;

// Guía del control en vivo: qué mirar y qué tocar durante el directo
const TOUR_ID = 'control';
const TOUR_STEPS: TourStep[] = [
  {
    title: 'La mesa para el directo',
    body: 'Ajustes se prepara antes de salir al aire. Aquí decides, en directo, qué mensajes se leen y cuáles no. Son cinco pasos y puedes usar el panel mientras tanto.',
  },
  {
    target: 'al-aire',
    title: 'Lo que suena y lo que espera',
    body: 'Arriba ves el mensaje que se está leyendo; debajo, la cola. Pausar deja terminar el mensaje actual y detiene los siguientes. Saltar lo corta al instante y Silencio lo para todo de golpe. Con la aprobación manual, cada mensaje espera tu visto bueno. En cada mensaje en espera puedes quitarlo o bloquear a quien lo escribió.',
  },
  {
    target: 'reglas',
    title: 'Decide quién habla y cuánto',
    body: 'Limita el comando a subs, VIP o mods, pon una espera entre mensajes del mismo espectador y acorta la longitud. Un mensaje con una palabra bloqueada se descarta entero.',
  },
  {
    target: 'disparadores',
    title: 'Puntos del canal y bits',
    body: 'Además del comando !s, puedes leer el texto de un canje de puntos o de un cheer. Para los puntos, pulsa Detectar y canjea la recompensa una vez: queda enlazada sin iniciar sesión en Twitch.',
  },
  {
    target: 'obs',
    title: 'En OBS, el control va por el chat',
    body: (
      <>
        El widget de OBS es otro navegador y no recibe estos botones. Allí tú y tus mods escribís <code>!s skip</code>, <code>!s pausa</code> o{' '}
        <code>!s block usuario</code>. Cuando cambies reglas, copia la URL de nuevo en la fuente de OBS.
      </>
    ),
  },
  {
    target: 'registro',
    title: 'Revisa lo que pasó',
    body: 'Cada mensaje queda como leído, saltado o descartado, con el motivo. Desde aquí puedes volver a leer uno o bloquear a su autor.',
  },
];

const reduced = () => !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const Field: React.FC<{ label: string; htmlFor?: string; hint?: React.ReactNode; children: React.ReactNode }> = ({
  label,
  htmlFor,
  hint,
  children,
}) => (
  <div className="cab-field">
    {htmlFor ? (
      <label className="cab-label" htmlFor={htmlFor}>
        {label}
      </label>
    ) : (
      <span className="cab-label">{label}</span>
    )}
    {children}
    {hint && <span className="cab-hint">{hint}</span>}
  </div>
);

const TriggerChip: React.FC<{ item: LiveItem }> = ({ item }) =>
  item.trigger && TRIGGER_LABEL[item.trigger] ? (
    <span className="cab-chip">{item.trigger === 'bits' && item.bits ? `${item.bits} bits` : TRIGGER_LABEL[item.trigger]}</span>
  ) : null;

export const Control: React.FC = () => {
  const { settings, update, saved } = useSettings();
  const [live, setLive] = useState<WidgetState | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [wordsDraft, setWordsDraft] = useState(() => settings.blockedWords.join(', '));
  const [userDraft, setUserDraft] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);

  // La guía se abre sola la primera vez; después solo desde el botón de la cabecera
  useEffect(() => {
    if (isTourDone(TOUR_ID)) return;
    const timer = setTimeout(() => setTourOpen(true), 600);
    return () => clearTimeout(timer);
  }, []);

  const nowRef = useRef<HTMLDivElement | null>(null);
  const listsRef = useRef<HTMLDivElement | null>(null);
  const seenRowsRef = useRef<Set<string> | null>(null);
  const stopDetectRef = useRef<(() => void) | null>(null);

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

  useEffect(() => () => stopDetectRef.current?.(), []);

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

  const blockUser = (username: string) => {
    const user = normalizeUser(username);
    if (!user || settings.blockedUsers.includes(user)) return;
    update({ blockedUsers: [...settings.blockedUsers, user] });
  };
  const unblockUser = (user: string) => update({ blockedUsers: settings.blockedUsers.filter((u) => u !== user) });
  const addUserDraft = () => {
    blockUser(userDraft);
    setUserDraft('');
  };

  // Detecta la recompensa de puntos: escucha el chat público hasta que alguien la canjea
  const startDetect = () => {
    const channel = settings.channel.trim().toLowerCase();
    if (!channel || detecting) return;
    const client = new tmi.Client({ connection: { reconnect: false, secure: true }, channels: [channel] });
    const stop = () => {
      clearTimeout(timer);
      client.removeAllListeners();
      client.disconnect().catch(() => {});
      stopDetectRef.current = null;
      setDetecting(false);
    };
    const timer = setTimeout(stop, 90000);
    client.on('message', (_channel, tags) => {
      const rewardId = tags['custom-reward-id'];
      if (rewardId) {
        update({ rewardId: String(rewardId).toLowerCase() });
        stop();
      }
    });
    stopDetectRef.current = stop;
    setDetecting(true);
    client.connect().catch(stop);
  };

  const widgetUrl = buildWidgetUrl(window.location.origin, settings);
  const copyWidgetUrl = () => {
    navigator.clipboard.writeText(widgetUrl).catch(() => {});
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2200);
  };

  const rootStyle = { '--acc': settings.accent, '--acc-ink': inkFor(settings.accent) } as React.CSSProperties;

  return (
    <div className="cab" style={{ ...rootStyle, paddingBottom: tourOpen ? 220 : undefined }}>
      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-6">
        {/* Barra de navegación de la Suite */}
        <SuiteNav
          currentApp="control"
          channel={settings.channel}
          saved={saved}
          onOpenTour={() => setTourOpen(true)}
          tourAvailable={!tourOpen}
        />

        <div ref={listsRef} className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          {/* Columna izquierda: lo que pasa ahora */}
          <div className="grid gap-5">
            <section className="cab-mod" data-tour="al-aire">
              <h2>Al aire</h2>
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
                  {paused ? 'Reanudar cola' : 'Pausar cola'}
                </button>
                <button type="button" className="cab-btn2" disabled={!now} onClick={() => postBus({ type: 'CONTROL', action: 'skip' })}>
                  <SkipForward className="h-4 w-4" aria-hidden="true" />
                  Saltar mensaje
                </button>
                <button type="button" className="cab-btn2" disabled={!queue.length} onClick={() => postBus({ type: 'CONTROL', action: 'clear' })}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Vaciar cola
                </button>
                <button type="button" className="cab-btn cab-btn-danger" disabled={!online} onClick={() => postBus({ type: 'CONTROL', action: 'panic' })}>
                  <VolumeX className="h-4 w-4" aria-hidden="true" />
                  Silencio
                </button>
              </div>

              <div className="grid gap-x-8 gap-y-[18px] sm:grid-cols-2">
                <Field
                  label="Aprobación manual"
                  htmlFor="approvalMode"
                  hint={approval ? 'Cada mensaje espera tu visto bueno. Los tuyos y los de tus mods pasan solos.' : 'Los mensajes se leen según llegan.'}
                >
                  <input id="approvalMode" type="checkbox" className="cab-tog" checked={approval} onChange={(e) => setApproval(e.target.checked)} />
                </Field>
                <Field label="Solo texto" htmlFor="textOnly" hint={textOnly ? 'La alerta aparece sin voz.' : 'La alerta aparece y se lee en voz alta.'}>
                  <input id="textOnly" type="checkbox" className="cab-tog" checked={textOnly} onChange={(e) => setTextOnly(e.target.checked)} />
                </Field>
              </div>

              <div className="cab-field">
                <span className="cab-label">
                  {pendingCount > 0 && <span className="cab-chip" data-status="skipped">{pendingCount} por aprobar</span>}{' '}
                  En cola · {queue.length} de {settings.maxQueueSize}
                </span>
                {queue.length ? (
                  <ul className="cab-rows">
                    {queue.map((item) => (
                      <li key={item.id} data-row={`q-${item.id}`} className="cab-row">
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
                              className="cab-icon cab-icon-ok"
                              aria-label={`Aprobar el mensaje de ${item.user}`}
                              onClick={() => postBus({ type: 'CONTROL', action: 'approve', id: item.id })}
                            >
                              <Check className="h-4 w-4" aria-hidden="true" />
                            </button>
                          )}
                          <button type="button" className="cab-icon" aria-label={`Quitar el mensaje de ${item.user}`} onClick={() => postBus({ type: 'CONTROL', action: 'remove', id: item.id })}>
                            <X className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="cab-icon"
                            aria-label={`Silenciar a ${item.user} durante ${DEFAULT_TIMEOUT_MINUTES} minutos`}
                            onClick={() => postBus({ type: 'CONTROL', action: 'timeout', user: item.username, minutes: DEFAULT_TIMEOUT_MINUTES })}
                          >
                            <Clock className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button type="button" className="cab-icon" aria-label={`Bloquear a ${item.user}`} onClick={() => blockUser(item.username)}>
                            <Ban className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="cab-hint">La cola está vacía.</span>
                )}
              </div>

              {!online && (
                <p className="cab-note">
                  Estos botones controlan un widget abierto en este mismo navegador: usa «Abrir widget» en Ajustes y deja esa pestaña abierta. El widget
                  que corre dentro de OBS es otro navegador; allí tú y tus mods controláis lo mismo desde el chat con los comandos de la sección En OBS.
                </p>
              )}
            </section>

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
                            <b className="text-[color:var(--cb-fg)]">{user}</b> · {count} {count === 1 ? 'mensaje' : 'mensajes'}
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
                            <button type="button" aria-label={`Quitar el silencio a ${item.user}`} onClick={() => postBus({ type: 'CONTROL', action: 'unblock', user: item.user })}>
                              <X className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="cab-hint">Nadie. El reloj de cada mensaje silencia a su autor {DEFAULT_TIMEOUT_MINUTES} minutos.</span>
                    )}
                  </div>
                </>
              ) : (
                <span className="cab-hint">Los contadores de la sesión aparecen cuando hay un widget abierto en este navegador. Se reinician al recargarlo.</span>
              )}
            </section>

            <section className="cab-mod" data-tour="registro">
              <h2>Registro</h2>
              {log.length ? (
                <ul className="cab-rows">
                  {log.map((item) => (
                    <li key={`${item.id}-${item.at}`} data-row={`l-${item.id}-${item.at}`} className="cab-row">
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
                          className="cab-icon"
                          aria-label={`Volver a leer el mensaje de ${item.user}`}
                          onClick={() => postBus({ type: 'ENQUEUE', text: item.text, user: item.user })}
                        >
                          <RotateCcw className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                            type="button"
                            className="cab-icon"
                            aria-label={`Silenciar a ${item.user} durante ${DEFAULT_TIMEOUT_MINUTES} minutos`}
                            onClick={() => postBus({ type: 'CONTROL', action: 'timeout', user: item.username, minutes: DEFAULT_TIMEOUT_MINUTES })}
                          >
                            <Clock className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button type="button" className="cab-icon" aria-label={`Bloquear a ${item.user}`} onClick={() => blockUser(item.username)}>
                          <Ban className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="cab-hint">
                  Aquí quedan los últimos mensajes leídos, saltados y descartados, con el motivo. Se vacía al recargar el widget.
                </span>
              )}
            </section>
          </div>

          {/* Columna derecha: reglas, disparadores y OBS */}
          <div className="grid gap-5">
            <section className="cab-mod" data-tour="reglas">
              <h2>Reglas</h2>
              <Field label="Quién puede usar !s" hint="Tú y tus mods siempre podéis. Los canjes de puntos y los bits no dependen de este filtro.">
                <div className="cab-seg" role="group" aria-label="Quién puede usar el comando">
                  {MIN_ROLES.map((role) => (
                    <button key={role.id} type="button" aria-pressed={settings.minRole === role.id} onClick={() => update({ minRole: role.id })}>
                      {role.name}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Espera por usuario" htmlFor="cooldown" hint="Tiempo mínimo entre dos mensajes del mismo espectador.">
                <div className="cab-range">
                  <input
                    id="cooldown"
                    type="range"
                    min={LIMITS.cooldown.min}
                    max={300}
                    step={5}
                    value={Math.min(300, settings.cooldownSec)}
                    onChange={(e) => update({ cooldownSec: parseInt(e.target.value, 10) })}
                  />
                  <output htmlFor="cooldown">{settings.cooldownSec ? `${settings.cooldownSec} s` : 'Sin'}</output>
                </div>
              </Field>

              <div className="grid gap-x-8 gap-y-[18px] sm:grid-cols-2">
                <Field label="Longitud máxima" htmlFor="maxLength">
                  <div className="cab-range">
                    <input
                      id="maxLength"
                      type="range"
                      min={50}
                      max={LIMITS.length.max}
                      step={50}
                      value={Math.max(50, settings.maxLength)}
                      onChange={(e) => update({ maxLength: parseInt(e.target.value, 10) })}
                    />
                    <output htmlFor="maxLength">{settings.maxLength}</output>
                  </div>
                </Field>
                <Field label="Cola máxima" htmlFor="maxQueue">
                  <div className="cab-range">
                    <input
                      id="maxQueue"
                      type="range"
                      min={LIMITS.queue.min}
                      max={LIMITS.queue.max}
                      step={1}
                      value={settings.maxQueueSize}
                      onChange={(e) => update({ maxQueueSize: parseInt(e.target.value, 10) })}
                    />
                    <output htmlFor="maxQueue">{settings.maxQueueSize}</output>
                  </div>
                </Field>
              </div>

              <Field label="Prioridad a puntos y bits" htmlFor="priorityPaid" hint="Los mensajes de canjes y cheers pasan delante de los del comando !s.">
                <input
                  id="priorityPaid"
                  type="checkbox"
                  className="cab-tog"
                  checked={settings.priorityPaid}
                  onChange={(e) => update({ priorityPaid: e.target.checked })}
                />
              </Field>

              <Field
                label="Palabras bloqueadas"
                htmlFor="blockedWords"
                hint="Separadas por comas. Un mensaje que contenga alguna se descarta entero. No distingue mayúsculas ni tildes."
              >
                <textarea
                  id="blockedWords"
                  rows={2}
                  value={wordsDraft}
                  onChange={(e) => {
                    setWordsDraft(e.target.value);
                    update({ blockedWords: parseWordList(e.target.value) });
                  }}
                  spellCheck={false}
                  className="cab-inp"
                />
              </Field>

              <Field label="Usuarios bloqueados" htmlFor="blockedUser">
                <div className="flex gap-2">
                  <input
                    id="blockedUser"
                    type="text"
                    value={userDraft}
                    onChange={(e) => setUserDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addUserDraft();
                    }}
                    placeholder="nombre_de_usuario"
                    autoComplete="off"
                    spellCheck={false}
                    className="cab-inp cab-mono"
                  />
                  <button type="button" className="cab-btn2" onClick={addUserDraft} disabled={!normalizeUser(userDraft)}>
                    Bloquear
                  </button>
                </div>
                {settings.blockedUsers.length ? (
                  <ul className="flex flex-wrap gap-2">
                    {settings.blockedUsers.map((user) => (
                      <li key={user} className="cab-chip cab-chip-lg">
                        <span className="cab-mono">{user}</span>
                        <button type="button" aria-label={`Desbloquear a ${user}`} onClick={() => unblockUser(user)}>
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="cab-hint">Nadie bloqueado.</span>
                )}
              </Field>
            </section>

            <section className="cab-mod" data-tour="disparadores">
              <h2>Disparadores</h2>
              <Field label="Comando !s" htmlFor="commandEnabled" hint="Cualquier mensaje que empiece con !s se lee, según las reglas de arriba.">
                <input
                  id="commandEnabled"
                  type="checkbox"
                  className="cab-tog"
                  checked={settings.commandEnabled}
                  onChange={(e) => update({ commandEnabled: e.target.checked })}
                />
              </Field>

              <Field
                label="Puntos del canal"
                hint={
                  detecting
                    ? 'Escuchando el chat. Canjea ahora la recompensa con cualquier texto.'
                    : settings.rewardId
                      ? 'Recompensa enlazada. El texto que escriba quien la canjee se lee en voz alta.'
                      : 'Crea en Twitch una recompensa que pida texto al espectador. Pulsa Detectar y canjéala una vez para enlazarla.'
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  {settings.rewardId ? (
                    <>
                      <code className="cab-url cab-mono">{settings.rewardId}</code>
                      <button type="button" className="cab-btn2" onClick={() => update({ rewardId: '' })}>
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                        Quitar
                      </button>
                    </>
                  ) : detecting ? (
                    <button type="button" className="cab-btn2" onClick={() => stopDetectRef.current?.()}>
                      <Radar className="h-4 w-4 animate-spin" aria-hidden="true" />
                      Cancelar
                    </button>
                  ) : (
                    <button type="button" className="cab-btn2" onClick={startDetect} disabled={!settings.channel.trim()}>
                      <Radar className="h-4 w-4" aria-hidden="true" />
                      Detectar recompensa
                    </button>
                  )}
                </div>
              </Field>

              <Field label="Bits mínimos" htmlFor="minBits" hint="Un cheer con al menos estos bits lee su mensaje. Con 0 queda desactivado.">
                <input
                  id="minBits"
                  type="number"
                  inputMode="numeric"
                  min={LIMITS.bits.min}
                  max={LIMITS.bits.max}
                  step={50}
                  value={settings.minBits}
                  onChange={(e) => update({ minBits: Math.max(0, Math.min(LIMITS.bits.max, parseInt(e.target.value, 10) || 0)) })}
                  className="cab-inp cab-mono"
                  style={{ maxWidth: 160 }}
                />
              </Field>
            </section>

            <section className="cab-mod" data-tour="obs">
              <h2>En OBS</h2>
              <p className="cab-hint">
                Las reglas y los disparadores viajan en la URL del widget. Cuando los cambies, copia la URL de nuevo y pégala en la fuente de OBS.
              </p>
              <div>
                <button type="button" className="cab-btn" onClick={copyWidgetUrl}>
                  {copiedUrl ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                  {copiedUrl ? 'URL copiada' : 'Copiar URL para OBS'}
                </button>
              </div>
              <div className="cab-field">
                <span className="cab-label">Comandos de chat para ti y tus mods</span>
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
                    <code className="cab-mono">!s block usuario</code> y <code className="cab-mono">!s unblock usuario</code> bloquean al instante, sin tocar la
                    URL
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
                    <code className="cab-mono">!s reload</code> recarga el overlay
                  </li>
                </ul>
              </div>
            </section>
          </div>
        </div>
      </div>
      {tourOpen && <GuidedTour id={TOUR_ID} steps={TOUR_STEPS} onClose={() => setTourOpen(false)} />}
    </div>
  );
};
