/**
 * server/ttsHandler.ts
 *
 * Controlador unificado para la síntesis de voz con Fish Audio V1.
 * Utilizado tanto por el servidor Express como por el middleware de Vite en desarrollo.
 */

import dotenv from 'dotenv';
dotenv.config();

const MAX_TTS_LENGTH = 300;

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
  const rawKey = process.env.FISH_AUDIO_API_KEY || '';
  const apiKey = rawKey.replace(/^["']|["']$/g, '').trim();

  if (!apiKey) {
    throw new Error('FISH_AUDIO_API_KEY no configurada en el servidor');
  }

  // Sanitización de modelo y reference_id (evita que un punto final en la URL como "model=s2.1-pro-free." cause error 402 en Fish Audio)
  const rawModel = (model || 's2.1-pro-free').trim().replace(/[.,;/\\]+$/, '');
  const selectedModel = rawModel.toLowerCase().includes('free') ? 's2.1-pro-free' : (rawModel || 's2.1-pro-free');
  const cleanRefId = (reference_id || '').trim().replace(/[.,;/\\]+$/, '');

  console.log(`[TTS Engine] Enviando a Fish Audio V1 (${selectedModel}, ref: ${cleanRefId || 'default'}): "${boundedText.slice(0, 30)}..."`);

  try {
    let fishResponse = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        model: selectedModel,
      },
      body: JSON.stringify({
        text: boundedText,
        reference_id: cleanRefId || undefined,
        format: 'mp3',
        normalize: true,
        latency: 'normal',
      }),
    });

    // Si la llamada con voz personalizada falla (ej. 400 por ID no existente),
    // reintentamos automáticamente con la voz base del modelo
    if (!fishResponse.ok && cleanRefId) {
      console.warn(`[Fish Audio] Voz personalizada "${reference_id}" no respondió OK (${fishResponse.status}). Reintentando con voz base...`);
      fishResponse = await fetch('https://api.fish.audio/v1/tts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          model: selectedModel,
        },
        body: JSON.stringify({
          text: boundedText,
          format: 'mp3',
          normalize: true,
          latency: 'normal',
        }),
      });
    }

    if (!fishResponse.ok) {
      const errorText = await fishResponse.text().catch(() => '');
      console.warn(`[Fish Audio API] Retornó status ${fishResponse.status}: ${errorText}`);
      throw new Error(`Fish Audio API HTTP ${fishResponse.status}: ${errorText || 'Error en síntesis'}`);
    }

    const arrayBuffer = await fishResponse.arrayBuffer();
    return {
      status: 200,
      contentType: 'audio/mpeg',
      buffer: Buffer.from(arrayBuffer),
    };
  } catch (err: any) {
    console.error('[Fish Audio Fetch Error]', err);
    throw new Error(err?.message || 'Error en síntesis de voz con Fish Audio');
  }
}
