/**
 * api/tts.ts
 *
 * Handler Serverless autónomo para Vercel Functions.
 * Expone la ruta POST /api/tts directamente al desplegar en Vercel.
 *
 * DISEÑO DEFENSIVO PARA VERCEL:
 * - 100% autocontenido (sin dependencias relativas externas que puedan fallar en empaquetado ESM/Lambda).
 * - Sanitización de API Key (elimina comillas accidentales y espacios al pegar en Vercel).
 * - Reintento automático con voz base si el reference_id personalizado es inválido o no accesible.
 * - Soporte universal para Vercel Serverless (req.body parseado o stream; res.send o res.end).
 * - Cabeceras CORS completas para OBS Studio y cualquier origen.
 */

const MAX_TTS_LENGTH = 300;

function generateFallbackBeepBuffer(durationSec = 1.8, freq = 440): Buffer {
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

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.sin((Math.PI * i) / numSamples);
    const sample = Math.sin(2 * Math.PI * freq * t) * envelope * 0.45;
    const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
    buffer.writeInt16LE(intSample, 44 + i * 2);
  }

  return buffer;
}

interface TTSProcessResult {
  status: number;
  contentType: string;
  buffer: Buffer;
  headers?: Record<string, string>;
}

async function processTTSRequest(text: string, reference_id?: string, model = 's2.1-pro-free'): Promise<TTSProcessResult> {
  const trimmedText = (text || '').trim();

  if (!trimmedText) {
    throw new Error('Parámetro text requerido');
  }

  const boundedText = trimmedText.slice(0, MAX_TTS_LENGTH);
  const rawKey = process.env.FISH_AUDIO_API_KEY || '';
  const apiKey = rawKey.replace(/^["']|["']$/g, '').trim();

  // Si no hay API key en variables de entorno, devolver audio de simulación
  if (!apiKey) {
    console.log(`[TTS Engine] Sin FISH_AUDIO_API_KEY: Generando audio de prueba para: "${boundedText.slice(0, 30)}..."`);
    const fallbackDuration = Math.min(3.5, Math.max(1.2, boundedText.length * 0.08));
    return {
      status: 200,
      contentType: 'audio/wav',
      buffer: generateFallbackBeepBuffer(fallbackDuration, 480),
      headers: {
        'X-TTS-Mode': 'simulation-fallback',
      },
    };
  }

  const selectedModel = model || 's2.1-pro-free';
  console.log(`[TTS Engine Vercel] Solicitando Fish Audio (${selectedModel}, ref: ${reference_id || 'default'}): "${boundedText.slice(0, 30)}..."`);

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
        reference_id: reference_id || undefined,
        format: 'mp3',
        normalize: true,
        latency: 'normal',
      }),
    });

    // Si la llamada con voz personalizada falla (ej. 400 porque el ID no existe o no tiene permiso),
    // reintentamos automáticamente sin reference_id para que el stream nunca se quede en silencio
    if (!fishResponse.ok && reference_id) {
      console.warn(`[Fish Audio Vercel] Voz personalizada "${reference_id}" no respondió OK (${fishResponse.status}). Reintentando con voz base por defecto...`);
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
      console.warn(`[Fish Audio Vercel] API respondió con status ${fishResponse.status}. Usando audio de respaldo.`);
      return {
        status: 200,
        contentType: 'audio/wav',
        buffer: generateFallbackBeepBuffer(2.0, 380),
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
    console.error('[Fish Audio Vercel Fetch Error]', err);
    return {
      status: 200,
      contentType: 'audio/wav',
      buffer: generateFallbackBeepBuffer(1.8, 350),
      headers: {
        'X-TTS-Mode': 'network-error-fallback',
      },
    };
  }
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
  } catch (error) {
    console.error('[Vercel TTS Handler Error]', error);
    if (typeof res.status === 'function') {
      return res.status(500).json({ error: 'Error procesando síntesis de voz' });
    }
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Error procesando síntesis de voz' }));
  }
}
