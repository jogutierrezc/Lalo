/**
 * server/ttsHandler.ts
 *
 * Controlador unificado para la síntesis de voz con Fish Audio V1.
 * Utilizado tanto por el servidor Express como por el middleware de Vite en desarrollo.
 */

import dotenv from 'dotenv';
dotenv.config();

const MAX_TTS_LENGTH = 200;

/**
 * Genera un buffer WAV de audio sintético suave para pruebas
 * cuando no hay API Key de Fish Audio configurada.
 */
export function generateFallbackBeepBuffer(durationSec = 1.8, freq = 440): Buffer {
  const sampleRate = 22050;
  const numSamples = Math.floor(sampleRate * durationSec);
  const blockAlign = 2; // 16-bit mono
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34);

  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Onda senoidal con envolvente suave para evitar chasquidos
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.sin((Math.PI * i) / numSamples);
    const sample = Math.sin(2 * Math.PI * freq * t) * envelope * 0.45;
    const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
    buffer.writeInt16LE(intSample, 44 + i * 2);
  }

  return buffer;
}

export interface TTSProcessResult {
  status: number;
  contentType: string;
  buffer: Buffer;
  headers?: Record<string, string>;
}

export async function processTTSRequest(text: string, reference_id?: string, model = 's2.1-pro-free'): Promise<TTSProcessResult> {
  const trimmedText = (text || '').trim();

  if (!trimmedText) {
    throw new Error('Parámetro text requerido');
  }

  const boundedText = trimmedText.slice(0, MAX_TTS_LENGTH);
  const apiKey = process.env.FISH_AUDIO_API_KEY;

  // Si no hay API key en .env, devolvemos el audio de simulación sin fallar
  if (!apiKey) {
    console.log(`[TTS Engine] Sin API Key en .env: Generando audio de prueba para: "${boundedText.slice(0, 30)}..."`);
    const fallbackDuration = Math.min(3.5, Math.max(1.2, boundedText.length * 0.08));
    const fallbackBuffer = generateFallbackBeepBuffer(fallbackDuration, 480);
    return {
      status: 200,
      contentType: 'audio/wav',
      buffer: fallbackBuffer,
      headers: {
        'X-TTS-Mode': 'simulation-fallback',
      },
    };
  }

  const selectedModel = model || 's2.1-pro-free';
  console.log(`[TTS Engine] Enviando a Fish Audio V1 (${selectedModel}): "${boundedText.slice(0, 30)}..."`);

  try {
    const fishResponse = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        model: selectedModel,
      },
      body: JSON.stringify({
        text: boundedText,
        reference_id: reference_id || undefined,
        format: 'mp3',
        normalize: true,
        latency: 'normal',
      }),
    });

    if (!fishResponse.ok) {
      console.warn(`[Fish Audio API] Retornó status ${fishResponse.status}. Usando fallback para no interrumpir el stream.`);
      // En caso de error aguas arriba (ej. cuota excedida o clave inválida), no rompemos la cola del streamer
      const fallbackBuffer = generateFallbackBeepBuffer(2.0, 380);
      return {
        status: 200,
        contentType: 'audio/wav',
        buffer: fallbackBuffer,
        headers: {
          'X-TTS-Mode': 'api-error-fallback',
          'X-Upstream-Status': String(fishResponse.status),
        },
      };
    }

    const arrayBuffer = await fishResponse.arrayBuffer();
    return {
      status: 200,
      contentType: 'audio/mpeg',
      buffer: Buffer.from(arrayBuffer),
    };
  } catch (err) {
    console.error('[Fish Audio Fetch Error]', err);
    // Resiliencia total: siempre retornar audio válido
    const fallbackBuffer = generateFallbackBeepBuffer(1.8, 350);
    return {
      status: 200,
      contentType: 'audio/wav',
      buffer: fallbackBuffer,
      headers: {
        'X-TTS-Mode': 'network-error-fallback',
      },
    };
  }
}
