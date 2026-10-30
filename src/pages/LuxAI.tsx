/**
 * src/pages/LuxAI.tsx
 *
 * Panel de Lux AI del streamer. A la izquierda se configura al personaje; a la
 * derecha se le habla para comprobar que responde. Las comprobaciones de abajo
 * dicen qué falta para que Lux funcione en directo.
 *
 * Los ajustes se guardan en el servidor (lux_settings, migración 0024) y se
 * validan allí. La clave de NVIDIA no aparece aquí: la pone el administrador.
 */

import React, { useEffect, useState } from 'react';
import { Check, Copy, Send } from 'lucide-react';
import { SuiteNav } from '../components/SuiteNav';
import { Field, Range, Toggle } from '../components/studio/StudioKit';
import { useCloudSession } from '../hooks/useCloudSession';
import {
  luxAsk,
  luxCharacterView,
  luxGetSettings,
  luxSaveSettings,
  luxSay,
  luxSayList,
  type LuxCharacterView,
  type LuxSayList,
  type LuxSayState,
  type LuxSettingsView,
  type LuxVoice,
} from '../lib/luxApi';
import { LuxMemoryPanel } from '../components/lux/LuxMemoryPanel';
import { LuxModelLibraryPanel } from '../components/lux/LuxModelLibrary';
import { callSubscriptions, type SubscriptionRow } from '../lib/twitchEventsApi';
import { SUBSCRIPTION_NAMES, eventLinkState, type EventLinkState } from '../utils/twitchEvents';
import { loadPowerupsSettings } from '../types/powerups';
import { loadVoiceCatalogue } from '../lib/voicesCloud';
import type { VoiceCatalogue } from '../lib/voicesLogic';
import { loadTwitchIOSettings } from '../types/twitchio';
import { validateChatWord } from '../../server/lux/chatCommands';
import { luxDisplayName, validateChatName } from '../../server/lux/displayName';
import { LUX_BOT_VERSION } from '../../server/lux/release';
import { luxChatKey, readLuxBot } from '../lib/luxBotRecord';
import '../styles/integraciones.css';

const DEFAULTS: LuxSettingsView = {
  personality: '',
  replyMax: 200,
  language: 'es',
  memoryEnabled: true,
  obsSize: 40,
  voiceReferenceId: null,
  voiceEngine: null,
  voiceVolume: 100,
  chatLearning: false,
  chatWord: 'lux',
  chatAlias: true,
  chatName: '',
  spontaneousEnabled: true,
  spontaneousEveryMin: 15,
  spontaneousMinMessages: 10,
  eventFollow: true,
  eventSub: true,
  eventRaid: true,
  eventStart: true,
};
const SPONTANEOUS_EVERY = [10, 15, 30, 60];
const SPONTANEOUS_MIN = [3, 5, 10];
const SAY_TEXT_MAX = 500;
const SAY_IDEA_MAX = 300;

/** Lo que el panel dice de un mensaje de «Decir en el chat». Solo «Enviado» cuando el bot lo confirmó. */
const SAY_STATE: Record<LuxSayState, string> = {
  queued: 'En cola, esperando al bot',
  stalled: 'El bot no está respondiendo; ¿está corriendo?',
  sending: 'El bot lo recogió; esperando que confirme',
  unconfirmed: 'El bot lo recogió pero no confirmó si lo publicó',
  sent: 'Enviado (confirmado por el bot)',
  failed: 'El bot no pudo escribirlo en el chat; mira su terminal',
};
const PERSONALITY_MAX = 600;
const LANGUAGES: { value: LuxSettingsView['language']; label: string }[] = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'Inglés' },
  { value: 'pt', label: 'Portugués' },
];

interface Turn {
  id: number;
  viewer: string;
  text: string;
  reply?: string;
  emotion?: string;
  error?: string;
}

/** Canal que escucha el overlay de Lux (public/lux/overlay.html). Mismo origen, mismo navegador. */
const LUX_BUS = 'lux_bus';

const voiceValue = (engine: string | null | undefined, id: string | null | undefined): string => (id ? `${engine ?? 'fish'}|${id}` : '');
const parseVoice = (value: string): { referenceId: string | null; engine: LuxSettingsView['voiceEngine'] } => {
  if (!value) return { referenceId: null, engine: null };
  const [engine, ...rest] = value.split('|');
  return { referenceId: rest.join('|'), engine: engine === 'elevenlabs' ? 'elevenlabs' : 'fish' };
};

const sameSettings = (a: LuxSettingsView, b: LuxSettingsView): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Aviso del personaje cuando no usa su modelo (ver server/lux/models.ts). */
const CHARACTER_NOTE: Record<NonNullable<LuxCharacterView['modelNote']>, string> = {
  budget: 'Has llegado al tope de créditos de tu plan este mes: Mi AI usa el modelo por defecto hasta el mes siguiente.',
  disabled: 'El modelo de tu personaje ya no está disponible: Mi AI usa el modelo por defecto.',
};

/** Qué se le dice al creador de cada conexión de Twitch (seguidores nuevos, inicio del directo). */
function linkText(state: EventLinkState): string {
  switch (state) {
    case 'on':
      return 'conectado: Twitch avisa a Lalo.';
    case 'off':
      return 'falta encender el «Canal de eventos» en Power-ups.';
    case 'permission':
      return 'falta el permiso moderator:read:followers. Vuelve a autorizar con Twitch en Power-ups y enciende el «Canal de eventos».';
    case 'problem':
      return 'Twitch la tiene con problemas. Mira el estado en Power-ups, «Canal de eventos».';
    default:
      return 'no se pudo comprobar ahora.';
  }
}

export const LuxAI: React.FC = () => {
  const { profile } = useCloudSession();
  const enabled = profile?.lux_enabled === true || profile?.role === 'admin';
  // Sin ElevenLabs activado, el servidor rechaza esas voces (403 al hablar): no se ofrecen.
  const canUseEleven = profile?.elevenlabs_enabled === true || profile?.role === 'admin';

  const [saved, setSaved] = useState<LuxSettingsView | null>(null);
  const [draft, setDraft] = useState<LuxSettingsView>(DEFAULTS);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [commandCopied, setCommandCopied] = useState(false);
  // Con qué palabra se copió el bot la última vez (solo en este navegador).
  const [botRecord] = useState(() => readLuxBot());
  // Prefijo y comandos del bot de TwitchIO: la palabra no puede tomar ninguno de sus comandos.
  const [twitchIO] = useState(loadTwitchIOSettings);
  const commandPrefix = twitchIO.prefix.trim() || '!';
  const botCommandNames = twitchIO.commands.map((command) => command.name.trim().toLowerCase()).filter(Boolean);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState('');
  const [viewer, setViewer] = useState('');
  const [catalogue, setCatalogue] = useState<VoiceCatalogue | null>(null);
  const [speakOverlay, setSpeakOverlay] = useState(true);
  const [tab, setTab] = useState<'ajustes' | 'memoria'>('ajustes');
  const [character, setCharacter] = useState<LuxCharacterView | null>(null);
  // Giro del modelo 3D en grados. Va en el enlace de OBS (&turn=) y en la vista previa.
  const [turn, setTurn] = useState(0);
  // Decir en el chat: el mensaje queda en una cola y lo publica el bot.
  const [sayMode, setSayMode] = useState<'literal' | 'ai'>('literal');
  const [sayText, setSayText] = useState('');
  const [sayAlsoObs, setSayAlsoObs] = useState(true);
  const [sayBusy, setSayBusy] = useState(false);
  const [sayError, setSayError] = useState<string | null>(null);
  const [sayList, setSayList] = useState<LuxSayList | null>(null);
  const sayWaiting = sayList?.items.some((item) => item.state === 'queued' || item.state === 'sending' || item.state === 'stalled') ?? false;

  useEffect(() => {
    let alive = true;
    loadVoiceCatalogue().then((cat) => {
      if (alive) setCatalogue(cat);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    luxGetSettings().then((res) => {
      if (!alive) return;
      if (res.ok) {
        setSaved(res.data);
        setDraft(res.data);
        setLoadError(null);
      } else {
        setLoadError(res.message);
      }
    });
    return () => {
      alive = false;
    };
  }, [enabled]);

  // Seguidores nuevos e inicio del directo llegan por EventSub: se pregunta al mismo sitio que la página de Power-ups.
  const [eventLinks, setEventLinks] = useState<SubscriptionRow[] | null | 'loading'>('loading');
  const [grantedScopes] = useState(() => loadPowerupsSettings().scopes);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    callSubscriptions().then((res) => {
      if (alive) setEventLinks(res.ok ? res.subscriptions : null);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    luxCharacterView().then((res) => {
      if (alive && res.ok) setCharacter(res.data);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);

  // Estado de la cola: se vuelve a leer más seguido mientras hay algo esperando al bot.
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () => {
      luxSayList().then((res) => {
        if (alive && res.ok) setSayList(res.data);
      });
    };
    load();
    // Pestaña oculta: no se consulta; al volver a verse se lee al instante
    const tick = () => {
      if (document.visibilityState !== 'hidden') load();
    };
    const timer = setInterval(tick, sayWaiting ? 4000 : 20000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [enabled, sayWaiting]);

  const dirty = saved !== null && !sameSettings(saved, draft);
  const wordCheck = validateChatWord(draft.chatWord, botCommandNames);
  const nameCheck = validateChatName(draft.chatName);
  // Cómo se presenta la IA en el chat y en OBS (el nombre guardado; si aún no hay, el borrador).
  const aiName = luxDisplayName((saved ?? draft).chatName, (saved ?? draft).chatWord);
  const draftName = luxDisplayName(draft.chatName, draft.chatWord);
  // El bot copiado no coincide con lo guardado (o es de una versión anterior): hay que volver a copiarlo.
  const botStale =
    saved !== null &&
    botRecord !== null &&
    (luxChatKey(botRecord.word, botRecord.alias, botRecord.name) !== luxChatKey(saved.chatWord, saved.chatAlias, saved.chatName) ||
      botRecord.version < LUX_BOT_VERSION);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  // La clave k es la de OBS del streamer (la misma de la pestaña Cuenta): el overlay la usa para el tope de voz.
  const keyPart = profile?.widget_key ? `&k=${encodeURIComponent(profile.widget_key)}` : '';
  // Canal de Twitch: el overlay lee el chat para el !lux y el !s. Una sola fuente de OBS para los dos.
  const channelPart = profile?.twitch_login ? `&channel=${encodeURIComponent(profile.twitch_login)}` : '';
  const turnPart = turn ? `&turn=${turn}` : '';
  const overlayUrl = `${origin}/lux/overlay.html?overlay=1&size=${draft.obsSize}${keyPart}${channelPart}${turnPart}`;
  // La vista previa es el mismo overlay sin voz ni chat: solo enseña el personaje con su giro.
  const previewUrl = `${overlayUrl}&preview=1`;
  const answered = turns.some((turn) => turn.reply);

  // Manda una frase al overlay abierto en este navegador. Sin overlay abierto, nadie la oye.
  const sendToOverlay = (text: string, emotion: string, voice: LuxVoice, gesture?: string) => {
    if (typeof BroadcastChannel === 'undefined') return;
    const bus = new BroadcastChannel(LUX_BUS);
    bus.postMessage({ type: 'speak', text, emotion, voice, gesture });
    bus.close();
  };

  const update = <K extends keyof LuxSettingsView>(key: K, value: LuxSettingsView[K]) => {
    setSaveNote(null);
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    setBusy(true);
    setSaveError(null);
    setSaveNote(null);
    const previous = saved;
    const res = await luxSaveSettings(draft);
    if (res.ok) {
      setSaved(res.data);
      setDraft(res.data);
      const commandChanged =
        previous !== null &&
        luxChatKey(previous.chatWord, previous.chatAlias, previous.chatName) !== luxChatKey(res.data.chatWord, res.data.chatAlias, res.data.chatName);
      setSaveNote(
        commandChanged && previous
          ? `Ajustes guardados. Vuelve a copiar el script del bot en el estudio de TwitchIO: hasta entonces, el bot antiguo sigue con ${commandPrefix}${previous.chatWord} y el nombre anterior.`
          : 'Ajustes guardados.'
      );
    } else {
      setSaveError(res.message);
    }
    setBusy(false);
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard?.writeText(overlayUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setSaveError('No se pudo copiar. Selecciona la dirección y cópiala a mano.');
    }
  };

  const copyCommand = async () => {
    try {
      await navigator.clipboard?.writeText(`${commandPrefix}${wordCheck.ok ? wordCheck.word : draft.chatWord}`);
      setCommandCopied(true);
      setTimeout(() => setCommandCopied(false), 1600);
    } catch {
      setSaveError('No se pudo copiar el comando. Escríbelo a mano.');
    }
  };

  const ask = async () => {
    const text = message.trim();
    if (!text || busy) return;
    const id = Date.now();
    setTurns((current) => [...current, { id, viewer: viewer.trim() || 'Espectador', text }]);
    setMessage('');
    setBusy(true);
    const res = await luxAsk(text, viewer.trim(), speakOverlay);
    setTurns((current) =>
      current.map((turn) =>
        turn.id === id ? (res.ok ? { ...turn, reply: res.data.reply, emotion: res.data.emotion } : { ...turn, error: res.message }) : turn
      )
    );
    setBusy(false);
  };

  // Prueba de voz: una frase con la voz y la emoción elegidas, sin pasar por el modelo.
  const listenOverlay = () => {
    const voice: LuxVoice = { referenceId: draft.voiceReferenceId, engine: draft.voiceEngine };
    sendToOverlay(`Hola, soy ${aiName}. Así suena mi voz.`, 'feliz', voice, 'pride');
  };

  const say = async () => {
    const text = sayText.trim();
    if (!text || sayBusy) return;
    setSayBusy(true);
    setSayError(null);
    const res = await luxSay(text, sayMode, sayAlsoObs);
    if (res.ok) {
      setSayText('');
      const list = await luxSayList();
      if (list.ok) setSayList(list.data);
    } else {
      setSayError(res.message);
    }
    setSayBusy(false);
  };

  return (
    <div className="cab">
      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-6">
        <SuiteNav currentApp="lux" />

        {!enabled ? (
          <section className="cab-mod">
            <h2 className="text-base font-semibold">Mi AI no está activada para tu cuenta</h2>
            <p className="cab-hint">El administrador la activa desde Streamers. Cuando lo haga, aquí podrás configurarla.</p>
          </section>
        ) : (
          <div className="grid gap-5">
            <div className="cab-seg" role="group" aria-label="Secciones de Mi AI">
              <button type="button" aria-pressed={tab === 'ajustes'} onClick={() => setTab('ajustes')}>
                Ajustes
              </button>
              <button type="button" aria-pressed={tab === 'memoria'} onClick={() => setTab('memoria')}>
                Memoria
              </button>
            </div>
            {tab === 'memoria' ? (
              <LuxMemoryPanel />
            ) : (
          <div className="grid items-start gap-5 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <div className="grid gap-5">
              {loadError && (
                <p className="cab-error" role="alert">
                  No se pudieron leer tus ajustes: {loadError}
                </p>
              )}

              <section className="cab-mod grid gap-3" aria-labelledby="lux-character">
                <h2 id="lux-character" className="text-base font-semibold">
                  Tu personaje
                </h2>
                {character ? (
                  <>
                    <p className="flex items-center gap-2 text-sm">
                      <span className="inline-block h-3 w-3 rounded-full" style={{ background: character.character.color }} aria-hidden />
                      <strong>{character.character.name}</strong>
                    </p>
                    <p className="cab-hint">Modelo: {character.modelLabel}</p>
                    {character.usage.budget !== null && (
                      <p className="cab-hint">
                        Créditos este mes: {character.usage.credits} de {character.usage.budget} del plan.
                      </p>
                    )}
                    {character.modelNote && (
                      <p className="cab-note" role="status">
                        {CHARACTER_NOTE[character.modelNote]}
                      </p>
                    )}
                    {character.character.licenseNotice && (
                      <p className="cab-hint" role="note">
                        {character.character.licenseNotice}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="cab-hint">Leyendo tu personaje.</p>
                )}
                <p className="cab-hint">El administrador asigna el personaje. Lo que Mi AI recuerda es de ese personaje.</p>
              </section>

              <LuxModelLibraryPanel />

              <section className="cab-mod grid gap-4" aria-labelledby="lux-personality">
                <h2 id="lux-personality" className="text-base font-semibold">
                  Personalidad
                </h2>
                <Field label="Cómo habla Lux" htmlFor="lux-personality-input" hint={`${draft.personality.length} de ${PERSONALITY_MAX} caracteres`}>
                  <textarea
                    id="lux-personality-input"
                    className="cab-inp min-h-28"
                    maxLength={PERSONALITY_MAX}
                    value={draft.personality}
                    disabled={busy || saved === null}
                    placeholder="Ejemplo: tranquila, un poco traviesa, habla de juegos y nunca insulta a nadie."
                    onChange={(e) => update('personality', e.target.value)}
                  />
                </Field>
              </section>

              <section className="cab-mod grid gap-4" aria-labelledby="lux-command">
                <h2 id="lux-command" className="text-base font-semibold">
                  Comando de activación
                </h2>
                <Field label="Nombre de tu IA en el chat" htmlFor="lux-chat-name" hint="Opcional, hasta 30 caracteres. Si lo dejas vacío, usa la palabra de activación.">
                  <input
                    id="lux-chat-name"
                    className="cab-inp"
                    maxLength={40}
                    value={draft.chatName}
                    disabled={busy || saved === null}
                    placeholder={luxDisplayName('', draft.chatWord)}
                    aria-invalid={!nameCheck.ok}
                    aria-describedby={nameCheck.ok ? undefined : 'lux-chat-name-error'}
                    onChange={(e) => update('chatName', e.target.value)}
                  />
                </Field>
                {nameCheck.ok ? (
                  <p className="cab-hint" aria-live="polite">
                    En el chat y en OBS se presentará como <strong>{draftName}</strong>.
                  </p>
                ) : (
                  <p id="lux-chat-name-error" className="cab-error" role="alert">
                    {nameCheck.message}
                  </p>
                )}
                <Field label="Palabra para hablar con tu IA" htmlFor="lux-chat-word" hint="De 2 a 20 letras o números, sin espacios. Por defecto: lux.">
                  <input
                    id="lux-chat-word"
                    className="cab-inp"
                    maxLength={40}
                    value={draft.chatWord}
                    disabled={busy || saved === null}
                    aria-invalid={!wordCheck.ok}
                    aria-describedby={wordCheck.ok ? undefined : 'lux-chat-word-error'}
                    onChange={(e) => update('chatWord', e.target.value)}
                  />
                </Field>
                {wordCheck.ok ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="cab-hint" aria-live="polite">
                      Los viewers escriben <strong>{`${commandPrefix}${wordCheck.word}`}</strong> para hablar con tu personaje.
                    </p>
                    <button type="button" className="cab-btn2 cab-btn-sm" onClick={copyCommand}>
                      {commandCopied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
                      {commandCopied ? 'Comando copiado' : 'Copiar comando'}
                    </button>
                  </div>
                ) : (
                  <p id="lux-chat-word-error" className="cab-error" role="alert">
                    {wordCheck.message}
                  </p>
                )}
                {wordCheck.ok && wordCheck.word !== 'lux' && (
                  <Toggle
                    label={`Seguir aceptando ${commandPrefix}lux`}
                    checked={draft.chatAlias}
                    disabled={busy || saved === null}
                    onChange={(next) => update('chatAlias', next)}
                  />
                )}
                <p className="cab-hint">Si cambias la palabra, vuelve a copiar el script del bot en el estudio de TwitchIO. El bot antiguo sigue con la palabra anterior hasta entonces.</p>
                {botStale && (
                  <p className="cab-note" role="status">
                    El bot que copiaste no usa tu comando actual o es de una versión anterior. Vuelve a copiar el script del bot en el estudio de TwitchIO.
                  </p>
                )}
              </section>

              <section className="cab-mod grid gap-4" aria-labelledby="lux-proactive">
                <h2 id="lux-proactive" className="text-base font-semibold">
                  Comentarios y eventos
                </h2>
                <Toggle
                  label="Comentarios espontáneos"
                  checked={draft.spontaneousEnabled}
                  disabled={busy || saved === null}
                  onChange={(next) => update('spontaneousEnabled', next)}
                />
                {draft.spontaneousEnabled && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Cada cuánto como mucho" htmlFor="lux-spont-every">
                      <select
                        id="lux-spont-every"
                        className="cab-inp"
                        value={draft.spontaneousEveryMin}
                        disabled={busy || saved === null}
                        onChange={(e) => update('spontaneousEveryMin', Number(e.target.value))}
                      >
                        {SPONTANEOUS_EVERY.map((minutes) => (
                          <option key={minutes} value={minutes}>
                            {minutes} minutos
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Mensajes mínimos del chat" htmlFor="lux-spont-min">
                      <select
                        id="lux-spont-min"
                        className="cab-inp"
                        value={draft.spontaneousMinMessages}
                        disabled={busy || saved === null}
                        onChange={(e) => update('spontaneousMinMessages', Number(e.target.value))}
                      >
                        {SPONTANEOUS_MIN.map((count) => (
                          <option key={count} value={count}>
                            {count} mensajes
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                )}
                <p className="cab-hint">
                  Cada cierto tiempo, {draftName} comenta lo que se habló en el chat, pero solo si hubo al menos esos mensajes de espectadores desde su último comentario. Si no, no dice nada. Se calla con !luxoff.
                </p>
                <span className="text-sm font-medium">Saludar cuando haya</span>
                <Toggle label="Seguidores nuevos" checked={draft.eventFollow} disabled={busy || saved === null} onChange={(next) => update('eventFollow', next)} />
                <Toggle label="Suscripciones" checked={draft.eventSub} disabled={busy || saved === null} onChange={(next) => update('eventSub', next)} />
                <Toggle label="Raids" checked={draft.eventRaid} disabled={busy || saved === null} onChange={(next) => update('eventRaid', next)} />
                <Toggle label="Inicio del directo" checked={draft.eventStart} disabled={busy || saved === null} onChange={(next) => update('eventStart', next)} />
                <div className="cab-note" role="note">
                  <p>Las suscripciones y las raids llegan por el chat de Twitch. Los seguidores nuevos y el inicio del directo llegan por el «Canal de eventos» de Twitch:</p>
                  <ul className="list-disc pl-5">
                    {(['channel.follow', 'stream.online'] as const).map((type) => (
                      <li key={type}>
                        {SUBSCRIPTION_NAMES[type]}:{' '}
                        {eventLinks === 'loading' ? 'comprobando…' : linkText(eventLinkState(eventLinks, type, grantedScopes))}
                      </li>
                    ))}
                  </ul>
                  <p>
                    {draftName} los saluda a través del bot, que tiene que estar en marcha.{' '}
                    <a className="studio-link" href="#powerups">
                      Ir a Power-ups
                    </a>
                  </p>
                </div>
                <p className="cab-hint">Varios eventos seguidos se saludan juntos, en un solo mensaje. Si la IA falla, no escribe nada.</p>
              </section>

              <section className="cab-mod grid gap-4" aria-labelledby="lux-replies">
                <h2 id="lux-replies" className="text-base font-semibold">
                  Respuestas
                </h2>
                <Range
                  label="Longitud máxima"
                  value={draft.replyMax}
                  min={60}
                  max={500}
                  step={10}
                  format={(value) => `${value} caracteres`}
                  onChange={(value) => update('replyMax', value)}
                />
                <Field label="Voz" htmlFor="lux-voice" hint="Las voces del catálogo. La que elijas es la que usa Lux al hablar en el overlay.">
                  <select
                    id="lux-voice"
                    className="cab-inp"
                    value={voiceValue(draft.voiceEngine, draft.voiceReferenceId)}
                    disabled={busy || saved === null || catalogue === null}
                    onChange={(e) => {
                      const chosen = parseVoice(e.target.value);
                      setSaveNote(null);
                      setDraft((current) => ({ ...current, voiceReferenceId: chosen.referenceId, voiceEngine: chosen.engine }));
                    }}
                  >
                    <option value="">
                      {catalogue ? `Por defecto: ${catalogue.voices.find((voice) => voice.isDefault)?.name ?? catalogue.voices[0]?.name ?? ''}` : 'Cargando voces…'}
                    </option>
                    {catalogue &&
                      draft.voiceReferenceId &&
                      !catalogue.voices.some(
                        (voice) => voiceValue(voice.provider ?? 'fish', voice.id) === voiceValue(draft.voiceEngine, draft.voiceReferenceId)
                      ) && (
                        <option value={voiceValue(draft.voiceEngine, draft.voiceReferenceId)}>
                          Voz guardada (no está en el catálogo ahora)
                        </option>
                      )}
                    {(catalogue?.voices ?? [])
                      .filter((voice) => voice.provider !== 'elevenlabs' || canUseEleven)
                      .map((voice) => (
                      <option key={voice.id} value={voiceValue(voice.provider ?? 'fish', voice.id)}>
                        {voice.name}
                        {voice.provider === 'elevenlabs' ? ' (ElevenLabs)' : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Idioma" htmlFor="lux-language">
                  <select
                    id="lux-language"
                    className="cab-inp"
                    value={draft.language}
                    disabled={busy || saved === null}
                    onChange={(e) => update('language', e.target.value as LuxSettingsView['language'])}
                  >
                    {LANGUAGES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Toggle
                  label="Recordar a los espectadores y a tu canal entre directos"
                  checked={draft.memoryEnabled}
                  disabled={busy || saved === null}
                  onChange={(next) => update('memoryEnabled', next)}
                />
                <Toggle
                  label="Lux aprende del chat"
                  checked={draft.chatLearning}
                  disabled={busy || saved === null}
                  onChange={(next) => update('chatLearning', next)}
                />
                <p className="cab-hint">
                  Apagado por defecto. Cada media hora Lux resume el chat y guarda algunos recuerdos (espectadores habituales, fechas, sucesos). Los mensajes no se guardan, y apagarlo no borra lo que ya aprendió.
                </p>
              </section>

              <section className="cab-mod grid gap-4" aria-labelledby="lux-overlay">
                <h2 id="lux-overlay" className="text-base font-semibold">
                  Personaje en OBS
                </h2>
                <Range
                  label="Tamaño en pantalla"
                  value={draft.obsSize}
                  min={10}
                  max={100}
                  step={5}
                  format={(value) => `${value}% de la altura`}
                  onChange={(value) => update('obsSize', value)}
                />
                <Range
                  label="Volumen de la voz"
                  value={draft.voiceVolume}
                  min={0}
                  max={100}
                  step={5}
                  format={(value) => `${value}%`}
                  onChange={(value) => update('voiceVolume', value)}
                />
                <Field label="Dirección para la fuente de navegador" htmlFor="lux-url" hint="Fondo transparente. Pégala en OBS como fuente de navegador.">
                  <div className="flex items-center gap-2">
                    <input id="lux-url" className="cab-inp flex-1" readOnly value={overlayUrl} onFocus={(e) => e.currentTarget.select()} />
                    <button type="button" className="cab-btn2 cab-btn-sm" onClick={copyUrl} aria-label="Copiar dirección">
                      {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
                      {copied ? 'Copiada' : 'Copiar'}
                    </button>
                  </div>
                </Field>
                <Range
                  label="Giro del personaje"
                  value={turn}
                  min={0}
                  max={355}
                  step={5}
                  format={(value) => `${value}°`}
                  onChange={(value) => setTurn(value)}
                />
                <div className="grid gap-2">
                  <span className="text-sm font-medium">Vista previa</span>
                  <div className="overflow-hidden rounded-lg border border-white/10 bg-[#15151d]">
                    <iframe title="Vista previa del personaje de Lux" src={previewUrl} className="block h-[280px] w-full border-0" />
                  </div>
                  <p className="cab-hint">
                    Así se verá en OBS, sin voz. Mueve el giro hasta que el personaje mire a la cámara y luego copia la dirección de arriba.
                  </p>
                </div>
              </section>

              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className="cab-btn2" disabled={busy || !dirty || !wordCheck.ok || !nameCheck.ok} onClick={save}>
                  Guardar ajustes
                </button>
                {dirty && <span className="cab-hint">Hay cambios sin guardar.</span>}
                {saveNote && (
                  <span className="cab-hint" role="status">
                    {saveNote}
                  </span>
                )}
                {saveError && (
                  <span className="cab-error" role="alert">
                    {saveError}
                  </span>
                )}
              </div>
            </div>

            <div className="grid gap-5">
              <section className="cab-mod grid gap-4" aria-labelledby="lux-test">
                <h2 id="lux-test" className="text-base font-semibold">
                  Probar a Lux
                </h2>
                <p className="cab-hint">Escribe como si fueras un espectador. La respuesta usa los ajustes guardados.</p>

                <div className="grid max-h-96 min-h-40 gap-2 overflow-y-auto" aria-live="polite">
                  {turns.length === 0 && <p className="cab-hint">Todavía no has hablado con Lux.</p>}
                  {turns.map((turn) => (
                    <div key={turn.id} className="grid gap-1">
                      <p className="text-sm">
                        <strong>{turn.viewer}:</strong> {turn.text}
                      </p>
                      {turn.reply && (
                        <p className="text-sm">
                          <strong>{aiName}{turn.emotion ? ` · ${turn.emotion}` : ''}:</strong> {turn.reply}
                        </p>
                      )}
                      {turn.error && (
                        <p className="cab-error" role="alert">
                          {turn.error}
                        </p>
                      )}
                    </div>
                  ))}
                  {busy && <p className="cab-hint">{aiName} está pensando…</p>}
                </div>

                <div className="grid gap-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <Toggle label="Hablar en OBS" checked={speakOverlay} disabled={busy} onChange={setSpeakOverlay} />
                    <button type="button" className="cab-btn2 cab-btn-sm" disabled={busy} onClick={listenOverlay}>
                      Escuchar la voz
                    </button>
                  </div>
                  <Field label="Nombre del espectador (opcional)" htmlFor="lux-viewer">
                    <input id="lux-viewer" className="cab-inp" maxLength={40} value={viewer} onChange={(e) => setViewer(e.target.value)} />
                  </Field>
                  <div className="flex items-center gap-2">
                    <input
                      id="lux-message"
                      className="cab-inp flex-1"
                      maxLength={500}
                      aria-label="Mensaje para Lux"
                      placeholder="Escribe un mensaje"
                      value={message}
                      disabled={busy}
                      onChange={(e) => setMessage(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') ask();
                      }}
                    />
                    <button type="button" className="cab-btn2 cab-btn-sm" disabled={busy || message.trim() === ''} onClick={ask}>
                      <Send size={16} aria-hidden />
                      Enviar
                    </button>
                  </div>
                </div>
              </section>

              <section className="cab-mod grid gap-4" aria-labelledby="lux-say">
                <h2 id="lux-say" className="text-base font-semibold">
                  Decir en el chat
                </h2>
                <p className="cab-hint">
                  El mensaje lo publica tu bot de Twitch, con el nombre {aiName}. Tiene que estar corriendo con el script de la versión {LUX_BOT_VERSION}.
                </p>
                <div className="cab-seg" role="group" aria-label="Cómo se escribe el mensaje">
                  <button type="button" aria-pressed={sayMode === 'literal'} onClick={() => setSayMode('literal')}>
                    Texto tal cual
                  </button>
                  <button type="button" aria-pressed={sayMode === 'ai'} onClick={() => setSayMode('ai')}>
                    Que la IA lo redacte
                  </button>
                </div>
                <Field
                  label={sayMode === 'ai' ? 'Idea para el mensaje' : 'Mensaje'}
                  htmlFor="lux-say-text"
                  hint={`${sayText.length} de ${sayMode === 'ai' ? SAY_IDEA_MAX : SAY_TEXT_MAX} caracteres`}
                >
                  <textarea
                    id="lux-say-text"
                    className="cab-inp min-h-20"
                    maxLength={sayMode === 'ai' ? SAY_IDEA_MAX : SAY_TEXT_MAX}
                    value={sayText}
                    disabled={sayBusy}
                    placeholder={sayMode === 'ai' ? 'Ejemplo: recuerda que mañana hay directo a las 8 y agradece el apoyo.' : 'Escribe lo que quieres que salga en el chat.'}
                    onChange={(e) => setSayText(e.target.value)}
                  />
                </Field>
                <Toggle label="También que se oiga en OBS" checked={sayAlsoObs} disabled={sayBusy} onChange={setSayAlsoObs} />
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" className="cab-btn2 cab-btn-sm" disabled={sayBusy || sayText.trim() === ''} onClick={say}>
                    <Send size={16} aria-hidden />
                    {sayMode === 'ai' ? 'Redactar y mandar a la cola' : 'Mandar a la cola'}
                  </button>
                  {sayBusy && <span className="cab-hint">{sayMode === 'ai' ? 'La IA está redactando…' : 'Enviando a la cola…'}</span>}
                  {sayError && (
                    <span className="cab-error" role="alert">
                      {sayError}
                    </span>
                  )}
                </div>
                {sayList && sayList.items.length > 0 && (
                  <ul className="grid gap-2 text-sm" aria-live="polite">
                    {sayList.items.slice(0, 5).map((item) => (
                      <li key={item.id} className="grid gap-0.5">
                        <span>{item.text}</span>
                        <span className={item.state === 'sent' ? 'cab-hint' : item.state === 'queued' || item.state === 'sending' ? 'cab-hint' : 'cab-error'}>
                          {SAY_STATE[item.state]}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {sayList && !sayList.botOnline && <p className="cab-hint">Ahora mismo el bot no ha dado señales de vida.</p>}
              </section>

              <section className="cab-mod grid gap-3" aria-labelledby="lux-checks">
                <h2 id="lux-checks" className="text-base font-semibold">
                  ¿Funciona?
                </h2>
                <ul className="grid gap-2 text-sm">
                  <li className="flex items-center gap-2">
                    <Check size={16} aria-hidden className={enabled ? 'text-emerald-400' : 'opacity-40'} />
                    Mi AI está activada para tu cuenta
                  </li>
                  <li className="flex items-center gap-2">
                    <Check size={16} aria-hidden className={saved !== null && !dirty ? 'text-emerald-400' : 'opacity-40'} />
                    Los ajustes están guardados
                  </li>
                  <li className="flex items-center gap-2">
                    <Check size={16} aria-hidden className={answered ? 'text-emerald-400' : 'opacity-40'} />
                    Lux ha respondido a una prueba
                  </li>
                </ul>
                <p className="cab-hint">
                  Si una prueba falla, el mensaje dice por qué: falta la clave del proveedor de IA, el modelo no responde o tu cuenta no tiene Mi AI.
                </p>
              </section>
            </div>
          </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
