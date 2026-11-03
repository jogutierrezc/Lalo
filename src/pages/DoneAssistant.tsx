/**
 * src/pages/DoneAssistant.tsx
 *
 * Done · Asistente del canal: ventana de configuración con pestañas y la vista previa en vivo a la
 * derecha (el mismo overlay que OBS, sin voz ni chat real). Guardado automático con confirmación
 * visible. Los textos de presentación (TEXTOS en src/lib/fundadores.ts) siguen por confirmar.
 */

import React, { useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { AlertTriangle } from 'lucide-react';
import { Boton, Campo, Rango, Segmented, Switch, TabPanel, Tabs } from '../components/tally-ui';
import { useCloudSession } from '../hooks/useCloudSession';
import { useObsActions } from '../components/shell/obsActions';
import { getDoneReadKey, isDoneDemo } from '../lib/doneClient';
import type { DoneSettings } from '../lib/doneTypes';
import { DoneMemoryPanel } from '../components/done/DoneMemoryPanel';
import { DoneModelGallery } from '../components/done/DoneModelGallery';
import { DoneBotStrip } from '../components/done/DoneBotStrip';
import { DonePreview } from '../components/done/DonePreview';
import { prefersReducedMotion } from '../components/done/DoneOverlayView';
import { PREVIEW_SIZES, PREVIEW_SIZE_LABEL, PREVIEW_WIDTH, readPreviewSize, savePreviewSize, type PreviewSize } from '../components/done/layoutLogic';
import { useDoneCatalog } from '../components/done/useDoneCatalog';
import { useDoneSettings, type SaveState } from '../components/done/useDoneSettings';
import {
  COOLDOWN_SECONDS,
  DONE_TEXT_STYLES,
  PERSONALITY_MAX,
  REPLY_LIMITS,
  SPONTANEOUS_EVERY,
  SPONTANEOUS_MIN,
  normalizeTextStyle,
  resolveEntry,
  selectionFor,
  validateDoneCommand,
  type CatalogEntry,
} from '../components/done/doneLogic';
import '../styles/done.css';

gsap.registerPlugin(useGSAP);

const TABS = [
  { id: 'personaje', label: 'Personaje' },
  { id: 'personalidad', label: 'Personalidad y respuestas' },
  { id: 'comando', label: 'Comando y chat' },
  { id: 'voz', label: 'Voz y texto' },
  { id: 'eventos', label: 'Eventos' },
  { id: 'memoria', label: 'Memoria' },
  { id: 'enlace', label: 'Enlace' },
];

const LANGUAGES: { value: DoneSettings['language']; label: string }[] = [
  { value: 'auto', label: 'Automático (el idioma de cada espectador)' },
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'Inglés' },
  { value: 'fr', label: 'Francés' },
  { value: 'pt', label: 'Portugués' },
  { value: 'it', label: 'Italiano' },
];

const Toggle: React.FC<{ id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }> = ({ id, label, hint, checked, onChange }) => (
  <div className="done-row">
    <span>
      {label}
      {hint && <small className="done-hint">{hint}</small>}
    </span>
    <Switch id={id} label={label} checked={checked} onChange={onChange} />
  </div>
);

/** Un tema de ajustes: título y controles. `rule` lo separa del anterior con una línea; `wide` ocupa las dos columnas. */
const Group: React.FC<{ title: string; wide?: boolean; rule?: boolean; children: React.ReactNode }> = ({ title, wide, rule, children }) => (
  <section className="done-group" data-wide={wide ? '' : undefined} data-rule={rule ? '' : undefined}>
    <h3>{title}</h3>
    {children}
  </section>
);

const STATUS_TEXT: Record<SaveState, string> = {
  loading: 'Cargando…',
  idle: 'Guardado automático',
  saving: 'Guardando…',
  saved: 'Guardado',
  error: 'No se pudo guardar',
};

/** Enlace de la fuente única de OBS. Vive aparte para usar los ajustes de OBS solo en esa pestaña. */
const LinkTab: React.FC<{ channel: string; channelId: string; writeAs: string }> = ({ channel, channelId, writeAs }) => {
  const obs = useObsActions(channel);
  const [copied, setCopied] = useState(false);
  const url = obs.getWidgetUrl('all');
  const demo = isDoneDemo();
  return (
    <>
      <Group title="Tu canal">
        <dl className="done-kv">
          <dt>Canal</dt>
          <dd>{channel || 'Sin conectar'}</dd>
          <dt>ID del canal</dt>
          <dd>{channelId || 'Sin conectar'}</dd>
          <dt>Done escribe como</dt>
          <dd>{writeAs === 'creator' ? channel || 'Tu cuenta' : 'Cuenta de Done'}</dd>
        </dl>
      </Group>
      <Group title="Tu fuente única de OBS">
      <div className="done-field">
        <div className="done-copy">
          <code>{url}</code>
          <Boton
            variante="principal"
            pequeno
            onClick={async () => {
              setCopied(await obs.copy('all'));
              window.setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? 'Copiada' : 'Copiar'}
          </Boton>
        </div>
        <p className="done-hint">Una sola fuente para el bot, Done y la voz del chat. Si ya tienes una fuente «Todo en uno», Done aparece en ella.</p>
      </div>
      </Group>
      <Group title="Comprobaciones" rule>
      <ul className="done-chk" aria-label="Comprobaciones">
        <li data-ok={channel ? '1' : '0'}><i aria-hidden="true" />{channel ? 'Canal de Twitch conectado' : 'Falta conectar el canal de Twitch'}</li>
        <li data-ok={channelId ? '1' : '0'}><i aria-hidden="true" />{channelId ? 'ID del creador disponible' : 'Falta el ID del creador'}</li>
        <li data-ok={demo ? '0' : '1'}><i aria-hidden="true" />{demo ? 'Modo demo: sin servidor' : 'Servidor de Done conectado'}</li>
      </ul>
      </Group>
    </>
  );
};

export const DoneAssistant: React.FC = () => {
  const { profile } = useCloudSession();
  const { settings, state, error, loadError, update, retry } = useDoneSettings();
  const { catalog, library, error: libError, reload } = useDoneCatalog();
  const [tab, setTab] = useState('personaje');
  const [cmd, setCmd] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [size, setSize] = useState<PreviewSize>(() => readPreviewSize());
  const root = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLDivElement>(null);
  const firstTab = useRef(true);

  const channel = profile?.twitch_login ?? (isDoneDemo() ? 'gaby_live' : '');
  const channelId = profile?.twitch_user_id ?? (isDoneDemo() ? '482915' : '');
  // La galería y la vista previa piden modelos de toda la biblioteca: usan la clave de OBS (la de lectura solo sirve el modelo activo)
  const widgetKey = profile?.widget_key ?? getDoneReadKey() ?? '';
  const entry = useMemo(() => resolveEntry(catalog, settings), [catalog, settings]);

  const cmdValue = cmd ?? settings.commandWord;
  const cmdCheck = validateDoneCommand(cmdValue);
  const onCmd = (raw: string) => {
    const v = raw.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
    setCmd(v);
    const check = validateDoneCommand(v);
    if (check.ok) update({ commandWord: check.word });
  };

  const choose = (e: CatalogEntry) => {
    setNotice(null);
    update(selectionFor(e));
  };

  // Al cambiar de pestaña, los temas entran en cascada. Apagado con «reducir movimiento».
  useGSAP(
    () => {
      if (firstTab.current) {
        firstTab.current = false;
        return;
      }
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo('.done-group', { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.22, stagger: 0.04, ease: 'power3.out', clearProps: 'opacity,transform' });
      });
      return () => mm.revert();
    },
    { dependencies: [tab], scope: root }
  );

  // S/M/L: la columna de la vista previa cambia de ancho en 220 ms. En pantallas estrechas no hay columna.
  const { contextSafe } = useGSAP({ scope: root });
  const chooseSize = contextSafe((next: PreviewSize) => {
    if (next === size) return;
    const el = main.current;
    const stage = el?.querySelector('.done-stage');
    const from = stage ? stage.getBoundingClientRect().width : PREVIEW_WIDTH[size];
    setSize(next);
    savePreviewSize(next);
    const narrow = (root.current?.clientWidth ?? 0) <= 960;
    if (!el || narrow || prefersReducedMotion()) return;
    gsap.fromTo(el, { '--prev-w': `${from}px` }, { '--prev-w': `${PREVIEW_WIDTH[next]}px`, duration: 0.22, ease: 'power3.out', clearProps: '--prev-w', overwrite: true });
  });

  return (
    <div className="done-win" ref={root}>
      <DoneBotStrip
        accountId={profile?.status === 'active' ? profile.id : ''}
        demo={isDoneDemo()}
        trailing={
          <span className="done-status" data-state={state} role="status">
            {state === 'error' && <AlertTriangle size={14} aria-hidden="true" />}
            {STATUS_TEXT[state]}
            {state === 'error' && !loadError && <button type="button" onClick={retry}>Reintentar</button>}
          </span>
        }
      />
      <div className="done-tabs-sticky">
        <Tabs label="Ajustes de Done" tabs={TABS} value={tab} onChange={setTab} idBase="done" />
      </div>
      <div className="done-win-main" ref={main} data-size={size}>
        <div className="done-win-form">
          {(loadError || error) && (
            <p className="done-err" role="alert">
              <AlertTriangle size={14} aria-hidden="true" />
              {loadError ?? error}
            </p>
          )}
          <TabPanel idBase="done" id="personaje" value={tab}>
            <div className="done-grid">
              <Group title="Personaje" wide>
                <DoneModelGallery catalog={catalog} library={library} selectedId={entry.id} widgetKey={widgetKey} error={libError} onSelect={choose} onReload={reload} />
              </Group>
              <Group title="Tamaño" rule>
                <Rango label="Tamaño en pantalla" value={settings.obsSize} min={10} max={100} step={5} format={(v) => `${v} %`} onChange={(v) => update({ obsSize: v })} />
              </Group>
              <Group title="Posición" rule>
                <Segmented
                  label="Posición del personaje"
                  value={settings.position}
                  options={[{ value: 'left', label: 'Izquierda' }, { value: 'center', label: 'Centro' }, { value: 'right', label: 'Derecha' }]}
                  onChange={(v) => update({ position: v })}
                />
                {notice && <p className="done-note-dash" role="status">{notice}</p>}
              </Group>
            </div>
          </TabPanel>

          <TabPanel idBase="done" id="personalidad" value={tab}>
            <div className="done-grid">
              <Group title="Cómo habla" wide>
                <Campo label="Personalidad" htmlFor="done-pers" hint="Cómo habla y qué tono usa Done.">
                  <textarea id="done-pers" className="done-textarea" maxLength={PERSONALITY_MAX} value={settings.personality} onChange={(e) => update({ personality: e.target.value })} />
                  <span className="done-count">{settings.personality.length} de {PERSONALITY_MAX}</span>
                </Campo>
              </Group>
              <Group title="Respuesta" rule>
                <Campo label="Idioma" htmlFor="done-lang">
                  <select id="done-lang" className="done-select" value={settings.language} onChange={(e) => update({ language: e.target.value as DoneSettings['language'] })}>
                    {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                  </select>
                </Campo>
                <Rango label="Largo máximo" value={settings.replyMax} min={REPLY_LIMITS.min} max={REPLY_LIMITS.max} step={REPLY_LIMITS.step} format={(v) => `${v} caracteres`} onChange={(v) => update({ replyMax: v })} />
              </Group>
              <Group title="Estilo" rule>
                <Toggle id="done-banter" label="Modo pique" hint="Responde con humor a los insultos" checked={settings.banter === 'pique'} onChange={(v) => update({ banter: v ? 'pique' : 'off' })} />
                <Toggle id="done-learn" label="Aprender del chat" hint="Apagado por defecto" checked={settings.chatLearning} onChange={(v) => update({ chatLearning: v })} />
              </Group>
              <Group title="Memoria" wide rule>
                <div className="done-grid">
                  <Toggle id="done-mem" label="Usar la memoria" checked={settings.memoryEnabled} onChange={(v) => update({ memoryEnabled: v })} />
                  <Toggle id="done-thread" label="Recordar a cada espectador" checked={settings.threadEnabled} onChange={(v) => update({ threadEnabled: v })} />
                </div>
              </Group>
            </div>
          </TabPanel>

          <TabPanel idBase="done" id="comando" value={tab}>
            <div className="done-grid">
              <Group title="Comando">
                <Campo
                  label="Comando de activación"
                  htmlFor="done-cmd"
                  hint="De 2 a 20 letras o números. Algunas palabras están reservadas."
                  error={cmdCheck.ok ? null : cmdCheck.message}
                >
                  <div className="done-prefix" data-error={cmdCheck.ok ? '0' : '1'}>
                    !<input id="done-cmd" className="done-input" maxLength={20} autoComplete="off" spellCheck={false} value={cmdValue} onChange={(e) => onCmd(e.target.value)} />
                  </div>
                </Campo>
                <Toggle id="done-alias" label="Mantener !done como alias" hint="Útil si cambias el comando" checked={settings.keepAlias} onChange={(v) => update({ keepAlias: v })} />
              </Group>
              <Group title="Escribe como">
                <Segmented
                  label="Escribe como"
                  value={settings.writeAs}
                  options={[{ value: 'creator', label: `Tu cuenta${channel ? ` · ${channel}` : ''}` }, { value: 'bot', label: 'Cuenta de Done' }]}
                  onChange={(v) => update({ writeAs: v })}
                />
                {settings.writeAs === 'creator' && <p className="done-hint">Publicar desde tu cuenta exige tu autorización del chat.</p>}
                <dl className="done-kv">
                  <dt>Espera por espectador</dt>
                  <dd>{COOLDOWN_SECONDS} s</dd>
                  <dt>Hilo y memoria</dt>
                  <dd>{settings.threadEnabled && settings.memoryEnabled ? 'Activos' : 'Parcialmente apagados'}</dd>
                </dl>
              </Group>
            </div>
          </TabPanel>

          <TabPanel idBase="done" id="voz" value={tab}>
            <div className="done-grid">
              <Group title="Voz">
                <Rango label="Volumen de la voz" value={settings.voiceVolume} min={0} max={100} step={5} format={(v) => `${v} %`} onChange={(v) => update({ voiceVolume: v })} />
                <p className="done-hint">Es la voz de «Voz del chat». La vista previa no reproduce audio.</p>
              </Group>
              <Group title="Texto en pantalla">
                <Toggle id="done-show" label="Mostrar el texto" checked={settings.showText} onChange={(v) => update({ showText: v })} />
                <Rango label="Velocidad de escritura" value={settings.typingCps} min={20} max={120} step={5} format={(v) => `${v} letras/s`} onChange={(v) => update({ typingCps: v })} />
              </Group>
              <Group title="Cómo se ve el texto" wide rule>
                <div className="done-styles" role="group" aria-label="Estilo del texto">
                  {DONE_TEXT_STYLES.map((s) => (
                    <button key={s.id} type="button" className="done-chip" aria-pressed={normalizeTextStyle(settings.textStyle) === s.id} onClick={() => update({ textStyle: s.id })}>
                      <b>{s.name}</b>
                      <small>{s.description}</small>
                    </button>
                  ))}
                </div>
              </Group>
            </div>
          </TabPanel>

          <TabPanel idBase="done" id="eventos" value={tab}>
            <div className="done-grid">
              <Group title="Reacciona a">
                <Toggle id="done-e-follow" label="Seguidor nuevo" checked={settings.eventFollow} onChange={(v) => update({ eventFollow: v })} />
                <Toggle id="done-e-sub" label="Suscripción" checked={settings.eventSub} onChange={(v) => update({ eventSub: v })} />
                <Toggle id="done-e-raid" label="Raid" checked={settings.eventRaid} onChange={(v) => update({ eventRaid: v })} />
                <Toggle id="done-e-start" label="Inicio del directo" checked={settings.eventStart} onChange={(v) => update({ eventStart: v })} />
              </Group>
              <Group title="Comentarios espontáneos">
                <Campo label="Frecuencia" htmlFor="done-every">
                  <select id="done-every" className="done-select" value={settings.spontaneousEveryMin} onChange={(e) => update({ spontaneousEveryMin: Number(e.target.value) as DoneSettings['spontaneousEveryMin'] })}>
                    {SPONTANEOUS_EVERY.map((m) => <option key={m} value={m}>{m === 0 ? 'Desactivados' : `Cada ${m} minutos`}</option>)}
                  </select>
                </Campo>
                <Campo label="Mensajes mínimos en el chat" htmlFor="done-min" hint="Done comenta solo si hubo al menos esa cantidad.">
                  <select id="done-min" className="done-select" value={settings.spontaneousMinMessages} onChange={(e) => update({ spontaneousMinMessages: Number(e.target.value) as DoneSettings['spontaneousMinMessages'] })}>
                    {SPONTANEOUS_MIN.map((m) => <option key={m} value={m}>{m} mensajes</option>)}
                  </select>
                </Campo>
              </Group>
            </div>
          </TabPanel>

          <TabPanel idBase="done" id="memoria" value={tab}>
            <div className="done-grid">
              <Group title="Memoria de Done" wide>
                <DoneMemoryPanel />
              </Group>
            </div>
          </TabPanel>

          <TabPanel idBase="done" id="enlace" value={tab}>
            <div className="done-grid">
              <LinkTab channel={channel} channelId={channelId} writeAs={settings.writeAs} />
            </div>
          </TabPanel>
        </div>

        <aside className="done-side" aria-label="Vista previa">
          <div className="done-side-head">
            <strong>Vista previa</strong>
            <div className="tui-seg" role="group" aria-label="Tamaño de la vista previa">
              {PREVIEW_SIZES.map((s) => (
                <button key={s} type="button" aria-pressed={s === size} aria-label={`${PREVIEW_SIZE_LABEL[s]}, ${PREVIEW_WIDTH[s]} píxeles`} onClick={() => chooseSize(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <DonePreview
            settings={settings}
            spec={entry}
            widgetKey={widgetKey}
            channel={channel || 'tu_canal'}
            licenseNotice={entry.licenseNotice}
            onFallback={(reason) => setNotice(`No se pudo cargar el modelo 3D (${reason}). Se muestra la mascota de Done.`)}
          />
        </aside>
      </div>
    </div>
  );
};
