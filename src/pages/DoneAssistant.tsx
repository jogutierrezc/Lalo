/**
 * src/pages/DoneAssistant.tsx
 *
 * Done · Asistente del canal: ventana de configuración con pestañas y la vista previa en vivo a la
 * derecha (el mismo overlay que OBS, sin voz ni chat real). Guardado automático con confirmación
 * visible. Los textos de presentación (TEXTOS en src/lib/fundadores.ts) siguen por confirmar.
 */

import React, { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Boton, Campo, Rango, Segmented, Switch, TabPanel, Tabs } from '../components/tally-ui';
import { useCloudSession } from '../hooks/useCloudSession';
import { useObsActions } from '../components/shell/obsActions';
import { getDoneReadKey, isDoneDemo } from '../lib/doneClient';
import type { DoneSettings } from '../lib/doneTypes';
import { DoneMemoryPanel } from '../components/done/DoneMemoryPanel';
import { DoneModelGallery } from '../components/done/DoneModelGallery';
import { DonePreview } from '../components/done/DonePreview';
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
      <dl className="done-kv">
        <dt>Canal</dt>
        <dd>{channel || 'Sin conectar'}</dd>
        <dt>ID del canal</dt>
        <dd>{channelId || 'Sin conectar'}</dd>
        <dt>Done escribe como</dt>
        <dd>{writeAs === 'creator' ? channel || 'Tu cuenta' : 'Cuenta de Done'}</dd>
      </dl>
      <div className="done-field">
        <span className="done-lbl">Tu fuente única de OBS</span>
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
      <ul className="done-chk" aria-label="Comprobaciones">
        <li data-ok={channel ? '1' : '0'}><i aria-hidden="true" />{channel ? 'Canal de Twitch conectado' : 'Falta conectar el canal de Twitch'}</li>
        <li data-ok={channelId ? '1' : '0'}><i aria-hidden="true" />{channelId ? 'ID del creador disponible' : 'Falta el ID del creador'}</li>
        <li data-ok={demo ? '0' : '1'}><i aria-hidden="true" />{demo ? 'Modo demo: sin servidor' : 'Servidor de Done conectado'}</li>
      </ul>
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

  return (
    <div className="done-win">
      <div className="done-win-head">
        <span className="sp" />
        <span className="done-status" data-state={state} role="status">
          {state === 'error' && <AlertTriangle size={14} aria-hidden="true" />}
          {STATUS_TEXT[state]}
          {state === 'error' && !loadError && <button type="button" onClick={retry}>Reintentar</button>}
        </span>
      </div>
      <div className="done-win-main">
        <div className="done-win-form">
          <div className="done-tabs-sticky">
            <Tabs label="Ajustes de Done" tabs={TABS} value={tab} onChange={setTab} idBase="done" />
          </div>
          {(loadError || error) && (
            <p className="done-err" role="alert">
              <AlertTriangle size={14} aria-hidden="true" />
              {loadError ?? error}
            </p>
          )}
          <TabPanel idBase="done" id="personaje" value={tab}>
            <DoneModelGallery catalog={catalog} library={library} selectedId={entry.id} widgetKey={widgetKey} error={libError} onSelect={choose} onReload={reload} />
            <Rango label="Tamaño en pantalla" value={settings.obsSize} min={10} max={100} step={5} format={(v) => `${v} %`} onChange={(v) => update({ obsSize: v })} />
            <div className="done-field">
              <span className="done-lbl">Posición</span>
              <Segmented
                label="Posición del personaje"
                value={settings.position}
                options={[{ value: 'left', label: 'Izquierda' }, { value: 'center', label: 'Centro' }, { value: 'right', label: 'Derecha' }]}
                onChange={(v) => update({ position: v })}
              />
            </div>
            {notice && <p className="done-note-dash" role="status">{notice}</p>}
          </TabPanel>

          <TabPanel idBase="done" id="personalidad" value={tab}>
            <Campo label="Personalidad" htmlFor="done-pers" hint="Cómo habla y qué tono usa Done.">
              <textarea id="done-pers" className="done-textarea" maxLength={PERSONALITY_MAX} value={settings.personality} onChange={(e) => update({ personality: e.target.value })} />
              <span className="done-count">{settings.personality.length} de {PERSONALITY_MAX}</span>
            </Campo>
            <Campo label="Idioma" htmlFor="done-lang">
              <select id="done-lang" className="done-select" value={settings.language} onChange={(e) => update({ language: e.target.value as DoneSettings['language'] })}>
                {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </Campo>
            <Rango label="Largo máximo de la respuesta" value={settings.replyMax} min={REPLY_LIMITS.min} max={REPLY_LIMITS.max} step={REPLY_LIMITS.step} format={(v) => `${v} caracteres`} onChange={(v) => update({ replyMax: v })} />
            <Toggle id="done-banter" label="Modo pique" hint="Responde con humor a los insultos y mantiene líneas rojas" checked={settings.banter === 'pique'} onChange={(v) => update({ banter: v ? 'pique' : 'off' })} />
            <Toggle id="done-mem" label="Usar la memoria" checked={settings.memoryEnabled} onChange={(v) => update({ memoryEnabled: v })} />
            <Toggle id="done-thread" label="Recordar la conversación con cada espectador" checked={settings.threadEnabled} onChange={(v) => update({ threadEnabled: v })} />
            <Toggle id="done-learn" label="Aprender del chat" hint="Apagado por defecto" checked={settings.chatLearning} onChange={(v) => update({ chatLearning: v })} />
          </TabPanel>

          <TabPanel idBase="done" id="comando" value={tab}>
            <Campo
              label="Comando de activación"
              htmlFor="done-cmd"
              hint="De 2 a 20 letras o números. No puede ser s, luxon, luxoff, doneon, doneoff, tally ni un comando del bot."
              error={cmdCheck.ok ? null : cmdCheck.message}
            >
              <div className="done-prefix" data-error={cmdCheck.ok ? '0' : '1'}>
                !<input id="done-cmd" className="done-input" maxLength={20} autoComplete="off" spellCheck={false} value={cmdValue} onChange={(e) => onCmd(e.target.value)} />
              </div>
            </Campo>
            <Toggle id="done-alias" label="Mantener !done como alias" hint="Útil si cambias el comando y tu chat ya lo usa" checked={settings.keepAlias} onChange={(v) => update({ keepAlias: v })} />
            <div className="done-field">
              <span className="done-lbl">Done escribe en el chat como</span>
              <Segmented
                label="Escribe como"
                value={settings.writeAs}
                options={[{ value: 'creator', label: `Tu cuenta${channel ? ` · ${channel}` : ''}` }, { value: 'bot', label: 'Cuenta de Done' }]}
                onChange={(v) => update({ writeAs: v })}
              />
              {settings.writeAs === 'creator' && <p className="done-hint">Publicar desde tu cuenta exige tu autorización del chat.</p>}
            </div>
            <dl className="done-kv">
              <dt>Espera por espectador</dt>
              <dd>{COOLDOWN_SECONDS} s</dd>
              <dt>Hilo y memoria</dt>
              <dd>{settings.threadEnabled && settings.memoryEnabled ? 'Activos' : 'Parcialmente apagados'}</dd>
            </dl>
          </TabPanel>

          <TabPanel idBase="done" id="voz" value={tab}>
            <div className="done-field">
              <span className="done-lbl">Voz</span>
              <p className="done-hint">Done usa la misma voz que configuras en Voz del chat, así el bot, Done y la voz suenan igual. La vista previa no reproduce audio.</p>
            </div>
            <Rango label="Volumen de la voz" value={settings.voiceVolume} min={0} max={100} step={5} format={(v) => `${v} %`} onChange={(v) => update({ voiceVolume: v })} />
            <div className="done-field">
              <span className="done-lbl">Cómo se ve el texto</span>
              <div className="done-styles" role="group" aria-label="Estilo del texto">
                {DONE_TEXT_STYLES.map((s) => (
                  <button key={s.id} type="button" className="done-chip" aria-pressed={normalizeTextStyle(settings.textStyle) === s.id} onClick={() => update({ textStyle: s.id })}>
                    <b>{s.name}</b>
                    <small>{s.description}</small>
                  </button>
                ))}
              </div>
            </div>
            <Toggle id="done-show" label="Mostrar el texto en pantalla" checked={settings.showText} onChange={(v) => update({ showText: v })} />
            <Rango label="Velocidad de escritura" value={settings.typingCps} min={20} max={120} step={5} format={(v) => `${v} letras/s`} onChange={(v) => update({ typingCps: v })} />
          </TabPanel>

          <TabPanel idBase="done" id="eventos" value={tab}>
            <Toggle id="done-e-follow" label="Reaccionar a un seguidor nuevo" checked={settings.eventFollow} onChange={(v) => update({ eventFollow: v })} />
            <Toggle id="done-e-sub" label="Reaccionar a una suscripción" checked={settings.eventSub} onChange={(v) => update({ eventSub: v })} />
            <Toggle id="done-e-raid" label="Reaccionar a un raid" checked={settings.eventRaid} onChange={(v) => update({ eventRaid: v })} />
            <Toggle id="done-e-start" label="Saludar al iniciar el directo" checked={settings.eventStart} onChange={(v) => update({ eventStart: v })} />
            <Campo label="Comentarios espontáneos" htmlFor="done-every">
              <select id="done-every" className="done-select" value={settings.spontaneousEveryMin} onChange={(e) => update({ spontaneousEveryMin: Number(e.target.value) as DoneSettings['spontaneousEveryMin'] })}>
                {SPONTANEOUS_EVERY.map((m) => <option key={m} value={m}>{m === 0 ? 'Desactivados' : `Cada ${m} minutos`}</option>)}
              </select>
            </Campo>
            <Campo label="Mensajes mínimos en el chat" htmlFor="done-min" hint="Done solo comenta si hubo al menos esa cantidad de mensajes.">
              <select id="done-min" className="done-select" value={settings.spontaneousMinMessages} onChange={(e) => update({ spontaneousMinMessages: Number(e.target.value) as DoneSettings['spontaneousMinMessages'] })}>
                {SPONTANEOUS_MIN.map((m) => <option key={m} value={m}>{m} mensajes</option>)}
              </select>
            </Campo>
          </TabPanel>

          <TabPanel idBase="done" id="memoria" value={tab}>
            <DoneMemoryPanel />
          </TabPanel>

          <TabPanel idBase="done" id="enlace" value={tab}>
            <LinkTab channel={channel} channelId={channelId} writeAs={settings.writeAs} />
          </TabPanel>
        </div>

        <div className="done-win-prev">
          <DonePreview
            settings={settings}
            spec={entry}
            widgetKey={widgetKey}
            channel={channel || 'tu_canal'}
            licenseNotice={entry.licenseNotice}
            onFallback={(reason) => setNotice(`No se pudo cargar el modelo 3D (${reason}). Se muestra la mascota de Done.`)}
          />
        </div>
      </div>
    </div>
  );
};
