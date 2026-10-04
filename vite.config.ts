import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { processTTSRequest } from './server/ttsHandler';
import type { IncomingMessage, ServerResponse } from 'http';

function createTTSMiddleware() {
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
          const text = parsed.text || '';
          const reference_id = parsed.reference_id;
          const model = parsed.model || 's2.1-pro-free';

          if (!text.trim()) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Parámetro text requerido' }));
            return;
          }

          const result = await processTTSRequest(text, reference_id, model);

          res.statusCode = result.status;
          res.setHeader('Content-Type', result.contentType);
          res.setHeader('Content-Length', result.buffer.length);
          res.setHeader('Cache-Control', 'no-cache');
          if (result.headers) {
            Object.entries(result.headers).forEach(([k, v]) => res.setHeader(k, v));
          }
          res.end(result.buffer);
        } catch (err) {
          console.error('[Vite TTS Middleware Error]', err);
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Payload JSON inválido o malformado' }));
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

    // Endpoint GET /api/version y /version.json
    if ((req.url?.startsWith('/api/version') || req.url?.startsWith('/version.json')) && req.method === 'GET') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.end(JSON.stringify({
        status: 'ok',
        version: '1.0.0',
        deployment: process.env.VERCEL_GIT_COMMIT_SHA || 'development',
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
      '/api/integrations': `http://localhost:${process.env.PORT || 3001}`,
    },
    watch: {
      ignored: ['**/*.mp3', '**/*.wav', '**/dist/**', '**/.git/**', '**/test_*'],
    },
  },
  preview: {
    port: 3000,
  },
});
