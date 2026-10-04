/**
 * src/pages/PowerupsStudio.tsx
 *
 * Página «Power-ups» sobre la plantilla común del panel: a la izquierda se
 * ajusta, a la derecha el monitor 16:9 queda siempre a la vista.
 *
 * - Permiso: comprueba si la conexión con Twitch tiene los permisos de lectura
 *   de Bits y de canjes. Twitch solo deja verlo un rato después de entrar; si ya
 *   no se puede, se ofrece volver a autorizar.
 * - Canal de eventos: enciende, consulta y apaga las suscripciones de Twitch del
 *   propio canal (las crea el servidor de Lalo).
 * - Lista: los Power-ups personalizados leídos de Twitch (se guardan para poder
 *   editar más tarde) y los tres de serie. A cada uno se le asigna una acción.
 * - Pruebas: cada botón envía un evento de ejemplo por el mismo camino que uno
 *   real (a las fuentes de este navegador y, con cuenta, a las de OBS) y lo
 *   enseña en el monitor.
 */

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { SuiteNav } from '../components/SuiteNav';
import { Field, Toggle } from '../components/studio/StudioKit';
import { RewardsLayer, RewardsLayerHandle } from '../components/recompensas/RewardsLayer';
import { usePowerupsSettings } from '../hooks/usePowerupsSettings';
import { useRewardsSettings } from '../hooks/useRewardsSettings';
import { useCloudSession } from '../hooks/useCloudSession';
import { signInWithTwitch } from '../lib/cloud';
import { hasTwitchIdentity } from '../lib/access';
import { SubscriptionRow, callSubscriptions, fetchCustomPowerups, pushTestEvent, validateTwitchToken } from '../lib/twitchEventsApi';
import {
  BUILTIN_POWERUPS,
  DEFAULT_TEMPLATES,
  POWERUP_ACTIONS,
  POWERUP_LIMITS,
  PowerupAction,
  normalizePowerupsSettings,
  ruleFor,
} from '../types/powerups';
import { loadSettings } from '../types/settings';
import { postBus } from '../utils/bus';
import {
  EVENT_SCOPES,
  SUBSCRIPTION_NAMES,
  missingScopes,
  parseTwitchEvent,
  planActions,
  scopeState,
  subscriptionStatusText,
} from '../utils/twitchEvents';
import '../styles/recompensas.css';
import '../styles/powerups.css';

interface ListItem {
  id: string;
  title: string;
  bits: number | null;
  builtin: boolean;
  prompt: string;
  inputRequired: boolean;
  paused: boolean;
  off: boolean;
}

type SubsState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; rows: SubscriptionRow[] }
  | { kind: 'error'; message: string; missing: string[] };

type ListState = 'idle' | 'loading' | 'ready' | 'expired' | 'not_monetized' | 'error';

const SAMPLE_USERS = ['pau_rl', 'mar_ia', 'dani_gg', 'caro_tv'];
const SAMPLE_TEXT = 'pon algo de los ochenta';
const PLATE_SECONDS = 5;

const formatWhen = (at: number | null): string =>
  at ? new Date(at).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

export const PowerupsStudio: React.FC = () => {
  const { settings, saved, updateSettings, updateRule } = usePowerupsSettings();
  const { rewardsSettings } = useRewardsSettings();
  const cloud = useCloudSession();
  const uid = useId();

  const [voice] = useState(loadSettings);
  const clean = useMemo(() => normalizePowerupsSettings(settings), [settings]);

  const account = cloud.enabled && cloud.profile?.status === 'active' ? cloud.profile : null;
  const withTwitch = Boolean(account && cloud.session && hasTwitchIdentity(cloud.session.user));
  const twitchToken = cloud.session?.provider_token ?? null;

  const [status, setStatus] = useState<string | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((message: string) => {
    setStatus(message);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(null), 9000);
  }, []);

  // ---------- Permiso y lista de Power-ups ----------
  const [tokenChecked, setTokenChecked] = useState(false);
  const [tokenAlive, setTokenAlive] = useState(false);
  const [wrongApp, setWrongApp] = useState(false);
  const [listState, setListState] = useState<ListState>('idle');
  const [authBusy, setAuthBusy] = useState(false);

  const readFromTwitch = useCallback(async () => {
    if (!twitchToken) {
      setTokenChecked(true);
      setTokenAlive(false);
      return;
    }
    setListState('loading');
    const info = await validateTwitchToken(twitchToken);
    setTokenChecked(true);
    setTokenAlive(info !== null);
    if (!info) {
      setListState('expired');
      return;
    }
    const expected = (import.meta.env.VITE_TWITCH_CLIENT_ID ?? '').trim();
    setWrongApp(expected !== '' && expected !== info.clientId);
    updateSettings({ scopes: info.scopes });
    if (!info.scopes.includes('bits:read')) {
      setListState('idle');
      return;
    }
    const result = await fetchCustomPowerups(twitchToken, info);
    if (result.ok) {
      updateSettings({ cached: result.list, cachedAt: Date.now() });
      setListState('ready');
    } else {
      setListState(result.reason);
    }
  }, [twitchToken, updateSettings]);

  useEffect(() => {
    if (withTwitch) readFromTwitch();
  }, [withTwitch, readFromTwitch]);

  const authorize = async () => {
    setAuthBusy(true);
    try {
      await signInWithTwitch();
    } catch (err) {
      setAuthBusy(false);
      say(err instanceof Error ? `No se pudo abrir Twitch: ${err.message}` : 'No se pudo abrir Twitch.');
    }
  };

  const permission = scopeState(clean.scopes);
  const missing = missingScopes(clean.scopes) ?? [];
  // Sin token vivo, lo que se sabe de los permisos es de la última vez que se pudo mirar
  const permissionIsOld = withTwitch && tokenChecked && !tokenAlive;

  // ---------- Canal de eventos ----------
  const [subs, setSubs] = useState<SubsState>({ kind: 'idle' });
  const [subsBusy, setSubsBusy] = useState(false);

  const runSubscriptions = useCallback(
    async (action?: 'create' | 'delete') => {
      setSubsBusy(true);
      if (!action) setSubs({ kind: 'loading' });
      const result = await callSubscriptions(action);
      setSubsBusy(false);
      if (!result.ok) {
        setSubs({ kind: 'error', message: result.message, missing: result.missing });
        return;
      }
      setSubs({ kind: 'ready', rows: result.subscriptions });
      const alive = result.subscriptions.some((row) => subscriptionStatusText(row.status).good);
      updateSettings({ channelActive: alive });
      if (action === 'create') {
        const denied = result.results.filter((row) => row.outcome === 'no_permission');
        say(
          denied.length > 0
            ? 'Twitch no dejó encender alguna parte: falta el permiso. Pulsa «Volver a autorizar» y enciéndelo otra vez.'
            : 'Hecho. Twitch tarda unos segundos en comprobar la conexión: pulsa «Volver a consultar».'
        );
      }
      if (action === 'delete') say('Canal de eventos apagado. Lalo ya no recibe avisos de Twitch de tu canal.');
    },
    [say, updateSettings]
  );

  useEffect(() => {
    if (withTwitch) runSubscriptions();
  }, [withTwitch, runSubscriptions]);

  // ---------- Lista ----------
  const items: ListItem[] = useMemo(
    () => [
      ...clean.cached.map((item) => ({
        id: item.id,
        title: item.title,
        bits: item.bits,
        builtin: false,
        prompt: item.prompt,
        inputRequired: item.inputRequired,
        paused: item.paused,
        off: !item.enabled,
      })),
      ...BUILTIN_POWERUPS.map((item) => ({
        id: item.id,
        title: item.name,
        bits: null,
        builtin: true,
        prompt: '',
        inputRequired: false,
        paused: false,
        off: false,
      })),
    ],
    [clean.cached]
  );

  const rewards = rewardsSettings.rewards.filter((reward) => reward.enabled);
  const videoRewards = rewards.filter((reward) => Boolean(reward.videoUrl));

  // ---------- Pruebas y monitor ----------
  const layerRef = useRef<RewardsLayerHandle | null>(null);
  const [plate, setPlate] = useState<{ id: number; tag: string; text: string } | null>(null);
  const plateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const testCount = useRef(0);

  useEffect(
    () => () => {
      if (statusTimer.current) clearTimeout(statusTimer.current);
      if (plateTimer.current) clearTimeout(plateTimer.current);
    },
    []
  );

  /** Envía un evento de ejemplo por el camino real y enseña en el monitor lo que haría. */
  const sendTest = async (kind: 'bits' | 'powerup' | 'points', payload: Record<string, unknown>, what: string, idle = 'Lalo no hace nada con este') => {
    const event = parseTwitchEvent(kind, payload, true);
    if (!event) return;
    const actions = planActions(event, clean);
    const notes: string[] = [];
    actions.forEach((action) => {
      if (action.do === 'reward') {
        const result = layerRef.current?.trigger(action.input);
        notes.push(
          result?.ok
            ? 'lanza la recompensa elegida'
            : result?.reason === 'no_match'
              ? 'la recompensa elegida ya no existe o está apagada'
              : 'la recompensa no pudo salir en el monitor'
        );
      }
      if (action.do === 'plate') {
        testCount.current += 1;
        setPlate({ id: testCount.current, tag: action.tag, text: action.text });
        if (plateTimer.current) clearTimeout(plateTimer.current);
        plateTimer.current = setTimeout(() => setPlate(null), PLATE_SECONDS * 1000);
        notes.push('sale el aviso');
      }
      if (action.do === 'voice') notes.push(`la voz diría: «${action.text}»`);
    });

    // Mismo camino que un evento real: el bus para las fuentes de este navegador y la nube para OBS
    postBus({ type: 'TWITCH_EVENT', kind, payload });
    let delivery = 'Enviado a las fuentes abiertas en este navegador.';
    if (account) {
      const problem = await pushTestEvent(kind, payload);
      delivery = problem
        ? `No llegó a OBS: ${problem}`
        : `Enviado también a tus fuentes de OBS${clean.channelActive ? '' : ' (con el canal de eventos apagado tarda hasta 20 segundos)'}.`;
    }
    say(`${what}: ${notes.length > 0 ? notes.join('; ') : idle}. ${delivery}`);
  };

  const sampleUser = () => {
    testCount.current += 1;
    return SAMPLE_USERS[testCount.current % SAMPLE_USERS.length];
  };

  const testItem = (item: ListItem) => {
    const user = sampleUser();
    const bits = item.bits ?? 30;
    const text = item.inputRequired || item.builtin ? SAMPLE_TEXT : '';
    if (item.builtin) {
      return sendTest(
        'bits',
        { type: 'power_up', bits, user, login: user, text, powerUp: { type: item.id, emoteId: '', emoteName: '', effectId: '' }, test: true },
        `${user} usó «${item.title}»`
      );
    }
    return sendTest('powerup', { id: item.id, title: item.title, bits, user, login: user, text, test: true }, `${user} usó «${item.title}» (${bits} bits)`);
  };

  const testPoints = () => {
    const linked = rewards.find((reward) => reward.trigger === 'points' && reward.twitchRewardId);
    if (!linked) {
      say('Ninguna recompensa de puntos está enlazada con Twitch todavía. Enlázala en «Recompensas» con «Detectar».');
      return;
    }
    const user = sampleUser();
    sendTest(
      'points',
      { rewardId: linked.twitchRewardId, title: linked.name, cost: linked.cost, user, login: user, text: '', test: true },
      `${user} canjeó «${linked.name}» sin escribir texto`
    );
  };

  const testCheer = () => {
    const user = sampleUser();
    sendTest(
      'bits',
      { type: 'cheer', bits: 100, user, login: user, text: 'cheer100 vamos', test: true },
      `${user} animó con 100 bits`,
      'en directo suma a tus metas de bits; las recompensas por bits las lanza el chat'
    );
  };

  const subsRows = subs.kind === 'ready' ? subs.rows : [];
  const channelOn = subsRows.some((row) => subscriptionStatusText(row.status).good);

  return (
    <div className="cab">
      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-6">
        <SuiteNav currentApp="powerups" channel={voice.channel} saved={saved} />

        <div className="grid items-start gap-5 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="grid gap-5">
            {/* ---------- Permiso ---------- */}
            <section className="cab-mod">
              <h2>Permiso de Twitch</h2>
              {!cloud.enabled ? (
                <p className="cab-note">
                  Los Power-ups necesitan una cuenta de Lalo conectada con Twitch, y este despliegue no tiene la nube
                  encendida. Puedes preparar las acciones y probarlas en el monitor; en directo no llegará nada.
                </p>
              ) : !withTwitch ? (
                <p className="cab-note">Esta cuenta no está conectada a un canal de Twitch.</p>
              ) : (
                <>
                  <div className="pu-perm">
                    <div className="grid gap-2">
                      <p className="pu-line">
                        <b>Twitch conectado como {account?.twitch_login || account?.display_name || 'tu canal'}</b>
                        {permission === 'ok' && (
                          <span className="cab-chip" data-status="read">
                            Permisos concedidos
                          </span>
                        )}
                        {permission === 'missing' && (
                          <span className="cab-chip" data-status="skipped">
                            Falta permiso
                          </span>
                        )}
                        {permission === 'unknown' && <span className="cab-chip">Sin comprobar</span>}
                      </p>
                      <ul className="pu-bullets">
                        <li>Lalo necesita leer los Bits para saber cuándo alguien usa un Power-up y cuál.</li>
                        <li>Solo lee: no puede gastar Bits, ni crear o cambiar tus Power-ups.</li>
                        {permission === 'missing' && (
                          <li>
                            Falta:{' '}
                            {EVENT_SCOPES.filter((item) => missing.includes(item.scope))
                              .map((item) => item.what)
                              .join(' y ')}
                            . Conectaste tu cuenta antes de que Lalo lo pidiera.
                          </li>
                        )}
                      </ul>
                    </div>
                    <button type="button" className={permission === 'ok' ? 'cab-btn2' : 'cab-btn'} disabled={authBusy} onClick={authorize}>
                      {authBusy ? 'Abriendo Twitch' : permission === 'ok' ? 'Reconectar Twitch' : 'Volver a autorizar'}
                    </button>
                  </div>
                  {permissionIsOld && (
                    <p className="cab-hint">
                      {permission === 'unknown'
                        ? 'Ahora no se puede comprobar: Twitch solo deja ver los permisos un rato después de entrar. Pulsa el botón para entrar otra vez con Twitch; al volver, abre de nuevo esta página.'
                        : 'Es lo que había la última vez que se pudo comprobar. Para mirarlo ahora o leer de nuevo tus Power-ups, reconecta Twitch; al volver, abre de nuevo esta página.'}
                    </p>
                  )}
                  {wrongApp && (
                    <p className="cab-error" role="alert">
                      La entrada con Twitch usa una aplicación de Twitch distinta de la del servidor de Lalo. Así el
                      canal de eventos no puede funcionar. Quien administra Lalo debe poner el mismo Client ID en los dos
                      sitios.
                    </p>
                  )}
                </>
              )}
            </section>

            {/* ---------- Canal de eventos ---------- */}
            <section className="cab-mod">
              <h2>Canal de eventos</h2>
              <p className="cab-hint">
                Twitch no avisa de los Power-ups por el chat. Con el canal encendido, Twitch avisa al servidor de Lalo y
                de ahí llega a tus fuentes de OBS en pocos segundos.
              </p>
              {!withTwitch ? (
                <p className="cab-note">Disponible con una cuenta de Lalo conectada con Twitch.</p>
              ) : (
                <>
                  {subs.kind === 'loading' && <p className="cab-hint">Consultando a Twitch.</p>}
                  {subs.kind === 'error' && (
                    <p className="cab-note" role="status">
                      {subs.message}
                      {subs.missing.length > 0 && ` Falta en el servidor: ${subs.missing.join(', ')}.`}
                    </p>
                  )}
                  {subs.kind === 'ready' && (
                    <ul className="cab-rows">
                      {subs.rows.map((row) => {
                        const state = subscriptionStatusText(row.status);
                        return (
                          <li key={row.type} className="cab-row">
                            <div className="min-w-0">
                              <p className="pu-name">{SUBSCRIPTION_NAMES[row.type] || row.type}</p>
                              <p className="cab-hint">{state.text}</p>
                            </div>
                            <span className="cab-chip" data-status={state.good ? 'read' : row.status === 'missing' ? undefined : 'rejected'}>
                              {state.good ? 'Encendida' : row.status === 'missing' ? 'Apagada' : 'Con problema'}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="cab-btn" disabled={subsBusy} onClick={() => runSubscriptions('create')}>
                      {channelOn ? 'Reparar lo que falte' : 'Encender'}
                    </button>
                    <button type="button" className="cab-btn2" disabled={subsBusy} onClick={() => runSubscriptions()}>
                      Volver a consultar
                    </button>
                    {channelOn && (
                      <button type="button" className="cab-btn2" disabled={subsBusy} onClick={() => runSubscriptions('delete')}>
                        Apagar
                      </button>
                    )}
                  </div>
                </>
              )}
              <div className="cab-field">
                <Toggle
                  label="Lanzar también los canjes de puntos que no piden texto"
                  checked={settings.pointsViaChannel}
                  onChange={(pointsViaChannel) => updateSettings({ pointsViaChannel })}
                />
                <span className="cab-hint">
                  Los canjes con texto ya llegan por el chat. Los que no lo piden solo llegan por este canal, y lanzan
                  la recompensa que tengas enlazada en «Recompensas».
                </span>
              </div>
              <p className="cab-hint">
                Los Bits que lleguen por aquí suman a tus metas de bits. Se apaga meta a meta en{' '}
                <a className="studio-link" href="#metas">
                  Metas
                </a>
                .
              </p>
            </section>

            {/* ---------- Lista ---------- */}
            <section className="cab-mod">
              <h2>Tus Power-ups y lo que lanzan</h2>
              <div className="cab-field">
                <Toggle
                  label="Reaccionar a los Power-ups"
                  checked={settings.enabled}
                  onChange={(enabled) => updateSettings({ enabled })}
                />
                <span className="cab-hint">Apagado, Lalo no hace nada con ningún Power-up. Las pruebas de esta página siguen funcionando.</span>
              </div>

              {clean.cached.length === 0 && (
                <p className="cab-note" role="status">
                  {listState === 'loading'
                    ? 'Leyendo tus Power-ups de Twitch.'
                    : listState === 'not_monetized'
                      ? 'Twitch dice que este canal no es afiliado ni partner, así que no tiene Power-ups.'
                      : listState === 'ready'
                        ? 'Tu canal no tiene Power-ups personalizados. Twitch los empezó a dar por invitación a pocos canales, con intención de abrirlos a todos los monetizados: puede que aún no los tengas. Mira en tu panel de Twitch si ya puedes crear uno. Mientras tanto, aquí están los tres de serie.'
                        : 'Aún no se ha podido leer la lista de tus Power-ups personalizados. Hace falta el permiso de Bits y haber entrado con Twitch hace poco. Mientras tanto, aquí están los tres de serie.'}
                </p>
              )}

              <ul className="pu-list">
                {items.map((item) => {
                  const rule = ruleFor(settings, item.id);
                  const picks = rule.action === 'video' ? videoRewards : rewards;
                  const needsReward = rule.action === 'sound' || rule.action === 'video';
                  const needsText = rule.action === 'plate' || rule.action === 'voice';
                  return (
                    <li key={item.id}>
                      <div className="pu-top">
                        <span className="pu-line">
                          <b>{item.title}</b>
                          <span className="cab-chip">{item.builtin ? 'De serie' : 'Personalizado'}</span>
                          {item.inputRequired && <span className="cab-chip">Pide texto</span>}
                          {item.paused && (
                            <span className="cab-chip" data-status="skipped">
                              En pausa en Twitch
                            </span>
                          )}
                          {item.off && (
                            <span className="cab-chip" data-status="skipped">
                              Apagado en Twitch
                            </span>
                          )}
                        </span>
                        {item.bits !== null && <span className="cab-mono pu-bits">{item.bits} bits</span>}
                      </div>
                      <div className="pu-set">
                        <select
                          className="cab-inp"
                          aria-label={`Acción para ${item.title}`}
                          value={rule.action}
                          onChange={(e) => updateRule(item.id, { action: e.target.value as PowerupAction })}
                        >
                          {POWERUP_ACTIONS.map((action) => (
                            <option key={action.id} value={action.id}>
                              {action.name}
                            </option>
                          ))}
                        </select>
                        {needsReward && (
                          <select
                            className="cab-inp"
                            aria-label={`Recompensa de Lalo para ${item.title}`}
                            value={picks.some((reward) => reward.id === rule.rewardId) ? rule.rewardId : ''}
                            onChange={(e) => updateRule(item.id, { rewardId: e.target.value })}
                          >
                            <option value="">Elige una recompensa</option>
                            {picks.map((reward) => (
                              <option key={reward.id} value={reward.id}>
                                {reward.name}
                              </option>
                            ))}
                          </select>
                        )}
                        {needsText && (
                          <input
                            type="text"
                            className="cab-inp"
                            aria-label={`Texto para ${item.title}`}
                            maxLength={POWERUP_LIMITS.template}
                            placeholder={DEFAULT_TEMPLATES[rule.action as 'plate' | 'voice']}
                            value={rule.template}
                            onChange={(e) => updateRule(item.id, { template: e.target.value })}
                          />
                        )}
                        <button type="button" className="cab-btn2 cab-btn-sm" onClick={() => testItem(item)}>
                          Probar
                        </button>
                      </div>
                      <p className="cab-hint">
                        {needsReward &&
                          (picks.length === 0
                            ? rule.action === 'video'
                              ? 'Ninguna recompensa tiene vídeo todavía. Súbelo en «Recompensas» y vuelve aquí.'
                              : 'No tienes recompensas encendidas. Créalas en «Recompensas» y vuelve aquí.'
                            : 'El sonido, el vídeo y la placa son los de esa recompensa, con sus esperas y su cola. ')}
                        {needsText && 'Puedes escribir {user}, {powerup}, {bits} y {message}. '}
                        {item.builtin
                          ? 'Twitch ya hace su propio efecto. Lo de Lalo va encima.'
                          : `${item.prompt ? `Descripción en Twitch: «${item.prompt}». ` : ''}${
                              item.inputRequired ? 'El texto que escriba el espectador llega a Lalo: sale en {message} y la voz puede leerlo. ' : ''
                            }${item.paused ? 'Mientras esté en pausa nadie puede canjearlo.' : ''}`}
                      </p>
                    </li>
                  );
                })}
              </ul>

              <div className="pu-reload">
                <span className="cab-hint">
                  Para añadir, quitar o cambiar el precio de un Power-up hay que hacerlo en Twitch.
                  {clean.cachedAt ? ` Lista leída el ${formatWhen(clean.cachedAt)}.` : ''}
                </span>
                <button
                  type="button"
                  className="cab-btn2 cab-btn-sm"
                  disabled={!withTwitch || listState === 'loading'}
                  onClick={() => {
                    if (twitchToken && tokenAlive) readFromTwitch();
                    else say('Para leer la lista hay que entrar otra vez con Twitch: pulsa «Reconectar Twitch» arriba.');
                  }}
                >
                  Volver a leer de Twitch
                </button>
              </div>
            </section>

            {/* ---------- Límites ---------- */}
            <section className="cab-mod">
              <h2>Lo que no se puede hacer</h2>
              <ul className="pu-bullets">
                <li>Crear, borrar o cambiar el precio de un Power-up desde Lalo. Twitch aún no lo permite: se hace en el panel de Twitch.</li>
                <li>
                  Devolver los Bits o marcar un canje como cumplido o cancelado. Por eso la espera y los límites por
                  directo conviene ponerlos en Twitch, que impide el canje antes de cobrar.
                </li>
                <li>Sustituir el efecto propio de Twitch por otro.</li>
              </ul>
            </section>
          </div>

          {/* ---------- Monitor ---------- */}
          <section className="cab-mod max-[1099px]:order-first min-[1100px]:sticky min-[1100px]:top-4">
            <h2>Monitor</h2>
            <div className="cab-stage rw-stage">
              <RewardsLayer ref={layerRef} settings={rewardsSettings} isStudio />
              {plate && (
                <div className="ovl pu-plate" data-studio="">
                  <div key={plate.id} className="ovl-plate nt" style={{ '--c': '#b68cff', '--c-ink': '#1b1c1f' } as React.CSSProperties}>
                    <span className="nt-tag ovl-caps">{plate.tag}</span>
                    <span className="nt-text">{plate.text}</span>
                  </div>
                </div>
              )}
            </div>

            <Field
              label="Otros avisos que llegan por el canal"
              htmlFor={`${uid}-cheer`}
              hint="Son eventos de ejemplo. Recorren el mismo camino que uno real, pero no suman a las metas."
            >
              <div className="flex flex-wrap gap-2">
                <button id={`${uid}-cheer`} type="button" className="cab-btn2 cab-btn-sm" onClick={testCheer}>
                  Alguien anima con 100 bits
                </button>
                <button type="button" className="cab-btn2 cab-btn-sm" onClick={testPoints}>
                  Canje de puntos sin texto
                </button>
              </div>
            </Field>

            <p className="cab-hint" role="status">
              {status || 'Pulsa «Probar» en un Power-up. Lo que haría Lalo sale aquí y, si tienes fuentes abiertas, también en ellas.'}
            </p>
            <p className="cab-note">
              Lo que hace cada Power-up sale en la fuente «Recompensas» o en «Todo en uno». La voz habla en «Voz del
              chat» o en «Todo en uno».
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};
