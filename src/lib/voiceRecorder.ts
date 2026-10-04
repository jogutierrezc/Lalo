/**
 * src/lib/voiceRecorder.ts
 *
 * Convierte lo que graba el navegador en el audio que se manda a Fish Audio.
 *
 * El navegador graba normalmente en webm con opus, un formato que la
 * documentación de Fish Audio no nombra entre los que acepta (wav, mp3, m4a y
 * opus). Para no depender de eso, la grabación se decodifica aquí y se vuelve a
 * escribir como WAV de un canal, 16 bits y 24 kHz: un minuto pesa 2,9 MB y cabe
 * en un envío al servidor.
 */

import { RECORD_SAMPLE_RATE, encodeWav } from '../../server/voices/rules';

export interface PreparedRecording {
  wav: Uint8Array;
  /** Duración real del audio, medida al decodificarlo. */
  seconds: number;
}

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  const scope = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

/** Lanza un Error si el navegador no puede decodificar la grabación. */
export async function recordingToWav(blob: Blob): Promise<PreparedRecording> {
  const Ctor = audioContextCtor();
  if (!Ctor || typeof OfflineAudioContext === 'undefined') {
    throw new Error('Este navegador no puede preparar la grabación.');
  }
  const context = new Ctor();
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(await blob.arrayBuffer());
  } finally {
    void context.close().catch(() => undefined);
  }
  if (decoded.length === 0) return { wav: encodeWav(new Float32Array(0), RECORD_SAMPLE_RATE), seconds: 0 };

  // Un contexto sin altavoces mezcla a un canal y cambia la frecuencia de muestreo
  const frames = Math.max(1, Math.ceil(decoded.duration * RECORD_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, frames, RECORD_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return { wav: encodeWav(rendered.getChannelData(0), RECORD_SAMPLE_RATE), seconds: decoded.duration };
}
