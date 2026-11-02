/**
 * src/pages/ChatStudio.tsx
 *
 * Ventana «Chat» de Tally Studio, con pestañas Ajustes | Apariencia. El
 * monitor 16:9 con el chat simulado, los botones de simulación y la URL de OBS
 * forman el panel fijo de la derecha, visible en las dos pestañas.
 *
 * - Apariencia: plantilla, movimiento y colocación; se ven al momento en el monitor.
 * - Ajustes: qué mensajes y marcas se muestran.
 * - Bajo el monitor hay un botón por cada clase de mensaje y otro para borrar
 *   el último, como haría un moderador.
 * - La marca «VOZ» del chat simulado sale de las reglas reales de Voz del chat.
 * - La guía cambia de pestaña antes de cada paso (ver pasosConPestana).
 */

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { SuiteNav } from '../components/SuiteNav';
import { GuidedTour, TourStep, isTourDone } from '../components/GuidedTour';
import { ChatOverlayHandle, ChatOverlayView } from '../components/chat/ChatOverlayView';
import { Ajuste, BotonCopiar, Deslizador, Escenario, Modulo, Nota, Opcion, Pista } from '../components/enpantalla/kit';
import { VentanaPestanas, pasosConPestana } from '../components/enpantalla/VentanaPestanas';
import { Boton, Segmented } from '../components/tally-ui';
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

export type ChatTab = 'ajustes' | 'apariencia';
export const CHAT_TABS: { id: ChatTab; label: string }[] = [
  { id: 'ajustes', label: 'Ajustes' },
  { id: 'apariencia', label: 'Apariencia' },
];

/** Pestaña donde vive cada módulo marcado por la guía; el monitor está en el panel fijo. */
export const CHAT_TOUR_TAB: Record<string, ChatTab> = {
  'chat-template': 'apariencia',
  'chat-motion': 'apariencia',
};

export const CHAT_TOUR_STEPS: TourStep[] = [
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

  const [tab, setTab] = useState<ChatTab>('ajustes');
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

  const tourSteps = useMemo(() => pasosConPestana(CHAT_TOUR_STEPS, CHAT_TOUR_TAB, TOUR_ID, (next) => setTab(next as ChatTab)), []);

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

  const apariencia = (
    <>
      {/* ---------- Plantilla ---------- */}
      <Modulo title="Plantilla" data-tour="chat-template">
        <Ajuste label="Plantilla del chat" hint={template.hint}>
          <Segmented
            label="Plantilla del chat"
            value={chatSettings.template}
            options={CHAT_TEMPLATES.map((item) => ({ value: item.id, label: item.name }))}
            onChange={(next) => updateSettings({ template: next })}
          />
        </Ajuste>

        {chatSettings.template === 'custom' && (
          <>
            <Ajuste label="Tipografía" htmlFor={`${uid}-font`}>
              <select
                id={`${uid}-font`}
                className="ept-inp"
                value={custom.font}
                onChange={(e) => updateCustom({ font: e.target.value as ChatFont })}
              >
                {CHAT_FONTS.map((font) => (
                  <option key={font.id} value={font.id}>
                    {font.name}
                  </option>
                ))}
              </select>
            </Ajuste>
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
                    className="ept-color"
                    value={custom[key]}
                    onChange={(e) => updateCustom({ [key]: e.target.value })}
                  />
                  <label htmlFor={`${uid}-${key}`}>{label}</label>
                </div>
              ))}
            </div>
            <div className="ept-two">
              <Deslizador
                label="Opacidad del fondo"
                min={0}
                max={1}
                step={0.02}
                value={custom.opacity}
                format={(value) => `${Math.round(value * 100)}%`}
                onChange={(opacity) => updateCustom({ opacity })}
              />
              <Deslizador
                label="Redondeo"
                min={CHAT_LIMITS.radius.min}
                max={CHAT_LIMITS.radius.max}
                step={0.1}
                value={custom.radius}
                format={(value) => value.toFixed(1)}
                onChange={(radius) => updateCustom({ radius })}
              />
            </div>
            <Pista>
              Si un espectador usa un color de nombre que no se lee sobre tu fondo, la capa lo aclara u oscurece sola.
            </Pista>
          </>
        )}
      </Modulo>

      {/* ---------- Movimiento ---------- */}
      <Modulo title="Movimiento" data-tour="chat-motion">
        <Ajuste
          label="Cómo entra, hace sitio y sale cada mensaje"
          hint={
            chatSettings.motion === 'propio'
              ? `${template.name}: ${CHAT_SIGNATURE[chatSettings.template]}`
              : 'Un movimiento genérico, igual en todas las plantillas. Los destacados conservan el trato de la plantilla.'
          }
        >
          <Segmented
            label="Movimiento de los mensajes"
            value={chatSettings.motion}
            options={CHAT_MOTIONS.map((item) => ({ value: item.id, label: item.name }))}
            onChange={(next) => {
              updateSettings({ motion: next });
              send('normal');
            }}
          />
        </Ajuste>
        <Ajuste label="Intensidad" hint="Cambia cuánto se mueve y cuánto dura. Con «Calma» no hay rebotes.">
          <Segmented
            label="Intensidad del movimiento"
            value={chatSettings.energy}
            options={CHAT_ENERGIES.map((item) => ({ value: item.id, label: item.name }))}
            onChange={(next) => {
              updateSettings({ energy: next });
              send('normal');
            }}
          />
        </Ajuste>
        <Pista>Si el sistema pide reducir el movimiento, los mensajes solo aparecen y desaparecen, sin desplazarse.</Pista>
      </Modulo>

      {/* ---------- Colocación ---------- */}
      <Modulo title="Colocación">
        <Ajuste label="Lado de la pantalla">
          <Segmented
            label="Lado de la pantalla"
            value={chatSettings.side}
            options={[
              { value: 'l', label: 'Izquierda' },
              { value: 'r', label: 'Derecha' },
            ]}
            onChange={(side) => updateSettings({ side })}
          />
        </Ajuste>
        <div className="ept-two">
          <Deslizador
            label="Tamaño del texto"
            min={CHAT_LIMITS.size.min}
            max={CHAT_LIMITS.size.max}
            step={0.05}
            value={chatSettings.size}
            format={(value) => `${Math.round(value * 100)}%`}
            onChange={(size) => updateSettings({ size })}
          />
          <Deslizador
            label="Ancho de la columna"
            min={CHAT_LIMITS.width.min}
            max={CHAT_LIMITS.width.max}
            value={chatSettings.width}
            format={(value) => String(value)}
            onChange={(width) => updateSettings({ width })}
          />
          <Deslizador
            label="Mensajes a la vez"
            min={CHAT_LIMITS.maxMessages.min}
            max={CHAT_LIMITS.maxMessages.max}
            value={chatSettings.maxMessages}
            format={(value) => String(value)}
            onChange={(maxMessages) => updateSettings({ maxMessages })}
          />
          <Deslizador
            label="Tiempo en pantalla"
            hint="Con 0, cada mensaje se queda hasta que lo empuja otro."
            min={CHAT_LIMITS.seconds.min}
            max={CHAT_LIMITS.seconds.max}
            value={chatSettings.seconds}
            format={(value) => (value ? `${value} s` : 'Sin límite')}
            onChange={(seconds) => updateSettings({ seconds })}
          />
        </div>
        <Pista>En el monitor el texto se ve algo más grande que en OBS, para poder leerlo a este tamaño.</Pista>
      </Modulo>
    </>
  );

  const ajustes = (
    <Modulo title="Qué se ve">
      <Opcion label="Insignias (CANAL, MOD, VIP, SUB)" checked={chatSettings.badges} onChange={(badges) => updateSettings({ badges })} />
      <Opcion
        label="Franja en mensajes de suscriptores"
        checked={chatSettings.highlightSubs}
        onChange={(highlightSubs) => updateSettings({ highlightSubs })}
      />
      <Opcion
        label="Mensajes con bits en color lleno"
        checked={chatSettings.highlightBits}
        onChange={(highlightBits) => updateSettings({ highlightBits })}
      />
      <Opcion
        label="Mensajes de solo emotes más grandes"
        checked={chatSettings.bigEmotes}
        onChange={(bigEmotes) => updateSettings({ bigEmotes })}
      />
      <Opcion
        label="Ocultar comandos (empiezan por !)"
        checked={chatSettings.hideCommands}
        onChange={(hideCommands) => updateSettings({ hideCommands })}
      />
      <Opcion label="Ocultar bots conocidos" checked={chatSettings.hideBots} onChange={(hideBots) => updateSettings({ hideBots })} />
      <Opcion
        label="Marcar los mensajes que lee la voz"
        checked={chatSettings.voiceMark}
        onChange={(voiceMark) => updateSettings({ voiceMark })}
        hint={
          <>
            Una etiqueta «VOZ» en la esquina del mensaje. Ahora la voz está en «{voiceModeName}».{' '}
            <a className="ept-link" href="#tts">
              Cambiar qué lee la voz
            </a>
          </>
        }
      />
      <Opcion
        label="Mostrar también en «Todo en uno»"
        checked={chatSettings.inAll}
        onChange={(inAll) => updateSettings({ inAll })}
        hint="Si usas la fuente «Todo en uno» y no quieres el chat en pantalla, apágalo aquí. La fuente «Chat» lo muestra siempre."
      />
      <Nota>
        Lo que un moderador borra en Twitch se tacha aquí y sale; un usuario expulsado o silenciado desaparece con todos sus mensajes.
      </Nota>
    </Modulo>
  );

  const fijo = (
    <Modulo title="Monitor" data-tour="chat-monitor">
      <Escenario ref={stageRef}>
        <ChatOverlayView ref={chatRef} settings={chatSettings} isStudio />
      </Escenario>

      <Ajuste label="Simular en el chat">
        <div className="chat-sim">
          {SAMPLES.map((sample) => (
            <Boton key={sample.kind} pequeno onClick={() => send(sample.kind)}>
              {sample.label}
            </Boton>
          ))}
          <Boton pequeno onClick={burst}>
            Ráfaga de 20
          </Boton>
          <Boton pequeno onClick={removeLast}>
            Borrar el último (moderación)
          </Boton>
        </div>
      </Ajuste>
      <Opcion label="Chat automático" checked={auto} onChange={setAuto} />

      <div className="ept-btns">
        <BotonCopiar principal copiado={copied === 'url'} texto="Copiar URL para OBS" textoCopiado="URL copiada" onClick={() => copyUrl(false)} />
        <BotonCopiar copiado={copied === 'demo'} texto="Copiar URL con chat de muestra" textoCopiado="URL copiada" onClick={() => copyUrl(true)} />
      </div>
      <Pista role="status">
        {status ||
          (channel
            ? 'El chat de aquí es simulado. La URL con chat de muestra sirve para colocar la capa en OBS; al terminar, cámbiala por la normal.'
            : 'Falta tu canal: escríbelo en Inicio antes de copiar la URL.')}
      </Pista>
    </Modulo>
  );

  return (
    <VentanaPestanas
      idBase={TOUR_ID}
      etiqueta="Secciones de Chat"
      barra={<SuiteNav currentApp="chat" channel={channel} saved={saved} onOpenTour={() => setTourOpen(true)} tourAvailable={!tourOpen} />}
      tabs={CHAT_TABS}
      value={tab}
      onChange={(id) => setTab(id as ChatTab)}
      paneles={{ ajustes, apariencia }}
      fijo={fijo}
      guiaAbierta={tourOpen}
    >
      {tourOpen && <GuidedTour steps={tourSteps} onClose={() => setTourOpen(false)} id={TOUR_ID} appName="Chat" />}
    </VentanaPestanas>
  );
};
