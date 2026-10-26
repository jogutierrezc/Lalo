/**
 * src/pages/TwitchIOStudio.tsx
 *
 * Bot del chat. Arriba, la tarjeta «Bot en la nube»: tres pasos (cuenta de Twitch,
 * permiso al bot y bot activo) y el estado de la conexión. Debajo, la lista de
 * comandos: cada uno se edita en su propia fila y se guarda en el servidor, por
 * streamer. A la derecha se prueban sin salir del panel (prueba local: no se
 * envía nada a Twitch).
 *
 * El bot en la nube es el bot global «Lalo»: el streamer solo concede en Twitch
 * el permiso channel:bot. Sin sesión de la nube, la lista se guarda solo en este
 * navegador, como antes.
 *
 * Opción avanzada, plegada al final: un script de Python que el streamer ejecuta
 * en su equipo. Ese bot no avisa de si está conectado.
 *
 * El script usa TwitchIO (https://github.com/TwitchIO/TwitchIO), de
 * PythonistaGuild y EvieePy, con licencia MIT.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, Copy, Plus, Send } from 'lucide-react';
import { SuiteNav } from '../components/SuiteNav';
import { Field, UndoNote, useUndo } from '../components/studio/StudioKit';
import { useTwitchIOSettings } from '../hooks/useTwitchIOSettings';
import { useCloudSession } from '../hooks/useCloudSession';
import { BotRow, useBotCloud } from '../hooks/useBotCloud';
import { CommandPermission, TWITCHIO_STORAGE_KEY, TwitchIOCommand } from '../types/twitchio';
import { loadSettings } from '../types/settings';
import { postBus } from '../utils/bus';
import { playAlertAudio } from '../utils/alertsAudio';
import { GuidedTour, TourStep, isTourDone } from '../components/GuidedTour';
import {
  buildPythonScript,
  cleanChannel,
  cleanCommandName,
  fillTemplate,
  LuxChatSettings,
  PIP_COMMAND,
  scriptCommands,
  TOKEN_PLACEHOLDER,
} from '../components/bot/pythonScript';
import { luxGetSettings } from '../lib/luxApi';
import { signInWithTwitch } from '../lib/cloud';
import { botSteps, type StepState } from '../utils/botCloud';
import { rememberLuxBot } from '../lib/luxBotRecord';
import '../styles/inicio-bot.css';

const TOUR_ID = 'twitchio';

const TWITCHIO_TOUR_STEPS: TourStep[] = [
  {
    badge: 'Bienvenida',
    title: 'Bot del chat',
    body: 'Aquí decides qué responde el bot cuando alguien escribe un comando en tu chat.',
  },
  {
    target: 'bot-nube',
    badge: 'Bot en la nube',
    title: 'Conéctalo en tres pasos',
    body: 'Das permiso al bot de Lalo una sola vez en Twitch y responde en tu chat desde el servidor. No instalas nada.',
  },
  {
    target: 'bot-comandos',
    badge: 'Comandos',
    title: 'Un comando por fila',
    body: 'Escribe el nombre, la respuesta y quién puede usarlo. El interruptor lo apaga sin borrarlo.',
  },
  {
    target: 'bot-probar',
    badge: 'Probar',
    title: 'Pruébalo aquí',
    body: 'Escribe un comando como si estuvieras en el chat y mira qué contestaría el bot.',
  },
  {
    target: 'bot-arranque',
    badge: 'Opción avanzada',
    title: 'Ejecútalo en tu equipo',
    body: 'Si prefieres tu propia cuenta de bot, copia el script, pega tu token y ejecútalo con Python.',
  },
];

const PERMISSIONS: { id: CommandPermission; label: string }[] = [
  { id: 'all', label: 'Cualquiera' },
  { id: 'sub', label: 'Suscriptores' },
  { id: 'mod', label: 'Moderadores' },
  { id: 'broadcaster', label: 'Solo el streamer' },
];

const MAX_LOG_LINES = 60;

interface LogLine {
  id: number;
  kind: 'in' | 'out' | 'note';
  text: string;
}

/** Una fila de la lista, venga del servidor o del navegador. */
interface CmdItem {
  key: string;
  name: string;
  response: string;
  permission: CommandPermission;
  enabled: boolean;
  error: string;
}

/** La etiqueta de un paso: verde si está hecho, ámbar si falta algo que se puede hacer. */
function chipStatus(state: StepState): 'read' | 'skipped' | undefined {
  if (state === 'done') return 'read';
  if (state === 'todo' || state === 'unavailable') return 'skipped';
  return undefined;
}

const toLocalCommand = (row: BotRow): TwitchIOCommand => ({
  id: row.key,
  name: row.name,
  response: row.response,
  permission: row.permission,
  cooldown: 5,
  enabled: row.enabled,
  category: 'stream',
});

/** El streamer guardó algo alguna vez en este navegador (si no, solo ve los comandos de ejemplo). */
function hasLocalSettings(): boolean {
  try {
    return localStorage.getItem(TWITCHIO_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

type UndoSnapshot = { kind: 'cloud'; rows: BotRow[] } | { kind: 'local'; commands: TwitchIOCommand[] };

export const TwitchIOStudio: React.FC = () => {
  const { twitchIOSettings, updateTwitchIO, saved } = useTwitchIOSettings();
  const cloud = useCloudSession();
  const undo = useUndo<UndoSnapshot>();
  const uid = useId();

  const [tourOpen, setTourOpen] = useState(false);
  const [addedId, setAddedId] = useState<string | null>(null);
  // Mientras se escribe, el prefijo puede quedar vacío; al salir del campo vuelve a «!»
  const [prefixDraft, setPrefixDraft] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [log, setLog] = useState<LogLine[]>([]);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [suiteChannel] = useState(() => loadSettings().channel.trim());
  const [stepMessage, setStepMessage] = useState('');
  // Palabra de Lux para el chat (Mi AI). Hasta que llega, el script usa la de por defecto.
  const [luxChat, setLuxChat] = useState<LuxChatSettings | null>(null);
  const [localSaved] = useState(hasLocalSettings);

  const logRef = useRef<HTMLUListElement | null>(null);
  const lineId = useRef(0);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------- Nube ----------
  // Con cuenta activa, comandos y ajustes viven en el servidor; sin ella, en este navegador
  const account = cloud.enabled && cloud.profile?.status === 'active' ? cloud.profile : null;
  const bot = useBotCloud(Boolean(account), account?.id ?? '', {
    commands: twitchIOSettings.commands,
    prefix: twitchIOSettings.prefix || '!',
    hasSaved: localSaved,
  });
  const cloudOn = Boolean(account);
  const cloudReady = cloudOn && bot.phase === 'ready';
  const steps = botSteps(cloudReady ? bot.connection : null);

  const prefix = (cloudReady ? bot.settings.prefix : twitchIOSettings.prefix) || '!';
  const welcomeMessage = cloudReady ? bot.settings.welcomeMessage : twitchIOSettings.welcomeMessage;
  const commands: TwitchIOCommand[] = cloudReady ? bot.rows.map(toLocalCommand) : twitchIOSettings.commands;
  const items: CmdItem[] = cloudReady
    ? bot.rows.map((row) => ({ key: row.key, name: row.name, response: row.response, permission: row.permission, enabled: row.enabled, error: row.error }))
    : twitchIOSettings.commands.map((command) => ({
        key: command.id,
        name: command.name,
        response: command.response,
        permission: command.permission,
        enabled: command.enabled,
        error: '',
      }));
  const showList = !cloudOn || cloudReady;
  const botName = twitchIOSettings.botUsername || 'LaloBot';
  const activeCount = items.filter((item) => item.enabled).length;
  const inScript = scriptCommands(commands, prefix);
  const script = buildPythonScript({ ...twitchIOSettings, prefix, welcomeMessage, commands }, luxChat ?? undefined);

  // Nombres repetidos: el bot solo puede atender al primero
  const names = items.map((item) => cleanCommandName(item.name, prefix)).filter(Boolean);
  const repeated = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];

  // La guía se abre sola la primera vez; después se accede desde el botón de la cabecera
  useEffect(() => {
    if (isTourDone(TOUR_ID)) return;
    const timer = setTimeout(() => setTourOpen(true), 600);
    return () => clearTimeout(timer);
  }, []);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    []
  );

  // Palabra de Lux: si la cuenta no tiene Mi AI, el servidor responde con error y el script queda con «lux»
  useEffect(() => {
    let alive = true;
    luxGetSettings().then((res) => {
      if (alive && res.ok) setLuxChat({ word: res.data.chatWord, alias: res.data.chatAlias, name: res.data.chatName });
    });
    return () => {
      alive = false;
    };
  }, []);

  // La conversación de prueba queda siempre en la última línea
  useEffect(() => {
    const box = logRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [log]);

  // ---------- Conexión ----------
  const connectBot = async () => {
    setStepMessage('');
    const res = await bot.connect();
    if ('error' in res) {
      setStepMessage(res.error);
      return;
    }
    if (res.outcome === 'no_permission') {
      // El permiso se pide con el mismo inicio de sesión de Twitch de siempre (incluye channel:bot)
      setStepMessage('Twitch necesita que aceptes el permiso del bot. Te llevamos a Twitch; cuando vuelvas, pulsa «Conectar el bot» otra vez.');
      try {
        await signInWithTwitch();
      } catch (err) {
        setStepMessage(err instanceof Error ? `No se pudo abrir Twitch: ${err.message}` : 'No se pudo abrir Twitch.');
      }
      return;
    }
    if (res.outcome === 'error') {
      setStepMessage(res.detail || 'Twitch no dejó conectar el bot. Prueba de nuevo en un momento.');
      return;
    }
    setStepMessage('Hecho. Twitch tarda unos segundos en comprobar la conexión: pulsa «Volver a consultar».');
  };

  const disconnectBot = async () => {
    setStepMessage('');
    const problem = await bot.disconnect();
    setStepMessage(problem || 'Bot apagado. Ya no escucha ni responde en tu chat.');
  };

  // ---------- Comandos ----------
  const patchCommand = (key: string, patch: Partial<Pick<CmdItem, 'name' | 'response' | 'permission' | 'enabled'>>) => {
    if (cloudReady) {
      bot.patchRow(key, patch);
      return;
    }
    updateTwitchIO({ commands: twitchIOSettings.commands.map((command) => (command.id === key ? { ...command, ...patch } : command)) });
  };

  const addCommand = () => {
    if (cloudReady) {
      setAddedId(bot.addRow());
      return;
    }
    const id = `cmd-${Date.now()}`;
    setAddedId(id);
    updateTwitchIO({
      commands: [
        ...twitchIOSettings.commands,
        { id, name: '', response: '', permission: 'all', cooldown: 5, enabled: true, category: 'stream' },
      ],
    });
  };

  const removeCommand = (item: CmdItem) => {
    const label = item.name ? `Se quitó ${prefix}${item.name}.` : 'Se quitó un comando sin nombre.';
    if (cloudReady) {
      undo.offer(label, { kind: 'cloud', rows: bot.rows });
      void bot.removeRow(item.key);
      return;
    }
    undo.offer(label, { kind: 'local', commands: twitchIOSettings.commands });
    updateTwitchIO({ commands: twitchIOSettings.commands.filter((entry) => entry.id !== item.key) });
  };

  const restoreCommands = () => {
    if (!undo.pending) return;
    const snapshot = undo.pending.snapshot;
    if (snapshot.kind === 'cloud') void bot.restoreRows(snapshot.rows);
    else updateTwitchIO({ commands: snapshot.commands });
    undo.clear();
  };

  // ---------- Ajustes ----------
  const changePrefix = (next: string) => {
    if (cloudReady) bot.patchSettings({ prefix: next });
    else updateTwitchIO({ prefix: next });
  };

  const changeWelcome = (next: string) => {
    if (cloudReady) bot.patchSettings({ welcomeMessage: next });
    else updateTwitchIO({ welcomeMessage: next });
  };

  // ---------- Probar ----------
  const say = (lines: Omit<LogLine, 'id'>[]) => {
    setLog((prev) => [...prev, ...lines.map((line) => ({ ...line, id: ++lineId.current }))].slice(-MAX_LOG_LINES));
  };

  const simulate = (event: React.FormEvent) => {
    event.preventDefault();
    const raw = chatInput.trim();
    if (!raw) return;
    setChatInput('');

    const incoming = { kind: 'in' as const, text: `Tú: ${raw}` };
    if (!raw.startsWith(prefix)) {
      say([incoming, { kind: 'note', text: `El bot no contesta: el mensaje no empieza por ${prefix}` }]);
      return;
    }

    const name = raw.slice(prefix.length).split(' ')[0].toLowerCase();
    const found = commands.find((command) => cleanCommandName(command.name, prefix) === name);
    if (!found) {
      say([incoming, { kind: 'note', text: `El bot no contesta: no hay ningún comando ${prefix}${name}` }]);
      return;
    }
    if (!found.enabled) {
      say([incoming, { kind: 'note', text: `El bot no contesta: ${prefix}${name} está apagado` }]);
      return;
    }

    // El comando «alerta» además enseña un aviso de demostración en las capas abiertas
    if (name === 'alerta') {
      playAlertAudio('arcade-chime', 0.8);
      postBus({
        type: 'ALERT_TRIGGER',
        alert: {
          id: `cmd-alert-${Date.now()}`,
          eventType: 'bits',
          user: 'Streamer',
          text: '¡Alerta activada desde el chat!',
          style: 'cabina',
          accent: '#9146ff',
          soundType: 'arcade-chime',
          duration: 4,
        },
      });
    }

    const reply = fillTemplate(found.response, 'Streamer', twitchIOSettings.channel);
    say([
      incoming,
      reply.trim()
        ? { kind: 'out', text: `${botName}: ${reply}` }
        : { kind: 'note', text: `${prefix}${name} todavía no tiene respuesta` },
    ]);
  };

  // ---------- Script ----------
  const copyScript = async () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
    try {
      if (!navigator.clipboard) throw new Error('Portapapeles no disponible');
      await navigator.clipboard.writeText(script);
      // Lo que se copió queda anotado: Mi AI avisa si luego cambia la palabra.
      rememberLuxBot({ word: luxChat?.word ?? 'lux', alias: luxChat?.alias ?? true, name: luxChat?.name ?? '' });
      setCopyState('copied');
      copyTimer.current = setTimeout(() => setCopyState('idle'), 2200);
    } catch {
      setCopyState('failed');
    }
  };

  const example = commands.find((command) => command.enabled && command.name);

  // Lo que hay a la derecha de cada paso: etiqueta o botón
  const permissionAction =
    steps.permission.state === 'todo' ? (
      <button type="button" className="cab-btn" disabled={bot.busy} onClick={connectBot}>
        Conectar el bot
      </button>
    ) : (
      <span className="cab-chip" data-status={chipStatus(steps.permission.state)}>
        {steps.permission.label}
      </span>
    );

  const activeAction =
    steps.active.state === 'todo' ? (
      <button type="button" className="cab-btn" disabled={bot.busy} onClick={connectBot}>
        Encender el bot
      </button>
    ) : (
      <span className="flex flex-wrap items-center justify-end gap-2">
        <span className="cab-chip" data-status={chipStatus(steps.active.state)}>
          {steps.active.label}
        </span>
        {steps.active.state === 'done' && (
          <button type="button" className="cab-btn2 cab-btn-sm" disabled={bot.busy} onClick={disconnectBot}>
            Apagar
          </button>
        )}
      </span>
    );

  return (
    <div className="cab" style={{ paddingBottom: tourOpen ? 220 : undefined }}>
      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-6">
        <SuiteNav
          currentApp="twitchio"
          channel={twitchIOSettings.channel}
          saved={saved}
          onOpenTour={() => setTourOpen(true)}
          tourAvailable={!tourOpen}
        />

        <div className="grid items-start gap-5 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
          <div className="grid gap-5">
            {/* ---------- Bot en la nube ---------- */}
            <section className="cab-mod" data-tour="bot-nube">
              <h2>Bot en la nube</h2>
              <p className="cab-hint">
                El bot de Lalo responde en tu chat desde el servidor: sin Python y sin dejar el equipo encendido. Solo das un
                permiso en Twitch.
              </p>

              {!cloudOn ? (
                <p className="cab-note">
                  Entra con tu cuenta de Twitch para conectar el bot en la nube. Mientras tanto puedes preparar los comandos
                  aquí; se guardan solo en este navegador.
                </p>
              ) : bot.phase === 'loading' ? (
                <p className="cab-note" role="status">
                  Comprobando tu bot…
                </p>
              ) : bot.phase === 'error' ? (
                <div className="grid gap-3">
                  <p className="cab-error" role="alert">
                    {bot.loadError}
                  </p>
                  <div>
                    <button type="button" className="cab-btn2" onClick={() => void bot.reload()}>
                      Reintentar
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <ol className="bot-steps">
                    <li className="bot-step" data-state={steps.account.state}>
                      <span className="bot-step-dot" aria-hidden="true">
                        {steps.account.state === 'done' ? <Check className="h-4 w-4" /> : '1'}
                      </span>
                      <p className="bot-step-text">
                        <b>Cuenta de Twitch conectada</b>
                        <span className="cab-hint">
                          {bot.connection?.hasChannel
                            ? `Canal #${bot.connection.twitchLogin || twitchIOSettings.channel}`
                            : 'Esta cuenta no está conectada a un canal de Twitch.'}
                        </span>
                      </p>
                      <span className="cab-chip" data-status={chipStatus(steps.account.state)}>
                        {steps.account.label}
                      </span>
                    </li>
                    <li className="bot-step" data-state={steps.permission.state}>
                      <span className="bot-step-dot" aria-hidden="true">
                        {steps.permission.state === 'done' ? <Check className="h-4 w-4" /> : '2'}
                      </span>
                      <p className="bot-step-text">
                        <b>Dar permiso al bot</b>
                        <span className="cab-hint">Twitch te pide aceptar una vez. No instalas nada.</span>
                      </p>
                      {permissionAction}
                    </li>
                    <li className="bot-step" data-state={steps.active.state}>
                      <span className="bot-step-dot" aria-hidden="true">
                        {steps.active.state === 'done' ? <Check className="h-4 w-4" /> : '3'}
                      </span>
                      <p className="bot-step-text">
                        <b>Bot activo en tu chat</b>
                        <span className="cab-hint">Responde a tus comandos y a Lux.</span>
                      </p>
                      {activeAction}
                    </li>
                  </ol>

                  {stepMessage && (
                    <p className="cab-note" role="status">
                      {stepMessage}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    <button type="button" className="cab-btn2 cab-btn-sm" disabled={bot.busy} onClick={async () => setStepMessage(await bot.refreshConnection())}>
                      Volver a consultar
                    </button>
                  </div>
                </>
              )}
            </section>

            {/* ---------- Comandos ---------- */}
            <section className="cab-mod" data-tour="bot-comandos">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2>Comandos</h2>
                {showList && (
                  <p className="cab-hint">
                    {activeCount} de {items.length} encendidos
                  </p>
                )}
              </div>

              {bot.notice && (
                <p className="cab-note" role="status">
                  {bot.notice}{' '}
                  <button type="button" className="studio-link" onClick={bot.clearNotice}>
                    Entendido
                  </button>
                </p>
              )}

              {!showList ? (
                <p className="cab-note">
                  {bot.phase === 'loading' ? 'Cargando tus comandos…' : 'No se pudieron cargar tus comandos. Reintenta arriba.'}
                </p>
              ) : items.length === 0 ? (
                <p className="cab-note">
                  Todavía no hay comandos. Pulsa «Nuevo comando», ponle un nombre (por ejemplo, redes) y escribe lo que
                  debe contestar el bot.
                </p>
              ) : (
                <ul className="cab-rows !max-h-none">
                  {items.map((item) => {
                    const label = item.name ? `${prefix}${item.name}` : 'comando sin nombre';
                    return (
                      <li key={item.key} className="bot-cmd">
                        <input
                          type="checkbox"
                          className="cab-tog"
                          checked={item.enabled}
                          aria-label={`Encender ${label}`}
                          onChange={(e) => patchCommand(item.key, { enabled: e.target.checked })}
                        />
                        <div className="bot-cmd-name">
                          <span className="cab-mono" aria-hidden="true">
                            {prefix}
                          </span>
                          <input
                            className="cab-inp cab-mono"
                            value={item.name}
                            placeholder="nombre"
                            aria-label="Nombre del comando"
                            autoComplete="off"
                            spellCheck={false}
                            maxLength={25}
                            autoFocus={item.key === addedId}
                            onChange={(e) => patchCommand(item.key, { name: cleanCommandName(e.target.value, prefix) })}
                          />
                        </div>
                        <input
                          className="cab-inp bot-cmd-reply"
                          value={item.response}
                          placeholder="Lo que contesta el bot"
                          aria-label={`Respuesta de ${label}`}
                          maxLength={450}
                          onChange={(e) => patchCommand(item.key, { response: e.target.value })}
                        />
                        <select
                          className="cab-inp bot-cmd-who"
                          value={item.permission}
                          aria-label={`Quién puede usar ${label}`}
                          onChange={(e) => patchCommand(item.key, { permission: e.target.value as CommandPermission })}
                        >
                          {PERMISSIONS.map((permission) => (
                            <option key={permission.id} value={permission.id}>
                              {permission.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="cab-btn2 cab-btn-sm"
                          aria-label={`Quitar ${label}`}
                          onClick={() => removeCommand(item)}
                        >
                          Quitar
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {repeated.length > 0 && (
                <p className="cab-error" role="alert">
                  Hay más de un comando llamado {repeated.map((name) => `${prefix}${name}`).join(', ')}. El bot solo usará
                  el primero.
                </p>
              )}

              {items
                .filter((item) => item.error)
                .map((item) => (
                  <p key={item.key} className="cab-error" role="alert">
                    {item.name ? `${prefix}${item.name}` : 'Un comando'}: {item.error}
                  </p>
                ))}

              {undo.pending && <UndoNote label={undo.pending.label} onUndo={restoreCommands} />}

              {showList && (
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" className="cab-btn2" onClick={addCommand}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    <span>Nuevo comando</span>
                  </button>
                  <p className="cab-hint flex-1 basis-60">
                    En la respuesta, <span className="cab-mono">{'{user}'}</span> se cambia por quien escribe y{' '}
                    <span className="cab-mono">{'{channel}'}</span> por tu canal.
                    {cloudReady && ' Cada comando se guarda en la nube cuando tiene nombre y respuesta.'}
                  </p>
                </div>
              )}

              {showList && (
                <details className="studio-details">
                  <summary>Ajustes del bot</summary>
                  <div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field
                        label="Prefijo"
                        htmlFor={`${uid}-prefix`}
                        hint="El símbolo con el que empiezan los comandos. Si lo dejas vacío, vuelve a ser !"
                      >
                        <input
                          id={`${uid}-prefix`}
                          className="cab-inp cab-mono"
                          value={prefixDraft ?? prefix}
                          maxLength={3}
                          autoComplete="off"
                          spellCheck={false}
                          onChange={(e) => {
                            const next = e.target.value.replace(/\s+/g, '');
                            setPrefixDraft(next);
                            if (next) changePrefix(next);
                          }}
                          onBlur={() => {
                            if (prefixDraft === '') changePrefix('!');
                            setPrefixDraft(null);
                          }}
                        />
                      </Field>
                      <Field
                        label="Mensaje de bienvenida (solo script de Python)"
                        htmlFor={`${uid}-welcome`}
                        hint="Solo lo usa el script de Python de la opción avanzada. El bot en la nube todavía no envía saludo. Déjalo vacío si no quieres saludo."
                      >
                        <input
                          id={`${uid}-welcome`}
                          className="cab-inp"
                          value={welcomeMessage}
                          maxLength={450}
                          onChange={(e) => changeWelcome(e.target.value)}
                        />
                      </Field>
                    </div>
                    {cloudReady && bot.settingsError && (
                      <p className="cab-error" role="alert">
                        {bot.settingsError}
                      </p>
                    )}
                  </div>
                </details>
              )}
            </section>

            {/* ---------- Opción avanzada ---------- */}
            <section className="cab-mod" data-tour="bot-arranque">
              <details className="studio-details">
                <summary>Opción avanzada: ejecutar el bot en tu PC</summary>
                <div>
                  <p className="cab-note">
                    Si prefieres que el bot hable con tu propia cuenta, puedes ejecutarlo en tu equipo con un script de
                    Python. Ese bot no avisa de si está conectado. Cuando cambies algo en esta página, copia el script otra
                    vez y vuelve a ejecutarlo.
                  </p>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="Nombre del bot"
                      htmlFor={`${uid}-name`}
                      hint="Se usa en la prueba de esta página. En el chat, el bot aparece con el nombre de la cuenta del token."
                    >
                      <input
                        id={`${uid}-name`}
                        className="cab-inp"
                        value={twitchIOSettings.botUsername}
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(e) => updateTwitchIO({ botUsername: e.target.value.trim() })}
                      />
                    </Field>
                    <Field
                      label="Canal donde entra el bot"
                      htmlFor={`${uid}-channel`}
                      hint={
                        suiteChannel && suiteChannel !== twitchIOSettings.channel ? (
                          <>
                            En Inicio tienes otro canal.{' '}
                            <button
                              type="button"
                              className="studio-link"
                              onClick={() => updateTwitchIO({ channel: suiteChannel })}
                            >
                              Usar {suiteChannel}
                            </button>
                          </>
                        ) : undefined
                      }
                    >
                      <input
                        id={`${uid}-channel`}
                        className="cab-inp cab-mono"
                        value={twitchIOSettings.channel}
                        placeholder="tu_canal"
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(e) => updateTwitchIO({ channel: cleanChannel(e.target.value) })}
                      />
                    </Field>
                  </div>

                  <ol className="cab-cmds">
                    <li>
                      1. Instala Python y, en una terminal, ejecuta <code className="cab-mono">{PIP_COMMAND}</code>
                    </li>
                    <li>
                      2. Copia el script y guárdalo como <code className="cab-mono">lalo_bot.py</code>
                    </li>
                    <li>
                      3. En tu copia, cambia <code className="cab-mono">{TOKEN_PLACEHOLDER}</code> por el token de la
                      cuenta del bot. El token va solo en ese archivo: no se escribe en este panel.
                    </li>
                    <li>
                      4. Ejecuta <code className="cab-mono">python lalo_bot.py</code> y déjalo abierto durante el directo
                    </li>
                  </ol>

                  <pre className="bot-script cab-mono" tabIndex={0} aria-label="Script de Python del bot">
                    <code>{script}</code>
                  </pre>

                  <div className="flex flex-wrap items-center gap-3">
                    <button type="button" className="cab-btn" onClick={copyScript}>
                      {copyState === 'copied' ? (
                        <Check className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Copy className="h-4 w-4" aria-hidden="true" />
                      )}
                      <span>{copyState === 'copied' ? 'Script copiado' : 'Copiar script'}</span>
                    </button>
                    <p className="cab-hint flex-1 basis-60">
                      Lleva {inScript.length} de {commands.length} comandos: los encendidos que tienen nombre y
                      respuesta.
                    </p>
                  </div>
                  {copyState === 'failed' && (
                    <p className="cab-error" role="alert">
                      El navegador no dejó copiar. Selecciona el texto del script y cópialo a mano.
                    </p>
                  )}

                  <p className="cab-hint">
                    El script usa{' '}
                    <a className="studio-link" href="https://github.com/TwitchIO/TwitchIO" target="_blank" rel="noreferrer">
                      TwitchIO
                    </a>
                    , de PythonistaGuild y EvieePy, con licencia MIT.
                  </p>
                </div>
              </details>
            </section>
          </div>

          {/* ---------- Probar ---------- */}
          <section className="cab-mod min-[1100px]:sticky min-[1100px]:top-4" data-tour="bot-probar">
            <h2>Probar</h2>

            <ul ref={logRef} className="bot-log" role="log" aria-label="Conversación de prueba" tabIndex={0}>
              {log.length === 0 ? (
                <li data-kind="note">Aún no has probado nada. Lo que escribas y lo que conteste el bot aparecerá aquí.</li>
              ) : (
                log.map((line) => (
                  <li key={line.id} data-kind={line.kind}>
                    {line.text}
                  </li>
                ))
              )}
            </ul>

            <form className="cab-field" onSubmit={simulate}>
              <label className="cab-label" htmlFor={`${uid}-chat`}>
                Mensaje de chat
              </label>
              <div className="flex gap-2">
                <input
                  id={`${uid}-chat`}
                  className="cab-inp cab-mono"
                  value={chatInput}
                  placeholder={example ? `${prefix}${example.name}` : `${prefix}comando`}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setChatInput(e.target.value)}
                />
                <button type="submit" className="cab-btn" disabled={!chatInput.trim()}>
                  <Send className="h-4 w-4" aria-hidden="true" />
                  <span>Enviar</span>
                </button>
              </div>
              <span className="cab-hint">
                Es una prueba dentro del panel: no se envía nada a Twitch y escribes como streamer, así que todos los
                comandos te dejan pasar.
              </span>
            </form>
          </section>
        </div>
      </div>

      {tourOpen && <GuidedTour steps={TWITCHIO_TOUR_STEPS} onClose={() => setTourOpen(false)} id={TOUR_ID} appName="Bot" />}
    </div>
  );
};
