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
import { luxAsk, luxGetSettings, luxSaveSettings, type LuxSettingsView, type LuxVoice } from '../lib/luxApi';
import { loadVoiceCatalogue } from '../lib/voicesCloud';
import type { VoiceCatalogue } from '../lib/voicesLogic';
import '../styles/integraciones.css';

const DEFAULTS: LuxSettingsView = {
  personality: '',
  replyMax: 200,
  language: 'es',
  memoryEnabled: true,
  obsSize: 40,
  voiceReferenceId: null,
  voiceEngine: null,
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

/** Canal que escucha el overlay de Lux (public/lux/index.html). Mismo origen, mismo navegador. */
const LUX_BUS = 'lux_bus';

const voiceValue = (engine: string | null | undefined, id: string | null | undefined): string => (id ? `${engine ?? 'fish'}|${id}` : '');
const parseVoice = (value: string): { referenceId: string | null; engine: LuxSettingsView['voiceEngine'] } => {
  if (!value) return { referenceId: null, engine: null };
  const [engine, ...rest] = value.split('|');
  return { referenceId: rest.join('|'), engine: engine === 'elevenlabs' ? 'elevenlabs' : 'fish' };
};

const sameSettings = (a: LuxSettingsView, b: LuxSettingsView): boolean => JSON.stringify(a) === JSON.stringify(b);

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

  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState('');
  const [viewer, setViewer] = useState('');
  const [catalogue, setCatalogue] = useState<VoiceCatalogue | null>(null);
  const [speakOverlay, setSpeakOverlay] = useState(true);

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

  const dirty = saved !== null && !sameSettings(saved, draft);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  // La clave k es la de OBS del streamer (la misma de la pestaña Cuenta): el overlay la usa para el tope de voz.
  const keyPart = profile?.widget_key ? `&k=${encodeURIComponent(profile.widget_key)}` : '';
  // Canal de Twitch: el overlay lee el chat para el !lux y el !s. Una sola fuente de OBS para los dos.
  const channelPart = profile?.twitch_login ? `&channel=${encodeURIComponent(profile.twitch_login)}` : '';
  const overlayUrl = `${origin}/lux/index.html?overlay=1&size=${draft.obsSize}${keyPart}${channelPart}`;
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
    const res = await luxSaveSettings(draft);
    if (res.ok) {
      setSaved(res.data);
      setDraft(res.data);
      setSaveNote('Ajustes guardados.');
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
    sendToOverlay('Hola, soy Lux. Así suena mi voz.', 'feliz', voice, 'pride');
  };

  return (
    <div className="cab">
      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-6">
        <SuiteNav currentApp="lux" />

        {!enabled ? (
          <section className="cab-mod">
            <h2 className="text-base font-semibold">Lux no está activado para tu cuenta</h2>
            <p className="cab-hint">El administrador la activa desde Streamers. Cuando lo haga, aquí podrás configurarla.</p>
          </section>
        ) : (
          <div className="grid items-start gap-5 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <div className="grid gap-5">
              {loadError && (
                <p className="cab-error" role="alert">
                  No se pudieron leer tus ajustes: {loadError}
                </p>
              )}

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
                <Field label="Dirección para la fuente de navegador" htmlFor="lux-url" hint="Fondo transparente. Pégala en OBS como fuente de navegador.">
                  <div className="flex items-center gap-2">
                    <input id="lux-url" className="cab-inp flex-1" readOnly value={overlayUrl} onFocus={(e) => e.currentTarget.select()} />
                    <button type="button" className="cab-btn2 cab-btn-sm" onClick={copyUrl} aria-label="Copiar dirección">
                      {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
                      {copied ? 'Copiada' : 'Copiar'}
                    </button>
                  </div>
                </Field>
              </section>

              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className="cab-btn2" disabled={busy || !dirty} onClick={save}>
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
                          <strong>Lux{turn.emotion ? ` · ${turn.emotion}` : ''}:</strong> {turn.reply}
                        </p>
                      )}
                      {turn.error && (
                        <p className="cab-error" role="alert">
                          {turn.error}
                        </p>
                      )}
                    </div>
                  ))}
                  {busy && <p className="cab-hint">Lux está pensando…</p>}
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

              <section className="cab-mod grid gap-3" aria-labelledby="lux-checks">
                <h2 id="lux-checks" className="text-base font-semibold">
                  ¿Funciona?
                </h2>
                <ul className="grid gap-2 text-sm">
                  <li className="flex items-center gap-2">
                    <Check size={16} aria-hidden className={enabled ? 'text-emerald-400' : 'opacity-40'} />
                    Lux está activada para tu cuenta
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
                  Si una prueba falla, el mensaje dice por qué: falta la clave de NVIDIA, el modelo no responde o tu cuenta no tiene Lux.
                </p>
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
