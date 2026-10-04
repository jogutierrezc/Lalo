/**
 * src/pages/Catalog.tsx
 *
 * Inicio del panel. A la izquierda, la lista de herramientas con su estado real
 * y una prueba de un clic. A la derecha, el canal y las fuentes de navegador
 * para OBS.
 *
 * - Las herramientas salen de una sola lista (TOOLS) y una sola plantilla de fila.
 * - El canal se escribe aquí y en ningún otro sitio de esta página.
 * - Las pruebas solo envían un aviso de demostración: no cambian nada guardado.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { BellRing, Bot, Check, Coins, Copy, Gamepad2, MessagesSquare, Mic, Play, Swords, Target } from 'lucide-react';
import { SuiteNav } from '../components/SuiteNav';
import { Field } from '../components/studio/StudioKit';
import { useSettings } from '../hooks/useSettings';
import { useCloudSession } from '../hooks/useCloudSession';
import { playAlertAudio } from '../utils/alertsAudio';
import { postBus } from '../utils/bus';
import { buildSuiteWidgetUrl, WidgetAppType } from '../utils/widgetUrl';
import { loadSettings, TTSSettings } from '../types/settings';
import { loadAlertsSettings } from '../types/alerts';
import { loadRewardsSettings } from '../types/rewards';
import { loadGoalsSettings } from '../types/goals';
import { loadRouletteSettings } from '../types/roulette';
import { loadTwitchIOSettings } from '../types/twitchio';
import { encodeChatSettings, loadChatSettings } from '../types/chat';
import { GuidedTour, TourStep, isTourDone } from '../components/GuidedTour';
import { ToolId, toolStatusFrom } from '../components/inicio/toolStatus';
import { PrimerosPasos } from '../components/recorrido/PrimerosPasos';
import '../styles/inicio-bot.css';

const TOUR_ID = 'catalogo';

const CATALOG_TOUR_STEPS: TourStep[] = [
  {
    target: 'inicio-canal',
    badge: 'Canal',
    title: 'Escribe tu canal',
    body: 'Pon aquí tu usuario de Twitch. Las URL de OBS de esta página se crean con ese canal.',
  },
  {
    target: 'inicio-fuentes',
    badge: 'OBS',
    title: 'Copia una fuente para OBS',
    body: 'Copia «Todo en uno» y pégala en OBS como fuente de navegador a 1920 × 1080. Si prefieres una fuente por capa, también están aquí.',
  },
  {
    target: 'inicio-herramientas',
    badge: 'Prueba',
    title: 'Haz tu primera prueba',
    body: 'Pulsa «Probar» en Alertas para oír y ver un aviso de demostración. Con «Abrir» entras a configurar cada herramienta.',
  },
];

interface Tool {
  id: ToolId;
  name: string;
  text: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Prueba de un clic. Solo envía un aviso de demostración. */
  test?: (settings: TTSSettings) => void;
}

const TOOLS: Tool[] = [
  {
    id: 'tts',
    name: 'Voz del chat',
    text: 'Lee en voz alta los mensajes del chat que tú decidas.',
    href: '#tts',
    icon: Mic,
  },
  {
    id: 'alertas',
    name: 'Alertas',
    text: 'Avisos en pantalla cuando alguien te sigue, se suscribe, envía bits o hace una raid.',
    href: '#alertas',
    icon: BellRing,
    test: (settings) => {
      playAlertAudio('synth-bell', 0.85);
      postBus({
        type: 'ALERT_TRIGGER',
        alert: {
          id: `test-${Date.now()}`,
          eventType: 'follow',
          user: settings.channel || 'NuevoSeguidor',
          detail: '¡Acaba de seguirte!',
          text: '¡Gracias por unirte a la tripulación!',
          style: settings.alertStyle,
          accent: settings.accent,
          soundType: 'synth-bell',
          duration: 4,
        },
      });
    },
  },
  {
    id: 'recompensas',
    name: 'Recompensas',
    text: 'Vídeos, sonidos y efectos cuando alguien canjea puntos del canal.',
    href: '#recompensas',
    icon: Coins,
    test: () => {
      playAlertAudio('arcade-chime', 0.85);
      postBus({
        type: 'REWARD_TRIGGER',
        reward: {
          id: `reward-test-${Date.now()}`,
          user: 'EspectadorPro',
          rewardName: '¡Lluvia de Confeti Neón!',
          noticeText: '¡EspectadorPro desató una lluvia de confeti en el stream!',
          position: 'fullscreen',
          scale: 1.0,
          volume: 0.85,
          screenShake: true,
          accentColor: '#f59e0b',
          soundType: 'arcade-chime',
          duration: 5,
        },
      });
    },
  },
  {
    id: 'metas',
    name: 'Metas',
    text: 'Barras de progreso de seguidores, suscripciones o bits, con celebración al llegar.',
    href: '#metas',
    icon: Target,
    test: () => {
      playAlertAudio('retro-fanfare', 0.85);
      postBus({
        type: 'GOAL_CELEBRATE',
        celebration: {
          goalId: 'demo-goal',
          title: 'Meta de demostración',
          victorySoundType: 'retro-fanfare',
          screenShake: true,
          confetti: true,
          duration: 5,
        },
      });
    },
  },
  {
    id: 'ruleta',
    name: 'Ruleta',
    text: 'Rueda de retos y castigos que el chat puede hacer girar.',
    href: '#ruleta',
    icon: Gamepad2,
    test: () => {
      playAlertAudio('arcade-chime', 0.85);
      postBus({
        type: 'ROULETTE_SPIN',
        spin: {
          id: `test-spin-${Date.now()}`,
          user: 'EspectadorDemo',
          winnerSegment: {
            id: 'demo-seg',
            text: '¡15 flexiones en directo!',
            color: '#ff2d46',
            category: 'fitness',
            durationSec: 45,
            enabled: true,
          },
          winnerIndex: 0,
          totalActiveSegments: 6,
          finalRotation: 2160 + 330,
          spinDurationSec: 5.5,
          screenShake: true,
          confetti: true,
          victorySoundType: 'arcade-chime',
          showWinnerBanner: true,
          winnerBannerDurationSec: 8,
        },
      });
    },
  },
  {
    id: 'encuestas',
    name: 'Batallas',
    text: 'Votaciones entre dos opciones que el chat decide escribiendo su voto.',
    href: '#encuestas',
    icon: Swords,
    test: () => {
      playAlertAudio('synth-bell', 0.85);
      postBus({
        type: 'POLL_STATE_UPDATE',
        state: {
          title: 'Batalla de demostración: ¿pizza o tacos?',
          optionA: { id: 'opt-a', label: 'Pizza italiana', color: '#00e5ff', accentGlow: '#00e5ff', votes: 14 },
          optionB: { id: 'opt-b', label: 'Tacos al pastor', color: '#ff0055', accentGlow: '#ff0055', votes: 10 },
          totalDurationSec: 45,
          timeLeftSec: 45,
          isActive: true,
          winner: null,
          leader: 'A',
        },
      });
    },
  },
  {
    id: 'chat',
    name: 'Chat',
    text: 'El chat de tu canal en pantalla, con plantillas, destacados y moderación visible.',
    href: '#chat',
    icon: MessagesSquare,
  },
  {
    id: 'twitchio',
    name: 'Bot',
    text: 'Comandos del chat con respuestas automáticas.',
    href: '#twitchio',
    icon: Bot,
  },
];

const SOURCES: { app: WidgetAppType; name: string; note: string; recommended?: boolean }[] = [
  { app: 'all', name: 'Todo en uno', note: 'Una sola fuente con todas las capas', recommended: true },
  { app: 'tts', name: 'Voz', note: 'Mensajes leídos en voz alta' },
  { app: 'alerts', name: 'Alertas', note: 'Follows, suscripciones, bits y raids' },
  { app: 'goals', name: 'Metas', note: 'Barras de progreso' },
  { app: 'roulette', name: 'Ruleta', note: 'Rueda de retos y castigos' },
  { app: 'polls', name: 'Batallas', note: 'Votación entre dos opciones' },
  { app: 'chat', name: 'Chat', note: 'El chat de tu canal en pantalla' },
];

/** Lee lo guardado de cada herramienta para decir cuánto hay activo. */
function readToolStatus() {
  return toolStatusFrom({
    alerts: loadAlertsSettings(),
    rewards: loadRewardsSettings(),
    goals: loadGoalsSettings(),
    roulette: loadRouletteSettings(),
    bot: loadTwitchIOSettings(),
  });
}

export const Catalog: React.FC = () => {
  const { settings, update, saved } = useSettings();
  const cloud = useCloudSession();
  const uid = useId();

  const [tourOpen, setTourOpen] = useState(false);
  const [toolStatus] = useState(readToolStatus);
  const [testNote, setTestNote] = useState<string | null>(null);
  const [copied, setCopied] = useState<WidgetAppType | null>(null);
  const [copyFailed, setCopyFailed] = useState<{ name: string; url: string } | null>(null);
  const [askedWithoutChannel, setAskedWithoutChannel] = useState(false);

  const channelRef = useRef<HTMLInputElement | null>(null);
  const testTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const channel = settings.channel.trim();

  // La guía se abre sola la primera vez; después se accede desde el botón de la cabecera
  useEffect(() => {
    if (isTourDone(TOUR_ID)) return;
    const timer = setTimeout(() => setTourOpen(true), 600);
    return () => clearTimeout(timer);
  }, []);

  useEffect(
    () => () => {
      if (testTimer.current) clearTimeout(testTimer.current);
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    []
  );

  const runTest = (tool: Tool) => {
    if (!tool.test) return;
    tool.test(settings);
    setTestNote(`Prueba de ${tool.name} enviada.`);
    if (testTimer.current) clearTimeout(testTimer.current);
    testTimer.current = setTimeout(() => setTestNote(null), 4000);
  };

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const copySource = async (source: (typeof SOURCES)[number]) => {
    if (!channel) {
      setAskedWithoutChannel(true);
      setCopyFailed(null);
      channelRef.current?.focus();
      return;
    }
    const url = buildSuiteWidgetUrl(
      baseUrl,
      source.app,
      channel,
      loadSettings(),
      cloud.profile?.status === 'active'
        ? { k: cloud.profile.widget_key }
        : source.app === 'chat'
          ? { cs: encodeChatSettings(loadChatSettings()) }
          : undefined
    );
    try {
      if (!navigator.clipboard) throw new Error('Portapapeles no disponible');
      await navigator.clipboard.writeText(url);
      setCopyFailed(null);
      setCopied(source.app);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(null), 2200);
    } catch {
      setCopied(null);
      setCopyFailed({ name: source.name, url });
    }
  };

  return (
    <div className="cab" style={{ paddingBottom: tourOpen ? 220 : undefined }}>
      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-6">
        <SuiteNav
          currentApp="catalogo"
          channel={settings.channel}
          saved={saved}
          onOpenTour={() => setTourOpen(true)}
          tourAvailable={!tourOpen}
        />

        {/* ---------- Primeros pasos: lo que queda de la bienvenida (solo con cuenta en la nube) ---------- */}
        {cloud.profile?.status === 'active' && cloud.profile.role === 'streamer' && (
          <PrimerosPasos perfilId={cloud.profile.id} variante="inicio" />
        )}

        <div className="grid items-start gap-5 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
          {/* ---------- Herramientas ---------- */}
          <section className="cab-mod" data-tour="inicio-herramientas">
            <h2>Herramientas</h2>
            <ul className="cab-rows !max-h-none">
              {TOOLS.map((tool) => {
                const Icon = tool.icon;
                const status = toolStatus[tool.id];
                return (
                  <li key={tool.id} className="inicio-tool">
                    <Icon className="inicio-tool-icon h-5 w-5" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="inicio-tool-name">
                        {tool.name}
                        {status && (
                          <span className="cab-chip" data-status={status.empty ? 'skipped' : undefined}>
                            {status.text}
                          </span>
                        )}
                      </p>
                      <p className="cab-hint">{tool.text}</p>
                    </div>
                    <div className="inicio-tool-actions">
                      {tool.test && (
                        <button
                          type="button"
                          className="cab-btn2 cab-btn-sm"
                          aria-label={`Probar ${tool.name}`}
                          onClick={() => runTest(tool)}
                        >
                          <Play className="h-4 w-4" aria-hidden="true" />
                          <span>Probar</span>
                        </button>
                      )}
                      <a className="cab-btn cab-btn-sm no-underline" href={tool.href} aria-label={`Abrir ${tool.name}`}>
                        Abrir
                      </a>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="cab-hint" role="status">
              {testNote
                ? `${testNote} Suena aquí y se ve en las fuentes abiertas en este navegador.`
                : '«Probar» lanza un aviso de demostración: suena aquí y se ve en las fuentes abiertas en este navegador. No cambia nada de lo que tienes guardado.'}
            </p>
          </section>

          <div className="grid gap-5">
            {/* ---------- Canal ---------- */}
            <section className="cab-mod" data-tour="inicio-canal">
              <h2>Canal</h2>
              <Field
                label="Tu canal de Twitch"
                htmlFor={`${uid}-channel`}
                hint="Con este canal se crean las URL de OBS de esta página."
              >
                <div className="inicio-channel">
                  <span className="cab-mono" aria-hidden="true">
                    twitch.tv/
                  </span>
                  <input
                    id={`${uid}-channel`}
                    ref={channelRef}
                    type="text"
                    className="cab-inp cab-mono"
                    value={settings.channel}
                    placeholder="tu_canal"
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => update({ channel: e.target.value.toLowerCase().trim() })}
                  />
                </div>
              </Field>
            </section>

            {/* ---------- Fuentes de OBS ---------- */}
            <section className="cab-mod" data-tour="inicio-fuentes">
              <h2>Fuentes de OBS</h2>
              <p className="cab-hint">
                Pega una URL en OBS como fuente de navegador, a 1920 × 1080. Con «Todo en uno» basta; las demás son por
                si quieres una fuente por capa.
              </p>

              <ul className="cab-rows !max-h-none">
                {SOURCES.map((source) => (
                  <li key={source.app} className="cab-row">
                    <div className="min-w-0">
                      <p className="inicio-tool-name">
                        {source.name}
                        {source.recommended && <span className="cab-chip">Recomendada</span>}
                      </p>
                      <p className="cab-hint">{source.note}</p>
                    </div>
                    <button
                      type="button"
                      className={`${source.recommended ? 'cab-btn' : 'cab-btn2'} cab-btn-sm`}
                      aria-label={`Copiar URL de ${source.name}`}
                      onClick={() => copySource(source)}
                    >
                      {copied === source.app ? (
                        <Check className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Copy className="h-4 w-4" aria-hidden="true" />
                      )}
                      <span>{copied === source.app ? 'Copiada' : 'Copiar URL'}</span>
                    </button>
                  </li>
                ))}
              </ul>

              {!channel && (
                <p className={askedWithoutChannel ? 'cab-error' : 'cab-hint'} role={askedWithoutChannel ? 'alert' : undefined}>
                  {askedWithoutChannel
                    ? 'No se copió nada: falta el canal. Escríbelo arriba y vuelve a copiar.'
                    : 'Escribe tu canal arriba para poder copiar las URL.'}
                </p>
              )}

              {copyFailed && (
                <div className="cab-field" role="alert">
                  <p className="cab-error">
                    El navegador no dejó copiar la URL de {copyFailed.name}. Selecciónala aquí y cópiala a mano:
                  </p>
                  <code className="cab-url cab-mono">{copyFailed.url}</code>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      {tourOpen && (
        <GuidedTour steps={CATALOG_TOUR_STEPS} onClose={() => setTourOpen(false)} id={TOUR_ID} appName="Inicio" />
      )}
    </div>
  );
};
