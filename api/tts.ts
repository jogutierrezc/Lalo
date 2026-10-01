/**
 * api/tts.ts
 *
 * Handler Serverless autónomo para Vercel Functions.
 * Expone la ruta POST /api/tts directamente al desplegar en Vercel.
 *
 * RESILIENCIA Y LIMPIEZA DE AUDIO:
 * - Sin pitidos ni zumbidos electrónicos: Si Fish Audio falla o no hay clave, retorna error HTTP 502
 *   para que el Widget active de inmediato la voz nativa del navegador (Web Speech API) de forma fluida.
 * - Sanitización estricta de FISH_AUDIO_API_KEY (elimina comillas accidentales y espacios al pegar en Vercel).
 * - Reintento automático con voz base si el reference_id de la voz personalizada falla (400 / permisos).
 * - CORS universal y compatibilidad total con Node.js en Vercel Serverless.
 */

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

interface TTSProcessResult {
  status: number;
  contentType: string;
  buffer: Buffer;
  headers?: Record<string, string>;
}

async function processTTSRequest(text: string, reference_id?: string, _model = 's2.1-pro-free'): Promise<TTSProcessResult> {
  const trimmedText = (text || '').trim();

  if (!trimmedText) {
    throw new Error('Parámetro text requerido');
  }

  // Normalizar emociones en servidor para compatibilidad total con enlaces antiguos en stream
  const boundedText = normalizeServerText(trimmedText.slice(0, MAX_TTS_LENGTH));
  const rawKey = process.env.FISH_AUDIO_API_KEY || '';
  const apiKey = rawKey.replace(/^["']|["']$/g, '').trim();

  if (!apiKey) {
    throw new Error('FISH_AUDIO_API_KEY no configurada en las variables de entorno de Vercel');
  }

  // Modelo: forzar siempre el gratuito s2.1-pro-free sin costo
  const selectedModel = 's2.1-pro-free';

  // Sanitización de reference_id: si viene de un enlace antiguo sin voz o con la voz de muestra previa,
  // usar SIEMPRE la voz clonada oficial de LaloPlay (37f9f4ee...)
  const cleanRefId = (reference_id || '').trim().replace(/[.,;/\\]+$/, '');
  const effectiveRefId = (!cleanRefId || cleanRefId === OLD_PRESET_VOICE || cleanRefId === 'default' || cleanRefId === 'undefined')
    ? LALOPLAY_CLONED_VOICE
    : cleanRefId;

  console.log(`[TTS Engine Vercel] Solicitando Fish Audio (${selectedModel}, ref: ${effectiveRefId}): "${boundedText.slice(0, 30)}..."`);

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

  // Si la voz personalizada falla (ej. 400 porque el ID no existe o no tiene permiso),
  // reintentamos automáticamente con la voz base del modelo para no dejar sin audio al stream
  if (!fishResponse.ok && cleanRefId) {
    console.warn(`[Fish Audio Vercel] Voz personalizada "${reference_id}" retornó ${fishResponse.status}. Reintentando con voz base por defecto...`);
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
    console.warn(`[Fish Audio Vercel] API falló con status ${fishResponse.status}: ${errorText}`);
    throw new Error(`Fish Audio API HTTP ${fishResponse.status}: ${errorText || 'Error en síntesis'}`);
  }

  const arrayBuffer = await fishResponse.arrayBuffer();
  return {
    status: 200,
    contentType: 'audio/mpeg',
    buffer: Buffer.from(arrayBuffer),
  };
}

export default async function handler(req: any, res: any) {
  // CORS universal para OBS Studio y cualquier navegador
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    if (typeof res.status === 'function') {
      return res.status(200).end();
    }
    res.statusCode = 200;
    return res.end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    if (typeof res.status === 'function') {
      return res.status(405).json({ error: 'Método no permitido. Usa POST.' });
    }
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Método no permitido. Usa POST.' }));
  }

  try {
    let body = req.body;

    // Si req.body aún no ha sido parseado (stream en Node nativo)
    if (!body && typeof req.on === 'function') {
      body = await new Promise((resolve) => {
        let chunkData = '';
        req.on('data', (c: any) => { chunkData += c; });
        req.on('end', () => {
          try { resolve(JSON.parse(chunkData || '{}')); }
          catch { resolve({}); }
        });
        req.on('error', () => resolve({}));
      });
    } else if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        if (typeof res.status === 'function') {
          return res.status(400).json({ error: 'Payload JSON inválido' });
        }
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ error: 'Payload JSON inválido' }));
      }
    }

    const { text, reference_id, model } = body || {};

    if (!text || typeof text !== 'string') {
      if (typeof res.status === 'function') {
        return res.status(400).json({ error: 'Parámetro text requerido' });
      }
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: 'Parámetro text requerido' }));
    }

    const result = await processTTSRequest(text, reference_id, model);

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Length', result.buffer.length);
    res.setHeader('Cache-Control', 'no-cache');
    if (result.headers) {
      Object.entries(result.headers).forEach(([k, v]) => res.setHeader(k, v));
    }

    if (typeof res.status === 'function') {
      res.status(result.status);
    } else {
      res.statusCode = result.status;
    }

    if (typeof res.send === 'function') {
      return res.send(result.buffer);
    }
    return res.end(result.buffer);
  } catch (error: any) {
    console.error('[Vercel TTS Handler Error]', error);
    const message = error?.message || 'Error en servidor de síntesis de voz';
    if (typeof res.status === 'function') {
      return res.status(502).json({ error: message });
    }
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: message }));
  }
}
