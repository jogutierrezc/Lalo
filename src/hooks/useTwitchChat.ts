/**
 * useTwitchChat.ts
 *
 * Hook de React para la conexión anónima a Twitch Chat mediante tmi.js y
 * gestión de cola FIFO con sanitización '!s ' estricta.
 *
 * PREVENCIÓN DE MEMORY LEAKS (OBS Studio Browser Source):
 * OBS recarga o desmonta browser sources con frecuencia.
 * Este hook desconecta explícitamente el cliente tmi.js, desvincula todos
 * los listeners y cancela timers pendientes en la función de limpieza de useEffect.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import tmi from 'tmi.js';
import { sanitizeTwitchMessage, SanitizedTTSMessage } from '../utils/twitchSanitizer';

export interface UseTwitchChatOptions {
  channel?: string;
  enabled?: boolean;
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

  const [messageQueue, setMessageQueue] = useState<SanitizedTTSMessage[]>([]);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Referencia al cliente de tmi.js para manipulación segura en cleanup
  const clientRef = useRef<tmi.Client | null>(null);
  const isMountedRef = useRef<boolean>(true);

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
      setMessageQueue((prev) => [...prev, sanitized]);
      return sanitized;
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

    // Evento de recepción de mensajes en el chat
    client.on('message', (_channel, tags, message, self) => {
      if (self || !isMountedRef.current) return;

      // Comando especial de actualización remota para el streamer / moderadores
      const trimmedLower = message.trim().toLowerCase();
      const isBroadcasterOrMod =
        tags.badges?.broadcaster === '1' ||
        tags.mod === true ||
        tags.username?.toLowerCase() === cleanChannel;

      if (
        (trimmedLower === '!s reload' ||
          trimmedLower === '!s update' ||
          trimmedLower === '!s actualizar') &&
        isBroadcasterOrMod
      ) {
        console.log('[Twitch Chat] Comando de recarga remota recibido. Actualizando overlay...');
        window.location.reload();
        return;
      }

      const sanitized = sanitizeTwitchMessage(message, {
        id: tags.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        username: tags.username || 'viewer',
        displayName: tags['display-name'] || tags.username || 'viewer',
        color: tags.color || '#bf94ff',
        channel: cleanChannel,
        timestamp: tags['tmi-sent-ts'] ? Number(tags['tmi-sent-ts']) : Date.now(),
      });

      // Solo encolar si el mensaje cumplió con el trigger !s y fue validado
      if (sanitized) {
        setMessageQueue((prev) => {
          // Evitar mensajes duplicados por ID
          if (prev.some((m) => m.id === sanitized.id)) {
            return prev;
          }
          return [...prev, sanitized];
        });
      }
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
