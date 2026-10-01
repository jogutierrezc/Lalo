/**
 * api/tts.ts
 *
 * Handler Serverless para Vercel Functions.
 * Expone la ruta POST /api/tts directamente al desplegar en Vercel.
 * Vercel activa esta función on-demand cuando se envía una petición desde OBS o el dashboard.
 */

import { processTTSRequest } from '../server/ttsHandler';

export default async function handler(req: any, res: any) {
  // Cabeceras de CORS para permitir peticiones desde OBS Studio y cualquier origen
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Método no permitido. Usa POST.' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({ error: 'Payload JSON inválido' });
      }
    }

    const { text, reference_id, model } = body || {};

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Parámetro text requerido' });
    }

    const result = await processTTSRequest(text, reference_id, model);

    res.status(result.status);
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Length', result.buffer.length);
    res.setHeader('Cache-Control', 'no-cache');
    if (result.headers) {
      Object.entries(result.headers).forEach(([k, v]) => res.setHeader(k, v));
    }
    return res.send(result.buffer);
  } catch (error) {
    console.error('[Vercel TTS Handler Error]', error);
    return res.status(500).json({ error: 'Error procesando síntesis de voz' });
  }
}
