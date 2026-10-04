/**
 * useTwitchChat.ts
 *
 * Hook de React para la conexión anónima a Twitch Chat mediante tmi.js y
 * gestión de cola FIFO con sanitización '!s ' estricta.
 *
 * Aplica las reglas del streamer (rol, espera, bloqueos, tope de cola) y acepta
 * tres disparadores: el comando !s, un canje de puntos del canal y los bits.
 * Los canjes con texto y los cheers llegan por el chat público con sus
 * etiquetas, así que no hace falta iniciar sesión en Twitch.
 *
 * PREVENCIÓN DE MEMORY LEAKS (OBS Studio Browser Source):
 * OBS recarga o desmonta browser sources con frecuencia.
 * Este hook desconecta explícitamente el cliente tmi.js, desvincula todos
 * los listeners y cancela timers pendientes en la función de limpieza de useEffect.
 *
 * Además de la cola de voz, la misma conexión alimenta la capa «Chat en vivo»:
 * cada mensaje se entrega a onChatMessage y lo que borra la moderación, a
 * onChatModeration. Eventos de tmi.js usados (documentados en
 * https://github.com/tmijs/docs/blob/gh-pages/_posts/v1.4.2/2019-03-03-Events.md):
 *   message(channel, userstate, message, self), cheer(channel, userstate, message),
 *   messagedeleted(channel, username, deletedMessage, userstate['target-msg-id']),
 *   timeout(channel, username, reason, duration, userstate),
 *   ban(channel, username, reason, userstate) y clearchat(channel).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import tmi from 'tmi.js';
import { sanitizeTwitchMessage, SanitizedTTSMessage } from '../utils/twitchSanitizer';
import {
  ControlCommand,
  DEFAULT_MODERATION,
  Moderation,
  UserRole,
  REASON_QUEUE,
  REASON_RATE,
  classifyTrigger,
  evaluateMessage,
  parseControl,
  roleFromTags,
  truncateText,
  voiceText,
} from '../utils/moderation';
import { ChatDisplayMessage, ChatModerationEvent, toDisplayMessage } from '../utils/chatFeed';
import { postBus } from '../utils/bus';
import { parseVoteCommand, loadPollSettings } from '../types/polls';
import { parsePollCommand } from '../utils/pollCommands';
import { loadRouletteSettings, calculateTargetRotation, pickRandomSegment } from '../types/roulette';

export interface RejectedMessage {
  id: string;
  user: string;
  username: string;
  text: string;
  reason: string;
  at: number;
}

export interface UseTwitchChatOptions {
  channel?: string;
  enabled?: boolean;
  moderation?: Moderation;
  onControl?: (command: ControlCommand) => void;
  onRejected?: (message: RejectedMessage) => void;
  /** Cada mensaje del chat, para la capa «Chat en vivo». */
  onChatMessage?: (message: ChatDisplayMessage) => void;
  /** Mensajes borrados, usuarios expulsados o chat vaciado por la moderación. */
  onChatModeration?: (event: ChatModerationEvent) => void;
  /** Llega una raid al canal: nombre visible, usuario y cuántas personas trae. */
  onRaid?: (raid: { channel: string; login: string; viewers: number }) => void;
  /**
   * Mensaje del streamer o de un moderador que no es una orden de la voz.
   * Si devuelve true, el mensaje era un comando de otra capa y no sigue adelante.
   */
  onStaffMessage?: (message: string, sender: { name: string; role: UserRole }) => boolean;
  /**
   * Cada mensaje con sus etiquetas tal como llegan de Twitch y el rol de quien escribe.
   * Lo usa la capa «Recompensas» para ver los cheers (bits) y los canjes con texto.
   */
  onChatEvent?: (tags: tmi.ChatUserstate, message: string, role: UserRole) => void;
}

export interface UseTwitchChatReturn {
  messageQueue: SanitizedTTSMessage[];
  isConnected: boolean;
  channelName: string;
  connectionError: string | null;
  removeMessageFromQueue: (id?: string) => SanitizedTTSMessage | null;
  clearQueue: () => void;
  enqueueManualMessage: (text: string, username?: string, system?: boolean) => SanitizedTTSMessage | null;
}

export function useTwitchChat(options: UseTwitchChatOptions = {}): UseTwitchChatReturn {
  const { channel = '', enabled = true } = options;

  // Reglas y callbacks vigentes, leídos por los listeners sin reconectar el chat
  const moderationRef = useRef<Moderation>(options.moderation || DEFAULT_MODERATION);
  moderationRef.current = options.moderation || DEFAULT_MODERATION;
  const onControlRef = useRef(options.onControl);
  onControlRef.current = options.onControl;
  const onRejectedRef = useRef(options.onRejected);
  onRejectedRef.current = options.onRejected;
  const onChatMessageRef = useRef(options.onChatMessage);
  onChatMessageRef.current = options.onChatMessage;
  const onChatModerationRef = useRef(options.onChatModeration);
  onChatModerationRef.current = options.onChatModeration;
  const onRaidRef = useRef(options.onRaid);
  onRaidRef.current = options.onRaid;
  const onStaffMessageRef = useRef(options.onStaffMessage);
  onStaffMessageRef.current = options.onStaffMessage;
  const onChatEventRef = useRef(options.onChatEvent);
  onChatEventRef.current = options.onChatEvent;
  // Momentos en que el modo «todo el chat» aceptó un mensaje, para el tope por minuto
  const chatTimesRef = useRef<number[]>([]);
  const queueLengthRef = useRef(0);
  const lastAcceptedRef = useRef<Map<string, number>>(new Map());
  const seenIdsRef = useRef<string[]>([]);

  const [messageQueue, setMessageQueue] = useState<SanitizedTTSMessage[]>([]);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Referencia al cliente de tmi.js para manipulación segura en cleanup
  const clientRef = useRef<tmi.Client | null>(null);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    queueLengthRef.current = messageQueue.length;
  }, [messageQueue]);

  // Función para sacar el mensaje más antiguo de la cola (FIFO)
  const removeMessageFromQueue = useCallback((id?: string): SanitizedTTSMessage | null => {
    let removed: SanitizedTTSMessage | null = null;
    setMessageQueue((prev) => {
      if (prev.length === 0) return prev;
      if (id) {
        const index = prev.findIndex((m) => m.id === id);
        if (index !== -1) {
          removed = prev[index];
          return [...prev.slice(0, index), ...prev.slice(index + 1)];
        }
      }
      removed = prev[0];
      return prev.slice(1);
    });
    return removed;
  }, []);

  // Limpiar toda la cola
  const clearQueue = useCallback(() => {
    setMessageQueue([]);
  }, []);

  // Encolar mensaje manual (para simulaciones y pruebas desde el dashboard)
  // Con `system`, la voz lee la frase tal cual, sin anunciar quién la dice y sin tarjeta
  const enqueueManualMessage = useCallback((text: string, username = 'Streamer', system = false): SanitizedTTSMessage | null => {
    // Si no incluye !s, se lo agregamos automáticamente para permitir pruebas directas
    const formatted = text.trim().startsWith('!s ') ? text : `!s ${text}`;
    const sanitized = sanitizeTwitchMessage(formatted, {
      username,
      displayName: username,
      color: '#00E676',
    });

    if (sanitized) {
      // Las pruebas del streamer no pasan por las reglas de moderación
      const test: SanitizedTTSMessage = { ...sanitized, trigger: 'test', ...(system ? { system: true } : {}) };
      setMessageQueue((prev) => [...prev, test]);
      return test;
    }
    return null;
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    const cleanChannel = channel.replace(/^[#@]/, '').trim().toLowerCase();

    if (!enabled || !cleanChannel) {
      setIsConnected(false);
      setConnectionError(null);
      return;
    }

    // Configuración anónima para tmi.js (solo lectura del chat público)
    const client = new tmi.Client({
      options: { debug: false },
      connection: {
        reconnect: true,
        secure: true,
      },
      channels: [cleanChannel],
    });

    clientRef.current = client;

    // Listeners de eventos de conexión
    client.on('connected', (_address, _port) => {
      if (!isMountedRef.current) return;
      setIsConnected(true);
      setConnectionError(null);
      console.log(`[Twitch TMI] Conectado exitosamente al canal: #${cleanChannel}`);
    });

    client.on('disconnected', (_reason) => {
      if (!isMountedRef.current) return;
      setIsConnected(false);
      console.log(`[Twitch TMI] Desconectado del canal: #${cleanChannel}`);
    });

    // Entrada de cada mensaje: lo pasa por la voz y lo entrega a la capa de chat
    const handleChat = (tags: tmi.ChatUserstate, message: string) => {
      const id = tags.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      // tmi.js puede entregar un mismo mensaje por más de un evento
      if (seenIdsRef.current.includes(id)) return;
      seenIdsRef.current = [...seenIdsRef.current.slice(-49), id];

      // Capas que reaccionan a las etiquetas del mensaje (bits, canjes con texto): la misma conexión
      onChatEventRef.current?.(tags, message, roleFromTags(tags, cleanChannel));

      const voice = routeVoice(id, tags, message);
      onChatMessageRef.current?.(toDisplayMessage(tags, message, cleanChannel, { id, voice }));
    };

    // Órdenes de control, disparador, sanitización y reglas. Devuelve true si la voz va a leer el mensaje
    const routeVoice = (id: string, tags: tmi.ChatUserstate, message: string): boolean => {
      const moderation = moderationRef.current;
      const username = (tags.username || 'viewer').toLowerCase();
      const displayName = tags['display-name'] || tags.username || 'viewer';
      const role = roleFromTags(tags, cleanChannel);

      // Órdenes del streamer y los moderadores: !s skip, !skip, !s pausa, !pausa, !s block usuario...
      const control = parseControl(message);
      if (control && (role === 'broadcaster' || role === 'mod')) {
        const enrichedControl = {
          ...control,
          sender: displayName,
          senderRole: role,
        };
        if (control.action === 'reload') {
          console.log('[Twitch Chat] Comando de recarga remota recibido. Actualizando overlay...');
          window.location.reload();
          return false;
        }
        onControlRef.current?.(enrichedControl);
        return false;
      }

      // Comandos de moderación de otras capas (saludo de raid: !so, !clip, !cortar)
      if ((role === 'broadcaster' || role === 'mod') && onStaffMessageRef.current?.(message, { name: displayName, role })) {
        return false;
      }

      // Comandos de moderación para Encuestas y Batallas (!poll, !encuesta, !batalla, !versus)
      const pollCmd = parsePollCommand(message);
      if (pollCmd && (role === 'broadcaster' || role === 'mod')) {
        if (pollCmd.action === 'stop') {
          postBus({
            type: 'POLL_STOP',
            user: displayName,
          });
          onControlRef.current?.({
            action: 'poll_stop',
            sender: displayName,
            senderRole: role,
          });
        } else {
          const currentSettings = loadPollSettings();
          const title = pollCmd.title || currentSettings.activeBattleTitle;
          const optA = pollCmd.optionA || currentSettings.options[0].label;
          const optB = pollCmd.optionB || currentSettings.options[1].label;
          const durationSec = pollCmd.durationSec || currentSettings.durationSec || 60;

          postBus({
            type: 'POLL_START',
            poll: {
              title,
              optionA: { label: optA, sublabel: '!voto 1 o 1', color: currentSettings.options[0].color || '#00e5ff' },
              optionB: { label: optB, sublabel: '!voto 2 o 2', color: currentSettings.options[1].color || '#ff0055' },
              durationSec,
              startedBy: displayName,
              startedByRole: role,
            },
          });

          onControlRef.current?.({
            action: 'poll_start',
            sender: displayName,
            senderRole: role,
            user: title,
          });
        }
        return false;
      }

      // Votos en tiempo real para Batallas & Encuestas (1, 2, a, b, !voto 1, !voto 2, !1, !2, etc.)
      const voteOption = parseVoteCommand(message);
      if (voteOption !== null) {
        postBus({
          type: 'POLL_VOTE',
          option: voteOption,
          user: displayName,
        });
      }

      // Activación remota de la Ruleta de Castigos (!ruleta, !spin, !wheel)
      const cleanMsg = message.trim().toLowerCase();
      if (cleanMsg === '!ruleta' || cleanMsg === '!spin' || cleanMsg === '!wheel') {
        const rs = loadRouletteSettings();
        const activeSegments = rs.segments.filter((s) => s.enabled);
        if (activeSegments.length > 0) {
          const picked = pickRandomSegment(activeSegments);
          if (picked) {
            const finalRotation = calculateTargetRotation(
              picked.index,
              activeSegments.length,
              0,
              5
            );
            postBus({
              type: 'ROULETTE_SPIN',
              spin: {
                id: `spin-chat-${Date.now()}`,
                user: displayName,
                winnerSegment: picked.segment,
                winnerIndex: picked.index,
                totalActiveSegments: activeSegments.length,
                startRotation: 0,
                finalRotation,
                spinDurationSec: rs.spinDurationSec || 6.0,
                screenShake: rs.screenShake,
                confetti: rs.confetti,
                victorySoundType: rs.victorySoundType,
                victoryCustomAudioUrl: rs.victoryCustomAudioUrl,
                victoryCustomAudioVolume: rs.victoryCustomAudioVolume ?? 0.85,
                showWinnerBanner: rs.showWinnerBanner,
                winnerBannerDurationSec: rs.winnerBannerDurationSec || 8,
                ttsAnnounceSpin: rs.ttsAnnounceSpin !== false,
                ttsAnnounceWinner: rs.ttsAnnounceWinner !== false,
              },
            });
          }
        }
      }

      const trigger = classifyTrigger(moderation, message, tags, role);
      if (!trigger) return false;

      // El texto a leer va sin el comando de voz; la sanitización espera el prefijo !s
      const sanitized = sanitizeTwitchMessage(`!s ${voiceText(moderation, message, tags)}`, {
        id,
        username,
        displayName,
        color: tags.color || '#bf94ff',
        channel: cleanChannel,
        timestamp: tags['tmi-sent-ts'] ? Number(tags['tmi-sent-ts']) : Date.now(),
      });
      if (!sanitized) return false;

      const text = truncateText(sanitized.cleanText, moderation.maxLength);
      const now = Date.now();
      chatTimesRef.current = chatTimesRef.current.filter((at) => now - at < 60000);
      const verdict = evaluateMessage(moderation, {
        username,
        role,
        text,
        trigger,
        now,
        lastAccepted: lastAcceptedRef.current,
        queueLength: queueLengthRef.current,
        chatLastMinute: chatTimesRef.current.length,
      });

      if (!verdict.ok) {
        // Leyendo todo el chat, lo que no cabe se descarta en silencio: no llena el registro
        const quiet = trigger === 'chat' && (verdict.reason === REASON_RATE || verdict.reason === REASON_QUEUE);
        if (!quiet) onRejectedRef.current?.({ id, user: displayName, username, text, reason: verdict.reason, at: now });
        return false;
      }

      if (trigger === 'chat') chatTimesRef.current.push(now);
      lastAcceptedRef.current.set(username, now);
      queueLengthRef.current += 1;
      const bits = Number(tags.bits) || undefined;
      setMessageQueue((prev) => [...prev, { ...sanitized, cleanText: text, trigger, bits, role }]);
      return true;
    };

    // Mensajes normales (incluye los canjes de puntos con texto) y cheers con bits
    client.on('message', (_channel, tags, message, self) => {
      if (self || !isMountedRef.current) return;
      handleChat(tags, message);
    });
    client.on('cheer', (_channel, tags, message) => {
      if (!isMountedRef.current) return;
      handleChat(tags, message);
    });

    // Raid entrante. tmi.js la emite también en conexiones anónimas, a partir del aviso
    // USERNOTICE con msg-id «raid»: raided(channel, username, viewers, tags), donde username es
    // el nombre visible (msg-param-displayName) y tags['msg-param-login'] el usuario.
    // Los tipos instalados (@types/tmi.js) solo declaran los tres primeros argumentos.
    (client as unknown as { on: (event: 'raided', listener: (...args: unknown[]) => void) => void }).on(
      'raided',
      (_channel, username, viewers, tags) => {
        if (!isMountedRef.current) return;
        const info = (tags && typeof tags === 'object' ? tags : {}) as Record<string, unknown>;
        const name = typeof username === 'string' && username ? username : String(info['msg-param-login'] || '');
        const login = String(info['msg-param-login'] || info.login || name).toLowerCase();
        const count = Number(viewers);
        if (name) onRaidRef.current?.({ channel: name, login, viewers: Number.isFinite(count) ? count : 0 });
      }
    );

    // Moderación: lo que se borra en Twitch sale también de la capa de chat
    client.on('messagedeleted', (_channel, _username, _deleted, userstate) => {
      const target = userstate?.['target-msg-id'];
      if (isMountedRef.current && target) onChatModerationRef.current?.({ type: 'delete', id: target });
    });
    const dropUser = (_channel: string, username: string) => {
      if (isMountedRef.current && username) onChatModerationRef.current?.({ type: 'user', username: username.toLowerCase() });
    };
    client.on('timeout', dropUser);
    client.on('ban', dropUser);
    client.on('clearchat', () => {
      if (isMountedRef.current) onChatModerationRef.current?.({ type: 'clear' });
    });

    // Iniciar conexión
    client
      .connect()
      .catch((err) => {
        if (!isMountedRef.current) return;
        console.error('[Twitch TMI] Error al conectar con Twitch:', err);
        setIsConnected(false);
        setConnectionError(typeof err === 'string' ? err : 'Error al conectar con Twitch');
      });

    // Cleanup estricto para evitar memory leaks en OBS Studio
    return () => {
      isMountedRef.current = false;
      if (clientRef.current) {
        clientRef.current.removeAllListeners();
        clientRef.current.disconnect().catch(() => {});
        clientRef.current = null;
      }
    };
  }, [channel, enabled]);

  return {
    messageQueue,
    isConnected,
    channelName: channel,
    connectionError,
    removeMessageFromQueue,
    clearQueue,
    enqueueManualMessage,
  };
}
