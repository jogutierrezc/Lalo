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
import { processTTSRequest } from './ttsHandler';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Configuración defensiva de CORS
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  process.env.FRONTEND_ORIGIN || '',
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Bloqueado por política de CORS'));
      }
    },
    methods: ['GET', 'POST'],
  })
);

app.use(express.json({ limit: '16kb' }));

// Endpoint de verificación de salud
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'Lalo TTS Server',
    timestamp: new Date().toISOString(),
  });
});

interface TTSRequestBody {
  text?: string;
  reference_id?: string;
}

/**
 * POST /api/tts
 * Convierte texto limpio en audio mp3/wav usando la API de Fish Audio V1.
 */
app.post('/api/tts', async (req: Request<{}, {}, TTSRequestBody>, res: Response): Promise<void> => {
  try {
    const { text, reference_id } = req.body;

    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'Parámetro text requerido' });
      return;
    }

    const result = await processTTSRequest(text, reference_id);

    res.status(result.status);
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Length', result.buffer.length);
    res.setHeader('Cache-Control', 'no-cache');
    if (result.headers) {
      Object.entries(result.headers).forEach(([k, v]) => res.setHeader(k, v));
    }
    res.send(result.buffer);
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
