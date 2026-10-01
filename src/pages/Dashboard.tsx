/**
 * Dashboard.tsx
 *
 * Panel de control del streamer en estilo Cabina: una mesa de mezclas que sigue
 * la señal del mensaje, de izquierda a derecha y de arriba abajo.
 *   1 Entrada (canal) · 2 Voz · 3 Mezcla · 4 Imagen (estilo de alerta) · 5 Salida (OBS)
 * El monitor muestra la alerta real con su movimiento y permite probar mensajes.
 * Los cambios se guardan solos y se envían a los widgets abiertos.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CircleHelp, Copy, ExternalLink, Play, RefreshCw, RotateCcw, Trash2, Upload } from 'lucide-react';
import { loadSettings, saveSettings, TTSSettings } from '../types/settings';
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
  encodeSticker,
  inkFor,
  normalizeAccent,
  stickerDataUri,
  validateStickerSvg,
} from '../utils/appearance';
import { playDemo } from '../utils/alertMotion';
import { AlertCard } from '../components/AlertCard';
import { GuidedTour, TourStep, isTourDone } from '../components/GuidedTour';

// Voces de referencia de muestra de Fish Audio (o custom reference_ids)
const PRESET_VOICES = [
  { id: '37f9f4eec7624089a49b188d47588f2c', name: 'Voz oficial clonada (LaloPlay)' },
  { id: '7f92f8afb8ec43bf81429cc1c9199cb1', name: 'Narrador dinámico' },
  { id: '9f5e2786a4104724a2efdc22b31f7cf6', name: 'Amigable y streamer' },
  { id: 'e1d2c3b4a5f607182930415263748596', name: 'Robot' },
];

const ACCENTS = [
  { color: '#9146ff', name: 'Morado' },
  { color: '#ff2d46', name: 'Rojo' },
  { color: '#53fc18', name: 'Verde' },
  { color: '#ff6b4a', name: 'Coral' },
  { color: '#22c7e0', name: 'Cian' },
  { color: '#ffb020', name: 'Ámbar' },
];

// Guía de primeros pasos: lo mínimo para llegar a oír el primer mensaje en el stream
const TOUR_STEPS: TourStep[] = [
  {
    title: 'Tu chat, leído en voz alta',
    body: (
      <>
        Lalo TTS lee en el stream los mensajes del chat que empiezan con <code>!s</code> y los muestra como una alerta animada. Te enseño lo esencial en
        cinco pasos; lleva menos de un minuto y puedes usar el panel mientras tanto.
      </>
    ),
  },
  {
    target: 'entrada',
    title: 'Escribe tu canal',
    body: 'Pon el nombre de tu canal de Twitch tal como aparece en la dirección. No hace falta iniciar sesión: el chat público se lee de forma anónima.',
  },
  {
    target: 'voz',
    title: 'Elige la voz',
    body: 'Escoge una voz de la lista o pega el ID de una voz tuya de Fish Audio. El modelo gratuito no consume créditos.',
  },
  {
    target: 'imagen',
    title: 'Decide cómo se ve la alerta',
    body: 'Hay cuatro estilos. Con Sticker puedes subir el SVG de tu canal. Debajo ajustas el color, el lugar de la pantalla, el tamaño y cuánta energía tiene el movimiento.',
  },
  {
    target: 'monitor',
    title: 'Pruébala antes de salir al aire',
    body: 'El monitor muestra la alerta tal como saldrá. Elige una emoción, escribe un mensaje y pulsa «Ver animación». «Enviar al widget» lo manda al overlay que tengas abierto.',
  },
  {
    target: 'salida',
    title: 'Llévala a OBS',
    body: 'Copia la URL y pégala en una fuente de tipo Navegador. La URL guarda tu estilo y tu sonido: si cambias algo después, vuelve a copiarla.',
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

function broadcast(message: Record<string, unknown>) {
  try {
    const bus = new BroadcastChannel('lalo_tts_bus');
    bus.postMessage(message);
    bus.close();
  } catch {
    // Ignorar si no está soportado
  }
}

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
  const [settings, setSettings] = useState<TTSSettings>(loadSettings);
  const [saved, setSaved] = useState(true);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [reloadingWidget, setReloadingWidget] = useState(false);
  const [stickerError, setStickerError] = useState<string | null>(null);
  const [brightStage, setBrightStage] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);

  // La guía se abre sola la primera vez; después solo desde el botón de la cabecera
  useEffect(() => {
    if (isTourDone()) return;
    const timer = setTimeout(() => setTourOpen(true), 600);
    return () => clearTimeout(timer);
  }, []);

  // Estados del banco de pruebas
  const [testText, setTestText] = useState('!s [feliz] ¡Hola chat! Este es un mensaje con emoción');
  const [testUser, setTestUser] = useState('SuperViewer');
  const [testPreview, setTestPreview] = useState<string | null>(null);
  const [detectedEmotion, setDetectedEmotion] = useState<EmotionInfo | null>(null);

  const previewRef = useRef<HTMLDivElement | null>(null);
  const cancelDemoRef = useRef<(() => void) | null>(null);

  const update = (patch: Partial<TTSSettings>) => {
    setSaved(false);
    setSettings((prev) => ({ ...prev, ...patch }));
  };

  // Guardado automático: persiste y avisa a los widgets abiertos en este navegador
  useEffect(() => {
    const timer = setTimeout(() => {
      saveSettings(settings);
      broadcast({ type: 'SETTINGS_UPDATE', settings });
      setSaved(true);
    }, 350);
    return () => clearTimeout(timer);
  }, [settings]);

  // URL del widget para OBS. La apariencia viaja en la URL porque el navegador
  // de OBS no comparte almacenamiento con este panel; el sticker va en el
  // fragmento (#) para que no llegue al servidor.
  const query = new URLSearchParams({
    channel: settings.channel,
    voice: settings.referenceId,
    model: settings.model || 's2.1-pro-free',
    announce: settings.announceSender !== false ? '1' : '0',
    vol: String(settings.volume),
    speed: String(settings.speed),
    style: settings.alertStyle,
    pos: settings.position,
    accent: settings.accent.slice(1),
    scale: String(settings.scale),
    energy: settings.energy,
  });
  const stickerHash =
    settings.alertStyle === 'sticker' && settings.stickerSvg ? `#?sticker=${encodeSticker(settings.stickerSvg)}` : '';
  const widgetUrl = `${window.location.origin}/widget?${query.toString()}${stickerHash}`;

  const copyWidgetUrl = () => {
    navigator.clipboard.writeText(widgetUrl).catch(() => {});
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2200);
  };

  // Forzar recarga remota del widget en OBS Studio sin interrumpir la transmisión
  const handleForceReloadWidget = () => {
    setReloadingWidget(true);
    broadcast({ type: 'FORCE_RELOAD' });
    setTimeout(() => setReloadingWidget(false), 2500);
  };

  // Previsualizar sanitización en tiempo real
  useEffect(() => {
    const raw = testText.trim().startsWith('!s ') ? testText : `!s ${testText}`;
    const res = sanitizeTwitchMessage(raw, { username: testUser });
    setTestPreview(res ? res.cleanText : null);
    setDetectedEmotion(res?.emotion || null);
  }, [testText, testUser]);

  const previewText = testPreview || 'Escribe un mensaje para verlo aquí.';
  const emotionTag = detectedEmotion?.tag || null;

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
    broadcast({ type: 'SETTINGS_UPDATE', settings });
    broadcast({ type: 'ENQUEUE', text: raw, user: testUser });

    // 2. Disparador en la misma ventana si está presente
    const win = window as unknown as { __LALO_TTS_TEST_TRIGGER__?: (text: string, user: string) => void };
    if (typeof win.__LALO_TTS_TEST_TRIGGER__ === 'function') {
      win.__LALO_TTS_TEST_TRIGGER__(raw, testUser);
    }
    playPreview();
  };

  const applyEmotion = (tag: string, example: string) => {
    const defaultMsg =
      tag === 'singing'
        ? 'Cumpleaños feliz, te deseamos a ti, que los cumplas muy feliz.'
        : '¡Esto es una prueba de voz con emoción en el stream!';
    const withoutTag = testText.replace(/^!s\s+/, '').replace(/^\[[^\]]+\]\s*/, '').trim();
    setTestText(`!s ${example} ${withoutTag || defaultMsg}`);
  };

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
    update({ stickerSvg: result.svg });
  };

  const template = settings.announceTemplate || DEFAULT_TEMPLATE;
  const spokenExample =
    emotionTag === 'singing'
      ? `${testUser || 'Streamer'} canta. [singing] ${normalizeTextForFishAudio(previewText).replace(/^\[singing\]\s*/i, '')}`
      : settings.announceSender !== false
        ? template.replace('{user}', testUser || 'Streamer').replace('{message}', normalizeTextForFishAudio(previewText))
        : normalizeTextForFishAudio(previewText);
  const isPresetVoice = PRESET_VOICES.some((voice) => voice.id === settings.referenceId);
  const rootStyle = { '--acc': settings.accent, '--acc-ink': inkFor(settings.accent) } as React.CSSProperties;

  // Con la guía abierta se deja hueco abajo para que su consola no tape el último módulo
  return (
    <div className="cab" style={{ ...rootStyle, paddingBottom: tourOpen ? 220 : undefined }}>
      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-6">
        {/* Barra de estado */}
        <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-[#3f4148] pb-4">
          <h1 className="cab-caps text-2xl" style={{ fontStretch: '70%', fontWeight: 800 }}>
            Lalo TTS
          </h1>
          <span className="cab-caps text-[13px] text-[#aba698]">
            Canal <b className="text-[#efe9dc]">{settings.channel || 'sin canal'}</b>
          </span>
          <span className="cab-caps text-[13px] text-[#aba698]">
            Estilo <b className="text-[#efe9dc]">{ALERT_STYLES.find((s) => s.id === settings.alertStyle)?.name}</b>
          </span>
          <span className="cab-caps ml-auto text-[13px] text-[#aba698]" role="status">
            {saved ? 'Cambios guardados' : 'Guardando'}
          </span>
          <button type="button" className="cab-btn2" onClick={() => setTourOpen(true)} disabled={tourOpen}>
            <CircleHelp className="h-4 w-4" aria-hidden="true" />
            Guía
          </button>
        </header>

        {/* 1 Entrada · 2 Voz · 3 Mezcla */}
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          <section className="cab-mod" data-tour="entrada">
            <h2>
              <span>1</span>Entrada
            </h2>
            <Field
              label="Canal de Twitch"
              htmlFor="channel"
              hint={
                <>
                  Se conecta de forma anónima al chat público y solo lee los mensajes que empiezan con{' '}
                  <code className="cab-mono text-[#efe9dc]">!s</code>.
                </>
              }
            >
              <div className="relative">
                <span className="cab-mono pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#aba698]">twitch.tv/</span>
                <input
                  id="channel"
                  type="text"
                  value={settings.channel}
                  onChange={(e) => update({ channel: e.target.value.toLowerCase().trim() })}
                  placeholder="tu_canal"
                  autoComplete="off"
                  spellCheck={false}
                  className="cab-inp cab-mono"
                  style={{ paddingLeft: 92 }}
                />
              </div>
            </Field>
          </section>

          <section className="cab-mod" data-tour="voz">
            <h2>
              <span>2</span>Voz
            </h2>
            <Field label="Voz" htmlFor="voice">
              <select
                id="voice"
                value={isPresetVoice ? settings.referenceId : 'custom'}
                onChange={(e) => {
                  if (e.target.value !== 'custom') update({ referenceId: e.target.value });
                }}
                className="cab-inp"
              >
                {PRESET_VOICES.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.name}
                  </option>
                ))}
                <option value="custom">Usar un ID propio</option>
              </select>
            </Field>
            <Field label="ID de voz (reference_id)" htmlFor="referenceId" hint="Pega aquí el ID de una voz propia de Fish Audio.">
              <input
                id="referenceId"
                type="text"
                value={settings.referenceId}
                onChange={(e) => update({ referenceId: e.target.value.trim() })}
                autoComplete="off"
                spellCheck={false}
                className="cab-inp cab-mono"
              />
            </Field>
            <Field
              label="Modelo"
              hint={
                <>
                  El gratuito no consume créditos. La clave de Fish Audio vive en el servidor (
                  <code className="cab-mono">FISH_AUDIO_API_KEY</code>); sin ella el widget usa el modo simulación.{' '}
                  <a href="https://fish.audio" target="_blank" rel="noreferrer" className="underline underline-offset-2 text-[#efe9dc]">
                    Obtener clave
                  </a>
                </>
              }
            >
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
          </section>

          <section className="cab-mod md:col-span-2 xl:col-span-1">
            <h2>
              <span>3</span>Mezcla
            </h2>
            <Field label="Volumen" htmlFor="volume">
              <div className="cab-range">
                <input
                  id="volume"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={settings.volume}
                  onChange={(e) => update({ volume: parseFloat(e.target.value) })}
                />
                <output htmlFor="volume">{Math.round(settings.volume * 100)} %</output>
              </div>
            </Field>
            <Field label="Velocidad" htmlFor="speed">
              <div className="cab-range">
                <input
                  id="speed"
                  type="range"
                  min="0.75"
                  max="1.5"
                  step="0.05"
                  value={settings.speed}
                  onChange={(e) => update({ speed: parseFloat(e.target.value) })}
                />
                <output htmlFor="speed">{settings.speed.toFixed(2)}×</output>
              </div>
            </Field>
            <Field
              label="Anunciar quién escribe"
              htmlFor="announce"
              hint={
                settings.announceSender !== false ? (
                  <>
                    Usa <code className="cab-mono">{'{user}'}</code> y <code className="cab-mono">{'{message}'}</code>.
                  </>
                ) : (
                  'La voz leerá solo el mensaje.'
                )
              }
            >
              <div className="flex items-center gap-3">
                <input
                  id="announce"
                  type="checkbox"
                  className="cab-tog"
                  checked={settings.announceSender !== false}
                  onChange={(e) => update({ announceSender: e.target.checked })}
                />
                <input
                  type="text"
                  aria-label="Formato del anuncio"
                  value={template}
                  disabled={settings.announceSender === false}
                  onChange={(e) => update({ announceTemplate: e.target.value })}
                  placeholder={DEFAULT_TEMPLATE}
                  autoComplete="off"
                  spellCheck={false}
                  className="cab-inp cab-mono"
                />
              </div>
            </Field>
          </section>
        </div>

        {/* 4 Imagen · Monitor */}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
          <section className="cab-mod" data-tour="imagen">
            <h2>
              <span>4</span>Imagen
            </h2>

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
                    <span className="cab-style-body">
                      <b>{style.name}</b>
                      {style.description}
                    </span>
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
                  <label className="cab-btn2" htmlFor="stickerFile">
                    <Upload className="h-4 w-4" aria-hidden="true" />
                    {settings.stickerSvg ? 'Cambiar SVG' : 'Subir SVG'}
                  </label>
                  <input id="stickerFile" type="file" accept=".svg,image/svg+xml" className="sr-only" onChange={onStickerFile} />
                  {settings.stickerSvg && (
                    <button
                      type="button"
                      className="cab-btn2"
                      onClick={() => {
                        setStickerError(null);
                        update({ stickerSvg: '' });
                      }}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
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
              </Field>
            )}

            <div className="grid gap-x-8 gap-y-[18px] sm:grid-cols-2">
              <Field label="Color de acento">
                <div className="cab-sw" role="group" aria-label="Color de acento">
                  {ACCENTS.map((accent) => (
                    <button
                      key={accent.color}
                      type="button"
                      aria-label={accent.name}
                      aria-pressed={settings.accent === accent.color}
                      style={{ backgroundColor: accent.color }}
                      onClick={() => update({ accent: accent.color })}
                    />
                  ))}
                  <input
                    type="color"
                    aria-label="Color personalizado"
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
                      aria-pressed={settings.position === position.id}
                      onClick={() => update({ position: position.id })}
                    />
                  ))}
                </div>
              </Field>

              <Field label="Tamaño" htmlFor="scale">
                <div className="cab-range">
                  <input
                    id="scale"
                    type="range"
                    min={SCALE_MIN}
                    max={SCALE_MAX}
                    step="0.05"
                    value={settings.scale}
                    onChange={(e) => update({ scale: parseFloat(e.target.value) })}
                  />
                  <output htmlFor="scale">{Math.round(settings.scale * 100)} %</output>
                </div>
              </Field>

              <Field label="Energía del movimiento">
                <Segmented label="Energía del movimiento" value={settings.energy} options={ALERT_ENERGIES} onChange={(energy) => update({ energy })} />
              </Field>
            </div>
          </section>

          <section className="cab-mod" data-tour="monitor">
            <h2>Monitor</h2>

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
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="cab-btn2" onClick={playPreview}>
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Ver animación
              </button>
              <button type="button" className="cab-btn2" aria-pressed={brightStage} onClick={() => setBrightStage((v) => !v)}>
                {brightStage ? 'Fondo oscuro' : 'Fondo claro'}
              </button>
            </div>

            <Field label="Emoción">
              <div className="cab-seg" role="group" aria-label="Emoción">
                {AVAILABLE_EMOTIONS.map((emo) => (
                  <button key={emo.tag} type="button" aria-pressed={emotionTag === emo.tag} onClick={() => applyEmotion(emo.tag, emo.example)}>
                    {emo.label}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid gap-[18px] sm:grid-cols-[minmax(0,150px)_minmax(0,1fr)]">
              <Field label="Usuario" htmlFor="testUser">
                <input
                  id="testUser"
                  type="text"
                  value={testUser}
                  onChange={(e) => setTestUser(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  className="cab-inp"
                />
              </Field>
              <Field label="Mensaje del chat" htmlFor="testText">
                <textarea
                  id="testText"
                  rows={2}
                  value={testText}
                  onChange={(e) => setTestText(e.target.value)}
                  placeholder="!s [feliz] mensaje de prueba"
                  className="cab-inp cab-mono"
                />
              </Field>
            </div>
            <p className="cab-hint">
              {testPreview ? <>Se oirá: «{spokenExample}»</> : 'El filtro descarta este mensaje: no se mostrará ni se leerá.'}
            </p>
            <button type="button" className="cab-btn" onClick={triggerTestTTS} disabled={!testPreview}>
              <Play className="h-4 w-4 fill-current" aria-hidden="true" />
              Enviar al widget
            </button>
          </section>
        </div>

        {/* 5 Salida */}
        <section className="cab-mod" data-tour="salida">
          <h2>
            <span>5</span>Salida
          </h2>
          <Field
            label="URL para OBS"
            hint="La URL lleva el estilo, el color, la posición y el sonido. Si cambias algo aquí con el directo en marcha, vuelve a copiarla en la fuente de OBS."
          >
            <code className="cab-url cab-mono">{widgetUrl}</code>
          </Field>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="cab-btn" onClick={copyWidgetUrl}>
              {copiedUrl ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
              {copiedUrl ? 'URL copiada' : 'Copiar URL'}
            </button>
            <button type="button" className="cab-btn2" onClick={handleForceReloadWidget} disabled={reloadingWidget}>
              <RefreshCw className={`h-4 w-4 ${reloadingWidget ? 'animate-spin' : ''}`} aria-hidden="true" />
              {reloadingWidget ? 'Recarga enviada' : 'Actualizar OBS'}
            </button>
            <a className="cab-btn2" href={widgetUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Abrir widget
            </a>
          </div>

          <details>
            <summary>Cómo añadirlo a OBS Studio</summary>
            <ol className="mt-3 grid max-w-[70ch] list-decimal gap-2 pl-5 text-[#aba698]">
              <li>En OBS, añade una fuente de tipo Navegador.</li>
              <li>Pega la URL de arriba.</li>
              <li>Pon el ancho en 1920 y el alto en 1080, o el tamaño de tu lienzo.</li>
              <li>Marca «Controlar audio a través de OBS» si quieres ver el volumen en el mezclador.</li>
              <li>
                El overlay queda invisible hasta que alguien escribe <code className="cab-mono text-[#efe9dc]">!s mensaje</code>.
              </li>
              <li>
                Con el directo en marcha, recarga el overlay con «Actualizar OBS», con{' '}
                <code className="cab-mono text-[#efe9dc]">!s reload</code> en el chat, o con clic derecho en la fuente y «Actualizar».
              </li>
            </ol>
          </details>
          <details>
            <summary>Emociones que puede escribir el chat</summary>
            <p className="cab-hint mt-3 max-w-[70ch]">
              Van entre corchetes dentro del comando, por ejemplo <code className="cab-mono text-[#efe9dc]">!s [susurro] no hagan ruido</code>. Cambian el tono
              de la voz y el gesto con el que entra el texto.
            </p>
            <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
              {AVAILABLE_EMOTIONS.map((emo) => (
                <li key={emo.tag}>
                  <code className="cab-mono text-[#efe9dc]">{emo.example}</code> <span className="text-[#aba698]">{emo.label}</span>
                </li>
              ))}
            </ul>
          </details>
        </section>
      </div>
      {tourOpen && <GuidedTour steps={TOUR_STEPS} onClose={() => setTourOpen(false)} />}
    </div>
  );
};
