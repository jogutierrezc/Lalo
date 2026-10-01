/**
 * server/ttsHandler.ts
 *
 * Controlador unificado para la síntesis de voz con Fish Audio V1.
 * Utilizado tanto por el servidor Express como por el middleware de Vite en desarrollo.
 */

import dotenv from 'dotenv';
dotenv.config();

const MAX_TTS_LENGTH = 1200;
const LALOPLAY_CLONED_VOICE = '37f9f4eec7624089a49b188d47588f2c';
const OLD_PRESET_VOICE = '7f92f8afb8ec43bf81429cc1c9199cb1';

const EMOTION_MAP: Record<string, string> = {
  feliz: 'happy',
  alegre: 'happy',
  contento: 'happy',
  happy: 'happy',
  susurro: 'whispering',
  susurrando: 'whispering',
  whisper: 'whispering',
  whispering: 'whispering',
  enojado: 'angry',
  enfadado: 'angry',
  molesto: 'angry',
  furioso: 'angry',
  angry: 'angry',
  triste: 'sad',
  tristeza: 'sad',
  sad: 'sad',
  risa: 'laughing',
  riendo: 'laughing',
  laugh: 'laughing',
  laughing: 'laughing',
  grito: 'shouting',
  gritando: 'shouting',
  shout: 'shouting',
  shouting: 'shouting',
  llorando: 'crying',
  llanto: 'crying',
  cry: 'crying',
  crying: 'crying',
  miedo: 'scared',
  asustado: 'scared',
  scared: 'scared',
  emocionado: 'excited',
  hype: 'excited',
  excited: 'excited',
  sorprendido: 'surprised',
  surprised: 'surprised',
  canto: 'singing',
  cantando: 'singing',
  sing: 'singing',
  singing: 'singing',
  calmado: 'calm',
  tranquilo: 'calm',
  calm: 'calm',
  suspiro: 'sigh',
  sigh: 'sigh',
  bostezo: 'yawn',
  sueno: 'yawn',
  sueño: 'yawn',
  yawn: 'yawn',
  nervioso: 'nervous',
  nervous: 'nervous',
};

function normalizeServerText(text: string): string {
  if (!text || !text.includes('[') || !text.includes(']')) return text;
  return text.replace(/\[([a-zA-ZáéíóúÁÉÍÓÚñÑ\s-_]{2,30})\]/g, (match, raw) => {
    const key = raw.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const mapped = EMOTION_MAP[key];
    return mapped ? `[${mapped}]` : match;
  });
}

export interface TTSProcessResult {
  status: number;
  contentType: string;
  buffer: Buffer;
  headers?: Record<string, string>;
}

export async function processTTSRequest(text: string, reference_id?: string, _model = 's2.1-pro-free'): Promise<TTSProcessResult> {
  const trimmedText = (text || '').trim();

  if (!trimmedText) {
    throw new Error('Parámetro text requerido');
  }

  // Normalizar emociones en servidor para compatibilidad total con enlaces antiguos en stream
  const boundedText = normalizeServerText(trimmedText.slice(0, MAX_TTS_LENGTH));
  const rawKey = process.env.FISH_AUDIO_API_KEY || '';
  const apiKey = rawKey.replace(/^["']|["']$/g, '').trim();

  if (!apiKey) {
    throw new Error('FISH_AUDIO_API_KEY no configurada en el servidor');
  }

  // Sanitización de modelo: forzar siempre s2.1-pro-free
  const selectedModel = 's2.1-pro-free';

  // Sanitización de reference_id: si viene de un enlace antiguo sin voz o con voz vieja,
  // usar SIEMPRE la voz clonada oficial de LaloPlay (37f9f4ee...)
  const cleanRefId = (reference_id || '').trim().replace(/[.,;/\\]+$/, '');
  const effectiveRefId = (!cleanRefId || cleanRefId === OLD_PRESET_VOICE || cleanRefId === 'default' || cleanRefId === 'undefined')
    ? LALOPLAY_CLONED_VOICE
    : cleanRefId;

  console.log(`[TTS Engine] Enviando a Fish Audio V1 (${selectedModel}, ref: ${effectiveRefId}): "${boundedText.slice(0, 30)}..."`);

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
        reference_id: effectiveRefId,
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
