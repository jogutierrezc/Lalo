/**
 * api/version.ts
 *
 * Endpoint liviano para el auto-actualizador del widget de OBS.
 * Permite que los overlays abiertos en OBS detecten nuevos despliegues en Vercel
 * y se recarguen solos sin intervención del streamer.
 */

export default function handler(_req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Content-Type', 'application/json');

  return res.status(200).json({
    status: 'ok',
    version: '1.0.0',
    deployment: process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || 'production',
  });
}
