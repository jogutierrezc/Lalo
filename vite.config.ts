import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { processTTSRequest, normalizeServerText, MAX_TTS_LENGTH, type TTSProcessResult } from './server/ttsHandler';
import { elevenQuotaCheckAndRecord, elevenSynthesize, recordFishTtsUsage } from './server/elevenlabs';
import type { IncomingMessage, ServerResponse } from 'http';

function createTTSMiddleware() {
  let devDeploymentVersion = process.env.VERCEL_GIT_COMMIT_SHA || `development-${Date.now()}`;

  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    // Endpoint POST /api/tts
    if (req.url?.startsWith('/api/tts') && req.method === 'POST') {
      let bodyData = '';
      req.on('data', (chunk) => {
        bodyData += chunk;
      });

      req.on('end', async () => {
        try {
          const parsed = JSON.parse(bodyData || '{}');
          const text = typeof parsed.text === 'string' ? parsed.text : '';
          const reference_id = parsed.reference_id;
          const model = parsed.model || 's2.1-pro-free';

          if (!text.trim()) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Parámetro text requerido' }));
            return;
          }

          const spoken = normalizeServerText(text.trim().slice(0, MAX_TTS_LENGTH));
          const widgetKey = String(parsed.k ?? '');
          let result: TTSProcessResult;
          if (parsed.engine === 'elevenlabs') {
            const check = await elevenQuotaCheckAndRecord(req.headers ?? {}, widgetKey, spoken.length, process.env);
            if (!check.allowed && check.reason === 'quota_exceeded') {
              const fallback = await processTTSRequest(spoken, undefined, model);
              void recordFishTtsUsage(req.headers ?? {}, widgetKey, spoken.length, process.env);
              result = {
                ...fallback,
                headers: { ...(fallback.headers ?? {}), 'X-Lalo-TTS-Fallback': 'elevenlabs-quota' },
              };
            } else if (!check.allowed) {
              res.statusCode = 403;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'ElevenLabs no está activado para esta cuenta.', code: 'elevenlabs_not_enabled' }));
              return;
            } else {
              result = {
                status: 200,
                contentType: 'audio/mpeg',
                buffer: await elevenSynthesize(spoken, String(reference_id ?? ''), process.env),
              };
            }
          } else {
            result = await processTTSRequest(text, reference_id, model);
            void recordFishTtsUsage(req.headers ?? {}, widgetKey, spoken.length, process.env);
          }

          res.statusCode = result.status;
          res.setHeader('Content-Type', result.contentType);
          res.setHeader('Content-Length', result.buffer.length);
          res.setHeader('Cache-Control', 'no-cache');
          if (result.headers) {
            Object.entries(result.headers).forEach(([k, v]) => res.setHeader(k, v));
          }
          res.end(result.buffer);
        } catch (err: any) {
          console.error('[Vite TTS Middleware Error]', err);
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err?.message || 'Error en servidor de síntesis de voz' }));
        }
      });
      return;
    }

    // Endpoint GET /api/health
    if (req.url?.startsWith('/api/health') && req.method === 'GET') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'ok', runtime: 'vite-integrated-server' }));
      return;
    }

    // Endpoint POST /api/version y POST /api/obs/reload (señal de recarga para OBS en dev)
    if ((req.url?.startsWith('/api/version') || req.url?.startsWith('/api/obs/reload')) && req.method === 'POST') {
      devDeploymentVersion = `manual-reload-${Date.now()}`;
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.end(JSON.stringify({
        status: 'ok',
        version: '1.0.0',
        deployment: devDeploymentVersion,
        message: 'Señal de actualización de OBS emitida',
        timestamp: Date.now(),
      }));
      return;
    }

    // Endpoint GET /api/version y /version.json
    if ((req.url?.startsWith('/api/version') || req.url?.startsWith('/version.json')) && req.method === 'GET') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.end(JSON.stringify({
        status: 'ok',
        version: '1.0.0',
        deployment: devDeploymentVersion,
        timestamp: Date.now(),
      }));
      return;
    }

    next();
  };
}

function ttsDevServerPlugin(): Plugin {
  const middleware = createTTSMiddleware();
  return {
    name: 'tts-dev-server-plugin',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig({
  plugins: [react(), ttsDevServerPlugin()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) {
            return 'react-vendor';
          }
          if (id.includes('gsap')) {
            return 'gsap-vendor';
          }
          if (id.includes('@supabase')) {
            return 'supabase-vendor';
          }
          if (id.includes('tmi.js')) {
            return 'tmi-vendor';
          }
          if (id.includes('lucide-react')) {
            return 'icons-vendor';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 3000,
    // En local, las rutas de almacenamiento y la de cortos de Twitch las atiende server/index.ts (npm run dev:all)
    proxy: {
      '/api/storage': `http://localhost:${process.env.PORT || 3001}`,
      '/api/media': `http://localhost:${process.env.PORT || 3001}`,
      '/api/twitch': `http://localhost:${process.env.PORT || 3001}`,
      '/api/voices': `http://localhost:${process.env.PORT || 3001}`,
      '/api/spotify': `http://localhost:${process.env.PORT || 3001}`,
      '/api/kofi': `http://localhost:${process.env.PORT || 3001}`,
      '/api/riot': `http://localhost:${process.env.PORT || 3001}`,
      '/api/integrations': `http://localhost:${process.env.PORT || 3001}`,
      '/api/lux': `http://localhost:${process.env.PORT || 3001}`,
    },
    watch: {
      ignored: ['**/*.mp3', '**/*.wav', '**/dist/**', '**/.git/**', '**/.claude/**', '**/test_*'],
    },
  },
  preview: {
    port: 3000,
  },
  test: {
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**'],
  },
});
