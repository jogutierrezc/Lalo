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

import { elevenAllowed, elevenSynthesize } from '../server/elevenlabs.js';
import {
  processTTSRequest,
  normalizeServerText,
  MAX_TTS_LENGTH,
  type TTSProcessResult,
} from '../server/ttsHandler.js';

export const config = {
  maxDuration: 60,
};

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

    let result: TTSProcessResult;
    if (body?.engine === 'elevenlabs') {
      // Motor opcional: solo para cuentas que el administrador activó. Se comprueba aquí, no en el navegador.
      const allowed = await elevenAllowed(req.headers ?? {}, String(body.k ?? ''), process.env);
      if (!allowed) {
        const payload = { error: 'ElevenLabs no está activado para esta cuenta.', code: 'elevenlabs_not_enabled' };
        if (typeof res.status === 'function') return res.status(403).json(payload);
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify(payload));
      }
      const spoken = normalizeServerText(text.trim().slice(0, MAX_TTS_LENGTH));
      result = {
        status: 200,
        contentType: 'audio/mpeg',
        buffer: await elevenSynthesize(spoken, String(reference_id ?? ''), process.env),
      };
    } else {
      result = await processTTSRequest(text, reference_id, model);
    }

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
