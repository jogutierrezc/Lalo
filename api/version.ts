/**
 * api/version.ts
 *
 * Endpoint liviano para el auto-actualizador del widget de OBS.
 * Permite que los overlays abiertos en OBS detecten nuevos despliegues en Vercel
 * y se recarguen solos sin intervención del streamer.
 */

const DEPLOYMENT_TIMESTAMP = Date.now();

export default function handler(_req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Content-Type', 'application/json');

  const buildId = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || String(DEPLOYMENT_TIMESTAMP);

  return res.status(200).json({
    buildId,
    timestamp: DEPLOYMENT_TIMESTAMP,
  });
}
