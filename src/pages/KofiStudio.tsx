/**
 * src/pages/KofiStudio.tsx
 *
 * Estudio de Ko-fi sobre la plantilla común del panel: a la izquierda se
 * ajusta, a la derecha el monitor 16:9 queda siempre a la vista. El monitor
 * tiene dos vistas, porque en OBS son fuentes distintas: las alertas, y las
 * capas fijas (meta y últimos apoyos).
 *
 * Cada aviso de prueba recorre las mismas reglas que uno real, se ve en el
 * monitor con la capa real y llega a las fuentes abiertas en este navegador y,
 * con cuenta, a las de OBS. Las pruebas nunca suman a la meta guardada.
 */

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { KOFI_KINDS, KOFI_KIND_NAMES, KOFI_SOUNDS, kofiMoney, type KofiEventRule, type KofiKind } from '../../server/integrations/kofiRules';
import { SuiteNav } from '../components/SuiteNav';
import { KofiEventFields } from '../components/integraciones/KofiEventFields';
import { KofiStage, type KofiStageHandle } from '../components/integraciones/KofiStage';
import { Field, Range, Toggle } from '../components/studio/StudioKit';
import { useCloudSession } from '../hooks/useCloudSession';
import { useKofiSettings } from '../hooks/useIntegrationSettings';
import { kofiAction, kofiStatus } from '../lib/integrationsApi';
import { pushTestEvent } from '../lib/twitchEventsApi';
import { KOFI_DESIGNS, KOFI_LIMITS, encodeKofiSettings, normalizeKofiSettings, type KofiSettings } from '../types/kofi';
import { SIX_POSITIONS } from '../types/music';
import { loadSettings } from '../types/settings';
import { postBus } from '../utils/bus';
import { KOFI_DEMO_RAISED, KOFI_DEMO_RECENT, KofiSampleId, kofiSamplePayload } from '../utils/kofiSamples';
import { buildSuiteWidgetUrl, type WidgetAppType } from '../utils/widgetUrl';
import '../styles/integraciones.css';
import '../styles/recompensas.css';

const TESTS: { id: KofiSampleId; label: string }[] = [
  { id: 'd3', label: 'Donación de 3' },
  { id: 'd25', label: 'Donación de 25 (grande)' },
  { id: 'long', label: 'Mensaje largo' },
  { id: 'priv', label: 'Donación privada' },
  { id: 'bad', label: 'Mensaje con palabra bloqueada' },
  { id: 'mem', label: 'Nueva membresía' },
  { id: 'ren', label: 'Renovación' },
  { id: 'shop', label: 'Pedido de tienda' },
  { id: 'com', label: 'Comisión' },
];
const KIND_TABS: Record<KofiKind, string> = { don: 'Donación', mem: 'Nueva membresía', ren: 'Renovación', shop: 'Tienda', com: 'Comisión' };
const SOURCES: { app: WidgetAppType; name: string }[] = [
  { app: 'kofi', name: 'Alertas' },
  { app: 'kofigoal', name: 'Meta' },
  { app: 'kofirecent', name: 'Últimos apoyos' },
];

export const KofiStudio: React.FC = () => {
  const { settings, saved, update } = useKofiSettings();
  const cloud = useCloudSession();
  const uid = useId();
  const [tts] = useState(loadSettings);
  const clean = useMemo(() => normalizeKofiSettings(settings), [settings]);
  const account = cloud.enabled && cloud.profile?.status === 'active' ? cloud.profile : null;

  const stage = useRef<KofiStageHandle | null>(null);
  const [view, setView] = useState<'alertas' | 'fijas'>('alertas');
  const [kind, setKind] = useState<KofiKind>('don');
  const [status, setStatus] = useState('Pulsa una prueba.');
  const [copied, setCopied] = useState<string | null>(null);
  const [connection, setConnection] = useState<string | null>(null);

  // Con cuenta: lo recaudado de verdad. Sin ella, números de ejemplo
  useEffect(() => {
    if (!account) return;
    let alive = true;
    kofiStatus().then((result) => {
      if (!alive) return;
      if (!result.ok) return setConnection(result.message);
      const s = result.data;
      if (!s.configured) return setConnection(`Al servidor de Lalo le falta configuración para Ko-fi (${s.missing.join(', ')}).`);
      stage.current?.setState({ raised: s.raised, recent: s.recent });
      setConnection(
        s.state === 'connected'
          ? 'Ko-fi conectado: los avisos reales llegan a tus fuentes de OBS.'
          : s.state === 'waiting'
            ? 'Ko-fi está a la espera del primer aviso.'
            : 'Ko-fi aún no está conectado: hazlo en Integraciones.'
      );
    });
    return () => {
      alive = false;
    };
  }, [account]);

  // El monitor arranca con un aviso de ejemplo, sin sonido, para ver el diseño guardado
  useEffect(() => {
    const timer = setTimeout(() => stage.current?.event(kofiSamplePayload('d3', 'EUR'), true, true), 120);
    return () => clearTimeout(timer);
  }, []);

  // Al cambiar de diseño o de sitio se repite el último aviso para verlo
  const firstDesign = useRef(true);
  useEffect(() => {
    if (firstDesign.current) {
      firstDesign.current = false;
      return;
    }
    stage.current?.preview();
  }, [clean.design, clean.pos]);

  const fire = async (id: KofiSampleId) => {
    const payload = kofiSamplePayload(id, clean.goal.currency);
    const result = stage.current?.event(payload, true);
    if (!result) return;
    const { event, decision } = result;
    const rule = clean.events[event.kind];
    const name = KOFI_KIND_NAMES[event.kind];
    const amount = `${kofiMoney(event.amount)} ${event.currency}`;
    if (decision.skip === 'tier') return setStatus(`${name}: el nivel «${event.tier}» no es el elegido («${rule.tier}»). No hay alerta.`);
    if (decision.skip === 'min') return setStatus(`${name} de ${amount}: por debajo del mínimo (${kofiMoney(rule.min)}). No hay alerta.`);

    // Mismo camino que un aviso real: el bus para las fuentes de este navegador y la nube para OBS
    postBus({ type: 'TWITCH_EVENT', kind: 'kofi', payload });
    let delivery = '';
    if (account) {
      const problem = await pushTestEvent('kofi', payload);
      delivery = problem ? ` No llegó a OBS: ${problem}` : ' Enviado también a tus fuentes de OBS.';
    }
    const goal = decision.goalAdd > 0 ? 'Suma a la meta (solo en esta pantalla, por ser una prueba).' : rule.meta ? 'No suma: la moneda no es la de la meta.' : 'Este tipo no suma a la meta.';
    if (!decision.alert) return setStatus(`${name}: la alerta está apagada. Se anota en los últimos apoyos, sin alerta. ${goal}${delivery}`);
    const voice = !rule.voz
      ? 'La voz no lee nada.'
      : !event.isPublic
        ? 'Es privado: la voz no lee nada.'
        : event.blockedSample
          ? 'El filtro retuvo el mensaje: ni se ve ni se lee.'
          : decision.voice
            ? 'En OBS, la voz lee el mensaje.'
            : 'No hay mensaje que leer.';
    const sound = KOFI_SOUNDS.find((item) => item.id === rule.snd)?.name ?? 'Ninguno';
    setStatus(
      `${decision.big ? 'Donación grande' : name} de ${amount}, ${event.isPublic ? 'pública' : 'privada (sale como «Alguien», sin mensaje)'}. Sonido: ${sound}. ${voice} En pantalla ${
        Math.round(decision.hold * 10) / 10
      } s. ${goal}${result.queued ? '' : ' La cola está llena: esta se descarta.'}${delivery}`
    );
  };

  const resetGoal = async () => {
    stage.current?.setState({ raised: 0 });
    if (!account) return setStatus('Meta a cero.');
    const result = await kofiAction('reset-goal');
    // Las capas de OBS vuelven a leer lo recaudado
    update({ refreshAt: Date.now() });
    postBus({ type: 'KOFI_REFRESH' });
    setStatus(result.ok ? 'Meta a cero, también en tus fuentes de OBS.' : `Meta a cero solo en esta pantalla: ${result.message}`);
  };

  const copyUrl = async (app: WidgetAppType, demo: boolean) => {
    const extra: Record<string, string> = { kf: encodeKofiSettings(clean) };
    if (account) extra.k = account.widget_key;
    if (demo) extra.demo = '1';
    try {
      await navigator.clipboard.writeText(buildSuiteWidgetUrl(window.location.origin, app, tts.channel, app === 'kofi' ? tts : undefined, extra));
      setCopied(`${app}${demo ? '-demo' : ''}`);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setStatus('No se pudo copiar la URL.');
    }
  };

  const set = <K extends keyof KofiSettings>(key: K, value: KofiSettings[K]) => update({ [key]: value } as Partial<KofiSettings>);
  const setRule = (patch: Partial<KofiEventRule>) => update((prev) => ({ ...prev, events: { ...prev.events, [kind]: { ...prev.events[kind], ...patch } } }));
  const setGoal = (patch: Partial<KofiSettings['goal']>) => update((prev) => ({ ...prev, goal: { ...prev.goal, ...patch } }));
  const design = KOFI_DESIGNS.find((item) => item.id === clean.design) ?? KOFI_DESIGNS[0];
  const parts = view === 'alertas' ? { alerts: true, goal: false, recent: false } : { alerts: false, goal: clean.goal.on, recent: clean.recent.on };

  return (
    <div className="cab">
      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-6">
        <SuiteNav currentApp="kofi" channel={tts.channel} saved={saved} />

        <div className="grid items-start gap-5 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="grid gap-5">
            <section className="cab-mod">
              <h2>Diseño de la alerta</h2>
              <div className="itg-dz" role="group" aria-label="Diseño de la alerta">
                {KOFI_DESIGNS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={clean.design === item.id}
                    onClick={() => {
                      set('design', item.id);
                      setView('alertas');
                      setStatus('Vista previa del diseño con el último aviso.');
                    }}
                  >
                    <b>{item.name}</b>
                    <span>{item.note}</span>
                  </button>
                ))}
              </div>
              <p className="cab-hint">{design.hint}</p>
            </section>

            <section className="cab-mod">
              <h2>Personalización</h2>
              <div className="itg-two">
                <Field label="Posición">
                  <div className="itg-six" role="group" aria-label="Posición">
                    {SIX_POSITIONS.map((item) => (
                      <button key={item.id} type="button" aria-label={item.name} aria-pressed={clean.pos === item.id} onClick={() => set('pos', item.id)} />
                    ))}
                  </div>
                </Field>
                <Field label="Color de acento" htmlFor={`${uid}-color`} hint="También lo usan la meta y los últimos apoyos.">
                  <input id={`${uid}-color`} type="color" className="itg-color" value={clean.color} onChange={(e) => set('color', e.target.value)} />
                </Field>
              </div>
              <div className="itg-two">
                <Field label="Tamaño">
                  <Range label="Tamaño" min={KOFI_LIMITS.size.min} max={KOFI_LIMITS.size.max} step={5} value={clean.size} format={(v) => `${v}%`} onChange={(size) => set('size', size)} />
                </Field>
                <Field label="Tiempo en pantalla">
                  <Range label="Tiempo en pantalla" min={KOFI_LIMITS.hold.min} max={KOFI_LIMITS.hold.max} value={clean.hold} format={(v) => `${v} s`} onChange={(hold) => set('hold', hold)} />
                </Field>
              </div>
              <Toggle label="Mostrar la cantidad" checked={settings.showAmount} onChange={(showAmount) => set('showAmount', showAmount)} />
              <Toggle label="Mostrar el mensaje" checked={settings.showMessage} onChange={(showMessage) => set('showMessage', showMessage)} />
              <p className="cab-hint">Son ajustes comunes a todos los tipos de aviso. El texto y el sonido van por tipo.</p>
            </section>

            <section className="cab-mod">
              <h2>Por tipo de aviso</h2>
              <div className="cab-seg" role="group" aria-label="Tipo de aviso">
                {KOFI_KINDS.map((item) => (
                  <button key={item} type="button" aria-pressed={kind === item} onClick={() => setKind(item)}>
                    {KIND_TABS[item]}
                  </button>
                ))}
              </div>
              <KofiEventFields key={kind} kind={kind} rule={settings.events[kind]} clean={clean.events[kind]} cloudOn={Boolean(account)} onChange={setRule} />
            </section>

            <section className="cab-mod">
              <h2>Meta</h2>
              <Toggle label="Mostrar la meta" checked={settings.goal.on} onChange={(on) => setGoal({ on })} />
              <div className="cab-seg" role="group" aria-label="Disposición de la meta">
                <button type="button" aria-pressed={clean.goal.layout === 'barra'} onClick={() => (setGoal({ layout: 'barra' }), setView('fijas'))}>
                  Barra
                </button>
                <button type="button" aria-pressed={clean.goal.layout === 'deposito'} onClick={() => (setGoal({ layout: 'deposito' }), setView('fijas'))}>
                  Depósito
                </button>
              </div>
              <div className="itg-two">
                <Field label="Nombre de la meta" htmlFor={`${uid}-gt`}>
                  <input id={`${uid}-gt`} type="text" className="cab-inp" maxLength={KOFI_LIMITS.title} value={settings.goal.title} onChange={(e) => setGoal({ title: e.target.value })} />
                </Field>
                <Field label={`Objetivo (${clean.goal.currency})`} htmlFor={`${uid}-gg`}>
                  <input
                    id={`${uid}-gg`}
                    type="number"
                    className="cab-inp"
                    min={KOFI_LIMITS.target.min}
                    max={KOFI_LIMITS.target.max}
                    value={settings.goal.target}
                    onChange={(e) => setGoal({ target: Number(e.target.value) })}
                    onBlur={() => setGoal({ target: clean.goal.target })}
                  />
                </Field>
                <Field label="Moneda" htmlFor={`${uid}-gc`} hint="Tres letras: EUR, USD, MXN...">
                  <input
                    id={`${uid}-gc`}
                    type="text"
                    className="cab-inp cab-mono"
                    maxLength={3}
                    value={settings.goal.currency}
                    onChange={(e) => setGoal({ currency: e.target.value.toUpperCase() })}
                    onBlur={() => setGoal({ currency: clean.goal.currency })}
                  />
                </Field>
              </div>
              <div className="ic-row">
                <button type="button" className="cab-btn2 cab-btn-sm" onClick={resetGoal}>
                  Reiniciar meta
                </button>
              </div>
              <p className="cab-hint">
                Solo suman los tipos de aviso con «Sumar a la meta» activado, y solo los apoyos en la moneda de la meta; los demás se anotan sin sumar. Lo
                recaudado lo lleva el servidor de Lalo, una vez por aviso.
              </p>
            </section>

            <section className="cab-mod">
              <h2>Últimos apoyos</h2>
              <Toggle label="Mostrar los últimos apoyos" checked={settings.recent.on} onChange={(on) => update((prev) => ({ ...prev, recent: { ...prev.recent, on } }))} />
              <div className="cab-seg" role="group" aria-label="Disposición de los últimos apoyos">
                {(['lista', 'cinta'] as const).map((layout) => (
                  <button
                    key={layout}
                    type="button"
                    aria-pressed={clean.recent.layout === layout}
                    onClick={() => {
                      update((prev) => ({ ...prev, recent: { ...prev.recent, layout } }));
                      setView('fijas');
                    }}
                  >
                    {layout === 'lista' ? 'Lista' : 'Cinta'}
                  </button>
                ))}
              </div>
              <p className="cab-hint">Los apoyos privados salen como «Alguien». Usa el mismo color de acento que las alertas.</p>
            </section>

            <section className="cab-mod">
              <h2>Fuentes de OBS</h2>
              <div className="cab-field">
                <Toggle label="Mostrar también en «Todo en uno»" checked={settings.inAll} onChange={(inAll) => set('inAll', inAll)} />
                <span className="cab-hint">
                  En «Todo en uno» salen las alertas y, si están encendidas arriba, la meta y los últimos apoyos. Las tres fuentes propias muestran
                  siempre lo suyo.
                </span>
              </div>
              <ul className="cab-rows">
                {SOURCES.map((source) => (
                  <li key={source.app} className="cab-row">
                    <span>{source.name}</span>
                    <div className="cab-row-actions">
                      <button type="button" className="cab-btn2 cab-btn-sm" onClick={() => copyUrl(source.app, true)}>
                        {copied === `${source.app}-demo` ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        <span>De muestra</span>
                      </button>
                      <button type="button" className="cab-btn2 cab-btn-sm" onClick={() => copyUrl(source.app, false)}>
                        {copied === source.app ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        <span>Copiar URL</span>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="cab-note" role="status">
                {account
                  ? connection || 'Comprobando la conexión con Ko-fi.'
                  : 'Los avisos reales necesitan la nube y el servidor de Lalo publicado: Ko-fi tiene que poder llegar a una dirección pública. Sin ellos, las fuentes solo enseñan avisos de ejemplo con la URL de muestra. El diseño y los ajustes sí viajan en la URL.'}{' '}
                <a className="studio-link" href="#integraciones">
                  Integraciones
                </a>
              </p>
            </section>
          </div>

          {/* ---------- Monitor ---------- */}
          <section className="cab-mod max-[1099px]:order-first min-[1100px]:sticky min-[1100px]:top-4">
            <h2>Monitor</h2>
            <div className="cab-seg" role="group" aria-label="Qué enseña el monitor">
              <button type="button" aria-pressed={view === 'alertas'} onClick={() => setView('alertas')}>
                Alertas
              </button>
              <button type="button" aria-pressed={view === 'fijas'} onClick={() => setView('fijas')}>
                Meta y últimos apoyos
              </button>
            </div>
            <div className="cab-stage itg-stage">
              <KofiStage
                ref={stage}
                settings={clean}
                parts={parts}
                blockedWords={tts.blockedWords}
                initial={account ? undefined : { raised: KOFI_DEMO_RAISED, recent: KOFI_DEMO_RECENT }}
              />
            </div>
            <p className="cab-hint" role="status">
              {status}
            </p>

            <div className="cab-field">
              <span className="cab-label">Avisos de prueba</span>
              <div className="itg-tests">
                {TESTS.map((test) => (
                  <button key={test.id} type="button" className="cab-btn2 cab-btn-sm" onClick={() => fire(test.id)}>
                    {test.label}
                  </button>
                ))}
                <button
                  type="button"
                  className="cab-btn2 cab-btn-sm"
                  onClick={() => {
                    stage.current?.clearAlert();
                    setStatus('Alerta retirada.');
                  }}
                >
                  Quitar
                </button>
              </div>
              <span className="cab-hint">
                Nombres, cantidades y mensajes inventados. Las alertas van en cola, una cada vez. Los recuadros punteados «Ko-fi» son el sitio de su
                marca: aquí no se dibuja su logotipo.
              </span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
