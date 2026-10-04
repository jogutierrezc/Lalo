/**
 * src/pages/TwitchIOStudio.tsx
 *
 * Bot del chat. La página es la lista de comandos: cada uno se edita en su
 * propia fila. A la derecha se prueban sin salir del panel.
 *
 * El bot no corre en el panel: es un script de Python que el streamer ejecuta
 * en su equipo. Por eso aquí no hay ningún indicador de conexión.
 *
 * El script usa TwitchIO (https://github.com/TwitchIO/TwitchIO), de
 * PythonistaGuild y EvieePy, con licencia MIT.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, Copy, Plus, Send } from 'lucide-react';
import { SuiteNav } from '../components/SuiteNav';
import { Field, UndoNote, useUndo } from '../components/studio/StudioKit';
import { useTwitchIOSettings } from '../hooks/useTwitchIOSettings';
import { CommandPermission, TwitchIOCommand } from '../types/twitchio';
import { loadSettings } from '../types/settings';
import { postBus } from '../utils/bus';
import { playAlertAudio } from '../utils/alertsAudio';
import { GuidedTour, TourStep, isTourDone } from '../components/GuidedTour';
import {
  buildPythonScript,
  cleanChannel,
  cleanCommandName,
  fillTemplate,
  PIP_COMMAND,
  scriptCommands,
  TOKEN_PLACEHOLDER,
} from '../components/bot/pythonScript';
import '../styles/inicio-bot.css';

const TOUR_ID = 'twitchio';

const TWITCHIO_TOUR_STEPS: TourStep[] = [
  {
    badge: 'Bienvenida',
    title: 'Bot del chat',
    body: 'Aquí decides qué responde el bot cuando alguien escribe un comando en tu chat.',
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
    badge: 'Puesta en marcha',
    title: 'Llévalo a tu equipo',
    body: 'El bot funciona en tu equipo. Copia el script, pega tu token y ejecútalo con Python.',
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

export const TwitchIOStudio: React.FC = () => {
  const { twitchIOSettings, updateTwitchIO, saved } = useTwitchIOSettings();
  const undo = useUndo<TwitchIOCommand[]>();
  const uid = useId();

  const [tourOpen, setTourOpen] = useState(false);
  const [addedId, setAddedId] = useState<string | null>(null);
  // Mientras se escribe, el prefijo puede quedar vacío; al salir del campo vuelve a «!»
  const [prefixDraft, setPrefixDraft] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [log, setLog] = useState<LogLine[]>([]);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [suiteChannel] = useState(() => loadSettings().channel.trim());

  const logRef = useRef<HTMLUListElement | null>(null);
  const lineId = useRef(0);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commands = twitchIOSettings.commands;
  const prefix = twitchIOSettings.prefix || '!';
  const botName = twitchIOSettings.botUsername || 'LaloBot';
  const activeCount = commands.filter((command) => command.enabled).length;
  const inScript = scriptCommands(commands, prefix);
  const script = buildPythonScript(twitchIOSettings);

  // Nombres repetidos: el bot solo puede atender al primero
  const names = commands.map((command) => cleanCommandName(command.name, prefix)).filter(Boolean);
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

  // La conversación de prueba queda siempre en la última línea
  useEffect(() => {
    const box = logRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [log]);

  // ---------- Comandos ----------
  const patchCommand = (id: string, patch: Partial<TwitchIOCommand>) => {
    updateTwitchIO({ commands: commands.map((command) => (command.id === id ? { ...command, ...patch } : command)) });
  };

  const addCommand = () => {
    const id = `cmd-${Date.now()}`;
    setAddedId(id);
    updateTwitchIO({
      commands: [
        ...commands,
        { id, name: '', response: '', permission: 'all', cooldown: 5, enabled: true, category: 'stream' },
      ],
    });
  };

  const removeCommand = (command: TwitchIOCommand) => {
    undo.offer(command.name ? `Se quitó ${prefix}${command.name}.` : 'Se quitó un comando sin nombre.', commands);
    updateTwitchIO({ commands: commands.filter((entry) => entry.id !== command.id) });
  };

  const restoreCommands = () => {
    if (!undo.pending) return;
    updateTwitchIO({ commands: undo.pending.snapshot });
    undo.clear();
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
      setCopyState('copied');
      copyTimer.current = setTimeout(() => setCopyState('idle'), 2200);
    } catch {
      setCopyState('failed');
    }
  };

  const example = commands.find((command) => command.enabled && command.name);

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
            {/* ---------- Comandos ---------- */}
            <section className="cab-mod" data-tour="bot-comandos">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2>Comandos</h2>
                <p className="cab-hint">
                  {activeCount} de {commands.length} encendidos
                </p>
              </div>

              {commands.length === 0 ? (
                <p className="cab-note">
                  Todavía no hay comandos. Pulsa «Nuevo comando», ponle un nombre (por ejemplo, redes) y escribe lo que
                  debe contestar el bot.
                </p>
              ) : (
                <ul className="cab-rows !max-h-none">
                  {commands.map((command) => {
                    const label = command.name ? `${prefix}${command.name}` : 'comando sin nombre';
                    return (
                      <li key={command.id} className="bot-cmd">
                        <input
                          type="checkbox"
                          className="cab-tog"
                          checked={command.enabled}
                          aria-label={`Encender ${label}`}
                          onChange={(e) => patchCommand(command.id, { enabled: e.target.checked })}
                        />
                        <div className="bot-cmd-name">
                          <span className="cab-mono" aria-hidden="true">
                            {prefix}
                          </span>
                          <input
                            className="cab-inp cab-mono"
                            value={command.name}
                            placeholder="nombre"
                            aria-label="Nombre del comando"
                            autoComplete="off"
                            spellCheck={false}
                            maxLength={25}
                            autoFocus={command.id === addedId}
                            onChange={(e) => patchCommand(command.id, { name: cleanCommandName(e.target.value, prefix) })}
                          />
                        </div>
                        <input
                          className="cab-inp bot-cmd-reply"
                          value={command.response}
                          placeholder="Lo que contesta el bot"
                          aria-label={`Respuesta de ${label}`}
                          maxLength={450}
                          onChange={(e) => patchCommand(command.id, { response: e.target.value })}
                        />
                        <select
                          className="cab-inp bot-cmd-who"
                          value={command.permission}
                          aria-label={`Quién puede usar ${label}`}
                          onChange={(e) => patchCommand(command.id, { permission: e.target.value as CommandPermission })}
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
                          onClick={() => removeCommand(command)}
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

              {undo.pending && <UndoNote label={undo.pending.label} onUndo={restoreCommands} />}

              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className="cab-btn2" onClick={addCommand}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  <span>Nuevo comando</span>
                </button>
                <p className="cab-hint flex-1 basis-60">
                  En la respuesta, <span className="cab-mono">{'{user}'}</span> se cambia por quien escribe y{' '}
                  <span className="cab-mono">{'{channel}'}</span> por tu canal.
                </p>
              </div>
            </section>

            {/* ---------- Puesta en marcha ---------- */}
            <section className="cab-mod" data-tour="bot-arranque">
              <h2>Puesta en marcha</h2>
              <p className="cab-note">
                El bot funciona en tu equipo, no en este panel. Por eso aquí no se puede saber si está encendido: no hay
                indicador de conexión. Cuando cambies algo en esta página, copia el script otra vez y vuelve a
                ejecutarlo.
              </p>

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
                        value={prefixDraft ?? twitchIOSettings.prefix}
                        maxLength={3}
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(e) => {
                          const next = e.target.value.replace(/\s+/g, '');
                          setPrefixDraft(next);
                          if (next) updateTwitchIO({ prefix: next });
                        }}
                        onBlur={() => {
                          if (prefixDraft === '') updateTwitchIO({ prefix: '!' });
                          setPrefixDraft(null);
                        }}
                      />
                    </Field>
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
                  </div>
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
                  <Field
                    label="Mensaje de bienvenida"
                    htmlFor={`${uid}-welcome`}
                    hint="El bot lo escribe en el chat al entrar. Déjalo vacío si no quieres saludo."
                  >
                    <input
                      id={`${uid}-welcome`}
                      className="cab-inp"
                      value={twitchIOSettings.welcomeMessage}
                      maxLength={450}
                      onChange={(e) => updateTwitchIO({ welcomeMessage: e.target.value })}
                    />
                  </Field>
                </div>
              </details>

              <details className="studio-details">
                <summary>Script de Python</summary>
                <div>
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
                </div>
              </details>

              <p className="cab-hint">
                El script usa{' '}
                <a className="studio-link" href="https://github.com/TwitchIO/TwitchIO" target="_blank" rel="noreferrer">
                  TwitchIO
                </a>
                , de PythonistaGuild y EvieePy, con licencia MIT.
              </p>
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
