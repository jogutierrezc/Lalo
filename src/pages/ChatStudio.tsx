/**
 * src/pages/ChatStudio.tsx
 *
 * Estudio de la capa «Chat en vivo» sobre la plantilla común del panel: a la
 * izquierda se ajusta, a la derecha el monitor 16:9 queda siempre a la vista
 * con un chat simulado.
 *
 * - La plantilla, el movimiento y la colocación se ven al momento en el monitor.
 * - Bajo el monitor hay un botón por cada clase de mensaje y otro para borrar
 *   el último, como haría un moderador.
 * - La marca «VOZ» del chat simulado sale de las reglas reales de Voz del chat.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { SuiteNav } from '../components/SuiteNav';
import { Field, Range, Toggle } from '../components/studio/StudioKit';
import { GuidedTour, TourStep, isTourDone } from '../components/GuidedTour';
import { ChatOverlayHandle, ChatOverlayView } from '../components/chat/ChatOverlayView';
import { useChatSettings } from '../hooks/useChatSettings';
import { useCloudSession } from '../hooks/useCloudSession';
import {
  CHAT_ENERGIES,
  CHAT_FONTS,
  CHAT_LIMITS,
  CHAT_MOTIONS,
  CHAT_SIGNATURE,
  CHAT_TEMPLATES,
  ChatFont,
  encodeChatSettings,
} from '../types/chat';
import { loadSettings } from '../types/settings';
import { VOICE_MODES, classifyTrigger } from '../utils/moderation';
import { DEMO_SEQUENCE, DemoKind, demoMessage } from '../utils/chatFeed';
import { buildSuiteWidgetUrl } from '../utils/widgetUrl';
import '../styles/chat.css';

const TOUR_ID = 'chat';

const CHAT_TOUR_STEPS: TourStep[] = [
  {
    badge: 'Bienvenida',
    title: 'Chat en vivo',
    body: 'Aquí decides cómo se ve el chat de tu canal sobre el directo. No hace falta ningún permiso nuevo de Twitch.',
  },
  {
    target: 'chat-template',
    badge: 'Plantilla',
    title: 'Elige el aspecto',
    body: 'Cinco plantillas listas y una personalizada, en la que cambias tipografía, colores, opacidad y redondeo.',
  },
  {
    target: 'chat-motion',
    badge: 'Movimiento',
    title: 'Cómo entran y salen los mensajes',
    body: 'Cada plantilla trae su propio movimiento. Puedes dejarlo, elegir uno genérico y subir o bajar la intensidad.',
  },
  {
    target: 'chat-monitor',
    badge: 'Monitor',
    title: 'Prueba y copia la URL',
    body: 'Envía cada clase de mensaje al chat de prueba, borra uno como haría un moderador y copia la URL para OBS.',
  },
];

const SAMPLES: { kind: DemoKind; label: string }[] = [
  { kind: 'normal', label: 'Mensaje normal' },
  { kind: 'command', label: 'Con comando de voz' },
  { kind: 'sub', label: 'De un suscriptor' },
  { kind: 'bits', label: 'Con bits' },
  { kind: 'emotes', label: 'Solo emotes' },
  { kind: 'first', label: 'Primer mensaje' },
  { kind: 'effect', label: 'Con efecto de mensaje' },
  { kind: 'giant', label: 'Con emote gigante' },
];

export const ChatStudio: React.FC = () => {
  const { chatSettings, saved, updateSettings, updateCustom } = useChatSettings();
  const cloud = useCloudSession();
  const uid = useId();

  const [tourOpen, setTourOpen] = useState(false);
  const [auto, setAuto] = useState(true);
  const [copied, setCopied] = useState<'url' | 'demo' | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const chatRef = useRef<ChatOverlayHandle | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const burstTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Las reglas de voz se leen una vez al abrir: deciden qué mensajes llevan la marca «VOZ»
  const [voice] = useState(loadSettings);
  const voiceModeName = VOICE_MODES.find((mode) => mode.id === voice.voiceMode)?.name || 'Con comando';

  // La guía se abre sola la primera vez
  useEffect(() => {
    if (isTourDone(TOUR_ID)) return;
    const timer = setTimeout(() => setTourOpen(true), 600);
    return () => clearTimeout(timer);
  }, []);

  useEffect(
    () => () => {
      if (statusTimer.current) clearTimeout(statusTimer.current);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      burstTimers.current.forEach(clearTimeout);
    },
    []
  );

  const say = (message: string) => {
    setStatus(message);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(null), 4000);
  };

  // ---------- Chat simulado ----------
  const send = useCallback(
    (kind: DemoKind) => {
      const message = demoMessage(kind, voice.voiceCommand);
      const wouldRead =
        classifyTrigger(voice, message.text, {
          username: message.username,
          bits: message.bits || undefined,
          'msg-id': message.highlighted ? 'highlighted-message' : undefined,
          'emote-only': message.emoteOnly,
        }) !== null;
      chatRef.current?.push({ ...message, voice: wouldRead });
    },
    [voice]
  );

  // Chat automático: solo con el monitor a la vista y la pestaña activa
  useEffect(() => {
    if (!auto) return;
    let visible = true;
    let step = 0;
    const stage = stageRef.current;
    const observer =
      stage && 'IntersectionObserver' in window
        ? new IntersectionObserver((entries) => {
            visible = entries[0]?.isIntersecting ?? true;
          })
        : null;
    if (stage) observer?.observe(stage);
    const next = () => {
      if (!visible || document.hidden) return;
      send(DEMO_SEQUENCE[step % DEMO_SEQUENCE.length]);
      step += 1;
    };
    const first = [0, 400, 800].map((wait) => setTimeout(next, wait));
    const timer = setInterval(next, 2200);
    return () => {
      first.forEach(clearTimeout);
      clearInterval(timer);
      observer?.disconnect();
    };
  }, [auto, send]);

  const removeLast = () => {
    const removed = chatRef.current?.removeLast();
    say(removed ? 'Mensaje borrado: se tacha, se queda un momento y sale.' : 'No hay mensajes que borrar.');
  };

  const burst = () => {
    burstTimers.current.forEach(clearTimeout);
    burstTimers.current = Array.from({ length: 20 }, (_, i) => setTimeout(() => send(i % 7 === 3 ? 'emotes' : 'normal'), i * 50));
    say('Veinte mensajes en un segundo: la pila se mueve de una vez y los más antiguos se quitan sin animar.');
  };

  // ---------- URL de OBS ----------
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const copyUrl = (withDemo: boolean) => {
    const tts = loadSettings();
    // Con cuenta va la clave y, de reserva, los ajustes: si la nube no responde, la fuente usa los de la URL
    const extra: Record<string, string> = {
      ...(cloud.profile?.status === 'active' ? { k: cloud.profile.widget_key } : {}),
      cs: encodeChatSettings(chatSettings),
    };
    if (withDemo) extra.demo = '1';
    const url = buildSuiteWidgetUrl(baseUrl, 'chat', tts.channel, tts, extra);
    navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopied(withDemo ? 'demo' : 'url');
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopied(null), 2200);
      })
      .catch(() => say('No se pudo copiar. Usa «Fuentes de OBS» en la cabecera.'));
  };

  const template = CHAT_TEMPLATES.find((item) => item.id === chatSettings.template) || CHAT_TEMPLATES[0];
  const custom = chatSettings.custom;
  const channel = voice.channel;

  return (
    <div className="cab" style={{ paddingBottom: tourOpen ? 220 : undefined }}>
      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-6">
        <SuiteNav currentApp="chat" channel={channel} saved={saved} onOpenTour={() => setTourOpen(true)} tourAvailable={!tourOpen} />

        <div className="grid items-start gap-5 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <div className="grid gap-5">
            {/* ---------- Plantilla ---------- */}
            <section className="cab-mod" data-tour="chat-template">
              <h2>Plantilla</h2>
              <div className="cab-field">
                <div className="cab-seg" role="group" aria-label="Plantilla del chat">
                  {CHAT_TEMPLATES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={chatSettings.template === item.id}
                      onClick={() => updateSettings({ template: item.id })}
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
                <span className="cab-hint">{template.hint}</span>
              </div>

              {chatSettings.template === 'custom' && (
                <>
                  <Field label="Tipografía" htmlFor={`${uid}-font`}>
                    <select
                      id={`${uid}-font`}
                      className="cab-inp"
                      value={custom.font}
                      onChange={(e) => updateCustom({ font: e.target.value as ChatFont })}
                    >
                      {CHAT_FONTS.map((font) => (
                        <option key={font.id} value={font.id}>
                          {font.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="chat-colors">
                    {(
                      [
                        ['bg', 'Fondo del mensaje'],
                        ['fg', 'Color del texto'],
                        ['accent', 'Color de destacados'],
                      ] as const
                    ).map(([key, label]) => (
                      <div key={key} className="chat-color">
                        <input
                          id={`${uid}-${key}`}
                          type="color"
                          className="studio-color"
                          value={custom[key]}
                          onChange={(e) => updateCustom({ [key]: e.target.value })}
                        />
                        <label htmlFor={`${uid}-${key}`}>{label}</label>
                      </div>
                    ))}
                  </div>
                  <div className="grid gap-x-8 gap-y-[18px] sm:grid-cols-2">
                    <Field label="Opacidad del fondo">
                      <Range
                        label="Opacidad del fondo"
                        min={0}
                        max={1}
                        step={0.02}
                        value={custom.opacity}
                        format={(value) => `${Math.round(value * 100)}%`}
                        onChange={(opacity) => updateCustom({ opacity })}
                      />
                    </Field>
                    <Field label="Redondeo">
                      <Range
                        label="Redondeo de las esquinas"
                        min={CHAT_LIMITS.radius.min}
                        max={CHAT_LIMITS.radius.max}
                        step={0.1}
                        value={custom.radius}
                        format={(value) => value.toFixed(1)}
                        onChange={(radius) => updateCustom({ radius })}
                      />
                    </Field>
                  </div>
                  <p className="cab-hint">
                    Si un espectador usa un color de nombre que no se lee sobre tu fondo, la capa lo aclara u oscurece
                    sola.
                  </p>
                </>
              )}
            </section>

            {/* ---------- Movimiento ---------- */}
            <section className="cab-mod" data-tour="chat-motion">
              <h2>Movimiento</h2>
              <Field
                label="Cómo entra, hace sitio y sale cada mensaje"
                hint={
                  chatSettings.motion === 'propio'
                    ? `${template.name}: ${CHAT_SIGNATURE[chatSettings.template]}`
                    : 'Un movimiento genérico, igual en todas las plantillas. Los destacados conservan el trato de la plantilla.'
                }
              >
                <div className="cab-seg" role="group" aria-label="Movimiento de los mensajes">
                  {CHAT_MOTIONS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={chatSettings.motion === item.id}
                      onClick={() => {
                        updateSettings({ motion: item.id });
                        send('normal');
                      }}
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Intensidad" hint="Cambia cuánto se mueve y cuánto dura. Con «Calma» no hay rebotes.">
                <div className="cab-seg" role="group" aria-label="Intensidad del movimiento">
                  {CHAT_ENERGIES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={chatSettings.energy === item.id}
                      onClick={() => {
                        updateSettings({ energy: item.id });
                        send('normal');
                      }}
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
              </Field>
              <p className="cab-hint">
                Si el sistema pide reducir el movimiento, los mensajes solo aparecen y desaparecen, sin desplazarse.
              </p>
            </section>

            {/* ---------- Colocación ---------- */}
            <section className="cab-mod">
              <h2>Colocación</h2>
              <Field label="Lado de la pantalla">
                <div className="cab-seg" role="group" aria-label="Lado de la pantalla">
                  <button type="button" aria-pressed={chatSettings.side === 'l'} onClick={() => updateSettings({ side: 'l' })}>
                    Izquierda
                  </button>
                  <button type="button" aria-pressed={chatSettings.side === 'r'} onClick={() => updateSettings({ side: 'r' })}>
                    Derecha
                  </button>
                </div>
              </Field>
              <div className="grid gap-x-8 gap-y-[18px] sm:grid-cols-2">
                <Field label="Tamaño del texto">
                  <Range
                    label="Tamaño del texto"
                    min={CHAT_LIMITS.size.min}
                    max={CHAT_LIMITS.size.max}
                    step={0.05}
                    value={chatSettings.size}
                    format={(value) => `${Math.round(value * 100)}%`}
                    onChange={(size) => updateSettings({ size })}
                  />
                </Field>
                <Field label="Ancho de la columna">
                  <Range
                    label="Ancho de la columna"
                    min={CHAT_LIMITS.width.min}
                    max={CHAT_LIMITS.width.max}
                    value={chatSettings.width}
                    format={(value) => String(value)}
                    onChange={(width) => updateSettings({ width })}
                  />
                </Field>
                <Field label="Mensajes a la vez">
                  <Range
                    label="Mensajes a la vez"
                    min={CHAT_LIMITS.maxMessages.min}
                    max={CHAT_LIMITS.maxMessages.max}
                    value={chatSettings.maxMessages}
                    format={(value) => String(value)}
                    onChange={(maxMessages) => updateSettings({ maxMessages })}
                  />
                </Field>
                <Field label="Tiempo en pantalla" hint="Con 0, cada mensaje se queda hasta que lo empuja otro.">
                  <Range
                    label="Segundos en pantalla"
                    min={CHAT_LIMITS.seconds.min}
                    max={CHAT_LIMITS.seconds.max}
                    value={chatSettings.seconds}
                    format={(value) => (value ? `${value} s` : 'Sin límite')}
                    onChange={(seconds) => updateSettings({ seconds })}
                  />
                </Field>
              </div>
              <p className="cab-hint">
                En el monitor el texto se ve algo más grande que en OBS, para poder leerlo a este tamaño.
              </p>
            </section>

            {/* ---------- Qué se ve ---------- */}
            <section className="cab-mod">
              <h2>Qué se ve</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <Toggle label="Insignias (CANAL, MOD, VIP, SUB)" checked={chatSettings.badges} onChange={(badges) => updateSettings({ badges })} />
                <Toggle
                  label="Franja en mensajes de suscriptores"
                  checked={chatSettings.highlightSubs}
                  onChange={(highlightSubs) => updateSettings({ highlightSubs })}
                />
                <Toggle
                  label="Mensajes con bits en color lleno"
                  checked={chatSettings.highlightBits}
                  onChange={(highlightBits) => updateSettings({ highlightBits })}
                />
                <Toggle
                  label="Mensajes de solo emotes más grandes"
                  checked={chatSettings.bigEmotes}
                  onChange={(bigEmotes) => updateSettings({ bigEmotes })}
                />
                <Toggle
                  label="Ocultar comandos (empiezan por !)"
                  checked={chatSettings.hideCommands}
                  onChange={(hideCommands) => updateSettings({ hideCommands })}
                />
                <Toggle label="Ocultar bots conocidos" checked={chatSettings.hideBots} onChange={(hideBots) => updateSettings({ hideBots })} />
              </div>

              <div className="cab-field">
                <Toggle
                  label="Marcar los mensajes que lee la voz"
                  checked={chatSettings.voiceMark}
                  onChange={(voiceMark) => updateSettings({ voiceMark })}
                />
                <span className="cab-hint">
                  Una etiqueta «VOZ» en la esquina del mensaje. Ahora la voz está en «{voiceModeName}».{' '}
                  <a className="studio-link" href="#tts">
                    Cambiar qué lee la voz
                  </a>
                </span>
              </div>

              <div className="cab-field">
                <Toggle
                  label="Mostrar también en «Todo en uno»"
                  checked={chatSettings.inAll}
                  onChange={(inAll) => updateSettings({ inAll })}
                />
                <span className="cab-hint">
                  Si usas la fuente «Todo en uno» y no quieres el chat en pantalla, apágalo aquí. La fuente «Chat» lo
                  muestra siempre.
                </span>
              </div>
              <p className="cab-note">
                Lo que un moderador borra en Twitch se tacha aquí y sale; un usuario expulsado o silenciado desaparece
                con todos sus mensajes.
              </p>
            </section>
          </div>

          {/* ---------- Monitor ---------- */}
          <section className="cab-mod max-[1099px]:order-first min-[1100px]:sticky min-[1100px]:top-4" data-tour="chat-monitor">
            <h2>Monitor</h2>
            <div ref={stageRef} className="cab-stage">
              <ChatOverlayView ref={chatRef} settings={chatSettings} isStudio />
            </div>

            <div className="cab-field">
              <span className="cab-label">Simular en el chat</span>
              <div className="chat-sim">
                {SAMPLES.map((sample) => (
                  <button key={sample.kind} type="button" className="cab-btn2 cab-btn-sm" onClick={() => send(sample.kind)}>
                    {sample.label}
                  </button>
                ))}
                <button type="button" className="cab-btn2 cab-btn-sm" onClick={burst}>
                  Ráfaga de 20
                </button>
                <button type="button" className="cab-btn2 cab-btn-sm" onClick={removeLast}>
                  Borrar el último (moderación)
                </button>
              </div>
              <Toggle label="Chat automático" checked={auto} onChange={setAuto} />
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" className="cab-btn flex-1" onClick={() => copyUrl(false)}>
                {copied === 'url' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span>{copied === 'url' ? 'URL copiada' : 'Copiar URL para OBS'}</span>
              </button>
              <button type="button" className="cab-btn2 flex-1" onClick={() => copyUrl(true)}>
                {copied === 'demo' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span>{copied === 'demo' ? 'URL copiada' : 'Copiar URL con chat de muestra'}</span>
              </button>
            </div>
            <p className="cab-hint" role="status">
              {status ||
                (channel
                  ? 'El chat de aquí es simulado. La URL con chat de muestra sirve para colocar la capa en OBS; al terminar, cámbiala por la normal.'
                  : 'Falta tu canal: escríbelo en Inicio antes de copiar la URL.')}
            </p>
          </section>
        </div>
      </div>

      {tourOpen && <GuidedTour steps={CHAT_TOUR_STEPS} onClose={() => setTourOpen(false)} id={TOUR_ID} appName="Chat" />}
    </div>
  );
};
