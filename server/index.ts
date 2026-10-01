/**
 * server/index.ts
 *
 * Backend Serverless/Express proxy para la integración segura con Fish Audio API.
 * Protege la API Key de Fish Audio estrictamente en el entorno del servidor,
 * restringe CORS a los orígenes autorizados y previene abuso mediante validación de longitud.
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const MAX_BACKEND_TTS_LENGTH = 200;

// Configuración defensiva de CORS
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  process.env.FRONTEND_ORIGIN || '',
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Permitir peticiones sin origen (ej. curl, electron, obs local o same-origin)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Bloqueado por política de CORS'));
      }
    },
    methods: ['GET', 'POST'],
  })
);

app.use(express.json({ limit: '16kb' })); // Prevenir payloads masivos

// Endpoint de verificación de salud (sin fuga de información de tokens)
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'Lalo TTS Server',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Genera un buffer WAV simple de tono senoidal como fallback cuando no hay API Key
 * para permitir probar la cola, animaciones y audio en OBS sin bloquear al streamer.
 */
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
  buffer.writeUInt32LE(16, 16); // subchunk1 size
  buffer.writeUInt16LE(1, 20);  // PCM format
  buffer.writeUInt16LE(1, 22);  // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34); // bits per sample

  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Onda con envolvente suave (fade in / fade out)
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.sin((Math.PI * i) / numSamples); // campana suave
    const sample = Math.sin(2 * Math.PI * freq * t) * envelope * 0.4;
    const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
    buffer.writeInt16LE(intSample, 44 + i * 2);
  }

  return buffer;
}

interface TTSRequestBody {
  text?: string;
  reference_id?: string;
}

/**
 * POST /api/tts
 * Convierte texto limpio en audio mp3/wav usando la API de Fish Audio V1.
 * Los secretos residen EXCLUSIVAMENTE en el entorno del servidor.
 */
app.post('/api/tts', async (req: Request<{}, {}, TTSRequestBody>, res: Response): Promise<void> => {
  try {
    const { text, reference_id } = req.body;

    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'Parámetro text requerido' });
      return;
    }

    const trimmedText = text.trim();
    if (trimmedText.length === 0 || trimmedText.length > MAX_BACKEND_TTS_LENGTH) {
      res.status(400).json({
        error: `El texto debe tener entre 1 y ${MAX_BACKEND_TTS_LENGTH} caracteres`,
      });
      return;
    }

    // La API Key proviene estrictamente del entorno del servidor
    const effectiveApiKey = process.env.FISH_AUDIO_API_KEY;

    // Si no hay API Key configurada en .env, emitimos el audio de prueba fallback
    if (!effectiveApiKey) {
      console.warn('[TTS Server] FISH_AUDIO_API_KEY no configurada en .env. Emitiendo simulación de audio.');
      const fallbackAudio = generateFallbackBeepBuffer(Math.min(4, Math.max(1.2, trimmedText.length * 0.08)));
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Content-Length', fallbackAudio.length);
      res.setHeader('X-TTS-Mode', 'simulation-mock');
      res.send(fallbackAudio);
      return;
    }

    console.log(`[TTS Server] Solicitando síntesis a Fish Audio API: "${trimmedText.substring(0, 30)}..."`);

    // Llamada a Fish Audio V1 TTS
    const fishResponse = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${effectiveApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: trimmedText,
        reference_id: reference_id || undefined,
        format: 'mp3',
        normalize: true,
        latency: 'normal',
      }),
    });

    if (!fishResponse.ok) {
      console.error(`[Fish Audio API Error] HTTP ${fishResponse.status}`);
      // Respuesta de error genérica sin filtrar datos internos del proveedor
      res.status(500).json({
        error: 'Error al comunicarse con el proveedor de síntesis de voz',
      });
      return;
    }

    const arrayBuffer = await fishResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'no-cache');
    res.send(buffer);
  } catch (error) {
    console.error('[TTS Server Error]', error);
    res.status(500).json({
      error: 'Error interno del servidor de síntesis de voz',
    });
  }
});

app.listen(PORT, () => {
  console.log(`[Lalo TTS Server] Servidor backend escuchando en http://localhost:${PORT}`);
});
