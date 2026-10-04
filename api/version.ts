/**
 * api/version.ts
 *
 * Endpoint liviano para el auto-actualizador del widget de OBS.
 * Permite que los overlays abiertos en OBS detecten nuevos despliegues en Vercel
 * y se recarguen solos sin intervención del streamer.
 */

let serverlessDeploymentVersion = process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || 'production';

export default function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // /api/health llega aquí (vercel.json): así las dos rutas comparten una función
  if (req.query?.health) {
    return res.status(200).json({ status: 'ok', platform: 'vercel-serverless', timestamp: new Date().toISOString() });
  }

  if (req.method === 'POST') {
    serverlessDeploymentVersion = `manual-reload-${Date.now()}`;
    return res.status(200).json({
      status: 'ok',
      version: '1.0.0',
      deployment: serverlessDeploymentVersion,
      message: 'Señal de actualización de OBS emitida',
      timestamp: Date.now(),
    });
  }

  return res.status(200).json({
    status: 'ok',
    version: '1.0.0',
    deployment: serverlessDeploymentVersion,
  });
}
