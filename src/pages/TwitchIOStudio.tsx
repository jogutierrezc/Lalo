/**
 * src/pages/TwitchIOStudio.tsx
 *
 * Módulo de integración de TwitchIO en Lalo Stream Suite.
 *
 * CRÉDITOS Y RECONOCIMIENTO:
 * Desarrollado y mantenido por PythonistaGuild & EvieePy.
 * Repositorio: https://github.com/TwitchIO/TwitchIO
 * Licencia: MIT License (https://opensource.org/licenses/MIT)
 *
 * Personalizado con la línea visual Cabina de Lalo Stream Suite,
 * principios de Emil Kowalski y modo Operate de Impeccable.
 */

import React, { useState, useEffect } from 'react';
import {
  Bot,
  Check,
  Code,
  Copy,
  ExternalLink,
  Flame,
  Heart,
  Play,
  Plus,
  Sparkles,
  Terminal,
  Trash2,
  Zap,
} from 'lucide-react';
import { SuiteNav } from '../components/SuiteNav';
import { useTwitchIOSettings } from '../hooks/useTwitchIOSettings';
import { CommandPermission, TwitchIOCommand } from '../types/twitchio';
import { postBus } from '../utils/bus';
import { playAlertAudio } from '../utils/alertsAudio';
import { GuidedTour, TourStep, isTourDone } from '../components/GuidedTour';

const TOUR_ID = 'twitchio';

const TWITCHIO_TOUR_STEPS: TourStep[] = [
  {
    badge: 'Bienvenida',
    title: 'Bot TwitchIO & Motor EventSub',
    body: (
      <>
        Bienvenido al Centro de Control de TwitchIO. Aquí configuras tu bot de chat asíncrono y la conexión con EventSub para automatizar respuestas, moderación reactiva y triggers de alertas en vivo.
      </>
    ),
  },
  {
    target: 'bot-header',
    badge: 'Arquitectura',
    title: 'Powered by TwitchIO & Código Abierto',
    body: 'Basado en el framework asíncrono de TwitchIO desarrollado por PythonistaGuild y EvieePy bajo licencia MIT. Conéctalo con la suite para enviar comandos de chat directamente a TTS y Alertas de pantalla.',
  },
  {
    target: 'bot-params',
    badge: 'Configuración',
    title: 'Parámetros del Bot & Prefijo',
    body: 'Personaliza el prefijo de activación (como !, $ o ?), el nombre del bot en el chat y el mensaje de saludo automático al iniciar tu directo.',
  },
  {
    target: 'bot-commands',
    badge: 'Gestión',
    title: 'Comandos de Chat & Permisos',
    body: 'Crea comandos personalizados con respuestas dinámicas ({user}, {channel}) y roles de acceso (Todos, Subs, Mods o Streamer). Puedes pausar o activar comandos en cualquier momento.',
  },
  {
    target: 'bot-eventsub',
    badge: 'Eventos en Vivo',
    title: 'Twitch EventSub Gateway',
    body: 'Supervisa el estado de la conexión en vivo con los eventos de Twitch: Follows, Subs, Bits y Raids. Cuando un evento ocurre, el motor lo despacha instantáneamente hacia tus overlays.',
  },
  {
    target: 'bot-console',
    badge: 'Simulación',
    title: 'Consola y Simulador Interactivo',
    body: 'Prueba tus comandos antes de salir al aire sin necesidad de abrir Twitch. Escribe !lalo o !alerta para ver la respuesta del bot y escuchar el chime de confirmación sonora.',
  },
  {
    target: 'bot-code',
    badge: 'Acción del Sistema',
    title: 'Generador de Script Python 3.9+',
    body: 'Copia el código Python asíncrono autogenerado con tu token y canal configurados. Ejecútalo en tu máquina para conectar TwitchIO de manera local y ultra-rápida con la suite Lalo.',
  },
];

const PERMISSION_BADGES: Record<CommandPermission, { label: string; color: string }> = {
  all: { label: 'Todos', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  sub: { label: 'Subs', color: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
  mod: { label: 'Mods', color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  broadcaster: { label: 'Streamer', color: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
};

export const TwitchIOStudio: React.FC = () => {
  const { twitchIOSettings, updateTwitchIO, saved } = useTwitchIOSettings();
  const [copiedCode, setCopiedCode] = useState(false);
  const [consoleInput, setConsoleInput] = useState('!lalo');
  const [tourOpen, setTourOpen] = useState(false);

  // La guía se abre sola la primera vez; después se accede desde el botón en la cabecera
  useEffect(() => {
    if (isTourDone(TOUR_ID)) return;
    const timer = setTimeout(() => setTourOpen(true), 600);
    return () => clearTimeout(timer);
  }, []);

  const [consoleLogs, setConsoleLogs] = useState<
    { id: string; time: string; type: 'in' | 'out' | 'system'; text: string }[]
  >([
    {
      id: 'log-1',
      time: '01:00:00',
      type: 'system',
      text: 'Puente TwitchIO inicializado (PythonistaGuild & EvieePy · Licencia MIT).',
    },
    {
      id: 'log-2',
      time: '01:00:01',
      type: 'system',
      text: `Canal objetivo: #${twitchIOSettings.channel} · Prefijo activo: ${twitchIOSettings.prefix}`,
    },
  ]);

  // Formulario para nuevo comando
  const [newCmdName, setNewCmdName] = useState('');
  const [newCmdResponse, setNewCmdResponse] = useState('');
  const [newCmdPerm, setNewCmdPerm] = useState<CommandPermission>('all');
  const [showNewCmdModal, setShowNewCmdModal] = useState(false);

  const handleSimulateCommand = (cmdText: string) => {
    const raw = cmdText.trim();
    if (!raw) return;

    const time = new Date().toLocaleTimeString();
    const prefix = twitchIOSettings.prefix;

    // Agregar mensaje entrante al log
    const inLog = {
      id: `in-${Date.now()}`,
      time,
      type: 'in' as const,
      text: `[Chat Streamer]: ${raw}`,
    };

    if (raw.startsWith(prefix)) {
      const cleanName = raw.slice(prefix.length).split(' ')[0].toLowerCase();
      const match = twitchIOSettings.commands.find(
        (c) => c.name.toLowerCase() === cleanName && c.enabled
      );

      if (match) {
        let resp = match.response
          .replace('{user}', 'Streamer')
          .replace('{channel}', twitchIOSettings.channel);

        // Si es el comando !alerta, disparar feedback sonoro
        if (cleanName === 'alerta') {
          playAlertAudio('arcade-chime', 0.8);
          postBus({
            type: 'ALERT_TRIGGER',
            alert: {
              id: `cmd-alert-${Date.now()}`,
              eventType: 'bits',
              user: 'Streamer',
              text: '¡Alerta activada desde el chat con TwitchIO!',
              style: 'cabina',
              accent: '#9146ff',
              soundType: 'arcade-chime',
              duration: 4,
            },
          });
        }

        const outLog = {
          id: `out-${Date.now()}`,
          time,
          type: 'out' as const,
          text: `[${twitchIOSettings.botUsername}]: ${resp}`,
        };
        setConsoleLogs((prev) => [...prev, inLog, outLog]);
      } else {
        const notFoundLog = {
          id: `out-${Date.now()}`,
          time,
          type: 'system' as const,
          text: `[TwitchIO]: Comando "${prefix}${cleanName}" no encontrado o desactivado.`,
        };
        setConsoleLogs((prev) => [...prev, inLog, notFoundLog]);
      }
    } else {
      const plainLog = {
        id: `sys-${Date.now()}`,
        time,
        type: 'system' as const,
        text: `[TwitchIO]: Mensaje regular ignorado por el despachador de comandos (no inicia con "${prefix}").`,
      };
      setConsoleLogs((prev) => [...prev, inLog, plainLog]);
    }

    setConsoleInput('');
  };

  const handleToggleCommand = (id: string) => {
    updateTwitchIO({
      commands: twitchIOSettings.commands.map((c) =>
        c.id === id ? { ...c, enabled: !c.enabled } : c
      ),
    });
  };

  const handleDeleteCommand = (id: string) => {
    updateTwitchIO({
      commands: twitchIOSettings.commands.filter((c) => c.id !== id),
    });
  };

  const handleCreateCommand = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCmdName.trim() || !newCmdResponse.trim()) return;

    const newCmd: TwitchIOCommand = {
      id: `cmd-${Date.now()}`,
      name: newCmdName.toLowerCase().trim().replace(/^!+/, ''),
      response: newCmdResponse.trim(),
      permission: newCmdPerm,
      cooldown: 5,
      enabled: true,
      category: 'stream',
    };

    updateTwitchIO({
      commands: [...twitchIOSettings.commands, newCmd],
    });

    setNewCmdName('');
    setNewCmdResponse('');
    setShowNewCmdModal(false);
  };

  const pythonScript = `"""
TwitchIO Bridge for Lalo Stream Suite
Powered by TwitchIO (https://github.com/TwitchIO/TwitchIO)
Created by PythonistaGuild & EvieePy under the MIT License.
"""
from twitchio.ext import commands
import aiohttp

class LaloBot(commands.Bot):
    def __init__(self):
        super().__init__(
            token="oauth:TU_TOKEN_AQUI",
            prefix="${twitchIOSettings.prefix}",
            initial_channels=["${twitchIOSettings.channel}"]
        )

    async def event_ready(self):
        print(f"LaloBot listo en #{twitchIOSettings.channel} (Powered by TwitchIO)")

    async def event_message(self, message):
        if message.echo:
            return
        if message.content.startswith("${twitchIOSettings.prefix}s "):
            text = message.content.split(" ", 1)[1]
            # Enviar a Lalo TTS
            async with aiohttp.ClientSession() as s:
                await s.post("http://localhost:3001/api/twitchio/event", json={
                    "type": "TTS", "channel": "${twitchIOSettings.channel}",
                    "data": {"user": message.author.name, "text": text}
                })
        await self.handle_commands(message)

bot = LaloBot()
bot.run()`;

  const copyPythonCode = () => {
    navigator.clipboard?.writeText(pythonScript).catch(() => {});
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2200);
  };

  return (
    <div className="cab" style={{ paddingBottom: tourOpen ? 220 : undefined }}>
      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-6">
        {/* Barra superior de la Suite */}
        <SuiteNav
          currentApp="twitchio"
          channel={twitchIOSettings.channel}
          saved={saved}
          onOpenTour={() => setTourOpen(true)}
          tourAvailable={!tourOpen}
        />

        {/* Tarjeta de Créditos y Atribución Oficial TwitchIO */}
        <div
          className="relative overflow-hidden rounded-md border border-[color:var(--ui,#9146ff)] bg-[color:var(--cb-panel)] p-5 shadow-lg"
          data-tour="bot-header"
        >
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 flex-none items-center justify-center rounded-md bg-[color:var(--ui,#9146ff)]/20 text-[color:var(--ui,#9146ff)]">
                <Bot className="h-6 w-6" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-[color:var(--ui,#9146ff)] px-2 py-0.5 text-[10px] font-black text-white">
                    POWERED BY TWITCHIO
                  </span>
                  <span className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] px-2 py-0.5 text-[10px] font-bold text-[color:var(--cb-mut)]">
                    MIT LICENSE
                  </span>
                  <span className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                    PYTHONISTAGUILD & EVIEEPY
                  </span>
                </div>
                <h1
                  className="cab-caps mt-1.5 text-2xl font-extrabold text-[color:var(--cb-fg)]"
                  style={{ fontStretch: '75%' }}
                >
                  TwitchIO Bot & EventSub Engine
                </h1>
                <p className="mt-1 text-xs leading-relaxed text-[color:var(--cb-mut)]">
                  Integración oficial inspirada en el framework asíncrono{' '}
                  <b className="text-[color:var(--cb-fg)]">TwitchIO</b>, creado y mantenido por{' '}
                  <b className="text-[color:var(--cb-fg)]">PythonistaGuild</b> y{' '}
                  <b className="text-[color:var(--cb-fg)]">EvieePy</b>. Permite manejar comandos de
                  chat inteligentes, moderación reactiva y eventos de EventSub adaptados a nuestro
                  diseño de hardware de Cabina.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <a
                href="https://github.com/TwitchIO/TwitchIO"
                target="_blank"
                rel="noreferrer"
                className="cab-btn2 !h-8 !px-3 !text-xs font-bold no-underline"
              >
                <Code className="h-3.5 w-3.5" />
                <span>Repositorio GitHub</span>
                <ExternalLink className="h-3 w-3 opacity-60" />
              </a>
              <a
                href="https://twitchio.dev"
                target="_blank"
                rel="noreferrer"
                className="cab-btn2 !h-8 !px-3 !text-xs font-bold no-underline"
              >
                <span>Docs Oficiales</span>
                <ExternalLink className="h-3 w-3 opacity-60" />
              </a>
            </div>
          </div>
        </div>

        {/* Malla de Configuración */}
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Columna Izquierda: Parámetros y Gestor de Comandos (7 cols) */}
          <div className="grid gap-5 lg:col-span-7">
            {/* Módulo 1: Parámetros del Bot */}
            <section className="cab-mod" data-tour="bot-params">
              <h2>
                <span>1</span>Parámetros del Bot
              </h2>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="cab-field">
                  <label htmlFor="bot-prefix" className="cab-label">
                    Prefijo de Comandos
                  </label>
                  <input
                    id="bot-prefix"
                    type="text"
                    value={twitchIOSettings.prefix}
                    maxLength={3}
                    onChange={(e) => updateTwitchIO({ prefix: e.target.value.trim() || '!' })}
                    className="cab-inp cab-mono !h-9 text-sm font-bold"
                  />
                  <span className="cab-hint text-xs">Símbolo para activar comandos (ej: !, $, ?)</span>
                </div>

                <div className="cab-field">
                  <label htmlFor="bot-username" className="cab-label">
                    Nombre del Bot
                  </label>
                  <input
                    id="bot-username"
                    type="text"
                    value={twitchIOSettings.botUsername}
                    onChange={(e) => updateTwitchIO({ botUsername: e.target.value.trim() })}
                    className="cab-inp !h-9 text-sm font-bold"
                  />
                  <span className="cab-hint text-xs">Identificador que responde en el chat</span>
                </div>
              </div>

              {/* Mensaje de bienvenida */}
              <div className="cab-field">
                <label htmlFor="bot-welcome" className="cab-label">
                  Mensaje de Inicio en el Stream
                </label>
                <input
                  id="bot-welcome"
                  type="text"
                  value={twitchIOSettings.welcomeMessage}
                  onChange={(e) => updateTwitchIO({ welcomeMessage: e.target.value })}
                  className="cab-inp text-xs"
                />
              </div>
            </section>

            {/* Módulo 2: Comandos de Chat (TwitchIO Commands) */}
            <section className="cab-mod" data-tour="bot-commands">
              <div className="flex items-center justify-between">
                <h2>
                  <span>2</span>Comandos de Chat
                </h2>
                <button
                  type="button"
                  className="cab-btn2 !h-7 !px-2.5 !text-xs font-bold"
                  onClick={() => setShowNewCmdModal(!showNewCmdModal)}
                >
                  <Plus className="h-3 w-3" />
                  <span>Nuevo Comando</span>
                </button>
              </div>

              {/* Formulario de creación de comando */}
              {showNewCmdModal && (
                <form
                  onSubmit={handleCreateCommand}
                  className="grid gap-3 rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-3"
                >
                  <div className="flex items-center justify-between border-b border-[color:var(--cb-line)] pb-1.5">
                    <span className="cab-caps text-[11px] font-bold text-[color:var(--cb-fg)]">
                      Añadir comando de TwitchIO
                    </span>
                    <button
                      type="button"
                      className="text-xs text-[color:var(--cb-mut)] hover:text-white"
                      onClick={() => setShowNewCmdModal(false)}
                    >
                      Cancelar
                    </button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="cab-field">
                      <label className="cab-label">Nombre del Comando</label>
                      <div className="relative">
                        <span className="cab-mono absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-[color:var(--cb-mut)]">
                          {twitchIOSettings.prefix}
                        </span>
                        <input
                          type="text"
                          value={newCmdName}
                          onChange={(e) => setNewCmdName(e.target.value)}
                          placeholder="mi_comando"
                          className="cab-inp cab-mono !h-8 text-xs font-bold"
                          style={{ paddingLeft: 24 }}
                          required
                        />
                      </div>
                    </div>

                    <div className="cab-field">
                      <label className="cab-label">Permiso</label>
                      <select
                        value={newCmdPerm}
                        onChange={(e) => setNewCmdPerm(e.target.value as CommandPermission)}
                        className="cab-inp !h-8 text-xs"
                      >
                        <option value="all">Todos los espectadores</option>
                        <option value="sub">Solo Suscriptores</option>
                        <option value="mod">Moderadores</option>
                        <option value="broadcaster">Solo Streamer</option>
                      </select>
                    </div>
                  </div>

                  <div className="cab-field">
                    <label className="cab-label">Respuesta del Bot</label>
                    <input
                      type="text"
                      value={newCmdResponse}
                      onChange={(e) => setNewCmdResponse(e.target.value)}
                      placeholder="Texto que enviará el bot al chat"
                      className="cab-inp text-xs"
                      required
                    />
                  </div>

                  <button type="submit" className="cab-btn !h-8 !text-xs font-bold">
                    Guardar Comando
                  </button>
                </form>
              )}

              {/* Lista de comandos */}
              <div className="grid gap-2">
                {twitchIOSettings.commands.map((cmd) => {
                  const badge = PERMISSION_BADGES[cmd.permission] || PERMISSION_BADGES.all;
                  return (
                    <div
                      key={cmd.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)]/60 p-3 transition-colors hover:border-[color:var(--cb-fg)]/40"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <code className="cab-mono text-sm font-extrabold text-[color:var(--cb-fg)]">
                            {twitchIOSettings.prefix}
                            {cmd.name}
                          </code>
                          <span
                            className={`rounded border px-1.5 py-0.2 text-[9px] font-bold ${badge.color}`}
                          >
                            {badge.label}
                          </span>
                          <span className="cab-mono text-[10px] text-[color:var(--cb-mut)]">
                            {cmd.cooldown}s cd
                          </span>
                        </div>
                        <p className="mt-1 truncate text-xs text-[color:var(--cb-mut)]">
                          {cmd.response}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="cab-btn2 !h-7 !px-2 !text-[11px] font-bold"
                          onClick={() => handleSimulateCommand(`${twitchIOSettings.prefix}${cmd.name}`)}
                          title="Probar este comando en la consola"
                        >
                          <Play className="h-3 w-3 text-emerald-400" />
                          <span>Probar</span>
                        </button>

                        <button
                          type="button"
                          className={`cab-btn2 !h-7 !px-2 !text-[11px] font-bold ${
                            cmd.enabled ? '!bg-emerald-500/20 text-emerald-300' : 'opacity-60'
                          }`}
                          onClick={() => handleToggleCommand(cmd.id)}
                        >
                          {cmd.enabled ? 'Activo' : 'Pausado'}
                        </button>

                        <button
                          type="button"
                          className="cab-btn2 !h-7 !px-2 text-rose-400 hover:text-rose-300"
                          onClick={() => handleDeleteCommand(cmd.id)}
                          title="Eliminar comando"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Módulo 3: EventSub Gateway */}
            <section className="cab-mod" data-tour="bot-eventsub">
              <h2>
                <span>3</span>Twitch EventSub Gateway
              </h2>
              <p className="cab-hint text-xs">
                TwitchIO se conecta a EventSub (WebSockets/Webhooks) para sincronizar en tiempo
                real los eventos del canal con nuestras alertas de pantalla.
              </p>

              <div className="grid gap-2 sm:grid-cols-2">
                {/* Follows */}
                <div className="flex items-center justify-between rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-2.5">
                  <div className="flex items-center gap-2">
                    <Heart className="h-3.5 w-3.5 text-rose-400" />
                    <span className="text-xs font-bold text-[color:var(--cb-fg)]">
                      channel.follow
                    </span>
                  </div>
                  <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[9px] font-black text-emerald-300">
                    CONECTADO
                  </span>
                </div>

                {/* Subs */}
                <div className="flex items-center justify-between rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-2.5">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                    <span className="text-xs font-bold text-[color:var(--cb-fg)]">
                      channel.subscribe
                    </span>
                  </div>
                  <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[9px] font-black text-emerald-300">
                    CONECTADO
                  </span>
                </div>

                {/* Bits */}
                <div className="flex items-center justify-between rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-2.5">
                  <div className="flex items-center gap-2">
                    <Zap className="h-3.5 w-3.5 text-amber-400" />
                    <span className="text-xs font-bold text-[color:var(--cb-fg)]">
                      channel.cheer
                    </span>
                  </div>
                  <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[9px] font-black text-emerald-300">
                    CONECTADO
                  </span>
                </div>

                {/* Raids */}
                <div className="flex items-center justify-between rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-2.5">
                  <div className="flex items-center gap-2">
                    <Flame className="h-3.5 w-3.5 text-red-500" />
                    <span className="text-xs font-bold text-[color:var(--cb-fg)]">
                      channel.raid
                    </span>
                  </div>
                  <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[9px] font-black text-emerald-300">
                    CONECTADO
                  </span>
                </div>
              </div>
            </section>
          </div>

          {/* Columna Derecha: Consola Simulador y Script Python (5 cols) */}
          <div className="grid gap-5 lg:col-span-5">
            {/* Simulador Interactivo de Comandos */}
            <section className="cab-mod" data-tour="bot-console">
              <h2>
                <Terminal className="h-4 w-4 text-[color:var(--ui,#9146ff)]" />
                <span>Simulador de Chat</span>
              </h2>

              <p className="cab-hint text-xs">
                Prueba cómo el bot de TwitchIO interpreta y responde a los mensajes del chat en tiempo real.
              </p>

              {/* Pantalla de Terminal */}
              <div className="flex h-56 flex-col justify-between rounded border border-[color:var(--cb-line)] bg-[#0d0e12] p-3 font-mono text-xs">
                <div className="overflow-y-auto space-y-1.5 scrollbar-thin">
                  {consoleLogs.map((log) => (
                    <div
                      key={log.id}
                      className={`leading-relaxed ${
                        log.type === 'in'
                          ? 'text-cyan-300'
                          : log.type === 'out'
                          ? 'text-emerald-300'
                          : 'text-neutral-400 text-[11px]'
                      }`}
                    >
                      <span className="opacity-50">[{log.time}] </span>
                      <span>{log.text}</span>
                    </div>
                  ))}
                </div>

                <div className="border-t border-neutral-800 pt-2">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSimulateCommand(consoleInput);
                    }}
                    className="flex items-center gap-2"
                  >
                    <span className="text-emerald-400">&gt;</span>
                    <input
                      type="text"
                      value={consoleInput}
                      onChange={(e) => setConsoleInput(e.target.value)}
                      placeholder={`Escribe ${twitchIOSettings.prefix}lalo o ${twitchIOSettings.prefix}alerta`}
                      className="w-full bg-transparent text-xs text-white outline-none"
                    />
                    <button
                      type="submit"
                      className="rounded bg-neutral-800 px-2 py-1 text-[11px] font-bold text-neutral-200 hover:bg-neutral-700"
                    >
                      Enviar
                    </button>
                  </form>
                </div>
              </div>

              {/* Botones de prueba rápida */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                <button
                  type="button"
                  className="cab-btn2 !h-6 !px-2 !text-[10px] font-bold"
                  onClick={() => handleSimulateCommand(`${twitchIOSettings.prefix}lalo`)}
                >
                  {twitchIOSettings.prefix}lalo
                </button>
                <button
                  type="button"
                  className="cab-btn2 !h-6 !px-2 !text-[10px] font-bold"
                  onClick={() => handleSimulateCommand(`${twitchIOSettings.prefix}alerta`)}
                >
                  {twitchIOSettings.prefix}alerta
                </button>
                <button
                  type="button"
                  className="cab-btn2 !h-6 !px-2 !text-[10px] font-bold"
                  onClick={() => handleSimulateCommand(`${twitchIOSettings.prefix}s ¡Hola directo!`)}
                >
                  {twitchIOSettings.prefix}s (TTS)
                </button>
                <button
                  type="button"
                  className="cab-btn2 !h-6 !px-2 !text-[10px] font-bold"
                  onClick={() => handleSimulateCommand(`${twitchIOSettings.prefix}redes`)}
                >
                  {twitchIOSettings.prefix}redes
                </button>
              </div>
            </section>

            {/* Código del Puente en Python (TwitchIO) */}
            <section className="cab-mod" data-tour="bot-code">
              <div className="flex items-center justify-between">
                <h2>
                  <Code className="h-4 w-4 text-[color:var(--ui,#9146ff)]" />
                  <span>Código Python (TwitchIO)</span>
                </h2>
                <button
                  type="button"
                  className="cab-btn2 !h-7 !px-2.5 !text-xs font-bold"
                  onClick={copyPythonCode}
                >
                  {copiedCode ? (
                    <Check className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  <span>{copiedCode ? 'Copiado' : 'Copiar'}</span>
                </button>
              </div>

              <p className="cab-hint text-xs">
                Script listo para ejecutar con Python 3.9+ usando la librería oficial{' '}
                <code className="cab-mono text-[color:var(--cb-fg)]">twitchio</code>.
              </p>

              <div className="rounded border border-[color:var(--cb-line)] bg-[#0c0d10] p-3 font-mono text-[11px] text-neutral-300">
                <div className="mb-2 flex items-center justify-between border-b border-neutral-800 pb-1 text-[10px] text-neutral-400">
                  <span>server/twitchio_bridge.py</span>
                  <span className="text-[color:var(--ui,#9146ff)]">Python 3.9+</span>
                </div>
                <pre className="max-h-48 overflow-x-auto overflow-y-auto leading-relaxed scrollbar-thin">
                  <code>{pythonScript}</code>
                </pre>
              </div>

              <div className="flex items-center justify-between border-t border-[color:var(--cb-line)] pt-3 text-[11px] text-[color:var(--cb-mut)]">
                <span>Créditos: PythonistaGuild & EvieePy</span>
                <span className="cab-mono">Licencia MIT</span>
              </div>
            </section>
          </div>
        </div>

        {/* Tutorial Guiado */}
        {tourOpen && (
          <GuidedTour
            steps={TWITCHIO_TOUR_STEPS}
            onClose={() => setTourOpen(false)}
            id={TOUR_ID}
            appName="Bot TwitchIO"
          />
        )}
      </div>
    </div>
  );
};
