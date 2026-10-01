/**
 * api/health.ts
 *
 * Endpoint de salud Serverless para Vercel Functions.
 */

export default function handler(_req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json({
    status: 'ok',
    platform: 'vercel-serverless',
    timestamp: new Date().toISOString(),
  });
}
