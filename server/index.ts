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

let dynamicDeploymentVersion = process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || `local-dev-${Date.now()}`;

// Endpoint de versión para el auto-actualizador del widget
app.get('/api/version', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.json({
    status: 'ok',
    version: '1.0.0',
    deployment: dynamicDeploymentVersion,
  });
});

app.post('/api/version', (_req: Request, res: Response) => {
  dynamicDeploymentVersion = `manual-reload-${Date.now()}`;
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.json({
    status: 'ok',
    version: '1.0.0',
    deployment: dynamicDeploymentVersion,
    message: 'Señal de actualización de OBS emitida',
  });
});

app.post('/api/obs/reload', (_req: Request, res: Response) => {
  dynamicDeploymentVersion = `manual-reload-${Date.now()}`;
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.json({
    status: 'ok',
    deployment: dynamicDeploymentVersion,
    message: 'Señal de actualización de OBS emitida',
    timestamp: Date.now(),
  });
});

// Endpoint receptor de eventos del puente TwitchIO (PythonistaGuild)
app.post('/api/twitchio/event', (req: Request, res: Response) => {
  const { type, channel, data } = req.body || {};
  console.log(`[TwitchIO Bridge Event] Tipo: ${type} | Canal: ${channel}`, data);
  res.json({
    status: 'ok',
    framework: 'TwitchIO (PythonistaGuild)',
    receivedAt: Date.now(),
    type,
    channel,
  });
});

interface TTSRequestBody {
  text?: string;
  reference_id?: string;
  model?: string;
}

/**
 * POST /api/tts
 * Convierte texto limpio en audio mp3/wav usando la API de Fish Audio V1.
 */
app.post('/api/tts', async (req: Request<{}, {}, TTSRequestBody>, res: Response): Promise<void> => {
  try {
    const { text, reference_id, model } = req.body;

    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'Parámetro text requerido' });
      return;
    }

    const result = await processTTSRequest(text, reference_id, model);

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

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, '../dist');

app.use(express.static(distPath));

app.get('*', (req, res, next) => {
  if (req.url.startsWith('/api')) return next();
  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err) next();
  });
});

app.listen(PORT, () => {
  console.log(`[Lalo TTS Server] Servidor backend escuchando en http://localhost:${PORT}`);
});
