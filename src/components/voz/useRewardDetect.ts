/**
 * src/components/voz/useRewardDetect.ts
 *
 * Detecta la recompensa de puntos del canal: escucha el chat público de forma
 * anónima hasta que alguien la canjea y devuelve su identificador.
 * Si se agota el tiempo o falla la conexión, lo dice en `message`.
 */

import { useEffect, useRef, useState } from 'react';
import tmi from 'tmi.js';

const LISTEN_MS = 90000;

export interface RewardDetect {
  detecting: boolean;
  /** Por qué se detuvo la última búsqueda sin encontrar nada; null si no hay nada que contar. */
  message: string | null;
  start: (channel: string) => void;
  cancel: () => void;
}

export function useRewardDetect(onFound: (rewardId: string) => void): RewardDetect {
  const [detecting, setDetecting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const stopRef = useRef<((why?: string) => void) | null>(null);

  useEffect(() => () => stopRef.current?.(), []);

  const start = (rawChannel: string) => {
    const channel = rawChannel.trim().toLowerCase();
    if (!channel || stopRef.current) return;
    setMessage(null);

    const client = new tmi.Client({ connection: { reconnect: false, secure: true }, channels: [channel] });
    let done = false;
    const stop = (why?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      client.removeAllListeners();
      client.disconnect().catch(() => {});
      stopRef.current = null;
      setDetecting(false);
      if (why) setMessage(why);
    };
    const timer = setTimeout(
      () => stop('Nadie canjeó la recompensa en 90 segundos. Pulsa «Detectar recompensa» y canjéala de nuevo.'),
      LISTEN_MS
    );

    client.on('message', (_channel, tags) => {
      const rewardId = tags['custom-reward-id'];
      if (rewardId) {
        onFound(String(rewardId).toLowerCase());
        stop();
      }
    });
    client.on('disconnected', () => stop('Se perdió la conexión con el chat de Twitch. Vuelve a intentarlo.'));

    stopRef.current = stop;
    setDetecting(true);
    client
      .connect()
      .catch(() => stop('No se pudo conectar con el chat de Twitch. Revisa el nombre del canal y tu conexión.'));
  };

  return { detecting, message, start, cancel: () => stopRef.current?.() };
}
