/**
 * Dashboard.tsx
 *
 * Voz del chat sobre la plantilla común del panel: a la izquierda se edita, en
 * tres pestañas (Voz, Apariencia y Reglas); a la derecha el monitor 16:9 queda
 * siempre a la vista, con la alerta real, el mensaje de prueba y la URL de OBS.
 *
 * - La voz se elige en un solo sitio; el ID propio solo aparece si se pide.
 * - Hay una sola forma de probar: «Enviar al widget», que además repite la
 *   animación en el monitor.
 * - El canal se escribe en Inicio; aquí solo se muestra.
 * - Los cambios se guardan solos y se envían a los widgets abiertos.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check, Copy, Play, Upload } from 'lucide-react';
import { saveSettings } from '../types/settings';
import { useVoiceCatalogue } from '../hooks/useVoiceCatalogue';
import { useSettings } from '../hooks/useSettings';
import { useCloudSession } from '../hooks/useCloudSession';
import { postBus } from '../utils/bus';
import { buildSuiteWidgetUrl } from '../utils/widgetUrl';
import { SuiteNav } from '../components/SuiteNav';
import { sanitizeTwitchMessage } from '../utils/twitchSanitizer';
import { AVAILABLE_EMOTIONS, normalizeTextForFishAudio, EmotionInfo } from '../utils/emotionMapper';
import {
  ALERT_ENERGIES,
  ALERT_POSITIONS,
  ALERT_STYLES,
  AlertPosition,
  MAX_STICKER_BYTES,
  SCALE_MAX,
  SCALE_MIN,
  inkFor,
  normalizeAccent,
  stickerDataUri,
  validateStickerSvg,
} from '../utils/appearance';
import { playDemo } from '../utils/alertMotion';
import { AlertCard } from '../components/AlertCard';
import { GuidedTour, TourStep, isTourDone } from '../components/GuidedTour';
import { Field, Range, Toggle, UndoNote, useUndo } from '../components/studio/StudioKit';
import { RulesPanel } from '../components/voz/RulesPanel';
import { useRewardDetect } from '../components/voz/useRewardDetect';
import { readLastCopiedUrl, urlChangedSinceCopy, withEmotion, writeLastCopiedUrl } from '../components/voz/vozLogic';
import '../styles/voz-envivo.css';

const ACCENTS = [
  { color: '#9146ff', name: 'Morado' },
  { color: '#ff2d46', name: 'Rojo' },
  { color: '#53fc18', name: 'Verde' },
  { color: '#ff6b4a', name: 'Coral' },
  { color: '#22c7e0', name: 'Cian' },
  { color: '#ffb020', name: 'Ámbar' },
];

type Tab = 'voz' | 'apariencia' | 'reglas';

const TABS: { id: Tab; name: string }[] = [
  { id: 'voz', name: 'Voz' },
  { id: 'apariencia', name: 'Apariencia' },
  { id: 'reglas', name: 'Reglas' },
];

// Guía de primeros pasos: lo mínimo para llegar a oír el primer mensaje en el stream
const TOUR_STEPS: TourStep[] = [
  {
    title: 'Tu chat, leído en voz alta',
    body: (
      <>
        Esta capa lee en el stream los mensajes del chat que empiezan con <code>!s</code> y los muestra como una alerta animada. Son tres pasos y
        puedes usar el panel mientras tanto.
      </>
    ),
  },
  {
    target: 'voz-editor',
    title: 'Tres pestañas para ajustarla',
    body: 'En Voz eliges quién habla y a qué volumen. En Apariencia, cómo se ve la alerta. En Reglas, quién puede usarla, cuánto y cómo se activa.',
  },
  {
    target: 'voz-monitor',
    title: 'Prueba y copia la URL',
    body: 'El monitor muestra la alerta tal como saldrá. Escribe un mensaje y pulsa «Enviar al widget». «Copiar URL para OBS» te da la fuente de navegador; si después cambias algo que viaja en la URL, aquí mismo se te avisa.',
  },
  {
    target: 'nav',
    title: 'Durante el directo, En vivo',
    body: 'Ahí pausas la cola, saltas mensajes y apruebas o quitas los que esperan.',
  },
];

const DEFAULT_TEMPLATE = '{user} dice: {message}';

const STAGE_POSITION: Record<AlertPosition, string> = {
  tl: 'items-start justify-start',
  tc: 'items-start justify-center',
  tr: 'items-start justify-end',
  bl: 'items-end justify-start',
  bc: 'items-end justify-center',
  br: 'items-end justify-end',
};

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; name: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="cab-seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.id} type="button" aria-pressed={value === option.id} onClick={() => onChange(option.id)}>
          {option.name}
        </button>
      ))}
    </div>
  );
}

export const Dashboard: React.FC = () => {
  const { settings, update, saved } = useSettings();
  const cloud = useCloudSession();
  const uid = useId();
  const [tab, setTab] = useState<Tab>('voz');
  const [stickerError, setStickerError] = useState<string | null>(null);
  const [brightStage, setBrightStage] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const stickerUndo = useUndo<string>();
  const detect = useRewardDetect((rewardId) => update({ rewardId }));

  // La guía se abre sola la primera vez; después solo desde el botón de la cabecera
  useEffect(() => {
    if (isTourDone()) return;
    const timer = setTimeout(() => setTourOpen(true), 600);
    return () => clearTimeout(timer);
  }, []);

  // ---------- Voz ----------
  // El catálogo sale de la nube; sin ella, son las cinco voces de siempre. Si la voz guardada
  // era del catálogo y ya no está, se pasa a la voz por defecto y se avisa
  const voiceList = useVoiceCatalogue(settings.referenceId, (defaultId) => update({ referenceId: defaultId }));
  const voices = voiceList.catalogue.voices;
  const isPresetVoice = voices.some((voice) => voice.id === settings.referenceId);
  // Mientras llega el catálogo no se sabe si un id desconocido es propio o de una voz nueva
  const voiceUnknownYet = voiceList.loading && !isPresetVoice;
  // «Usar ID propio» es una elección del streamer aunque todavía no haya pegado ningún ID
  const [customChosen, setCustomChosen] = useState(false);
  const [customDraft, setCustomDraft] = useState(() => (isPresetVoice ? '' : settings.referenceId));
  const customVoice = customChosen || (!isPresetVoice && !voiceUnknownYet);
  const currentVoiceName = voices.find((voice) => voice.id === settings.referenceId)?.name;

  const chooseVoice = (value: string) => {
    if (value === 'custom') {
      setCustomChosen(true);
      return;
    }
    setCustomChosen(false);
    setCustomDraft('');
    update({ referenceId: value });
  };
  const typeCustomVoice = (value: string) => {
    const id = value.trim();
    setCustomDraft(id);
    // Un ID vacío dejaría al widget sin voz: se conserva la anterior hasta que haya uno
    if (id) update({ referenceId: id });
  };

  // ---------- Mensaje de prueba ----------
  const [testText, setTestText] = useState('!s [feliz] ¡Hola chat! Este es un mensaje con emoción');
  const [testUser, setTestUser] = useState('SuperViewer');
  const [testPreview, setTestPreview] = useState<string | null>(null);
  const [detectedEmotion, setDetectedEmotion] = useState<EmotionInfo | null>(null);

  const previewRef = useRef<HTMLDivElement | null>(null);
  const cancelDemoRef = useRef<(() => void) | null>(null);
  const stickerInputRef = useRef<HTMLInputElement | null>(null);

  // Previsualizar sanitización en tiempo real
  useEffect(() => {
    const raw = testText.trim().startsWith('!s ') ? testText : `!s ${testText}`;
    const res = sanitizeTwitchMessage(raw, { username: testUser });
    setTestPreview(res ? res.cleanText : null);
    setDetectedEmotion(res?.emotion || null);
  }, [testText, testUser]);

  const previewText = testPreview || 'Escribe un mensaje para verlo aquí.';
  const emotionTag = detectedEmotion?.tag || null;
  const emotionChoice = AVAILABLE_EMOTIONS.some((emo) => emo.tag === emotionTag) ? (emotionTag as string) : '';

  // Ciclo de animación del monitor: entrada, voz, salida y reposo
  const playPreview = useCallback(() => {
    const el = previewRef.current;
    if (!el) return;
    cancelDemoRef.current?.();
    const words = previewText.split(/\s+/).length;
    const seconds = Math.min(6, Math.max(2.4, words * 0.3)) / settings.speed;
    cancelDemoRef.current = playDemo(
      el,
      {
        style: settings.alertStyle,
        position: settings.position,
        energy: settings.energy,
        accent: settings.accent,
        emotion: emotionTag,
      },
      seconds
    );
  }, [previewText, emotionTag, settings.alertStyle, settings.position, settings.energy, settings.accent, settings.speed]);

  // Repetir la animación cuando cambia algo que afecta al movimiento
  useEffect(() => {
    const timer = setTimeout(playPreview, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.alertStyle, settings.position, settings.energy, emotionTag]);

  useEffect(() => () => cancelDemoRef.current?.(), []);

  // Disparar mensaje de prueba al widget sin recargar
  const triggerTestTTS = () => {
    saveSettings(settings);
    const raw = testText.trim().startsWith('!s ') ? testText : `!s ${testText}`;

    // 1. Enviar vía BroadcastChannel para que llegue a las pestañas del widget abiertas
    postBus({ type: 'SETTINGS_UPDATE', settings });
    postBus({ type: 'ENQUEUE', text: raw, user: testUser });

    // 2. Disparador en la misma ventana si está presente
    const win = window as unknown as { __LALO_TTS_TEST_TRIGGER__?: (text: string, user: string) => void };
    if (typeof win.__LALO_TTS_TEST_TRIGGER__ === 'function') {
      win.__LALO_TTS_TEST_TRIGGER__(raw, testUser);
    }
    playPreview();
  };

  const chooseEmotion = (tag: string) => {
    setTestText(withEmotion(testText, AVAILABLE_EMOTIONS.find((emo) => emo.tag === tag) || null));
  };

  // ---------- Sticker ----------
  const onStickerFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_STICKER_BYTES) {
      setStickerError(`El SVG pesa más de ${MAX_STICKER_BYTES / 1000} KB. Simplifícalo o expórtalo sin imágenes incrustadas.`);
      return;
    }
    const result = validateStickerSvg(await file.text());
    if (!result.ok) {
      setStickerError(result.error);
      return;
    }
    setStickerError(null);
    if (settings.stickerSvg) stickerUndo.offer('Se cambió el sticker.', settings.stickerSvg);
    update({ stickerSvg: result.svg });
  };

  const removeSticker = () => {
    setStickerError(null);
    stickerUndo.offer('Se quitó el sticker.', settings.stickerSvg);
    update({ stickerSvg: '' });
  };

  // ---------- URL de OBS ----------
  // Lleva canal, voz, sonido, apariencia y reglas (ver utils/widgetUrl.ts); con cuenta en la nube, también la clave del widget
  const widgetUrl = buildSuiteWidgetUrl(
    typeof window !== 'undefined' ? window.location.origin : '',
    'tts',
    settings.channel,
    settings,
    cloud.profile?.status === 'active' ? { k: cloud.profile.widget_key } : undefined
  );
  const [lastCopied, setLastCopied] = useState<string | null>(readLastCopiedUrl);
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'failed'>('idle');
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const urlChanged = urlChangedSinceCopy(widgetUrl, lastCopied);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    []
  );

  const copyWidgetUrl = async () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
    try {
      if (!navigator.clipboard) throw new Error('Portapapeles no disponible');
      await navigator.clipboard.writeText(widgetUrl);
      setLastCopied(widgetUrl);
      writeLastCopiedUrl(widgetUrl);
      setCopyState('done');
      copyTimer.current = setTimeout(() => setCopyState('idle'), 2200);
    } catch {
      setCopyState('failed');
    }
  };

  const template = settings.announceTemplate || DEFAULT_TEMPLATE;
  const announce = settings.announceSender !== false;
  const spokenExample =
    emotionTag === 'singing'
      ? `${testUser || 'Streamer'} canta. [singing] ${normalizeTextForFishAudio(previewText).replace(/^\[singing\]\s*/i, '')}`
      : announce
        ? template.replace('{user}', testUser || 'Streamer').replace('{message}', normalizeTextForFishAudio(previewText))
        : normalizeTextForFishAudio(previewText);
  const rootStyle = { '--acc': settings.accent, '--acc-ink': inkFor(settings.accent) } as React.CSSProperties;

  // Con la guía abierta se deja hueco abajo para que su consola no tape el último módulo
  return (
    <div className="cab" style={{ ...rootStyle, paddingBottom: tourOpen ? 220 : undefined }}>
      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-6">
        <SuiteNav
          currentApp="tts"
          channel={settings.channel}
          saved={saved}
          onOpenTour={() => setTourOpen(true)}
          tourAvailable={!tourOpen}
        />

        <div className="vz-layout">
          {/* ---------- Editor ---------- */}
          <section className="cab-mod" data-tour="voz-editor" aria-label="Ajustes de la voz del chat">
            <Segmented label="Sección de ajustes" value={tab} options={TABS} onChange={setTab} />

            {tab === 'voz' && (
              <>
                <Field
                  label="Voz"
                  htmlFor={`${uid}-voice`}
                  hint={
                    voiceList.replacedBy
                      ? `La voz que tenías ya no está en el catálogo. Ahora se usa ${voiceList.replacedBy}.`
                      : customVoice
                        ? undefined
                        : voices.find((voice) => voice.id === settings.referenceId)?.description
                  }
                >
                  <select
                    id={`${uid}-voice`}
                    value={customVoice ? 'custom' : settings.referenceId}
                    onChange={(e) => chooseVoice(e.target.value)}
                    className="cab-inp"
                  >
                    {voiceUnknownYet && <option value={settings.referenceId}>Leyendo el catálogo</option>}
                    {voices.map((voice) => (
                      <option key={voice.id} value={voice.id}>
                        {voice.name}
                      </option>
                    ))}
                    <option value="custom">Usar ID propio</option>
                  </select>
                </Field>

                {customVoice && (
                  <Field
                    label="ID de tu voz"
                    htmlFor={`${uid}-voice-id`}
                    hint={
                      customDraft
                        ? 'Es el ID de una voz tuya en Fish Audio.'
                        : `Pega aquí el ID de una voz tuya de Fish Audio. Hasta entonces se sigue usando ${currentVoiceName || 'la voz anterior'}.`
                    }
                  >
                    <input
                      id={`${uid}-voice-id`}
                      type="text"
                      value={customDraft}
                      onChange={(e) => typeCustomVoice(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      className="cab-inp cab-mono"
                    />
                  </Field>
                )}

                <Field label="Volumen">
                  <Range
                    label="Volumen"
                    min={0}
                    max={1}
                    step={0.05}
                    value={settings.volume}
                    format={(value) => `${Math.round(value * 100)} %`}
                    onChange={(volume) => update({ volume })}
                  />
                </Field>

                <div className="cab-field">
                  <Toggle label="Anunciar quién escribe" checked={announce} onChange={(announceSender) => update({ announceSender })} />
                  <span className="cab-hint">
                    {announce ? 'Antes del mensaje, la voz dice quién lo escribió.' : 'La voz lee solo el mensaje.'}
                  </span>
                </div>

                <details className="studio-details">
                  <summary>Avanzado</summary>
                  <div>
                    <Field label="Modelo" hint="Gratis no consume créditos. Pro gasta créditos de Fish Audio.">
                      <Segmented
                        label="Modelo"
                        value={settings.model === 's2.1-pro' ? 's2.1-pro' : 's2.1-pro-free'}
                        options={[
                          { id: 's2.1-pro-free', name: 'Gratis' },
                          { id: 's2.1-pro', name: 'Pro' },
                        ]}
                        onChange={(model) => update({ model })}
                      />
                    </Field>
                    <Field label="Velocidad">
                      <Range
                        label="Velocidad"
                        min={0.75}
                        max={1.5}
                        step={0.05}
                        value={settings.speed}
                        format={(value) => `${value.toFixed(2)}×`}
                        onChange={(speed) => update({ speed })}
                      />
                    </Field>
                    <Field
                      label="Frase del anuncio"
                      htmlFor={`${uid}-template`}
                      hint={
                        announce ? (
                          <>
                            Usa <span className="vz-code">{'{user}'}</span> para el nombre y <span className="vz-code">{'{message}'}</span> para el
                            mensaje.
                          </>
                        ) : (
                          'Activa «Anunciar quién escribe» para usarla.'
                        )
                      }
                    >
                      <input
                        id={`${uid}-template`}
                        type="text"
                        value={template}
                        disabled={!announce}
                        onChange={(e) => update({ announceTemplate: e.target.value })}
                        placeholder={DEFAULT_TEMPLATE}
                        autoComplete="off"
                        spellCheck={false}
                        className="cab-inp cab-mono"
                      />
                    </Field>
                  </div>
                </details>

                <details className="studio-details">
                  <summary>Emociones que puede escribir el chat</summary>
                  <div>
                    <p className="cab-hint max-w-[70ch]">
                      Van entre corchetes dentro del comando, por ejemplo <span className="vz-code">!s [susurro] no hagan ruido</span>. Cambian el
                      tono de la voz y el gesto con el que entra el texto.
                    </p>
                    <ul className="flex flex-wrap gap-x-5 gap-y-1">
                      {AVAILABLE_EMOTIONS.map((emo) => (
                        <li key={emo.tag} className="cab-hint">
                          <span className="vz-code">{emo.example}</span> {emo.label}
                        </li>
                      ))}
                    </ul>
                  </div>
                </details>
              </>
            )}

            {tab === 'apariencia' && (
              <>
                <Field label="Estilo de alerta">
                  <div className="cab-styles" role="group" aria-label="Estilo de alerta">
                    {ALERT_STYLES.map((style) => (
                      <button
                        key={style.id}
                        type="button"
                        className="cab-style"
                        aria-pressed={settings.alertStyle === style.id}
                        onClick={() => update({ alertStyle: style.id })}
                      >
                        <span className={`cab-style-face cab-face-${style.id}`}>
                          {style.id === 'cabina' && <i />}
                          {style.name}
                        </span>
                        <span className="cab-style-body">{style.description}</span>
                      </button>
                    ))}
                  </div>
                </Field>

                {settings.alertStyle === 'sticker' && (
                  <Field
                    label="Sticker del canal (SVG)"
                    hint={`Tu logo o mascota en SVG plano, hasta ${MAX_STICKER_BYTES / 1000} KB. Entra de golpe, se balancea mientras suena la voz y lleva borde de troquel.`}
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      {settings.stickerSvg && <img className="cab-sticker-thumb" src={stickerDataUri(settings.stickerSvg)} alt="Sticker actual" />}
                      <button type="button" className="cab-btn2" onClick={() => stickerInputRef.current?.click()}>
                        <Upload className="h-4 w-4" aria-hidden="true" />
                        <span>{settings.stickerSvg ? 'Cambiar SVG' : 'Subir SVG'}</span>
                      </button>
                      <input ref={stickerInputRef} type="file" accept=".svg,image/svg+xml" hidden tabIndex={-1} onChange={onStickerFile} />
                      {settings.stickerSvg && (
                        <button type="button" className="cab-btn2" onClick={removeSticker}>
                          Quitar
                        </button>
                      )}
                    </div>
                    {stickerError && (
                      <span className="cab-error" role="alert">
                        {stickerError}
                      </span>
                    )}
                    {!settings.stickerSvg && !stickerError && (
                      <span className="cab-hint">Sin SVG, el sticker muestra la inicial de quien escribe.</span>
                    )}
                    {stickerUndo.pending && (
                      <UndoNote
                        label={stickerUndo.pending.label}
                        onUndo={() => {
                          update({ stickerSvg: stickerUndo.pending?.snapshot ?? '' });
                          stickerUndo.clear();
                        }}
                      />
                    )}
                  </Field>
                )}

                <div className="grid gap-x-8 gap-y-[18px] sm:grid-cols-2">
                  <Field label="Color">
                    <div className="cab-sw" role="group" aria-label="Color">
                      {ACCENTS.map((accent) => (
                        <button
                          key={accent.color}
                          type="button"
                          aria-label={accent.name}
                          title={accent.name}
                          aria-pressed={settings.accent === accent.color}
                          style={{ backgroundColor: accent.color }}
                          onClick={() => update({ accent: accent.color })}
                        />
                      ))}
                      <input
                        type="color"
                        aria-label="Color personalizado"
                        title="Color personalizado"
                        value={settings.accent}
                        onChange={(e) => update({ accent: normalizeAccent(e.target.value) || settings.accent })}
                      />
                    </div>
                  </Field>

                  <Field label="Posición en pantalla">
                    <div className="cab-pos" role="group" aria-label="Posición en pantalla">
                      {ALERT_POSITIONS.map((position) => (
                        <button
                          key={position.id}
                          type="button"
                          aria-label={position.name}
                          title={position.name}
                          aria-pressed={settings.position === position.id}
                          onClick={() => update({ position: position.id })}
                        />
                      ))}
                    </div>
                    <span className="cab-hint">
                      Ahora: {ALERT_POSITIONS.find((position) => position.id === settings.position)?.name}
                    </span>
                  </Field>

                  <Field label="Tamaño">
                    <Range
                      label="Tamaño"
                      min={SCALE_MIN}
                      max={SCALE_MAX}
                      step={0.05}
                      value={settings.scale}
                      format={(value) => `${Math.round(value * 100)} %`}
                      onChange={(scale) => update({ scale })}
                    />
                  </Field>

                  <Field label="Energía del movimiento">
                    <Segmented label="Energía del movimiento" value={settings.energy} options={ALERT_ENERGIES} onChange={(energy) => update({ energy })} />
                  </Field>
                </div>
              </>
            )}

            {tab === 'reglas' && <RulesPanel settings={settings} update={update} detect={detect} />}
          </section>

          {/* ---------- Monitor ---------- */}
          <section className="cab-mod vz-monitor" data-tour="voz-monitor">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2>Monitor</h2>
              <button type="button" className="cab-btn2 cab-btn-sm" aria-pressed={brightStage} onClick={() => setBrightStage((value) => !value)}>
                Fondo claro
              </button>
            </div>

            <div className={`cab-stage ${STAGE_POSITION[settings.position]}`} data-bg={brightStage ? 'claro' : 'oscuro'}>
              <AlertCard
                ref={previewRef}
                alertStyle={settings.alertStyle}
                position={settings.position}
                accent={settings.accent}
                name={testUser || 'Usuario'}
                text={previewText}
                emotionLabel={detectedEmotion?.label}
                emotionTag={emotionTag}
                stickerSvg={settings.stickerSvg}
                fontSize={`calc(clamp(7px, 2.5cqw, 16px) * ${settings.scale})`}
              />
            </div>

            <div className="grid gap-[18px] sm:grid-cols-2">
              <Field label="Usuario" htmlFor={`${uid}-test-user`}>
                <input
                  id={`${uid}-test-user`}
                  type="text"
                  value={testUser}
                  onChange={(e) => setTestUser(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  className="cab-inp"
                />
              </Field>
              <Field label="Emoción" htmlFor={`${uid}-emotion`}>
                <select id={`${uid}-emotion`} className="cab-inp" value={emotionChoice} onChange={(e) => chooseEmotion(e.target.value)}>
                  <option value="">Sin emoción</option>
                  {AVAILABLE_EMOTIONS.map((emo) => (
                    <option key={emo.tag} value={emo.tag}>
                      {emo.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field
              label="Mensaje de prueba"
              htmlFor={`${uid}-test-text`}
              hint={testPreview ? <>Se oirá: «{spokenExample}»</> : 'Este mensaje no pasa el filtro: no se mostrará ni se leerá.'}
            >
              <textarea
                id={`${uid}-test-text`}
                rows={2}
                value={testText}
                onChange={(e) => setTestText(e.target.value)}
                placeholder="!s [feliz] mensaje de prueba"
                className="cab-inp cab-mono"
              />
            </Field>

            <div className="flex flex-wrap gap-2">
              <button type="button" className="cab-btn flex-1" onClick={triggerTestTTS} disabled={!testPreview}>
                <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                <span>Enviar al widget</span>
              </button>
              <button type="button" className="cab-btn2 flex-1" onClick={copyWidgetUrl}>
                {copyState === 'done' ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                <span>{copyState === 'done' ? 'URL copiada' : 'Copiar URL para OBS'}</span>
              </button>
            </div>

            {urlChanged && (
              <p className="cab-note" role="status">
                <span className="cab-chip" data-status="skipped">
                  La URL cambió
                </span>{' '}
                Has cambiado algo que viaja en la URL desde la última vez que la copiaste aquí. Vuelve a copiarla y pégala en la fuente de OBS.
              </p>
            )}
            {copyState === 'failed' && (
              <div className="cab-field">
                <span className="cab-error" role="alert">
                  El navegador no dejó copiar la URL. Selecciónala aquí y cópiala a mano.
                </span>
                <code className="cab-url cab-mono">{widgetUrl}</code>
              </div>
            )}

            <p className="cab-hint">
              «Enviar al widget» repite la animación aquí y la manda al widget que tengas abierto en este navegador.{' '}
              <a className="studio-link" href={widgetUrl} target="_blank" rel="noreferrer">
                Abrir widget
              </a>
            </p>
            {settings.channel.trim() ? (
              <p className="cab-hint">
                Canal: <span className="vz-code">twitch.tv/{settings.channel}</span>. Se cambia en{' '}
                <a className="studio-link" href="#dashboard">
                  Inicio
                </a>
                .
              </p>
            ) : (
              <p className="cab-note">
                Todavía no hay canal, así que el widget no sabe qué chat leer. Escríbelo en{' '}
                <a className="studio-link" href="#dashboard">
                  Inicio
                </a>
                .
              </p>
            )}

            <details className="studio-details">
              <summary>Cómo añadirlo a OBS</summary>
              <div>
                <ol className="grid max-w-[70ch] list-decimal gap-2 pl-5 text-[color:var(--cb-mut)]">
                  <li>En OBS, añade una fuente de tipo Navegador.</li>
                  <li>Pega la URL que copiaste.</li>
                  <li>Pon el ancho en 1920 y el alto en 1080, o el tamaño de tu lienzo.</li>
                  <li>Marca «Controlar audio a través de OBS» si quieres ver el volumen en el mezclador.</li>
                  <li>
                    La capa queda invisible hasta que alguien escribe <span className="vz-code">!s mensaje</span>.
                  </li>
                  <li>
                    Con el directo en marcha, recárgala con «Actualizar OBS» en la cabecera o con <span className="vz-code">!s reload</span> en el
                    chat.
                  </li>
                </ol>
              </div>
            </details>
          </section>
        </div>
      </div>
      {tourOpen && <GuidedTour steps={TOUR_STEPS} onClose={() => setTourOpen(false)} />}
    </div>
  );
};
