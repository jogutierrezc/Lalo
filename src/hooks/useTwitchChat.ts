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
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import tmi from 'tmi.js';
import { sanitizeTwitchMessage, SanitizedTTSMessage } from '../utils/twitchSanitizer';
import {
  ControlCommand,
  DEFAULT_MODERATION,
  Moderation,
  classifyTrigger,
  evaluateMessage,
  parseControl,
  roleFromTags,
  stripCheermotes,
  truncateText,
} from '../utils/moderation';
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
}

export interface UseTwitchChatReturn {
  messageQueue: SanitizedTTSMessage[];
  isConnected: boolean;
  channelName: string;
  connectionError: string | null;
  removeMessageFromQueue: (id?: string) => SanitizedTTSMessage | null;
  clearQueue: () => void;
  enqueueManualMessage: (text: string, username?: string) => SanitizedTTSMessage | null;
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
  const enqueueManualMessage = useCallback((text: string, username = 'Streamer'): SanitizedTTSMessage | null => {
    // Si no incluye !s, se lo agregamos automáticamente para permitir pruebas directas
    const formatted = text.trim().startsWith('!s ') ? text : `!s ${text}`;
    const sanitized = sanitizeTwitchMessage(formatted, {
      username,
      displayName: username,
      color: '#00E676',
    });

    if (sanitized) {
      // Las pruebas del streamer no pasan por las reglas de moderación
      const test: SanitizedTTSMessage = { ...sanitized, trigger: 'test' };
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

    // Procesa un mensaje del chat: órdenes de control, disparador, sanitización y reglas
    const handleChat = (tags: tmi.ChatUserstate, message: string) => {
      const id = tags.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      // tmi.js puede entregar un mismo mensaje por más de un evento
      if (seenIdsRef.current.includes(id)) return;
      seenIdsRef.current = [...seenIdsRef.current.slice(-49), id];

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
          return;
        }
        onControlRef.current?.(enrichedControl);
        return;
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
        return;
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
      if (!trigger) return;

      // Canjes y bits no llevan el prefijo !s: se añade para reutilizar la sanitización
      const body = tags.bits ? stripCheermotes(message) : message;
      const sanitized = sanitizeTwitchMessage(/^!s\s/i.test(body.trim()) ? body : `!s ${body}`, {
        id,
        username,
        displayName,
        color: tags.color || '#bf94ff',
        channel: cleanChannel,
        timestamp: tags['tmi-sent-ts'] ? Number(tags['tmi-sent-ts']) : Date.now(),
      });
      if (!sanitized) return;

      const text = truncateText(sanitized.cleanText, moderation.maxLength);
      const now = Date.now();
      const verdict = evaluateMessage(moderation, {
        username,
        role,
        text,
        trigger,
        now,
        lastAccepted: lastAcceptedRef.current,
        queueLength: queueLengthRef.current,
      });

      if (!verdict.ok) {
        onRejectedRef.current?.({ id, user: displayName, username, text, reason: verdict.reason, at: now });
        return;
      }

      lastAcceptedRef.current.set(username, now);
      queueLengthRef.current += 1;
      const bits = Number(tags.bits) || undefined;
      setMessageQueue((prev) => [...prev, { ...sanitized, cleanText: text, trigger, bits, role }]);
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
